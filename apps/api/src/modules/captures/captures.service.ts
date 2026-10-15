import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaptureStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { processCaptureImage } from './image-processor';

@Injectable()
export class CapturesService {
  private readonly logger = new Logger(CapturesService.name);

  constructor(
    private readonly prisma:  PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly config:  ConfigService,
  ) {}

  // ─── Register a new capture ────────────────────────────────────────────────

  async register(
    sessionId: string,
    input: {
      storageKey:   string;
      width?:       number;
      height?:      number;
      mimeType:     string;
      fileSizeBytes?: number;
      thumbnailKey?: string;
    },
    userId?: string,
  ) {
    const session = await this.prisma.tryOnSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) {
      throw new AppException(ErrorCode.SESSION_NOT_FOUND, 'Session not found', HttpStatus.NOT_FOUND);
    }

    const bytes = await this.storage.readObject(input.storageKey);
    if (!bytes) {
      throw new AppException(
        ErrorCode.STORAGE_ERROR,
        'Capture object missing from storage',
        HttpStatus.BAD_REQUEST,
      );
    }

    const processed = await this._processBytes(input.storageKey, bytes);
    const ttlDays  = this.config.get<number>('capturesDefaultTtlDays') ?? 30;
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const url       = this.storage.publicUrl(input.storageKey);
    const thumbUrl  = processed.thumbKey ? this.storage.publicUrl(processed.thumbKey) : null;

    const capture = await this.prisma.capturedImage.create({
      data: {
        sessionId,
        userId:        userId ?? session.userId,
        productId:     session.productId,
        storageKey:    input.storageKey,
        url,
        thumbStorageKey: processed.thumbKey,
        width:         processed.width || input.width,
        height:        processed.height || input.height,
        mimeType:      processed.mimeType || input.mimeType,
        fileSizeBytes: input.fileSizeBytes ?? bytes.length,
        status:        CaptureStatus.READY,
        expiresAt,
      },
    });

    const downloadTtl = this.config.get<number>('storage.presignDownloadTtlSec') ?? 120;
    const downloadUrl = await this.storage.createPresignedDownload(
      capture.storageKey,
      downloadTtl,
      `tryon-${capture.id}.jpg`,
    );

    this.logger.log(
      `Capture registered: ${capture.id} | session: ${sessionId} | size: ${capture.fileSizeBytes}B`,
    );

    return {
      id:        capture.id,
      status:    capture.status,
      url:       downloadUrl,
      thumbUrl:  thumbUrl,
      expiresAt: capture.expiresAt,
      width:     capture.width,
      height:    capture.height,
      mimeType:  capture.mimeType,
    };
  }

  // ─── Generate presigned upload URL ────────────────────────────────────────

  async requestUploadUrl(
    sessionId: string,
    input: { mimeType: string; fileSize: number },
    userId?: string,
  ) {
    const session = await this.prisma.tryOnSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) {
      throw new AppException(ErrorCode.SESSION_NOT_FOUND, 'Session not found', HttpStatus.NOT_FOUND);
    }
    if (session.userId && userId && session.userId !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Not your session', HttpStatus.FORBIDDEN);
    }

    const maxBytes = this.config.get<number>('captures.maxFileSizeBytes') ?? 15 * 1024 * 1024;
    if (input.fileSize > maxBytes) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `File too large (max ${maxBytes / 1024 / 1024} MB)`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const uploadTtl = this.config.get<number>('storage.presignUploadTtlSec') ?? 300;
    const ext       = input.mimeType === 'image/png' ? 'png' : 'jpg';
    const storageKey = `captures/${sessionId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const presigned = await this.storage.createPresignedUpload(
      storageKey,
      input.mimeType,
      uploadTtl,
    );

    return {
      uploadUrl: presigned.uploadUrl,
      storageKey: presigned.storageKey,
      headers: presigned.headers,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * Re-run thumbnail generation for an existing capture.
   * Used when the original register step stored the full image before processing,
   * or when a client asks the API to rebuild the derivative.
   */
  async processStoredImage(sessionId: string, captureId: string, userId?: string) {
    const capture = await this.get(captureId, userId);
    if (capture.sessionId !== sessionId) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Capture not in this session', HttpStatus.NOT_FOUND);
    }
    const bytes = await this.storage.readObject(capture.storageKey);
    if (!bytes) {
      throw new AppException(ErrorCode.STORAGE_ERROR, 'Capture object missing', HttpStatus.BAD_REQUEST);
    }
    const processed = await this._processBytes(capture.storageKey, bytes);
    const updated = await this.prisma.capturedImage.update({
      where: { id: capture.id },
      data: {
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        thumbStorageKey: processed.thumbKey,
        fileSizeBytes: bytes.length,
      },
    });
    return {
      id: updated.id,
      width: updated.width,
      height: updated.height,
      mimeType: updated.mimeType,
      thumbUrl: processed.thumbKey ? this.storage.publicUrl(processed.thumbKey) : null,
    };
  }

  private async _processBytes(storageKey: string, bytes: Buffer): Promise<{
    width: number;
    height: number;
    mimeType: string;
    thumbKey: string | null;
  }> {
    try {
      const processed = processCaptureImage(bytes, 480);
      const thumbKey = `${storageKey}.thumb.png`;
      await this.storage.writeObject(thumbKey, processed.thumbnail, 'image/png');
      this.logger.log(
        `Image processed: ${processed.width}x${processed.height} → thumb ${processed.thumbWidth}x${processed.thumbHeight}`,
      );
      return {
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        thumbKey,
      };
    } catch (err) {
      this.logger.warn(
        `Image processing failed for ${storageKey}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        err instanceof Error ? err.message : 'Image processing failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ─── List user's captures ──────────────────────────────────────────────────

  async listMine(userId: string, page: number, pageSize: number) {
    const where = { userId, deletedAt: null, status: CaptureStatus.READY };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.capturedImage.count({ where }),
      this.prisma.capturedImage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id:        true,
          url:       true,
          width:     true,
          height:    true,
          mimeType:  true,
          status:    true,
          expiresAt: true,
          createdAt: true,
          productId: true,
          product: { select: { name: true, jewelleryKind: true } },
        },
      }),
    ]);
    return { items, total };
  }

  // ─── Get single capture ────────────────────────────────────────────────────

  async get(id: string, userId?: string, isAdmin = false) {
    const capture = await this.prisma.capturedImage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!capture) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Capture not found', HttpStatus.NOT_FOUND);
    }
    if (!isAdmin && capture.userId && userId && capture.userId !== userId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Forbidden', HttpStatus.FORBIDDEN);
    }
    if (capture.expiresAt && capture.expiresAt.getTime() < Date.now()) {
      throw new AppException(ErrorCode.CAPTURE_EXPIRED, 'Capture has expired', HttpStatus.GONE);
    }
    return capture;
  }

  // ─── Presigned download ────────────────────────────────────────────────────

  async download(id: string, userId?: string) {
    const capture   = await this.get(id, userId);
    const ttl       = this.config.get<number>('storage.presignDownloadTtlSec') ?? 120;
    const fileName  = `tryon-${capture.id}.${capture.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const downloadUrl = await this.storage.createPresignedDownload(
      capture.storageKey,
      ttl,
      fileName,
    );
    return { downloadUrl, fileName, expiresIn: ttl };
  }

  // ─── Soft delete ───────────────────────────────────────────────────────────

  async softDelete(id: string, userId: string) {
    const capture = await this.get(id, userId);
    return this.prisma.capturedImage.update({
      where: { id: capture.id },
      data:  { deletedAt: new Date(), status: CaptureStatus.DELETED },
    });
  }
}
