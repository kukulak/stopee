import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { connectDB } from "~/lib/db.server";
import { DiscountModel } from "~/models/discount.server";

export const meta: MetaFunction = () => [{ title: "Descuentos — Admin STOPee" }];

export async function loader() {
  await connectDB();
  const discounts = await DiscountModel.find().sort({ createdAt: -1 }).lean();
  return json({
    discounts: discounts.map((d) => ({
      id: String(d._id),
      code: d.code,
      percentage: d.percentage,
      validUntil: d.validUntil,
      timesUsed: d.timesUsed,
      isActive: d.isActive,
    })),
  });
}

const createDiscountSchema = z.object({
  code: z.string().trim().min(3, "El código debe tener al menos 3 caracteres.").toUpperCase(),
  percentage: z.coerce.number().min(1, "Mínimo 1%.").max(100, "Máximo 100%."),
  validUntil: z.string().min(1, "Elige una fecha de vigencia."),
});

export async function action({ request }: ActionFunctionArgs) {
  await connectDB();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const parsed = createDiscountSchema.safeParse({
      code: formData.get("code"),
      percentage: formData.get("percentage"),
      validUntil: formData.get("validUntil"),
    });

    if (!parsed.success) {
      return json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      );
    }

    const exists = await DiscountModel.findOne({ code: parsed.data.code });
    if (exists) {
      return json(
        { ok: false as const, error: "Ya existe un cupón con ese código." },
        { status: 409 },
      );
    }

    await DiscountModel.create({
      code: parsed.data.code,
      percentage: parsed.data.percentage,
      validUntil: new Date(parsed.data.validUntil),
    });
    return json({ ok: true as const, error: null });
  }

  const id = String(formData.get("id") ?? "");

  if (intent === "toggle-active") {
    const discount = await DiscountModel.findById(id);
    if (discount) {
      discount.isActive = !discount.isActive;
      await discount.save();
    }
    return json({ ok: true as const, error: null });
  }

  if (intent === "delete") {
    await DiscountModel.findByIdAndDelete(id);
    return json({ ok: true as const, error: null });
  }

  return json({ ok: false as const, error: "Acción no reconocida." }, { status: 400 });
}

export default function AdminDiscounts() {
  const { discounts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "create";

  return (
    <div>
      <h1 className="font-display text-2xl font-black text-carbon">Descuentos</h1>
      <p className="mt-1 text-sm text-carbon/60">Cupones porcentuales para compras únicas.</p>

      <Form
        method="post"
        className="mt-6 flex flex-col gap-4 rounded-3xl border border-carbon/10 bg-white p-6 sm:flex-row sm:items-end sm:gap-3"
      >
        <input type="hidden" name="intent" value="create" />
        <div className="flex-1">
          <label htmlFor="code" className="text-sm font-semibold text-carbon">
            Código
          </label>
          <input
            id="code"
            name="code"
            type="text"
            required
            placeholder="BIENVENIDA10"
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 uppercase focus:border-oliva focus:outline-none"
          />
        </div>
        <div className="sm:w-32">
          <label htmlFor="percentage" className="text-sm font-semibold text-carbon">
            % Descuento
          </label>
          <input
            id="percentage"
            name="percentage"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={10}
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>
        <div className="sm:w-48">
          <label htmlFor="validUntil" className="text-sm font-semibold text-carbon">
            Vigente hasta
          </label>
          <input
            id="validUntil"
            name="validUntil"
            type="date"
            required
            className="mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-4 focus:border-oliva focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isCreating}
          className="min-h-11 rounded-full bg-lima px-6 text-sm font-bold text-carbon disabled:opacity-60"
        >
          {isCreating ? "Creando…" : "Crear cupón"}
        </button>
      </Form>

      {actionData?.error && (
        <p className="mt-3 text-sm font-semibold text-red-600">{actionData.error}</p>
      )}

      {discounts.length === 0 ? (
        <p className="mt-8 text-sm text-carbon/60">Aún no has creado ningún cupón.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-3xl border border-carbon/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-carbon/10 text-xs font-semibold uppercase tracking-wide text-carbon/50">
              <tr>
                <th className="px-5 py-3">Código</th>
                <th className="px-5 py-3">%</th>
                <th className="px-5 py-3">Vigente hasta</th>
                <th className="px-5 py-3">Usos</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-carbon/5 last:border-0">
                  <td className="px-5 py-3 font-semibold text-carbon">{d.code}</td>
                  <td className="px-5 py-3 text-carbon/70">{d.percentage}%</td>
                  <td className="px-5 py-3 text-carbon/60">
                    {new Date(d.validUntil).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="px-5 py-3 text-carbon/60">{d.timesUsed}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        d.isActive ? "bg-lima/20 text-bosque" : "bg-carbon/10 text-carbon/50"
                      }`}
                    >
                      {d.isActive ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle-active" />
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-carbon hover:border-carbon/30"
                        >
                          {d.isActive ? "Desactivar" : "Activar"}
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-full border border-carbon/15 px-4 text-xs font-semibold text-red-600 hover:border-red-300"
                        >
                          Eliminar
                        </button>
                      </Form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
