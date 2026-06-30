import { HttpContext, putFile, getFile } from '../http/client';
import { SyncSettings } from '../settings';
import { LocalPluginInfo } from './detector';
import { Vault, normalizePath } from 'obsidian';

const PLUGINS_LIST_PATH = '_obsync/plugins.json';
const CONFIG_PREFIX = '_obsync/configs/';
const DUMMY_HASH = 'dynamic';

/** Sobe plugins.json + configs para o servidor. */
export async function pushPluginData(
  ctx: HttpContext,
  plugins: LocalPluginInfo[],
  vault: Vault,
  settings: SyncSettings,
): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(plugins));
  await putFile(ctx, PLUGINS_LIST_PATH, DUMMY_HASH, payload.buffer as ArrayBuffer);

  if (settings.syncPluginConfigs) {
    for (const plugin of plugins) {
      try {
        const configPath = normalizePath(`.obsidian/plugins/${plugin.id}/data.json`);
        if (!(await vault.adapter.exists(configPath))) continue;
        const raw = await vault.adapter.read(configPath);
        const data = new TextEncoder().encode(raw);
        await putFile(ctx, `${CONFIG_PREFIX}${plugin.id}.json`, DUMMY_HASH, data.buffer as ArrayBuffer);
      } catch (err) {
        console.warn(`Sync: failed to push config for ${plugin.id}`, err);
      }
    }
  }
}

/** Baixa plugins.json do servidor. Retorna null se não existir. */
export async function pullPluginList(ctx: HttpContext): Promise<LocalPluginInfo[] | null> {
  try {
    const data = await getFile(ctx, PLUGINS_LIST_PATH);
    const json = JSON.parse(new TextDecoder().decode(data));
    return Array.isArray(json) ? (json as LocalPluginInfo[]) : [];
  } catch {
    return null;
  }
}

/** Baixa config de um plugin. Retorna null se não existir. */
export async function pullPluginConfig(ctx: HttpContext, pluginId: string): Promise<ArrayBuffer | null> {
  try {
    return await getFile(ctx, `${CONFIG_PREFIX}${pluginId}.json`);
  } catch {
    return null;
  }
}
