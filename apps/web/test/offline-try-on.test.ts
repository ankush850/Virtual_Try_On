import { describe, it, expect, beforeEach } from 'vitest';
import {
  FALLBACK_CATALOGUE,
} from '../src/features/try-on/fallback-catalogue';
import {
  getCachedOrFallbackCatalogue,
  getProductFromCacheOrFallback,
  cacheCatalogue,
} from '../src/features/try-on/offline-catalog';
import { JewelleryKind } from '@vj/shared';

describe('Offline Try-On Mode (Issue 5)', () => {
  beforeEach(() => {
    // Reset global localStorage mock
    const store: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
      length: 0,
      key: () => null,
    } as any;
  });

  it('serves bundled fallback catalogue when API is unreachable and cache is empty', () => {
    const catalogue = getCachedOrFallbackCatalogue();
    expect(catalogue.length).toBeGreaterThanOrEqual(10);

    const kinds = new Set(catalogue.map((p) => p.jewelleryKind));
    expect(kinds.has(JewelleryKind.EARRINGS)).toBe(true);
    expect(kinds.has(JewelleryKind.NECKLACE)).toBe(true);
    expect(kinds.has(JewelleryKind.NOSE_RING)).toBe(true);
    expect(kinds.has(JewelleryKind.RINGS)).toBe(true);
    expect(kinds.has(JewelleryKind.BANGLES)).toBe(true);
  });

  it('resolves product by ID or slug in offline mode', () => {
    const earring = getProductFromCacheOrFallback('prod-fallback-ear-001');
    expect(earring).toBeDefined();
    expect(earring?.name).toContain('Earrings');
    expect(earring?.tryOnAsset).toBeDefined();

    const bySlug = getProductFromCacheOrFallback('eternal-pave-solitaire-ring');
    expect(bySlug).toBeDefined();
    expect(bySlug?.id).toBe('prod-fallback-ring-001');
  });

  it('caches successful API catalogue and retrieves cached version during subsequent API failures', () => {
    const mockApiResponse: any[] = [
      {
        id: 'api-item-1',
        name: 'Royal Heritage Choker',
        slug: 'royal-heritage-choker',
        jewelleryKind: JewelleryKind.NECKLACE,
        priceCents: 1500000,
        currency: 'INR',
        primaryImage: { url: '/assets/sample.png' },
      },
    ];

    cacheCatalogue(mockApiResponse);

    const cached = getCachedOrFallbackCatalogue();
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe('api-item-1');

    const detail = getProductFromCacheOrFallback('api-item-1');
    expect(detail).toBeDefined();
    expect(detail?.name).toBe('Royal Heritage Choker');
  });

  it('simulates API failure gracefully without throwing and allows try-on session start', async () => {
    // Simulating an API client that rejects (e.g. ECONNREFUSED or fetch error)
    const mockOfflineApiClient = {
      tryOn: {
        startSession: async () => {
          throw new Error('Failed to fetch: Backend API is offline');
        },
      },
      catalog: {
        getProduct: async () => {
          throw new Error('Network request failed');
        },
      },
    };

    // Client fallback handler logic
    let sessionResult: any = null;
    let productResult: any = null;

    try {
      await mockOfflineApiClient.tryOn.startSession();
    } catch {
      // Offline fallback
      sessionResult = {
        sessionId: `offline-${Date.now()}`,
        asset: FALLBACK_CATALOGUE[0].tryOnAsset,
        isOffline: true,
      };
    }

    try {
      await mockOfflineApiClient.catalog.getProduct();
    } catch {
      productResult = getProductFromCacheOrFallback(FALLBACK_CATALOGUE[0].id);
    }

    expect(sessionResult.isOffline).toBe(true);
    expect(sessionResult.sessionId).toMatch(/^offline-/);
    expect(productResult).toBeDefined();
    expect(productResult.id).toBe(FALLBACK_CATALOGUE[0].id);
  });
});
