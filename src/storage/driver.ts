/**
 * Storage backends for object bytes. The default is in-memory; persistent
 * drivers (disk, S3) implement the same StorageDriver interface.
 */
import type { StorageDriver } from '../types.js'

/**
 * Default driver - keeps object bytes in memory, keyed by "bucket/key".
 * Browser-safe (no fs); bytes are lost on restart.
 */
export class MemoryStorageDriver implements StorageDriver {
  private files = new Map<string, Uint8Array>()

  async put(key: string, data: Uint8Array): Promise<void> {
    this.files.set(key, data)
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.files.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key)
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) this.files.delete(k)
  }
}
