import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";

/**
 * Cada banner se muestra en un solo lugar: la portada o la tienda, y en los dos lugares rotan en un
 * carrusel. Estas pruebas fijan esa regla contra un Mongo desechable, incluido el caso de los banners
 * creados antes de que existiera el campo «dónde se muestra»: esos siguen en la tienda y no aparecen
 * de pronto en la portada. Un banner solo imagen lleva su destino: toda la imagen es el enlace.
 */
describe.skipIf(!hasTestDb)("banners: portada y tienda", () => {
  let SiteBannerModel: typeof import("~/models/siteBanner.server").SiteBannerModel;
  let getActiveHeroBanners: typeof import("~/lib/heroBanner.server").getActiveHeroBanners;
  let getTiendaHeroSlides: typeof import("~/lib/heroBanner.server").getTiendaHeroSlides;
  let PromotionModel: typeof import("~/models/promotion.server").PromotionModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    ({ SiteBannerModel } = await import("~/models/siteBanner.server"));
    ({ getActiveHeroBanners, getTiendaHeroSlides } = await import("~/lib/heroBanner.server"));
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

  it("sin banners para la portada, no hay carrusel (se muestra el hero por defecto)", async () => {
    expect(await getActiveHeroBanners()).toEqual([]);
  });

  it("la portada muestra solo banners marcados para Inicio, con su frase de apoyo", async () => {
    await SiteBannerModel.create(banner({ placement: "tienda", text: "Pack inicial" }));
    await SiteBannerModel.create(
      banner({ placement: "home", text: "Tu perro disfruta el paseo", subtitle: "Tu calle también.", ctaText: "Ver la tienda" }),
    );
    const banners = await getActiveHeroBanners();
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ text: "Tu perro disfruta el paseo", subtitle: "Tu calle también.", ctaText: "Ver la tienda" });
  });

  it("la portada muestra TODOS los banners activos, el más nuevo primero, y editar uno no cambia el orden", async () => {
    const viejo = await SiteBannerModel.create(banner({ placement: "home", text: "Viejo" }));
    await tick();
    await SiteBannerModel.create(banner({ placement: "home", text: "Nuevo" }));
    await tick();
    await SiteBannerModel.create(banner({ placement: "home", text: "Más nuevo" }));
    expect((await getActiveHeroBanners()).map((b) => b.text)).toEqual(["Más nuevo", "Nuevo", "Viejo"]);

    await tick();
    viejo.text = "Viejo editado";
    await viejo.save();
    expect((await getActiveHeroBanners()).map((b) => b.text)).toEqual(["Más nuevo", "Nuevo", "Viejo editado"]);
  });

  it("un banner inactivo no se muestra", async () => {
    await SiteBannerModel.create(banner({ placement: "home", text: "Apagado", isActive: false }));
    await SiteBannerModel.create(banner({ placement: "home", text: "Encendido" }));
    expect((await getActiveHeroBanners()).map((b) => b.text)).toEqual(["Encendido"]);
  });

  describe("banner solo imagen: la imagen es el enlace", () => {
    const soloImagen = (over: Record<string, unknown> = {}) =>
      banner({ placement: "home", text: "", imageUrl: "https://cdn.example/puntos.webp", imageAlt: "Encuentra tu Punto de Recarga", ...over });

    it("conserva su destino (ruta del sitio o https) para que toda la imagen sea clicable", async () => {
      await SiteBannerModel.create(soloImagen({ ctaHref: "/puntos-de-recarga" }));
      const [b] = await getActiveHeroBanners();
      expect(b).toMatchObject({ imageUrl: "https://cdn.example/puntos.webp", ctaText: "", ctaHref: "/puntos-de-recarga" });
    });

    it("con el destino vacío no es clicable (no se inventa un enlace)", async () => {
      await SiteBannerModel.create(soloImagen({ ctaHref: "" }));
      expect((await getActiveHeroBanners())[0].ctaHref).toBe("");
    });

    it("un destino inseguro se descarta: nunca se enlaza a javascript: ni a http:", async () => {
      await SiteBannerModel.create(soloImagen({ ctaHref: "javascript:alert(1)" }));
      await tick();
      await SiteBannerModel.create(soloImagen({ ctaHref: "http://malo.example" }));
      expect((await getActiveHeroBanners()).map((b) => b.ctaHref)).toEqual(["", ""]);
    });

    it("con botón, el destino vacío o inválido cae a /tienda (el botón siempre lleva a algún lado)", async () => {
      await SiteBannerModel.create(banner({ placement: "home", text: "Hola", ctaText: "Ver", ctaHref: "" }));
      await tick();
      await SiteBannerModel.create(banner({ placement: "home", text: "Hola 2", ctaText: "Ver", ctaHref: "javascript:x" }));
      expect((await getActiveHeroBanners()).map((b) => b.ctaHref)).toEqual(["/tienda", "/tienda"]);
    });

    it("el carrusel de la tienda también deja clicable la imagen sola", async () => {
      await SiteBannerModel.create(soloImagen({ placement: "tienda", ctaHref: "/puntos-de-recarga" }));
      const [slide] = await getTiendaHeroSlides();
      expect(slide).toMatchObject({ text: "", ctaText: "", ctaHref: "/puntos-de-recarga" });
    });
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
    expect(await getActiveHeroBanners()).toEqual([]);
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

    expect(await getActiveHeroBanners()).toEqual([]);
    expect((await getTiendaHeroSlides()).map((s) => s.text)).toContain("10% en tu primera compra");
  });
});
