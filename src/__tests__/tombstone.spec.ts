/**
 * Tests for tombstone (soft delete) functionality
 */
import { KeyvCRDT, type CRDTDocument } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Tombstone Deletion', () => {
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

  test('should return false when deleting non-existent key', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, store);

    expect(await crdt.delete('nonexistent')).toBe(false);
  });

  test('should return true when deleting existing key', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, store);

    await crdt.set('key', { name: 'test' });
    expect(await crdt.delete('key')).toBe(true);
  });

  test('should handle double delete', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, store);

    await crdt.set('key', { name: 'test' });
    await crdt.delete('key');
    expect(await crdt.delete('key')).toBe(true);
    expect(await crdt.isDeleted('key')).toBe(true);
  });

  test('should return false when hard deleting non-existent key', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const crdt = new KeyvCRDT('device', {}, store);

    expect(await crdt.hardDelete('nonexistent')).toBe(false);
  });

  test('concurrent delete and set - later set wins', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const deleter = new KeyvCRDT('deleter', {}, store);
    const writer = new KeyvCRDT('writer', {}, store);

    await deleter.set('key', { name: 'original' });
    await deleter.delete('key');

    await new Promise(r => setTimeout(r, 10));
    await writer.set('key', { name: 'revived' });

    expect((await deleter.get('key'))?.name).toBe('revived');
    expect(await deleter.isDeleted('key')).toBe(false);
  });

  test('concurrent set and delete - later delete wins', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string }>>();
    const writer = new KeyvCRDT('writer', {}, store);
    const deleter = new KeyvCRDT('deleter', {}, store);

    await writer.set('key', { name: 'value' });

    await new Promise(r => setTimeout(r, 10));
    await deleter.delete('key');

    expect(await writer.get('key')).toBeUndefined();
    expect(await writer.isDeleted('key')).toBe(true);
  });

  test('tombstone should preserve field data for potential merge', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();
    const crdt = new KeyvCRDT('device', { score: 'max' }, store);

    await crdt.set('player', { name: 'Alice', score: 100 });
    await crdt.delete('player');

    const raw = await crdt.getRaw('player');
    expect(raw?.name?.v).toBe('Alice');
    expect(raw?.score?.v).toBe(100);
    expect(raw?._deleted?.v).toBe(true);
  });

  test('reviving tombstoned item should merge with old fields', async () => {
    const store = createMemoryStore<CRDTDocument<{ name: string; score: number }>>();
    const device1 = new KeyvCRDT('device1', { score: 'max' }, store);
    const device2 = new KeyvCRDT('device2', { score: 'max' }, store);

    await device1.set('player', { name: 'Alice', score: 500 });
    await device1.delete('player');

    await new Promise(r => setTimeout(r, 10));
    await device2.set('player', { name: 'Bob', score: 100 });

    const result = await device1.get('player');
    expect(result?.name).toBe('Bob'); // LWW
    expect(result?.score).toBe(500); // MAX strategy preserved higher score
  });
});
