import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { connectDB } from "~/lib/db.server";
import { ContactMessageModel } from "~/models/contactMessage.server";
import { requireAdmin } from "~/lib/session.server";

export const meta: MetaFunction = () => [{ title: "Mensajes de contacto — Admin STOPee" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const messages = await ContactMessageModel.find().sort({ createdAt: -1 }).lean();
  return json({
    messages: messages.map((m) => ({
      id: String(m._id),
      name: m.name,
      email: m.email,
      message: m.message,
      isRead: m.isRead,
      createdAt: m.createdAt as unknown as string,
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id") ?? "");

  if (intent === "mark-read") {
    await ContactMessageModel.findByIdAndUpdate(id, { isRead: true });
    return json({ ok: true });
  }

  if (intent === "delete") {
    await ContactMessageModel.findByIdAndDelete(id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}

export default function AdminMessages() {
  const { messages } = useLoaderData<typeof loader>();
  const unreadCount = messages.filter((m) => !m.isRead).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon sm:text-3xl">Mensajes de contacto</h1>
      <p className="mt-1 text-sm text-carbon/60">
        {messages.length} {messages.length === 1 ? "mensaje" : "mensajes"}
        {unreadCount > 0 && ` · ${unreadCount} sin leer`}
      </p>

      {messages.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-carbon/20 p-5 sm:p-8 text-center text-carbon/50">
          Todavía no hay mensajes del formulario de /contacto.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${m.isRead ? "border-carbon/10 bg-white" : "border-lima bg-lima/5"}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-display font-bold text-carbon">
                    {m.name} {!m.isRead && <span className="ml-2 rounded-full bg-lima px-2 py-0.5 text-xs font-bold text-carbon">Nuevo</span>}
                  </p>
                  <a href={`mailto:${m.email}`} className="break-all text-sm text-bosque hover:underline">
                    {m.email}
                  </a>
                  <p className="mt-1 text-xs text-carbon/50">
                    {new Date(m.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  {!m.isRead && (
                    <Form method="post" className="contents">
                      <input type="hidden" name="intent" value="mark-read" />
                      <input type="hidden" name="id" value={m.id} />
                      <button type="submit" className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold sm:w-auto text-carbon hover:border-carbon/30">
                        Marcar leído
                      </button>
                    </Form>
                  )}
                  <Form method="post" className="contents">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="min-h-11 w-full rounded-full border border-carbon/15 px-4 text-xs font-semibold sm:w-auto text-carbon/60 hover:border-red-300 hover:text-red-600">
                      Eliminar
                    </button>
                  </Form>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-carbon/80">{m.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
