/**
 * data.ts
 *
 * Builds and caches the index of everything that belongs on a calendar day:
 *
 *   • notes carrying an event tag          -> events
 *   • notes carrying a todo tag            -> todos
 *   • `- [ ] … 📅 YYYY-MM-DD` inline tasks -> todos   (optional)
 *
 * The index is rebuilt asynchronously whenever metadata changes. Views read it
 * synchronously while rendering, and re-render when a rebuild finishes, so the
 * UI never blocks on vault I/O.
 *
 * No tag or property name is hardcoded – everything comes from settings.
 */

import { App, CachedMetadata, TFile, Vault } from "obsidian";
import {
    CalendarSettings,
    eventTagSet,
    excludeTagSet,
    intersects,
    normaliseTag,
    splitList,
    todoTagSet
} from "./settings";
import { CalendarEntry, DayData, EMPTY_DAY } from "./types";
import { ISO_DAY, isValidIsoDay, parseTimeRange } from "./date-utils";

export type ChangeListener = () => void;

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/** Reads `tags` / `tag` from frontmatter plus every tag found in the body. */
export function collectTags(cache: CachedMetadata | null): Set<string> {
    const tags = new Set<string>();
    if (!cache) return tags;

    const add = (raw: unknown): void => {
        if (typeof raw !== "string" && typeof raw !== "number") return;
        const value = normaliseTag(String(raw));
        if (value) tags.add(value);
    };

    const fm = cache.frontmatter as Record<string, unknown> | undefined;
    if (fm) {
        const raw = fm["tags"] ?? fm["tag"];
        if (Array.isArray(raw)) raw.forEach(add);
        else if (raw !== null && typeof raw === "object") {
            // Dataview style `tags: {0: "event"}` or a nested array.
            Object.values(raw as Record<string, unknown>).forEach(add);
        } else add(raw);
    }

    for (const tagCache of cache.tags ?? []) add(tagCache.tag);
    return tags;
}

/** Tags present in a line of markdown body text. */
export function tagsInText(text: string): Set<string> {
    const tags = new Set<string>();
    const pattern = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const value = normaliseTag(match[2]);
        if (value) tags.add(value);
    }
    return tags;
}

/**
 * Normalises every shape a date property can take into `YYYY-MM-DD`:
 * ISO strings, `14.10.2026`, `Date` objects, Luxon `DateTime` objects (as
 * produced by Dataview) and epoch timestamps.
 */
export function resolveDay(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;

    if (typeof value === "string") {
        const trimmed = value.trim();
        const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (iso) {
            const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
            return isValidIsoDay(candidate) ? candidate : null;
        }
        const dotted = trimmed.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})/);
        if (dotted) {
            const candidate = `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
            return isValidIsoDay(candidate) ? candidate : null;
        }
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value > 1e11 ? value : value > 1e9 ? value * 1000 : null;
        if (ms === null) return null;
        const d = new Date(ms);
        return Number.isNaN(d.getTime())
            ? null
            : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (obj["isValid"] === false) return null;
        try {
            if (typeof obj["toFormat"] === "function") {
                const out = (obj["toFormat"] as (fmt: string) => string)("yyyy-MM-dd");
                return isValidIsoDay(out) ? out : null;
            }
            if (typeof obj["toISODate"] === "function") {
                const out = (obj["toISODate"] as () => string)();
                return isValidIsoDay(out) ? out : null;
            }
            if (typeof obj["toISO"] === "function") {
                const out = String((obj["toISO"] as () => string)()).slice(0, 10);
                return isValidIsoDay(out) ? out : null;
            }
        } catch {
            return null;
        }
        if (typeof obj["ts"] === "number") {
            return resolveDay(obj["ts"]);
        }
    }

    return null;
}

function truthy(value: unknown): boolean {
    if (value === true) return true;
    if (typeof value === "string") {
        return ["true", "yes", "x", "done", "complete", "completed", "erledigt", "fertig"]
            .includes(value.trim().toLowerCase());
    }
    return false;
}

function titleOf(file: TFile, frontmatter: Record<string, unknown> | undefined, settings: CalendarSettings): string {
    const raw = frontmatter?.[settings.titleProp];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number") return String(raw);
    return file.basename;
}

// ---------------------------------------------------------------------------
// Inline task parsing
// ---------------------------------------------------------------------------

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const SCHEDULED_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const START_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const INLINE_FIELD_RE = /(?:^|\s)(?:due|scheduled|start)\s*::\s*(\d{4}-\d{2}-\d{2})/i;

const DATE_MARKER_RE = /[\u{1F4C5}\u{1F4C6}\u{1F4EB}\u{1F6EB}\u{23F3}\u{1F19F}]\s*\d{4}-\d{1,2}-\d{1,2}/gu;
const TAG_MARKER_RE = /(^|\s)#[\p{L}\p{N}_/-]+/gu;

export function cleanTaskText(text: string): string {
    return text
        .replace(DATE_MARKER_RE, " ")
        .replace(/(?:^|\s)(?:due|scheduled|start)\s*::\s*\d{4}-\d{1,2}-\d{1,2}/gi, " ")
        .replace(TAG_MARKER_RE, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function dueDateOf(text: string): string | null {
    const candidates = [DUE_RE, SCHEDULED_RE, START_RE, INLINE_FIELD_RE];
    for (const pattern of candidates) {
        const match = text.match(pattern);
        if (match && isValidIsoDay(match[1])) return match[1];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface BuildResult {
    days: Map<string, DayData>;
}

export class DataIndex {
    private readonly app: App;
    private readonly getSettings: () => CalendarSettings;

    private version = 0;
    private builtVersion = -1;
    private emittedVersion = -1;
    private building: Promise<void> | null = null;
    private days: Map<string, DayData> = new Map();
    private readonly listeners = new Set<ChangeListener>();
    private debounceTimer: number | null = null;
    private disposed = false;

    constructor(app: App, getSettings: () => CalendarSettings) {
        this.app = app;
        this.getSettings = getSettings;
    }

    // -- public API ---------------------------------------------------------

    /** Fires after every completed rebuild (initial load included). */
    subscribe(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Starts a build if none has run yet; never throws. */
    ensureLoaded(): Promise<void> {
        return this.ready();
    }

    /** Marks the data stale. Rebuild is debounced and runs in the background. */
    invalidate(): void {
        if (this.disposed) return;
        this.version += 1;
        if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.ready();
        }, 400);
    }

    /** Synchronous read of one day. Safe to call at any time. */
    getDay(iso: string): DayData {
        return this.days.get(iso) ?? EMPTY_DAY;
    }

    eventCount(iso: string): number {
        return this.getDay(iso).events.length;
    }

    openTodoCount(iso: string): number {
        const settings = this.getSettings();
        return this.getDay(iso).todos.filter(todo => settings.showCompleted || !todo.completed).length;
    }

    hasEntries(iso: string): boolean {
        const day = this.getDay(iso);
        return day.events.length > 0 || day.todos.length > 0;
    }

    dispose(): void {
        this.disposed = true;
        if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        this.listeners.clear();
    }

    // -- internals ----------------------------------------------------------

    private async ready(): Promise<void> {
        for (let attempt = 0; attempt < 8; attempt++) {
            if (this.disposed || this.builtVersion === this.version) return;
            if (!this.building) {
                const target = this.version;
                this.building = this.build()
                    .then(() => {
                        this.builtVersion = target;
                        if (this.emittedVersion !== target) {
                            this.emittedVersion = target;
                            this.emit();
                        }
                    })
                    .catch(err => {
                        console.error("Calendar Suite: failed to index vault", err);
                        // Mark as built anyway so callers are not stuck in a
                        // retry loop with a permanently failing build.
                        this.builtVersion = target;
                    })
                    .finally(() => {
                        this.building = null;
                    });
            }
            await this.building;
        }
    }

    private emit(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.error("Calendar Suite: index listener failed", err);
            }
        }
    }

    private async build(): Promise<void> {
        const settings = this.getSettings();
        const days = new Map<string, DayData>();

        const eventTags = eventTagSet(settings);
        const todoTags = todoTagSet(settings);
        const excludeTags = excludeTagSet(settings);
        const dateProps = [settings.dateProp, ...splitList(settings.datePropAliases)]
            .map(prop => prop.trim())
            .filter(Boolean);

        const push = (iso: string | null, kind: "event" | "todo", entry: CalendarEntry): void => {
            if (!iso) return;
            let day = days.get(iso);
            if (!day) {
                day = { events: [], todos: [] };
                days.set(iso, day);
            }
            (kind === "event" ? day.events : day.todos).push(entry);
        };

        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = (cache?.frontmatter ?? undefined) as Record<string, unknown> | undefined;
            const tags = collectTags(cache);

            // ---- Tagged event note ----------------------------------------
            if (eventTags.size > 0 && intersects(tags, eventTags)) {
                const iso = this.resolveNoteDate(frontmatter, dateProps, file);
                const range = this.noteTimeRange(frontmatter, settings);
                push(iso, "event", {
                    path: file.path,
                    title: titleOf(file, frontmatter, settings),
                    kind: "event",
                    date: iso ?? "",
                    start: range.start,
                    end: range.end,
                    timeText: range.text,
                    completed: false,
                    source: "note",
                    line: null,
                    text: null
                });
            }

            // ---- Tagged todo note -----------------------------------------
            if (todoTags.size > 0 && intersects(tags, todoTags)) {
                const iso = this.resolveNoteDate(frontmatter, dateProps, file);
                const range = this.noteTimeRange(frontmatter, settings);
                push(iso, "todo", {
                    path: file.path,
                    title: titleOf(file, frontmatter, settings),
                    kind: "todo",
                    date: iso ?? "",
                    start: range.start,
                    end: range.end,
                    timeText: range.text,
                    completed: truthy(frontmatter?.[settings.completedProp]),
                    source: "note",
                    line: null,
                    text: null
                });
            }

            // ---- Inline markdown tasks ------------------------------------
            if (!settings.inlineTasks) continue;

            let content: string;
            try {
                content = await this.app.vault.cachedRead(file);
            } catch {
                continue; // file vanished mid-build – ignore
            }
            if (!content.includes("[ ]") && !content.includes("[x]") && !content.includes("[X]")) continue;

            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(TASK_RE);
                if (!match) continue;

                const body = match[2];
                if (!body) continue;

                const due = dueDateOf(body);
                if (!due) continue;

                const lineTags = tagsInText(body);
                if (intersects(lineTags, excludeTags)) continue;
                if (settings.inlineRequireTodoTag && !intersects(lineTags, todoTags)) continue;

                push(due, "todo", {
                    path: file.path,
                    title: cleanTaskText(body) || file.basename,
                    kind: "todo",
                    date: due,
                    start: null,
                    end: null,
                    timeText: "",
                    completed: match[1] !== " ",
                    source: "inline",
                    line: i,
                    text: body
                });
            }
        }

        for (const day of days.values()) {
            day.events.sort(compareEntries);
            day.todos.sort(compareEntries);
        }

        this.days = days;
    }

    /** Date property first, then any configured aliases, then a `YYYY-MM-DD` filename prefix. */
    private resolveNoteDate(
        frontmatter: Record<string, unknown> | undefined,
        dateProps: string[],
        file: TFile
    ): string | null {
        for (const prop of dateProps) {
            const value = resolveDay(frontmatter?.[prop]);
            if (value) return value;
        }
        const fromName = file.basename.match(/^(\d{4}-\d{2}-\d{2})/);
        if (fromName && isValidIsoDay(fromName[1])) return fromName[1];
        return null;
    }

    private noteTimeRange(
        frontmatter: Record<string, unknown> | undefined,
        settings: CalendarSettings
    ): { start: number | null; end: number | null; text: string } {
        if (!frontmatter) return { start: null, end: null, text: "" };

        const start = parseTimeRange(frontmatter[settings.startProp]).start;
        const endRaw = frontmatter[settings.endProp];
        const end = endRaw === undefined || endRaw === null || endRaw === ""
            ? null
            : parseTimeRange(endRaw).start;

        if (start !== null || end !== null) {
            const text = start !== null && end !== null
                ? `${formatMinutes(start)}-${formatMinutes(end)}`
                : start !== null
                    ? formatMinutes(start)
                    : formatMinutes(end as number);
            return { start, end, text };
        }

        if (settings.timeProp) {
            const single = parseTimeRange(frontmatter[settings.timeProp]);
            if (single.start !== null) {
                return {
                    start: single.start,
                    end: single.end,
                    text: single.text || formatMinutes(single.start)
                };
            }
        }

        return { start: null, end: null, text: "" };
    }
}

function formatMinutes(value: number): string {
    const h = Math.floor(value / 60);
    const m = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
    const aKey = a.start ?? Number.MAX_SAFE_INTEGER;
    const bKey = b.start ?? Number.MAX_SAFE_INTEGER;
    if (aKey !== bKey) return aKey - bKey;
    return a.title.localeCompare(b.title, "en");
}

/** Small helper so callers can reuse the ISO pattern without importing it twice. */
export const ISO_DAY_PATTERN = ISO_DAY;

/** Registers vault listeners that keep the index fresh. */
export function watchVault(app: App, index: DataIndex): () => void {
    const onChange = (): void => index.invalidate();

    app.metadataCache.on("resolved", onChange);
    app.metadataCache.on("changed", onChange);
    app.metadataCache.on("deleted", onChange);
    app.vault.on("create", onChange);
    app.vault.on("delete", onChange);
    app.vault.on("rename", onChange);
    app.vault.on("modify", onChange);

    const off = (): void => {
        app.metadataCache.off("resolved", onChange);
        app.metadataCache.off("changed", onChange);
        app.metadataCache.off("deleted", onChange);
        app.vault.off("create", onChange);
        app.vault.off("delete", onChange);
        app.vault.off("rename", onChange);
        app.vault.off("modify", onChange);
    };
    return off;
}

/** Convenience re-export so `Vault` stays referenced for the type checker. */
export type { Vault };
