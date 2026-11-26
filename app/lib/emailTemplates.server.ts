/**
 * Plantillas de los correos transaccionales. HTML simple con estilos en línea
 * (los clientes de correo ignoran las hojas de estilo) y siempre con versión
 * en texto plano. El contenido que escribe un visitante se escapa.
 */
const COLORS = { bosque: "#3E531D", lima: "#B5D334", carbon: "#181C14", hueso: "#FDFBF7" };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Layout = {
  title: string;
  /** Párrafos de texto plano; se escapan. */
  paragraphs: string[];
  /** Botón opcional bajo el texto. */
  action?: { label: string; url: string };
};

/**
 * Logo del encabezado. Va como PNG (Gmail y Outlook no muestran SVG ni WebP) alojado
 * en el propio sitio con dirección absoluta; no se incrusta en base64 porque Gmail lo
 * bloquea. Si el cliente no carga imágenes, se ve el texto alternativo con la marca.
 * Sin APP_URL no hay dirección absoluta posible, y se queda el texto de siempre.
 */
function logoBlock() {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const wordmark = `<p style="margin:0 0 24px;font-size:22px;font-weight:800;letter-spacing:1px;color:${COLORS.bosque};">STOPee</p>`;
  if (!base) return wordmark;
  const src = `${base}/elementos-design/logo-STOPee-correo.png`;
  return `<p style="margin:0 0 24px;"><a href="${escapeHtml(base)}" style="text-decoration:none;"><img src="${escapeHtml(src)}" alt="STOPee" width="160" height="110" style="display:block;border:0;outline:none;width:160px;height:auto;font-size:22px;font-weight:800;letter-spacing:1px;color:${COLORS.bosque};"></a></p>`;
}

function renderLayout({ title, paragraphs, action }: Layout) {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${COLORS.carbon};">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${COLORS.lima};color:${COLORS.carbon};font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:999px;">${escapeHtml(action.label)}</a></p>`
    : "";

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${COLORS.hueso};">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Helvetica,Arial,sans-serif;">
${logoBlock()}
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${COLORS.carbon};">${escapeHtml(title)}</h1>
${body}${button}
<p style="margin:32px 0 0;font-size:12px;color:#6b6f66;">STOPee.com.mx</p>
</div></body></html>`;

  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "STOPee.com.mx"].join("\n");
  return { html, text };
}

export function appUrl(path = "") {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** Aviso interno: llegó un mensaje por el formulario de contacto. */
export function contactNotificationEmail(data: { name: string; email: string; message: string }) {
  const { html, text } = renderLayout({
    title: "Nuevo mensaje desde el formulario de contacto",
    paragraphs: [`De: ${data.name} (${data.email})`, data.message, "Responde a este correo para contestarle directamente."],
    action: { label: "Ver en el backoffice", url: appUrl("/admin/messages") },
  });
  return { subject: `Contacto STOPee: mensaje de ${data.name}`, html, text };
}

/** Aviso interno: llegó una solicitud para ser Punto de Recarga. */
export function allyRequestNotificationEmail(data: {
  name: string;
  businessOrType: string;
  neighborhood: string;
  address: string;
  whatsapp: string;
  email: string;
}) {
  const { html, text } = renderLayout({
    title: "Nueva solicitud de Punto de Recarga",
    paragraphs: [
      `${data.name} (${data.businessOrType})`,
      `Colonia: ${data.neighborhood}\nDirección: ${data.address}`,
      `WhatsApp: ${data.whatsapp}\nCorreo: ${data.email}`,
      "Revísala en el backoffice y respóndele por WhatsApp o por correo.",
    ],
    action: { label: "Ver solicitudes", url: appUrl("/admin/aliados") },
  });
  return { subject: `Punto de Recarga: solicitud de ${data.name}`, html, text };
}

/** Confirmación a quien se registró en la lista de espera. */
export function waitlistWelcomeEmail() {
  const { html, text } = renderLayout({
    title: "Ya estás en la lista de STOPee",
    paragraphs: [
      "Gracias por registrarte. Te avisaremos por este medio en cuanto abramos la tienda.",
      "Tu descuento de bienvenida queda reservado con este correo.",
      "Mientras tanto, conoce cómo funciona el concentrado.",
    ],
    action: { label: "Cómo funciona", url: appUrl("/como-funciona") },
  });
  return { subject: "Ya estás en la lista de STOPee", html, text };
}

/** Confirmación de compra: sale en cuanto el pago queda registrado, sin depender de que el cliente vuelva al sitio. */
export function orderConfirmationEmail(data: {
  items: { name: string; quantity: number }[];
  total: number;
  /** Solo suscripciones, ya en minúsculas: "cada 4 semanas". */
  frequency?: string;
  shippingLabel?: string;
  shippingFree?: boolean;
  /** "Ciudad, Estado" de la dirección de envío. */
  destination?: string;
  hasAccount: boolean;
}) {
  const shippingLine =
    data.shippingLabel || data.destination
      ? `Envío${data.shippingLabel ? ` ${data.shippingLabel}` : ""}${data.shippingFree ? " (sin costo)" : ""}${data.destination ? ` a ${data.destination}` : ""}`
      : "";
  const paragraphs = [
    data.frequency ? "Tu auto-envío quedó activo. Gracias por confiar en STOPee." : "Recibimos tu pago. Gracias por tu compra.",
    data.items.map((i) => `${i.quantity} × ${i.name}`).join("\n"),
    `Total pagado: $${data.total} MXN`,
    ...(data.frequency ? [`Te enviaremos tu caja ${data.frequency}. Puedes pausarla o cancelarla cuando quieras.`] : []),
    ...(shippingLine ? [shippingLine] : []),
    "Preparamos tu pedido y te avisamos por correo en cuanto salga, con tu número de guía.",
  ];
  const { html, text } = renderLayout({
    title: data.frequency ? "Tu auto-envío está activo" : "Recibimos tu pedido",
    paragraphs,
    action: data.hasAccount
      ? { label: "Ver mis pedidos", url: appUrl("/cuenta") }
      : { label: "¿Dudas? Escríbenos", url: appUrl("/contacto") },
  });
  return {
    subject: data.frequency ? "Tu auto-envío de STOPee está activo" : "Recibimos tu pedido de STOPee",
    html,
    text,
  };
}

/** Aviso al cliente: su pedido salió del almacén. */
export function orderShippedEmail(data: { trackingNumber?: string; items: { name: string; quantity: number }[] }) {
  const items = data.items.map((i) => `${i.quantity} × ${i.name}`).join(", ");
  const paragraphs = [
    "Tu pedido ya salió de nuestro almacén y va en camino.",
    ...(items ? [`Contenido: ${items}`] : []),
    ...(data.trackingNumber ? [`Número de guía: ${data.trackingNumber}`] : []),
    "Puedes ver el estado de tu pedido en tu cuenta.",
  ];
  const { html, text } = renderLayout({
    title: "Tu pedido va en camino",
    paragraphs,
    action: { label: "Ver mi pedido", url: appUrl("/cuenta") },
  });
  return { subject: "Tu pedido de STOPee va en camino", html, text };
}

/** Enlace para confirmar que el correo de la cuenta es de quien se registró. */
export function verifyEmailEmail(data: { name?: string | null; url: string }) {
  const { html, text } = renderLayout({
    title: "Confirma tu correo",
    paragraphs: [
      `${data.name ? `Hola, ${data.name}. ` : ""}Confirma que este correo es tuyo para usar cupones personales y recibir avisos de tus pedidos.`,
      "El enlace funciona durante 24 horas. Si tú no creaste una cuenta en STOPee, ignora este mensaje.",
    ],
    action: { label: "Confirmar mi correo", url: data.url },
  });
  return { subject: "Confirma tu correo en STOPee", html, text };
}

/**
 * Para quien intentó crear una cuenta con un correo que ya tiene una. La pantalla del registro responde
 * igual exista o no la cuenta (así nadie puede averiguar qué correos están registrados); la diferencia
 * llega solo a la bandeja de ese correo.
 */
export function accountAlreadyExistsEmail() {
  const { html, text } = renderLayout({
    title: "Ya tienes una cuenta en STOPee",
    paragraphs: [
      "Alguien intentó crear una cuenta en STOPee con este correo, pero ya tienes una.",
      "Si fuiste tú, entra con tu contraseña. Si no la recuerdas, puedes crear una nueva. Si no fuiste tú, ignora este mensaje: tu cuenta sigue igual.",
    ],
    action: { label: "Entrar a mi cuenta", url: appUrl("/cuenta/entrar") },
  });
  return { subject: "Ya tienes una cuenta en STOPee", html, text };
}

/** Enlace para crear una contraseña nueva. */
export function resetPasswordEmail(data: { url: string }) {
  const { html, text } = renderLayout({
    title: "Crea una contraseña nueva",
    paragraphs: [
      "Recibimos una solicitud para restablecer la contraseña de tu cuenta de STOPee.",
      "El enlace funciona durante 1 hora y solo se puede usar una vez. Si tú no lo pediste, ignora este mensaje: tu contraseña actual sigue igual.",
    ],
    action: { label: "Elegir contraseña nueva", url: data.url },
  });
  return { subject: "Restablece tu contraseña de STOPee", html, text };
}

/** Aviso de seguridad: la contraseña acaba de cambiar. */
export function passwordChangedEmail() {
  const { html, text } = renderLayout({
    title: "Tu contraseña cambió",
    paragraphs: [
      "La contraseña de tu cuenta de STOPee se acaba de cambiar y se cerraron las sesiones abiertas.",
      "Si fuiste tú, no tienes que hacer nada. Si no reconoces este cambio, restablece tu contraseña de inmediato y escríbenos.",
    ],
    action: { label: "Restablecer contraseña", url: appUrl("/cuenta/olvide") },
  });
  return { subject: "Tu contraseña de STOPee cambió", html, text };
}

/** Invitación: un administrador le creó una cuenta y debe elegir su contraseña. */
export function accountInvitationEmail(data: { name?: string | null; url: string }) {
  const { html, text } = renderLayout({
    title: "Te creamos una cuenta en STOPee",
    paragraphs: [
      `${data.name ? `Hola, ${data.name}. ` : ""}Se creó una cuenta para ti en STOPee. Para empezar, elige tu contraseña.`,
      "El enlace funciona durante 3 días y solo se puede usar una vez. Si no esperabas este mensaje, ignóralo.",
    ],
    action: { label: "Elegir mi contraseña", url: data.url },
  });
  return { subject: "Tu cuenta de STOPee está lista", html, text };
}
