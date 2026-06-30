import { requestUrl } from 'obsidian';

export interface HttpContext {
  serverUrl: string;
  password: string;
  token?: string;
  tokenExpiry?: number; // unix ms
}

export interface DiffResult {
  push: string[];
  pull: string[];
  delete: string[];
}

async function ensureToken(ctx: HttpContext): Promise<string> {
  if (ctx.token && ctx.tokenExpiry && Date.now() < ctx.tokenExpiry - 60_000) {
    return ctx.token;
  }

  const res = await requestUrl({
    url: `${ctx.serverUrl}/auth/login`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ctx.password }),
    throw: false,
  });

  if (res.status !== 200) {
    throw new Error(`Auth failed: ${res.status}`);
  }

  const { token, expires_at } = res.json as { token: string; expires_at: string };
  ctx.token = token;
  ctx.tokenExpiry = new Date(expires_at).getTime();
  return token;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function syncManifest(
  ctx: HttpContext,
  files: Record<string, string>,
): Promise<DiffResult> {
  const token = await ensureToken(ctx);
  const res = await requestUrl({
    url: `${ctx.serverUrl}/sync/manifest`,
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
    throw: false,
  });

  if (res.status !== 200) throw new Error(`Manifest sync failed: ${res.status}`);
  return res.json as DiffResult;
}

export async function putFile(
  ctx: HttpContext,
  path: string,
  hash: string,
  content: ArrayBuffer,
): Promise<void> {
  const token = await ensureToken(ctx);
  const res = await requestUrl({
    url: `${ctx.serverUrl}/files/${encodeFilePath(path)}`,
    method: 'PUT',
    headers: { ...authHeader(token), 'X-File-Hash': hash },
    body: content,
    throw: false,
  });

  if (res.status !== 204) throw new Error(`PUT ${path} failed: ${res.status}`);
}

export async function getFile(ctx: HttpContext, path: string): Promise<ArrayBuffer> {
  const token = await ensureToken(ctx);
  const res = await requestUrl({
    url: `${ctx.serverUrl}/files/${encodeFilePath(path)}`,
    method: 'GET',
    headers: authHeader(token),
    throw: false,
  });

  if (res.status !== 200) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.arrayBuffer;
}

export async function deleteFile(ctx: HttpContext, path: string): Promise<void> {
  const token = await ensureToken(ctx);
  const res = await requestUrl({
    url: `${ctx.serverUrl}/files/${encodeFilePath(path)}`,
    method: 'DELETE',
    headers: authHeader(token),
    throw: false,
  });

  if (res.status !== 204) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export async function testConnection(ctx: HttpContext): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await requestUrl({
      url: `${ctx.serverUrl}/health`,
      method: 'GET',
      throw: false,
    });
    if (res.status !== 200) return { ok: false, error: `status ${res.status}` };
    await ensureToken(ctx);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// encoda cada segmento do path sem tocar em '/'
function encodeFilePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
