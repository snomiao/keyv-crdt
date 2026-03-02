/**
 * Tests for multi-store functionality (cache → remote)
 */
import { KeyvCRDT, type CRDTDocument, type KeyvCRDTStore } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Multi-Store', () => {
  test('should read from cache first, fall back to remote', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    remote._data.set('key', {
      name: { v: 'FromRemote', t: Date.now(), d: 'other-device' },
    });

    const result = await crdt.get('key');
    expect(result?.name).toBe('FromRemote');
    expect(cache._data.has('key')).toBe(true);
  });

  test('should write to all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'Alice' });

    expect(cache._data.has('key')).toBe(true);
    expect(remote._data.has('key')).toBe(true);
  });

  test('should merge data from all stores on set', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();

    const oldTimestamp = Date.now() - 1000;
    remote._data.set('key', {
      name: { v: 'OldName', t: oldTimestamp, d: 'other' },
      score: { v: 200, t: oldTimestamp, d: 'other' },
    });

    const crdt = new KeyvCRDT('device', { score: 'max' }, cache, remote);

    await crdt.set('key', { name: 'NewName', score: 100 });

    const result = await crdt.get('key');
    expect(result?.name).toBe('NewName'); // LWW: local wins (newer)
    expect(result?.score).toBe(200); // MAX: remote wins (higher)
  });

  test('mobile + pc concurrent writes should merge correctly', async () => {
    const sharedRemote = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();

    const mobileCache = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();
    const mobile = new KeyvCRDT('mobile', {
      name: 'lww',
      highScore: 'max',
      coins: 'counter',
    }, mobileCache, sharedRemote);

    const pcCache = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();
    const pc = new KeyvCRDT('pc', {
      name: 'lww',
      highScore: 'max',
      coins: 'counter',
    }, pcCache, sharedRemote);

    await mobile.set('player:1', { name: 'MobileUser', highScore: 100, coins: 50 });

    await new Promise(r => setTimeout(r, 10));
    await pc.set('player:1', { name: 'PCUser', highScore: 80, coins: 30 });

    const mobileResult = await mobile.get('player:1');
    const pcResult = await pc.get('player:1');

    expect(mobileResult?.name).toBe('PCUser');
    expect(mobileResult?.highScore).toBe(100);
    expect(mobileResult?.coins).toBe(80);

    expect(pcResult?.name).toBe('PCUser');
    expect(pcResult?.highScore).toBe(100);
    expect(pcResult?.coins).toBe(80);
  });

  test('should handle cache miss and populate cache from remote', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();

    remote._data.set('key', {
      name: { v: 'RemoteData', t: Date.now(), d: 'other' },
    });

    const crdt = new KeyvCRDT('device', {}, cache, remote);

    expect(cache._data.has('key')).toBe(false);

    const result = await crdt.get('key');
    expect(result?.name).toBe('RemoteData');
    expect(cache._data.has('key')).toBe(true);
  });

  test('should delete from all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'test' });
    await crdt.delete('key');

    expect(cache._data.get('key')?._deleted?.v).toBe(true);
    expect(remote._data.get('key')?._deleted?.v).toBe(true);
    expect(await crdt.get('key')).toBeUndefined();
  });

  test('should hardDelete from all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'test' });
    await crdt.hardDelete('key');

    expect(cache._data.has('key')).toBe(false);
    expect(remote._data.has('key')).toBe(false);
  });

  test('should clear all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key1', { name: 'a' });
    await crdt.set('key2', { name: 'b' });
    await crdt.clear();

    expect(cache._data.size).toBe(0);
    expect(remote._data.size).toBe(0);
  });

  test('three-tier cache: memory → disk → network', async () => {
    const memory = createMemoryStore<CRDTDocument<{ value: number }>>();
    const disk = createMemoryStore<CRDTDocument<{ value: number }>>();
    const network = createMemoryStore<CRDTDocument<{ value: number }>>();

    const crdt = new KeyvCRDT('device', { value: 'max' }, memory, disk, network);

    network._data.set('key', {
      value: { v: 100, t: Date.now(), d: 'server' },
    });

    const result = await crdt.get('key');
    expect(result?.value).toBe(100);

    expect(memory._data.has('key')).toBe(true);
    expect(disk._data.has('key')).toBe(true);
  });

  test('stale cache with newer remote data', async () => {
    const cache = createMemoryStore<CRDTDocument<{ version: number }>>();
    const remote = createMemoryStore<CRDTDocument<{ version: number }>>();

    cache._data.set('config', {
      version: { v: 1, t: 1000, d: 'old' },
    });

    remote._data.set('config', {
      version: { v: 5, t: 5000, d: 'new' },
    });

    const crdt = new KeyvCRDT('device', { version: 'lww' }, cache, remote);
    const result = await crdt.get('config');

    expect(result?.version).toBe(5);
    // Cache is NOT automatically updated when it has data (by design)
    expect(cache._data.get('config')?.version?.v).toBe(1);
  });

  test('stale cache is updated via MAX strategy on write', async () => {
    const cache = createMemoryStore<CRDTDocument<{ highScore: number }>>();
    const remote = createMemoryStore<CRDTDocument<{ highScore: number }>>();

    cache._data.set('player', {
      highScore: { v: 100, t: 1000, d: 'old' },
    });

    remote._data.set('player', {
      highScore: { v: 500, t: 5000, d: 'remote' },
    });

    const crdt = new KeyvCRDT('device', { highScore: 'max' }, cache, remote);
    await crdt.set('player', { highScore: 200 });

    expect(cache._data.get('player')?.highScore?.v).toBe(500);
  });

  test('divergent data across stores should merge', async () => {
    const cache = createMemoryStore<CRDTDocument<{ a: number; b: number; c: number }>>();
    const disk = createMemoryStore<CRDTDocument<{ a: number; b: number; c: number }>>();
    const remote = createMemoryStore<CRDTDocument<{ a: number; b: number; c: number }>>();

    cache._data.set('data', { a: { v: 100, t: 1000, d: 'cache' } });
    disk._data.set('data', { b: { v: 200, t: 2000, d: 'disk' } });
    remote._data.set('data', { c: { v: 300, t: 3000, d: 'remote' } });

    const crdt = new KeyvCRDT('device', {}, cache, disk, remote);
    const result = await crdt.get('data');

    expect(result?.a).toBe(100);
    expect(result?.b).toBe(200);
    expect(result?.c).toBe(300);
  });

  test('write should merge with all stores before writing back', async () => {
    const cache = createMemoryStore<CRDTDocument<{ local: string; remote: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ local: string; remote: string }>>();

    remote._data.set('key', {
      remote: { v: 'from-remote', t: 1000, d: 'other' },
    });

    const crdt = new KeyvCRDT('device', {}, cache, remote);
    await crdt.set('key', { local: 'from-local' });

    const result = await crdt.get('key');
    expect(result?.local).toBe('from-local');
    expect(result?.remote).toBe('from-remote');
  });

  test('four-tier store hierarchy', async () => {
    const l1 = createMemoryStore<CRDTDocument<{ value: number }>>();
    const l2 = createMemoryStore<CRDTDocument<{ value: number }>>();
    const l3 = createMemoryStore<CRDTDocument<{ value: number }>>();
    const l4 = createMemoryStore<CRDTDocument<{ value: number }>>();

    l4._data.set('key', {
      value: { v: 999, t: Date.now(), d: 'deep' },
    });

    const crdt = new KeyvCRDT('device', {}, l1, l2, l3, l4);
    const result = await crdt.get('key');

    expect(result?.value).toBe(999);
    expect(l1._data.has('key')).toBe(true);
    expect(l2._data.has('key')).toBe(true);
    expect(l3._data.has('key')).toBe(true);
  });

  test('stores without clear() should be skipped on clear', async () => {
    const withClear = createMemoryStore<CRDTDocument<{ name: string }>>();
    const withoutClear: KeyvCRDTStore<CRDTDocument<{ name: string }>> = {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
    };

    const crdt = new KeyvCRDT('device', {}, withClear, withoutClear);
    await crdt.set('key', { name: 'test' });

    await expect(crdt.clear()).resolves.toBeUndefined();
    expect(withClear._data.size).toBe(0);
  });
});
