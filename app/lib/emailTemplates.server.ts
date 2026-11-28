/**
 * Plantillas de los correos transaccionales. HTML simple con estilos en línea
 * (los clientes de correo ignoran las hojas de estilo) y siempre con versión
 * en texto plano. El contenido que escribe un visitante se escapa.
 */
import { formatMxnCents, invoiceLaterNote, ivaBreakdown } from "~/lib/fiscal";

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
  businessName?: string;
  businessOrType: string;
  neighborhood: string;
  address: string;
  whatsapp: string;
  email: string;
}) {
  const { html, text } = renderLayout({
    title: "Nueva solicitud de Punto de Recarga",
    paragraphs: [
      `${data.name} (${data.businessOrType}${data.businessName ? `: ${data.businessName}` : ""})`,
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
  /** Para pedir factura después y para que el cliente lo mencione al escribirnos. */
  orderNumber?: string;
  /** El cliente ya pidió factura al pagar: se le dice que la emitiremos con el RFC que capturó. */
  invoiceRfc?: string;
  /** A dónde pedir la factura después (de «Datos del negocio»). */
  invoiceEmail?: string | null;
  /** Auto-envío: la factura quedó prendida para cada caja (se emite con los datos de la cuenta). */
  invoiceRecurring?: boolean;
  /** Cobro de una renovación del auto-envío: el aviso es «tu caja se está preparando», no «tu auto-envío está activo». */
  renewal?: { programName: string };
}) {
  const shippingLine =
    data.shippingLabel || data.destination
      ? `Envío${data.shippingLabel ? ` ${data.shippingLabel}` : ""}${data.shippingFree ? " (sin costo)" : ""}${data.destination ? ` a ${data.destination}` : ""}`
      : "";
  // El precio es el mismo con o sin factura: aquí solo se dice qué sigue.
  const invoiceParagraph = data.invoiceRfc
    ? data.renewal || data.invoiceRecurring
      ? `Emitiremos la factura de esta caja con el RFC ${data.invoiceRfc} y te la enviaremos por correo. Lo mismo pasará con cada caja; puedes apagarlo cuando quieras en tu cuenta. El precio no cambia.`
      : `Registramos tu solicitud de factura con el RFC ${data.invoiceRfc}. La emitiremos con los datos que capturaste y te la enviaremos por correo. El precio no cambia.`
    : data.renewal
      ? `${invoiceLaterNote(data.invoiceEmail)} Para no tener que pedirla cada vez, prende «Factura en cada caja» en tu cuenta y la emitimos sola.`
      : invoiceLaterNote(data.invoiceEmail);
  const itemsLine = data.items.map((i) => `${i.quantity} × ${i.name}`).join("\n");
  const totalLine = `Total pagado: $${data.total} MXN (IVA incluido: ${formatMxnCents(ivaBreakdown(data.total).iva)})`;
  const paragraphs = data.renewal
    ? [
        `Cobramos tu caja de ${data.renewal.programName}${data.frequency ? ` (llega ${data.frequency})` : ""} y ya la estamos preparando.`,
        itemsLine,
        totalLine,
        ...(data.orderNumber ? [`Número de pedido: ${data.orderNumber}`] : []),
        ...(shippingLine ? [shippingLine] : []),
        "Te avisamos por correo en cuanto salga, con tu número de guía. Puedes pausar o cancelar tu suscripción cuando quieras desde tu cuenta.",
        invoiceParagraph,
      ]
    : [
        data.frequency ? "Tu suscripción quedó activa. Gracias por confiar en STOPee." : "Recibimos tu pago. Gracias por tu compra.",
        itemsLine,
        totalLine,
        ...(data.orderNumber ? [`Número de pedido: ${data.orderNumber}`] : []),
        ...(data.frequency ? [`Te enviaremos tu caja ${data.frequency}. Puedes pausarla o cancelarla cuando quieras.`] : []),
        ...(shippingLine ? [shippingLine] : []),
        "Preparamos tu pedido y te avisamos por correo en cuanto salga, con tu número de guía.",
        invoiceParagraph,
      ];
  const { html, text } = renderLayout({
    title: data.renewal ? "Tu caja se está preparando" : data.frequency ? "Tu suscripción está activa" : "Recibimos tu pedido",
    paragraphs,
    action: data.hasAccount
      ? { label: "Ver mis pedidos", url: appUrl("/cuenta") }
      : { label: "¿Dudas? Escríbenos", url: appUrl("/contacto") },
  });
  return {
    subject: data.renewal
      ? `Tu caja de ${data.renewal.programName} se está preparando`
      : data.frequency
        ? "Tu suscripción de STOPee está activa"
        : "Recibimos tu pedido de STOPee",
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

/** Al correo NUEVO: confirma que es suyo para terminar el cambio. */
export function confirmEmailChangeEmail(data: { name?: string | null; url: string }) {
  const { html, text } = renderLayout({
    title: "Confirma tu correo nuevo",
    paragraphs: [
      `${data.name ? `Hola, ${data.name}. ` : ""}Pediste usar este correo en tu cuenta de STOPee. Confírmalo para terminar el cambio.`,
      "El enlace funciona durante 1 hora. Si tú no lo pediste, ignora este mensaje: no cambia nada.",
    ],
    action: { label: "Confirmar el cambio", url: data.url },
  });
  return { subject: "Confirma tu correo nuevo en STOPee", html, text };
}

/** Al correo nuevo cuando ya pertenece a OTRA cuenta: la pantalla responde igual exista o no, la diferencia llega aquí. */
export function emailChangeBlockedEmail() {
  const { html, text } = renderLayout({
    title: "Este correo ya tiene una cuenta",
    paragraphs: [
      "Alguien intentó cambiar el correo de una cuenta de STOPee a este, pero este correo ya pertenece a otra cuenta.",
      "Si fuiste tú, entra con este correo; si no la recuerdas, puedes crear una contraseña nueva. Si no fuiste tú, ignora este mensaje: no cambió nada.",
    ],
    action: { label: "Entrar a mi cuenta", url: appUrl("/cuenta/entrar") },
  });
  return { subject: "Este correo ya tiene una cuenta en STOPee", html, text };
}

/**
 * Al correo ANTERIOR cuando ya cambió: el dueño real se entera y tiene una semana para deshacerlo. Si alguien se
 * adueñó de la sesión y cambió el correo, este aviso es lo que le permite recuperar la cuenta.
 */
export function emailChangedNoticeEmail(data: { newEmailMasked: string; revertUrl: string; byTeam: boolean }) {
  const { html, text } = renderLayout({
    title: "El correo de tu cuenta cambió",
    paragraphs: [
      data.byTeam
        ? `El equipo de STOPee cambió el correo de tu cuenta a ${data.newEmailMasked}, a petición tuya.`
        : `El correo de tu cuenta de STOPee ahora es ${data.newEmailMasked}. Desde este momento los avisos llegan allá y no a este correo.`,
      "Si fuiste tú, no tienes que hacer nada. Si NO fuiste tú, toca el botón: regresamos tu correo a este y cerramos todas las sesiones. Te mandaremos un enlace para elegir una contraseña nueva. El enlace funciona durante 7 días.",
    ],
    action: { label: "No fui yo: recuperar mi cuenta", url: data.revertUrl },
  });
  return { subject: "El correo de tu cuenta de STOPee cambió", html, text };
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
