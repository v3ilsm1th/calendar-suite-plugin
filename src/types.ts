/**
 * types.ts
 *
 * Shared type definitions for Calendar Suite.
 */

export type EntryKind = "event" | "todo";

/** Where an entry came from – a tagged note or an inline markdown task. */
export type EntrySource = "note" | "inline";

/**
 * One item that belongs to a calendar day. Both events and todos normalise
 * into this shape so the three views can share a single rendering pipeline.
 */
export interface CalendarEntry {
    /** Vault path of the note the entry belongs to. */
    path: string;
    /** Display title. */
    title: string;
    kind: EntryKind;
    /** `YYYY-MM-DD`. */
    date: string;
    /** Minutes from midnight, `null` when unknown. */
    start: number | null;
    /** Minutes from midnight, `null` when unknown. */
    end: number | null;
    /** Raw time text as written in the note, e.g. `18:00-20:00`. */
    timeText: string;
    completed: boolean;
    source: EntrySource;
    /** 0-based line number, for inline tasks (so we can open at that line). */
    line: number | null;
    /** Inline task body without the checkbox marker. */
    text: string | null;
}

export interface DayData {
    events: CalendarEntry[];
    todos: CalendarEntry[];
}

export const EMPTY_DAY: DayData = { events: [], todos: [] };

/** The four things that can be inserted into a note. */
export type ViewKind = "month" | "day" | "timeline" | "dashboard";

/** Timeline presentation mode. */
export type TimelineMode = "timeline" | "list";

/** Options accepted when a view is rendered through the JavaScript API. */
export interface RenderOptions {
    /** Vault path of the note containing the block, used to resolve links. */
    sourcePath?: string;
    /**
     * Selects this date when the view is (re)rendered. It feeds the shared
     * selected-date state, so every other Calendar Suite view follows along.
     * Omit it to keep whatever date is currently selected.
     */
    initialDate?: string;
}

/** Context handed to every view renderer. */
export interface ViewContext {
    container: HTMLElement;
    sourcePath: string;
    options: RenderOptions;
}
