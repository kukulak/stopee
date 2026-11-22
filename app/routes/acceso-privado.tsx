import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { connectDB } from "~/lib/db.server";
import { getPasswordGateConfig, isGateWindowActive } from "~/models/passwordGate.server";
import { PromotionModel } from "~/models/promotion.server";
import { setCartCoupon } from "~/lib/cart.server";
import { grantGateAccess, hasGateAccess } from "~/lib/gateSession.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { EditableBrandSwirls } from "~/components/ui/EditableBrandSwirls";
import { COMPACT_PAGE_SWIRLS } from "~/components/ui/BrandSwirls";
import { Logo } from "~/components/ui/Logo";
import { safeRedirectTarget } from "~/lib/safeRedirect";

export const meta: MetaFunction = () => [{ title: "Acceso privado — STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await connectDB();
  const url = new URL(request.url);
  const redirectTo = safeRedirectTarget(url.searchParams.get("redirectTo"), "/tienda");

  const [config, alreadyUnlocked] = await Promise.all([getPasswordGateConfig(), hasGateAccess(request)]);

  // Nada que desbloquear: la compuerta no está activa ahora mismo, o ya se
  // tiene acceso — no tiene caso mostrar la pantalla, mandamos directo al destino.
  if (!isGateWindowActive(config) || alreadyUnlocked) {
    throw redirect(redirectTo);
  }

  return data({
    redirectTo,
    kicker: config.kicker,
    title: config.title,
    description: config.description,
    passwordPlaceholder: config.passwordPlaceholder,
    buttonText: config.buttonText,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  // Sin este límite, alguien podría probar contraseñas por fuerza bruta —
  // el código es una frase de campaña, no algo con entropía de verdad.
  const rateLimit = checkRateLimit(`gate:${ip}`, { max: 10, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) {
    return data({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  await connectDB();
  const formData = await request.formData();
  const submitted = String(formData.get("password") ?? "").trim();
  const redirectTo = safeRedirectTarget(String(formData.get("redirectTo") ?? ""), "/tienda");

  const config = await getPasswordGateConfig();

  if (!isGateWindowActive(config)) {
    throw redirect(redirectTo);
  }

  const expected = config.password.trim();
  if (!expected || submitted.toLowerCase() !== expected.toLowerCase()) {
    return data({ error: config.errorMessage }, { status: 401 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", await grantGateAccess(request, config.endsAt ? new Date(config.endsAt) : null));

  if (config.linkedPromotionId) {
    const promo = await PromotionModel.findById(config.linkedPromotionId).lean();
    if (promo?.coupon?.code) {
      headers.append("Set-Cookie", await setCartCoupon(request, promo.coupon.code));
    }
  }

  return redirect(redirectTo, { headers });
}

export default function AccesoPrivado() {
  const { redirectTo, kicker, title, description, passwordPlaceholder, buttonText } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [password, setPassword] = useState("");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-carbonDeep px-4 py-16 text-white">
      <EditableBrandSwirls swirls={COMPACT_PAGE_SWIRLS} id="acceso-privado" />

      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-carbon/70 p-8 backdrop-blur-md sm:p-10">
        <Logo variant="compact" className="mx-auto h-16 w-auto" />

        <p className="mt-6 text-center font-body text-xs font-bold uppercase tracking-widest text-limaNeon">
          {kicker}
        </p>
        <h1 className="mt-3 text-center font-display text-2xl font-black leading-tight text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-4 text-center text-sm text-slate-200/80">{description}</p>

        <Form method="post" className="mt-7 flex flex-col gap-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label htmlFor="password" className="sr-only">
            {passwordPlaceholder}
          </label>
          <input
            id="password"
            name="password"
            type="text"
            autoComplete="off"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordPlaceholder}
            className="min-h-12 rounded-full border border-white/20 bg-white/5 px-5 text-center text-white placeholder:text-white/40 focus:border-lima focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSubmitting || !password}
            className="min-h-12 rounded-full bg-lima px-6 text-sm font-bold text-carbon transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
          >
            {isSubmitting ? "Verificando…" : buttonText}
          </button>
          {actionData?.error && (
            <p role="alert" className="mt-1 text-center text-sm font-semibold text-red-300">
              {actionData.error}
            </p>
          )}
        </Form>
      </div>
    </div>
  );
}
