import type { LoaderFunctionArgs } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { isValidGooglePixelId, isValidMetaPixelId, isValidTikTokPixelId } from "~/lib/inputValidation";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { getSiteSettings, updateSiteSettings } from "~/models/siteSettings.server";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Configuración — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const settings = await getSiteSettings();
  return data({
    isStoreActive: settings.isStoreActive,
    googlePixelId: settings.googlePixelId ?? "",
    metaPixelId: settings.metaPixelId ?? "",
    tiktokPixelId: settings.tiktokPixelId ?? "",
    announcementBarText: settings.announcementBarText ?? "",
    announcementBarActive: settings.announcementBarActive ?? false,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-store") {
    const isStoreActive = formData.get("isStoreActive") === "true";
    await updateSiteSettings({ isStoreActive });
    return data({ ok: true as const, savedIntent: "toggle-store" as const, error: null });
  }

  if (intent === "save-tracking") {
    const googlePixelId = String(formData.get("googlePixelId") ?? "").trim();
    const metaPixelId = String(formData.get("metaPixelId") ?? "").trim();
    const tiktokPixelId = String(formData.get("tiktokPixelId") ?? "").trim();
    // Estos IDs se escriben dentro de un <script> de todas las páginas: solo se
    // aceptan con el formato exacto que usan Google y Meta.
    if (googlePixelId && !isValidGooglePixelId(googlePixelId)) {
      return data(
        { ok: false as const, savedIntent: undefined, error: 'El ID de Google no es válido. Debe verse como "G-XXXXXXXXXX".' },
        { status: 400 },
      );
    }
    if (metaPixelId && !isValidMetaPixelId(metaPixelId)) {
      return data(
        { ok: false as const, savedIntent: undefined, error: "El ID del píxel de Meta no es válido: son solo números (de 8 a 20 dígitos)." },
        { status: 400 },
      );
    }
    if (tiktokPixelId && !isValidTikTokPixelId(tiktokPixelId)) {
      return data(
        { ok: false as const, savedIntent: undefined, error: "El ID del píxel de TikTok no es válido: son letras mayúsculas y números, sin espacios." },
        { status: 400 },
      );
    }
    await updateSiteSettings({
      googlePixelId,
      metaPixelId,
      tiktokPixelId,
      announcementBarText: String(formData.get("announcementBarText") ?? "").trim(),
      announcementBarActive: formData.get("announcementBarActive") === "on",
    });
    return data({ ok: true as const, savedIntent: "save-tracking" as const, error: null });
  }

  return data(
    { ok: false as const, savedIntent: undefined, error: "Acción no reconocida." },
    { status: 400 },
  );
}

export default function AdminSettings() {
  const {
    isStoreActive,
    googlePixelId,
    metaPixelId,
    tiktokPixelId,
    announcementBarText,
    announcementBarActive,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmittingToggle =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "toggle-store";
  const isSubmittingTracking =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "save-tracking";

  return (
    <div className="w-full min-w-0 max-w-2xl">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Configuración</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Controla el interruptor de la tienda y el rastreo del sitio. Las alertas de inventario
        ahora se configuran por producto en{" "}
        <a href="/admin/catalog/products" className="underline hover:text-carbon">
          Catálogo
        </a>
        .
      </p>

      {/* Interruptor maestro */}
      <div className="mt-6 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-carbon">Tienda en línea</h2>
            <p className="mt-1 text-sm text-carbon/60">
              {isStoreActive
                ? "Activa: los visitantes ven la landing completa y pueden comprar."
                : "Inactiva: los visitantes ven la landing de pre-lanzamiento con lista de espera."}
            </p>
          </div>

          <Form method="post">
            <input type="hidden" name="intent" value="toggle-store" />
            <input type="hidden" name="isStoreActive" value={(!isStoreActive).toString()} />
            <button
              type="submit"
              disabled={isSubmittingToggle}
              aria-pressed={isStoreActive}
              className={`relative min-h-11 w-20 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                isStoreActive ? "bg-lima" : "bg-carbon/20"
              }`}
            >
              <span
                className={`absolute top-1 h-9 w-9 rounded-full bg-white shadow transition-transform ${
                  isStoreActive ? "translate-x-10" : "translate-x-1"
                }`}
              />
            </button>
          </Form>
        </div>

        {actionData?.ok && actionData.savedIntent === "toggle-store" && (
          <p className="mt-3 text-sm font-semibold text-bosque">
            Guardado. El cambio ya está activo para todos los visitantes.
          </p>
        )}
      </div>

      {/* Rastreo y anuncio */}
      <Form
        method="post"
        className="mt-6 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-4 sm:p-6"
      >
        <input type="hidden" name="intent" value="save-tracking" />
        <h2 className="font-display text-lg font-bold text-carbon">Rastreo y anuncio</h2>

        <div>
          <label htmlFor="googlePixelId" className="text-sm font-semibold text-carbon">
            Google Pixel ID (GA4 / GTM)
          </label>
          <input
            id="googlePixelId"
            name="googlePixelId"
            type="text"
            defaultValue={googlePixelId}
            placeholder="G-XXXXXXXXXX"
            className="mt-1 box-border w-full min-w-0 max-w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="metaPixelId" className="text-sm font-semibold text-carbon">
            Meta Pixel ID
          </label>
          <input
            id="metaPixelId"
            name="metaPixelId"
            type="text"
            defaultValue={metaPixelId}
            placeholder="123456789012345"
            className="mt-1 box-border w-full min-w-0 max-w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="tiktokPixelId" className="text-sm font-semibold text-carbon">
            TikTok Pixel ID
          </label>
          <input
            id="tiktokPixelId"
            name="tiktokPixelId"
            type="text"
            defaultValue={tiktokPixelId}
            placeholder="C4ABCDEFGHIJ1234567"
            className="mt-1 box-border w-full min-w-0 max-w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
          <p className="mt-1 text-xs text-carbon/50">
            Los píxeles de Meta y TikTok solo se activan para quien acepta las cookies de marketing; el de Google, para
            quien acepta las de estadísticas.
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-carbon/10 p-3 sm:p-4">
          <div className="flex min-h-11 items-center justify-between gap-4">
            <label htmlFor="announcementBarActive" className="min-w-0 text-sm font-semibold text-carbon">
              Mostrar barra de anuncio
            </label>
            <input
              id="announcementBarActive"
              name="announcementBarActive"
              type="checkbox"
              defaultChecked={announcementBarActive}
              className="h-6 w-6 shrink-0 accent-lima"
            />
          </div>
          <p className="mt-1 text-xs text-carbon/50">
            El texto se conserva aunque la apagues, para no tener que reescribirlo la próxima vez.
          </p>
          <label htmlFor="announcementBarText" className="mt-3 block text-sm font-semibold text-carbon">
            Texto de la barra
          </label>
          <input
            id="announcementBarText"
            name="announcementBarText"
            type="text"
            defaultValue={announcementBarText}
            placeholder="Envío gratis en pedidos mayores a $999"
            className="mt-1 box-border w-full min-w-0 max-w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>

        {actionData?.ok && actionData.savedIntent === "save-tracking" && (
          <p className="text-sm font-semibold text-bosque">Cambios guardados.</p>
        )}
        {actionData && !actionData.ok && actionData.error && (
          <p role="alert" className="text-sm font-semibold text-red-600">{actionData.error}</p>
        )}

        <button
          type="submit"
          disabled={isSubmittingTracking}
          className="min-h-11 w-full rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {isSubmittingTracking ? "Guardando…" : "Guardar cambios"}
        </button>
      </Form>

      <p className="mt-6 text-sm text-carbon/50">
        WhatsApp, redes sociales y demás datos de la empresa se editan en{" "}
        <a href="/admin/negocio" className="underline hover:text-carbon">
          Datos del negocio
        </a>
        .
      </p>
    </div>
  );
}
