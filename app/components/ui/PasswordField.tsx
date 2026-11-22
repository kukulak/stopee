import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "~/components/ui/Icons";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Clases del <input>; el espacio para el botón del ojito se agrega aquí. */
  inputClassName: string;
};

/**
 * Campo de contraseña con el botón de mostrar/ocultar. El botón vive dentro
 * del campo y mide 48 px de ancho por el alto completo del campo, así que es
 * fácil de tocar en el celular.
 */
export function PasswordField({ inputClassName, ...inputProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input {...inputProps} type={visible ? "text" : "password"} className={`${inputClassName} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-current opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lima"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
