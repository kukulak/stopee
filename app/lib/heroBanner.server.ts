import { linkTargetOr, normalizeLinkTarget } from "~/lib/inputValidation";
import { type HeroBanner } from "~/lib/heroBanner";
import { getActiveBannerPromotions } from "~/models/promotion.server";
import { getActiveCustomBanners, getActiveHomeBanners } from "~/models/siteBanner.server";

/** El destino guardado, ya validado: con botón nunca queda vacío; sin botón, vacío significa «sin enlace». */
function bannerTarget(raw: string | null | undefined, hasButton: boolean): string {
  return hasButton ? linkTargetOr(raw) : (normalizeLinkTarget(raw) ?? "");
}

/**
 * Los banners de la portada: todos los activos marcados para Inicio en /admin/banners, que rotan en un
 * carrusel (con uno solo se muestra fijo). Las promociones con banner van solo al carrusel de /tienda,
 * porque la portada habla de beneficios y la tienda de productos y ofertas.
 */
export async function getActiveHeroBanners(): Promise<HeroBanner[]> {
  const banners = await getActiveHomeBanners();
  return banners
    .map((custom) => ({
      text: custom.text ?? "",
      subtitle: custom.subtitle ?? "",
      imageUrl: custom.imageUrl || null,
      imageAlt: custom.imageAlt ?? "",
      ctaText: custom.ctaText ?? "",
      ctaHref: bannerTarget(custom.ctaHref, Boolean(custom.ctaText)),
    }))
    .filter((banner) => banner.text || banner.subtitle || banner.ctaText || banner.imageUrl);
}

/**
 * Todos los banners y promociones-con-banner activos, para el carrusel del
 * hero de /tienda — a diferencia del home (un solo hero), la tienda puede
 * mostrar varias promos/anuncios rotando, como los pósters de una tienda
 * física real.
 */
export async function getTiendaHeroSlides(): Promise<HeroBanner[]> {
  const [promos, customs] = await Promise.all([getActiveBannerPromotions(), getActiveCustomBanners()]);

  const fromPromos: { updatedAt: Date; banner: HeroBanner }[] = promos.map((promo) => ({
    updatedAt: new Date(promo.updatedAt as unknown as string),
    banner: {
      text: promo.banner?.text ?? "",
      subtitle: "",
      imageUrl: promo.banner?.imageUrl || null,
      imageAlt: promo.banner?.imageAlt ?? "",
      ctaText: promo.banner?.ctaText ?? "",
      ctaHref: bannerTarget(promo.banner?.ctaHref, Boolean(promo.banner?.ctaText)),
    },
  }));

  const fromCustoms: { updatedAt: Date; banner: HeroBanner }[] = customs.map((custom) => ({
    updatedAt: new Date(custom.updatedAt as unknown as string),
    banner: {
      text: custom.text ?? "",
      subtitle: "",
      imageUrl: custom.imageUrl || null,
      imageAlt: custom.imageAlt ?? "",
      ctaText: custom.ctaText ?? "",
      ctaHref: bannerTarget(custom.ctaHref, Boolean(custom.ctaText)),
    },
  }));

  return [...fromPromos, ...fromCustoms]
    .filter((c) => c.banner.text || c.banner.imageUrl)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((c) => c.banner);
}
