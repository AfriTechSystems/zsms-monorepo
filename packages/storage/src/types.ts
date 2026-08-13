/**
 * Object storage abstraction — type contract.
 * Spec: R2.md, STORAGE.md. Two-bucket architecture per ADR-006.
 */

/**
 * The two buckets are a security boundary. PRIVATE content is never served
 * without a short-lived signed URL, and signed URLs are never cached at any
 * layer (CACHING_CDN.md rule 3).
 */
export enum StorageBucket {
  /** Report cards, receipts, certificates, school assets. CDN-cacheable. */
  PUBLIC = 'public',
  /** Payment proofs, loan payslips, income documents. Never public. */
  PRIVATE = 'private',
}

export interface PutObjectOptions {
  contentType: string
  /** Cache-Control for the stored object. Ignored for PRIVATE. */
  cacheControl?: string
  metadata?: Record<string, string>
}

export interface SignedUrlOptions {
  /** Seconds until expiry. Keep short for PRIVATE — see STORAGE.md. */
  expiresIn: number
}

export interface StorageObject {
  key: string
  size: number
  contentType: string | null
  lastModified: Date
}

export interface StorageClient {
  readonly bucket: StorageBucket

  put(key: string, body: Uint8Array | string, options: PutObjectOptions): Promise<void>
  get(key: string): Promise<Uint8Array>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  head(key: string): Promise<StorageObject | null>

  /**
   * Time-limited signed URL. The only way PRIVATE content is ever served.
   * Never cache the result — it is per-user and time-bound.
   */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>
}
