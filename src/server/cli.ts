#!/usr/bin/env node
import { join } from "node:path";
import { createDatabase } from "./db.js";
import { lanAddress, parseServeArgs } from "./config.js";
import { createApp } from "./http/createApp.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "serve") {
    console.error("Usage: remote-dev serve [--host 127.0.0.1] [--port 3000] [--workspace .]");
    process.exit(1);
  }

  const config = parseServeArgs(args);
  const db = createDatabase(join(config.dataDir, "state.db"));
  const workspace = db.upsertWorkspace({ name: config.workspaceName, rootPath: config.workspacePath });
  const server = await createApp({ config, db });

  server.listen(config.port, config.host, () => {
    const localUrl = `http://localhost:${config.port}`;
    const lan = config.host === "0.0.0.0" ? lanAddress() : null;
    console.log("Remote Dev is running:");
    console.log(`Workspace: ${workspace.name} (${workspace.rootPath})`);
    console.log(`Local: ${localUrl}`);
    if (lan) console.log(`LAN:   http://${lan}:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
