/**
 * Image uploads for banners. Files are stored on a Docker volume and served
 * with long-lived caching; names are random so they are never guessed or
 * overwritten. Only real JPEG / PNG / WebP images (checked by magic bytes).
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './admin.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const MAX_BYTES = 3 * 1024 * 1024;

function sniff(buf: Buffer): { ext: string; type: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function mediaRoutes(app: FastifyInstance) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 0 } });

  app.post('/v1/admin/uploads', { preHandler: requireAdmin, bodyLimit: MAX_BYTES + 64 * 1024 }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const buf = await file.toBuffer().catch(() => null);
    if (!buf || file.file.truncated) return reply.code(413).send({ error: 'file_too_large' });
    const kind = sniff(buf);
    if (!kind) return reply.code(415).send({ error: 'unsupported_image' });
    const name = `${randomUUID()}.${kind.ext}`;
    await writeFile(join(UPLOAD_DIR, name), buf, { mode: 0o644 });
    req.log.info({ admin: req.userId, name, bytes: buf.length }, 'admin: image uploaded');
    return reply.code(201).send({ url: `/uploads/${name}` });
  });

  const Name = z.object({ name: z.string().regex(/^[0-9a-f-]{36}\.(jpg|png|webp)$/) });
  app.get('/uploads/:name', async (req, reply) => {
    const parsed = Name.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: 'not_found' });
    const path = join(UPLOAD_DIR, parsed.data.name);
    const st = await stat(path).catch(() => null);
    if (!st) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', TYPES[parsed.data.name.split('.').pop()!])
      .header('content-length', st.size)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(createReadStream(path));
  });
}
