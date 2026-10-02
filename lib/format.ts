/** Shared formatting helpers (client + server safe — no server-only imports). */

export function formatKES(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return "—";
  return `KES ${Math.round(Number(amount)).toLocaleString("en-KE")}`;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString("en-KE");
}

export function formatPercent(numerator: number, denominator: number): string {
  if (!denominator) return "0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = formatDate(value);
  const time = formatTime(value);
  return [date, time].filter(Boolean).join(" · ");
}

/** Mask a customer phone for display: 0712•••••• (§28). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `${digits.slice(0, 4)}${"•".repeat(Math.max(3, digits.length - 4))}`;
}
