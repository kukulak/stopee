import { isStaff } from "~/lib/roles";
import { requireStoreAccess } from "~/lib/storeAccess.server";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { trackEvent } from "~/lib/trackClient";
import { Navbar } from "~/components/layout/Navbar";
import { Footer } from "~/components/layout/Footer";
import { BundleSelector } from "~/components/ecommerce/BundleSelector";
import { SubscriptionConfigurator } from "~/components/ecommerce/SubscriptionConfigurator";
import { getSubscriptionConfig } from "~/models/subscriptionSettings.server";
import { CartDrawer } from "~/components/ecommerce/CartDrawer";
import { CartOverlay } from "~/components/ecommerce/CartOverlay";
import { AddedToCartToast } from "~/components/ecommerce/AddedToCartToast";
import { HeroBannerCarousel } from "~/components/ecommerce/HeroBannerCarousel";
import { remainingToAdd, soldOutMessage, stockLimitMessage } from "~/lib/stock";
import { getCatalogItems, getCatalogItemBySku } from "~/lib/catalog.server";
import {
  addToCart,
  getCart,
  removeFromCart,
  setCartCoupon,
  setCartShippingMethod,
  setCartQuantity,
} from "~/lib/cart.server";
import { getShippingConfig, isShippingMethodId } from "~/models/shipping.server";
import { getUser } from "~/lib/session.server";
import { getSiteSettings } from "~/models/siteSettings.server";
import { findRedeemableCoupon } from "~/models/promotion.server";
import { checkCouponEligibility } from "~/lib/couponRules.server";
import { checkRateLimit, getClientIp, rateLimitMessage } from "~/lib/rateLimit.server";
import { getTiendaHeroSlides } from "~/lib/heroBanner.server";
import { getPasswordGateConfig, isGateWindowActive, isSkuGated } from "~/models/passwordGate.server";
import { hasGateAccess } from "~/lib/gateSession.server";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { buildCartView } from "~/lib/cartView.server";
import { MobileCartCta } from "~/components/ecommerce/MobileCartCta";
import { BrandText } from "~/components/ui/BrandText";

export const meta: MetaFunction = () => [
  { title: "Tienda STOPee — Higiene urbana canina" },
  {
    name: "description",
    content: "Compra STOPee Concentrado 1L, la botella aplicadora o paquetes completos. Activa tu suscripción periódica con 10% de descuento.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const [settings, user] = await Promise.all([getSiteSettings(), getUser(request)]);
  const isPreview = !settings.isStoreActive;

  // Un admin puede ver/probar la tienda aunque todavía no esté activa para
  // el público — todos los demás siguen viendo la landing de pre-lanzamiento.
  if (isPreview && !isStaff(user?.role)) {
    throw redirect("/");
  }

  const [heroSlides, catalogItems, shippingConfig, subscriptionConfig] = await Promise.all([
    getTiendaHeroSlides(),
    getCatalogItems(),
    getShippingConfig(),
    getSubscriptionConfig(),
  ]);

  const cartView = await buildCartView(request, { user, catalogItems, shippingConfig });
  const subscribableItems = catalogItems.filter((item) => item.isSubscribable);

  return data({
    catalogItems,
    ...cartView,
    isAuthenticated: Boolean(user),
    isPreview,
    heroSlides,
    subscribableItems,
    subscriptionConfig,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireStoreAccess(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "apply-coupon") {
    // Sin tope, alguien podría probar códigos uno tras otro hasta dar con uno vigente.
    const limit = await checkRateLimit(`apply-coupon:${getClientIp(request)}`, { max: 15, windowMs: 10 * 60 * 1000 });
    if (!limit.allowed) {
      return data({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });
    }
    const code = String(formData.get("code") ?? "").trim().slice(0, 40);
    if (!code) {
      return data({ error: "Ingresa un código." }, { status: 400 });
    }
    const promo = await findRedeemableCoupon(code);
    if (!promo?.coupon?.percentage) {
      return data({ error: "Ese código no es válido o ya venció." }, { status: 404 });
    }
    // Aquí solo se revisa quién es el cliente: el carrito puede estar vacío todavía,
    // y lo que le falte al carrito se avisa después en el propio carrito.
    const eligibility = await checkCouponEligibility(
      promo,
      { lines: [], user: await getUser(request) },
      "identity",
    );
    if (!eligibility.ok) {
      return data(
        { error: eligibility.reason, cta: eligibility.kind === "login" || eligibility.kind === "verify" ? eligibility.kind : null },
        { status: 400 },
      );
    }
    const cookie = await setCartCoupon(request, code.toUpperCase());
    return data({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "remove-coupon") {
    const cookie = await setCartCoupon(request, null);
    return data({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "set-shipping-method") {
    const method = formData.get("method");
    const config = await getShippingConfig();
    if (!isShippingMethodId(method) || !config.methods[method].isActive) {
      return data({ error: "Esa opción de envío ya no está disponible." }, { status: 400 });
    }
    const cookie = await setCartShippingMethod(request, method);
    return data({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  const sku = formData.get("sku");
  if (typeof sku !== "string" || !sku) {
    return data({ error: "Producto no válido." }, { status: 400 });
  }

  // Quitar del carrito (o bajar la cantidad a 0) siempre debe funcionar, aunque
  // el producto ya se haya pausado o eliminado del catálogo después de
  // agregarse — solo agregar o subir cantidad requiere que siga existiendo.
  if (intent === "remove-from-cart") {
    const { cookie } = await removeFromCart(request, sku);
    return data({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "update-quantity") {
    const quantity = Number(formData.get("quantity") ?? 0);
    const safeQuantity = Number.isFinite(quantity) ? Math.floor(quantity) : 0;
    if (safeQuantity > 0) {
      const item = await getCatalogItemBySku(sku);
      if (!item) return data({ error: "Ese producto ya no está disponible." }, { status: 400 });
      if (item.stock <= 0) return data({ error: soldOutMessage(item.name) }, { status: 400 });
      // Se guarda lo máximo posible en vez de rechazar: el cliente queda con
      // el tope y un aviso claro, sin perder lo que ya tenía en el carrito.
      if (safeQuantity > item.stock) {
        const { cookie } = await setCartQuantity(request, sku, item.stock);
        return data(
          { ok: true, notice: stockLimitMessage(item.stock, item.name) },
          { headers: { "Set-Cookie": cookie } },
        );
      }
    }
    const { cookie } = await setCartQuantity(request, sku, safeQuantity);
    return data({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "add-to-cart") {
    const item = await getCatalogItemBySku(sku);
    if (!item) {
      return data({ error: "Producto no válido." }, { status: 400 });
    }
    // Alcance "productos seleccionados" de la compuerta de acceso exclusivo:
    // aunque el visitante nunca haya entrado a /tienda/:sku, no debe poder
    // agregarlo directo desde la cuadrícula sin haber desbloqueado la clave.
    const gateConfig = await getPasswordGateConfig();
    if (isGateWindowActive(gateConfig) && isSkuGated(gateConfig, sku) && !(await hasGateAccess(request))) {
      return data({ error: "Este producto requiere una clave de acceso exclusivo." }, { status: 403 });
    }
    const requestedQuantity = Number(formData.get("quantity") ?? 1);
    const quantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? Math.floor(requestedQuantity) : 1;
    // Tope por existencia, contando lo que el cliente ya lleva en el carrito.
    const inCart = (await getCart(request)).find((line) => line.sku === sku)?.quantity ?? 0;
    const room = remainingToAdd(item.stock, inCart);
    if (item.stock <= 0) return data({ error: soldOutMessage(item.name) }, { status: 400 });
    if (room <= 0) {
      return data(
        { error: `Ya tienes en tu carrito todas las unidades disponibles (${item.stock}).` },
        { status: 400 },
      );
    }
    const { cookie } = await addToCart(request, sku, Math.min(quantity, room));
    return data(
      {
        ok: true,
        notice: quantity > room ? `Solo quedaban ${room} más; agregamos ${room}.` : undefined,
      },
      { headers: { "Set-Cookie": cookie } },
    );
  }

  return data({ error: "Acción no reconocida." }, { status: 400 });
}

export default function Tienda() {
  const {
    catalogItems,
    lines,
    subtotalMxn,
    discountPercent,
    discountLabel,
    coupon,
    couponNotice,
    gifts,
    heroSlides,
    isPreview,
    subscribableItems,
    subscriptionConfig,
    shipping,
    deliveryZone,
    addressDefaults,
    addressBook,
  } = useLoaderData<typeof loader>();
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const [cartOpen, setCartOpen] = useState(false);
  const [addedItem, setAddedItem] = useState<{ name: string } | null>(null);

  useEffect(() => {
    trackEvent("view_item");
    // El Navbar y la barra móvil enlazan a /tienda#carrito desde cualquier
    // página — como el carrito ya no vive siempre visible en el layout, el
    // hash es lo que le dice a esta página que debe abrirlo como overlay.
    if (window.location.hash === "#carrito") setCartOpen(true);
  }, []);

  return (
    <div className={`flex min-h-screen flex-col bg-hueso ${lines.length > 0 ? "pb-20 sm:pb-0" : ""}`}>
      <AddedToCartToast
        item={addedItem}
        onDismiss={() => setAddedItem(null)}
        onViewCart={() => {
          setCartOpen(true);
          setAddedItem(null);
        }}
      />
      {isPreview && (
        <div className="bg-carbon px-4 py-2 text-center text-sm font-semibold text-lima">
          Vista previa de administrador — la tienda todavía no está activa para el público.
        </div>
      )}
      <Navbar
        cartCount={itemCount}
        onOpenCart={() => {
          setCartOpen(true);
          setAddedItem(null);
        }}
      />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="mb-6">
            <Breadcrumbs items={[{ label: "Inicio", href: "/" }, { label: "Tienda" }]} />
          </div>

          {heroSlides.length > 0 && (
            <div className="mb-8">
              <HeroBannerCarousel slides={heroSlides} />
            </div>
          )}

          <p className="font-body text-sm font-bold uppercase tracking-widest text-oliva">
            <BrandText>Tienda STOPee</BrandText>
          </p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-black text-carbon sm:text-4xl">
            Elige tu STOPee y equipa tus paseos
          </h1>
          <p className="mt-3 max-w-2xl text-carbon/70">
            Compra individual o en paquete, o únete al {subscriptionConfig.programName || "Club STOPee"}
            {subscriptionConfig.discountPercent > 0 && ` y ahorra ${subscriptionConfig.discountPercent}% en cada entrega`}.
          </p>

          <div className="mt-10 flex flex-col gap-12">
            <BundleSelector
              products={catalogItems}
              onAdded={(name) => setAddedItem({ name })}
              inCart={Object.fromEntries(lines.map((l) => [l.sku, l.quantity]))}
            />
            <SubscriptionConfigurator
              mode="preview"
              products={subscribableItems}
              config={subscriptionConfig}
              deliveryZone={deliveryZone}
              addressDefaults={addressDefaults}
            />
          </div>
        </section>
      </main>

      <Footer />

      <CartOverlay open={cartOpen} onClose={() => setCartOpen(false)}>
        <CartDrawer
          lines={lines}
          subtotalMxn={subtotalMxn}
          discountPercent={discountPercent}
          discountLabel={discountLabel}
          coupon={coupon}
          couponNotice={couponNotice}
          gifts={gifts}
          shipping={shipping}
          deliveryZone={deliveryZone}
          addressDefaults={addressDefaults}
          addressBook={addressBook}
          onClose={() => setCartOpen(false)}
        />
      </CartOverlay>

      <MobileCartCta
        itemCount={itemCount}
        subtotalMxn={subtotalMxn}
        onOpenCart={() => {
          setCartOpen(true);
          setAddedItem(null);
        }}
      />
    </div>
  );
}
