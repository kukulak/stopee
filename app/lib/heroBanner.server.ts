import { linkTargetOr } from "~/lib/inputValidation";
import { getActiveBannerPromotion, getActiveBannerPromotions } from "~/models/promotion.server";
import { getActiveCustomBanner, getActiveCustomBanners } from "~/models/siteBanner.server";

export type HeroBanner = {
  text: string;
  imageUrl: string | null;
  imageAlt: string;
  ctaText: string;
  ctaHref: string;
};

/**
 * El hero del home puede venir de una promoción con banner activado o de un
 * banner subido directamente en /admin/banners, sin relación con ningún
 * descuento. Los dos compiten por el mismo espacio: gana el que se haya
 * activado/editado más recientemente, mismo criterio que ya se usa para
 * elegir entre cupón/lealtad/promoción por requisito en el checkout.
 */
export async function getActiveHeroBanner(): Promise<HeroBanner | null> {
  const [promo, custom] = await Promise.all([getActiveBannerPromotion(), getActiveCustomBanner()]);

  const candidates: { updatedAt: Date; banner: HeroBanner }[] = [];

  if (promo?.banner?.enabled) {
    candidates.push({
      updatedAt: new Date(promo.updatedAt as unknown as string),
      banner: {
        text: promo.banner.text ?? "",
        imageUrl: promo.banner.imageUrl || null,
        imageAlt: promo.banner.imageAlt ?? "",
        ctaText: promo.banner.ctaText ?? "",
        ctaHref: linkTargetOr(promo.banner.ctaHref),
      },
    });
  }

  if (custom) {
    candidates.push({
      updatedAt: new Date(custom.updatedAt as unknown as string),
      banner: {
        text: custom.text ?? "",
        imageUrl: custom.imageUrl || null,
        imageAlt: custom.imageAlt ?? "",
        ctaText: custom.ctaText ?? "",
        ctaHref: linkTargetOr(custom.ctaHref),
      },
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return candidates[0].banner;
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
