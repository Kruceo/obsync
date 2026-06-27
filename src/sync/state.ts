import { Plugin } from 'obsidian';

let writeLock: Promise<void> = Promise.resolve();

export interface FileState {
  hash: string;
  mtime: number;
  size: number;
}

export interface SyncState {
  version: number;
  updatedAt: number;
  files: Record<string, FileState>;
}

const STATE_KEY = 'syncState';
const EMPTY_STATE: SyncState = {
  version: 1,
  updatedAt: 0,
  files: {},
};

/** Carrega estado do último sync via plugin.loadData(). Chave: `syncState`. */
export async function loadState(plugin: Plugin): Promise<SyncState> {
  try {
    const data = await plugin.loadData();
    if (!data || !data[STATE_KEY]) {
      return { ...EMPTY_STATE };
    }
    return {
      version: data[STATE_KEY].version ?? EMPTY_STATE.version,
      updatedAt: data[STATE_KEY].updatedAt ?? EMPTY_STATE.updatedAt,
      files: data[STATE_KEY].files ?? { ...EMPTY_STATE.files },
    };
  } catch (err) {
    console.error('S3 Sync: failed to load sync state', err);
    return { ...EMPTY_STATE };
  }
}

/** Salva estado reconciliado via plugin.saveData(). Serialize writes to avoid lost updates. */
export async function saveState(plugin: Plugin, state: SyncState): Promise<void> {
  const prev = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((resolve) => { release = resolve; });
  await prev;
  try {
    const data = (await plugin.loadData()) || {};
    data[STATE_KEY] = state;
    await plugin.saveData(data);
  } catch (err) {
    console.error('S3 Sync: failed to save sync state', err);
    throw err;
  } finally {
    release();
  }
}
