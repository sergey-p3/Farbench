import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { Express, RequestHandler } from "express";
import type { PortPreview, Workspace } from "../../shared/types.js";
import type { AgentGateway } from "../agent/AgentGateway.js";
import { asyncHandler, httpError, type RecordAudit } from "./routeUtils.js";

interface PreviewRoutesOptions {
  agent: AgentGateway;
  app: Express;
  getWorkspace: (workspaceId: string) => Workspace;
  recordAudit: RecordAudit;
  requireAuth: RequestHandler;
}

export function registerPreviewRoutes({
  agent,
  app,
  getWorkspace,
  recordAudit,
  requireAuth,
}: PreviewRoutesOptions): void {
  const previews = new Map<string, PortPreview>();

  app.post(
    "/api/workspaces/:workspaceId/previews",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const port = requestedPort(req.body?.port);
      const preview = await agent.createPreview(workspace.id, port);
      previews.set(preview.id, preview);
      recordAudit("preview.create", { workspaceId: workspace.id, previewId: preview.id, port });
      res.json({ preview });
    }),
  );

  app.use("/preview/:previewId", requireAuth, (req, res, next) => {
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
        headers: proxyRequestHeaders(req.headers, preview.port),
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
}

function requestedPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw httpError(400, "Port must be an integer from 1 to 65535");
  }
  return value;
}

function proxyRequestHeaders(headers: IncomingHttpHeaders, port: number): IncomingHttpHeaders {
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
  const location = nextHeaders.location;
  if (typeof location === "string") nextHeaders.location = rewritePreviewPath(location, prefix);
  return nextHeaders;
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
