/**
 * Filesystem-backed storage driver (Node only). Persists object bytes as files
 * under a single root directory, with path-traversal protection on every key.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import type { StorageDriver } from '../types.js'

/**
 * Node-only {@link StorageDriver} that keeps object bytes as files under a
 * single root directory. Keys map to relative paths beneath the root.
 */
export class FsStorageDriver implements StorageDriver {
  constructor(private root: string) {}

  /**
   * Resolve a storage key to an absolute path inside the root.
   *
   * SECURITY: rejects keys that escape the root (e.g. `../`); the normalized
   * path must stay under `root` + separator or the key is refused.
   *
   * @throws if the key would resolve outside the root directory.
   */
  private resolve(key: string): string {
    const path = normalize(join(this.root, key))
    if (!path.startsWith(normalize(this.root) + sep)) {
      throw new Error(`invalid storage key: ${key}`)
    }
    return path
  }

  /** Write object bytes, creating parent directories as needed. */
  async put(key: string, data: Uint8Array): Promise<void> {
    const path = this.resolve(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }

  /** Read object bytes, or null if the key does not exist. */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** Delete an object; a missing key is not an error. */
  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }

  /** Delete several objects in sequence. */
  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) await this.delete(k)
  }
}
