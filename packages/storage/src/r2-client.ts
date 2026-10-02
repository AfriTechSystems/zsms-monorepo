/**
 * Cloudflare R2 implementation (S3-compatible).
 *
 * THIS IS THE ONLY FILE PERMITTED TO CONSTRUCT AN S3 CLIENT.
 * The same class serves MinIO in Tier 2 self-hosted deployments — only the
 * endpoint and credentials differ (ADR-032, DEPLOYMENT_TOPOLOGY.md).
 *
 * Implemented on 2026-10-02. Every method threw "Phase 0 scaffold" until then, which
 * meant **nothing had ever been stored**: the report-card worker could render a PDF and had
 * nowhere to put it, receipts could not be produced, and no school logo could be uploaded.
 * The gap was invisible from the application, because no screen reached storage either.
 *
 * `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` were already dependencies; the
 * TODO saying otherwise was stale. What remains is **configuration**, not code: the four
 * `R2_PRIVATE_*` / `R2_PUBLIC_*` variables are unset, so `envFor()` throws a named error
 * listing exactly which — deliberately, because a storage client that silently no-ops is
 * how a school discovers at the end of term that its report cards were never saved.
 */

import {
  StorageBucket,
  type PutObjectOptions,
  type SignedUrlOptions,
  type StorageClient,
  type StorageObject,
} from './types'

interface S3ClientLike {
  send(command: unknown): Promise<Record<string, unknown>>
}

type Ctor = new (input: Record<string, unknown>) => unknown

interface S3Commands {
  PutObjectCommand: Ctor
  GetObjectCommand: Ctor
  DeleteObjectCommand: Ctor
  HeadObjectCommand: Ctor
}

let commands: S3Commands | null = null

/**
 * The command classes, imported once per process.
 *
 * Dynamic so the SDK is not pulled into a bundle that never touches storage — the Next.js
 * edge middleware among them — and cached because resolving it per call would pay the
 * module-resolution cost on every object in a 400-card batch.
 */
async function loadCommands(): Promise<S3Commands> {
  if (!commands) {
    commands = (await import('@aws-sdk/client-s3')) as unknown as S3Commands
  }
  return commands
}

function envFor(bucket: StorageBucket) {
  const prefix = bucket === StorageBucket.PUBLIC ? 'R2_PUBLIC' : 'R2_PRIVATE'
  const endpoint = process.env[`${prefix}_ENDPOINT`]
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`]
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`]
  const bucketName = process.env[`${prefix}_BUCKET_NAME`]

  const missing = [
    !endpoint && `${prefix}_ENDPOINT`,
    !accessKeyId && `${prefix}_ACCESS_KEY_ID`,
    !secretAccessKey && `${prefix}_SECRET_ACCESS_KEY`,
    !bucketName && `${prefix}_BUCKET_NAME`,
  ].filter(Boolean)

  if (missing.length) {
    throw new Error(`Missing storage environment variables: ${missing.join(', ')}`)
  }

  return {
    endpoint: endpoint!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucketName: bucketName!,
  }
}

export class R2StorageClient implements StorageClient {
  readonly bucket: StorageBucket
  private client: S3ClientLike | null = null
  private config: ReturnType<typeof envFor> | null = null

  constructor(bucket: StorageBucket) {
    this.bucket = bucket
  }

  private async getClient(): Promise<{ client: S3ClientLike; bucketName: string }> {
    if (!this.config) this.config = envFor(this.bucket)

    if (!this.client) {
      const { S3Client } = (await import('@aws-sdk/client-s3')) as unknown as {
        S3Client: new (o: Record<string, unknown>) => S3ClientLike
      }
      this.client = new S3Client({
        region: 'auto',
        endpoint: this.config.endpoint,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
      })
    }

    return { client: this.client, bucketName: this.config.bucketName }
  }

  async put(key: string, body: Uint8Array | string, options: PutObjectOptions): Promise<void> {
    const { client, bucketName } = await this.getClient()
    const { PutObjectCommand } = await loadCommands()

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        // Ignored for PRIVATE by design — a private object is only ever served through a
        // short-lived signed URL, and a cached one would outlive the signature.
        ...(this.bucket === StorageBucket.PUBLIC && options.cacheControl
          ? { CacheControl: options.cacheControl }
          : {}),
        ...(options.metadata ? { Metadata: options.metadata } : {}),
      }),
    )
  }

  async get(key: string): Promise<Uint8Array> {
    const { client, bucketName } = await this.getClient()
    const { GetObjectCommand } = await loadCommands()

    const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))

    // The SDK returns a stream with a helper the types do not expose through our
    // deliberately narrow `S3ClientLike`.
    const stream = response['Body'] as { transformToByteArray(): Promise<Uint8Array> } | undefined
    if (!stream) throw new Error(`R2 returned no body for ${key}`)

    return stream.transformToByteArray()
  }

  async exists(key: string): Promise<boolean> {
    // Expressed through `head` so "what counts as missing" is decided once. A 404 and a
    // 403 both mean "you cannot have it", and treating them differently here would make
    // `exists` disagree with `head` on an object the credentials cannot see.
    return (await this.head(key)) !== null
  }

  async delete(key: string): Promise<void> {
    const { client, bucketName } = await this.getClient()
    const { DeleteObjectCommand } = await loadCommands()
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
  }

  async head(key: string): Promise<StorageObject | null> {
    const { client, bucketName } = await this.getClient()
    const { HeadObjectCommand } = await loadCommands()

    try {
      const r = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
      return {
        key,
        size: Number(r['ContentLength'] ?? 0),
        contentType: (r['ContentType'] as string | undefined) ?? null,
        lastModified: (r['LastModified'] as Date | undefined) ?? new Date(0),
      }
    } catch (err) {
      // Absent is not an error to a caller asking whether something is there. Anything
      // else — a bad key, a network fault — must still surface, or a misconfigured
      // client reads as an empty bucket.
      const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } })
      if (name.name === 'NotFound' || name.$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const { client, bucketName } = await this.getClient()
    const { GetObjectCommand } = await loadCommands()
    const { getSignedUrl } = (await import('@aws-sdk/s3-request-presigner')) as unknown as {
      getSignedUrl(c: unknown, cmd: unknown, o: { expiresIn: number }): Promise<string>
    }

    /*
      The ONLY way private content is ever served (STORAGE.md). The expiry is the
      caller's, deliberately: a report card link in a parent's browser wants minutes,
      while a worker fetching its own object wants seconds. Nothing here lengthens it.
    */
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName, Key: key }), {
      expiresIn: options.expiresIn,
    })
  }
}
