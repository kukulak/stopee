import mongoose, { type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { resolveHomeBlocks, type HomeBlockState } from "~/lib/homeBlocks";

const { Schema, model, models } = mongoose;

/**
 * La portada: lista ordenada de bloques (qué bloque, si se muestra y sus textos), editable en
 * /admin/inicio. Es un documento único. Sin documento, o con bloques que falten, se completa con
 * la portada de fábrica (ver ~/lib/homeBlocks.ts), así que nunca queda una portada vacía.
 */
const homeLayoutSchema = new Schema(
  {
    blocks: [
      {
        _id: false,
        type: { type: String, required: true },
        enabled: { type: Boolean, default: true },
        content: { type: Schema.Types.Mixed, default: {} },
      },
    ],
  },
  { timestamps: true, minimize: false },
);

type HomeLayoutDoc = {
  blocks: { type: string; enabled: boolean; content: Record<string, string> }[];
  updatedAt?: Date;
};

export const HomeLayoutModel =
  (models.HomeLayout as Model<HomeLayoutDoc>) ?? model<HomeLayoutDoc>("HomeLayout", homeLayoutSchema);

/** Los bloques de la portada en su orden, completos y limpios. */
export async function getHomeBlocks(): Promise<HomeBlockState[]> {
  await connectDB();
  const doc = await HomeLayoutModel.findOne().lean();
  return resolveHomeBlocks(doc?.blocks);
}

/** Igual que getHomeBlocks, más cuándo se guardó por última vez (null si nunca se ha editado). */
export async function getHomeBlocksWithMeta(): Promise<{ blocks: HomeBlockState[]; updatedAt: string | null }> {
  await connectDB();
  const doc = await HomeLayoutModel.findOne().lean();
  return {
    blocks: resolveHomeBlocks(doc?.blocks),
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

export async function saveHomeBlocks(blocks: HomeBlockState[]) {
  await connectDB();
  await HomeLayoutModel.findOneAndUpdate({}, { $set: { blocks } }, { upsert: true });
}

/** Vuelve a la portada de fábrica: borra lo guardado. */
export async function resetHomeBlocks() {
  await connectDB();
  await HomeLayoutModel.deleteMany({});
}
