import type {
  FileReadResponse,
  FileResource,
  GitStatusResponse,
  PortPreview,
  Session,
  SessionType,
  Workspace,
} from "../shared/types.js";

type JsonValue = Record<string, unknown>;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof payload?.error === "string") return payload.error;
  }
  return `Request failed with ${response.status}`;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

function jsonBody(body: JsonValue): RequestInit {
  return {
    body: JSON.stringify(body),
  };
}

export const api = {
  async login(token: string): Promise<{ ok: true }> {
    return request<{ ok: true }>("/api/login", {
      method: "POST",
      ...jsonBody({ token }),
    });
  },

  async workspaces(): Promise<Workspace[]> {
    const response = await request<{ workspaces: Workspace[] }>("/api/workspaces");
    return response.workspaces;
  },

  async sessions(workspaceId: string): Promise<Session[]> {
    const response = await request<{ sessions: Session[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`);
    return response.sessions;
  },

  async createSession(workspaceId: string, type: SessionType, name: string): Promise<Session> {
    const response = await request<{ session: Session }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, {
      method: "POST",
      ...jsonBody({ type, name }),
    });
    return response.session;
  },

  async files(workspaceId: string, path = "."): Promise<FileResource[]> {
    const response = await request<{ files: FileResource[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files${query({ path })}`,
    );
    return response.files;
  },

  async readFile(workspaceId: string, path: string): Promise<FileReadResponse> {
    return request<FileReadResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/file${query({ path })}`);
  },

  async saveFile(
    workspaceId: string,
    path: string,
    content: string,
    expectedVersion: string,
  ): Promise<FileReadResponse> {
    return request<FileReadResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/file`, {
      method: "PUT",
      ...jsonBody({ path, content, expectedVersion }),
    });
  },

  async gitStatus(workspaceId: string): Promise<GitStatusResponse> {
    return request<GitStatusResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/git/status`);
  },

  async gitDiff(workspaceId: string, path: string): Promise<string> {
    return request<string>(`/api/workspaces/${encodeURIComponent(workspaceId)}/git/diff${query({ path })}`);
  },

  async createPreview(workspaceId: string, port: number): Promise<PortPreview> {
    const response = await request<{ preview: PortPreview }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/previews`, {
      method: "POST",
      ...jsonBody({ port }),
    });
    return response.preview;
  },
};
