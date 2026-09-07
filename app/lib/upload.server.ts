import {
  unstable_createFileUploadHandler,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80MB

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

  await mkdir(UPLOADS_DIR, { recursive: true });

  const uploadHandler = unstable_composeUploadHandlers(
    unstable_createFileUploadHandler({
      directory: UPLOADS_DIR,
      file: ({ filename }) => `${randomUUID()}${path.extname(filename ?? "")}`,
      maxPartSize: MAX_VIDEO_BYTES,
    }),
    unstable_createMemoryUploadHandler({ maxPartSize: MAX_IMAGE_BYTES }),
  );

  return unstable_parseMultipartFormData(request, uploadHandler);
}

/** Convierte un archivo subido (NodeOnDiskFile) en la URL pública bajo /uploads/. */
export function uploadedFileToPublicUrl(file: File | null): string | null {
  if (!file || file.size === 0) return null;
  const anyFile = file as unknown as { name: string };
  return `/uploads/${path.basename(anyFile.name)}`;
}
