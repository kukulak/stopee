import { ProductModel } from "~/models/product.server";
import { BundleModel } from "~/models/bundle.server";
import { logError } from "~/lib/logger.server";
import type mongoose from "mongoose";

type SoldLine = { sku: string; quantity: number };

/**
 * Resta de las existencias lo que se acaba de vender. Un paquete resta a cada
 * uno de sus productos componentes (cantidad del paquete × cantidad del
 * componente), porque su stock es el de los productos que lo forman.
 *
 * Cada resta es atómica y condicionada (`stock >= cantidad`): dos pagos
 * simultáneos del último producto no pueden dejar el stock en negativo. Si
 * alguien pagó más de lo que había (dos checkouts abiertos a la vez), el stock
 * queda en 0 y se deja un aviso en los registros para surtir el faltante.
 */
export async function decrementStock(lines: SoldLine[]) {
  for (const line of lines) {
    const quantity = Math.floor(line.quantity);
    if (!line.sku || !(quantity > 0)) continue;

    const product = await ProductModel.findOne({ sku: line.sku }).select("_id").lean();
    if (product) {
      await decrementProduct(product._id, quantity, line.sku);
      continue;
    }

    const bundle = await BundleModel.findOne({ sku: line.sku }).select("products").lean();
    if (bundle) {
      for (const component of bundle.products ?? []) {
        await decrementProduct(component.product, quantity * (component.quantity ?? 1), line.sku);
      }
    }
    // Un SKU que no es producto ni paquete (p. ej. "loyalty-gift") no tiene existencias.
  }
}

async function decrementProduct(productId: mongoose.Types.ObjectId, quantity: number, soldAs: string) {
  const done = await ProductModel.updateOne(
    { _id: productId, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
  );
  if (done.modifiedCount === 1) return;

  // No alcanzaba: se deja en 0 (nunca negativo) y se avisa para surtir el faltante.
  await ProductModel.updateOne({ _id: productId, stock: { $gt: 0 } }, { $set: { stock: 0 } });
  logError("inventory-oversold", new Error("Se vendió más de lo que había en existencia."), {
    soldAs,
    productId: String(productId),
    quantity,
  });
}
