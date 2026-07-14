import type { Express } from "express";
import type { Workspace } from "../../shared/types.js";
import type { AgentGateway } from "../agent/AgentGateway.js";
import { asyncHandler, type RecordAudit } from "./routeUtils.js";

interface GitRoutesOptions {
  agent: AgentGateway;
  app: Express;
  getWorkspace: (workspaceId: string) => Workspace;
  recordAudit: RecordAudit;
}

export function registerGitRoutes({ agent, app, getWorkspace, recordAudit }: GitRoutesOptions): void {
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
    "/api/workspaces/:workspaceId/git/history",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
      const history = await agent.gitHistory(workspace.rootPath, branch);
      recordAudit("git.history", { workspaceId: workspace.id, branch: history.branch });
      res.json(history);
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/branches",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const branches = await agent.gitBranches(workspace.rootPath);
      recordAudit("git.branches", { workspaceId: workspace.id });
      res.json(branches);
    }),
  );

  app.post(
    "/api/workspaces/:workspaceId/git/branches/switch",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const branch = req.body?.branch;
      if (typeof branch !== "string" || !branch) {
        res.status(400).json({ error: "branch is required" });
        return;
      }
      await agent.gitSwitchBranch(workspace.rootPath, branch);
      recordAudit("git.branch_switch", { workspaceId: workspace.id, branch });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/workspaces/:workspaceId/git/stage",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const { path, staged } = req.body ?? {};
      if (typeof path !== "string" || !path.trim() || typeof staged !== "boolean") {
        res.status(400).json({ error: "path and staged are required" });
        return;
      }
      await agent.gitSetFileStaged(workspace.rootPath, path, staged);
      recordAudit(staged ? "git.stage" : "git.unstage", { workspaceId: workspace.id, path });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/workspaces/:workspaceId/git/commit-files",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const commit = typeof req.query.commit === "string" ? req.query.commit : "";
      if (!commit) {
        res.status(400).json({ error: "commit is required" });
        return;
      }
      const files = await agent.gitCommitFiles(workspace.rootPath, commit);
      recordAudit("git.commit_files", { workspaceId: workspace.id, commit: files.commitId });
      res.json(files);
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
      const commit = typeof req.query.commit === "string" ? req.query.commit : "";
      const diff = commit
        ? await agent.gitCommitFileDiff(workspace.rootPath, commit, path)
        : await agent.gitFileDiff(workspace.rootPath, path);
      recordAudit("git.file_diff", { workspaceId: workspace.id, path, commit: commit || null });
      res.json(diff);
    }),
  );
}
