import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { trackEvent } from "~/lib/trackClient";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { BundleSelector } from "~/components/ecommerce/BundleSelector";
import { SubscriptionConfigurator } from "~/components/ecommerce/SubscriptionConfigurator";
import { CartDrawer, type CartLine } from "~/components/ecommerce/CartDrawer";
import { PromoBanner } from "~/components/ecommerce/PromoBanner";
import { PRODUCTS } from "~/data/products";
import type { ProductSku } from "~/data/products";
import { addToCart, getCart, getCartCoupon, removeFromCart, setCartCoupon, setCartQuantity } from "~/lib/cart.server";
import { getUser } from "~/lib/session.server";
import { getSiteSettings } from "~/models/siteSettings.server";
import { findRedeemableCoupon } from "~/models/promotion.server";
import { evaluateRequirementPromotion } from "~/lib/promotionEngine.server";
import { getActiveHeroBanner } from "~/lib/heroBanner.server";

export const meta: MetaFunction = () => [
  { title: "Tienda STOPee — Higiene urbana canina" },
  {
    name: "description",
    content: "Compra STOPee Concentrado 1L, la Botella Squishable o paquetes completos. Activa tu suscripción periódica con 10% de descuento.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const [settings, user] = await Promise.all([getSiteSettings(), getUser(request)]);
  const isPreview = !settings.isStoreActive;

  // Un admin puede ver/probar la tienda aunque todavía no esté activa para
  // el público — todos los demás siguen viendo la landing de pre-lanzamiento.
  if (isPreview && user?.role !== "admin") {
    throw redirect("/");
  }

  const [cartItems, couponCode, heroBanner] = await Promise.all([
    getCart(request),
    getCartCoupon(request),
    getActiveHeroBanner(),
  ]);

  const lines: CartLine[] = cartItems
    .filter((item): item is { sku: ProductSku; quantity: number } => item.sku in PRODUCTS)
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      product: PRODUCTS[item.sku],
    }));

  const subtotalMxn = lines.reduce((sum, line) => sum + line.product.priceMxn * line.quantity, 0);

  let coupon: { code: string; percentage: number } | null = null;
  if (couponCode) {
    const promo = await findRedeemableCoupon(couponCode);
    if (promo?.coupon?.percentage) {
      coupon = { code: couponCode, percentage: promo.coupon.percentage };
    }
  }

  const isFirstPurchase = Boolean(user && user.individualPurchaseCount === 0);
  const requirementMatch = await evaluateRequirementPromotion(
    lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
    isFirstPurchase,
  );
  const requirementGift = requirementMatch?.rewardGiftSku ? PRODUCTS[requirementMatch.rewardGiftSku].name : null;

  // La recompensa de lealtad (si la tiene) es para SU SIGUIENTE compra, nunca
  // permanente — ver app/lib/loyalty.ts y webhooks.stripe.tsx.
  const pendingReward = user?.loyaltyPendingReward;
  const loyaltyGift = pendingReward?.rewardType === "gift" ? pendingReward.giftDescription ?? null : null;
  const loyaltyDiscountPercent = pendingReward?.rewardType === "discount" ? pendingReward.percentage ?? 0 : 0;

  // Prioridad para el DESCUENTO: un cupón explícito del cliente gana sobre
  // una promoción condicional, y esta a su vez gana sobre la lealtad. Los
  // regalos (requisito + lealtad) no compiten entre sí, ambos se muestran.
  let discountPercent = 0;
  let discountLabel = "";
  if (coupon) {
    discountPercent = coupon.percentage;
    discountLabel = `Cupón ${coupon.code}`;
  } else if (requirementMatch?.rewardDiscountPercentage) {
    discountPercent = requirementMatch.rewardDiscountPercentage;
    discountLabel = requirementMatch.name;
  } else if (loyaltyDiscountPercent > 0) {
    discountPercent = loyaltyDiscountPercent;
    discountLabel = pendingReward?.promotionName ?? "Recompensa de lealtad";
  }

  const gifts = [requirementGift, loyaltyGift].filter((g): g is string => Boolean(g));

  return json({
    lines,
    subtotalMxn,
    discountPercent,
    discountLabel,
    coupon,
    gifts,
    isAuthenticated: Boolean(user),
    isPreview,
    banner: heroBanner
      ? {
          text: heroBanner.text,
          ctaText: heroBanner.ctaText,
          ctaHref: heroBanner.ctaHref,
          imageUrl: heroBanner.imageUrl,
        }
      : null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "apply-coupon") {
    const code = String(formData.get("code") ?? "").trim();
    if (!code) {
      return json({ error: "Ingresa un código." }, { status: 400 });
    }
    const promo = await findRedeemableCoupon(code);
    if (!promo?.coupon?.percentage) {
      return json({ error: "Ese código no es válido o ya venció." }, { status: 404 });
    }
    const cookie = await setCartCoupon(request, code.toUpperCase());
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "remove-coupon") {
    const cookie = await setCartCoupon(request, null);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  const sku = formData.get("sku");
  if (typeof sku !== "string" || !(sku in PRODUCTS)) {
    return json({ error: "Producto no válido." }, { status: 400 });
  }

  if (intent === "add-to-cart") {
    const requestedQuantity = Number(formData.get("quantity") ?? 1);
    const quantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? Math.floor(requestedQuantity) : 1;
    const { cookie } = await addToCart(request, sku, quantity);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "update-quantity") {
    const quantity = Number(formData.get("quantity") ?? 0);
    const { cookie } = await setCartQuantity(request, sku, Number.isFinite(quantity) ? Math.floor(quantity) : 0);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "remove-from-cart") {
    const { cookie } = await removeFromCart(request, sku);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  return json({ error: "Acción no reconocida." }, { status: 400 });
}

export default function Tienda() {
  const { lines, subtotalMxn, discountPercent, discountLabel, coupon, gifts, banner, isPreview } =
    useLoaderData<typeof loader>();

  useEffect(() => {
    trackEvent("view_item");
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-hueso">
      {isPreview && (
        <div className="bg-carbon px-4 py-2 text-center text-sm font-semibold text-lima">
          Vista previa de administrador — la tienda todavía no está activa para el público.
        </div>
      )}
      <Navbar cartCount={lines.reduce((sum, l) => sum + l.quantity, 0)} />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          {banner && (
            <div className="mb-8">
              <PromoBanner
                text={banner.text}
                imageUrl={banner.imageUrl}
                ctaText={banner.ctaText}
                ctaHref={banner.ctaHref}
              />
            </div>
          )}

          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            Tienda STOPee
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-black text-carbon sm:text-4xl">
            Elige tu STOPee y equipa tus paseos
          </h1>
          <p className="mt-3 max-w-2xl text-carbon/70">
            Compra individual o en paquete. Cuando sepas cuánto te dura tu primer litro, activa
            el auto-envío periódico y ahorra 10% en cada entrega.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_340px]">
            <div className="flex flex-col gap-12">
              <BundleSelector />
              <SubscriptionConfigurator />
            </div>

            <CartDrawer
              lines={lines}
              subtotalMxn={subtotalMxn}
              discountPercent={discountPercent}
              discountLabel={discountLabel}
              coupon={coupon}
              gifts={gifts}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
