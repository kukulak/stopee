import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Enlaces de un solo uso que se mandan por correo: restablecer contraseña y
 * confirmar el correo. Solo se guarda el hash (SHA-256) del token: quien lea la
 * base de datos no puede armar un enlace válido. Mongo borra los vencidos solo.
 */
const authTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["reset", "verify", "email-change", "email-revert"], required: true },
    /** Solo en el cambio de correo: el correo nuevo (email-change) o el que había antes (email-revert). */
    email: { type: String, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthTokenDoc = InferSchemaType<typeof authTokenSchema>;

export const AuthTokenModel =
  (models.AuthToken as Model<AuthTokenDoc>) ?? model<AuthTokenDoc>("AuthToken", authTokenSchema);
