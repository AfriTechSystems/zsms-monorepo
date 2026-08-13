/**
 * Object storage abstraction — the ONLY module permitted to construct an
 * S3 client against R2 or MinIO.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/R2.md`
 *       `Official Documentation/13 Document and PDF System/STORAGE.md`
 * Decision: ADR-006 (two-bucket R2), ADR-032 (MinIO substitute for Tier 2).
 *
 * R2 and MinIO are both S3-compatible, so the Tier 1 ↔ Tier 2 swap is an
 * endpoint and credential change, never a code branch.
 */

import { R2StorageClient } from './r2-client'
import { StorageBucket, type StorageClient } from './types'

const instances = new Map<StorageBucket, StorageClient>()

/**
 * Returns the client for a bucket.
 *
 * The two-bucket split is a security boundary, not organisation: PUBLIC holds
 * documents safe to serve widely; PRIVATE holds payment proofs and loan
 * payslips and is never publicly readable. Choosing a bucket is a deliberate
 * decision at every call site — there is no default.
 */
export function getStorage(bucket: StorageBucket): StorageClient {
  const existing = instances.get(bucket)
  if (existing) return existing

  const client = new R2StorageClient(bucket)
  instances.set(bucket, client)
  return client
}

/** Test-only. */
export function __resetStorageForTests(): void {
  instances.clear()
}

export {
  StorageBucket,
  type StorageClient,
  type PutObjectOptions,
  type SignedUrlOptions,
  type StorageObject,
} from './types'
