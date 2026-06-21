import { existsSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import type { ServerConfig } from "../config.js";
import type { MetadataDb } from "../db.js";
import { createAuth } from "../auth.js";
import { LocalAgent } from "../agent/LocalAgent.js";
import { registerTerminalSocket } from "../ws/terminalSocket.js";
import type { PortPreview, SessionType, Workspace } from "../../shared/types.js";

interface CreateAppInput {
  config: ServerConfig;
  db: MetadataDb;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

function sessionType(value: unknown): SessionType {
  if (value === "bash" || value === "codex" || value === "claude") return value;
  return "bash";
}

function requestPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw httpError(400, "Port must be an integer from 1 to 65535");
  }
  return value;
}

function proxyHeaders(headers: IncomingHttpHeaders, port: number): IncomingHttpHeaders {
  const nextHeaders = { ...headers };
  delete nextHeaders.host;
  delete nextHeaders.cookie;
  delete nextHeaders.authorization;
  delete nextHeaders["proxy-authorization"];
  nextHeaders.host = `127.0.0.1:${port}`;
  return nextHeaders;
}

function proxyResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const nextHeaders = { ...headers };
  delete nextHeaders["set-cookie"];
  return nextHeaders;
}

export async function createApp({ config, db }: CreateAppInput): Promise<Server> {
  const app = express();
  const server = createServer(app);
  const auth = createAuth(config.authToken);
  const agent = new LocalAgent();
  const previews = new Map<string, PortPreview>();

  const getWorkspace = (workspaceId: string): Workspace => {
    const workspace = db.listWorkspaces().find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw httpError(404, "Workspace not found");
    }
    return workspace;
  };

  app.post("/api/login", express.json({ limit: "2mb" }), auth.login);
  app.use("/api", express.json({ limit: "2mb" }));
  app.use("/api", auth.requireAuth);

  app.get("/api/workspaces", (_req, res) => {
    res.json({ workspaces: db.listWorkspaces() });
  });

  app.get("/api/workspaces/:workspaceId/sessions", (req, res) => {
    getWorkspace(req.params.workspaceId);
    res.json({ sessions: db.listSessions(req.params.workspaceId) });
  });

  app.post(
    "/api/workspaces/:workspaceId/sessions",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const type = sessionType(req.body?.type);
      const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : type;
      const terminal = await agent.createTerminalSession({
        workspaceId: workspace.id,
        rootPath: workspace.rootPath,
        name,
        type,
      });
      const session = db.createSession({
        workspaceId: workspace.id,
        name,
        type,
        tmuxName: terminal.tmuxName,
      });
      db.updateSessionStatus(session.id, "running");
      res.json({ session: db.getSession(session.id) ?? session });
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/files",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : ".";
      res.json({ files: await agent.listFiles(workspace.rootPath, path) });
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/file",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : "";
      res.json(await agent.readFile({ rootPath: workspace.rootPath, path }));
    }),
  );

  app.put(
    "/api/workspaces/:workspaceId/file",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const { path, content, expectedVersion } = req.body ?? {};
      if (typeof path !== "string" || typeof content !== "string" || typeof expectedVersion !== "string") {
        res.status(400).json({ error: "path, content, and expectedVersion are required" });
        return;
      }
      res.json(await agent.writeFile({ rootPath: workspace.rootPath, path, content, expectedVersion }));
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/status",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      res.json(await agent.gitStatus(workspace.rootPath));
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/diff",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : "";
      res.type("text/plain").send(await agent.gitDiff(workspace.rootPath, path));
    }),
  );

  app.post(
    "/api/workspaces/:workspaceId/previews",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const port = requestPort(req.body?.port);
      const preview = await agent.createPreview(workspace.id, port);
      previews.set(preview.id, preview);
      res.json({ preview });
    }),
  );

  app.use("/preview/:previewId", auth.requireAuth, (req, res, next) => {
    const preview = previews.get(req.params.previewId);
    if (!preview) {
      res.status(404).json({ error: "Preview not found" });
      return;
    }

    const prefix = `/preview/${preview.id}`;
    const targetPath = req.originalUrl.slice(prefix.length) || "/";
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: preview.port,
        method: req.method,
        path: targetPath,
        headers: proxyHeaders(req.headers, preview.port),
      },
      (upstreamResponse) => {
        res.statusCode = upstreamResponse.statusCode ?? 502;
        for (const [name, value] of Object.entries(proxyResponseHeaders(upstreamResponse.headers))) {
          if (value !== undefined) res.setHeader(name, value);
        }
        upstreamResponse.pipe(res);
      },
    );

    upstream.on("error", next);
    req.pipe(upstream);
  });

  const staticRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../client");
  if (existsSync(staticRoot)) {
    app.use(express.static(staticRoot));
    app.get("*", (_req, res) => {
      res.sendFile(join(staticRoot, "index.html"));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    res.status(Number.isInteger(status) && status >= 400 ? status : 500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  const terminalSocket = new WebSocketServer({ noServer: true });
  registerTerminalSocket(terminalSocket, db);
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/terminal")) {
      socket.destroy();
      return;
    }
    if (!auth.isValid(req as Request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    terminalSocket.handleUpgrade(req, socket, head, (ws) => {
      terminalSocket.emit("connection", ws, req);
    });
  });

  return server;
}
