import { createCookieSessionStorage } from "@remix-run/node";

export type CartItem = {
  sku: string;
  quantity: number;
};

const CART_SECRET = process.env.SESSION_SECRET ?? "stopee-cart-dev-secret";

export const cartStorage = createCookieSessionStorage({
  cookie: {
    name: "__stopee_cart",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [CART_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  },
});

async function getSession(request: Request) {
  return cartStorage.getSession(request.headers.get("Cookie"));
}

export async function getCart(request: Request): Promise<CartItem[]> {
  const session = await getSession(request);
  const items = session.get("items");
  return Array.isArray(items) ? items : [];
}

export async function getCartCoupon(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const code = session.get("couponCode");
  return typeof code === "string" && code ? code : null;
}

/** Preserva el resto de la sesión (p. ej. el cupón) al reescribir los items. */
async function saveCart(request: Request, items: CartItem[]) {
  const session = await getSession(request);
  session.set("items", items);
  return cartStorage.commitSession(session);
}

export async function addToCart(request: Request, sku: string, quantity = 1) {
  const items = await getCart(request);
  const existing = items.find((item) => item.sku === sku);
  if (existing) {
    existing.quantity += quantity;
  } else {
    items.push({ sku, quantity });
  }
  return { items, cookie: await saveCart(request, items) };
}

export async function removeFromCart(request: Request, sku: string) {
  const items = (await getCart(request)).filter((item) => item.sku !== sku);
  return { items, cookie: await saveCart(request, items) };
}

export async function setCartCoupon(request: Request, code: string | null) {
  const session = await getSession(request);
  if (code) session.set("couponCode", code);
  else session.unset("couponCode");
  return cartStorage.commitSession(session);
}

export async function clearCart(request: Request) {
  const session = await getSession(request);
  session.unset("items");
  session.unset("couponCode");
  return cartStorage.commitSession(session);
}
