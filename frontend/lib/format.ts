const TZ = "Asia/Kolkata";

function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  // plain calendar dates ("2026-05-15") are dates, not instants: keep them on that day
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00+05:30`);
  return new Date(v);
}

export function fmtDate(v?: string | Date | null): string {
  if (!v) return "–";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(toDate(v));
}

export function fmtShort(v?: string | Date | null): string {
  if (!v) return "–";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short" }).format(toDate(v));
}

export function fmtDateTime(v?: string | Date | null): string {
  if (!v) return "–";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(toDate(v));
}

export function fmtWeekday(v?: string | Date | null): string {
  if (!v) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long" }).format(toDate(v));
}

/** "in 3 days", "today", "5 days late" */
export function dueText(days?: number | null): string {
  if (days === null || days === undefined) return "";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 0) return `in ${days} days`;
  return `${-days} day${days === -1 ? "" : "s"} late`;
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? one + "s"}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function isoDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
