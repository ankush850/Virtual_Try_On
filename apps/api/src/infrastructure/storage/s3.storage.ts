import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PresignUploadResult, StoragePort } from './storage.port';

@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('storage.bucket');
    this.publicBaseUrl = config.getOrThrow<string>('storage.publicBaseUrl').replace(/\/$/, '');
    this.client = new S3Client({
      region: config.get<string>('storage.region') ?? 'us-east-1',
      endpoint: config.get<string>('storage.endpoint'),
      forcePathStyle: config.get<boolean>('storage.forcePathStyle') ?? true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('storage.accessKey'),
        secretAccessKey: config.getOrThrow<string>('storage.secretKey'),
      },
    });
  }

  async createPresignedUpload(
    key: string,
    mimeType: string,
    ttlSec: number,
  ): Promise<PresignUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: ttlSec });
    return {
      uploadUrl,
      storageKey: key,
      headers: { 'Content-Type': mimeType },
      expiresIn: ttlSec,
    };
  }

  async createPresignedDownload(key: string, ttlSec: number, fileName?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: fileName
        ? `attachment; filename="${fileName.replace(/"/g, '')}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSec });
  }

  async headObject(key: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        exists: true,
        contentLength: res.ContentLength,
        contentType: res.ContentType,
      };
    } catch {
      return { exists: false };
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async readObject(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }

  async writeObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  }
}
