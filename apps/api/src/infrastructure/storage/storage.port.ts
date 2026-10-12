export const STORAGE_PORT = Symbol('STORAGE_PORT');

export type PresignUploadResult = {
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresIn: number;
};

export interface StoragePort {
  createPresignedUpload(
    key: string,
    mimeType: string,
    ttlSec: number,
  ): Promise<PresignUploadResult>;
  createPresignedDownload(key: string, ttlSec: number, fileName?: string): Promise<string>;
  headObject(key: string): Promise<{ exists: boolean; contentLength?: number; contentType?: string }>;
  deleteObject(key: string): Promise<void>;
  publicUrl(key: string): string;
  readObject(key: string): Promise<Buffer | null>;
  writeObject(key: string, body: Buffer, mimeType: string): Promise<void>;
}
