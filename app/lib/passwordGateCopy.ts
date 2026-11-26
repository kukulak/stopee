/**
 * Textos por defecto de la pantalla de acceso privado — en un módulo aparte
 * de ~/models/passwordGate.server (sin Mongoose ni nada server-only) para
 * que el formulario de admin.password-gate.tsx pueda usarlos como
 * placeholder en el componente cliente sin arrastrar código de servidor al
 * bundle del navegador.
 */
export const DEFAULT_GATE_COPY = {
  kicker: "Acceso privado · Comunidad STOPee",
  title: "Tu semana exclusiva comienza aquí.",
  description:
    "Has formado parte de nuestra lista prioritaria y hoy tienes el primer acceso a STOPee antes de la apertura oficial. Ingresa la clave que recibiste en tu correo para desbloquear la tienda. Tu clave funciona también como cupón de descuento y se aplicará de forma automática en todas las compras que realices a lo largo de esta semana exclusiva.",
  passwordPlaceholder: "Código de acceso",
  buttonText: "Desbloquear tienda",
  errorMessage: "Clave no encontrada. Revisa el correo de invitación o confirma que esté escrita tal como la recibiste.",
  cartBannerMessage: "Beneficio exclusivo de lanzamiento aplicado correctamente.",
};
