import { requestUrl } from 'obsidian';

export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  repo: string; // formato "owner/repo"
}

/** Busca community-plugins.json oficial do obsidian-releases. */
export async function fetchRegistry(): Promise<Map<string, RegistryEntry>> {
  const registry = new Map<string, RegistryEntry>();

  try {
    const response = await requestUrl({
      url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
    });

    const entries: Array<{ id?: string; name?: string; author?: string; repo?: string }> = response.json;

    for (const entry of entries) {
      if (!entry.id || !entry.repo) continue;
      registry.set(entry.id, {
        id: entry.id,
        name: entry.name || entry.id,
        author: entry.author || 'unknown',
        repo: entry.repo,
      });
    }
  } catch (err) {
    console.error('S3 Sync: failed to fetch community plugin registry', err);
    throw err;
  }

  return registry;
}
