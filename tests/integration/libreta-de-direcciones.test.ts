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
});
