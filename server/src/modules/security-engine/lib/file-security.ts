/**
 * File upload validation: a reusable Multer instance that rejects
 * disallowed extensions/MIME types and oversized files before a byte
 * touches disk, plus a virus-scan placeholder any upload route can await —
 * no domain in the generated project is guaranteed to have an upload
 * endpoint, so this is emitted as an opt-in utility rather than wired to a
 * specific route.
 */
import type { FileSecurityPolicy, GeneratedFile } from '../security-engine.types.js';
import { file } from './file-tree.js';

export function buildFileSecurityPolicy(): FileSecurityPolicy {
  return {
    maxSizeMb: 10,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.csv'],
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
    ],
    virusScanEnabled: false,
  };
}

function fileUploadMiddleware(policy: FileSecurityPolicy): string {
  return `import path from 'node:path';

import multer from 'multer';
import type { FileFilterCallback } from 'multer';
import type { Request } from 'express';

const ALLOWED_EXTENSIONS = new Set(${JSON.stringify(policy.allowedExtensions)});
const ALLOWED_MIME_TYPES = new Set(${JSON.stringify(policy.allowedMimeTypes)});
const MAX_SIZE_BYTES = ${policy.maxSizeMb} * 1024 * 1024;

function fileFilter(_req: Request, uploaded: Express.Multer.File, callback: FileFilterCallback): void {
  const extension = path.extname(uploaded.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(uploaded.mimetype)) {
    callback(new Error(\`File type not allowed: \${uploaded.originalname} (\${uploaded.mimetype})\`));
    return;
  }
  callback(null, true);
}

/** Rejects disallowed extensions/MIME types and oversized files before the file is buffered. */
export const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter,
});

export interface VirusScanResult {
  clean: boolean;
  scanner: string;
}

/**
 * Placeholder — wire this to a real scanner (e.g. ClamAV via clamscan, or a
 * cloud AV API) before accepting untrusted uploads in production. Always
 * reports clean so the upload pipeline is complete without this phase
 * bundling a scanning engine.
 */
export async function scanForViruses(_buffer: Buffer): Promise<VirusScanResult> {
  await Promise.resolve();
  return { clean: true, scanner: 'none (placeholder — integrate ClamAV or a cloud AV API)' };
}
`;
}

export function emitFileSecurity(policy: FileSecurityPolicy): GeneratedFile[] {
  return [file('src/shared/middleware/file-upload.ts', 'typescript', fileUploadMiddleware(policy))];
}
