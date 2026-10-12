import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, TryOnSessionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── Start session ─────────────────────────────────────────────────────────

  async start(
    productId: string,
    userId: string | undefined,
    clientInfo?: Record<string, unknown>,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null, status: 'PUBLISHED' },
      include: {
        jewelleryAssets: {
          where: { deletedAt: null, isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!product) {
      throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found', HttpStatus.NOT_FOUND);
    }

    const asset = product.jewelleryAssets[0];
    if (!asset) {
      throw new AppException(
        ErrorCode.ASSET_INACTIVE,
        'No active try-on asset for this product',
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.prisma.tryOnSession.create({
      data: {
        productId,
        userId:      userId ?? null,
        jewelleryKind: product.jewelleryKind,
        clientInfo:  (clientInfo as Prisma.InputJsonValue) ?? undefined,
        status:      TryOnSessionStatus.ACTIVE,
      },
    });

    // Cache active session ID in Redis for fast lookups (15 min TTL)
    await this.redis.set(
      `tryon:session:${session.id}`,
      JSON.stringify({ productId, userId, status: 'ACTIVE' }),
      900,
    );

    // Increment product try-on counter in Redis for real-time analytics
    await this.redis.raw.incr(`tryon:product:${productId}:count`).catch(() => {});

    this.logger.log(
      `TryOn session started: ${session.id} | product: ${productId} | user: ${userId ?? 'anon'}`,
    );

    return {
      sessionId:    session.id,
      productId:    product.id,
      jewelleryKind: product.jewelleryKind,
      status:       session.status,
      asset: {
        id:                  asset.id,
        assetType:           asset.assetType,
        url:                 asset.url,
        anchorProfile:       asset.anchorProfile,
        defaultScale:        asset.defaultScale,
        defaultRotationZ:    asset.defaultRotationZ,
        mirrorForOppositeEar: asset.mirrorForOppositeEar,
        fingerIndex:         asset.fingerIndex,
      },
    };
  }

  // ─── Patch session (status / metrics) ──────────────────────────────────────

  async patch(
    sessionId: string,
    data: {
      status?:  TryOnSessionStatus;
      metrics?: Record<string, unknown>;
      events?:  ArAnalyticsEvent[];
    },
    userId?: string,
  ) {
    const session = await this._requireSession(sessionId);

    if (session.userId && userId && session.userId !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Not your session', HttpStatus.FORBIDDEN);
    }

    // Merge existing metrics with new metrics.
    const prevMetrics = (session.metrics as Record<string, unknown>) ?? {};
    const merged = data.metrics
      ? { ...prevMetrics, ...data.metrics, updatedAt: new Date().toISOString() }
      : prevMetrics;

    // Append analytics events if provided.
    if (data.events?.length) {
      const prevEvents = (prevMetrics['events'] as unknown[]) ?? [];
      const newEvents  = data.events.map((e) => ({ ...e, ts: new Date().toISOString() }));
      merged['events'] = [...prevEvents, ...newEvents].slice(-200); // cap at 200
    }

    const isTerminal =
      data.status && data.status !== TryOnSessionStatus.ACTIVE;

    const updated = await this.prisma.tryOnSession.update({
      where: { id: sessionId },
      data: {
        status:  data.status,
        metrics: merged as Prisma.InputJsonValue,
        endedAt: isTerminal ? new Date() : undefined,
      },
    });

    // Update Redis cache
    if (isTerminal) {
      await this.redis.del(`tryon:session:${sessionId}`);
    } else {
      await this.redis.set(
        `tryon:session:${sessionId}`,
        JSON.stringify({ productId: session.productId, userId: session.userId, status: data.status ?? session.status }),
        900,
      );
    }

    return updated;
  }

  // ─── Record analytics event ────────────────────────────────────────────────

  async recordEvent(sessionId: string, event: ArAnalyticsEvent) {
    const session = await this._requireSession(sessionId);

    const prevMetrics = (session.metrics as Record<string, unknown>) ?? {};
    const prevEvents  = (prevMetrics['events'] as unknown[]) ?? [];

    await this.prisma.tryOnSession.update({
      where: { id: sessionId },
      data: {
        metrics: {
          ...prevMetrics,
          events: [
            ...prevEvents,
            { ...event, ts: new Date().toISOString() },
          ].slice(-200),
        } as Prisma.InputJsonValue,
      },
    });
  }

  // ─── Record batch analytics events (for buffered client sends) ─────────────

  async recordEvents(sessionId: string, events: ArAnalyticsEvent[]) {
    if (!events.length) return;

    const session = await this._requireSession(sessionId);
    const prevMetrics = (session.metrics as Record<string, unknown>) ?? {};
    const prevEvents  = (prevMetrics['events'] as unknown[]) ?? [];

    const timestamped = events.map((e) => ({ ...e, ts: new Date().toISOString() }));

    await this.prisma.tryOnSession.update({
      where: { id: sessionId },
      data: {
        metrics: {
          ...prevMetrics,
          events: [...prevEvents, ...timestamped].slice(-200),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** Refresh the active-session cache so a live fitting is not treated as abandoned. */
  async heartbeat(sessionId: string, userId?: string) {
    const session = await this._requireSession(sessionId);
    if (session.userId && userId && session.userId !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Not your session', HttpStatus.FORBIDDEN);
    }
    if (session.status !== TryOnSessionStatus.ACTIVE) {
      return { ok: false, status: session.status };
    }
    await this.redis.set(
      `tryon:session:${sessionId}`,
      JSON.stringify({
        productId: session.productId,
        userId: session.userId,
        status: session.status,
      }),
      900,
    );
    return { ok: true, status: session.status };
  }

  // ─── Get session ───────────────────────────────────────────────────────────

  async get(sessionId: string, userId?: string) {
    // Try Redis cache first
    const cached = await this.redis.get(`tryon:session:${sessionId}`);
    if (cached) {
      const data = JSON.parse(cached);
      if (userId && data.userId && data.userId !== userId) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Not your session', HttpStatus.FORBIDDEN);
      }
    }

    const session = await this._requireSession(sessionId);
    if (userId && session.userId && session.userId !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Not your session', HttpStatus.FORBIDDEN);
    }
    return session;
  }

  // ─── List user sessions ────────────────────────────────────────────────────

  async listMine(userId: string, page: number, pageSize: number) {
    const where = { userId, deletedAt: null };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.tryOnSession.count({ where }),
      this.prisma.tryOnSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: { product: { select: { id: true, name: true, jewelleryKind: true } } },
      }),
    ]);
    return { items, total };
  }

  // ─── Summarize session metrics ─────────────────────────────────────────────

  async summarize(sessionId: string) {
    const session = await this._requireSession(sessionId);
    const metrics = (session.metrics as Record<string, unknown>) ?? {};
    const events  = (metrics['events'] as ArAnalyticsEvent[]) ?? [];

    const trackingEvents = events.filter((e) => e.type === 'tracking_change');
    const totalTracked   = trackingEvents.filter((e) => e.value === 'TRACKING').length;
    const totalLost      = trackingEvents.filter((e) => e.value === 'LOST').length;
    const captures       = events.filter((e) => e.type === 'capture').length;
    const productSwaps   = events.filter((e) => e.type === 'product_swap').length;

    const duration =
      session.endedAt
        ? session.endedAt.getTime() - session.createdAt.getTime()
        : Date.now() - session.createdAt.getTime();

    // Extract performance metrics if available
    const perfEvents = events.filter((e) => e.type === 'performance');
    const avgFps = perfEvents.length > 0
      ? perfEvents.reduce((sum, e) => sum + (Number(e.value) || 0), 0) / perfEvents.length
      : null;

    return {
      sessionId:      session.id,
      status:         session.status,
      durationMs:     duration,
      totalEvents:    events.length,
      captures,
      productSwaps,
      totalTracked,
      totalLost,
      avgFps,
      jewelleryKind:  session.jewelleryKind,
      productId:      session.productId,
    };
  }

  // ─── Get try-on asset for a product (cached) ──────────────────────────────

  async getProductAsset(productId: string) {
    const cacheKey = `tryon:asset:${productId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null, status: 'PUBLISHED' },
      include: {
        jewelleryAssets: {
          where: { deletedAt: null, isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!product) return null;

    const asset = product.jewelleryAssets[0];
    if (!asset) return null;

    const result = {
      productId: product.id,
      jewelleryKind: product.jewelleryKind,
      asset: {
        id:                  asset.id,
        assetType:           asset.assetType,
        url:                 asset.url,
        anchorProfile:       asset.anchorProfile,
        defaultScale:        asset.defaultScale,
        defaultRotationZ:    asset.defaultRotationZ,
        mirrorForOppositeEar: asset.mirrorForOppositeEar,
        fingerIndex:         asset.fingerIndex,
      },
    };

    // Cache for 5 minutes
    await this.redis.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  // ─── Batch asset lookup for preloading ─────────────────────────────────────

  async getProductAssets(productIds: string[]) {
    const results = await Promise.all(
      productIds.map((id) => this.getProductAsset(id)),
    );
    return results.filter(Boolean);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async _requireSession(sessionId: string) {
    const session = await this.prisma.tryOnSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) {
      throw new AppException(
        ErrorCode.SESSION_NOT_FOUND,
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }
}

// ─── Analytics event types ─────────────────────────────────────────────────

export type ArAnalyticsEvent = {
  type:     string;
  value?:   string | number;
  meta?:    Record<string, unknown>;
  ts?:      string;
};
