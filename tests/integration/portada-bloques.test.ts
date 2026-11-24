import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDb, dropDb, hasTestDb, wipeDb } from "../helpers/db";
import { defaultHomeBlocks } from "~/lib/homeBlocks";

/**
 * La portada se guarda en un documento único. Estas pruebas fijan que, sin nada guardado, se ve la
 * portada de fábrica; que lo guardado se respeta en orden y textos; que un bloque nuevo agregado
 * después en el código aparece solo; y que restablecer borra todo.
 */
describe.skipIf(!hasTestDb)("portada: bloques guardados", () => {
  let getHomeBlocks: typeof import("~/models/homeLayout.server").getHomeBlocks;
  let getHomeBlocksWithMeta: typeof import("~/models/homeLayout.server").getHomeBlocksWithMeta;
  let saveHomeBlocks: typeof import("~/models/homeLayout.server").saveHomeBlocks;
  let resetHomeBlocks: typeof import("~/models/homeLayout.server").resetHomeBlocks;
  let HomeLayoutModel: typeof import("~/models/homeLayout.server").HomeLayoutModel;
  let connectDB: typeof import("~/lib/db.server").connectDB;

  beforeAll(async () => {
    assertDisposableDb();
    ({ getHomeBlocks, getHomeBlocksWithMeta, saveHomeBlocks, resetHomeBlocks, HomeLayoutModel } = await import(
      "~/models/homeLayout.server"
    ));
    ({ connectDB } = await import("~/lib/db.server"));
    await connectDB();
  });

  afterAll(async () => {
    await dropDb();
  });

  beforeEach(async () => {
    await wipeDb();
  });

  it("sin nada guardado, da la portada de fábrica y no hay fecha de guardado", async () => {
    expect(await getHomeBlocks()).toEqual(defaultHomeBlocks());
    expect((await getHomeBlocksWithMeta()).updatedAt).toBeNull();
  });

  it("guarda el orden, el encendido y los textos, y los devuelve igual", async () => {
    const blocks = defaultHomeBlocks().reverse();
    blocks.find((b) => b.type === "identity")!.content.title = "Un título propio";
    blocks.find((b) => b.type === "blog")!.enabled = false;
    await saveHomeBlocks(blocks);

    const saved = await getHomeBlocks();
    expect(saved.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    expect(saved.find((b) => b.type === "identity")!.content.title).toBe("Un título propio");
    expect(saved.find((b) => b.type === "blog")!.enabled).toBe(false);
    expect((await getHomeBlocksWithMeta()).updatedAt).not.toBeNull();
  });

  it("guardar de nuevo reemplaza lo anterior en el mismo documento", async () => {
    await saveHomeBlocks(defaultHomeBlocks());
    const blocks = defaultHomeBlocks();
    blocks.find((b) => b.type === "start")!.content.title = "Segundo guardado";
    await saveHomeBlocks(blocks);

    expect(await HomeLayoutModel.countDocuments()).toBe(1);
    expect((await getHomeBlocks()).find((b) => b.type === "start")!.content.title).toBe("Segundo guardado");
  });

  it("un bloque que no estaba guardado (versión anterior) aparece al final con su configuración de fábrica", async () => {
    // Lo guardado antes de existir «Llamado final» y «Cómo se usa».
    await HomeLayoutModel.collection.insertOne({
      blocks: [
        { type: "start", enabled: true, content: { title: "Mi título" } },
        { type: "banner", enabled: true, content: {} },
      ],
    });

    const blocks = await getHomeBlocks();
    expect(blocks.slice(0, 2).map((b) => b.type)).toEqual(["start", "banner"]);
    expect(blocks.find((b) => b.type === "start")!.content.title).toBe("Mi título");
    expect(blocks.find((b) => b.type === "cta")).toMatchObject({ enabled: false });
    expect(blocks).toHaveLength(defaultHomeBlocks().length);
  });

  it("restablecer borra lo guardado y vuelve a la portada de fábrica", async () => {
    const blocks = defaultHomeBlocks().reverse();
    await saveHomeBlocks(blocks);
    await resetHomeBlocks();

    expect(await getHomeBlocks()).toEqual(defaultHomeBlocks());
    expect((await getHomeBlocksWithMeta()).updatedAt).toBeNull();
  });
});
