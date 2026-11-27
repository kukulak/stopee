import { useId } from "react";
import { MARKETING_FIELD, MARKETING_HINT, MARKETING_LABEL } from "~/lib/marketing";

/** La casilla de «Quiero recibir promociones…». Siempre empieza sin marcar. `formId` la une a un formulario que está en otro lugar de la página. */
export function MarketingOptIn({ formId, className = "" }: { formId?: string; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-semibold text-carbon">
        <input id={id} type="checkbox" name={MARKETING_FIELD} form={formId} className="mt-0.5 h-5 w-5 shrink-0 accent-carbon" />
        {MARKETING_LABEL}
      </label>
      <p className="ml-8 text-xs text-carbon/60">{MARKETING_HINT}</p>
    </div>
  );
}
