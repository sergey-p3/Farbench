import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Session, SessionStatus, SessionType, Workspace } from "../shared/types.js";

interface WorkspaceInput {
  name: string;
  rootPath: string;
}

interface SessionInput {
  workspaceId: string;
  name: string;
  type: SessionType;
  tmuxName: string;
}

export interface MetadataDb {
  upsertWorkspace(input: WorkspaceInput): Workspace;
  listWorkspaces(): Workspace[];
  createSession(input: SessionInput): Session;
  updateSessionStatus(id: string, status: SessionStatus): void;
  touchSessionAttachment(id: string): void;
  listSessions(workspaceId: string): Session[];
  getSession(id: string): Session | null;
}

export function createDatabase(path: string): MetadataDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists workspaces (
      id text primary key,
      name text not null,
      root_path text not null unique,
      status text not null
    );
    create table if not exists sessions (
      id text primary key,
      workspace_id text not null,
      name text not null,
      type text not null,
      tmux_name text not null,
      status text not null,
      created_at text not null,
      last_attached_at text,
      last_activity_at text,
      ended_at text,
      foreign key(workspace_id) references workspaces(id)
    );
  `);

  const mapWorkspace = (row: any): Workspace => ({
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    status: row.status
  });

  const mapSession = (row: any): Session => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    tmuxName: row.tmux_name,
    status: row.status,
    createdAt: row.created_at,
    lastAttachedAt: row.last_attached_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at
  });

  return {
    upsertWorkspace(input) {
      const existing = db.prepare("select * from workspaces where root_path = ?").get(input.rootPath) as any;
      if (existing) return mapWorkspace(existing);
      const id = nanoid();
      db.prepare("insert into workspaces (id, name, root_path, status) values (?, ?, ?, 'available')")
        .run(id, input.name, input.rootPath);
      return mapWorkspace(db.prepare("select * from workspaces where id = ?").get(id));
    },
    listWorkspaces() {
      return db.prepare("select * from workspaces order by name").all().map(mapWorkspace);
    },
    createSession(input) {
      const id = nanoid();
      const now = new Date().toISOString();
      db.prepare(`
        insert into sessions (id, workspace_id, name, type, tmux_name, status, created_at)
        values (?, ?, ?, ?, ?, 'starting', ?)
      `).run(id, input.workspaceId, input.name, input.type, input.tmuxName, now);
      return mapSession(db.prepare("select * from sessions where id = ?").get(id));
    },
    updateSessionStatus(id, status) {
      const endedAt = ["exited", "crashed", "killed"].includes(status) ? new Date().toISOString() : null;
      db.prepare("update sessions set status = ?, ended_at = coalesce(?, ended_at), last_activity_at = ? where id = ?")
        .run(status, endedAt, new Date().toISOString(), id);
    },
    touchSessionAttachment(id) {
      db.prepare(`
        update sessions set last_attached_at = ?, status = 'running'
        where id = ? and status not in ('exited', 'crashed', 'killed')
      `)
        .run(new Date().toISOString(), id);
    },
    listSessions(workspaceId) {
      return db.prepare("select * from sessions where workspace_id = ? order by created_at desc")
        .all(workspaceId)
        .map(mapSession);
    },
    getSession(id) {
      const row = db.prepare("select * from sessions where id = ?").get(id);
      return row ? mapSession(row) : null;
    }
  };
}
