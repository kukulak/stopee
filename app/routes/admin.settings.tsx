import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { getSiteSettings, updateSiteSettings } from "~/models/siteSettings.server";

export const meta: MetaFunction = () => [{ title: "Configuración — Admin STOPee" }];

export async function loader() {
  const settings = await getSiteSettings();
  return json({
    isStoreActive: settings.isStoreActive,
    googlePixelId: settings.googlePixelId ?? "",
    metaPixelId: settings.metaPixelId ?? "",
    announcementBarText: settings.announcementBarText ?? "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-store") {
    const isStoreActive = formData.get("isStoreActive") === "true";
    await updateSiteSettings({ isStoreActive });
    return json({ ok: true as const, savedIntent: "toggle-store" as const, error: null });
  }

  if (intent === "save-tracking") {
    await updateSiteSettings({
      googlePixelId: String(formData.get("googlePixelId") ?? "").trim(),
      metaPixelId: String(formData.get("metaPixelId") ?? "").trim(),
      announcementBarText: String(formData.get("announcementBarText") ?? "").trim(),
    });
    return json({ ok: true as const, savedIntent: "save-tracking" as const, error: null });
  }

  return json(
    { ok: false as const, savedIntent: undefined, error: "Acción no reconocida." },
    { status: 400 },
  );
}

export default function AdminSettings() {
  const { isStoreActive, googlePixelId, metaPixelId, announcementBarText } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmittingToggle =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "toggle-store";
  const isSubmittingTracking =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save-tracking";

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-black text-carbon">Configuración</h1>
      <p className="mt-1 text-sm text-carbon/60">
        Controla el interruptor de la tienda y el rastreo del sitio.
      </p>

      {/* Interruptor maestro */}
      <div className="mt-6 rounded-3xl border border-carbon/10 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
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
      <Form method="post" className="mt-6 flex flex-col gap-5 rounded-3xl border border-carbon/10 bg-white p-6">
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
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
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
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="announcementBarText" className="text-sm font-semibold text-carbon">
            Texto de barra de anuncio (opcional)
          </label>
          <input
            id="announcementBarText"
            name="announcementBarText"
            type="text"
            defaultValue={announcementBarText}
            placeholder="Envío gratis en pedidos mayores a $999"
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
          <p className="mt-1 text-xs text-carbon/50">Déjalo vacío para ocultar la barra.</p>
        </div>

        {actionData?.ok && actionData.savedIntent === "save-tracking" && (
          <p className="text-sm font-semibold text-bosque">Cambios guardados.</p>
        )}

        <button
          type="submit"
          disabled={isSubmittingTracking}
          className="min-h-11 self-start rounded-full bg-carbon px-6 text-sm font-bold text-hueso disabled:opacity-60"
        >
          {isSubmittingTracking ? "Guardando…" : "Guardar cambios"}
        </button>
      </Form>
    </div>
  );
}
