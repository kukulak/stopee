import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getLegalSettings, updateLegalSettings } from "~/models/legalSettings.server";
import { parseCatalogFormData, uploadedFileToPublicUrl } from "~/lib/upload.server";
import { SOCIAL_NETWORKS, detectNetwork, normalizeSocialUrl } from "~/lib/socialNetworks";
import { Field, inputClass } from "~/components/admin/MediaFields";
import { SocialIcon } from "~/components/ui/SocialIcon";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Datos del negocio — Admin STOPee" }];

const MAX_SOCIAL_LINKS = 12;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const settings = await getLegalSettings();
  return data({
    razonSocial: settings.razonSocial ?? "",
    direccionFiscal: settings.direccionFiscal ?? "",
    correoContacto: settings.correoContacto ?? "",
    correoFacturacion: settings.correoFacturacion ?? "",
    telefono: settings.telefono ?? "",
    whatsappNumber: settings.whatsappNumber ?? "",
    socialUrls: (settings.socialLinks ?? []).map((link) => link.url),
    fichaTecnicaUrl: settings.fichaTecnicaUrl ?? "",
    logoUrl: settings.logoUrl ?? "",
    logoCompactUrl: settings.logoCompactUrl ?? "",
    tiemposEnvio: settings.tiemposEnvio ?? "",
    politicaDevoluciones: settings.politicaDevoluciones ?? "",
  });
}

// Todos opcionales (el negocio los va llenando poco a poco) pero, si traen
// algo, tiene que tener el formato correcto — así no se guarda silenciosamente
// un correo mal escrito que luego falla en el sitio público.
const optionalEmail = z.union([z.literal(""), z.string().trim().email("El correo de contacto no es válido.")]);

const businessDataSchema = z.object({
  razonSocial: z.string().trim().max(200),
  direccionFiscal: z.string().trim().max(400),
  correoContacto: optionalEmail,
  correoFacturacion: z.union([z.literal(""), z.string().trim().email("El correo para facturas no es válido.")]),
  telefono: z.string().trim().max(30),
  tiemposEnvio: z.string().trim().max(1000),
  politicaDevoluciones: z.string().trim().max(1000),
});

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await parseCatalogFormData(request);

  const parsed = businessDataSchema.safeParse({
    razonSocial: formData.get("razonSocial"),
    direccionFiscal: formData.get("direccionFiscal"),
    correoContacto: formData.get("correoContacto"),
    correoFacturacion: formData.get("correoFacturacion"),
    telefono: formData.get("telefono"),
    tiemposEnvio: formData.get("tiemposEnvio"),
    politicaDevoluciones: formData.get("politicaDevoluciones"),
  });
  if (!parsed.success) {
    return data({ ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
  }

  // Redes: se aceptan links sin "https://", se ignoran filas vacías y repetidas.
  const socialLinks: { url: string }[] = [];
  for (const raw of formData.getAll("socialUrl").map(String)) {
    if (!raw.trim()) continue;
    const url = normalizeSocialUrl(raw);
    if (!url) {
      return data(
        { ok: false, error: `“${raw.trim()}” no es un link válido. Pega la dirección completa del perfil, por ejemplo instagram.com/stopee.` },
        { status: 400 },
      );
    }
    if (!socialLinks.some((l) => l.url === url)) socialLinks.push({ url });
  }
  if (socialLinks.length > MAX_SOCIAL_LINKS) {
    return data({ ok: false, error: `Máximo ${MAX_SOCIAL_LINKS} redes sociales.` }, { status: 400 });
  }

  // Mismo formato E.164 sin espacios (ej. "+52 1 55 1234 5678" -> "5215512345678")
  // para armar el link wa.me.
  const whatsappNumber = String(formData.get("whatsappNumber") ?? "").replace(/\D/g, "");

  // Un PDF nuevo reemplaza al anterior; "quitar" lo borra; sin cambios, se conserva.
  const uploadedSheet = uploadedFileToPublicUrl(formData.get("fichaTecnica") as File | null);
  const removeSheet = formData.get("removeFichaTecnica") === "on";
  const fichaTecnicaUrl = uploadedSheet ?? (removeSheet ? "" : undefined);

  // Igual con los logos: uno nuevo reemplaza al actual; "volver al original" lo vacía.
  const logoChanges: { logoUrl?: string; logoCompactUrl?: string } = {};
  for (const [field, removeField, key] of [
    ["logo", "removeLogo", "logoUrl"],
    ["logoCompact", "removeLogoCompact", "logoCompactUrl"],
  ] as const) {
    const file = formData.get(field);
    const uploaded = uploadedFileToPublicUrl(file as File | null);
    if (!uploaded && file instanceof File && file.size > 0) {
      return data({ ok: false, error: "El logo debe ser una imagen PNG, JPG o WebP de máximo 8 MB." }, { status: 400 });
    }
    if (uploaded) logoChanges[key] = uploaded;
    else if (formData.get(removeField) === "on") logoChanges[key] = "";
  }

  await updateLegalSettings({
    ...parsed.data,
    whatsappNumber,
    socialLinks,
    ...(fichaTecnicaUrl !== undefined ? { fichaTecnicaUrl } : {}),
    ...logoChanges,
  });
  return data({ ok: true, error: null as string | null });
}

type SocialRow = { key: number; url: string };

function SocialLinksEditor({ initialUrls }: { initialUrls: string[] }) {
  const nextKey = useRef(initialUrls.length);
  const [rows, setRows] = useState<SocialRow[]>(() => initialUrls.map((url, key) => ({ key, url })));
  const [focusKey, setFocusKey] = useState<number | null>(null);

  // Tras agregar una fila, el cursor cae directo en su campo (menos clics).
  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(`socialUrl-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const addRow = () => {
    const key = nextKey.current++;
    setRows((current) => [...current, { key, url: "" }]);
    setFocusKey(key);
  };

  return (
    <div>
      <p className="text-sm font-semibold text-carbon">Redes sociales</p>
      <p className="mt-1 text-xs text-carbon/60">
        Pega el link del perfil — el ícono se elige solo según la red. Aparecen en el pie de página y en la
        página de pre-lanzamiento, en este mismo orden.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => {
          const normalized = normalizeSocialUrl(row.url);
          const network = normalized ? detectNetwork(normalized) : null;
          return (
            <li key={row.key} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
              <span
                aria-hidden="true"
                className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-carbon/15 bg-carbon text-hueso"
              >
                <SocialIcon id={network?.id ?? "link"} />
              </span>
              <div className="min-w-0">
                <label htmlFor={`socialUrl-${row.key}`} className="sr-only">
                  Link de red social
                </label>
                <input
                  id={`socialUrl-${row.key}`}
                  name="socialUrl"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={row.url}
                  onChange={(e) =>
                    setRows((current) => current.map((r) => (r.key === row.key ? { ...r, url: e.target.value } : r)))
                  }
                  placeholder="instagram.com/tu_cuenta"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-carbon/50">
                  {!row.url.trim()
                    ? "Pega aquí el link."
                    : !network
                      ? "Todavía no parece un link válido."
                      : network.id === "link"
                        ? `Red no reconocida (${network.name}): se mostrará con un ícono de enlace.`
                        : `Red reconocida: ${network.name}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                className="col-start-2 min-h-11 justify-self-start rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50 sm:col-start-3 sm:mt-1"
              >
                Quitar
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && <p className="mt-3 text-sm text-carbon/50">Aún no hay redes sociales.</p>}

      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= MAX_SOCIAL_LINKS}
        className="mt-3 min-h-11 rounded-full border border-carbon/20 px-5 text-sm font-semibold text-carbon hover:border-carbon/40 disabled:opacity-50"
      >
        + Agregar red social
      </button>
      <p className="mt-2 text-xs text-carbon/50">
        Con ícono propio: {SOCIAL_NETWORKS.filter((n) => n.id !== "whatsapp").map((n) => n.name).join(", ")}. Cualquier
        otra red también se puede agregar y se muestra con un ícono de enlace.
      </p>
    </div>
  );
}

export default function AdminNegocio() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  const [razonSocial, setRazonSocial] = useState(data.razonSocial);
  const [direccionFiscal, setDireccionFiscal] = useState(data.direccionFiscal);
  const [correoContacto, setCorreoContacto] = useState(data.correoContacto);
  const [correoFacturacion, setCorreoFacturacion] = useState(data.correoFacturacion);
  const [telefono, setTelefono] = useState(data.telefono);
  const [whatsappNumber, setWhatsappNumber] = useState(data.whatsappNumber);
  const [tiemposEnvio, setTiemposEnvio] = useState(data.tiemposEnvio);
  const [politicaDevoluciones, setPoliticaDevoluciones] = useState(data.politicaDevoluciones);

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Datos del negocio</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Un solo lugar para la información de la empresa. Se usa en el pie de página, el botón de WhatsApp, la
        página{" "}
        <a href="/como-funciona" target="_blank" rel="noreferrer" className="underline hover:text-carbon">
          /como-funciona
        </a>{" "}
        y los textos de{" "}
        <Link to="/admin/legal" className="underline hover:text-carbon">
          Legal (ARCO)
        </Link>
        .
      </p>

      <Form
        method="post"
        encType="multipart/form-data"
        className="mt-6 flex w-full min-w-0 flex-col gap-8 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6"
      >
        {/* Identidad */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold text-carbon">Empresa</h2>
          <Field label="Razón social" htmlFor="razonSocial">
            <input
              id="razonSocial"
              name="razonSocial"
              type="text"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder='Ej. "STOPee Higiene Urbana, S.A. de C.V."'
              className={inputClass}
            />
          </Field>
          <Field label="Dirección fiscal" htmlFor="direccionFiscal">
            <input
              id="direccionFiscal"
              name="direccionFiscal"
              type="text"
              value={direccionFiscal}
              onChange={(e) => setDireccionFiscal(e.target.value)}
              placeholder="Calle, número, colonia, ciudad, estado, C.P."
              className={inputClass}
            />
          </Field>
        </section>

        {/* Contacto y redes */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold text-carbon">Contacto y redes sociales</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Correo de contacto" htmlFor="correoContacto">
              <input
                id="correoContacto"
                name="correoContacto"
                type="email"
                value={correoContacto}
                onChange={(e) => setCorreoContacto(e.target.value)}
                placeholder="hola@tudominio.com"
                className={inputClass}
              />
            </Field>
            <Field label="Correo para solicitar facturas (opcional)" htmlFor="correoFacturacion">
              <input
                id="correoFacturacion"
                name="correoFacturacion"
                type="email"
                value={correoFacturacion}
                onChange={(e) => setCorreoFacturacion(e.target.value)}
                placeholder="Si lo dejas vacío, se usa el correo de contacto"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-carbon/50">
                Aparece en el carrito, en la página de gracias y en el correo de confirmación para quien necesite factura después de comprar.
              </p>
            </Field>
            <Field label="Teléfono de contacto (opcional)" htmlFor="telefono">
              <input
                id="telefono"
                name="telefono"
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="55 1234 5678"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="WhatsApp de negocio (opcional)" htmlFor="whatsappNumber">
            <input
              id="whatsappNumber"
              name="whatsappNumber"
              type="tel"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+52 55 1234 5678"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-carbon/50">
              {whatsappNumber
                ? "El sitio ya muestra el botón flotante de WhatsApp en todas las páginas públicas."
                : "Vacío: el botón flotante de WhatsApp no aparece hasta que captures un número aquí."}
            </p>
          </Field>

          <SocialLinksEditor initialUrls={data.socialUrls} />
        </section>

        {/* Logos */}
        <section className="flex flex-col gap-6">
          <div>
            <h2 className="font-display text-lg font-bold text-carbon">Logos</h2>
            <p className="mt-1 text-xs text-carbon/60">
              PNG con fondo transparente (o WebP/JPG), de al menos 1200 px de ancho y máximo 8 MB.
            </p>
          </div>
          {[
            {
              id: "logo",
              removeId: "removeLogo",
              label: "Logo principal (con eslogan)",
              current: data.logoUrl,
              fallback: "/elementos-design/logo-STOPee.webp",
              fallbackNote: "Logo original del proyecto.",
              usage: "Página de pre-lanzamiento y pie de página. También se usa en los demás lugares si no subes el compacto.",
            },
            {
              id: "logoCompact",
              removeId: "removeLogoCompact",
              label: "Logo compacto (sin eslogan, opcional)",
              current: data.logoCompactUrl,
              fallback: data.logoUrl || "/elementos-design/logo-STOPee.webp",
              fallbackNote: "Sin subir: se usa el logo principal.",
              usage: "Menú de arriba y pantallas de acceso y registro, donde el eslogan no se alcanza a leer.",
            },
          ].map((logo) => (
            <Field key={logo.id} label={logo.label} htmlFor={logo.id}>
              <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-carbon/10 bg-hueso p-4 sm:flex-row sm:items-center sm:gap-4">
                <img src={logo.current || logo.fallback} alt="" className="h-20 w-auto max-w-full shrink-0 self-start object-contain" />
                <p className="text-xs text-carbon/60">
                  {logo.current ? "Subido desde aquí." : logo.fallbackNote} {logo.usage}
                </p>
              </div>
              <input
                id={logo.id}
                name={logo.id}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={inputClass}
              />
              {logo.current && (
                <label className="mt-1 flex min-h-11 items-center gap-2 text-xs text-carbon/60">
                  <input type="checkbox" name={logo.removeId} className="h-5 w-5 shrink-0" />{" "}
                  {logo.id === "logo" ? "Volver al logo original" : "Quitar el logo compacto"}
                </label>
              )}
            </Field>
          ))}
        </section>

        {/* Documentos */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold text-carbon">Documentos</h2>
          <Field label="Ficha técnica en PDF (opcional)" htmlFor="fichaTecnica">
            <input id="fichaTecnica" name="fichaTecnica" type="file" accept="application/pdf,.pdf" className={inputClass} />
            {data.fichaTecnicaUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-carbon/60">
                <a href={data.fichaTecnicaUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center font-semibold underline hover:text-carbon">
                  Ver PDF actual
                </a>
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" name="removeFichaTecnica" className="h-5 w-5 shrink-0" /> Quitar el PDF actual
                </label>
              </div>
            ) : (
              <p className="mt-1 text-xs text-carbon/50">
                Vacío: el botón “Descargar ficha técnica” de /como-funciona no aparece hasta que subas el PDF.
              </p>
            )}
          </Field>
        </section>

        {/* Envíos y devoluciones */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold text-carbon">Envíos y devoluciones</h2>
          <Field label="Tiempos y costos de envío" htmlFor="tiemposEnvio">
            <textarea
              id="tiemposEnvio"
              name="tiemposEnvio"
              rows={3}
              value={tiemposEnvio}
              onChange={(e) => setTiemposEnvio(e.target.value)}
              placeholder="Ej. Los pedidos se procesan en 1-2 días hábiles y se entregan en 3-7 días hábiles. El costo se calcula en el checkout."
              className={inputClass}
            />
          </Field>
          <Field label="Política de devoluciones" htmlFor="politicaDevoluciones">
            <textarea
              id="politicaDevoluciones"
              name="politicaDevoluciones"
              rows={3}
              value={politicaDevoluciones}
              onChange={(e) => setPoliticaDevoluciones(e.target.value)}
              placeholder="Ej. Si tu pedido llega dañado o incompleto, contáctanos dentro de los 7 días naturales siguientes con fotos para procesar tu reembolso o reposición."
              className={inputClass}
            />
          </Field>
        </section>

        <div className="flex flex-col gap-3">
          {actionData?.ok && <p className="text-sm font-semibold text-bosque">Guardado. Ya está visible en el sitio.</p>}
          {actionData?.ok === false && <p className="text-sm font-semibold text-red-600">{actionData.error}</p>}
          <button
            type="submit"
            disabled={isSaving}
            className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
          >
            {isSaving ? "Guardando…" : "Guardar datos del negocio"}
          </button>
        </div>
      </Form>
    </div>
  );
}
