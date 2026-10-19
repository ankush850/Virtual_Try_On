import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductsRepository } from '../src/modules/products/products.repository';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { JewelleryKind, ProductStatus } from '@prisma/client';

describe('Products Catalogue API Service', () => {
  let productsService: ProductsService;
  let mockRepo: Partial<ProductsRepository>;
  let mockRedis: Partial<RedisService>;
  let mockAudit: Partial<AuditService>;

  const sampleProduct = {
    id: 'prod-001',
    name: 'Celestial Diamond Drop Earrings',
    slug: 'celestial-diamond-drop-earrings',
    sku: 'VJ-EAR-001',
    description: '18K White Gold Teardrop Drops',
    jewelleryKind: JewelleryKind.EARRINGS,
    status: ProductStatus.PUBLISHED,
    priceCents: 1299900,
    currency: 'INR',
    categoryId: 'cat-01',
    category: { id: 'cat-01', name: 'Earrings', slug: 'earrings' },
    images: [
      {
        id: 'img-01',
        url: '/assets/earrings-drop.svg',
        altText: 'Celestial Drops',
        sortOrder: 0,
        isPrimary: true,
      },
    ],
    jewelleryAssets: [
      {
        id: 'asset-01',
        assetType: 'MODEL_GLB',
        url: 'http://localhost:4000/api/v1/uploads/files/celestial-drop.glb',
        storageKey: 'assets/celestial-drop.glb',
        anchorType: 'EAR_LOBE',
        anchorProfile: { anchorType: 'EAR_LOBE', earSide: 'BOTH' },
        defaultScale: 1.0,
        defaultRotationZ: 0,
        mirrorForOppositeEar: true,
        fingerIndex: null,
        metadata: { earSide: 'BOTH' },
        isActive: true,
      },
    ],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepo = {
      findPublishedPage: vi.fn().mockResolvedValue([1, [sampleProduct]]),
      findByIdOrSlug: vi.fn().mockResolvedValue(sampleProduct),
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    productsService = new ProductsService(
      mockRepo as ProductsRepository,
      mockRedis as RedisService,
      mockAudit as AuditService,
    );
  });

  it('lists published products in the catalogue with correct category and images', async () => {
    const result = await productsService.listPublic({
      page: 1,
      pageSize: 10,
      jewelleryKind: JewelleryKind.EARRINGS,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'prod-001',
      name: 'Celestial Diamond Drop Earrings',
      slug: 'celestial-diamond-drop-earrings',
      sku: 'VJ-EAR-001',
      jewelleryKind: 'EARRINGS',
      status: 'PUBLISHED',
      category: { id: 'cat-01', name: 'Earrings', slug: 'earrings' },
      primaryImage: {
        id: 'img-01',
        url: '/assets/earrings-drop.svg',
        altText: 'Celestial Drops',
        sortOrder: 0,
        isPrimary: true,
      },
      priceCents: 1299900,
      currency: 'INR',
    });
  });

  it('retrieves product detail with AR try-on asset configuration', async () => {
    const detail = await productsService.detailPublic('celestial-diamond-drop-earrings');

    expect(detail.id).toBe('prod-001');
    expect(detail.tryOnAsset).toBeDefined();
    expect(detail.tryOnAsset?.anchorProfile.anchorType).toBe('EAR_LOBE');
    expect(detail.tryOnAsset?.assetType).toBe('MODEL_GLB');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'product:slug:celestial-diamond-drop-earrings',
      expect.any(String),
      120,
    );
  });

  it('serves cached product detail from Redis if present', async () => {
    (mockRedis.get as any).mockResolvedValueOnce(
      JSON.stringify({ id: 'prod-cached', name: 'Cached Ring' }),
    );

    const detail = await productsService.detailPublic('prod-cached');

    expect(detail.id).toBe('prod-cached');
    expect(detail.name).toBe('Cached Ring');
    expect(mockRepo.findByIdOrSlug).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND exception when product is missing', async () => {
    (mockRepo.findByIdOrSlug as any).mockResolvedValueOnce(null);

    await expect(productsService.detailPublic('non-existent')).rejects.toThrow(
      /Product not found/,
    );
  });
});
