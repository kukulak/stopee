import { getActiveBannerPromotion } from "~/models/promotion.server";
import { getActiveCustomBanner } from "~/models/siteBanner.server";

export type HeroBanner = {
  text: string;
  imageUrl: string | null;
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
        ctaText: promo.banner.ctaText ?? "",
        ctaHref: promo.banner.ctaHref || "/tienda",
      },
    });
  }

  if (custom) {
    candidates.push({
      updatedAt: new Date(custom.updatedAt as unknown as string),
      banner: {
        text: custom.text ?? "",
        imageUrl: custom.imageUrl || null,
        ctaText: custom.ctaText ?? "",
        ctaHref: custom.ctaHref || "/tienda",
      },
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return candidates[0].banner;
}
