import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";

const { Schema, model, models } = mongoose;

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ContactMessageDoc = InferSchemaType<typeof contactMessageSchema>;

export const ContactMessageModel =
  (models.ContactMessage as Model<ContactMessageDoc>) ??
  model<ContactMessageDoc>("ContactMessage", contactMessageSchema);

export async function createContactMessage(data: { name: string; email: string; message: string }) {
  await connectDB();
  return ContactMessageModel.create(data);
}
