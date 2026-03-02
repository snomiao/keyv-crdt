/**
 * Real-world scenario tests demonstrating practical CRDT usage patterns
 */
import { KeyvCRDT, type CRDTDocument, type MergeConfig } from '../index';
import { createMemoryStore } from './helpers';

describe('KeyvCRDT - Real-World Scenarios', () => {
  describe('Game Save Sync', () => {
    type GameSave = {
      playerName: string;
      level: number;
      highScore: number;
      totalCoins: number;
      unlockedAchievements: string[];
      lastPlayedAt: number;
    };

    test('should sync game progress between mobile and PC', async () => {
      const cloudStore = createMemoryStore<CRDTDocument<GameSave>>();

      const mobileCache = createMemoryStore<CRDTDocument<GameSave>>();
      const mobile = new KeyvCRDT<GameSave>('mobile', {
        playerName: 'lww',
        level: 'max',
        highScore: 'max',
        totalCoins: 'counter',
        unlockedAchievements: 'union',
        lastPlayedAt: 'max',
      }, mobileCache, cloudStore);

      const pcCache = createMemoryStore<CRDTDocument<GameSave>>();
      const pc = new KeyvCRDT<GameSave>('pc', {
        playerName: 'lww',
        level: 'max',
        highScore: 'max',
        totalCoins: 'counter',
        unlockedAchievements: 'union',
        lastPlayedAt: 'max',
      }, pcCache, cloudStore);

      await mobile.set('save:player1', {
        playerName: 'MobileGamer',
        level: 10,
        highScore: 5000,
        totalCoins: 1000,
        unlockedAchievements: ['first_blood', 'speed_demon'],
        lastPlayedAt: 1000,
      });

      await new Promise(r => setTimeout(r, 10));
      await pc.set('save:player1', {
        playerName: 'PCGamer',
        level: 8,
        highScore: 7500,
        totalCoins: 500,
        unlockedAchievements: ['marathon', 'speed_demon'],
        lastPlayedAt: 2000,
      });

      const mobileView = await mobile.get('save:player1');
      const pcView = await pc.get('save:player1');

      // Sort arrays for comparison
      const sortedMobileView = { ...mobileView, unlockedAchievements: mobileView?.unlockedAchievements?.sort() };
      const sortedPcView = { ...pcView, unlockedAchievements: pcView?.unlockedAchievements?.sort() };
      expect(sortedMobileView).toEqual(sortedPcView);

      expect(mobileView?.playerName).toBe('PCGamer'); // LWW
      expect(mobileView?.level).toBe(10); // MAX
      expect(mobileView?.highScore).toBe(7500); // MAX
      expect(mobileView?.totalCoins).toBe(1500); // COUNTER
      expect(mobileView?.unlockedAchievements?.sort()).toEqual(['first_blood', 'marathon', 'speed_demon']);
      expect(mobileView?.lastPlayedAt).toBe(2000); // MAX
    });
  });

  describe('Collaborative Document', () => {
    type Document = {
      title: string;
      content: string;
      editedBy: string;
      version: number;
      collaborators: string[];
    };

    test('should handle collaborative editing', async () => {
      const server = createMemoryStore<CRDTDocument<Document>>();

      const alice = new KeyvCRDT<Document>('alice', {
        title: 'lww',
        content: 'lww',
        editedBy: 'lww',
        version: 'max',
        collaborators: 'union',
      }, createMemoryStore(), server);

      const bob = new KeyvCRDT<Document>('bob', {
        title: 'lww',
        content: 'lww',
        editedBy: 'lww',
        version: 'max',
        collaborators: 'union',
      }, createMemoryStore(), server);

      await alice.set('doc:1', {
        title: 'Project Plan',
        content: 'Initial draft',
        editedBy: 'Alice',
        version: 1,
        collaborators: ['alice@example.com'],
      });

      await new Promise(r => setTimeout(r, 10));
      await bob.set('doc:1', {
        title: 'Project Plan',
        content: 'Revised by Bob',
        editedBy: 'Bob',
        version: 2,
        collaborators: ['bob@example.com'],
      });

      const result = await alice.get('doc:1');

      expect(result?.content).toBe('Revised by Bob');
      expect(result?.editedBy).toBe('Bob');
      expect(result?.version).toBe(2);
      expect(result?.collaborators?.sort()).toEqual(['alice@example.com', 'bob@example.com']);
    });
  });

  describe('Shopping Cart Sync', () => {
    type CartItem = { productId: string; quantity: number };
    type Cart = {
      items: CartItem[];
      totalQuantity: number;
      lastModified: number;
    };

    test('should sync shopping cart between devices', async () => {
      const cloudStore = createMemoryStore<CRDTDocument<Cart>>();

      const phone = new KeyvCRDT<Cart>('phone', {
        items: 'union',
        totalQuantity: 'counter',
        lastModified: 'max',
      }, createMemoryStore(), cloudStore);

      const tablet = new KeyvCRDT<Cart>('tablet', {
        items: 'union',
        totalQuantity: 'counter',
        lastModified: 'max',
      }, createMemoryStore(), cloudStore);

      await phone.set('cart:user1', {
        items: [{ productId: 'SKU001', quantity: 2 }],
        totalQuantity: 2,
        lastModified: 1000,
      });

      await tablet.set('cart:user1', {
        items: [{ productId: 'SKU002', quantity: 1 }],
        totalQuantity: 1,
        lastModified: 2000,
      });

      const result = await phone.get('cart:user1');

      expect(result?.items?.length).toBe(2);
      expect(result?.totalQuantity).toBe(3);
      expect(result?.lastModified).toBe(2000);
    });
  });

  describe('Offline-First Todo App', () => {
    type Todo = {
      text: string;
      completed: boolean;
      completedAt: number;
      updatedAt: number;
    };

    test('should handle offline edits and sync when online', async () => {
      const serverStore = createMemoryStore<CRDTDocument<Todo>>();

      const config: MergeConfig<Todo> = {
        text: 'lww',
        completed: 'lww',
        completedAt: 'max',
        updatedAt: 'max',
      };

      const phoneLocal = createMemoryStore<CRDTDocument<Todo>>();
      const phoneOffline = new KeyvCRDT<Todo>('phone', config, phoneLocal);

      const desktopLocal = createMemoryStore<CRDTDocument<Todo>>();
      const desktop = new KeyvCRDT<Todo>('desktop', config, desktopLocal, serverStore);

      await desktop.set('todo:1', {
        text: 'Buy groceries (urgent)',
        completed: false,
        completedAt: 0,
        updatedAt: 1000,
      });

      await phoneOffline.set('todo:1', {
        text: 'Buy groceries',
        completed: false,
        completedAt: 0,
        updatedAt: 500,
      });

      await new Promise(r => setTimeout(r, 10));
      const completedAt = Date.now();
      await phoneOffline.set('todo:1', {
        text: 'Buy groceries',
        completed: true,
        completedAt: completedAt,
        updatedAt: completedAt,
      });

      // Phone comes back online
      const phoneOnline = new KeyvCRDT<Todo>('phone', config, phoneLocal, serverStore);

      await phoneOnline.set('todo:1', {
        text: 'Buy groceries',
        completed: true,
        completedAt: completedAt,
        updatedAt: completedAt,
      });

      const phoneTodo = await phoneOnline.get('todo:1');
      const desktopTodo = await desktop.get('todo:1');

      expect(phoneTodo?.completed).toBe(true);
      expect(desktopTodo?.completed).toBe(true);
      expect(phoneTodo?.completedAt).toBe(completedAt);
    });
  });

  describe('User Settings Sync', () => {
    type Settings = {
      theme: 'light' | 'dark';
      fontSize: number;
      notifications: boolean;
      favoriteColors: string[];
      loginCount: number;
    };

    test('should sync user settings across devices', async () => {
      const cloud = createMemoryStore<CRDTDocument<Settings>>();

      const laptop = new KeyvCRDT<Settings>('laptop', {
        theme: 'lww',
        fontSize: 'lww',
        notifications: 'lww',
        favoriteColors: 'union',
        loginCount: 'counter',
      }, createMemoryStore(), cloud);

      const phone = new KeyvCRDT<Settings>('phone', {
        theme: 'lww',
        fontSize: 'lww',
        notifications: 'lww',
        favoriteColors: 'union',
        loginCount: 'counter',
      }, createMemoryStore(), cloud);

      await laptop.set('settings:user1', {
        theme: 'dark',
        fontSize: 14,
        notifications: true,
        favoriteColors: ['blue', 'green'],
        loginCount: 1,
      });

      await new Promise(r => setTimeout(r, 10));
      await phone.set('settings:user1', {
        theme: 'light',
        fontSize: 16,
        notifications: false,
        favoriteColors: ['red', 'blue'],
        loginCount: 1,
      });

      const result = await laptop.get('settings:user1');

      expect(result?.theme).toBe('light');
      expect(result?.fontSize).toBe(16);
      expect(result?.notifications).toBe(false);
      expect(result?.favoriteColors?.sort()).toEqual(['blue', 'green', 'red']);
      expect(result?.loginCount).toBe(2);
    });
  });

  describe('Analytics Events', () => {
    type Analytics = {
      pageViews: number;
      clicks: number;
      sessionDuration: number;
      events: string[];
      lastSeen: number;
    };

    test('should aggregate analytics from multiple sources', async () => {
      const central = createMemoryStore<CRDTDocument<Analytics>>();

      const edge1 = new KeyvCRDT<Analytics>('edge-us', {
        pageViews: 'counter',
        clicks: 'counter',
        sessionDuration: 'max',
        events: 'union',
        lastSeen: 'max',
      }, createMemoryStore(), central);

      const edge2 = new KeyvCRDT<Analytics>('edge-eu', {
        pageViews: 'counter',
        clicks: 'counter',
        sessionDuration: 'max',
        events: 'union',
        lastSeen: 'max',
      }, createMemoryStore(), central);

      const edge3 = new KeyvCRDT<Analytics>('edge-asia', {
        pageViews: 'counter',
        clicks: 'counter',
        sessionDuration: 'max',
        events: 'union',
        lastSeen: 'max',
      }, createMemoryStore(), central);

      await edge1.set('user:123', {
        pageViews: 100,
        clicks: 50,
        sessionDuration: 300,
        events: ['login', 'purchase'],
        lastSeen: 1000,
      });

      await edge2.set('user:123', {
        pageViews: 200,
        clicks: 80,
        sessionDuration: 600,
        events: ['login', 'search'],
        lastSeen: 2000,
      });

      await edge3.set('user:123', {
        pageViews: 50,
        clicks: 20,
        sessionDuration: 150,
        events: ['signup'],
        lastSeen: 500,
      });

      const result = await edge1.get('user:123');

      expect(result?.pageViews).toBe(350);
      expect(result?.clicks).toBe(150);
      expect(result?.sessionDuration).toBe(600);
      expect(result?.events?.sort()).toEqual(['login', 'purchase', 'search', 'signup']);
      expect(result?.lastSeen).toBe(2000);
    });
  });

  describe('Distributed Inventory', () => {
    type Inventory = {
      available: number;
      reserved: number;
      sold: number;
      lastUpdated: number;
    };

    test('should track inventory across warehouses', async () => {
      const central = createMemoryStore<CRDTDocument<Inventory>>();

      const warehouse1 = new KeyvCRDT<Inventory>('warehouse-1', {
        available: 'counter',
        reserved: 'counter',
        sold: 'counter',
        lastUpdated: 'max',
      }, createMemoryStore(), central);

      const warehouse2 = new KeyvCRDT<Inventory>('warehouse-2', {
        available: 'counter',
        reserved: 'counter',
        sold: 'counter',
        lastUpdated: 'max',
      }, createMemoryStore(), central);

      await warehouse1.set('product:SKU001', {
        available: 100,
        reserved: 10,
        sold: 50,
        lastUpdated: Date.now(),
      });

      await warehouse2.set('product:SKU001', {
        available: 200,
        reserved: 25,
        sold: 75,
        lastUpdated: Date.now(),
      });

      const result = await warehouse1.get('product:SKU001');

      expect(result?.available).toBe(300);
      expect(result?.reserved).toBe(35);
      expect(result?.sold).toBe(125);
    });
  });

  describe('Leaderboard System', () => {
    type PlayerStats = {
      username: string;
      highScore: number;
      bestTime: number;
      gamesPlayed: number;
      achievements: string[];
    };

    test('should maintain competitive leaderboard stats', async () => {
      const globalServer = createMemoryStore<CRDTDocument<PlayerStats>>();

      const mobile = new KeyvCRDT<PlayerStats>('mobile', {
        username: 'lww',
        highScore: 'max',
        bestTime: 'min',
        gamesPlayed: 'counter',
        achievements: 'union',
      }, createMemoryStore(), globalServer);

      const console = new KeyvCRDT<PlayerStats>('console', {
        username: 'lww',
        highScore: 'max',
        bestTime: 'min',
        gamesPlayed: 'counter',
        achievements: 'union',
      }, createMemoryStore(), globalServer);

      await mobile.set('player:alice', {
        username: 'Alice',
        highScore: 10000,
        bestTime: 120,
        gamesPlayed: 5,
        achievements: ['beginner', 'collector'],
      });

      await console.set('player:alice', {
        username: 'AliceGaming',
        highScore: 15000,
        bestTime: 95,
        gamesPlayed: 10,
        achievements: ['speedrunner', 'collector'],
      });

      const result = await mobile.get('player:alice');

      expect(result?.highScore).toBe(15000);
      expect(result?.bestTime).toBe(95);
      expect(result?.gamesPlayed).toBe(15);
      expect(result?.achievements?.sort()).toEqual(['beginner', 'collector', 'speedrunner']);
    });
  });
});
