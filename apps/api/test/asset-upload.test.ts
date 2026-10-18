import { describe, it, expect, beforeEach } from 'vitest';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { LocalStorageAdapter } from '../src/infrastructure/storage/local.storage';
import { ConfigService } from '@nestjs/config';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('Admin AR Asset Upload & Link Flow', () => {
  let uploadsService: UploadsService;
  let localStorageAdapter: LocalStorageAdapter;
  const storageDir = join(process.cwd(), 'storage-data');

  beforeEach(() => {
    const configService = new ConfigService({
      storage: {
        publicBaseUrl: 'http://localhost:4000/api/v1/uploads/files',
        localUploadBaseUrl: 'http://localhost:4000/api/v1/uploads/local',
      },
      jwt: {
        accessSecret: 'test-secret-at-least-32-characters-long-key',
      },
    });

    localStorageAdapter = new LocalStorageAdapter(configService);
    uploadsService = new UploadsService(localStorageAdapter, localStorageAdapter);
  });

  it('rejects unsupported file formats', async () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'malicious.exe',
      encoding: '7bit',
      mimetype: 'application/x-msdownload',
      size: 1024,
      destination: '',
      filename: '',
      path: '',
      buffer: Buffer.from('binary-content'),
      stream: null as any,
    };

    await expect(uploadsService.saveAsset(mockFile)).rejects.toThrow(/Unsupported file type/);
  });

  it('rejects files exceeding 25MB limit', async () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'huge_model.glb',
      encoding: '7bit',
      mimetype: 'model/gltf-binary',
      size: 26 * 1024 * 1024,
      destination: '',
      filename: '',
      path: '',
      buffer: Buffer.from('large-file'),
      stream: null as any,
    };

    await expect(uploadsService.saveAsset(mockFile)).rejects.toThrow(/exceeds limit/);
  });

  it('successfully uploads a .glb 3D model and returns storageKey and public url', async () => {
    const dummyBuffer = Buffer.from('glTF 3D model dummy buffer header');
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'aurora_diamond_earring.glb',
      encoding: '7bit',
      mimetype: 'model/gltf-binary',
      size: dummyBuffer.length,
      destination: '',
      filename: '',
      path: '',
      buffer: dummyBuffer,
      stream: null as any,
    };

    const res = await uploadsService.saveAsset(mockFile);

    expect(res).toBeDefined();
    expect(res.storageKey).toMatch(/^assets\/[a-f0-9-]+-aurora_diamond_earring\.glb$/);
    expect(res.url).toContain(encodeURIComponent(res.storageKey));
    expect(res.mimeType).toBe('model/gltf-binary');
    expect(res.size).toBe(dummyBuffer.length);

    // Verify stored file can be retrieved
    const retrieved = await uploadsService.getFile(res.storageKey);
    expect(retrieved.buffer.toString()).toBe('glTF 3D model dummy buffer header');
    expect(retrieved.contentType).toBe('model/gltf-binary');
  });

  it('successfully uploads a 2D PNG sprite and resolves image/png mimeType', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'gold_choker.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: pngBuffer.length,
      destination: '',
      filename: '',
      path: '',
      buffer: pngBuffer,
      stream: null as any,
    };

    const res = await uploadsService.saveAsset(mockFile);
    expect(res.storageKey).toMatch(/^assets\/[a-f0-9-]+-gold_choker\.png$/);
    expect(res.mimeType).toBe('image/png');

    const retrieved = await uploadsService.getFile(res.storageKey);
    expect(retrieved.contentType).toBe('image/png');
  });
});
