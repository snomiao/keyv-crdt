import { KeyvCRDT, createCRDT, type MergeConfig, type CRDTDocument, type KeyvCRDTStore } from './index';

// Helper to create a simple in-memory store
function createMemoryStore<T>(): KeyvCRDTStore<T> & { _data: Map<string, T> } {
  const data = new Map<string, T>();
  return {
    _data: data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => data.delete(key),
    clear: async () => data.clear(),
  };
}

describe('KeyvCRDT - Single Store', () => {
  describe('LWW (Last-Write-Wins) strategy', () => {
    test('should keep the value with latest timestamp', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const device1 = new KeyvCRDT('device1', { name: 'lww' }, store);
      const device2 = new KeyvCRDT('device2', { name: 'lww' }, store);

      await device1.set('user:1', { name: 'Alice' });
      await new Promise(r => setTimeout(r, 10));
      await device2.set('user:1', { name: 'Bob' });

      expect((await device1.get('user:1'))?.name).toBe('Bob');
      expect((await device2.get('user:1'))?.name).toBe('Bob');
    });
  });

  describe('MAX strategy', () => {
    test('should keep the highest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();
      const device1 = new KeyvCRDT('device1', { score: 'max' }, store);
      const device2 = new KeyvCRDT('device2', { score: 'max' }, store);

      await device1.set('game:1', { score: 100 });
      await device2.set('game:1', { score: 50 });

      expect((await device1.get('game:1'))?.score).toBe(100);
      expect((await device2.get('game:1'))?.score).toBe(100);
    });
  });

  describe('MIN strategy', () => {
    test('should keep the lowest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ bestTime: number }>>();
      const device1 = new KeyvCRDT('device1', { bestTime: 'min' }, store);
      const device2 = new KeyvCRDT('device2', { bestTime: 'min' }, store);

      await device1.set('race:1', { bestTime: 120 });
      await device2.set('race:1', { bestTime: 95 });

      expect((await device1.get('race:1'))?.bestTime).toBe(95);
    });
  });

  describe('COUNTER strategy', () => {
    test('should sum values from all devices', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT('mobile', { coins: 'counter' }, store);
      const pc = new KeyvCRDT('pc', { coins: 'counter' }, store);

      await mobile.set('player:1', { coins: 100 });
      await pc.set('player:1', { coins: 50 });

      expect((await mobile.get('player:1'))?.coins).toBe(150);
      expect((await pc.get('player:1'))?.coins).toBe(150);
    });
  });

  describe('UNION strategy', () => {
    test('should merge arrays without duplicates', async () => {
      const store = createMemoryStore<CRDTDocument<{ tags: string[] }>>();
      const device1 = new KeyvCRDT('device1', { tags: 'union' }, store);
      const device2 = new KeyvCRDT('device2', { tags: 'union' }, store);

      await device1.set('item:1', { tags: ['a', 'b', 'c'] });
      await device2.set('item:1', { tags: ['b', 'c', 'd', 'e'] });

      expect((await device1.get('item:1'))?.tags?.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('Custom merge function', () => {
    test('should use custom merge function', async () => {
      type Data = { votes: { up: number; down: number } };
      const store = createMemoryStore<CRDTDocument<Data>>();

      const mergeVotes = (local: Data['votes'], remote: Data['votes']) => ({
        up: Math.max(local.up, remote.up),
        down: Math.max(local.down, remote.down),
      });

      const device1 = new KeyvCRDT('device1', { votes: mergeVotes }, store);
      const device2 = new KeyvCRDT('device2', { votes: mergeVotes }, store);

      await device1.set('post:1', { votes: { up: 10, down: 2 } });
      await device2.set('post:1', { votes: { up: 8, down: 5 } });

      expect((await device1.get('post:1'))?.votes).toEqual({ up: 10, down: 5 });
    });
  });

  describe('Tombstone deletion', () => {
    test('delete() should tombstone data', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'test' });
      expect(await crdt.has('key')).toBe(true);

      await crdt.delete('key');
      expect(await crdt.has('key')).toBe(false);
      expect(await crdt.get('key')).toBeUndefined();
      expect(await crdt.isDeleted('key')).toBe(true);
    });

    test('later edit should revive deleted item', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const deviceA = new KeyvCRDT('deviceA', {}, store);
      const deviceB = new KeyvCRDT('deviceB', {}, store);

      await deviceA.set('key', { name: 'Alice' });
      await deviceA.delete('key');
      expect(await deviceA.get('key')).toBeUndefined();

      await new Promise(r => setTimeout(r, 10));
      await deviceB.set('key', { name: 'Bob' });

      expect((await deviceA.get('key'))?.name).toBe('Bob');
      expect(await deviceA.isDeleted('key')).toBe(false);
    });

    test('hardDelete() should permanently remove', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT('device', {}, store);

      await crdt.set('key', { name: 'test' });
      await crdt.hardDelete('key');

      expect(await crdt.get('key')).toBeUndefined();
      expect(await crdt.isDeleted('key')).toBe(false);
      expect(await crdt.getRaw('key')).toBeUndefined();
    });
  });
});

describe('KeyvCRDT - Multi Store', () => {
  test('should read from cache first, fall back to remote', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    // Write to remote only (simulating another device)
    remote._data.set('key', {
      name: { v: 'FromRemote', t: Date.now(), d: 'other-device' },
    });

    // Should find in remote and return
    const result = await crdt.get('key');
    expect(result?.name).toBe('FromRemote');

    // Cache should now have the value
    expect(cache._data.has('key')).toBe(true);
  });

  test('should write to all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'Alice' });

    // Both stores should have the value
    expect(cache._data.has('key')).toBe(true);
    expect(remote._data.has('key')).toBe(true);
  });

  test('should merge data from all stores on set', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();

    // Simulate: remote has data from another device
    const oldTimestamp = Date.now() - 1000;
    remote._data.set('key', {
      name: { v: 'OldName', t: oldTimestamp, d: 'other' },
      score: { v: 200, t: oldTimestamp, d: 'other' },
    });

    const crdt = new KeyvCRDT('device', { score: 'max' }, cache, remote);

    // Set new data - should merge with remote
    await crdt.set('key', { name: 'NewName', score: 100 });

    const result = await crdt.get('key');
    expect(result?.name).toBe('NewName');  // LWW: local wins (newer)
    expect(result?.score).toBe(200);       // MAX: remote wins (higher)
  });

  test('mobile + pc concurrent writes should merge correctly', async () => {
    // Shared remote store (like MongoDB)
    const sharedRemote = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();

    // Mobile device: local cache + shared remote
    const mobileCache = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();
    const mobile = new KeyvCRDT('mobile', {
      name: 'lww',
      highScore: 'max',
      coins: 'counter',
    }, mobileCache, sharedRemote);

    // PC device: local cache + shared remote
    const pcCache = createMemoryStore<CRDTDocument<{ name: string; highScore: number; coins: number }>>();
    const pc = new KeyvCRDT('pc', {
      name: 'lww',
      highScore: 'max',
      coins: 'counter',
    }, pcCache, sharedRemote);

    // Mobile writes first
    await mobile.set('player:1', { name: 'MobileUser', highScore: 100, coins: 50 });

    // PC writes later
    await new Promise(r => setTimeout(r, 10));
    await pc.set('player:1', { name: 'PCUser', highScore: 80, coins: 30 });

    // Both should see merged result
    const mobileResult = await mobile.get('player:1');
    const pcResult = await pc.get('player:1');

    expect(mobileResult?.name).toBe('PCUser');      // LWW: PC wins (later)
    expect(mobileResult?.highScore).toBe(100);      // MAX: Mobile wins (higher)
    expect(mobileResult?.coins).toBe(80);           // COUNTER: 50 + 30

    expect(pcResult?.name).toBe('PCUser');
    expect(pcResult?.highScore).toBe(100);
    expect(pcResult?.coins).toBe(80);
  });

  test('should handle cache miss and populate cache from remote', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();

    // Data only in remote
    remote._data.set('key', {
      name: { v: 'RemoteData', t: Date.now(), d: 'other' },
    });

    const crdt = new KeyvCRDT('device', {}, cache, remote);

    // Cache is empty
    expect(cache._data.has('key')).toBe(false);

    // Get should fetch from remote
    const result = await crdt.get('key');
    expect(result?.name).toBe('RemoteData');

    // Cache should now be populated
    expect(cache._data.has('key')).toBe(true);
  });

  test('should delete from all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'test' });
    await crdt.delete('key');

    // Both should have tombstone
    expect(cache._data.get('key')?._deleted?.v).toBe(true);
    expect(remote._data.get('key')?._deleted?.v).toBe(true);

    // Get should return undefined
    expect(await crdt.get('key')).toBeUndefined();
  });

  test('should hardDelete from all stores', async () => {
    const cache = createMemoryStore<CRDTDocument<{ name: string }>>();
    const remote = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, cache, remote);

    await crdt.set('key', { name: 'test' });
    await crdt.hardDelete('key');

    // Both should be empty
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

    // Data only in network (simulating cold start)
    network._data.set('key', {
      value: { v: 100, t: Date.now(), d: 'server' },
    });

    // Get should fetch from network
    const result = await crdt.get('key');
    expect(result?.value).toBe(100);

    // Memory and disk should now be populated
    expect(memory._data.has('key')).toBe(true);
    expect(disk._data.has('key')).toBe(true);
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
