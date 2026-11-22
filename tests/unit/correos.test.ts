import { afterEach, describe, expect, it } from "vitest";
import {
  contactNotificationEmail,
  orderConfirmationEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "~/lib/emailTemplates.server";

describe("correos transaccionales", () => {
  const original = process.env.APP_URL;
  afterEach(() => {
    process.env.APP_URL = original;
  });

  it("lo que escribe un visitante se escapa: no puede meter HTML en el correo del equipo", () => {
    const { html, text } = contactNotificationEmail({
      name: '<img src=x onerror="alert(1)">',
      email: "x@y.com",
      message: "<script>alert(2)</script>\nsegunda línea",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<br>"); // los saltos de línea sí se respetan
    expect(text).toContain("segunda línea"); // la versión en texto plano existe
  });

  it("lleva el logo con dirección absoluta del propio sitio y texto alternativo", () => {
    process.env.APP_URL = "https://stopee.com.mx/";
    const { html } = verifyEmailEmail({ name: "Ana", url: "https://stopee.com.mx/cuenta/verificar?token=abc" });
    expect(html).toContain('src="https://stopee.com.mx/elementos-design/logo-STOPee-correo.png"');
    expect(html).toContain('alt="STOPee"');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("sin APP_URL no inventa una dirección de imagen: queda el nombre en texto", () => {
    process.env.APP_URL = "";
    const { html } = verifyEmailEmail({ url: "/x" });
    expect(html).not.toContain("<img");
    expect(html).toContain("STOPee");
  });

  it("el enlace de restablecer contraseña va completo y avisa cuánto dura", () => {
    const { html, text } = resetPasswordEmail({ url: "https://stopee.com.mx/cuenta/restablecer?token=abc" });
    expect(html).toContain("https://stopee.com.mx/cuenta/restablecer?token=abc");
    expect(text).toContain("1 hora");
  });

  describe("confirmación de pedido", () => {
    it("compra única: productos, total, envío y botón de contacto para quien no tiene cuenta", () => {
      process.env.APP_URL = "https://stopee.com.mx";
      const mail = orderConfirmationEmail({
        items: [
          { name: "Concentrado STOPee", quantity: 2 },
          { name: "Regalo: Atomizador", quantity: 1 },
        ],
        total: 849,
        shippingLabel: "Estándar",
        shippingFree: true,
        destination: "Querétaro, Querétaro",
        hasAccount: false,
      });
      expect(mail.subject).toBe("Recibimos tu pedido de STOPee");
      expect(mail.text).toContain("2 × Concentrado STOPee");
      expect(mail.text).toContain("1 × Regalo: Atomizador");
      expect(mail.text).toContain("Total pagado: $849 MXN");
      expect(mail.text).toContain("Envío Estándar (sin costo) a Querétaro, Querétaro");
      expect(mail.text).toContain("https://stopee.com.mx/contacto");
      expect(mail.text).not.toContain("/cuenta");
    });

    it("auto-envío: dice cada cuánto sale la caja y lleva a la cuenta", () => {
      process.env.APP_URL = "https://stopee.com.mx";
      const mail = orderConfirmationEmail({
        items: [{ name: "Concentrado STOPee", quantity: 1 }],
        total: 399,
        frequency: "cada 4 semanas",
        hasAccount: true,
      });
      expect(mail.subject).toBe("Tu auto-envío de STOPee está activo");
      expect(mail.text).toContain("cada 4 semanas");
      expect(mail.text).toContain("https://stopee.com.mx/cuenta");
    });

    it("el nombre de un producto con HTML no se interpreta", () => {
      const mail = orderConfirmationEmail({
        items: [{ name: "<b>Hack</b>", quantity: 1 }],
        total: 10,
        hasAccount: false,
      });
      expect(mail.html).not.toContain("<b>Hack</b>");
      expect(mail.html).toContain("&lt;b&gt;Hack&lt;/b&gt;");
    });

    it("sin datos de envío no deja una línea vacía", () => {
      const mail = orderConfirmationEmail({ items: [{ name: "X", quantity: 1 }], total: 10, hasAccount: false });
      expect(mail.text).not.toMatch(/Envío/);
    });
  });
});
