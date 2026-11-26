import { parseFormData } from "@mjackson/form-data-parser";
import type { FileUpload, FileUploadHandler } from "@mjackson/form-data-parser";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

export function isAllowedUpload(filename: string, contentType: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const allowedContentTypes = ALLOWED_UPLOAD_TYPES[ext];
  return Boolean(allowedContentTypes && allowedContentTypes.includes(contentType));
}

/**
 * El nombre y el tipo que declara el navegador los escribe quien sube el archivo: no prueban nada. La firma
 * (los primeros bytes) sí: un ".mp4" que empieza con "<html" no es un video. Devuelve si los bytes coinciden
 * con lo que la extensión promete.
 */
/** El contenido no es lo que dice ser: el archivo se descarta (como un tipo no permitido), no se rompe el formulario. */
class InvalidUploadError extends Error {}

export function matchesFileSignature(ext: string, head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => Buffer.from(head.subarray(from, to)).toString("latin1");
  switch (ext) {
    case ".gif":
      return ascii(0, 4) === "GIF8";
    case ".webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case ".pdf":
      return ascii(0, 5) === "%PDF-";
    case ".mp4":
    case ".mov":
      return ascii(4, 8) === "ftyp";
    case ".webm":
      return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case ".jpg":
    case ".jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case ".png":
      return head.length >= 4 && head[0] === 0x89 && ascii(1, 4) === "PNG";
    default:
      return false;
  }
}

/** Nombre de archivo que este módulo asigna: <uuid>.<extensión permitida> (nunca el nombre que mandó el navegador). */
const STORED_NAME = new RegExp(
  `^[0-9a-f-]{36}\\.(${Object.keys(ALLOWED_UPLOAD_TYPES)
    .map((ext) => ext.slice(1))
    .join("|")})$`,
  "i",
);

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

/** Los bytes de un archivo subido, por partes (sin tenerlo completo en memoria), con tope de tamaño. */
async function* chunksOf(upload: FileUpload, maxBytes: number): AsyncGenerator<Uint8Array> {
  const reader = upload.stream().getReader();
  const ext = path.extname(upload.name).toLowerCase();
  let bytes = 0;
  let head = Buffer.alloc(0);
  let signatureChecked = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // Un archivo más corto que la firma tampoco pasa.
        if (!signatureChecked) {
          if (!matchesFileSignature(ext, head)) throw new InvalidUploadError("El contenido del archivo no coincide con su tipo.");
          if (head.length > 0) yield head;
        }
        return;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("El archivo es demasiado grande.");
      if (!signatureChecked) {
        // Se junta lo mínimo para ver la firma antes de dejar pasar el primer byte hacia el bucket o el disco.
        head = Buffer.concat([head, Buffer.from(value)]);
        if (head.length < 16) continue;
        if (!matchesFileSignature(ext, head)) throw new InvalidUploadError("El contenido del archivo no coincide con su tipo.");
        signatureChecked = true;
        yield head;
        continue;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readLimited(upload: FileUpload, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of chunksOf(upload, maxBytes)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Imágenes PNG/JPG: se leen completas (máx. 8 MB), se convierten a WebP y se
 * guardan en el bucket (producción) o en public/uploads (desarrollo). Devuelve
 * la URL pública como texto.
 */
async function saveOptimizedImage(upload: FileUpload): Promise<string> {
  const original = await readLimited(upload, MAX_IMAGE_BYTES);
  const optimized = await optimizeImage(original);
  // Si no se puede leer como imagen, no lo es: un archivo con nombre ".png" y otro contenido no se
  // guarda "tal cual" en una carpeta pública.
  if (!optimized) throw new InvalidUploadError("El archivo no es una imagen válida.");
  const body = optimized;
  const name = `${randomUUID()}.webp`;
  const outType = "image/webp";

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
}

/** Sube el archivo a Cloud Storage en streaming y devuelve su URL pública (las credenciales vienen de la cuenta de servicio de Cloud Run). */
async function saveToBucket(upload: FileUpload): Promise<string> {
  storageClient ??= new Storage();
  const objectName = `uploads/${randomUUID()}${path.extname(upload.name).toLowerCase()}`;
  const target = storageClient!.bucket(GCS_BUCKET!).file(objectName);

  await pipeline(
    Readable.from(chunksOf(upload, MAX_VIDEO_BYTES)),
    target.createWriteStream({
      resumable: false,
      contentType: upload.type,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    }),
  );
  return `${GCS_PUBLIC_PREFIX}${path.basename(objectName)}`;
}

/** Guarda el archivo en disco (desarrollo), bajo public/uploads y con nombre aleatorio; devuelve su dirección. */
async function saveToDisk(upload: FileUpload): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${randomUUID()}${path.extname(upload.name).toLowerCase()}`;
  const target = path.join(UPLOADS_DIR, name);
  try {
    await pipeline(Readable.from(chunksOf(upload, MAX_VIDEO_BYTES)), createWriteStream(target));
  } catch (error) {
    // Si se pasó del límite (o se cortó la subida) a la mitad, no se deja un archivo incompleto en una carpeta pública.
    await rm(target, { force: true });
    throw error;
  }
  return `/uploads/${name}`;
}

/**
 * Qué hacer con cada archivo del formulario. Devuelve la URL pública (texto) de lo que se guardó, o
 * `null` para descartarlo: sin nombre (el campo de archivo venía vacío), o de un tipo no permitido.
 * En ningún caso se conserva el archivo en memoria dentro del FormData.
 */
const uploadHandler: FileUploadHandler = async (upload) => {
  if (!upload.name || !isAllowedUpload(upload.name, upload.type)) return null;
  try {
    if (OPTIMIZABLE_IMAGE_TYPES.has(upload.type)) return await saveOptimizedImage(upload);
    return await (GCS_BUCKET ? saveToBucket(upload) : saveToDisk(upload));
  } catch (error) {
    if (error instanceof InvalidUploadError) return null;
    throw error;
  }
};

/**
 * Lee el formulario del panel (con archivos o sin ellos). Los archivos se guardan según lo anterior y en
 * el FormData queda, para cada campo de archivo, la URL pública (texto) — ver uploadedFileToPublicUrl.
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

  // maxFileSize: tope por parte (el de los videos); las imágenes se limitan a 8 MB al leerlas.
  return parseFormData(request, { maxFileSize: MAX_VIDEO_BYTES, maxFiles: 20 }, uploadHandler);
}

/**
 * Convierte el valor de un campo de archivo en su URL pública: /uploads/… (disco, desarrollo) o la URL del
 * bucket (producción).
 *
 * Solo se confía en las direcciones que entregó uploadHandler: nuestro bucket (o nuestra carpeta de subidas)
 * seguido de un nombre <uuid>.<extensión permitida>. Un archivo "en bruto" (un File) nunca se acepta, ni un texto
 * cualquiera que alguien escriba en el campo: así un formulario manipulado no puede hacer que el
 * registro apunte a una dirección ajena.
 */
export function uploadedFileToPublicUrl(file: File | string | null): string | null {
  if (typeof file !== "string") return null;
  if (GCS_PUBLIC_PREFIX) {
    return file.startsWith(GCS_PUBLIC_PREFIX) && STORED_NAME.test(file.slice(GCS_PUBLIC_PREFIX.length)) ? file : null;
  }
  return file.startsWith("/uploads/") && STORED_NAME.test(file.slice("/uploads/".length)) ? file : null;
}
