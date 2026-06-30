import { App, Modal, Setting } from 'obsidian';
import { LocalPluginInfo } from './detector';

export class MissingPluginsModal extends Modal {
  private selectedIds: Set<string> = new Set();
  private syncConfigs = true;

  constructor(
    app: App,
    private missing: LocalPluginInfo[],
    private onConfirm: (selectedIds: string[], syncConfigs: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Plugins faltando neste dispositivo' });

    contentEl.createEl('p', {
      text: 'Selecione os plugins community que deseja instalar deste vault remoto:',
    });

    const listEl = contentEl.createEl('div');
    listEl.style.display = 'flex';
    listEl.style.flexDirection = 'column';
    listEl.style.gap = '8px';
    listEl.style.marginBottom = '16px';

    for (const plugin of this.missing) {
      const row = listEl.createEl('label');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';

      const checkbox = row.createEl('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      this.selectedIds.add(plugin.id);

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedIds.add(plugin.id);
        } else {
          this.selectedIds.delete(plugin.id);
        }
      });

      row.appendText(`${plugin.name} (${plugin.id})`);
    }

    new Setting(contentEl)
      .setName('Sincronizar configurações (data.json) destes plugins')
      .addToggle((toggle) =>
        toggle.setValue(this.syncConfigs).onChange((value) => {
          this.syncConfigs = value;
        }),
      );

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText('Instalar selecionados')
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm(Array.from(this.selectedIds), this.syncConfigs);
          }),
      )
      .addButton((button) =>
        button.setButtonText('Cancelar').onClick(() => {
          this.close();
          this.onConfirm([], false);
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
