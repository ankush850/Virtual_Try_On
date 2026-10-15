import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class JewelleryAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(productId: string) {
    return this.prisma.jewelleryAsset.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { version: 'desc' }],
    });
  }

  async create(
    productId: string,
    dto: {
      assetType: AssetType;
      storageKey: string;
      url: string;
      anchorProfile: Record<string, unknown>;
      defaultScale?: number;
      defaultRotationZ?: number;
      mirrorForOppositeEar?: boolean;
      fingerIndex?: number | null;
      isActive?: boolean;
    },
    actorId: string,
  ) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found', HttpStatus.NOT_FOUND);

    if (dto.isActive !== false) {
      await this.prisma.jewelleryAsset.updateMany({
        where: { productId, deletedAt: null, isActive: true },
        data: { isActive: false },
      });
    }

    const created = await this.prisma.jewelleryAsset.create({
      data: {
        productId,
        kind: product.jewelleryKind,
        assetType: dto.assetType,
        storageKey: dto.storageKey,
        url: dto.url,
        anchorProfile: dto.anchorProfile as Prisma.InputJsonValue,
        defaultScale: dto.defaultScale ?? 1,
        defaultRotationZ: dto.defaultRotationZ ?? 0,
        mirrorForOppositeEar: dto.mirrorForOppositeEar ?? false,
        fingerIndex: dto.fingerIndex ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({
      actorUserId: actorId,
      action: 'ASSET_CREATE',
      entityType: 'JewelleryAsset',
      entityId: created.id,
      after: created,
    });
    return created;
  }

  async activate(productId: string, assetId: string, actorId: string) {
    const asset = await this.prisma.jewelleryAsset.findFirst({
      where: { id: assetId, productId, deletedAt: null },
    });
    if (!asset) throw new AppException(ErrorCode.NOT_FOUND, 'Asset not found', HttpStatus.NOT_FOUND);
    await this.prisma.$transaction([
      this.prisma.jewelleryAsset.updateMany({
        where: { productId, deletedAt: null },
        data: { isActive: false },
      }),
      this.prisma.jewelleryAsset.update({
        where: { id: assetId },
        data: { isActive: true },
      }),
    ]);
    await this.audit.record({
      actorUserId: actorId,
      action: 'ASSET_ACTIVATE',
      entityType: 'JewelleryAsset',
      entityId: assetId,
    });
    return this.list(productId);
  }
}
