import { Vault, TFile, normalizePath } from 'obsidian';
import { HttpContext, syncManifest, putFile, getFile, deleteFile } from '../http/client';
import { hashContent } from './hash';

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  errors: string[];
}

export async function runSync(ctx: HttpContext, vault: Vault): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, errors: [] };

  // 1. Monta manifesto local: path → hash
  const localFiles = vault.getFiles().filter((f) => !f.path.startsWith('.obsidian/'));
  const manifest: Record<string, string> = {};

  await Promise.all(
    localFiles.map(async (file) => {
      try {
        const content = await vault.readBinary(file);
        manifest[file.path] = await hashContent(content);
      } catch (err) {
        result.errors.push(`hash ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  // 2. Envia manifesto, recebe diff
  let diff: { push: string[]; pull: string[]; delete: string[] };
  try {
    diff = await syncManifest(ctx, manifest);
  } catch (err) {
    result.errors.push(`manifest: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const sem = new Semaphore(5);

  // 3. PUSH — envia arquivos que o servidor não tem ou estão desatualizados
  await Promise.all(
    diff.push.map((path) =>
      sem.run(async () => {
        try {
          const file = vault.getAbstractFileByPath(path);
          const content =
            file instanceof TFile
              ? await vault.readBinary(file)
              : await vault.adapter.readBinary(normalizePath(path));
          await putFile(ctx, path, manifest[path], content);
          result.pushed++;
        } catch (err) {
          result.errors.push(`push ${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  // 4. PULL — baixa arquivos que o servidor tem e o cliente não (ou divergem)
  await Promise.all(
    diff.pull.map((path) =>
      sem.run(async () => {
        try {
          const content = await getFile(ctx, path);
          const normalized = normalizePath(path);
          const existing = vault.getAbstractFileByPath(normalized);
          if (existing instanceof TFile) {
            await vault.modifyBinary(existing, content);
          } else {
            const dir = normalized.includes('/')
              ? normalized.substring(0, normalized.lastIndexOf('/'))
              : '';
            if (dir) await vault.adapter.mkdir(dir);
            await vault.adapter.writeBinary(normalized, content);
          }
          result.pulled++;
        } catch (err) {
          result.errors.push(`pull ${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  // 5. DELETE — remove localmente arquivos que o servidor não tem mais
  await Promise.all(
    diff.delete.map((path) =>
      sem.run(async () => {
        try {
          await vault.adapter.remove(normalizePath(path));
          result.deleted++;
        } catch (err) {
          result.errors.push(`delete ${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  return result;
}

class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}
