import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useState } from "react";
import {
  DEFAULT_COOKIES_MARKDOWN,
  DEFAULT_PRIVACY_MARKDOWN,
  getLegalSettings,
  updateLegalSettings,
} from "~/models/legalSettings.server";
import { applyLegalVariables, type LegalBusinessData } from "~/lib/legalTemplate";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import { subscriptionLegalVariables } from "~/lib/subscriptionConfig";
import { inputClass } from "~/components/admin/MediaFields";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Legal (ARCO) — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [settings, subscriptionConfig] = await Promise.all([getLegalSettings(), getSubscriptionConfig()]);
  return data({
    ...subscriptionLegalVariables(subscriptionConfig),
    razonSocial: settings.razonSocial ?? "",
    direccionFiscal: settings.direccionFiscal ?? "",
    correoContacto: settings.correoContacto ?? "",
    tiemposEnvio: settings.tiemposEnvio ?? "",
    politicaDevoluciones: settings.politicaDevoluciones ?? "",
    privacyPolicyMarkdown: settings.privacyPolicyMarkdown ?? "",
    termsMarkdown: settings.termsMarkdown ?? "",
    // Los guardados antes de existir la política de cookies no traen el campo: se muestra el texto de fábrica.
    cookiesMarkdown: settings.cookiesMarkdown?.trim() ? settings.cookiesMarkdown : DEFAULT_COOKIES_MARKDOWN,
    // Textos recomendados, para cargarlos en el editor con un botón (no se guardan hasta pulsar Guardar).
    defaults: { privacy: DEFAULT_PRIVACY_MARKDOWN, cookies: DEFAULT_COOKIES_MARKDOWN },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-privacy") {
    const privacyPolicyMarkdown = String(formData.get("privacyPolicyMarkdown") ?? "");
    if (!privacyPolicyMarkdown.trim()) {
      return data(
        { ok: false, savedIntent: "save-privacy", error: "El aviso de privacidad no puede quedar vacío." as string | null },
        { status: 400 },
      );
    }
    await updateLegalSettings({ privacyPolicyMarkdown });
    return data({ ok: true, savedIntent: "save-privacy", error: null as string | null });
  }

  if (intent === "save-cookies") {
    const cookiesMarkdown = String(formData.get("cookiesMarkdown") ?? "");
    if (!cookiesMarkdown.trim()) {
      return data(
        { ok: false, savedIntent: "save-cookies", error: "La política de cookies no puede quedar vacía." as string | null },
        { status: 400 },
      );
    }
    await updateLegalSettings({ cookiesMarkdown });
    return data({ ok: true, savedIntent: "save-cookies", error: null as string | null });
  }

  if (intent === "save-terms") {
    const termsMarkdown = String(formData.get("termsMarkdown") ?? "");
    if (!termsMarkdown.trim()) {
      return data(
        { ok: false, savedIntent: "save-terms", error: "Los términos no pueden quedar vacíos." as string | null },
        { status: 400 },
      );
    }
    await updateLegalSettings({ termsMarkdown });
    return data({ ok: true, savedIntent: "save-terms", error: null as string | null });
  }

  return data(
    { ok: false, savedIntent: "unknown", error: "Acción no reconocida." as string | null },
    { status: 400 },
  );
}

function LegalMarkdownPreview({ content, businessData }: { content: string; businessData: LegalBusinessData }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    const withVariables = applyLegalVariables(content, businessData);
    Promise.all([import("marked"), import("dompurify")]).then(([{ marked }, { default: DOMPurify }]) => {
      const rawHtml = marked.parse(withVariables, { async: false }) as string;
      if (!cancelled) setHtml(DOMPurify.sanitize(rawHtml));
    });
    return () => {
      cancelled = true;
    };
  }, [content, businessData]);
  return (
    <div
      className="prose prose-sm max-w-none overflow-x-auto break-words rounded-xl border border-carbon/10 bg-hueso/50 p-3 sm:p-4 prose-headings:font-display prose-headings:text-carbon prose-strong:text-carbon [&_mark]:rounded [&_mark]:bg-lima/40 [&_mark]:px-1"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function AdminLegal() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const savingIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;

  // Los datos del negocio ya no se editan aquí: viven en /admin/negocio y
  // estos textos solo los leen (la vista previa usa los valores guardados).
  const businessData: LegalBusinessData = {
    razonSocial: data.razonSocial,
    direccionFiscal: data.direccionFiscal,
    correoContacto: data.correoContacto,
    tiemposEnvio: data.tiemposEnvio,
    politicaDevoluciones: data.politicaDevoluciones,
    frecuenciasAutoenvio: data.frecuenciasAutoenvio,
    descuentoAutoenvio: data.descuentoAutoenvio,
  };
  const missingBusinessData = [
    !data.razonSocial && "razón social",
    !data.direccionFiscal && "dirección fiscal",
    !data.correoContacto && "correo de contacto",
  ].filter(Boolean) as string[];

  const [privacyPolicyMarkdown, setPrivacyPolicyMarkdown] = useState(data.privacyPolicyMarkdown);
  const [termsMarkdown, setTermsMarkdown] = useState(data.termsMarkdown);
  const [cookiesMarkdown, setCookiesMarkdown] = useState(data.cookiesMarkdown);

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Legal (ARCO)</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Edita aquí el aviso de privacidad, los términos y condiciones y la política de cookies. Se publican en{" "}
        <a href="/aviso-de-privacidad" target="_blank" rel="noreferrer" className="underline hover:text-carbon">
          /aviso-de-privacidad
        </a>
        ,{" "}
        <a href="/terminos-y-condiciones" target="_blank" rel="noreferrer" className="underline hover:text-carbon">
          /terminos-y-condiciones
        </a>{" "}
        y{" "}
        <a href="/politica-de-cookies" target="_blank" rel="noreferrer" className="underline hover:text-carbon">
          /politica-de-cookies
        </a>
        . No hace falta tocar código.
      </p>

      {/* Los datos del negocio se toman de /admin/negocio */}
      <div className="mt-6 min-w-0 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <h2 className="font-display text-lg font-bold text-carbon">Datos que usan estos textos</h2>
        <p className="mt-1 text-sm text-carbon/60">
          Razón social, dirección fiscal, correo, tiempos de envío y devoluciones se toman
          automáticamente de{" "}
          <Link to="/admin/negocio" className="font-semibold underline hover:text-carbon">
            Datos del negocio
          </Link>
          . Cámbialos allá y se actualizan aquí y en el sitio.
        </p>
        {missingBusinessData.length > 0 ? (
          <p className="mt-3 text-sm font-semibold text-amber-700">
            Falta capturar: {missingBusinessData.join(", ")}.{" "}
            <Link to="/admin/negocio" className="underline">
              Completar ahora
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-sm font-semibold text-bosque">Los datos obligatorios están completos.</p>
        )}
      </div>

      {/* Aviso de privacidad */}
      <Form method="post" className="mt-6 flex min-w-0 flex-col gap-3 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="save-privacy" />
        <h2 className="font-display text-lg font-bold text-carbon">Aviso de privacidad</h2>
        <p className="text-xs text-carbon/50">
          Formato markdown (## para encabezados, - para listas, **texto** para negritas). Usa{" "}
          <code>{"{{razonSocial}}"}</code> y <code>{"{{direccionFiscal}}"}</code> donde quieras que
          aparezcan esos datos.
        </p>
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => setPrivacyPolicyMarkdown(data.defaults.privacy)}
            className="min-h-11 rounded-full border-2 border-carbon/15 px-5 text-sm font-bold text-carbon hover:border-carbon/30"
          >
            Cargar el texto recomendado
          </button>
          <p className="text-xs text-carbon/50">
            Reemplaza lo que ves en el cuadro por el texto actualizado (incluye cookies y terceros). No se publica
            hasta que pulses «Guardar». Si ya personalizaste el aviso, revisa que no pierdas nada.
          </p>
        </div>
        <textarea
          name="privacyPolicyMarkdown"
          rows={16}
          value={privacyPolicyMarkdown}
          onChange={(e) => setPrivacyPolicyMarkdown(e.target.value)}
          className={`${inputClass} font-mono text-sm leading-relaxed`}
        />

        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">Vista previa</p>
        <LegalMarkdownPreview content={privacyPolicyMarkdown} businessData={businessData} />

        {actionData?.ok && actionData.savedIntent === "save-privacy" && (
          <p className="text-sm font-semibold text-bosque">Guardado. Ya está visible en el sitio.</p>
        )}
        {actionData?.ok === false && actionData.savedIntent === "save-privacy" && (
          <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
        )}

        <button
          type="submit"
          disabled={savingIntent === "save-privacy"}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {savingIntent === "save-privacy" ? "Guardando…" : "Guardar aviso de privacidad"}
        </button>
      </Form>

      {/* Política de cookies */}
      <Form method="post" className="mt-6 flex min-w-0 flex-col gap-3 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="save-cookies" />
        <h2 className="font-display text-lg font-bold text-carbon">Política de cookies</h2>
        <p className="text-xs text-carbon/50">
          La tabla de cookies debe coincidir con lo que hace el sitio. Si agregas una herramienta nueva de medición o
          publicidad, agrégala aquí y avísame para que vuelva a pedir el permiso a todos.
        </p>
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => setCookiesMarkdown(data.defaults.cookies)}
            className="min-h-11 rounded-full border-2 border-carbon/15 px-5 text-sm font-bold text-carbon hover:border-carbon/30"
          >
            Cargar el texto recomendado
          </button>
        </div>
        <textarea
          name="cookiesMarkdown"
          rows={16}
          value={cookiesMarkdown}
          onChange={(e) => setCookiesMarkdown(e.target.value)}
          className={`${inputClass} font-mono text-sm leading-relaxed`}
        />

        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">Vista previa</p>
        <LegalMarkdownPreview content={cookiesMarkdown} businessData={businessData} />

        {actionData?.ok && actionData.savedIntent === "save-cookies" && (
          <p className="text-sm font-semibold text-bosque">Guardado. Ya está visible en el sitio.</p>
        )}
        {actionData?.ok === false && actionData.savedIntent === "save-cookies" && (
          <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
        )}

        <button
          type="submit"
          disabled={savingIntent === "save-cookies"}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {savingIntent === "save-cookies" ? "Guardando…" : "Guardar política de cookies"}
        </button>
      </Form>

      {/* Términos y condiciones */}
      <Form method="post" className="mt-6 flex min-w-0 flex-col gap-3 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <input type="hidden" name="intent" value="save-terms" />
        <h2 className="font-display text-lg font-bold text-carbon">Términos y condiciones</h2>
        <p className="text-xs text-carbon/50">
          Usa <code>{"{{tiemposEnvio}}"}</code>, <code>{"{{politicaDevoluciones}}"}</code>,{" "}
          <code>{"{{razonSocial}}"}</code> y <code>{"{{direccionFiscal}}"}</code> donde correspondan.
        </p>
        <textarea
          name="termsMarkdown"
          rows={16}
          value={termsMarkdown}
          onChange={(e) => setTermsMarkdown(e.target.value)}
          className={`${inputClass} font-mono text-sm leading-relaxed`}
        />

        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">Vista previa</p>
        <LegalMarkdownPreview content={termsMarkdown} businessData={businessData} />

        {actionData?.ok && actionData.savedIntent === "save-terms" && (
          <p className="text-sm font-semibold text-bosque">Guardado. Ya está visible en el sitio.</p>
        )}
        {actionData?.ok === false && actionData.savedIntent === "save-terms" && (
          <p className="text-sm font-semibold text-red-600">{actionData.error}</p>
        )}

        <button
          type="submit"
          disabled={savingIntent === "save-terms"}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {savingIntent === "save-terms" ? "Guardando…" : "Guardar términos y condiciones"}
        </button>
      </Form>
    </div>
  );
}
