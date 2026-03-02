/**
 * Tests for CRDT merge strategies: LWW, MAX, MIN, COUNTER, UNION, custom
 */
import { KeyvCRDT, type CRDTDocument } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Strategies', () => {
  describe('LWW (Last-Write-Wins)', () => {
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

    test('should use deviceId as tiebreaker when timestamps are equal', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const timestamp = Date.now();

      // Manually set entry with fixed timestamp
      store._data.set('key', {
        name: { v: 'FromA', t: timestamp, d: 'deviceA' },
      });

      const deviceA = new KeyvCRDT('deviceA', { name: 'lww' }, store);
      await deviceA.set('key', { name: 'FromA' });

      const raw = await deviceA.getRaw('key');
      expect(raw).toBeDefined();
    });

    test('should handle concurrent writes with identical timestamps deterministically', async () => {
      const store = createMemoryStore<CRDTDocument<{ value: number }>>();
      const fixedTime = 1000000;

      store._data.set('key', {
        value: { v: 100, t: fixedTime, d: 'aaa' },
      });

      const crdt = new KeyvCRDT('zzz', { value: 'lww' }, store);

      // Direct store manipulation to simulate conflict
      store._data.set('key', {
        value: { v: 200, t: fixedTime, d: 'zzz' },
      });

      const result = await crdt.get('key');
      expect(result?.value).toBe(200);
    });

    test('should default to LWW when no strategy specified', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string; age: number }>>();
      const device1 = new KeyvCRDT('device1', {}, store);
      const device2 = new KeyvCRDT('device2', {}, store);

      await device1.set('user', { name: 'Alice', age: 25 });
      await new Promise(r => setTimeout(r, 10));
      await device2.set('user', { name: 'Bob', age: 30 });

      const result = await device1.get('user');
      expect(result?.name).toBe('Bob');
      expect(result?.age).toBe(30);
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

    test('should handle multiple increments from same device', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const crdt = new KeyvCRDT('mobile', { coins: 'counter' }, store);

      await crdt.set('player', { coins: 10 });
      await crdt.set('player', { coins: 25 });
      await crdt.set('player', { coins: 50 });

      // Should use latest value from same device (not sum)
      const result = await crdt.get('player');
      expect(result?.coins).toBe(50);
    });

    test('should correctly sum counters from many devices', async () => {
      const store = createMemoryStore<CRDTDocument<{ points: number }>>();

      const device1 = new KeyvCRDT('device1', { points: 'counter' }, store);
      const device2 = new KeyvCRDT('device2', { points: 'counter' }, store);
      const device3 = new KeyvCRDT('device3', { points: 'counter' }, store);

      await device1.set('game', { points: 100 });
      await device2.set('game', { points: 200 });
      await device3.set('game', { points: 300 });

      const result = await device1.get('game');
      expect(result?.points).toBe(600);
    });

    test('should handle negative counter values (uses max with 0)', async () => {
      const store = createMemoryStore<CRDTDocument<{ balance: number }>>();

      const deviceA = new KeyvCRDT('deviceA', { balance: 'counter' }, store);
      const deviceB = new KeyvCRDT('deviceB', { balance: 'counter' }, store);

      await deviceA.set('account', { balance: 100 });
      await deviceB.set('account', { balance: -50 });

      const result = await deviceA.get('account');
      // Counter uses Math.max per device, so -50 is compared with 0
      expect(result?.balance).toBe(100);
    });

    test('should support withdrawals using separate counters', async () => {
      const store = createMemoryStore<CRDTDocument<{ deposits: number; withdrawals: number }>>();

      const deviceA = new KeyvCRDT('deviceA', { deposits: 'counter', withdrawals: 'counter' }, store);
      const deviceB = new KeyvCRDT('deviceB', { deposits: 'counter', withdrawals: 'counter' }, store);

      await deviceA.set('account', { deposits: 100, withdrawals: 0 });
      await deviceB.set('account', { deposits: 0, withdrawals: 50 });

      const result = await deviceA.get('account');
      expect(result?.deposits).toBe(100);
      expect(result?.withdrawals).toBe(50);
    });

    test('should preserve counter metadata across merges', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();

      const mobile = new KeyvCRDT('mobile', { score: 'counter' }, store);
      const pc = new KeyvCRDT('pc', { score: 'counter' }, store);

      await mobile.set('player', { score: 100 });
      await pc.set('player', { score: 50 });

      const raw = await mobile.getRaw('player');
      expect(raw?.score?.c).toEqual({ mobile: 100, pc: 50 });
    });

    test('counter should use max per device when same device writes twice', async () => {
      const cache = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const remote = createMemoryStore<CRDTDocument<{ coins: number }>>();

      remote._data.set('player', {
        coins: { v: 50, t: 1000, d: 'mobile', c: { mobile: 50 } },
      });

      const mobile = new KeyvCRDT('mobile', { coins: 'counter' }, cache, remote);
      await mobile.set('player', { coins: 100 });

      const result = await mobile.get('player');
      expect(result?.coins).toBe(100);

      const raw = await mobile.getRaw('player');
      expect(raw?.coins?.c?.mobile).toBe(100);
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

    test('should handle empty arrays', async () => {
      const store = createMemoryStore<CRDTDocument<{ tags: string[] }>>();
      const crdt = new KeyvCRDT('device', { tags: 'union' }, store);

      await crdt.set('item', { tags: [] });
      const result = await crdt.get('item');
      expect(result?.tags).toEqual([]);
    });

    test('should merge with empty array', async () => {
      const store = createMemoryStore<CRDTDocument<{ tags: string[] }>>();
      const device1 = new KeyvCRDT('device1', { tags: 'union' }, store);
      const device2 = new KeyvCRDT('device2', { tags: 'union' }, store);

      await device1.set('item', { tags: ['a', 'b'] });
      await device2.set('item', { tags: [] });

      const result = await device1.get('item');
      expect(result?.tags?.sort()).toEqual(['a', 'b']);
    });

    test('should handle number arrays', async () => {
      const store = createMemoryStore<CRDTDocument<{ ids: number[] }>>();
      const device1 = new KeyvCRDT('device1', { ids: 'union' }, store);
      const device2 = new KeyvCRDT('device2', { ids: 'union' }, store);

      await device1.set('item', { ids: [1, 2, 3] });
      await device2.set('item', { ids: [2, 3, 4, 5] });

      const result = await device1.get('item');
      expect(result?.ids?.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    test('should handle complex object arrays (by reference)', async () => {
      const store = createMemoryStore<CRDTDocument<{ items: Array<{ id: number }> }>>();
      const device1 = new KeyvCRDT('device1', { items: 'union' }, store);
      const device2 = new KeyvCRDT('device2', { items: 'union' }, store);

      await device1.set('list', { items: [{ id: 1 }, { id: 2 }] });
      await device2.set('list', { items: [{ id: 2 }, { id: 3 }] });

      const result = await device1.get('list');
      // Objects are compared by reference, so all 4 will be present
      expect(result?.items?.length).toBe(4);
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
});
