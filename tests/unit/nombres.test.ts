import { describe, expect, it } from "vitest";
import { fullNameOf, greetingFor, joinNames, splitFullName } from "~/lib/names";

describe("nombres de personas y perritos", () => {
  it("junta nombre(s) y apellidos en el nombre completo, sin espacios de más", () => {
    expect(fullNameOf("Christian", "Valderrama Gómez")).toBe("Christian Valderrama Gómez");
    expect(fullNameOf("  María  José ", " Pérez ")).toBe("María José Pérez");
    expect(fullNameOf("Christian", "")).toBe("Christian");
    expect(fullNameOf(null, undefined)).toBe("");
  });

  it("para cuentas con un solo nombre sugiere nombre y apellidos (la persona lo corrige)", () => {
    expect(splitFullName("Christian Valderrama Gómez")).toEqual({ firstName: "Christian", lastName: "Valderrama Gómez" });
    expect(splitFullName("Christian")).toEqual({ firstName: "Christian", lastName: "" });
    expect(splitFullName(undefined)).toEqual({ firstName: "", lastName: "" });
  });

  it("enlista con comas y «y» al final", () => {
    expect(joinNames(["Rocket"])).toBe("Rocket");
    expect(joinNames(["Rocket", "Sama"])).toBe("Rocket y Sama");
    expect(joinNames(["Christian", "Rocket", "Sama"])).toBe("Christian, Rocket y Sama");
    expect(joinNames(["", "  ", "Luna"])).toBe("Luna");
  });

  it("antes de un nombre que empieza con «i» o «hi» la «y» se vuelve «e»", () => {
    expect(joinNames(["Sama", "Isis"])).toBe("Sama e Isis");
    expect(joinNames(["Christian", "Rocket", "Ícaro"])).toBe("Christian, Rocket e Ícaro");
    expect(joinNames(["Luna", "Hilda"])).toBe("Luna e Hilda");
    expect(joinNames(["Luna", "Hiena"])).toBe("Luna y Hiena");
  });

  it("el saludo es la persona y todos sus perritos", () => {
    expect(greetingFor("Christian", ["Rocket", "Sama"])).toBe("Hola, Christian, Rocket y Sama");
    expect(greetingFor("Christian", ["Rocket"])).toBe("Hola, Christian y Rocket");
    expect(greetingFor("Christian", [])).toBe("Hola, Christian");
    expect(greetingFor("", ["Luna"])).toBe("Hola, Luna");
    expect(greetingFor("", [])).toBe("Hola");
  });
});
