/**
 * Tests for edge cases and utility methods
 */
import { KeyvCRDT, createCRDT, type CRDTDocument } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Edge Cases', () => {
  describe('Non-existent and empty values', () => {
    test('should return undefined for non-existent key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      expect(await crdt.get('nonexistent')).toBeUndefined();
    });

    test('should handle empty partial update', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'Alice' });
      await crdt.set('key', {}); // Empty update

      const result = await crdt.get('key');
      expect(result?.name).toBe('Alice');
    });

    test('should handle null-ish values correctly', async () => {
      const store = createMemoryStore<CRDTDocument<{ value: string | null }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { value: null });
      const result = await crdt.get('key');
      expect(result?.value).toBeNull();
    });

    test('should handle undefined fields', async () => {
      const store = createMemoryStore<CRDTDocument<{ a: string; b?: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { a: 'hello' });
      const result = await crdt.get('key');
      expect(result?.a).toBe('hello');
      expect(result?.b).toBeUndefined();
    });
  });

  describe('has() method', () => {
    test('should return false for non-existent key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      expect(await crdt.has('nonexistent')).toBe(false);
    });

    test('should return true for existing key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'test' });
      expect(await crdt.has('key')).toBe(true);
    });

    test('should return false for deleted key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'test' });
      await crdt.delete('key');
      expect(await crdt.has('key')).toBe(false);
    });
  });

  describe('isDeleted() method', () => {
    test('should return false for non-existent key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      expect(await crdt.isDeleted('nonexistent')).toBe(false);
    });

    test('should return false for existing non-deleted key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'test' });
      expect(await crdt.isDeleted('key')).toBe(false);
    });
  });

  describe('getRaw() method', () => {
    test('should return full CRDT metadata', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();
      const crdt = new KeyvCRDT('device123', { score: 'max' }, store);

      await crdt.set('key', { name: 'Alice', score: 100 });
      const raw = await crdt.getRaw('key');

      expect(raw).toBeDefined();
      expect(raw?.name?.v).toBe('Alice');
      expect(raw?.name?.d).toBe('device123');
      expect(raw?.name?.t).toBeGreaterThan(0);
      expect(raw?.score?.v).toBe(100);
      expect(raw?._deleted?.v).toBe(false);
    });

    test('should return undefined for non-existent key', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      expect(await crdt.getRaw('nonexistent')).toBeUndefined();
    });

    test('should return merged raw from all stores', async () => {
      const cache = createMemoryStore<CRDTDocument<{ a: number; b: number }>>();
      const remote = createMemoryStore<CRDTDocument<{ a: number; b: number }>>();

      cache._data.set('key', { a: { v: 10, t: 1000, d: 'cache' } });
      remote._data.set('key', { b: { v: 20, t: 2000, d: 'remote' } });

      const crdt = new KeyvCRDT('device', {}, cache, remote);
      const raw = await crdt.getRaw('key');

      expect(raw?.a?.v).toBe(10);
      expect(raw?.b?.v).toBe(20);
    });
  });
});

describe('createCRDT factory', () => {
  test('should create KeyvCRDT instance with single store', async () => {
    const store = createMemoryStore<CRDTDocument<{ value: string }>>();
    const crdt = createCRDT('device', { value: 'lww' }, store);

    await crdt.set('key', { value: 'test' });
    expect((await crdt.get('key'))?.value).toBe('test');
  });

  test('should create KeyvCRDT instance with multiple stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ value: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ value: string }>>();
    const crdt = createCRDT('device', {}, cache, remote);

    await crdt.set('key', { value: 'test' });
    expect(cache._data.has('key')).toBe(true);
    expect(remote._data.has('key')).toBe(true);
  });

  test('should throw if no stores provided', () => {
    expect(() => new KeyvCRDT('device', {})).toThrow('KeyvCRDT requires at least one store');
  });
});
