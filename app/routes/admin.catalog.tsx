import type { LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { ArrowLabel } from "~/components/ui/Icons";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Catálogo — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const [productCount, bundleCount] = await Promise.all([
    ProductModel.countDocuments(),
    BundleModel.countDocuments(),
  ]);
  return json({ productCount, bundleCount });
}

/**
 * Hub en vez de una sola página larga con todo: con pocos productos no se
 * notaba, pero apenas crezca el catálogo, tener que hacer scroll para llegar
 * a los paquetes se vuelve un problema. Cada sección vive en su propia ruta.
 */
export default function AdminCatalogHub() {
  const { productCount, bundleCount } = useLoaderData<typeof loader>();

  return (
    <div className="min-w-0">
      <h1 className="font-display text-2xl sm:text-3xl font-black text-carbon">Catálogo</h1>
      <p className="mt-1 text-sm text-carbon/60">Elige qué quieres administrar.</p>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Link
          to="/admin/catalog/products"
          className="group rounded-3xl border border-carbon/10 bg-white p-5 sm:p-8 transition-shadow hover:shadow-lg"
        >
          <p className="font-display text-2xl font-black text-carbon">Productos</p>
          <p className="mt-2 text-sm text-carbon/60">{productCount} productos individuales</p>
          <ArrowLabel className="mt-4 font-semibold text-bosque">Administrar</ArrowLabel>
        </Link>

        <Link
          to="/admin/catalog/bundles"
          className="group rounded-3xl border border-carbon/10 bg-white p-5 sm:p-8 transition-shadow hover:shadow-lg"
        >
          <p className="font-display text-2xl font-black text-carbon">Paquetes</p>
          <p className="mt-2 text-sm text-carbon/60">{bundleCount} paquetes armados</p>
          <ArrowLabel className="mt-4 font-semibold text-bosque">Administrar</ArrowLabel>
        </Link>
      </div>
    </div>
  );
}
