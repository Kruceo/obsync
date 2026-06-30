import { Vault, normalizePath } from 'obsidian';

export interface LocalPluginInfo {
  id: string;
  name: string;
  version: string;
  repo?: string;
}

/** Lê community-plugins.json local e os manifests dos plugins instalados. */
export async function detectLocalPlugins(vault: Vault): Promise<LocalPluginInfo[]> {
  const result: LocalPluginInfo[] = [];

  let enabledIds: string[] = [];
  try {
    const raw = await vault.adapter.read(normalizePath('.obsidian/community-plugins.json'));
    enabledIds = JSON.parse(raw);
    if (!Array.isArray(enabledIds)) {
      enabledIds = [];
    }
  } catch (err) {
    // Se não existir ou estiver malformado, retorna array vazio.
    return result;
  }

  for (const id of enabledIds) {
    if (typeof id !== 'string') continue;
    try {
      const manifestPath = normalizePath(`.obsidian/plugins/${id}/manifest.json`);
      const manifestRaw = await vault.adapter.read(manifestPath);
      const manifest = JSON.parse(manifestRaw);

      result.push({
        id: manifest.id || id,
        name: manifest.name || id,
        version: manifest.version || '0.0.0',
        repo: manifest.repo,
      });
    } catch (err) {
      // Plugin habilitado mas sem manifest.json legível — ignora.
      console.warn(`S3 Sync: could not read manifest for plugin ${id}`, err);
    }
  }

  return result;
}
