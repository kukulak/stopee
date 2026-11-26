import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Subida de imágenes y videos del panel (catálogo, banners, blog…). Se ejecuta el lector de formularios
 * real con peticiones multipart de verdad: en disco (desarrollo) y contra un bucket de Cloud Storage
 * simulado (producción). Lo que se verifica es lo que protege la carpeta pública de subidas.
 */

type Upload = typeof import("~/lib/upload.server");

function multipart(fields: Record<string, string | File | File[]>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(name, v);
  }
  return new Request("https://stopee.test/admin/catalog/products", { method: "POST", body: form });
}

const file = (bytes: Uint8Array | Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

/** Los primeros bytes de un .mp4 de verdad (caja "ftyp"): sin esto la subida lo rechaza por no parecer un video. */
const MP4_HEAD = Buffer.from("00000018667479706d703432", "hex");
const mp4 = (rest: Buffer) => Buffer.concat([MP4_HEAD, rest]);

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#B5D334" } }).png().toBuffer();
}

describe("subidas en disco (desarrollo)", () => {
  let dir: string;
  let originalCwd: string;
  let upload: Upload;

  const savedFiles = async () => (await readdir(path.join(dir, "public", "uploads")).catch(() => [])).filter((f) => !f.startsWith("."));

  beforeAll(async () => {
    originalCwd = process.cwd();
    dir = await mkdtemp(path.join(tmpdir(), "stopee-subidas-"));
    process.chdir(dir); // UPLOADS_DIR se calcula con el directorio de trabajo al cargar el módulo
    delete process.env.GCS_BUCKET;
    vi.resetModules();
    upload = await import("~/lib/upload.server");
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(path.join(dir, "public"), { recursive: true, force: true });
  });

  it("una foto PNG grande se convierte a WebP, se reduce a 2000 px de ancho y se guarda con nombre aleatorio", async () => {
    const original = await png(3000, 2000);
    const form = await upload.parseCatalogFormData(multipart({ images: file(original, "Mi Foto (1).png", "image/png") }));

    const url = form.get("images") as string;
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.webp$/);
    expect(upload.uploadedFileToPublicUrl(url)).toBe(url);

    const saved = await readFile(path.join(dir, "public", url));
    const meta = await sharp(saved).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(2000); // no se agranda ni se deja de más
    expect(saved.length).toBeLessThan(original.length);
  });

  it("una imagen pequeña no se agranda", async () => {
    const form = await upload.parseCatalogFormData(multipart({ images: file(await png(300, 200), "chica.png", "image/png") }));
    const saved = await readFile(path.join(dir, "public", form.get("images") as string));
    expect((await sharp(saved).metadata()).width).toBe(300);
  });

  it("un JPG también se convierte a WebP", async () => {
    const jpg = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3E531D" } }).jpeg().toBuffer();
    const form = await upload.parseCatalogFormData(multipart({ images: file(jpg, "foto.jpg", "image/jpeg") }));
    expect(form.get("images")).toMatch(/\.webp$/);
  });

  it("un GIF (puede estar animado) se guarda tal cual, sin convertirlo", async () => {
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    const form = await upload.parseCatalogFormData(multipart({ images: file(gif, "animado.gif", "image/gif") }));
    const url = form.get("images") as string;
    expect(url).toMatch(/\.gif$/);
    expect(await readFile(path.join(dir, "public", url))).toEqual(gif);
  });

  it("un video se guarda completo y sin cambios", async () => {
    const bytes = mp4(randomBytes(300_000));
    const form = await upload.parseCatalogFormData(multipart({ videoFile: file(bytes, "demo.mp4", "video/mp4") }));
    const url = form.get("videoFile") as string;
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.mp4$/);
    expect(upload.uploadedFileToPublicUrl(url)).toBe(url);
    expect(await readFile(path.join(dir, "public", url))).toEqual(bytes);
  });

  it("guarda varias imágenes del mismo campo, cada una con su nombre", async () => {
    const a = await png(100, 100);
    const form = await upload.parseCatalogFormData(
      multipart({ images: [file(a, "a.png", "image/png"), file(a, "b.png", "image/png"), file(a, "c.png", "image/png")] }),
    );
    const urls = form.getAll("images") as string[];
    expect(new Set(urls).size).toBe(3);
    expect((await savedFiles()).sort()).toEqual(urls.map((u) => path.basename(u)).sort());
  });

  it.each([
    ["una página .html", "malo.html", "text/html"],
    ["un .svg (puede traer scripts)", "malo.svg", "image/svg+xml"],
    ["un .php", "shell.php", "application/x-php"],
    ["un .js", "malo.js", "text/javascript"],
    ["un ejecutable", "virus.exe", "application/octet-stream"],
    ["un archivo sin extensión", "sinextension", "image/png"],
    ["extensión de imagen con tipo de página (.png / text/html)", "disfraz.png", "text/html"],
    ["extensión de imagen con tipo de otra imagen (.png / image/jpeg)", "cruzado.png", "image/jpeg"],
    ["doble extensión (.php.png con tipo php)", "x.php.png", "application/x-php"],
  ])("rechaza %s: no se guarda nada y el campo queda vacío", async (_nombre, name, type) => {
    const form = await upload.parseCatalogFormData(multipart({ images: file(Buffer.from("<script>alert(1)</script>"), name, type), nombre: "Producto" }));
    expect(form.get("images")).toBeNull();
    expect(form.get("nombre")).toBe("Producto"); // el resto del formulario sigue llegando
    expect(await savedFiles()).toEqual([]);
  });

  it.each([
    ["un .mp4 que en realidad es una página", "video.mp4", "video/mp4"],
    ["un .gif que en realidad es una página", "animado.gif", "image/gif"],
    ["un .webp que en realidad es una página", "foto.webp", "image/webp"],
    ["un .pdf que en realidad es una página", "doc.pdf", "application/pdf"],
    ["un .png que en realidad es una página (no se puede leer como imagen)", "foto.png", "image/png"],
    ["un .jpg que en realidad es una página", "foto.jpg", "image/jpeg"],
  ])("rechaza %s: el nombre y el tipo los escribe quien sube el archivo, los primeros bytes no", async (_nombre, name, type) => {
    const form = await upload.parseCatalogFormData(
      multipart({ images: file(Buffer.from("<html><script>alert(1)</script></html>".repeat(5)), name, type), nombre: "Producto" }),
    );
    expect(form.get("images")).toBeNull();
    expect(form.get("nombre")).toBe("Producto");
    expect(await savedFiles()).toEqual([]);
  });

  it("un campo de archivo que el navegador manda vacío (sin elegir foto) no rompe ni guarda nada", async () => {
    const form = await upload.parseCatalogFormData(multipart({ images: file(Buffer.alloc(0), "", "application/octet-stream"), nombre: "Producto" }));
    expect(form.get("images")).toBeNull();
    expect(form.get("nombre")).toBe("Producto");
    expect(await savedFiles()).toEqual([]);
  });

  it("los campos de texto llegan intactos junto a los archivos", async () => {
    const form = await upload.parseCatalogFormData(
      multipart({ name: "Concentrado ñandú", price: "399", description: "línea 1\nlínea 2", images: file(await png(50, 50), "x.png", "image/png") }),
    );
    expect(form.get("name")).toBe("Concentrado ñandú");
    expect(form.get("price")).toBe("399");
    // En multipart los saltos de línea viajan como \r\n (así los mandan los navegadores).
    expect(String(form.get("description")).replace(/\r\n/g, "\n")).toBe("línea 1\nlínea 2");
  });

  it("una imagen de más de 8 MB se rechaza y no deja nada guardado", async () => {
    const enorme = file(randomBytes(9 * 1024 * 1024), "enorme.png", "image/png");
    await expect(upload.parseCatalogFormData(multipart({ images: enorme }))).rejects.toThrow(/demasiado grande/);
    expect(await savedFiles()).toEqual([]);
  });

  it("un video de más de 80 MB se rechaza y no deja un archivo incompleto en la carpeta pública", async () => {
    const enorme = file(Buffer.alloc(81 * 1024 * 1024, 1), "enorme.mp4", "video/mp4");
    await expect(upload.parseCatalogFormData(multipart({ videoFile: enorme }))).rejects.toThrow();
    expect(await savedFiles()).toEqual([]);
  });

  it("más de 20 archivos en un mismo envío se rechazan", async () => {
    const chica = await png(20, 20);
    const muchos = Array.from({ length: 21 }, (_, i) => file(chica, `f${i}.png`, "image/png"));
    await expect(upload.parseCatalogFormData(multipart({ images: muchos }))).rejects.toThrow();
  });

  it("un formulario sin archivos (botones de pausar, eliminar…) se lee como siempre", async () => {
    const request = new Request("https://stopee.test/admin/catalog/products", {
      method: "POST",
      body: new URLSearchParams({ intent: "delete", id: "abc" }),
    });
    const form = await upload.parseCatalogFormData(request);
    expect(form.get("intent")).toBe("delete");
    expect(form.get("id")).toBe("abc");
  });

  describe("qué direcciones se aceptan como imagen subida", () => {
    it("solo las que entrega este módulo: /uploads/<uuid>.<extensión permitida>", () => {
      const ok = "/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8";
      for (const ext of ["webp", "png", "jpg", "jpeg", "gif", "mp4", "webm", "mov", "pdf"]) {
        expect(upload.uploadedFileToPublicUrl(`${ok}.${ext}`)).toBe(`${ok}.${ext}`);
      }
    });

    it.each([
      "https://sitio-falso.com/foto.png",
      "//sitio-falso.com/foto.png",
      "/uploads/../../etc/passwd",
      "/uploads/foto.png",
      "/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8.html",
      "/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8.svg",
      "/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8.png/../x",
      "javascript:alert(1)",
      "",
    ])("rechaza %j", (value) => {
      expect(upload.uploadedFileToPublicUrl(value)).toBeNull();
    });

    it("un archivo en bruto o nada tampoco se acepta", () => {
      expect(upload.uploadedFileToPublicUrl(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
      expect(upload.uploadedFileToPublicUrl(null)).toBeNull();
    });
  });
});

describe("subidas al bucket de Cloud Storage (producción)", () => {
  const BUCKET = "stopee-prueba";
  const PREFIX = `https://storage.googleapis.com/${BUCKET}/uploads/`;
  let upload: Upload;
  const saved: { name: string; body: Buffer; options: Record<string, unknown> }[] = [];
  const streamed: { name: string; chunks: Buffer[]; options: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    process.env.GCS_BUCKET = BUCKET;
    vi.resetModules();
    vi.doMock("@google-cloud/storage", () => ({
      Storage: class {
        bucket(name: string) {
          expect(name).toBe(BUCKET);
          return {
            file: (objectName: string) => ({
              save: async (body: Buffer, options: Record<string, unknown>) => void saved.push({ name: objectName, body, options }),
              createWriteStream: (options: Record<string, unknown>) => {
                const entry = { name: objectName, chunks: [] as Buffer[], options };
                streamed.push(entry);
                return new Writable({
                  write(chunk, _enc, done) {
                    entry.chunks.push(Buffer.from(chunk));
                    done();
                  },
                });
              },
            }),
          };
        }
      },
    }));
    upload = await import("~/lib/upload.server");
  });

  afterAll(() => {
    delete process.env.GCS_BUCKET;
    vi.doUnmock("@google-cloud/storage");
    vi.resetModules();
  });

  beforeEach(() => {
    saved.length = 0;
    streamed.length = 0;
  });

  it("una imagen se optimiza y se sube al bucket con caché larga; el campo queda con su dirección pública", async () => {
    const form = await upload.parseCatalogFormData(multipart({ images: file(await png(2500, 1000), "foto.png", "image/png") }));
    const url = form.get("images") as string;

    expect(url.startsWith(PREFIX)).toBe(true);
    expect(url).toMatch(/\.webp$/);
    expect(upload.uploadedFileToPublicUrl(url)).toBe(url);

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe(`uploads/${path.basename(url)}`);
    expect(saved[0].options).toMatchObject({ contentType: "image/webp", resumable: false });
    expect(JSON.stringify(saved[0].options)).toContain("immutable");
    expect((await sharp(saved[0].body).metadata()).width).toBe(2000);
  });

  it("un video se envía al bucket por partes, completo", async () => {
    const bytes = mp4(randomBytes(500_000));
    const form = await upload.parseCatalogFormData(multipart({ videoFile: file(bytes, "demo.mp4", "video/mp4") }));
    const url = form.get("videoFile") as string;

    expect(url.startsWith(PREFIX)).toBe(true);
    expect(url).toMatch(/\.mp4$/);
    expect(streamed).toHaveLength(1);
    expect(streamed[0].options).toMatchObject({ contentType: "video/mp4" });
    expect(Buffer.concat(streamed[0].chunks)).toEqual(bytes);
  });

  it("un tipo no permitido no llega al bucket", async () => {
    const form = await upload.parseCatalogFormData(multipart({ images: file(Buffer.from("<script>"), "malo.html", "text/html") }));
    expect(form.get("images")).toBeNull();
    expect(saved).toHaveLength(0);
    expect(streamed).toHaveLength(0);
  });

  it("solo se acepta una dirección de NUESTRO bucket: ni otro bucket, ni una ruta local, ni otro sitio", () => {
    expect(upload.uploadedFileToPublicUrl(`${PREFIX}0e341019-2792-4bde-837d-cc1a78a80cb8.webp`)).not.toBeNull();
    for (const mala of [
      "https://storage.googleapis.com/otro-bucket/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8.webp",
      `${PREFIX}../otro-bucket/0e341019-2792-4bde-837d-cc1a78a80cb8.webp`,
      `${PREFIX}foto.webp`,
      `${PREFIX}0e341019-2792-4bde-837d-cc1a78a80cb8.html`,
      "https://sitio-falso.com/stopee-prueba/uploads/foto.webp",
      "/uploads/0e341019-2792-4bde-837d-cc1a78a80cb8.webp",
      "",
    ]) {
      expect(upload.uploadedFileToPublicUrl(mala), mala).toBeNull();
    }
  });
});
