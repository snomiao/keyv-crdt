# keyv-crdt

Multi-store CRDT wrapper for Keyv-compatible stores. Like [keyv-nest](https://github.com/snomiao/keyv-nest), but with CRDT conflict resolution for multi-device synchronization.

## Features

- **Multi-store support** - Cache → Disk → Network, like keyv-nest
- **CRDT conflict resolution** - Automatic merging across devices
- **Per-field merge strategies** - LWW, Max, Min, Counter, Union
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
import KeyvCRDT from 'keyv-crdt';

// Single store
const crdt = KeyvCRDT('device-123', { name: 'lww' }, mongoStore);

// Multi-store: local cache + shared remote (like keyv-nest)
const crdt = KeyvCRDT('device-123', {
  name: 'lww',           // Last-Write-Wins
  highScore: 'max',      // Keep highest value
  coins: 'counter',      // Sum across devices
  achievements: 'union', // Merge arrays
}, new Map(), mongoStore);

// Simple API
await crdt.set('user:1', { name: 'Alice', highScore: 100 });
const data = await crdt.get('user:1');

// Delete with tombstone (can be revived by later edits)
await crdt.delete('user:1');
```

## Multi-Device Example

```typescript
// Shared remote store (e.g., MongoDB)
const sharedRemote = new KeyvMongo('mongodb://...');

// Mobile device: local cache + shared remote
const mobile = KeyvCRDT('mobile', {
  name: 'lww',
  highScore: 'max',
  coins: 'counter',
}, new Map(), sharedRemote);

// PC device: local cache + shared remote
const pc = KeyvCRDT('pc', {
  name: 'lww',
  highScore: 'max',
  coins: 'counter',
}, new Map(), sharedRemote);

// Both write "simultaneously"
await mobile.set('player:1', { name: 'MobileUser', highScore: 100, coins: 50 });
await pc.set('player:1', { name: 'PCUser', highScore: 80, coins: 30 });

// Both see the same merged result:
// {
//   name: 'PCUser',      // LWW - PC was later
//   highScore: 100,      // MAX - Mobile's score was higher
//   coins: 80,           // COUNTER - 50 + 30
// }
```

## Three-Tier Cache

```typescript
const crdt = KeyvCRDT('device', { value: 'max' },
  new Map(),           // Memory (fastest)
  diskStore,           // Disk
  networkStore         // Network (source of truth)
);

// On get: checks memory → disk → network, merges all, updates caches
// On set: reads from all, merges with CRDT, writes to all
```

## Merge Strategies

### `lww` - Last-Write-Wins (default)

```typescript
KeyvCRDT('device', { name: 'lww' }, store);
```

### `max` - Maximum Value

```typescript
KeyvCRDT('device', { highScore: 'max' }, store);
```

### `min` - Minimum Value

```typescript
KeyvCRDT('device', { bestTime: 'min' }, store);
```

### `counter` - Grow-Only Counter

Sums values from all devices. Each device's contribution tracked separately.

```typescript
KeyvCRDT('device', { totalCoins: 'counter' }, store);

// Device A: coins = 100
// Device B: coins = 50
// Result: coins = 150
```

### `union` - Set Union

```typescript
KeyvCRDT('device', { tags: 'union' }, store);

// Device A: tags = ['a', 'b']
// Device B: tags = ['b', 'c']
// Result: tags = ['a', 'b', 'c']
```

### Custom Merge Function

```typescript
KeyvCRDT('device', {
  votes: (local, remote, localMeta, remoteMeta) => ({
    up: Math.max(local.up, remote.up),
    down: Math.max(local.down, remote.down),
  }),
}, store);
```

## API Reference

### `KeyvCRDT(deviceId, mergeConfig, ...stores)`

Create a new KeyvCRDT instance.

- `deviceId` - Unique identifier for this device/client
- `mergeConfig` - Object mapping field names to merge strategies
- `stores` - One or more stores (cache first, source of truth last)

### `crdt.get(key)`

Get data from stores. Checks caches first, falls back to deeper stores, merges all versions.

### `crdt.set(key, data)`

Set/update data. Reads from all stores first, merges with CRDT, writes to all stores.

### `crdt.delete(key)`

Soft delete using tombstone. Can be revived by later edits.

### `crdt.hardDelete(key)`

Permanently delete from all stores (no tombstone).

### `crdt.has(key)`

Check if key exists and is not deleted.

### `crdt.isDeleted(key)`

Check if key is tombstoned (soft deleted).

### `crdt.getRaw(key)`

Get raw CRDT document with metadata from all stores merged.

### `crdt.clear()`

Clear all stores.

## How It Works

```
Mobile                          PC
   │                             │
   ├─► local Map                 ├─► local Map
   │      │                      │      │
   │      ▼                      │      ▼
   └─► MongoDB ◄─────────────────┴─► MongoDB
         │
         └── CRDT merge happens here
             (on every read/write)
```

1. **On set**: Reads from ALL stores (to get latest from other devices), merges using CRDT strategies, writes merged result to ALL stores
2. **On get**: Checks stores in order, merges all found data, updates caches with merged result

## License

MIT
