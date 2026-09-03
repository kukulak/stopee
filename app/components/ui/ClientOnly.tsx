import { useEffect, useState, type ReactNode } from "react";

/** Evita SSR para hijos que dependen de WebGL/window (R3F, GSAP ScrollTrigger). */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: () => ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children()}</> : <>{fallback}</>;
}
