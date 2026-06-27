import { S3Context, getObject, putObject } from '../s3/client';
import { S3SyncSettings } from '../settings';
import { LocalPluginInfo } from './detector';
import { Vault, normalizePath } from 'obsidian';

const PLUGINS_LIST_KEY = '_s3sync/plugins.json';
const CONFIG_PREFIX = '_s3sync/plugin-configs/';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function validatePluginId(id: string): boolean {
	return SAFE_ID_REGEX.test(id);
}

/** Sobe plugins.json + configs para S3. */
export async function pushPluginData(
  s3Ctx: S3Context,
  plugins: LocalPluginInfo[],
  vault: Vault,
  settings: S3SyncSettings,
): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(plugins));
  await putObject(s3Ctx, PLUGINS_LIST_KEY, payload, 'application/json');

  if (settings.syncPluginConfigs) {
    for (const plugin of plugins) {
      try {
        const configPath = normalizePath(`.obsidian/plugins/${plugin.id}/data.json`);
        const exists = await vault.adapter.exists(configPath);
        if (!exists) continue;

        const raw = await vault.adapter.read(configPath);
        const data = new TextEncoder().encode(raw);
        await putObject(s3Ctx, `${CONFIG_PREFIX}${plugin.id}.json`, data, 'application/json');
      } catch (err) {
        console.warn(`S3 Sync: failed to push config for ${plugin.id}`, err);
      }
    }
  }
}

/** Baixa plugins.json remoto. Retorna null se não existir. */
export async function pullPluginList(s3Ctx: S3Context): Promise<LocalPluginInfo[] | null> {
  try {
    const data = await getObject(s3Ctx, PLUGINS_LIST_KEY);
    const json = JSON.parse(new TextDecoder().decode(data));
    if (!Array.isArray(json)) return [];
    return json as LocalPluginInfo[];
  } catch (err) {
    const errName = (err as any)?.name ?? '';
    const errMessage = err instanceof Error ? err.message : String(err);
    const isMissing =
      errName === 'NoSuchKey' ||
      errName === 'NotFound' ||
      errMessage.includes('404') ||
      errMessage.includes('Not Found') ||
      errMessage.includes('empty body');
    if (!isMissing) {
      console.error('S3 Sync: failed to pull plugin list', err);
    }
    return null;
  }
}

/** Baixa config de um plugin do S3. Retorna null se não existir. */
export async function pullPluginConfig(s3Ctx: S3Context, pluginId: string): Promise<Uint8Array | null> {
  try {
    return await getObject(s3Ctx, `${CONFIG_PREFIX}${pluginId}.json`);
  } catch (err) {
    const errName = (err as any)?.name ?? '';
    const errMessage = err instanceof Error ? err.message : String(err);
    const isMissing =
      errName === 'NoSuchKey' ||
      errName === 'NotFound' ||
      errMessage.includes('404') ||
      errMessage.includes('Not Found') ||
      errMessage.includes('empty body');
    if (!isMissing) {
      console.error(`S3 Sync: failed to pull plugin config ${pluginId}`, err);
    }
    return null;
  }
}
