import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/**
 * Configuration context for an S3/MinIO client.
 */
export interface S3Context {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  prefix: string;
  client?: S3Client;
}

/**
 * Creates a configured S3Client for MinIO self-hosted usage.
 * Path-style addressing is forced so MinIO without DNS bucket names works
 * out of the box (e.g. `http://minio.local:9000/<bucket>/<key>`).
 * @deprecated Prefer {@link getClient} to reuse clients per context.
 */
export function createS3Client(ctx: S3Context): S3Client {
  return new S3Client({
    endpoint: ctx.endpoint,
    region: ctx.region,
    credentials: {
      accessKeyId: ctx.accessKeyId,
      secretAccessKey: ctx.secretAccessKey,
    },
    forcePathStyle: ctx.forcePathStyle,
  });
}

/**
 * Returns a cached S3Client for the given context, creating one lazily and
 * storing it on the context object so subsequent operations reuse it.
 */
export function getClient(ctx: S3Context): S3Client {
  if (!ctx.client) {
    ctx.client = createS3Client(ctx);
  }
  return ctx.client;
}

/**
 * Joins the configured prefix with the given relative key.
 * When `prefix` is empty the key is returned as-is.
 */
function buildKey(prefix: string, key: string): string {
  if (!prefix) return key;
  return `${prefix}/${key}`;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
}

/**
 * Lists objects under the given (sub-)prefix, following pagination via
 * `NextContinuationToken` until the bucket is fully traversed.
 */
export async function listObjects(
  ctx: S3Context,
  prefix?: string,
): Promise<ListedObject[]> {
  const client = createS3Client(ctx);
  const fullPrefix =
    prefix !== undefined ? buildKey(ctx.prefix, prefix) : ctx.prefix;

  const results: ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: ctx.bucket,
        Prefix: fullPrefix || undefined,
        ContinuationToken: continuationToken,
      }),
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!obj.Key) continue;
        results.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified,
          etag: obj.ETag,
        });
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return results;
}

/**
 * Downloads an object and returns its body as a `Uint8Array`.
 * Buffers the entire response stream into memory.
 */
export async function getObject(
  ctx: S3Context,
  key: string,
): Promise<Uint8Array> {
  const client = createS3Client(ctx);
  const fullKey = buildKey(ctx.prefix, key);

  const response = await client.send(
    new GetObjectCommand({
      Bucket: ctx.bucket,
      Key: fullKey,
    }),
  );

  if (!response.Body) {
    throw new Error(`Empty body for object: ${fullKey}`);
  }

  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Uploads a `Uint8Array` body to the given key, optionally with a
 * content-type header.
 */
export async function putObject(
  ctx: S3Context,
  key: string,
  body: Uint8Array,
  contentType?: string,
): Promise<void> {
  const client = createS3Client(ctx);
  const fullKey = buildKey(ctx.prefix, key);

  await client.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: fullKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Deletes a single object from the bucket.
 */
export async function deleteObject(
  ctx: S3Context,
  key: string,
): Promise<void> {
  const client = createS3Client(ctx);
  const fullKey = buildKey(ctx.prefix, key);

  await client.send(
    new DeleteObjectCommand({
      Bucket: ctx.bucket,
      Key: fullKey,
    }),
  );
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  buckets?: string[];
}

/**
 * Tests connectivity by issuing a `ListBuckets` call against the configured
 * endpoint. Returns a friendly error message on failure.
 */
export async function testConnection(
  ctx: S3Context,
): Promise<TestConnectionResult> {
  try {
    const client = createS3Client(ctx);
    const response = await client.send(new ListBucketsCommand({}));
    const buckets =
      response.Buckets?.map((b) => b.Name ?? '').filter(Boolean) ?? [];
    return { ok: true, buckets };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}