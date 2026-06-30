import { PluginSettingTab, Setting, Plugin } from 'obsidian';

export interface SyncSettings {
  serverUrl: string;
  password: string;
  deviceName: string;
  autoSyncInterval: number;
  syncPluginList: boolean;
  syncPluginConfigs: boolean;
}

export const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: '',
  password: '',
  deviceName: '',
  autoSyncInterval: 0,
  syncPluginList: true,
  syncPluginConfigs: true,
};

export interface SyncPluginHost {
  settings: SyncSettings;
  saveSettings(): Promise<void>;
  testConnection(): Promise<void>;
}

export class SyncSettingTab extends PluginSettingTab {
  plugin: SyncPluginHost;

  constructor(app: any, plugin: Plugin & SyncPluginHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'S3 Sync + Plugins — Settings' });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('URL do obsidian-sync-server, ex: http://localhost:8080')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:8080')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.replace(/\/$/, '');
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Password')
      .setDesc('Senha configurada no servidor (SYNC_PASSWORD).')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('••••••••')
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Device name')
      .setDesc('Identificador deste dispositivo (opcional, usado em logs).')
      .addText((text) =>
        text
          .setPlaceholder('macbook-pro')
          .setValue(this.plugin.settings.deviceName)
          .onChange(async (value) => {
            this.plugin.settings.deviceName = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-sync interval (minutos)')
      .setDesc('0 desativa o sync automático.')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.autoSyncInterval))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.autoSyncInterval =
              Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync lista de plugins')
      .setDesc('Envia/recebe a lista de plugins community habilitados.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncPluginList)
          .onChange(async (value) => {
            this.plugin.settings.syncPluginList = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync configs de plugins')
      .setDesc('Envia/recebe os arquivos data.json de cada plugin.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncPluginConfigs)
          .onChange(async (value) => {
            this.plugin.settings.syncPluginConfigs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Testar conexão')
      .setDesc('Verifica se o servidor está acessível e a senha está correta.')
      .addButton((button) =>
        button
          .setButtonText('Testar')
          .setCta()
          .onClick(async () => {
            await this.plugin.testConnection();
          }),
      );
  }
}
