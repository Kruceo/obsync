import { HttpContext, putFile, getFile } from '../http/client';
import { SyncSettings } from '../settings';
import { LocalPluginInfo } from './detector';
import { Vault, normalizePath } from 'obsidian';
import { hashContent } from '../sync/hash';

const PLUGINS_LIST_PATH = '_obsync/plugins.json';
const CONFIG_PREFIX = '_obsync/configs/';
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// cache em memória: evita re-upload quando o conteúdo não mudou
const lastUploadedHash = new Map<string, string>();

function assertSafePluginId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe plugin id rejected: "${id}"`);
}

async function hashJson(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return hashContent(bytes.buffer as ArrayBuffer);
}

async function putIfChanged(ctx: HttpContext, path: string, data: Uint8Array): Promise<boolean> {
  const hash = await hashContent(data.buffer as ArrayBuffer);
  if (lastUploadedHash.get(path) === hash) return false;
  await putFile(ctx, path, hash, data.buffer as ArrayBuffer);
  lastUploadedHash.set(path, hash);
  return true;
}

export async function pushPluginData(
  ctx: HttpContext,
  plugins: LocalPluginInfo[],
  vault: Vault,
  settings: SyncSettings,
): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(plugins));
  await putIfChanged(ctx, PLUGINS_LIST_PATH, payload);

  if (settings.syncPluginConfigs) {
    for (const plugin of plugins) {
      try {
        assertSafePluginId(plugin.id);
        const configPath = normalizePath(`.obsidian/plugins/${plugin.id}/data.json`);
        if (!(await vault.adapter.exists(configPath))) continue;
        const raw = await vault.adapter.read(configPath);
        const data = new TextEncoder().encode(raw);
        await putIfChanged(ctx, `${CONFIG_PREFIX}${plugin.id}.json`, data);
      } catch (err) {
        console.warn(`Sync: failed to push config for ${plugin.id}`, err);
      }
    }
  }
}

export async function pullPluginList(ctx: HttpContext): Promise<LocalPluginInfo[] | null> {
  try {
    const data = await getFile(ctx, PLUGINS_LIST_PATH);
    const json = JSON.parse(new TextDecoder().decode(data));
    return Array.isArray(json) ? (json as LocalPluginInfo[]) : [];
  } catch {
    return null;
  }
}

export async function pullPluginConfig(ctx: HttpContext, pluginId: string): Promise<ArrayBuffer | null> {
  try {
    assertSafePluginId(pluginId);
    return await getFile(ctx, `${CONFIG_PREFIX}${pluginId}.json`);
  } catch {
    return null;
  }
}
