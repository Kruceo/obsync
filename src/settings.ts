import {
  PluginSettingTab,
  Setting,
  Plugin,
} from 'obsidian';

/**
 * All configurable fields for the S3 Sync plugin.
 */
export interface S3SyncSettings {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  prefix: string;
  deviceName: string;
  autoSyncInterval: number;
  syncPluginList: boolean;
  syncPluginConfigs: boolean;
}

export const DEFAULT_SETTINGS: S3SyncSettings = {
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  forcePathStyle: true,
  prefix: '',
  deviceName: '',
  autoSyncInterval: 0,
  syncPluginList: true,
  syncPluginConfigs: true,
};

/**
 * Minimal host interface so the settings tab can talk to the plugin
 * without creating a circular dependency on the concrete plugin class.
 */
export interface S3SyncPluginHost {
  settings: S3SyncSettings;
  saveSettings(): Promise<void>;
  testConnection(): Promise<void>;
}

export class S3SyncSettingTab extends PluginSettingTab {
  plugin: S3SyncPluginHost;

  constructor(app: any, plugin: Plugin & S3SyncPluginHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'S3 Sync + Plugins — Settings' });

    new Setting(containerEl)
      .setName('Endpoint')
      .setDesc('S3-compatible endpoint URL, e.g. http://minio.local:9000')
      .addText((text) =>
        text
          .setPlaceholder('https://s3.amazonaws.com')
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.endpoint = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Region')
      .setDesc('AWS/S3 region (e.g. us-east-1).')
      .addText((text) =>
        text
          .setPlaceholder('us-east-1')
          .setValue(this.plugin.settings.region)
          .onChange(async (value) => {
            this.plugin.settings.region = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Access Key ID')
      .setDesc('Access key for the S3-compatible service.')
      .addText((text) =>
        text
          .setPlaceholder('minioadmin')
          .setValue(this.plugin.settings.accessKeyId)
          .onChange(async (value) => {
            this.plugin.settings.accessKeyId = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Secret Access Key')
      .setDesc('Secret key for the S3-compatible service. ⚠️ Stored in plaintext in the vault\'s data.json — do not sync this file to public repositories.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('minioadmin')
          .setValue(this.plugin.settings.secretAccessKey)
          .onChange(async (value) => {
            this.plugin.settings.secretAccessKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Bucket')
      .setDesc('Name of the bucket to sync into.')
      .addText((text) =>
        text
          .setPlaceholder('my-obsidian-vault')
          .setValue(this.plugin.settings.bucket)
          .onChange(async (value) => {
            this.plugin.settings.bucket = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Force path-style addressing')
      .setDesc('Required for MinIO and many self-hosted S3 services.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.forcePathStyle)
          .onChange(async (value) => {
            this.plugin.settings.forcePathStyle = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Prefix')
      .setDesc('Optional folder/prefix inside the bucket.')
      .addText((text) =>
        text
          .setPlaceholder('vault-backup')
          .setValue(this.plugin.settings.prefix)
          .onChange(async (value) => {
            this.plugin.settings.prefix = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Device name')
      .setDesc('Identifier for this device used in conflict resolution.')
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
      .setName('Auto-sync interval (minutes)')
      .setDesc('0 disables automatic sync.')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.autoSyncInterval))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.autoSyncInterval = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync community plugin list')
      .setDesc('Upload/download the enabled community plugin list.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncPluginList)
          .onChange(async (value) => {
            this.plugin.settings.syncPluginList = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync plugin configs')
      .setDesc('Upload/download community plugin configuration files.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncPluginConfigs)
          .onChange(async (value) => {
            this.plugin.settings.syncPluginConfigs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Connection test')
      .setDesc('Verify the configured credentials and endpoint.')
      .addButton((button) =>
        button
          .setButtonText('Testar conexão')
          .setCta()
          .onClick(async () => {
            await this.plugin.testConnection();
          }),
      );
  }
}
