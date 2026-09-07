import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { connectDB } from "~/lib/db.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { slugify } from "~/lib/slug";
import { Field, inputClass } from "~/components/admin/MediaFields";

export const meta: MetaFunction = () => [{ title: "Blog — Admin STOPee" }];

export async function loader() {
  await connectDB();
  const posts = await BlogPostModel.find().sort({ createdAt: -1 }).lean();
  const now = Date.now();
  return json({
    posts: posts.map((p) => ({
      id: String(p._id),
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      content: p.content,
      imageUrl: p.imageUrl ?? "",
      readingMinutes: p.readingMinutes ?? 3,
      publishedAt: p.publishedAt ?? null,
      status: !p.publishedAt ? ("draft" as const) : new Date(p.publishedAt).getTime() > now ? ("scheduled" as const) : ("published" as const),
    })),
  });
}

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildBlogPostDoc(formData: FormData, options: { existingId?: string; existingImageUrl?: string }) {
  const title = String(formData.get("title") ?? "").trim();
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const readingMinutes = Number(formData.get("readingMinutes") ?? 3) || 3;
  const publishState = String(formData.get("publishState") ?? "draft");

  if (!title) return { ok: false as const, error: "Ponle un título al artículo." };
  if (!excerpt) return { ok: false as const, error: "Ponle un resumen corto al artículo." };
  if (!content) return { ok: false as const, error: "El contenido no puede estar vacío." };

  const slug = slugify(slugInput || title);
  if (!slug) return { ok: false as const, error: "El slug no puede estar vacío." };

  let publishedAt: Date | null = null;
  if (publishState === "dated") {
    const raw = String(formData.get("scheduledFor") ?? "");
    if (!raw) return { ok: false as const, error: "Elige la fecha y hora de publicación." };
    publishedAt = new Date(raw);
  }

  const uploadedImageUrl = uploadedFileToPublicUrl(formData.get("image") as File | null);
  const removeImage = formData.get("removeImage") === "on";
  const imageUrl = uploadedImageUrl ?? (removeImage ? "" : options.existingImageUrl ?? "");

  return {
    ok: true as const,
    slug,
    doc: { title, slug, excerpt, content, imageUrl, readingMinutes, publishedAt },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await parseCatalogFormData(request);
  const intent = formData.get("intent");

  if (intent === "create" || intent === "update") {
    const id = intent === "update" ? String(formData.get("id")) : undefined;
    const existing = id ? await BlogPostModel.findById(id) : null;
    if (intent === "update" && !existing) {
      return json({ ok: false as const, error: "Artículo no encontrado." }, { status: 404 });
    }

    const result = buildBlogPostDoc(formData, { existingId: id, existingImageUrl: existing?.imageUrl ?? "" });
    if (!result.ok) return json({ ok: false as const, error: result.error }, { status: 400 });

    const slugTaken = await BlogPostModel.findOne({ slug: result.slug, ...(id ? { _id: { $ne: id } } : {}) });
    if (slugTaken) {
      return json({ ok: false as const, error: "Ya existe un artículo con ese slug." }, { status: 409 });
    }

    if (intent === "update") {
      await BlogPostModel.findByIdAndUpdate(id, result.doc);
    } else {
      await BlogPostModel.create(result.doc);
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await BlogPostModel.findByIdAndDelete(String(formData.get("id")));
    return json({ ok: true as const, error: null });
  }

  return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

type Post = ReturnType<typeof useLoaderData<typeof loader>>["posts"][number];

const STATUS_LABELS = {
  draft: { label: "Borrador", className: "bg-carbon/10 text-carbon/50" },
  scheduled: { label: "Programado", className: "bg-oliva/15 text-oliva" },
  published: { label: "Publicado", className: "bg-lima/20 text-bosque" },
};

function PostFormFields({ defaults }: { defaults?: Post }) {
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [slug, setSlug] = useState(defaults?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(defaults?.slug));
  // "dated" cubre tanto "publicar ahora" como "programado": siempre hay una
  // fecha/hora explícita y precargada, así que guardar sin tocarla no la
  // reinicia al momento del submit (un post ya publicado no pierde su fecha
  // original por error al solo cambiar, por ejemplo, el resumen).
  const [publishState, setPublishState] = useState<"draft" | "dated">(
    defaults && !defaults.publishedAt ? "draft" : "dated",
  );
  const [showPreview, setShowPreview] = useState(false);
  const [content, setContent] = useState(defaults?.content ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Título" htmlFor="title">
          <input
            id="title"
            name="title"
            required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(e.target.value);
            }}
            placeholder="Por qué la orina daña el mobiliario urbano"
            className={inputClass}
          />
        </Field>
        <Field label="Slug (URL)" htmlFor="slug">
          <input
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="por-que-la-orina-dana-el-mobiliario"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Resumen (aparece en la lista del blog)" htmlFor="excerpt">
        <textarea id="excerpt" name="excerpt" required rows={2} defaultValue={defaults?.excerpt} className={inputClass} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Imagen (opcional)" htmlFor="image">
          <input id="image" name="image" type="file" accept="image/*" className={inputClass} />
          {defaults?.imageUrl && (
            <div className="mt-2 flex items-center gap-2">
              <img src={defaults.imageUrl} alt="" className="h-14 w-24 rounded-lg object-cover" />
              <label className="flex items-center gap-1 text-xs text-carbon/60">
                <input type="checkbox" name="removeImage" className="h-4 w-4 accent-red-500" />
                Quitar imagen actual
              </label>
            </div>
          )}
        </Field>
        <Field label="Minutos de lectura" htmlFor="readingMinutes">
          <input id="readingMinutes" name="readingMinutes" type="number" min={1} defaultValue={defaults?.readingMinutes ?? 3} className={inputClass} />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="content" className="text-sm font-semibold text-carbon">
            Contenido (admite Markdown: **negritas**, ## subtítulos, listas, enlaces)
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs font-semibold text-bosque hover:underline"
          >
            {showPreview ? "Editar" : "Vista previa"}
          </button>
        </div>
        <div className={showPreview ? "prose prose-sm mt-1 max-w-none rounded-xl border border-carbon/15 p-4" : "hidden"}>
          {content ? <MarkdownPreview content={content} /> : <p className="text-carbon/40">Nada que previsualizar todavía.</p>}
        </div>
        <textarea
          id="content"
          name="content"
          required
          rows={12}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={showPreview ? "hidden" : `${inputClass} font-mono text-sm`}
        />
      </div>

      <div className="rounded-2xl border border-carbon/10 p-4">
        <p className="text-sm font-semibold text-carbon">Publicación</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              { key: "draft", label: "Borrador" },
              { key: "dated", label: "Con fecha de publicación" },
            ] as const
          ).map((opt) => (
            <label
              key={opt.key}
              className={`min-h-11 cursor-pointer rounded-full border px-4 py-2.5 text-sm font-semibold ${
                publishState === opt.key ? "border-lima bg-lima/20 text-bosque" : "border-carbon/15 text-carbon/70"
              }`}
            >
              <input
                type="radio"
                name="publishState"
                value={opt.key}
                checked={publishState === opt.key}
                onChange={() => setPublishState(opt.key)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
        {publishState === "dated" && (
          <div className="mt-3 max-w-xs">
            <Field label="Fecha y hora exacta" htmlFor="scheduledFor">
              <input
                id="scheduledFor"
                name="scheduledFor"
                type="datetime-local"
                required
                defaultValue={toDatetimeLocalValue(defaults?.publishedAt ? new Date(defaults.publishedAt) : new Date())}
                className={inputClass}
              />
            </Field>
            <p className="mt-1 text-xs text-carbon/50">
              Si eliges una fecha futura, el artículo se programa y aparece solo hasta esa fecha y
              hora. Una fecha pasada o "ahora" lo publica de inmediato.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    import("marked").then(({ marked }) => {
      if (!cancelled) setHtml(marked.parse(content, { async: false }) as string);
    });
    return () => {
      cancelled = true;
    };
  }, [content]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function AdminBlog() {
  const { posts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-carbon">Blog</h1>
          <p className="mt-1 text-sm text-carbon/60">Crea, edita, programa y borra entradas del Blog Cívico.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon"
        >
          {showCreateForm ? "Cerrar" : "+ Nuevo artículo"}
        </button>
      </div>

      {showCreateForm && (
        <Form method="post" encType="multipart/form-data" className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-6">
          <input type="hidden" name="intent" value="create" />
          <PostFormFields />
          {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
          <button
            type="submit"
            disabled={isCreating}
            className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
          >
            {isCreating ? "Creando…" : "Crear artículo"}
          </button>
        </Form>
      )}

      {posts.length === 0 ? (
        <p className="mt-6 text-sm text-carbon/60">Todavía no hay artículos.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {posts.map((p) => (
            <li key={p.id} className="rounded-3xl border border-carbon/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {p.imageUrl && <img src={p.imageUrl} alt="" className="h-14 w-24 rounded-lg object-cover" />}
                  <div>
                    <p className="font-display font-bold text-carbon">{p.title}</p>
                    <p className="text-xs text-carbon/50">/blog/{p.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_LABELS[p.status].className}`}>
                    {STATUS_LABELS[p.status].label}
                    {p.status === "scheduled" && p.publishedAt && (
                      <> · {new Date(p.publishedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                  >
                    {editingId === p.id ? "Cerrar" : "Editar"}
                  </button>
                  <Form method="post" onSubmit={(e) => { if (!confirm(`¿Eliminar "${p.title}"?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>

              {editingId === p.id && (
                <Form method="post" encType="multipart/form-data" className="mt-4 flex flex-col gap-4 rounded-2xl border border-dashed border-carbon/20 p-4">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={p.id} />
                  <PostFormFields defaults={p} />
                  {actionData?.error && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
                  <button type="submit" className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso">
                    Guardar cambios
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
