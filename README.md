# keyv-crdt

CRDT wrapper for Keyv-compatible stores. Enables conflict-free synchronization between multiple devices/clients with customizable per-field merge strategies.

## Features

- **Simple API** - Just use `.get()` and `.set()` like regular Keyv
- **Per-field merge strategies** - Configure how each field resolves conflicts
- **Built-in strategies** - LWW, Max, Min, Counter, Union
- **Custom merge functions** - Full control over conflict resolution
- **Tombstone deletion** - Delete vs edit conflicts resolved by timestamp
- **Works with any store** - Map, Keyv, Redis, MongoDB, etc.

## Installation

```bash
npm install keyv-crdt
# or
bun add keyv-crdt
```

## Quick Start

```typescript
import { KeyvCRDT } from 'keyv-crdt';

// Use any Keyv-compatible store (Map, Redis, MongoDB, etc.)
const store = new Map();

// Create CRDT instance with device ID and merge config
const crdt = new KeyvCRDT(store, 'device-123', {
  name: 'lww',           // Last-Write-Wins
  highScore: 'max',      // Keep highest value
  totalCoins: 'counter', // Sum across devices
  achievements: 'union', // Merge arrays
});

// Simple API
await crdt.set('user:1', { name: 'Alice', highScore: 100, totalCoins: 50 });
const data = await crdt.get('user:1');

// Delete with tombstone (can be revived by later edits)
await crdt.delete('user:1');
```

## Merge Strategies

### `lww` - Last-Write-Wins (default)

The value with the latest timestamp wins. DeviceId is used as a tie-breaker.

```typescript
const crdt = new KeyvCRDT(store, 'device', { name: 'lww' });
```

### `max` - Maximum Value

Always keeps the highest numeric value.

```typescript
const crdt = new KeyvCRDT(store, 'device', { highScore: 'max' });
```

### `min` - Minimum Value

Always keeps the lowest numeric value.

```typescript
const crdt = new KeyvCRDT(store, 'device', { bestTime: 'min' });
```

### `counter` - Grow-Only Counter

Sums values from all devices. Each device's contribution is tracked separately.

```typescript
const crdt = new KeyvCRDT(store, 'device', { totalCoins: 'counter' });

// Device A: coins = 100
// Device B: coins = 50
// Result: coins = 150
```

### `union` - Set Union

Merges arrays without duplicates.

```typescript
const crdt = new KeyvCRDT(store, 'device', { tags: 'union' });

// Device A: tags = ['a', 'b']
// Device B: tags = ['b', 'c']
// Result: tags = ['a', 'b', 'c']
```

### Custom Merge Function

Full control over how values are merged.

```typescript
const crdt = new KeyvCRDT(store, 'device', {
  votes: (local, remote, localMeta, remoteMeta) => ({
    up: Math.max(local.up, remote.up),
    down: Math.max(local.down, remote.down),
  }),
});
```

## API Reference

### `new KeyvCRDT(store, deviceId, mergeConfig)`

Create a new CRDT instance.

- `store` - Any Keyv-compatible store (Map, Keyv, Redis, etc.)
- `deviceId` - Unique identifier for this device/client
- `mergeConfig` - Object mapping field names to merge strategies

### `crdt.get(key)`

Get data from store. Returns `undefined` if not found or deleted.

### `crdt.set(key, data)`

Set/update data. Merges with existing data using configured strategies.

### `crdt.delete(key)`

Soft delete using tombstone. Can be revived by later edits.

### `crdt.hardDelete(key)`

Permanently delete from store (no tombstone).

### `crdt.has(key)`

Check if key exists and is not deleted.

### `crdt.isDeleted(key)`

Check if key is tombstoned (soft deleted).

### `crdt.getRaw(key)`

Get raw CRDT document with metadata. Useful for debugging.

## Multi-Device Example

```typescript
// Shared store (e.g., MongoDB, Redis)
const sharedStore = new KeyvMongo('mongodb://...');

// Mobile device
const mobile = new KeyvCRDT(sharedStore, 'mobile', {
  name: 'lww',
  highScore: 'max',
  coins: 'counter',
});

// PC device
const pc = new KeyvCRDT(sharedStore, 'pc', {
  name: 'lww',
  highScore: 'max',
  coins: 'counter',
});

// Both write simultaneously
await mobile.set('player:1', { name: 'MobileUser', highScore: 100, coins: 50 });
await pc.set('player:1', { name: 'PCUser', highScore: 200, coins: 80 });

// Result (from either device):
// {
//   name: 'PCUser',      // LWW - PC was later
//   highScore: 200,      // MAX - highest wins
//   coins: 130,          // COUNTER - 50 + 80
// }
```

## License

MIT
