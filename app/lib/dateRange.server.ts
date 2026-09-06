export type RangeKey = "today" | "7d" | "month" | "quarter" | "custom";

export type ResolvedRange = {
  key: RangeKey;
  from: Date;
  to: Date;
  /** Rango inmediatamente anterior, de igual duración, para el % vs periodo anterior. */
  previousFrom: Date;
  previousTo: Date;
  /** Para agrupar la sparkline por día en un rango razonable. */
  dayBuckets: string[];
};

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function resolveDateRange(url: URL): ResolvedRange {
  const key = (url.searchParams.get("range") as RangeKey) || "7d";
  const now = new Date();
  let from: Date;
  let to = now;

  switch (key) {
    case "today":
      from = startOfDay(now);
      break;
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter": {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), quarterStartMonth, 1);
      break;
    }
    case "custom": {
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      from = fromParam ? startOfDay(new Date(fromParam)) : startOfDay(new Date(now.getTime() - 6 * 86400000));
      to = toParam ? new Date(new Date(toParam).getTime() + 86399999) : now;
      break;
    }
    case "7d":
    default:
      from = startOfDay(new Date(now.getTime() - 6 * 86400000));
      break;
  }

  const durationMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs);

  const dayBuckets: string[] = [];
  const maxDays = 60;
  const cursor = startOfDay(from);
  let guard = 0;
  while (cursor.getTime() <= to.getTime() && guard < maxDays) {
    dayBuckets.push(formatDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return { key, from, to, previousFrom, previousTo, dayBuckets };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}
