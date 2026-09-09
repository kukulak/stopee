/** Wordmark oficial de STOPee — arte final en public/elementos-design/logo-STOPee.png. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/elementos-design/logo-STOPee.png"
      alt="STOPee — Concentrado biotecnológico de higiene urbana"
      className={className}
    />
  );
}
