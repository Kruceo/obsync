import { S3Context, getObject, putObject, deleteObject } from '../s3/client';
import { Plugin, Vault, TFile, Notice, normalizePath } from 'obsidian';
import { S3SyncSettings } from '../settings';
import { SyncState, FileState, saveState } from './state';
import { hashContent } from './hash';

export interface SyncContext {
  s3Ctx: S3Context;
  vault: Vault;
  plugin: Plugin;
  settings: S3SyncSettings;
  state: SyncState;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

/** Formato do manifesto remoto em `<prefix>/_s3sync/manifest.json` */
interface RemoteManifest {
  version: number;
  updatedAt: number;
  files: Record<string, FileState | { deleted: true; deletedAt: number }>;
}

type RemoteEntry = FileState | { deleted: true; deletedAt: number } | undefined;

function isDeleted(entry: RemoteEntry): entry is { deleted: true; deletedAt: number } {
  return !!entry && 'deleted' in entry && entry.deleted === true;
}

function isFileState(entry: RemoteEntry): entry is FileState {
  return !!entry && 'hash' in entry;
}

/**
 * Semáforo simples para limitar operações paralelas de I/O.
 */
class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

export async function runSync(ctx: SyncContext): Promise<SyncResult> {
  const result: SyncResult = {
    pushed: 0,
    pulled: 0,
    deleted: 0,
    conflicts: 0,
    errors: [],
  };

  const semaphore = new Semaphore(5);

  const runWithSemaphore = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    await semaphore.acquire();
    try {
      return await fn();
    } finally {
      semaphore.release();
    }
  };

  // 1. Obter arquivos locais
  const localFiles: Record<string, FileState> = {};
  const files = ctx.vault.getFiles();
  for (const file of files) {
    if (file.path.startsWith('.obsidian/')) continue;
    try {
      const content = await ctx.vault.readBinary(file);
      const hash = await hashContent(content);
      localFiles[file.path] = {
        hash,
        mtime: file.stat.mtime,
        size: file.stat.size,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Local scan ${file.path}: ${message}`);
    }
  }

  // 2. Obter manifesto remoto
  let remoteManifest: RemoteManifest = { version: 1, updatedAt: 0, files: {} };
  try {
    const remoteData = await getObject(ctx.s3Ctx, '_s3sync/manifest.json');
    remoteManifest = JSON.parse(new TextDecoder().decode(remoteData));
    if (!remoteManifest.files) remoteManifest.files = {};
  } catch (err) {
    const errName = (err as any)?.name ?? '';
    const errMessage = err instanceof Error ? err.message : String(err);
    const isMissing =
      errName === 'NoSuchKey' ||
      errName === 'NotFound' ||
      errMessage.includes('404') ||
      errMessage.includes('Not Found') ||
      errMessage.includes('empty body');
    if (!isMissing) {
      result.errors.push(`Remote manifest: ${errMessage}`);
    }
  }

  const baseState = ctx.state;
  const newManifest: RemoteManifest = {
    version: 1,
    updatedAt: Date.now(),
    files: { ...remoteManifest.files },
  };
  const newState: SyncState = {
    version: 1,
    updatedAt: Date.now(),
    files: { ...baseState.files },
  };

  const allPaths = new Set([
    ...Object.keys(localFiles),
    ...Object.keys(remoteManifest.files),
    ...Object.keys(baseState.files),
  ]);

  const tasks: Promise<void>[] = [];

  for (const path of allPaths) {
    const local = localFiles[path];
    const remote: RemoteEntry = remoteManifest.files[path];
    const base: FileState | undefined = baseState.files[path];

    const localChanged = !base || !local || local.hash !== base.hash;
    const remoteChanged = !base || !isFileState(remote) || remote.hash !== base.hash;

    // Caso 1: path inexistente em todos os lados — ignora
    if (!local && !isFileState(remote) && !base) continue;

    // Caso 2: remoto é tombstone
    if (isDeleted(remote)) {
      if (base && !localChanged) {
        // DELETE LOCAL: remoto marcou deleção e local não mudou
        tasks.push(
          runWithSemaphore(async () => {
            try {
              await ctx.vault.adapter.remove(normalizePath(path));
              delete newState.files[path];
              delete newManifest.files[path];
              result.deleted++;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              result.errors.push(`Delete local ${path}: ${message}`);
            }
          }),
        );
      } else if (local) {
        // Local mudou enquanto remoto deletou → conflito (versão local vence, ressuscita)
        tasks.push(
          runWithSemaphore(async () => {
            try {
              const content = await ctx.vault.readBinary(ctx.vault.getAbstractFileByPath(path) as TFile);
              await putObject(ctx.s3Ctx, path, new Uint8Array(content));
              newManifest.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
              newState.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
              result.pushed++;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              result.errors.push(`Conflict resurrect ${path}: ${message}`);
            }
          }),
        );
      } else {
        // Both local and remote deleted — clean up state
        delete newState.files[path];
        delete newManifest.files[path];
      }
      continue;
    }

    // Caso 3: arquivo deletado localmente e remoto inalterado
    if (!local && base && !remoteChanged && isFileState(remote)) {
      tasks.push(
        runWithSemaphore(async () => {
          try {
            await deleteObject(ctx.s3Ctx, path);
            newManifest.files[path] = { deleted: true, deletedAt: Date.now() };
            delete newState.files[path];
            result.deleted++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Delete remote ${path}: ${message}`);
          }
        }),
      );
      continue;
    }

    // Caso 4: local mudou OU remoto simplesmente não existe (ex: troca de S3) → PUSH
    if (local && (localChanged || !remote) && !isDeleted(remote)) {
      tasks.push(
        runWithSemaphore(async () => {
          try {
            const file = ctx.vault.getAbstractFileByPath(path);
            const content = file instanceof TFile
              ? await ctx.vault.readBinary(file)
              : await ctx.vault.adapter.readBinary(normalizePath(path));
            await putObject(ctx.s3Ctx, path, new Uint8Array(content));
            newManifest.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
            newState.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
            result.pushed++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Push ${path}: ${message}`);
          }
        }),
      );
      continue;
    }

    // Caso 5: só remoto mudou → PULL
    if (isFileState(remote) && remoteChanged && (!localChanged || !local)) {
      tasks.push(
        runWithSemaphore(async () => {
          try {
            const content = await getObject(ctx.s3Ctx, path);
            const normalizedPath = normalizePath(path);
            const existing = ctx.vault.getAbstractFileByPath(normalizedPath);
            if (existing instanceof TFile) {
              await ctx.vault.modifyBinary(existing, content);
            } else {
              await ctx.vault.adapter.write(normalizedPath, content);
            }
            newManifest.files[path] = { hash: remote.hash, mtime: remote.mtime, size: remote.size };
            newState.files[path] = { hash: remote.hash, mtime: remote.mtime, size: remote.size };
            result.pulled++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Pull ${path}: ${message}`);
          }
        }),
      );
      continue;
    }

    // Caso 6: ambos mudaram → CONFLITO
    if (local && isFileState(remote) && localChanged && remoteChanged && local.hash !== remote.hash) {
      tasks.push(
        runWithSemaphore(async () => {
          try {
            const winnerIsLocal = local.mtime >= remote.mtime;
            const winner = winnerIsLocal ? local : remote;
            const loser = winnerIsLocal ? remote : local;
            const loserDevice = winnerIsLocal ? 'remote' : ctx.settings.deviceName || 'local';

            // Baixa versão perdedora para arquivo de conflito
            const loserContent = winnerIsLocal
              ? await getObject(ctx.s3Ctx, path)
              : new Uint8Array(await ctx.vault.readBinary(ctx.vault.getAbstractFileByPath(path) as TFile));

            const conflictExt = path.includes('.') ? path.split('.').pop() : '';
            const conflictNameBase = path.substring(0, conflictExt ? path.length - conflictExt.length - 1 : path.length);
            const timestamp = Date.now();
            const conflictPath = conflictExt
              ? `${conflictNameBase}.conflict-${loserDevice}-${timestamp}.${conflictExt}`
              : `${path}.conflict-${loserDevice}-${timestamp}`;

            await ctx.vault.adapter.write(normalizePath(conflictPath), loserContent);

            // Aplica versão vencedora
            const winnerContent = winnerIsLocal
              ? new Uint8Array(await ctx.vault.readBinary(ctx.vault.getAbstractFileByPath(path) as TFile))
              : await getObject(ctx.s3Ctx, path);

            const normalizedPath = normalizePath(path);
            const existing = ctx.vault.getAbstractFileByPath(normalizedPath);
            if (existing instanceof TFile) {
              await ctx.vault.modifyBinary(existing, winnerContent);
            } else {
              await ctx.vault.adapter.write(normalizedPath, winnerContent);
            }

            if (winnerIsLocal) {
              await putObject(ctx.s3Ctx, path, winnerContent);
            }

            newManifest.files[path] = { hash: winner.hash, mtime: winner.mtime, size: winner.size };
            newState.files[path] = { hash: winner.hash, mtime: winner.mtime, size: winner.size };
            result.conflicts++;

            new Notice(`S3 Sync: conflito resolvido em ${path}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Conflict ${path}: ${message}`);
          }
        }),
      );
      continue;
    }

    // Caso 7: nada mudou — mantém estado
    if (local && isFileState(remote) && !localChanged && !remoteChanged) {
      newState.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
    } else if (local && !isFileState(remote)) {
      newState.files[path] = { hash: local.hash, mtime: local.mtime, size: local.size };
    } else if (isFileState(remote) && !local) {
      newState.files[path] = { hash: remote.hash, mtime: remote.mtime, size: remote.size };
    }
  }

  await Promise.all(tasks);

  // 4. Escrever manifesto remoto atualizado
  try {
    const manifestPayload = new TextEncoder().encode(JSON.stringify(newManifest));
    await putObject(ctx.s3Ctx, '_s3sync/manifest.json', manifestPayload, 'application/json');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Write remote manifest: ${message}`);
  }

  // 5. Salvar estado base
  try {
    await saveState(ctx.plugin, newState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Save state: ${message}`);
  }

  return result;
}
