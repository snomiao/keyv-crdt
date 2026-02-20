/**
 * KeyvCRDT - Multi-store CRDT wrapper for Keyv-compatible stores
 *
 * Like KeyvNest, but with CRDT conflict resolution. Supports multiple stores
 * (cache → remote) with automatic merging across devices.
 *
 * @example
 * ```ts
 * import { KeyvCRDT } from 'keyv-crdt';
 *
 * // Multi-store: local cache + shared remote
 * const crdt = KeyvCRDT('device-123', {
 *   name: 'lww',
 *   highScore: 'max',
 *   coins: 'counter',
 * }, new Map(), mongoStore);
 *
 * // Simple API
 * await crdt.set('user:1', { name: 'Alice', highScore: 100 });
 * const data = await crdt.get('user:1');
 * ```
 */

// ============================================================================
// Store Interface
// ============================================================================

type Awaitable<T> = Promise<T> | T;

/**
 * Minimal store interface compatible with Keyv stores.
 * Works with Map, Keyv, Redis, MongoDB, etc.
 */
export interface KeyvCRDTStore<T = unknown> {
  get(key: string): Awaitable<T | undefined>;
  set(key: string, value: T): Awaitable<unknown>;
  delete(key: string): Awaitable<boolean>;
  clear?(): Awaitable<void>;
}

// ============================================================================
// Types
// ============================================================================

/** Metadata for each field */
export type FieldMeta = {
  timestamp: number;
  deviceId: string;
};

/** Per-device counter values for 'counter' strategy */
export type CounterValue = Record<string, number>;

/** Internal CRDT field structure */
export type CRDTField<T> = {
  v: T;              // value
  t: number;         // timestamp
  d: string;         // deviceId
  c?: CounterValue;  // per-device counter (only for 'counter' strategy)
};

/** Reserved field name for tombstone */
const TOMBSTONE_KEY = '_deleted' as const;

/** CRDT document structure (includes tombstone field) */
export type CRDTDocument<T extends object> = {
  [K in keyof T]?: CRDTField<T[K]>;
} & {
  [TOMBSTONE_KEY]?: CRDTField<boolean>;
};

/** Built-in merge strategy names */
export type BuiltinStrategy = 'lww' | 'max' | 'min' | 'counter' | 'union';

/** Custom merge function signature */
export type CustomMergeFn<T> = (
  local: T,
  remote: T,
  localMeta: FieldMeta,
  remoteMeta: FieldMeta
) => T;

/** Merge strategy: built-in name or custom function */
export type MergeStrategy<T> = BuiltinStrategy | CustomMergeFn<T>;

/** Configuration: merge strategy per field */
export type MergeConfig<T extends object> = {
  [K in keyof T]?: MergeStrategy<T[K]>;
};

// ============================================================================
// KeyvCRDT Class
// ============================================================================

/**
 * Multi-store CRDT wrapper.
 *
 * Stores are ordered from fastest (cache) to slowest (source of truth).
 * - On get: checks stores in order, merges all found, updates caches
 * - On set: reads from deepest store first, merges, writes to all stores
 */
export class KeyvCRDT<T extends object> {
  private stores: KeyvCRDTStore<CRDTDocument<T>>[];

  /**
   * Create a new KeyvCRDT instance.
   *
   * @param deviceId - Unique identifier for this device/client
   * @param mergeConfig - Merge strategy configuration per field
   * @param stores - One or more stores (cache first, source of truth last)
   */
  constructor(
    private deviceId: string,
    private mergeConfig: MergeConfig<T> = {},
    ...stores: KeyvCRDTStore<CRDTDocument<T>>[]
  ) {
    if (stores.length === 0) {
      throw new Error('KeyvCRDT requires at least one store');
    }
    this.stores = stores;
  }

  /**
   * Get data from stores (merged, as plain object).
   * Checks caches first, falls back to deeper stores, merges all versions.
   *
   * @param key - The key to fetch
   * @returns Plain object (without CRDT metadata), or undefined if not found/deleted
   */
  async get(key: string): Promise<Partial<T> | undefined> {
    let merged: CRDTDocument<T> | undefined;
    let cacheHitIndex = -1;

    // Read from all stores and merge
    for (let i = 0; i < this.stores.length; i++) {
      const doc = await this.stores[i].get(key);
      if (doc) {
        if (cacheHitIndex === -1) cacheHitIndex = i;
        merged = merged ? this.mergeDocuments(merged, doc) : doc;
      }
    }

    if (!merged) return undefined;

    // Update caches with merged result (stores before the first hit)
    if (cacheHitIndex > 0) {
      const writePromises = this.stores
        .slice(0, cacheHitIndex)
        .map(store => store.set(key, merged));
      await Promise.all(writePromises);
    }

    // Check tombstone
    if (merged[TOMBSTONE_KEY]?.v === true) {
      return undefined;
    }

    return this.toPlainObject(merged);
  }

  /**
   * Set/update data in all stores (merges with existing data).
   * Reads from deepest store first to get latest from other devices.
   *
   * @param key - The key to store under
   * @param updates - Partial object with fields to update
   */
  async set(key: string, updates: Partial<T>): Promise<void> {
    const timestamp = Date.now();

    // Create CRDT fields for updates
    const newFields: CRDTDocument<T> = {};

    // Clear tombstone (mark as not deleted)
    newFields[TOMBSTONE_KEY] = {
      v: false,
      t: timestamp,
      d: this.deviceId,
    };

    for (const field in updates) {
      const strategy = this.mergeConfig[field as keyof T];
      if (strategy === 'counter') {
        (newFields as Record<string, CRDTField<unknown>>)[field] = {
          v: updates[field as keyof T],
          t: timestamp,
          d: this.deviceId,
          c: { [this.deviceId]: updates[field as keyof T] as number },
        };
      } else {
        (newFields as Record<string, CRDTField<unknown>>)[field] = {
          v: updates[field as keyof T],
          t: timestamp,
          d: this.deviceId,
        };
      }
    }

    // Read from ALL stores and merge (to get latest from other devices)
    let merged = newFields;
    for (const store of this.stores) {
      const existing = await store.get(key);
      if (existing) {
        merged = this.mergeDocuments(merged, existing);
      }
    }

    // Write merged result to ALL stores
    const writePromises = this.stores.map(store => store.set(key, merged));
    await Promise.all(writePromises);
  }

  /**
   * Delete data from all stores using tombstone.
   * Can be overridden by later edits (LWW between delete and edit).
   *
   * @param key - The key to delete
   */
  async delete(key: string): Promise<boolean> {
    const timestamp = Date.now();

    // Read from all stores and merge
    let existing: CRDTDocument<T> | undefined;
    for (const store of this.stores) {
      const doc = await store.get(key);
      if (doc) {
        existing = existing ? this.mergeDocuments(existing, doc) : doc;
      }
    }

    if (!existing) {
      return false;
    }

    // Create tombstone
    const tombstone: CRDTDocument<T> = {
      ...existing,
      [TOMBSTONE_KEY]: {
        v: true,
        t: timestamp,
        d: this.deviceId,
      },
    };

    // Write to all stores
    const writePromises = this.stores.map(store => store.set(key, tombstone));
    await Promise.all(writePromises);
    return true;
  }

  /**
   * Hard delete - permanently removes from all stores (no tombstone).
   * Use with caution: other devices may recreate the data.
   *
   * @param key - The key to permanently delete
   */
  async hardDelete(key: string): Promise<boolean> {
    const results = await Promise.all(this.stores.map(store => store.delete(key)));
    return results.some(r => r);
  }

  /**
   * Check if key exists and is not deleted.
   *
   * @param key - The key to check
   */
  async has(key: string): Promise<boolean> {
    for (const store of this.stores) {
      const doc = await store.get(key);
      if (doc) {
        const crdtDoc = doc as unknown as CRDTDocument<T>;
        return crdtDoc[TOMBSTONE_KEY]?.v !== true;
      }
    }
    return false;
  }

  /**
   * Check if key is tombstoned (soft deleted).
   *
   * @param key - The key to check
   */
  async isDeleted(key: string): Promise<boolean> {
    for (const store of this.stores) {
      const doc = await store.get(key);
      if (doc) {
        const crdtDoc = doc as unknown as CRDTDocument<T>;
        return crdtDoc[TOMBSTONE_KEY]?.v === true;
      }
    }
    return false;
  }

  /**
   * Get raw CRDT document (with metadata) from all stores merged.
   * Useful for debugging or advanced use cases.
   *
   * @param key - The key to fetch
   */
  async getRaw(key: string): Promise<CRDTDocument<T> | undefined> {
    let merged: CRDTDocument<T> | undefined;
    for (const store of this.stores) {
      const doc = await store.get(key);
      if (doc) {
        merged = merged ? this.mergeDocuments(merged, doc) : doc;
      }
    }
    return merged;
  }

  /**
   * Clear all stores.
   */
  async clear(): Promise<void> {
    const clearPromises = this.stores
      .filter(store => store.clear)
      .map(store => store.clear!());
    await Promise.all(clearPromises);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /** Convert CRDT document to plain object (excludes tombstone) */
  private toPlainObject(doc: CRDTDocument<T>): Partial<T> {
    const result: Partial<T> = {};
    for (const key in doc) {
      if (key === TOMBSTONE_KEY) continue;
      const field = (doc as Record<string, CRDTField<unknown>>)[key];
      if (field) {
        if (field.c) {
          (result as Record<string, unknown>)[key] = Object.values(field.c).reduce((a, b) => a + b, 0);
        } else {
          (result as Record<string, unknown>)[key] = field.v;
        }
      }
    }
    return result;
  }

  /** Merge a single field using the configured strategy */
  private mergeField<K extends keyof T | typeof TOMBSTONE_KEY>(
    key: K,
    local: CRDTField<unknown> | undefined,
    remote: CRDTField<unknown> | undefined
  ): CRDTField<unknown> | undefined {
    if (!local) return remote;
    if (!remote) return local;

    // Tombstone always uses LWW
    if (key === TOMBSTONE_KEY) {
      if (local.t > remote.t) return local;
      if (remote.t > local.t) return remote;
      return local.d > remote.d ? local : remote;
    }

    const strategy = this.mergeConfig[key as keyof T] || 'lww';
    const lm: FieldMeta = { timestamp: local.t, deviceId: local.d };
    const rm: FieldMeta = { timestamp: remote.t, deviceId: remote.d };

    if (strategy === 'lww') {
      if (local.t > remote.t) return local;
      if (remote.t > local.t) return remote;
      return local.d > remote.d ? local : remote;
    }

    if (strategy === 'max') {
      const val = Math.max(local.v as number, remote.v as number);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (strategy === 'min') {
      const val = Math.min(local.v as number, remote.v as number);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (strategy === 'counter') {
      const merged: CounterValue = remote.c ? { ...remote.c } : {};
      if (local.c) {
        for (const did in local.c) {
          merged[did] = Math.max(local.c[did], merged[did] ?? 0);
        }
      }
      const sum = Object.values(merged).reduce((a, b) => a + b, 0);
      return { v: sum, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d, c: merged };
    }

    if (strategy === 'union') {
      const merged = [...new Set([...(local.v as unknown[]), ...(remote.v as unknown[])])];
      return { v: merged, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (typeof strategy === 'function') {
      const val = strategy(local.v as T[keyof T], remote.v as T[keyof T], lm, rm);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    return local.t >= remote.t ? local : remote;
  }

  /** Merge two CRDT documents */
  private mergeDocuments(local: CRDTDocument<T>, remote: CRDTDocument<T>): CRDTDocument<T> {
    const result: CRDTDocument<T> = {};
    const allKeys = new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]) as Set<keyof T | typeof TOMBSTONE_KEY>;

    for (const key of allKeys) {
      const merged = this.mergeField(
        key,
        local[key as keyof typeof local] as CRDTField<unknown> | undefined,
        remote[key as keyof typeof remote] as CRDTField<unknown> | undefined
      );
      if (merged) {
        (result as Record<string, unknown>)[key as string] = merged;
      }
    }
    return result;
  }
}

// ============================================================================
// Factory function (like KeyvNest)
// ============================================================================

/**
 * Create a KeyvCRDT instance.
 *
 * @example
 * ```ts
 * // Single store
 * const crdt = KeyvCRDT('device', { score: 'max' }, mongoStore);
 *
 * // Multi-store: cache + remote
 * const crdt = KeyvCRDT('device', { score: 'max' }, new Map(), mongoStore);
 *
 * // With nested stores
 * const crdt = KeyvCRDT('device', {}, localCache, diskCache, remoteStore);
 * ```
 */
export function createCRDT<T extends object>(
  deviceId: string,
  mergeConfig: MergeConfig<T>,
  ...stores: KeyvCRDTStore<CRDTDocument<T>>[]
): KeyvCRDT<T> {
  return new KeyvCRDT(deviceId, mergeConfig, ...stores);
}

// Default export as function (like KeyvNest)
export default createCRDT;
