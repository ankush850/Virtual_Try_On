import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PresignUploadResult, StoragePort } from './storage.port';

/**
 * Local filesystem storage for environments where MinIO/R2 cannot be pulled or reached.
 * Presigned upload URLs point at the API local upload endpoint with an HMAC token.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;
  private readonly apiPublicBase: string;
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.rootDir = join(process.cwd(), 'storage-data');
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
    this.publicBaseUrl = (config.get<string>('storage.publicBaseUrl') ?? 'http://localhost:4000/api/v1/uploads/files').replace(
      /\/$/,
      '',
    );
    this.apiPublicBase = (
      config.get<string>('storage.localUploadBaseUrl') ?? 'http://localhost:4000/api/v1/uploads/local'
    ).replace(/\/$/, '');
    this.secret = config.get<string>('jwt.accessSecret') ?? 'local-storage-secret';
  }

  async createPresignedUpload(
    key: string,
    mimeType: string,
    ttlSec: number,
  ): Promise<PresignUploadResult> {
    const expires = Math.floor(Date.now() / 1000) + ttlSec;
    const token = this.sign(key, expires);
    const uploadUrl = `${this.apiPublicBase}?key=${encodeURIComponent(key)}&expires=${expires}&token=${token}`;
    return {
      uploadUrl,
      storageKey: key,
      headers: { 'Content-Type': mimeType },
      expiresIn: ttlSec,
    };
  }

  async createPresignedDownload(key: string, ttlSec: number, fileName?: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSec;
    const token = this.sign(key, expires);
    const q = new URLSearchParams({
      key,
      expires: String(expires),
      token,
    });
    if (fileName) q.set('filename', fileName);
    return `${this.publicBaseUrl}?${q.toString()}`;
  }

  async headObject(key: string) {
    const path = this.resolve(key);
    if (!existsSync(path)) return { exists: false };
    const st = statSync(path);
    return { exists: true, contentLength: st.size, contentType: 'application/octet-stream' };
  }

  async deleteObject(key: string): Promise<void> {
    const path = this.resolve(key);
    if (existsSync(path)) unlinkSync(path);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}?key=${encodeURIComponent(key)}`;
  }

  async readObject(key: string): Promise<Buffer | null> {
    const path = this.resolve(key);
    if (!existsSync(path)) return null;
    const { readFileSync } = await import('fs');
    return readFileSync(path);
  }

  async writeObject(key: string, body: NodeJS.ReadableStream | Buffer, _mimeType?: string): Promise<void> {
    const path = this.resolve(key);
    mkdirSync(dirname(path), { recursive: true });
    if (Buffer.isBuffer(body)) {
      const { writeFileSync } = await import('fs');
      writeFileSync(path, body);
      return;
    }
    await pipeline(body as Readable, createWriteStream(path));
  }

  openReadStream(key: string) {
    return createReadStream(this.resolve(key));
  }

  verifyToken(key: string, expires: number, token: string): boolean {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    return this.sign(key, expires) === token;
  }

  private resolve(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return join(this.rootDir, safe);
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${key}:${expires}`).digest('hex');
  }
}
