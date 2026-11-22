import {
  unstable_createFileUploadHandler,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
  NodeOnDiskFile,
} from "@remix-run/node";
import type { UploadHandler } from "@remix-run/node";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

// Si GCS_BUCKET está definido (producción en Google Cloud Run, donde el disco
// se borra en cada reinicio), los archivos se suben a ese bucket de Cloud
// Storage; sin él (desarrollo local) se guardan en public/uploads.
const GCS_BUCKET = process.env.GCS_BUCKET;
const GCS_PUBLIC_PREFIX = GCS_BUCKET ? `https://storage.googleapis.com/${GCS_BUCKET}/uploads/` : null;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80MB

// Whitelist de tipo de archivo: public/uploads se sirve directo como
// archivos estáticos, así que sin esto se podría subir cualquier extensión
// (.html, .svg con <script>, .php, lo que sea) a una carpeta pública. Se
// valida tanto la extensión como el content-type que manda el navegador —
// ninguno de los dos es infalsificable solo, pero juntos cierran la subida
// casual/automática de archivos que no son imagen o video.
const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".mp4": ["video/mp4"],
  ".webm": ["video/webm"],
  ".mov": ["video/quicktime"],
  ".pdf": ["application/pdf"],
};

function isAllowedUpload(filename: string, contentType: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const allowedContentTypes = ALLOWED_UPLOAD_TYPES[ext];
  return Boolean(allowedContentTypes && allowedContentTypes.includes(contentType));
}

let storageClient: Storage | null = null;

const OPTIMIZABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_IMAGE_WIDTH = 2000;

/**
 * PNG y JPG se convierten a WebP (típicamente 70-90% más ligeros) y se
 * reducen a 2000 px de ancho como máximo: una foto de 2.7 MB subida desde el
 * celular llega al cliente en unos 150 KB. Los GIF (pueden estar animados) y
 * los WebP ya optimizados se dejan tal cual. Si la conversión falla, se
 * guarda el archivo original en vez de perder la subida.
 */
async function optimizeImage(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer, { failOn: "none" })
      .rotate() // respeta la orientación EXIF de las fotos de celular
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function readLimited(data: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of data) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error("El archivo es demasiado grande.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Imágenes PNG/JPG: se leen completas (máx. 8 MB), se convierten a WebP y se
 * guardan en el bucket (producción) o en public/uploads (desarrollo). Devuelve
 * la URL pública como texto, igual que el manejador de Cloud Storage.
 */
const imageUploadHandler: UploadHandler = async ({ filename, contentType, data }) => {
  if (!filename || !OPTIMIZABLE_IMAGE_TYPES.has(contentType) || !isAllowedUpload(filename, contentType)) {
    return undefined;
  }

  const original = await readLimited(data, MAX_IMAGE_BYTES);
  const optimized = await optimizeImage(original);
  const body = optimized ?? original;
  const ext = optimized ? ".webp" : path.extname(filename).toLowerCase();
  const outType = optimized ? "image/webp" : contentType;
  const name = `${randomUUID()}${ext}`;

  if (GCS_BUCKET) {
    storageClient ??= new Storage();
    await storageClient.bucket(GCS_BUCKET).file(`uploads/${name}`).save(body, {
      resumable: false,
      contentType: outType,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
    return `${GCS_PUBLIC_PREFIX}${name}`;
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, name), body);
  return `/uploads/${name}`;
};


/** Sube el archivo a Cloud Storage en streaming y devuelve su URL pública (las credenciales vienen de la cuenta de servicio de Cloud Run). */
const gcsUploadHandler: UploadHandler = async ({ filename, contentType, data }) => {
  if (!GCS_BUCKET || !filename || !isAllowedUpload(filename, contentType)) return undefined;

  storageClient ??= new Storage();
  const objectName = `uploads/${randomUUID()}${path.extname(filename).toLowerCase()}`;
  const target = storageClient.bucket(GCS_BUCKET).file(objectName);

  let bytes = 0;
  async function* limited() {
    for await (const chunk of data) {
      bytes += chunk.byteLength;
      if (bytes > MAX_VIDEO_BYTES) throw new Error("El archivo es demasiado grande.");
      yield chunk;
    }
  }

  await pipeline(
    Readable.from(limited()),
    target.createWriteStream({
      resumable: false,
      contentType,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    }),
  );
  return `${GCS_PUBLIC_PREFIX}${path.basename(objectName)}`;
};

/**
 * Guarda archivos subidos directamente en disco, bajo public/uploads, con
 * nombre aleatorio para evitar colisiones. Sirve para un solo servidor con
 * disco persistente; si se despliega en una plataforma con filesystem
 * efímero (Vercel, la mayoría de serverless), hay que sustituir esto por
 * un bucket (S3/Cloudinary) sin tocar el resto del formulario de admin.
 */
export async function parseCatalogFormData(request: Request) {
  // Los botones de acción rápida (pausar, eliminar, activar/desactivar) envían
  // Forms simples sin archivos, que el navegador manda como urlencoded, no
  // multipart — solo los formularios de crear/editar con campos de archivo
  // necesitan el parser multipart.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return request.formData();
  }

  if (!GCS_BUCKET) await mkdir(UPLOADS_DIR, { recursive: true });

  const uploadHandler = unstable_composeUploadHandlers(
    imageUploadHandler,
    gcsUploadHandler,
    unstable_createFileUploadHandler({
      directory: UPLOADS_DIR,
      file: ({ filename }) => `${randomUUID()}${path.extname(filename ?? "")}`,
      filter: ({ filename, contentType: partContentType }) =>
        isAllowedUpload(filename, partContentType),
      maxPartSize: MAX_VIDEO_BYTES,
    }),
    unstable_createMemoryUploadHandler({ maxPartSize: MAX_IMAGE_BYTES }),
  );

  return unstable_parseMultipartFormData(request, uploadHandler);
}

/**
 * Convierte un archivo subido en su URL pública: /uploads/… (disco, desarrollo) o la URL del bucket (producción).
 *
 * Solo confía en archivos que de verdad se escribieron a disco
 * (NodeOnDiskFile). Cuando el filtro de tipo de archivo rechaza una subida,
 * unstable_composeUploadHandlers cae al manejador de memoria como
 * respaldo — sin este chequeo, uploadedFileToPublicUrl construiría una URL
 * a partir de ese archivo en memoria (que nunca se guardó) y el registro
 * quedaría apuntando a una imagen rota.
 */
export function uploadedFileToPublicUrl(file: File | string | null): string | null {
  // En producción el manejador de Cloud Storage entrega directamente la URL
  // pública (string); solo se acepta si apunta a NUESTRO bucket.
  if (typeof file === "string") {
    if (GCS_PUBLIC_PREFIX) return file.startsWith(GCS_PUBLIC_PREFIX) ? file : null;
    // Desarrollo: el manejador de imágenes entrega "/uploads/<uuid>.<ext>".
    return /^\/uploads\/[0-9a-f-]{36}\.(webp|png|jpe?g)$/i.test(file) ? file : null;
  }
  if (!file || file.size === 0) return null;
  if (!(file instanceof NodeOnDiskFile)) return null;
  const anyFile = file as unknown as { name: string };
  return `/uploads/${path.basename(anyFile.name)}`;
}
