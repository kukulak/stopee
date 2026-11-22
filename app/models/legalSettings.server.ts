import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "~/lib/db.server";
import { createTtlCache } from "~/lib/ttlCache.server";

const { Schema, model, models } = mongoose;

const DEFAULT_PRIVACY_MARKDOWN = `**{{razonSocial}}** ("STOPee", "nosotros"), con domicilio en **{{direccionFiscal}}**, es responsable del tratamiento de tus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.

## 1. Datos personales que recabamos

Dependiendo de cómo interactúes con nosotros, podemos recabar:

- **Datos de identificación y contacto:** nombre, correo electrónico, teléfono.
- **Datos de envío:** dirección de entrega.
- **Datos de tu(s) perro(s):** si decides agregarlos a tu cuenta (nombre, raza u otros datos que tú captures), únicamente para personalizar tu experiencia.
- **Datos de pago:** no almacenamos los datos completos de tu tarjeta. El cobro lo procesa directamente Stripe, Inc., conforme a sus propias políticas de privacidad y seguridad (certificación PCI-DSS).
- **Historial de pedidos y suscripciones** asociado a tu cuenta.
- **Datos de navegación:** páginas visitadas, origen de tu visita (utm_source/medium/campaign) y un identificador de visitante anónimo, mediante cookies propias, para entender qué contenido funciona y mejorar el sitio.

## 2. Finalidades del tratamiento

**Finalidades primarias** (necesarias para darte el servicio):

- Procesar y dar seguimiento a tus pedidos y suscripciones.
- Gestionar tu cuenta, tu historial de compras y tu programa de lealtad.
- Contactarte sobre el estado de tu pedido o para brindarte soporte.
- Cumplir con obligaciones fiscales y legales.

**Finalidades secundarias** (puedes oponerte sin que esto afecte tu compra):

- Enviarte promociones, descuentos o novedades por correo electrónico.
- Medir el desempeño de nuestra publicidad en Google y Meta (Facebook/Instagram).
- Elaborar estadísticas internas de uso del sitio.

Si no deseas que tus datos se usen para las finalidades secundarias, escríbenos a {{correoContacto}} con el asunto "Oposición a finalidades secundarias".

## 3. Transferencias de datos

Para operar el servicio, compartimos datos estrictamente necesarios con:

- **Stripe, Inc.** — procesamiento de pagos.
- **Nuestro proveedor de hosting y base de datos** — almacenamiento de la información de tu cuenta y pedidos.
- **Google LLC y Meta Platforms, Inc.** — medición de campañas publicitarias, únicamente si aceptas cookies de marketing.

No vendemos ni rentamos tus datos personales a terceros.

## 4. Derechos ARCO

Tienes derecho a Acceder, Rectificar y Cancelar tus datos personales, así como a Oponerte al uso de los mismos (derechos ARCO), y a revocar tu consentimiento en cualquier momento. Para ejercerlos, escríbenos a {{correoContacto}} indicando tu nombre completo, el derecho que deseas ejercer y una copia de una identificación oficial. Responderemos en un plazo máximo de 20 días hábiles.

También puedes eliminar tu cuenta directamente desde tu perfil.

## 5. Uso de cookies

Usamos cookies propias para mantener tu sesión y tu carrito de compra, y cookies de terceros (Google, Meta) para medir el desempeño de nuestra publicidad, solo si llegaste al sitio a través de un anuncio. Puedes eliminarlas desde la configuración de tu navegador en cualquier momento.

## 6. Cambios a este aviso

Podemos actualizar este aviso de privacidad. Cualquier cambio se publicará en esta misma página con su fecha de actualización correspondiente.

## 7. Contacto

Dudas sobre este aviso: {{correoContacto}}`;

const DEFAULT_TERMS_MARKDOWN = `Al comprar en STOPee.com.mx aceptas los siguientes términos. Si tienes dudas antes de comprar, escríbenos a {{correoContacto}}.

## 1. Sobre el producto

STOPee es un concentrado biotecnológico de higiene urbana canina. Un litro de concentrado rinde 30 litros de solución activa siguiendo las instrucciones de dilución indicadas en el empaque y en la sección "Modo de uso" del sitio. El producto está diseñado para uso externo en superficies urbanas; no es un producto de uso veterinario ni para consumo.

## 2. Precios y pago

Los precios se muestran en pesos mexicanos (MXN) e incluyen los impuestos aplicables, salvo que se indique lo contrario. El pago se procesa de forma segura a través de Stripe; STOPee no almacena los datos completos de tu tarjeta. Nos reservamos el derecho de modificar precios sin previo aviso, sin afectar pedidos ya confirmados.

## 3. Envíos

{{tiemposEnvio}}

Te enviaremos un número de guía en cuanto tu pedido salga de nuestro almacén.

## 4. Devoluciones y reembolsos

{{politicaDevoluciones}}

Por tratarse de un producto de higiene, no aceptamos devoluciones de envases ya abiertos o usados, salvo defecto de fábrica.

## 5. Suscripción periódica

Al activar el auto-envío periódico, autorizas a STOPee a realizar cargos recurrentes a tu método de pago con la frecuencia que elijas ({{frecuenciasAutoenvio}}){{descuentoAutoenvio}}. Puedes pausar, cambiar la frecuencia o cancelar tu suscripción en cualquier momento desde tu cuenta, sin penalización. La cancelación aplica a partir del siguiente ciclo de cobro; no se reembolsan cargos ya procesados.

## 6. Cuenta de usuario

Eres responsable de mantener la confidencialidad de tu contraseña y de toda actividad que ocurra en tu cuenta. Notifícanos de inmediato si sospechas un acceso no autorizado.

## 7. Propiedad intelectual

La marca STOPee, su logotipo, contenidos del sitio y materiales de comunicación son propiedad de **{{razonSocial}}** y están protegidos por la legislación aplicable en materia de propiedad intelectual. Queda prohibido su uso sin autorización previa por escrito.

## 8. Límite de responsabilidad

STOPee no será responsable por daños derivados de un uso del producto distinto al indicado en sus instrucciones de uso. El producto se entrega "tal cual", sin más garantías que las expresamente indicadas en estos términos y las que otorgue la ley aplicable.

## 9. Legislación aplicable

Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Cualquier controversia se someterá a los tribunales competentes correspondientes a **{{direccionFiscal}}**, salvo los derechos que la Ley Federal de Protección al Consumidor te reconozca en tu localidad.

## 10. Contacto

{{correoContacto}}`;

const legalSettingsSchema = new Schema(
  {
    // Datos del negocio: se insertan como variables ({{razonSocial}}, etc.)
    // dentro de los textos de abajo — así se editan una sola vez aquí en vez
    // de tener que buscar y reemplazar dentro de párrafos largos cada vez
    // que cambien.
    razonSocial: { type: String, default: "" },
    direccionFiscal: { type: String, default: "" },
    correoContacto: { type: String, default: "" },
    telefono: { type: String, default: "" },
    tiemposEnvio: { type: String, default: "" },
    politicaDevoluciones: { type: String, default: "" },
    // Contacto/redes — viven aquí junto con el resto de datos de la empresa
    // (una sola sección en el backoffice) en vez de repartidos entre varias
    // páginas de admin. Vacío por defecto: nada de esto se inventa, y cada
    // uno solo aparece en el sitio una vez que el admin lo llena.
    whatsappNumber: { type: String, default: "" },
    // Lista libre de redes: solo el link; la red y su ícono se deducen del
    // dominio (ver app/lib/socialNetworks.ts), así agregar una nueva no
    // requiere tocar el esquema.
    socialLinks: { type: [new Schema({ url: { type: String, required: true } }, { _id: false })], default: [] },
    // PDF de la ficha técnica (se sube desde el backoffice); la página
    // /como-funciona solo muestra el botón de descarga si hay archivo.
    fichaTecnicaUrl: { type: String, default: "" },
    // Logo del sitio (se sube desde el backoffice); vacío = el logo original incluido en el proyecto.
    logoUrl: { type: String, default: "" },
    // Versión compacta (sin eslogan) para los lugares chicos: menú y pantallas de acceso. Vacío = usa logoUrl.
    logoCompactUrl: { type: String, default: "" },

    privacyPolicyMarkdown: { type: String, default: DEFAULT_PRIVACY_MARKDOWN },
    termsMarkdown: { type: String, default: DEFAULT_TERMS_MARKDOWN },
  },
  { timestamps: true },
);

export type LegalSettingsDoc = InferSchemaType<typeof legalSettingsSchema>;

// En desarrollo se re-registra el modelo en cada recarga del módulo: si no,
// mongoose conserva el esquema viejo en memoria y descarta en silencio los
// campos nuevos al guardar (hasta reiniciar el servidor).
if (process.env.NODE_ENV !== "production" && models.LegalSettings) {
  mongoose.deleteModel("LegalSettings");
}

export const LegalSettingsModel =
  (models.LegalSettings as Model<LegalSettingsDoc>) ??
  model<LegalSettingsDoc>("LegalSettings", legalSettingsSchema);

/**
 * Documento único (patrón singleton, igual que SiteSettings): siempre se
 * lee/edita el mismo registro, creándolo con los textos por default (con
 * variables sin llenar) la primera vez que se pide.
 */
export async function getLegalSettings() {
  await connectDB();
  const existing = await LegalSettingsModel.findOne().lean();
  if (existing) return existing;
  const created = await LegalSettingsModel.create({});
  return created.toObject();
}

const getLegalSettingsCache = createTtlCache<Awaited<ReturnType<typeof getLegalSettings>>>();

/** getLegalSettings con caché corta, para el layout raíz (que lo lee en cada petición). */
export function getLegalSettingsCached() {
  return getLegalSettingsCache.get(getLegalSettings);
}

export async function updateLegalSettings(
  data: Partial<Omit<LegalSettingsDoc, "socialLinks">> & { socialLinks?: { url: string }[] },
) {
  getLegalSettingsCache.clear();
  await connectDB();
  const existing = await LegalSettingsModel.findOne();
  if (existing) {
    Object.assign(existing, data);
    await existing.save();
    getLegalSettingsCache.clear();
    return existing.toObject();
  }
  const created = await LegalSettingsModel.create(data);
  getLegalSettingsCache.clear();
  return created.toObject();
}
