import { Vault, normalizePath, requestUrl, App } from 'obsidian';
import { RegistryEntry } from './registry';

interface GitHubRelease {
  tag_name: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

function buildRawUrl(repo: string, branch: string, file: string): string {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
}

function buildApiLatestUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

/**
 * Baixa manifest.json, main.js, styles.css do latest release e instala em .obsidian/plugins/<id>/.
 */
export async function installPluginFromGitHub(vault: Vault, entry: RegistryEntry): Promise<void> {
  const pluginDir = normalizePath(`.obsidian/plugins/${entry.id}`);

  try {
    await vault.adapter.mkdir(normalizePath(`.obsidian/plugins`));
  } catch {
    // diretório provavelmente já existe
  }

  try {
    await vault.adapter.mkdir(pluginDir);
  } catch {
    // diretório provavelmente já existe
  }

  let release: GitHubRelease | null = null;
  try {
    const response = await requestUrl({
      url: buildApiLatestUrl(entry.repo),
      headers: {
        'User-Agent': 'obsidian-s3-sync/1.0.0',
      },
    });
    release = response.json as GitHubRelease;
  } catch (err) {
    console.warn(`S3 Sync: no GitHub release for ${entry.repo}, falling back to raw files`, err);
  }

  const filesToInstall: { name: string; url: string }[] = [];

  if (release && release.assets && release.assets.length > 0) {
    const assetNames = ['manifest.json', 'main.js', 'styles.css'];
    for (const name of assetNames) {
      const asset = release.assets.find((a) => a.name === name);
      if (asset) {
        filesToInstall.push({ name, url: asset.browser_download_url });
      }
    }
  }

  // Fallback: raw GitHub (master)
  if (filesToInstall.length === 0) {
    const branch = release?.tag_name || 'master';
    const names = ['manifest.json', 'main.js', 'styles.css'];
    for (const name of names) {
      filesToInstall.push({ name, url: buildRawUrl(entry.repo, branch, name) });
    }
  }

  for (const { name, url } of filesToInstall) {
    try {
      const response = await requestUrl({
        url,
        headers: {
          'User-Agent': 'obsidian-s3-sync/1.0.0',
        },
      });
      const content = response.arrayBuffer
        ? new Uint8Array(response.arrayBuffer)
        : new TextEncoder().encode(response.text);
      await vault.adapter.write(normalizePath(`${pluginDir}/${name}`), content);
    } catch (err) {
      console.warn(`S3 Sync: failed to download ${name} from ${url}`, err);
      // styles.css é opcional; não falhar tudo por causa disso.
      if (name === 'manifest.json' || name === 'main.js') {
        throw new Error(`Failed to download required plugin file ${name}: ${err}`);
      }
    }
  }
}

/** Grava data.json (config) para um plugin. */
export async function installPluginConfig(vault: Vault, pluginId: string, configData: ArrayBuffer): Promise<void> {
  const configPath = normalizePath(`.obsidian/plugins/${pluginId}/data.json`);
  try {
    await vault.adapter.write(configPath, new Uint8Array(configData));
  } catch (err) {
    console.error(`S3 Sync: failed to write plugin config ${pluginId}`, err);
    throw err;
  }
}

/** Habilita plugin via API privada do Obsidian. */
export async function enablePlugin(app: App, pluginId: string): Promise<void> {
  try {
    const plugins = (app as any).plugins;
    if (!plugins) {
      throw new Error('Obsidian plugin API not available');
    }

    if (typeof plugins.loadManifests === 'function') {
      await plugins.loadManifests();
    }

    if (typeof plugins.enablePluginAndSave === 'function') {
      await plugins.enablePluginAndSave(pluginId);
    } else if (typeof plugins.enablePlugin === 'function') {
      await plugins.enablePlugin(pluginId);
    } else {
      throw new Error('No enable plugin method available');
    }
  } catch (err) {
    console.error(`S3 Sync: failed to enable plugin ${pluginId}`, err);
    throw err;
  }
}
