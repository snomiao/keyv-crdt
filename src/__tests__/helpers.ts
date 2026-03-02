import type { CRDTDocument, KeyvCRDTStore } from '../index';

/** Helper to create a simple in-memory store with exposed data for testing */
export function createMemoryStore<T>(): KeyvCRDTStore<T> & { _data: Map<string, T> } {
  const data = new Map<string, T>();
  return {
    _data: data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => data.delete(key),
    clear: async () => data.clear(),
  };
}

export type { CRDTDocument, KeyvCRDTStore };
