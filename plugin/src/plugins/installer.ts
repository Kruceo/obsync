import { Vault, normalizePath, requestUrl, App } from 'obsidian';
import { RegistryEntry } from './registry';

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function assertSafePluginId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe plugin id rejected: "${id}"`);
}

interface GitHubRelease {
  tag_name: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

function buildRawUrl(repo: string, branch: string, file: string): string {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
}

function buildApiLatestUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

const TEXT_FILES = new Set(['manifest.json', 'styles.css']);

export async function installPluginFromGitHub(vault: Vault, entry: RegistryEntry): Promise<void> {
  assertSafePluginId(entry.id);

  const pluginsDir = normalizePath('.obsidian/plugins');
  const pluginDir = normalizePath(`${pluginsDir}/${entry.id}`);

  for (const dir of [pluginsDir, pluginDir]) {
    try { await vault.adapter.mkdir(dir); } catch { /* já existe */ }
  }

  let release: GitHubRelease | null = null;
  try {
    const res = await requestUrl({
      url: buildApiLatestUrl(entry.repo),
      headers: { 'User-Agent': 'obsidian-s3-sync/1.0.0' },
    });
    release = res.json as GitHubRelease;
  } catch (err) {
    console.warn(`Sync: no GitHub release for ${entry.repo}, falling back to raw`, err);
  }

  const filesToInstall: { name: string; url: string }[] = [];

  if (release?.assets?.length) {
    for (const name of ['manifest.json', 'main.js', 'styles.css']) {
      const asset = release.assets.find((a) => a.name === name);
      if (asset) filesToInstall.push({ name, url: asset.browser_download_url });
    }
  }

  if (filesToInstall.length === 0) {
    const branch = release?.tag_name || 'master';
    for (const name of ['manifest.json', 'main.js', 'styles.css']) {
      filesToInstall.push({ name, url: buildRawUrl(entry.repo, branch, name) });
    }
  }

  for (const { name, url } of filesToInstall) {
    try {
      const res = await requestUrl({ url, headers: { 'User-Agent': 'obsidian-s3-sync/1.0.0' } });
      const dest = normalizePath(`${pluginDir}/${name}`);
      if (TEXT_FILES.has(name)) {
        await vault.adapter.write(dest, res.text);
      } else {
        await vault.adapter.writeBinary(dest, res.arrayBuffer);
      }
    } catch (err) {
      console.warn(`Sync: failed to download ${name} from ${url}`, err);
      if (name !== 'styles.css') throw new Error(`Failed to download ${name}: ${err}`);
    }
  }
}

export async function installPluginConfig(vault: Vault, pluginId: string, configData: ArrayBuffer): Promise<void> {
  assertSafePluginId(pluginId);
  const configPath = normalizePath(`.obsidian/plugins/${pluginId}/data.json`);
  try {
    await vault.adapter.write(configPath, new TextDecoder().decode(configData));
  } catch (err) {
    console.error(`Sync: failed to write plugin config ${pluginId}`, err);
    throw err;
  }
}

export async function enablePlugin(app: App, pluginId: string): Promise<void> {
  assertSafePluginId(pluginId);
  try {
    const plugins = (app as any).plugins;
    if (!plugins) throw new Error('Obsidian plugin API not available');
    if (typeof plugins.loadManifests === 'function') await plugins.loadManifests();
    if (typeof plugins.enablePluginAndSave === 'function') {
      await plugins.enablePluginAndSave(pluginId);
    } else if (typeof plugins.enablePlugin === 'function') {
      await plugins.enablePlugin(pluginId);
    } else {
      throw new Error('No enable plugin method available');
    }
  } catch (err) {
    console.error(`Sync: failed to enable plugin ${pluginId}`, err);
    throw err;
  }
}
