import type { Express } from "express";
import type { CodexPermissionLevel, SessionType, Workspace } from "../../shared/types.js";
import type { AgentGateway } from "../agent/AgentGateway.js";
import type { MetadataDb } from "../db.js";
import { asyncHandler, httpError, type RecordAudit } from "./routeUtils.js";

interface WorkspaceRoutesOptions {
  agent: AgentGateway;
  app: Express;
  db: MetadataDb;
  getWorkspace: (workspaceId: string) => Workspace;
  reconcileSessions: () => Promise<void>;
  recordAudit: RecordAudit;
}

export function registerWorkspaceRoutes({
  agent,
  app,
  db,
  getWorkspace,
  reconcileSessions,
  recordAudit,
}: WorkspaceRoutesOptions): void {
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
      const type = requestedSessionType(req.body?.type);
      const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : type;
      const permissionLevel = type === "codex" ? requestedCodexPermissionLevel(req.body?.codexPermissionLevel) : undefined;
      const terminal = await agent.createTerminalSession({
        workspaceId: workspace.id,
        rootPath: workspace.rootPath,
        name,
        type,
        codexPermissionLevel: permissionLevel,
      });
      const session = db.createSession({
        workspaceId: workspace.id,
        name,
        type,
        tmuxName: terminal.tmuxName,
      });
      db.updateSessionStatus(session.id, "running");
      recordAudit("session.create", {
        sessionId: session.id,
        workspaceId: workspace.id,
        type,
        ...(permissionLevel ? { codexPermissionLevel: permissionLevel } : {}),
      });
      res.json({ session: db.getSession(session.id) ?? session });
    }),
  );

  app.delete(
    "/api/workspaces/:workspaceId/sessions/:sessionId",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const session = db.getSession(req.params.sessionId);
      if (!session || session.workspaceId !== workspace.id) throw httpError(404, "Session not found");

      if (await agent.terminalSessionExists(session.tmuxName)) await agent.killSession(session.tmuxName);
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
}

function requestedSessionType(value: unknown): SessionType {
  if (value === "bash" || value === "codex" || value === "claude") return value;
  return "bash";
}

function requestedCodexPermissionLevel(value: unknown): CodexPermissionLevel {
  if (value === undefined) return "workspace-write";
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  throw httpError(400, "Invalid Codex permission level");
}

function isFileConflict(error: unknown): boolean {
  return error instanceof Error && error.message === "File changed on disk";
}
