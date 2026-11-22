/**
 * Reglas para contraseñas nuevas. Sin sufijo ".server": se usan tanto en la
 * validación del servidor como en cualquier aviso del formulario.
 *
 * bcrypt solo lee los primeros 72 bytes: una contraseña más larga se corta en
 * silencio y dos contraseñas distintas podrían validar igual. Por eso se
 * limita el tamaño en bytes (un acento o una ñ ocupan 2).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

// Las contraseñas más repetidas en filtraciones públicas (en hispanohablantes y en general).
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321", "12341234",
  "password", "password1", "password123", "contrasena", "contrasena1", "contrasena123",
  "qwertyui", "qwerty123", "qwertyuiop", "abcd1234", "abc12345", "iloveyou", "admin123",
  "stopee", "stopee123", "stopee2026", "mascota123", "perrito123", "bienvenido", "bienvenida",
  "mexico123", "mexico2026", "12345678a", "1q2w3e4r", "q1w2e3r4", "asdfghjk", "zxcvbnm1",
]);

function normalize(password: string) {
  return password
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Mensaje de error en español, o null si la contraseña es aceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return "La contraseña es demasiado larga. Usa máximo 72 caracteres.";
  }
  const plain = normalize(password);
  if (COMMON_PASSWORDS.has(plain) || /^(.)\1+$/.test(plain)) {
    return "Esa contraseña es de las más usadas y es fácil de adivinar. Elige otra.";
  }
  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && plain === normalize(localPart)) {
    return "La contraseña no debe ser igual a tu correo. Elige otra.";
  }
  return null;
}
