import { createCookieSessionStorage } from "react-router";
import { cookieSecret } from "~/lib/secrets.server";

export type CartItem = {
  sku: string;
  quantity: number;
};

const CART_SECRET = cookieSecret("cart");

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

/** Fija la cantidad exacta de una línea (para los +/- del carrito) — 0 o menos la elimina. */
export async function setCartQuantity(request: Request, sku: string, quantity: number) {
  const items = await getCart(request);
  if (quantity <= 0) {
    const filtered = items.filter((item) => item.sku !== sku);
    return { items: filtered, cookie: await saveCart(request, filtered) };
  }
  const existing = items.find((item) => item.sku === sku);
  if (existing) existing.quantity = quantity;
  else items.push({ sku, quantity });
  return { items, cookie: await saveCart(request, items) };
}

export async function setCartCoupon(request: Request, code: string | null) {
  const session = await getSession(request);
  if (code) session.set("couponCode", code);
  else session.unset("couponCode");
  return cartStorage.commitSession(session);
}

/** Método de envío que el cliente eligió en el carrito (ver ~/models/shipping.server). Sin elegir, el carrito usa el primero activo. */
export async function getCartShippingMethod(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const method = session.get("shippingMethod");
  return typeof method === "string" && method ? method : null;
}

export async function setCartShippingMethod(request: Request, method: string | null) {
  const session = await getSession(request);
  if (method) session.set("shippingMethod", method);
  else session.unset("shippingMethod");
  return cartStorage.commitSession(session);
}

export async function clearCart(request: Request) {
  const session = await getSession(request);
  session.unset("items");
  session.unset("couponCode");
  session.unset("shippingMethod");
  return cartStorage.commitSession(session);
}
