import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";

const HOME = { name: "Christian Valderrama", phone: "5511111111", line1: "Av. Insurgentes Sur 123", line2: "", city: "Benito Juárez", state: "Ciudad de México", postalCode: "03100" };
const MAMA = { name: "Rosa Pérez", phone: "5522222222", line1: "Calle Horacio 45", line2: "Polanco", city: "Miguel Hidalgo", state: "Ciudad de México", postalCode: "11560" };
const TIA = { name: "Lupe Pérez", phone: "5533333333", line1: "Calle Sur 7", line2: "", city: "Coyoacán", state: "Ciudad de México", postalCode: "04000" };

/**
 * La libreta de direcciones contra un Mongo desechable: cada dirección escrita al pagar se guarda
 * sola (la primera como principal, el resto como secundarias), sin duplicarse y sin pisar la principal.
 */
describe.skipIf(!hasTestDb)("libreta de direcciones", () => {
  let book: typeof import("~/lib/addressBook.server");
  let UserModel: typeof import("~/models/user.server").UserModel;
  let userId: string;

  beforeAll(async () => {
    assertDisposableDb();
    book = await import("~/lib/addressBook.server");
    ({ UserModel } = await import("~/models/user.server"));
    await (await import("~/lib/db.server")).connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
    const user = await UserModel.create({ email: "cliente@example.com", passwordHash: "x", emailVerifiedAt: new Date() });
    userId = String(user._id);
  });

  const load = async () => (await UserModel.findById(userId).lean())!;

  it("la primera dirección queda como principal, con su nombre, teléfono y a quién se entrega", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    const user = await load();
    expect(user.address).toMatchObject({ line1: HOME.line1, postalCode: "03100", label: "Principal", recipientName: HOME.name });
    expect(user.phone).toBe("5511111111");
    expect(user.name).toBe(HOME.name);
    expect(user.savedAddresses).toHaveLength(0);
  });

  it("una dirección nueva se guarda como secundaria sin tocar la principal (un regalo no la pisa)", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, MAMA);
    const user = await load();
    expect(user.address).toMatchObject({ line1: HOME.line1 });
    expect(user.savedAddresses).toHaveLength(1);
    expect(user.savedAddresses[0]).toMatchObject({ line1: MAMA.line1, name: "Rosa Pérez", phone: "5522222222", label: "Entrega a Rosa" });
    expect(user.phone).toBe("5511111111");
  });

  it("la misma dirección no se duplica, aunque se escriba distinto", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, { ...HOME, line1: "av. insurgentes sur #123" });
    await book.rememberDeliveryAddress(userId, MAMA);
    await book.rememberDeliveryAddress(userId, { ...MAMA, line1: "CALLE HORACIO 45" });
    await book.rememberDeliveryAddress(userId, MAMA);
    expect((await load()).savedAddresses).toHaveLength(1);
  });

  it("dos pagos simultáneos a la misma dirección nueva guardan una sola", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await Promise.all([book.rememberDeliveryAddress(userId, MAMA), book.rememberDeliveryAddress(userId, MAMA)]);
    expect((await load()).savedAddresses).toHaveLength(1);
  });

  it("cuando vuelve a enviar a una guardada, se actualiza a quién y a qué teléfono", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, MAMA);
    await book.rememberDeliveryAddress(userId, { ...MAMA, name: "Rosa P.", phone: "5599999999" });
    const [saved] = (await load()).savedAddresses;
    expect(saved).toMatchObject({ name: "Rosa P.", phone: "5599999999" });
  });

  it("sin calle o sin código postal no guarda nada", async () => {
    await book.rememberDeliveryAddress(userId, { ...HOME, line1: "" });
    await book.rememberDeliveryAddress(userId, { ...HOME, postalCode: "" });
    expect((await load()).address?.line1 ?? "").toBe("");
  });

  it("no pasa de 10 direcciones guardadas", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    for (let i = 1; i <= 12; i++) await book.rememberDeliveryAddress(userId, { ...MAMA, line1: `Calle ${i}`, postalCode: "11560" });
    expect((await load()).savedAddresses).toHaveLength(10);
  });

  it("cambiar de principal no pierde la de antes: queda guardada con su nombre y su teléfono", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.renameAddress(userId, "principal", "Mi casa");
    await book.rememberDeliveryAddress(userId, MAMA);
    const mamaId = String((await load()).savedAddresses[0]._id);

    expect(await book.makePrincipalAddress(userId, mamaId)).toEqual({ ok: true });
    const user = await load();
    expect(user.address).toMatchObject({ line1: MAMA.line1, recipientName: "Rosa Pérez", label: "Entrega a Rosa" });
    expect(user.phone).toBe("5522222222");
    expect(user.savedAddresses).toHaveLength(1);
    expect(user.savedAddresses[0]).toMatchObject({ line1: HOME.line1, label: "Mi casa", name: HOME.name, phone: "5511111111" });
  });

  it("se puede nombrar la principal y las guardadas; un nombre muy corto se rechaza", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, TIA);
    const tiaId = String((await load()).savedAddresses[0]._id);

    expect(await book.renameAddress(userId, tiaId, "  Casa de la tía  ")).toEqual({ ok: true });
    expect((await load()).savedAddresses[0].label).toBe("Casa de la tía");
    expect(await book.renameAddress(userId, "principal", "Casa")).toEqual({ ok: true });
    expect((await load()).address?.label).toBe("Casa");
    expect((await book.renameAddress(userId, tiaId, "x")).ok).toBe(false);
  });

  it("quitar una guardada la borra; la principal no se quita por aquí", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, MAMA);
    const mamaId = String((await load()).savedAddresses[0]._id);

    expect((await book.removeSavedAddress(userId, "principal")).ok).toBe(false);
    expect(await book.removeSavedAddress(userId, mamaId)).toEqual({ ok: true });
    const user = await load();
    expect(user.savedAddresses).toHaveLength(0);
    expect(user.address).toMatchObject({ line1: HOME.line1 });
  });

  it("nadie puede tocar las direcciones de otra cuenta", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, MAMA);
    const mamaId = String((await load()).savedAddresses[0]._id);
    const other = await UserModel.create({ email: "otro@example.com", passwordHash: "x", emailVerifiedAt: new Date() });
    const otherId = String(other._id);

    expect((await book.renameAddress(otherId, mamaId, "Hackeada")).ok).toBe(false);
    expect((await book.removeSavedAddress(otherId, mamaId)).ok).toBe(false);
    expect((await book.makePrincipalAddress(otherId, mamaId)).ok).toBe(false);
    const user = await load();
    expect(user.savedAddresses[0].label).toBe("Entrega a Rosa");
    expect(user.savedAddresses).toHaveLength(1);
  });

  it("ids inventados no rompen nada", async () => {
    expect((await book.removeSavedAddress(userId, "no-es-un-id")).ok).toBe(false);
    expect((await book.makePrincipalAddress(userId, "no-es-un-id")).ok).toBe(false);
    expect((await book.renameAddress(userId, "no-es-un-id", "Casa")).ok).toBe(false);
  });
  const form = (over: Partial<import("~/lib/addressBook").AddressFormValue> = {}) => ({
    label: "Casa de mamá",
    name: MAMA.name,
    phone: MAMA.phone,
    line1: MAMA.line1,
    line2: MAMA.line2,
    city: MAMA.city,
    state: "",
    postalCode: MAMA.postalCode,
    ...over,
  });

  it("agregar desde Mi cuenta: sin dirección previa queda como principal, con su nombre y teléfono", async () => {
    expect(await book.addAddress(userId, form({ label: "Mi casa", name: HOME.name, phone: HOME.phone, line1: HOME.line1, postalCode: HOME.postalCode }))).toEqual({ ok: true });
    const user = await load();
    expect(user.address).toMatchObject({ label: "Mi casa", line1: HOME.line1, recipientName: HOME.name });
    expect(user.phone).toBe("5511111111");
    expect(user.savedAddresses).toHaveLength(0);
  });

  it("agregar otra queda como secundaria con el nombre que le puso, sin pisar la principal", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    expect(await book.addAddress(userId, form())).toEqual({ ok: true });
    const user = await load();
    expect(user.address).toMatchObject({ line1: HOME.line1 });
    expect(user.savedAddresses).toHaveLength(1);
    expect(user.savedAddresses[0]).toMatchObject({ label: "Casa de mamá", name: "Rosa Pérez", phone: "5522222222", line1: MAMA.line1 });
  });

  it("no guarda dos veces la misma dirección y dice cómo se llama la que ya existe", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.addAddress(userId, form());
    const again = await book.addAddress(userId, form({ label: "Otra vez", line1: "calle horacio #45" }));
    expect(again).toMatchObject({ ok: false });
    expect((again as { error: string }).error).toContain("Casa de mamá");
    const onPrincipal = await book.addAddress(userId, form({ line1: HOME.line1, postalCode: HOME.postalCode }));
    expect(onPrincipal.ok).toBe(false);
    expect((await load()).savedAddresses).toHaveLength(1);
  });

  it("tope de direcciones al agregar a mano", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    for (let i = 0; i < 10; i++) {
      expect((await book.addAddress(userId, form({ label: `Lugar ${i}`, line1: `Calle ${i + 1} número ${i + 1}` }))).ok).toBe(true);
    }
    const extra = await book.addAddress(userId, form({ label: "Una más", line1: "Calle Once 11" }));
    expect(extra.ok).toBe(false);
    expect((await load()).savedAddresses).toHaveLength(10);
  });

  it("editar una guardada cambia sus datos y su nombre; editar la principal actualiza el teléfono de la cuenta", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.addAddress(userId, form());
    const mamaId = String((await load()).savedAddresses[0]._id);

    expect(await book.updateAddress(userId, mamaId, form({ label: "Casa de la abuela", line1: "Calle Horacio 99", phone: "5599999999" }))).toEqual({ ok: true });
    let user = await load();
    expect(user.savedAddresses[0]).toMatchObject({ label: "Casa de la abuela", line1: "Calle Horacio 99", phone: "5599999999" });
    expect(user.savedAddresses).toHaveLength(1);

    expect(await book.updateAddress(userId, "principal", form({ label: "Casa", name: HOME.name, phone: "5588888888", line1: HOME.line1, postalCode: HOME.postalCode }))).toEqual({ ok: true });
    user = await load();
    expect(user.address).toMatchObject({ label: "Casa", line1: HOME.line1 });
    expect(user.phone).toBe("5588888888");
  });

  it("editar no puede dejarla igual a otra de las direcciones; guardarla sin cambios sí se puede", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.addAddress(userId, form());
    const mamaId = String((await load()).savedAddresses[0]._id);

    expect((await book.updateAddress(userId, mamaId, form({ line1: HOME.line1, postalCode: HOME.postalCode }))).ok).toBe(false);
    expect((await book.updateAddress(userId, "principal", form({ line1: MAMA.line1, postalCode: MAMA.postalCode }))).ok).toBe(false);
    expect((await book.updateAddress(userId, mamaId, form())).ok).toBe(true);
  });

  it("editar conserva el estado si no se escribió uno, y nadie edita direcciones de otra cuenta", async () => {
    await book.rememberDeliveryAddress(userId, HOME);
    await book.rememberDeliveryAddress(userId, MAMA);
    const mamaId = String((await load()).savedAddresses[0]._id);
    await book.updateAddress(userId, mamaId, form({ label: "Mamá" }));
    expect((await load()).savedAddresses[0].state).toBe("Ciudad de México");

    const other = await UserModel.create({ email: "otro@example.com", passwordHash: "x", emailVerifiedAt: new Date() });
    expect((await book.updateAddress(String(other._id), mamaId, form({ label: "Hackeada" }))).ok).toBe(false);
    expect((await load()).savedAddresses[0].label).toBe("Mamá");
    expect((await book.updateAddress(userId, "no-es-un-id", form())).ok).toBe(false);
    expect((await book.updateAddress(String(other._id), "principal", form())).ok).toBe(false);
  });
});
