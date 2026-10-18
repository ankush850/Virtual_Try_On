import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ErrorCode } from '@vj/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';
import { LocalStorageAdapter } from '../../infrastructure/storage/local.storage';

const ALLOWED_EXTENSIONS = new Set(['glb', 'gltf', 'png', 'webp']);
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export interface UploadResult {
  storageKey: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly localStorageAdapter: LocalStorageAdapter,
  ) {}

  async saveAsset(file: Express.Multer.File): Promise<UploadResult> {
    if (!file) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'No file provided for upload',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds limit of 25MB`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const rawExt = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.has(rawExt)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported file type .${rawExt}. Allowed types: .glb, .gltf, .png, .webp`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = this.resolveMimeType(rawExt, file.mimetype);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `assets/${uuidv4()}-${sanitizedName}`;

    await this.storage.writeObject(storageKey, file.buffer, mimeType);
    const publicUrl = this.storage.publicUrl(storageKey);

    this.logger.log(`Asset saved successfully: key=${storageKey}, size=${file.size} bytes`);

    return {
      storageKey,
      url: publicUrl,
      filename: file.originalname,
      size: file.size,
      mimeType,
    };
  }

  async getFile(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const cleanKey = key.replace(/\.\./g, '').replace(/^\/+/, '');
    const buffer = await this.storage.readObject(cleanKey);
    if (!buffer) {
      throw new AppException(ErrorCode.NOT_FOUND, `File not found: ${cleanKey}`, HttpStatus.NOT_FOUND);
    }

    const ext = cleanKey.split('.').pop()?.toLowerCase() ?? '';
    const contentType = this.resolveMimeType(ext);

    return { buffer, contentType };
  }

  async handleLocalPresignedUpload(
    key: string,
    buffer: Buffer,
    contentType: string,
    expires?: number,
    token?: string,
  ): Promise<void> {
    if (expires && token) {
      const valid = this.localStorageAdapter.verifyToken(key, expires, token);
      if (!valid) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'Invalid or expired upload token',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    await this.storage.writeObject(key, buffer, contentType);
  }

  private resolveMimeType(extension: string, fallbackMime?: string): string {
    switch (extension) {
      case 'glb':
        return 'model/gltf-binary';
      case 'gltf':
        return 'model/gltf+json';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      default:
        return fallbackMime && fallbackMime !== 'application/octet-stream'
          ? fallbackMime
          : 'application/octet-stream';
    }
  }
}
