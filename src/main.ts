import { Plugin, Notice, TFile, normalizePath } from 'obsidian';
import { S3SyncSettings, DEFAULT_SETTINGS, S3SyncSettingTab } from './settings';
import { S3Context, testConnection as testS3Connection } from './s3/client';
import { SyncState, loadState } from './sync/state';
import { runSync, SyncResult } from './sync/engine';
import { detectLocalPlugins, LocalPluginInfo } from './plugins/detector';
import { fetchRegistry, RegistryEntry } from './plugins/registry';
import { pushPluginData, pullPluginList, pullPluginConfig } from './plugins/sync';
import { installPluginFromGitHub, installPluginConfig, enablePlugin } from './plugins/installer';
import { MissingPluginsModal } from './plugins/modal';

export default class S3SyncPlugin extends Plugin {
  settings: S3SyncSettings;
  autoSyncIntervalId: number | null = null;
  private registryCache: Map<string, RegistryEntry> | null = null;
  private syncing = false;
  private dataWriteLock: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon('refresh-cw', 'S3 Sync', () => {
      this.performSync();
    });

    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => {
        this.performSync();
      },
    });

    this.addSettingTab(new S3SyncSettingTab(this.app, this));

    if (this.settings.autoSyncInterval && this.settings.autoSyncInterval > 0) {
      const intervalMs = this.settings.autoSyncInterval * 60 * 1000;
      this.autoSyncIntervalId = window.setInterval(() => {
        this.performSync();
      }, intervalMs);
      this.registerInterval(this.autoSyncIntervalId);
    }
  }

  onunload(): void {
    if (this.autoSyncIntervalId !== null) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
    }
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const { syncState, ...settings } = data || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
  }

  async saveSettings(): Promise<void> {
    const prev = this.dataWriteLock;
    let release!: () => void;
    this.dataWriteLock = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      const data = (await this.loadData()) || {};
      Object.assign(data, this.settings);
      await this.saveData(data);
    } finally {
      release();
    }
  }

  private buildS3Context(): S3Context {
    return {
      endpoint: this.settings.endpoint,
      region: this.settings.region,
      accessKeyId: this.settings.accessKeyId,
      secretAccessKey: this.settings.secretAccessKey,
      bucket: this.settings.bucket,
      forcePathStyle: this.settings.forcePathStyle,
      prefix: this.settings.prefix,
    };
  }

  async testConnection(): Promise<void> {
    const s3Ctx = this.buildS3Context();
    try {
      const result = await testS3Connection(s3Ctx);
      if (result.ok) {
        new Notice('S3 Sync: Conexão OK!');
      } else {
        new Notice('S3 Sync: Falha na conexão — ' + result.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice('S3 Sync: Falha na conexão — ' + message);
    }
  }

  async performSync(): Promise<SyncResult> {
    if (this.syncing) {
      new Notice('S3 Sync: sincronização já em andamento');
      return { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, errors: ['Sync already in progress'] };
    }
    this.syncing = true;
    try {
      new Notice('S3 Sync: Iniciando sincronização...');

      const s3Ctx = this.buildS3Context();
      let result: SyncResult = {
        pushed: 0,
        pulled: 0,
        deleted: 0,
        conflicts: 0,
        errors: [],
      };

      try {
        const state: SyncState = await loadState(this);
        result = await runSync({
          s3Ctx,
          vault: this.app.vault,
          plugin: this,
          settings: this.settings,
          state,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Sync engine: ${message}`);
        console.error('S3 Sync: sync engine error', err);
      }

      if (this.settings.syncPluginList) {
      try {
        const localPlugins = await detectLocalPlugins(this.app.vault);
        await pushPluginData(s3Ctx, localPlugins, this.app.vault, this.settings);

        const remotePlugins = await pullPluginList(s3Ctx);
        if (remotePlugins) {
          const localIds = new Set(localPlugins.map((p) => p.id));
          const missing = remotePlugins.filter((p) => !localIds.has(p.id));

          if (missing.length > 0) {
            const registry = await this.getRegistry();

            new MissingPluginsModal(this.app, missing, async (selectedIds, syncConfigs) => {
              for (const id of selectedIds) {
                const remoteInfo = remotePlugins.find((p) => p.id === id);
                if (!remoteInfo) continue;

                const entry = registry.get(id);
                if (!entry) {
                  console.warn(`S3 Sync: plugin ${id} not found in community registry`);
                  new Notice(`S3 Sync: plugin ${id} não encontrado no registry`);
                  continue;
                }

                try {
                  await installPluginFromGitHub(this.app.vault, entry);

                  if (syncConfigs && this.settings.syncPluginConfigs) {
                    const configData = await pullPluginConfig(s3Ctx, id);
                    if (configData) {
                      await installPluginConfig(this.app.vault, id, configData);
                    }
                  }

                  await enablePlugin(this.app, id);
                  new Notice(`S3 Sync: plugin ${entry.name} instalado`);
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  result.errors.push(`Install plugin ${id}: ${message}`);
                  new Notice(`S3 Sync: erro ao instalar ${id}`);
                  console.error(`S3 Sync: failed to install plugin ${id}`, err);
                }
              }
            }).open();
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Plugin sync: ${message}`);
        console.error('S3 Sync: plugin sync error', err);
      }
    }

    new Notice(
      `Sync completo: ${result.pushed}↑ ${result.pulled}↓ ${result.conflicts}⚡ ${result.deleted}🗑`,
    );

    if (result.errors.length > 0) {
      console.error('S3 Sync: errors during sync', result.errors);
    }

    return result;
    } finally {
      this.syncing = false;
    }
  }

  private async getRegistry(): Promise<Map<string, RegistryEntry>> {
    if (!this.registryCache) {
      this.registryCache = await fetchRegistry();
    }
    return this.registryCache;
  }
}
