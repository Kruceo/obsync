import { Plugin, Notice, TAbstractFile, TFile } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS, SyncSettingTab } from './settings';
import { HttpContext, testConnection } from './http/client';
import { runSync, SyncResult } from './sync/engine';
import { detectLocalPlugins } from './plugins/detector';
import { fetchRegistry, RegistryEntry } from './plugins/registry';
import { pushPluginData, pullPluginList, pullPluginConfig } from './plugins/sync';
import { installPluginFromGitHub, installPluginConfig, enablePlugin } from './plugins/installer';
import { MissingPluginsModal } from './plugins/modal';

const DEBOUNCE_MS = 60_000; // 1 minuto

export default class SyncPlugin extends Plugin {
  settings: SyncSettings;
  autoSyncIntervalId: number | null = null;
  private registryCache: Map<string, RegistryEntry> | null = null;
  private syncing = false;
  private httpCtx: HttpContext | null = null;
  private dataWriteLock: Promise<void> = Promise.resolve();
  private debounceTimer: number | null = null;
  private pendingDeletes: Set<string> = new Set();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon('refresh-cw', 'Obsidian Sync', () => this.performSync());

    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => this.performSync(),
    });

    this.addSettingTab(new SyncSettingTab(this.app, this));

    const scheduleSync = () => {
      if (!this.settings.serverUrl || !this.settings.password) return;
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => {
        this.debounceTimer = null;
        this.performSync();
      }, DEBOUNCE_MS);
    };

    this.registerEvent(
      this.app.vault.on('create', (file: TAbstractFile) => {
        if (file instanceof TFile && !file.path.startsWith('.obsidian/')) scheduleSync();
      }),
    );

    this.registerEvent(
      this.app.vault.on('modify', (file: TAbstractFile) => {
        if (file instanceof TFile && !file.path.startsWith('.obsidian/')) scheduleSync();
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile) => {
        if (file instanceof TFile && !file.path.startsWith('.obsidian/')) scheduleSync();
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        if (file.path.startsWith('.obsidian/')) return;
        this.pendingDeletes.add(file.path);
        scheduleSync();
      }),
    );

    if (this.settings.autoSyncInterval > 0) {
      const intervalMs = this.settings.autoSyncInterval * 60 * 1000;
      this.autoSyncIntervalId = window.setInterval(() => this.performSync(), intervalMs);
      this.registerInterval(this.autoSyncIntervalId);
    }
  }

  onunload(): void {
    if (this.autoSyncIntervalId !== null) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
    this.httpCtx = null; // reseta contexto ao carregar settings
  }

  async saveSettings(): Promise<void> {
    const prev = this.dataWriteLock;
    let release!: () => void;
    this.dataWriteLock = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      await this.saveData(this.settings);
      this.httpCtx = null; // força re-login se credenciais mudaram
    } finally {
      release();
    }
  }

  private getHttpCtx(): HttpContext {
    if (!this.httpCtx) {
      this.httpCtx = {
        serverUrl: this.settings.serverUrl.replace(/\/$/, ''),
        password: this.settings.password,
      };
    }
    return this.httpCtx;
  }

  async testConnection(): Promise<void> {
    const result = await testConnection(this.getHttpCtx());
    if (result.ok) {
      new Notice('Sync: Conexão OK!');
    } else {
      new Notice('Sync: Falha — ' + result.error);
    }
  }

  async performSync(): Promise<SyncResult> {
    if (this.syncing) {
      new Notice('Sync: já em andamento');
      return { pushed: 0, pulled: 0, deleted: 0, errors: ['already in progress'] };
    }
    if (!this.settings.serverUrl || !this.settings.password) {
      new Notice('Sync: configure a URL do servidor e a senha primeiro.');
      return { pushed: 0, pulled: 0, deleted: 0, errors: ['not configured'] };
    }

    this.syncing = true;
    try {
      new Notice('Sync: iniciando...');
      const ctx = this.getHttpCtx();

      const deleted = [...this.pendingDeletes];
      const result = await runSync(ctx, this.app.vault, deleted);
      // limpa só após sync bem-sucedido
      deleted.forEach((p) => this.pendingDeletes.delete(p));

      if (this.settings.syncPluginList) {
        try {
          const localPlugins = await detectLocalPlugins(this.app.vault);
          await pushPluginData(ctx, localPlugins, this.app.vault, this.settings);

          const remotePlugins = await pullPluginList(ctx);
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
                    new Notice(`Sync: plugin ${id} não encontrado no registry`);
                    continue;
                  }
                  try {
                    await installPluginFromGitHub(this.app.vault, entry);
                    if (syncConfigs && this.settings.syncPluginConfigs) {
                      const configData = await pullPluginConfig(ctx, id);
                      if (configData) await installPluginConfig(this.app.vault, id, configData);
                    }
                    await enablePlugin(this.app, id);
                    new Notice(`Sync: plugin ${entry.name} instalado`);
                  } catch (err) {
                    new Notice(`Sync: erro ao instalar ${id}`);
                    console.error(`Sync: failed to install plugin ${id}`, err);
                  }
                }
              }).open();
            }
          }
        } catch (err) {
          result.errors.push(`plugin sync: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      new Notice(`Sync completo: ${result.pushed}↑ ${result.pulled}↓ ${result.deleted}🗑`);
      if (result.errors.length > 0) console.error('Sync errors', result.errors);

      return result;
    } finally {
      this.syncing = false;
    }
  }

  private async getRegistry(): Promise<Map<string, RegistryEntry>> {
    if (!this.registryCache) this.registryCache = await fetchRegistry();
    return this.registryCache;
  }
}
