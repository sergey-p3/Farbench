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
import type { AgentGateway } from "../agent/AgentGateway.js";
import { registerTerminalSocket } from "../ws/terminalSocket.js";
import type { PortPreview, SessionType, Workspace } from "../../shared/types.js";

interface CreateAppInput {
  config: ServerConfig;
  db: MetadataDb;
  agent?: AgentGateway;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isFileConflict(error: unknown): boolean {
  return error instanceof Error && error.message === "File changed on disk";
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

function proxyResponseHeaders(headers: IncomingHttpHeaders, prefix: string): IncomingHttpHeaders {
  const nextHeaders = { ...headers };
  delete nextHeaders["set-cookie"];
  const location = rewriteHeaderLocation(nextHeaders.location, prefix);
  if (location) nextHeaders.location = location;
  return nextHeaders;
}

function rewriteHeaderLocation(location: IncomingHttpHeaders["location"], prefix: string): IncomingHttpHeaders["location"] {
  if (typeof location === "string") return rewritePreviewPath(location, prefix);
  return location;
}

function rewritePreviewPath(value: string, prefix: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith(prefix)) return value;
  return `${prefix}${value}`;
}

function rewriteHtmlPreviewLinks(html: string, prefix: string): string {
  return html
    .replace(/\b(src|href|action)=(["'])(\/(?!\/)[^"']*)\2/g, (_match, attr: string, quote: string, path: string) => {
      return `${attr}=${quote}${rewritePreviewPath(path, prefix)}${quote}`;
    })
    .replace(/url\((["']?)(\/(?!\/)[^"')]+)\1\)/g, (_match, quote: string, path: string) => {
      return `url(${quote}${rewritePreviewPath(path, prefix)}${quote})`;
    });
}

function isHtmlResponse(headers: IncomingHttpHeaders): boolean {
  const contentType = headers["content-type"];
  const value = Array.isArray(contentType) ? contentType.join(";") : contentType ?? "";
  return value.toLowerCase().includes("text/html");
}

export async function createApp({ config, db, agent = new LocalAgent() }: CreateAppInput): Promise<Server> {
  const app = express();
  const server = createServer(app);
  const auth = createAuth(config.authToken);
  const previews = new Map<string, PortPreview>();

  const recordAudit = (type: string, metadata: Record<string, string | number | boolean | null>): void => {
    db.recordAuditEvent({ type, metadata });
  };

  const reconcileSessions = async (): Promise<void> => {
    const sessions = db.listRecoverableSessions();
    await Promise.all(
      sessions.map(async (session) => {
        if (!(await agent.terminalSessionExists(session.tmuxName))) {
          db.updateSessionStatus(session.id, "exited");
          recordAudit("session.reconciled_missing", { sessionId: session.id, workspaceId: session.workspaceId });
        }
      }),
    );
  };

  await reconcileSessions();

  const getWorkspace = (workspaceId: string): Workspace => {
    const workspace = db.listWorkspaces().find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw httpError(404, "Workspace not found");
    }
    return workspace;
  };

  app.post("/api/login", express.json({ limit: "2mb" }), (req, res) => {
    const success = req.body?.token === config.authToken;
    recordAudit(success ? "auth.login.success" : "auth.login.failure", { success });
    auth.login(req, res);
  });
  app.use("/api", express.json({ limit: "2mb" }));
  app.use("/api", auth.requireAuth);

  app.get("/api/workspaces", (_req, res) => {
    res.json({ workspaces: db.listWorkspaces() });
  });

  app.get(
    "/api/workspaces/:workspaceId/sessions",
    asyncHandler(async (req, res) => {
      getWorkspace(req.params.workspaceId);
      await reconcileSessions();
      res.json({ sessions: db.listSessions(req.params.workspaceId) });
    }),
  );

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
      recordAudit("session.create", { sessionId: session.id, workspaceId: workspace.id, type });
      res.json({ session: db.getSession(session.id) ?? session });
    }),
  );

  app.delete(
    "/api/workspaces/:workspaceId/sessions/:sessionId",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const session = db.getSession(req.params.sessionId);
      if (!session || session.workspaceId !== workspace.id) {
        throw httpError(404, "Session not found");
      }

      if (await agent.terminalSessionExists(session.tmuxName)) {
        await agent.killSession(session.tmuxName);
      }
      db.updateSessionStatus(session.id, "killed");
      recordAudit("session.kill", { sessionId: session.id, workspaceId: workspace.id });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/files",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : ".";
      const files = await agent.listFiles(workspace.rootPath, path);
      recordAudit("files.list", { workspaceId: workspace.id, path });
      res.json({ files });
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/file",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : "";
      const file = await agent.readFile({ rootPath: workspace.rootPath, path });
      recordAudit("file.read", { workspaceId: workspace.id, path });
      res.json(file);
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
      try {
        const file = await agent.writeFile({ rootPath: workspace.rootPath, path, content, expectedVersion });
        recordAudit("file.write", { workspaceId: workspace.id, path });
        res.json(file);
      } catch (error) {
        if (isFileConflict(error)) throw httpError(409, "File changed on disk");
        throw error;
      }
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/status",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const status = await agent.gitStatus(workspace.rootPath);
      recordAudit("git.status", { workspaceId: workspace.id });
      res.json(status);
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/diff",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path.trim() : "";
      if (!path) {
        res.status(400).json({ error: "missing path" });
        return;
      }
      const diff = await agent.gitDiff(workspace.rootPath, path);
      recordAudit("git.diff", { workspaceId: workspace.id, path });
      res.type("text/plain").send(diff);
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/file-diff",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path : "";
      if (!path.trim()) {
        res.status(400).json({ error: "missing path" });
        return;
      }
      const diff = await agent.gitFileDiff(workspace.rootPath, path);
      recordAudit("git.file_diff", { workspaceId: workspace.id, path });
      res.json(diff);
    }),
  );

  app.post(
    "/api/workspaces/:workspaceId/previews",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const port = requestPort(req.body?.port);
      const preview = await agent.createPreview(workspace.id, port);
      previews.set(preview.id, preview);
      recordAudit("preview.create", { workspaceId: workspace.id, previewId: preview.id, port });
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
        const responseHeaders = proxyResponseHeaders(upstreamResponse.headers, prefix);
        if (isHtmlResponse(upstreamResponse.headers)) delete responseHeaders["content-length"];
        for (const [name, value] of Object.entries(responseHeaders)) {
          if (value !== undefined) res.setHeader(name, value);
        }
        if (!isHtmlResponse(upstreamResponse.headers)) {
          upstreamResponse.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          res.end(rewriteHtmlPreviewLinks(Buffer.concat(chunks).toString("utf8"), prefix));
        });
      },
    );

    upstream.on("error", () => {
      if (!res.headersSent) {
        res.status(502).type("text/plain").send("preview target unavailable");
      } else {
        next(httpError(502, "preview target unavailable"));
      }
    });
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
