import { useFetcher } from "@remix-run/react";

type Props = {
  email: string;
  /** "dark" para el acceso de administrador (fondo oscuro). */
  tone?: "light" | "dark";
};

/** Botón "Reenviar enlace" que aparece cuando alguien intenta entrar sin haber confirmado su correo. */
export function ResendVerification({ email, tone = "light" }: Props) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const sending = fetcher.state !== "idle";
  const dark = tone === "dark";

  return (
    <div className="flex flex-col gap-2">
      <fetcher.Form method="post" action="/cuenta/reenviar">
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={sending}
          className={`min-h-11 rounded-full border px-5 text-sm font-semibold disabled:opacity-60 ${
            dark ? "border-hueso/30 text-hueso hover:border-hueso/60" : "border-carbon/20 text-carbon hover:border-carbon/40"
          }`}
        >
          {sending ? "Enviando…" : "Reenviar enlace"}
        </button>
      </fetcher.Form>
      {fetcher.data && (
        <p role="status" className={`text-sm ${fetcher.data.ok ? (dark ? "text-lima" : "text-bosque") : "text-red-600"}`}>
          {fetcher.data.message}
        </p>
      )}
    </div>
  );
}
