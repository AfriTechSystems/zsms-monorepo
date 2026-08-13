/**
 * Cloudflare R2 implementation (S3-compatible).
 *
 * THIS IS THE ONLY FILE PERMITTED TO CONSTRUCT AN S3 CLIENT.
 * The same class serves MinIO in Tier 2 self-hosted deployments — only the
 * endpoint and credentials differ (ADR-032, DEPLOYMENT_TOPOLOGY.md).
 *
 * Phase 0 status: interface-complete, dependency not yet installed.
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
      // TODO(Phase 0): install `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
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

  async put(_key: string, _body: Uint8Array | string, _options: PutObjectOptions): Promise<void> {
    await this.getClient()
    throw new Error('R2StorageClient.put not implemented — Phase 0 scaffold.')
  }

  async get(_key: string): Promise<Uint8Array> {
    await this.getClient()
    throw new Error('R2StorageClient.get not implemented — Phase 0 scaffold.')
  }

  async exists(_key: string): Promise<boolean> {
    await this.getClient()
    throw new Error('R2StorageClient.exists not implemented — Phase 0 scaffold.')
  }

  async delete(_key: string): Promise<void> {
    await this.getClient()
    throw new Error('R2StorageClient.delete not implemented — Phase 0 scaffold.')
  }

  async head(_key: string): Promise<StorageObject | null> {
    await this.getClient()
    throw new Error('R2StorageClient.head not implemented — Phase 0 scaffold.')
  }

  async getSignedUrl(_key: string, _options: SignedUrlOptions): Promise<string> {
    await this.getClient()
    throw new Error('R2StorageClient.getSignedUrl not implemented — Phase 0 scaffold.')
  }
}
