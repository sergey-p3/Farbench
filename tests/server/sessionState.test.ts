import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("metadata database", () => {
  it("stores active and closed sessions for reconnect/history views", () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-db-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "Codex", type: "codex", tmuxName: "rd_demo" });

    db.updateSessionStatus(session.id, "running");
    db.updateSessionStatus(session.id, "exited");

    const history = db.listSessions(workspace.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("exited");
    expect(history[0]?.endedAt).not.toBeNull();
  });
});
