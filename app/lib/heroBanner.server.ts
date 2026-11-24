import { linkTargetOr } from "~/lib/inputValidation";
import { getActiveBannerPromotions } from "~/models/promotion.server";
import { getActiveCustomBanners, getActiveHomeBanner } from "~/models/siteBanner.server";

export type HeroBanner = {
  text: string;
  /** Frase de apoyo bajo el título (solo la usa el banner de la portada). */
  subtitle: string;
  imageUrl: string | null;
  imageAlt: string;
  ctaText: string;
  ctaHref: string;
};

/**
 * El banner de la portada: el banner activo más reciente que se haya marcado para la portada en
 * /admin/banners (solo se muestra uno a la vez). Las promociones con banner van solo al carrusel de
 * /tienda, porque la portada habla de beneficios y la tienda de productos y ofertas.
 */
export async function getActiveHeroBanner(): Promise<HeroBanner | null> {
  const custom = await getActiveHomeBanner();
  if (!custom) return null;
  return {
    text: custom.text ?? "",
    subtitle: custom.subtitle ?? "",
    imageUrl: custom.imageUrl || null,
    imageAlt: custom.imageAlt ?? "",
    ctaText: custom.ctaText ?? "",
    ctaHref: linkTargetOr(custom.ctaHref),
  };
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
      ctaHref: linkTargetOr(promo.banner?.ctaHref),
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
      ctaHref: linkTargetOr(custom.ctaHref),
    },
  }));

  return [...fromPromos, ...fromCustoms]
    .filter((c) => c.banner.text || c.banner.imageUrl)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((c) => c.banner);
}
