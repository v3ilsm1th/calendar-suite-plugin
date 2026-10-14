/**
 * date-utils.ts
 *
 * All date handling for Calendar Suite. Everything that reaches the screen is
 * formatted with an explicit `en` locale so visible plugin text stays English
 * regardless of the Obsidian UI language or the vault's note language.
 *
 * Dates travel through the plugin as plain `YYYY-MM-DD` strings ("ISO day").
 * That keeps them timezone-safe: no `Date` object is ever created from a
 * timestamp and then rendered, so a note written at 23:00 can never slide onto
 * the neighbouring day.
 */

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const LOCALE = "en-US";

/** Split of a `YYYY-MM-DD` string. */
export interface DayParts {
    year: number;
    month: number; // 1-12
    day: number;   // 1-31
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function isValidIsoDay(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
    const { year, month, day } = parseIso(value);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    // Reject impossible days such as 2026-02-31.
    const probe = toJsDate(value);
    return probe !== null && probe.getDate() === day;
}

export function parseIso(iso: string): DayParts {
    const [year, month, day] = iso.split("-").map(n => Number(n));
    return { year, month, day };
}

export function toIso(parts: DayParts): string {
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Local-time `Date` for an ISO day, or `null` when the day does not exist. */
export function toJsDate(iso: string): Date | null {
    if (!ISO_DAY.test(iso)) return null;
    const { year, month, day } = parseIso(iso);
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

export function todayIso(now: Date = new Date()): string {
    return toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function addDays(iso: string, delta: number): string {
    const d = toJsDate(iso) ?? new Date();
    d.setDate(d.getDate() + delta);
    return toIso({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

export function monthKey(iso: string): string {
    return iso.slice(0, 7);
}

export function monthKeyOf(year: number, month: number): string {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Formatting (always English)
// ---------------------------------------------------------------------------

const fmtMonthYear = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const fmtDayHeading = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
});
const fmtShortDay = new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric" });
const fmtWeekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });
const fmtWeekdayLong = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });

/** "October 2026" */
export function formatMonthYear(year: number, month: number): string {
    const d = new Date(year, month - 1, 1);
    return fmtMonthYear.format(d);
}

/** "Wednesday, October 14, 2026" */
export function formatDayHeading(iso: string): string {
    const d = toJsDate(iso);
    return d ? fmtDayHeading.format(d) : iso;
}

/** "Wed, Oct 14" – compact label used in the timeline / day navigation. */
export function formatShortDay(iso: string): string {
    const d = toJsDate(iso);
    return d ? fmtShortDay.format(d) : iso;
}

export function weekdayShort(iso: string): string {
    const d = toJsDate(iso);
    return d ? fmtWeekdayShort.format(d) : "";
}

export function weekdayLong(iso: string): string {
    const d = toJsDate(iso);
    return d ? fmtWeekdayLong.format(d) : "";
}

/** Weekday header labels for the month grid, starting at `firstDayOfWeek`. */
export function weekdayHeaders(firstDayOfWeek: 0 | 1): string[] {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return firstDayOfWeek === 1 ? [...names.slice(1), names[0]] : names;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export interface MonthCell {
    iso: string;
    day: number;
    inMonth: boolean;
    /** ISO-8601 week number, used when week numbers are enabled. */
    week: number;
}

export interface MonthGrid {
    year: number;
    month: number;
    cells: MonthCell[];
    /** One entry per grid row, aligned with the first cell of that row. */
    rowWeeks: number[];
}

/**
 * Builds a 7-column grid of whole weeks for a month, starting on
 * `firstDayOfWeek`. The grid is always a multiple of 7 cells.
 */
export function buildMonthGrid(year: number, month: number, firstDayOfWeek: 0 | 1): MonthGrid {
    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const jsWeekday = firstOfMonth.getDay();        // 0 = Sunday
    const offset = (jsWeekday - firstDayOfWeek + 7) % 7;
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const cells: MonthCell[] = [];
    const rowWeeks: number[] = [];

    for (let i = 0; i < totalCells; i++) {
        const d = new Date(year, month - 1, 1 - offset + i);
        const iso = toIso({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
        if (i % 7 === 0) rowWeeks.push(isoWeek(iso));
        cells.push({
            iso,
            day: d.getDate(),
            inMonth: d.getMonth() === month - 1,
            week: isoWeek(iso)
        });
    }

    return { year, month, cells, rowWeeks };
}

/** ISO-8601 week number (week starts Monday, week 1 contains Jan 4th). */
export function isoWeek(iso: string): number {
    const d = toJsDate(iso);
    if (!d) return 0;
    // Move to the Thursday of the current ISO week.
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const weekday = (target.getDay() + 6) % 7;              // Monday = 0
    target.setDate(target.getDate() - weekday + 3);

    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstWeekday = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstWeekday + 3);

    return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** `18:00`, `18.30`, `9:00` -> minutes from midnight, or `null`. */
export function parseTimeToMinutes(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        // YAML may parse `18:00` oddly in some edge cases; treat small numbers
        // as hours only when they are plausible, otherwise give up.
        if (value >= 0 && value <= 23) return Math.round(value * 60);
        return null;
    }
    if (typeof value !== "string") return null;
    const m = value.trim().match(/(\d{1,2})[:.](\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

export interface TimeRange {
    start: number | null;
    end: number | null;
    /** Raw text worth showing as a label, e.g. `18:00-20:00`. */
    text: string;
}

/**
 * Parses either a single time (`18:00`) or a range (`18:00-20:00`,
 * `18:00 – 20:00`, `9:00-10:30`). Tolerates en dashes, em dashes and the
 * word `to`.
 */
export function parseTimeRange(value: unknown): TimeRange {
    if (value === null || value === undefined || value === "") {
        return { start: null, end: null, text: "" };
    }
    const raw = String(value).trim();
    const pieces = raw
        .split(/\s*(?:–|—|-|\bto\b)\s*/i)
        .map(p => p.trim())
        .filter(Boolean);

    const first = parseTimeToMinutes(pieces[0] ?? "");
    const second = pieces.length > 1 ? parseTimeToMinutes(pieces[1]) : null;

    if (first === null && second === null) return { start: null, end: null, text: raw };

    const start = first ?? second;
    const end = second !== null && second !== first ? second : null;
    return { start, end, text: raw };
}

/** `1080` -> `18:00` */
export function minutesToLabel(minutes: number): string {
    const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `18:00-20:00` -> `18:00-20:00`; `18:00` -> `18:00`; empty -> ``. */
export function formatRange(start: number | null, end: number | null, fallback: string): string {
    if (start === null && end === null) return fallback;
    if (start !== null && end !== null && end !== start) {
        return `${minutesToLabel(start)}-${minutesToLabel(end)}`;
    }
    if (start !== null) return minutesToLabel(start);
    return minutesToLabel(end as number);
}
