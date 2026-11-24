import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";

/**
 * Cada banner se muestra en un solo lugar: la portada (un banner a la vez, el activo más reciente) o
 * la tienda (carrusel). Estas pruebas fijan esa regla contra un Mongo desechable, incluido el caso de
 * los banners creados antes de que existiera el campo «dónde se muestra»: esos siguen en la tienda y
 * no aparecen de pronto en la portada.
 */
describe.skipIf(!hasTestDb)("banners: portada y tienda", () => {
  let SiteBannerModel: typeof import("~/models/siteBanner.server").SiteBannerModel;
  let getActiveHeroBanner: typeof import("~/lib/heroBanner.server").getActiveHeroBanner;
  let getTiendaHeroSlides: typeof import("~/lib/heroBanner.server").getTiendaHeroSlides;
  let PromotionModel: typeof import("~/models/promotion.server").PromotionModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    ({ SiteBannerModel } = await import("~/models/siteBanner.server"));
    ({ getActiveHeroBanner, getTiendaHeroSlides } = await import("~/lib/heroBanner.server"));
    ({ PromotionModel } = await import("~/models/promotion.server"));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
  });

  /** Espera un instante: las marcas de tiempo de Mongo van en milisegundos, y dos cambios en el mismo milisegundo quedarían empatados. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

  const banner = (over: Record<string, unknown>) => ({
    name: "banner",
    text: "",
    isActive: true,
    ...over,
  });

  it("sin banners para la portada, no hay banner (se muestra el hero por defecto)", async () => {
    expect(await getActiveHeroBanner()).toBeNull();
  });

  it("la portada muestra solo banners marcados para Inicio, con su frase de apoyo", async () => {
    await SiteBannerModel.create(banner({ placement: "tienda", text: "Pack inicial" }));
    await SiteBannerModel.create(
      banner({ placement: "home", text: "Tu perro disfruta el paseo", subtitle: "Tu calle también.", ctaText: "Ver la tienda" }),
    );
    const hero = await getActiveHeroBanner();
    expect(hero).toMatchObject({ text: "Tu perro disfruta el paseo", subtitle: "Tu calle también.", ctaText: "Ver la tienda" });
  });

  it("en la portada se muestra uno solo: el activo editado más recientemente", async () => {
    const viejo = await SiteBannerModel.create(banner({ placement: "home", text: "Viejo" }));
    await tick();
    await SiteBannerModel.create(banner({ placement: "home", text: "Nuevo" }));
    expect((await getActiveHeroBanner())?.text).toBe("Nuevo");

    // Editar el viejo lo vuelve el más reciente.
    await tick();
    viejo.text = "Viejo editado";
    await viejo.save();
    expect((await getActiveHeroBanner())?.text).toBe("Viejo editado");
  });

  it("un banner inactivo no se muestra", async () => {
    await SiteBannerModel.create(banner({ placement: "home", text: "Apagado", isActive: false }));
    expect(await getActiveHeroBanner()).toBeNull();
  });

  it("la tienda muestra los de Tienda y también los viejos sin el campo, nunca los de Inicio", async () => {
    await SiteBannerModel.create(banner({ placement: "tienda", text: "Pack inicial" }));
    await SiteBannerModel.create(banner({ placement: "home", text: "Solo portada" }));
    // Un banner creado antes de existir el campo: se inserta sin él.
    await SiteBannerModel.collection.insertOne({
      name: "viejo",
      text: "Banner anterior",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const textos = (await getTiendaHeroSlides()).map((s) => s.text).sort();
    expect(textos).toEqual(["Banner anterior", "Pack inicial"]);
  });

  it("un banner viejo sin el campo no aparece de pronto en la portada", async () => {
    await SiteBannerModel.collection.insertOne({
      name: "viejo",
      text: "Banner anterior",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await getActiveHeroBanner()).toBeNull();
  });

  it("las promociones con banner van solo a la tienda, no a la portada", async () => {
    await PromotionModel.create({
      name: "Promo",
      type: "coupon",
      code: "PROMO10",
      percentOff: 10,
      isActive: true,
      banner: { enabled: true, text: "10% en tu primera compra", ctaText: "Aprovechar", ctaHref: "/tienda" },
    } as never);

    expect(await getActiveHeroBanner()).toBeNull();
    expect((await getTiendaHeroSlides()).map((s) => s.text)).toContain("10% en tu primera compra");
  });
});
