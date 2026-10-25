/**
 * Card shows CPulls Cards is vending at.
 *
 * The data lives in shared/shows-data.ts (so the server can read it too);
 * this module adds the date helpers the storefront uses.
 */
import { SHOWS, type CardShow } from "@shared/shows-data";
export { SHOWS, type CardShow };

function parseLocal(iso: string, endOfDay = false): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
}

const NOW_OVERRIDE = (import.meta as any).env?.VITE_SHOWS_NOW as string | undefined;

export function splitShows(now: Date = NOW_OVERRIDE ? parseLocal(NOW_OVERRIDE) : new Date(), list: CardShow[] = SHOWS) {
  const upcoming = list.filter((s) => parseLocal(s.end || s.start, true) >= now).sort(
    (a, b) => a.start.localeCompare(b.start),
  );
  const past = list.filter((s) => parseLocal(s.end || s.start, true) < now).sort(
    (a, b) => b.start.localeCompare(a.start),
  );
  return { upcoming, past };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function showDateParts(s: CardShow) {
  const a = parseLocal(s.start);
  const b = s.end ? parseLocal(s.end) : null;
  const crossMonth = !!b && b.getMonth() !== a.getMonth();
  const month = crossMonth ? `${MONTHS[a.getMonth()]}–${MONTHS[b!.getMonth()]}` : MONTHS[a.getMonth()];
  const day = b ? `${a.getDate()}–${b.getDate()}` : String(a.getDate());
  const weekday = b ? `${DAYS[a.getDay()]}–${DAYS[b.getDay()]}` : DAYS[a.getDay()];
  return { month, day, weekday, year: a.getFullYear() };
}
