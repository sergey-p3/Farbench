import type { NextFunction, Request, Response } from "express";
import type { MetadataDb } from "../db.js";
import type { Workspace } from "../../shared/types.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export type RecordAudit = (
  type: string,
  metadata: Record<string, string | number | boolean | null>,
) => void;

export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

export function createWorkspaceLookup(db: MetadataDb): (workspaceId: string) => Workspace {
  return (workspaceId) => {
    const workspace = db.listWorkspaces().find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw httpError(404, "Workspace not found");
    return workspace;
  };
}
