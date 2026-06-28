import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = env.ALLOWED_HOSTS
    ? env.ALLOWED_HOSTS.split(",").map((h) => h.trim())
    : [];

  return {
    plugins: [react()],
    root: "src/client",
    server: {
      allowedHosts
    },
    build: {
      outDir: "../../dist/client",
      emptyOutDir: true
    },
    test: {
      environment: "node",
      include: ["../../tests/**/*.test.ts"]
    }
  };
});
