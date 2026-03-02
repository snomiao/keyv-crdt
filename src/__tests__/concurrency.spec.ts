/**
 * Tests for concurrency simulation and sequential operations
 */
import { KeyvCRDT, type CRDTDocument } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Concurrency Simulation', () => {
  test('should handle sequential writes from multiple devices', async () => {
    const store = createMemoryStore<CRDTDocument<{ count: number }>>();

    const devices = Array.from({ length: 5 }, (_, i) =>
      new KeyvCRDT(`device-${i}`, { count: 'counter' }, store)
    );

    for (let i = 0; i < devices.length; i++) {
      await devices[i].set('counter', { count: (i + 1) * 10 });
    }

    const results = await Promise.all(devices.map(d => d.get('counter')));
    results.forEach(result => {
      expect(result?.count).toBe(150); // 10 + 20 + 30 + 40 + 50
    });
  });

  test('should handle sequential read-write operations with MAX strategy', async () => {
    const store = createMemoryStore<CRDTDocument<{ value: number }>>();
    const crdt = new KeyvCRDT('device', { value: 'max' }, store);

    await crdt.set('key', { value: 10 });
    await crdt.get('key');
    await crdt.set('key', { value: 50 });
    await crdt.get('key');
    await crdt.set('key', { value: 30 });
    await crdt.get('key');

    const final = await crdt.get('key');
    expect(final?.value).toBe(50);
  });

  test('should handle delete followed by set (later wins)', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const writer = new KeyvCRDT('writer', {}, store);
    const deleter = new KeyvCRDT('deleter', {}, store);

    await writer.set('key', { name: 'initial' });

    await deleter.delete('key');
    expect(await writer.get('key')).toBeUndefined();

    await new Promise(r => setTimeout(r, 10));
    await writer.set('key', { name: 'updated' });

    const result = await writer.get('key');
    expect(result?.name).toBe('updated');
  });

  test('should handle set followed by delete (later wins)', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const writer = new KeyvCRDT('writer', {}, store);
    const deleter = new KeyvCRDT('deleter', {}, store);

    await writer.set('key', { name: 'initial' });
    await writer.set('key', { name: 'updated' });

    await new Promise(r => setTimeout(r, 10));
    await deleter.delete('key');

    const result = await writer.get('key');
    expect(result).toBeUndefined();
    expect(await writer.isDeleted('key')).toBe(true);
  });

  test('should handle sequential votes from many devices', async () => {
    const central = createMemoryStore<CRDTDocument<{ votes: number }>>();

    const devices = Array.from({ length: 10 }, (_, i) =>
      new KeyvCRDT(`voter-${i}`, { votes: 'counter' }, createMemoryStore(), central)
    );

    for (const device of devices) {
      await device.set('poll:1', { votes: 1 });
    }

    const result = await devices[0].get('poll:1');
    expect(result?.votes).toBe(10);
  });

  test('should maintain consistency with sequential burst writes', async () => {
    const store = createMemoryStore<CRDTDocument<{ seq: number }>>();

    const burstWrites = async (device: KeyvCRDT<{ seq: number }>, start: number) => {
      for (let i = 0; i < 10; i++) {
        await device.set('burst', { seq: start + i });
      }
    };

    const d1 = new KeyvCRDT('d1', { seq: 'max' }, store);
    const d2 = new KeyvCRDT('d2', { seq: 'max' }, store);
    const d3 = new KeyvCRDT('d3', { seq: 'max' }, store);

    await burstWrites(d1, 0);
    await burstWrites(d2, 100);
    await burstWrites(d3, 200);

    const result = await d1.get('burst');
    expect(result?.seq).toBe(209);
  });

  test('counter CRDT should be eventually consistent after sequential writes', async () => {
    const sharedRemote = createMemoryStore<CRDTDocument<{ count: number }>>();

    const devices = Array.from({ length: 3 }, (_, i) =>
      new KeyvCRDT(`device-${i}`, { count: 'counter' }, createMemoryStore(), sharedRemote)
    );

    await devices[0].set('counter', { count: 10 });
    await devices[1].set('counter', { count: 20 });
    await devices[2].set('counter', { count: 30 });

    const results = await Promise.all(devices.map(d => d.get('counter')));

    results.forEach(result => {
      expect(result?.count).toBe(60);
    });
  });

  test('should handle multiple operations on same key from same device', async () => {
    const store = createMemoryStore<CRDTDocument<{ value: number }>>();
    const crdt = new KeyvCRDT('device', { value: 'max' }, store);

    // Multiple sequential writes
    for (let i = 1; i <= 10; i++) {
      await crdt.set('key', { value: i * 10 });
    }

    const result = await crdt.get('key');
    expect(result?.value).toBe(100);
  });

  test('should handle alternating writes between two devices', async () => {
    const store = createMemoryStore<CRDTDocument<{ turn: number }>>();
    const player1 = new KeyvCRDT('player1', { turn: 'counter' }, store);
    const player2 = new KeyvCRDT('player2', { turn: 'counter' }, store);

    // Alternating turns
    await player1.set('game', { turn: 1 });
    await player2.set('game', { turn: 1 });
    await player1.set('game', { turn: 1 });
    await player2.set('game', { turn: 1 });
    await player1.set('game', { turn: 1 });

    const result = await player1.get('game');
    // Counter uses max per device, so player1=1, player2=1, total=2
    // But since same device writes multiple times, it replaces
    // Actually: player1 writes 1 three times (final: 1), player2 writes 1 twice (final: 1)
    // Counter takes max per device, not sum of all writes from same device
    expect(result?.turn).toBe(2); // 1 from player1 + 1 from player2
  });
});
