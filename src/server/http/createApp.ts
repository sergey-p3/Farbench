import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import { LocalAgent } from "../agent/LocalAgent.js";
import type { AgentGateway } from "../agent/AgentGateway.js";
import { createAuth } from "../auth.js";
import type { ServerConfig } from "../config.js";
import type { MetadataDb } from "../db.js";
import { registerTerminalSocket } from "../ws/terminalSocket.js";
import { registerGitRoutes } from "./gitRoutes.js";
import { registerPreviewRoutes } from "./previewRoutes.js";
import { asyncHandler, createWorkspaceLookup } from "./routeUtils.js";
import { registerWorkspaceRoutes } from "./workspaceRoutes.js";

interface CreateAppInput {
  config: ServerConfig;
  db: MetadataDb;
  agent?: AgentGateway;
  devClient?: DevClient;
}

type DevMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface DevClient {
  middlewares: DevMiddleware;
  transformIndexHtml: (path: string, html: string) => Promise<string>;
  close?: () => Promise<void>;
}

export async function createApp({
  config,
  db,
  agent = new LocalAgent(),
  devClient: injectedDevClient,
}: CreateAppInput): Promise<Server> {
  const app = express();
  const server = createServer(app);
  const devClient = await createDevClient(server, injectedDevClient);
  if (devClient?.close) {
    server.once("close", () => {
      void devClient.close?.();
    });
  }

  const auth = createAuth(config.authToken);
  const recordAudit = (
    type: string,
    metadata: Record<string, string | number | boolean | null>,
  ): void => {
    db.recordAuditEvent({ type, metadata });
  };
  const reconcileSessions = async (): Promise<void> => {
    const sessions = db.listRecoverableSessions();
    await Promise.all(sessions.map(async (session) => {
      if (await agent.terminalSessionExists(session.tmuxName)) return;
      db.updateSessionStatus(session.id, "exited");
      recordAudit("session.reconciled_missing", { sessionId: session.id, workspaceId: session.workspaceId });
    }));
  };

  await reconcileSessions();
  const getWorkspace = createWorkspaceLookup(db);

  app.post("/api/login", express.json({ limit: "2mb" }), (req, res) => {
    const success = req.body?.token === config.authToken;
    recordAudit(success ? "auth.login.success" : "auth.login.failure", { success });
    auth.login(req, res);
  });
  app.use("/api", express.json({ limit: "2mb" }));
  app.use("/api", auth.requireAuth);

  registerWorkspaceRoutes({ agent, app, db, getWorkspace, reconcileSessions, recordAudit });
  registerGitRoutes({ agent, app, getWorkspace, recordAudit });
  registerPreviewRoutes({ agent, app, getWorkspace, recordAudit, requireAuth: auth.requireAuth });

  registerClientRoutes(app, devClient);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    res.status(Number.isInteger(status) && status >= 400 ? status : 500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  registerTerminalUpgrade(server, db, auth);
  return server;
}

function registerClientRoutes(app: express.Express, devClient: DevClient | null): void {
  if (devClient) {
    const clientRoot = resolve(process.cwd(), "src/client");
    const indexPath = join(clientRoot, "index.html");
    app.use((req, res, next) => devClient.middlewares(req, res, next));
    app.get("*", asyncHandler(async (req, res) => {
      const html = await readFile(indexPath, "utf8");
      res.type("html").send(await devClient.transformIndexHtml(req.originalUrl, html));
    }));
  }

  const staticRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../client");
  if (!existsSync(staticRoot)) return;
  app.use(express.static(staticRoot));
  app.get("*", (_req, res) => {
    res.sendFile(join(staticRoot, "index.html"));
  });
}

function registerTerminalUpgrade(
  server: Server,
  db: MetadataDb,
  auth: ReturnType<typeof createAuth>,
): void {
  const terminalSocket = new WebSocketServer({ noServer: true });
  registerTerminalSocket(terminalSocket, db);
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/terminal")) return;
    if (!auth.isValid(req as Request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    terminalSocket.handleUpgrade(req, socket, head, (ws) => {
      terminalSocket.emit("connection", ws, req);
    });
  });
}

async function createDevClient(server: Server, injected?: DevClient): Promise<DevClient | null> {
  if (injected) return injected;
  if (process.env.REMOTE_DEV_VITE !== "1") return null;

  const { createServer: createViteServer } = await import("vite");
  return createViteServer({
    configFile: resolve(process.cwd(), "vite.config.ts"),
    appType: "custom",
    server: {
      hmr: { server },
      middlewareMode: true,
    },
  });
}
