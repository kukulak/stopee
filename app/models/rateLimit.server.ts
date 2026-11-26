import mongoose, { type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Contadores del límite de intentos (ver ~/lib/rateLimit.server.ts). Un documento por
 * "acción:cliente" (por ejemplo "cuenta-login:203.0.113.4"). Viven en Mongo y no en la memoria
 * de cada proceso para que Cloud Run pueda tener varias instancias sin que el tope se multiplique.
 *
 * `resetAt` es cuándo termina la ventana: Mongo borra el documento solo poco después (índice TTL),
 * así la colección nunca crece. Mongo revisa los vencidos cada ~60 segundos, por eso el código no
 * confía en el borrado: un contador vencido que siga ahí se trata como una ventana nueva.
 */
export type RateLimitDoc = { _id: string; count: number; resetAt: Date };

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitModel =
  (models.RateLimit as Model<RateLimitDoc>) ?? model<RateLimitDoc>("RateLimit", rateLimitSchema);
