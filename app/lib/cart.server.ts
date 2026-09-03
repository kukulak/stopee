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

export async function getCart(request: Request): Promise<CartItem[]> {
  const session = await cartStorage.getSession(request.headers.get("Cookie"));
  const items = session.get("items");
  return Array.isArray(items) ? items : [];
}

export async function saveCart(items: CartItem[]) {
  const session = await cartStorage.getSession();
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
  return { items, cookie: await saveCart(items) };
}

export async function removeFromCart(request: Request, sku: string) {
  const items = (await getCart(request)).filter((item) => item.sku !== sku);
  return { items, cookie: await saveCart(items) };
}

export async function clearCart() {
  return saveCart([]);
}
