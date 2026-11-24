import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { ArrowIcon, ChevronIcon } from "~/components/ui/Icons";
import { getCatalogItems } from "~/lib/catalog.server";
import { getActiveHeroBanner } from "~/lib/heroBanner.server";
import {
  HOME_BLOCKS,
  parseHomeBlocksPayload,
  serializeHomeBlocks,
  type HomeBlockState,
  type HomeBlockType,
  type HomeField,
} from "~/lib/homeBlocks";
import { requireAdmin } from "~/lib/session.server";
import { BlogPostModel } from "~/models/blogPost.server";
import { getHomeBlocksWithMeta, resetHomeBlocks, saveHomeBlocks } from "~/models/homeLayout.server";
import { getSiteSettings } from "~/models/siteSettings.server";
import { getPublishedTestimonials } from "~/models/testimonial.server";

export const meta: MetaFunction = () => [{ title: "Página de inicio — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [{ blocks, updatedAt }, items, banner, testimonials, postCount, settings] = await Promise.all([
    getHomeBlocksWithMeta(),
    getCatalogItems(),
    getActiveHeroBanner(),
    getPublishedTestimonials(),
    BlogPostModel.countDocuments({ publishedAt: { $lte: new Date() } }),
    getSiteSettings(),
  ]);

  // Un aviso por bloque cuando lo que muestra depende de otra pantalla: así se entiende por qué
  // un bloque encendido puede no verse.
  const notes: Partial<Record<HomeBlockType, string>> = {
    banner: banner
      ? `Banner activo: «${banner.text || "solo imagen"}».`
      : "No hay un banner activo para Inicio: se muestra el hero por defecto.",
    testimonials:
      testimonials.length > 0
        ? `${testimonials.length} testimonio${testimonials.length === 1 ? "" : "s"} publicado${testimonials.length === 1 ? "" : "s"}.`
        : "No hay testimonios publicados: aunque esté encendido, la sección no aparece.",
    blog:
      postCount > 0
        ? `${postCount} artículo${postCount === 1 ? "" : "s"} publicado${postCount === 1 ? "" : "s"}; se muestran los 3 más recientes.`
        : "No hay artículos publicados: aunque esté encendido, la sección no aparece.",
  };

  return data({
    blocks,
    updatedAt,
    notes,
    isStoreActive: settings.isStoreActive,
    products: items.map((p) => ({ sku: p.sku, label: `${p.name} (${p.kind === "bundle" ? "paquete" : "producto"}) — $${p.priceMxn}` })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    await resetHomeBlocks();
    return data({ ok: true as const, message: "La portada volvió a su versión original.", error: null });
  }

  const parsed = parseHomeBlocksPayload(formData.get("payload"));
  if (!parsed.ok) return data({ ok: false as const, message: null, error: parsed.error }, { status: 400 });

  await saveHomeBlocks(parsed.blocks);
  return data({ ok: true as const, message: "Cambios guardados. La portada ya los muestra.", error: null });
}

export default function AdminInicio() {
  const { blocks, updatedAt, notes, isStoreActive, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Página de inicio</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Ordena las secciones de la portada, enciende o apaga las que quieras y cambia sus textos. Los cambios se ven al
        guardar, sin volver a subir el sitio.
      </p>

      <HomeEditor
        key={updatedAt ?? "original"}
        initial={blocks as HomeBlockState[]}
        notes={notes}
        products={products}
        isSubmitting={isSubmitting}
        isStoreActive={isStoreActive}
        message={actionData?.ok ? actionData.message : null}
        error={actionData && !actionData.ok ? actionData.error : null}
      />

      <Form
        method="post"
        className="mt-10 border-t border-carbon/10 pt-6"
        onSubmit={(e) => {
          if (!confirm("¿Volver a la portada original? Se pierden el orden y los textos que guardaste.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="reset" />
        <button
          type="submit"
          disabled={isSubmitting || updatedAt === null}
          className="min-h-11 rounded-full px-5 text-sm font-semibold text-carbon/60 underline underline-offset-2 hover:text-carbon disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
        >
          Restablecer la portada original
        </button>
        {updatedAt === null && <p className="text-xs text-carbon/50">Todavía no has guardado cambios.</p>}
      </Form>
    </div>
  );
}

function HomeEditor({
  initial,
  notes,
  products,
  isSubmitting,
  isStoreActive,
  message,
  error,
}: {
  initial: HomeBlockState[];
  notes: Partial<Record<HomeBlockType, string>>;
  products: { sku: string; label: string }[];
  isSubmitting: boolean;
  isStoreActive: boolean;
  message: string | null;
  error: string | null;
}) {
  const [blocks, setBlocks] = useState<HomeBlockState[]>(initial);
  // Lo último que se envió: el aviso de error solo vale mientras no se toque nada más.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const payload = serializeHomeBlocks(blocks);
  const isDirty = payload !== serializeHomeBlocks(initial);
  const showError = Boolean(error) && submitted === payload;
  const showSuccess = Boolean(message) && !isDirty && !showError;

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
    setAnnouncement(`«${HOME_BLOCKS[blocks[index].type].name}» ahora está en la posición ${target + 1} de ${blocks.length}.`);
  }

  function update(type: HomeBlockType, patch: Partial<Pick<HomeBlockState, "enabled">> & { field?: [string, string] }) {
    setBlocks((current) =>
      current.map((b) =>
        b.type !== type
          ? b
          : {
              ...b,
              enabled: patch.enabled ?? b.enabled,
              content: patch.field ? { ...b.content, [patch.field[0]]: patch.field[1] } : b.content,
            },
      ),
    );
  }

  return (
    <Form method="post" className="mt-6" onSubmit={() => setSubmitted(payload)}>
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="payload" value={payload} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ol className="flex flex-col gap-3">
        {blocks.map((block, index) => (
          <BlockCard
            key={block.type}
            block={block}
            index={index}
            total={blocks.length}
            note={notes[block.type]}
            products={products}
            onMove={(delta) => move(index, delta)}
            onToggle={(enabled) => update(block.type, { enabled })}
            onField={(key, value) => update(block.type, { field: [key, value] })}
          />
        ))}
      </ol>

      {/* Barra fija abajo: el resultado de guardar se ve justo junto al botón, estés donde estés en la página. */}
      <div className="sticky bottom-3 z-10 mt-6 rounded-2xl border border-carbon/10 bg-white p-3 shadow-lg sm:p-4">
        {showError && (
          <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error} Tus cambios siguen aquí: corrige y vuelve a guardar.
          </p>
        )}
        {showSuccess && (
          <div role="status" className="mb-3 rounded-xl border border-lima/50 bg-lima/15 p-3 text-sm text-carbon">
            <p className="font-semibold">{message}</p>
            <p className="mt-0.5 text-carbon/70">
              {isStoreActive ? (
                <a href="/" target="_blank" rel="noreferrer" className="font-semibold text-bosque underline underline-offset-2">
                  Ver la portada
                </a>
              ) : (
                "La tienda sigue en pre-lanzamiento: el público todavía ve la página de espera. Activa la tienda en Configuración para ver estos cambios."
              )}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm ${isDirty ? "font-semibold text-carbon" : "text-carbon/50"}`}>
            {isDirty ? "Tienes cambios sin guardar." : "Todo guardado."}
          </p>
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="min-h-12 rounded-full bg-lima px-8 py-3 text-sm font-bold text-carbon transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </Form>
  );
}

function BlockCard({
  block,
  index,
  total,
  note,
  products,
  onMove,
  onToggle,
  onField,
}: {
  block: HomeBlockState;
  index: number;
  total: number;
  note?: string;
  products: { sku: string; label: string }[];
  onMove: (delta: -1 | 1) => void;
  onToggle: (enabled: boolean) => void;
  onField: (key: string, value: string) => void;
}) {
  const def = HOME_BLOCKS[block.type];
  const hasFields = def.groups.length > 0;
  const toggleId = `toggle-${block.type}`;

  return (
    <li
      className={`rounded-3xl border bg-white p-4 sm:p-5 ${block.enabled ? "border-carbon/10" : "border-dashed border-carbon/20"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-black ${
            block.enabled ? "bg-lima text-carbon" : "bg-carbon/10 text-carbon/50"
          }`}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="py-1.5 font-display text-lg font-bold leading-tight text-carbon">
            {def.name}
            {!block.enabled && (
              <span className="ml-2 rounded-full bg-carbon/10 px-2 py-0.5 align-middle text-xs font-semibold text-carbon/60">
                Oculto
              </span>
            )}
          </h2>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Subir «${def.name}»`}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-carbon/15 text-carbon hover:bg-carbon/5 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronIcon className="h-5 w-5 -rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Bajar «${def.name}»`}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-carbon/15 text-carbon hover:bg-carbon/5 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronIcon className="h-5 w-5 rotate-90" />
          </button>
        </div>
      </div>

      <p className="mt-1 pl-12 text-sm text-carbon/60">{def.description}</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pl-12">
        <label htmlFor={toggleId} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-carbon">
          <input
            id={toggleId}
            type="checkbox"
            checked={block.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-6 w-6 shrink-0 accent-lima"
          />
          Mostrar en la portada
        </label>
        {def.editElsewhere && (
          <Link
            to={def.editElsewhere.to}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-bosque underline decoration-lima decoration-2 underline-offset-4"
          >
            {def.editElsewhere.label}
            <ArrowIcon />
          </Link>
        )}
      </div>

      {note && <p className="pl-12 text-xs text-carbon/60">{note}</p>}

      {hasFields && (
        <details className="group mt-3 pl-12">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-carbon [&::-webkit-details-marker]:hidden">
            <ChevronIcon className="h-4 w-4 transition-transform group-open:rotate-90" />
            Editar textos
          </summary>
          <div className="mt-2 flex flex-col gap-6 border-t border-carbon/10 pt-4">
            {def.groups.map((group) => (
              <fieldset key={group.title} className="min-w-0">
                <legend className="text-xs font-bold uppercase tracking-wide text-carbon/50">{group.title}</legend>
                <div className="mt-2 flex flex-col gap-4">
                  {group.fields.map((field) => (
                    <FieldInput
                      key={field.key}
                      field={field}
                      id={`${block.type}-${field.key}`}
                      value={block.content[field.key] ?? ""}
                      products={products}
                      onChange={(value) => onField(field.key, value)}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </details>
      )}
    </li>
  );
}

function FieldInput({
  field,
  id,
  value,
  products,
  onChange,
}: {
  field: HomeField;
  id: string;
  value: string;
  products: { sku: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const label = field.required ? field.label : `${field.label} (opcional)`;
  const hintId = field.hint ? `${id}-hint` : undefined;

  return (
    <Field label={label} htmlFor={id}>
      {field.kind === "textarea" ? (
        <textarea
          id={id}
          rows={3}
          maxLength={field.max}
          value={value}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : field.kind === "product" ? (
        <select
          id={id}
          value={value}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">Automático</option>
          {products.map((p) => (
            <option key={p.sku} value={p.sku}>
              {p.label}
            </option>
          ))}
          {value && !products.some((p) => p.sku === value) && <option value={value}>{value} (ya no está disponible)</option>}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          maxLength={field.max}
          value={value}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
      {field.hint && (
        <p id={hintId} className="mt-1 text-xs text-carbon/50">
          {field.hint}
        </p>
      )}
    </Field>
  );
}
