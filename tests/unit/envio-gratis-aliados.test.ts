import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_CONFIG, buildShippingQuote, type ShippingConfig } from "~/models/shipping.server";

const config = (changes: Partial<ShippingConfig> = {}): ShippingConfig => ({ ...DEFAULT_SHIPPING_CONFIG, ...changes });

describe("envío gratis para Puntos de Recarga", () => {
  it("de fábrica el monto de aliados es $1,699 y está prendido; el de clientes sigue apagado", () => {
    expect(DEFAULT_SHIPPING_CONFIG.allyFreeShippingThreshold).toBe(1699);
    expect(DEFAULT_SHIPPING_CONFIG.allyFreeShippingEnabled).toBe(true);
    expect(DEFAULT_SHIPPING_CONFIG.freeShippingEnabled).toBe(false);
  });

  it("un aliado llega al envío gratis desde $1,699 en las dos opciones", () => {
    const quote = buildShippingQuote(config(), 1699, "home", { isAlly: true });
    expect(quote.options.map((o) => o.cost)).toEqual([0, 0]);
    expect(quote.selected?.isFree).toBe(true);
    expect(quote.freeRemaining).toBeNull();
  });

  it("a $1,698 todavía paga y se le avisa que le falta $1", () => {
    const quote = buildShippingQuote(config(), 1698, null, { isAlly: true });
    expect(quote.selected?.cost).toBe(69);
    expect(quote.freeThreshold).toBe(1699);
    expect(quote.freeRemaining).toBe(1);
  });

  it("un cliente normal no recibe nada de esto: ni envío gratis ni meta en el carrito", () => {
    const quote = buildShippingQuote(config(), 5000, null);
    expect(quote.selected?.cost).toBe(69);
    expect(quote.freeThreshold).toBeNull();
    expect(quote.freeRemaining).toBeNull();
  });

  it("con el envío gratis de clientes prendido, cada quien ve su meta; el aliado ve la más baja", () => {
    const c = config({ freeShippingEnabled: true, freeShippingThreshold: 599 });
    expect(buildShippingQuote(c, 100, null).freeThreshold).toBe(599);
    expect(buildShippingQuote(c, 100, null, { isAlly: true }).freeThreshold).toBe(599);
    expect(buildShippingQuote(c, 700, null, { isAlly: true }).selected?.cost).toBe(0);

    const caro = config({ freeShippingEnabled: true, freeShippingThreshold: 3000 });
    expect(buildShippingQuote(caro, 1800, null, { isAlly: true }).selected?.cost).toBe(0);
    expect(buildShippingQuote(caro, 1800, null).selected?.cost).toBe(69);
  });

  it("apagado el interruptor de aliados, nadie recibe envío gratis por ser aliado ni ve meta", () => {
    const apagado = config({ allyFreeShippingEnabled: false });
    const quote = buildShippingQuote(apagado, 5000, null, { isAlly: true });
    expect(quote.selected?.cost).toBe(69);
    expect(quote.freeThreshold).toBeNull();
    expect(quote.freeRemaining).toBeNull();
    // Y el envío gratis de clientes, si está prendido, sigue valiendo para el aliado.
    const conClientes = config({ allyFreeShippingEnabled: false, freeShippingEnabled: true, freeShippingThreshold: 599 });
    expect(buildShippingQuote(conClientes, 700, null, { isAlly: true }).selected?.cost).toBe(0);
  });

  it("un carrito vacío no muestra meta de 'te faltan'", () => {
    expect(buildShippingQuote(config(), 0, null, { isAlly: true }).freeRemaining).toBeNull();
  });

  it("si el negocio apagó el cobro de envío, no hay nada que cotizar", () => {
    const quote = buildShippingQuote(config({ isEnabled: false }), 100, null, { isAlly: true });
    expect(quote.enabled).toBe(false);
    expect(quote.freeThreshold).toBeNull();
  });
});
