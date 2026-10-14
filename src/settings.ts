/**
 * settings.ts
 *
 * Settings shape, defaults and the small helpers used to turn raw setting
 * strings into the sets the data layer compares against.
 *
 * Nothing in the detection logic hardcodes a tag or property name: every name
 * comes from here.
 */

export interface CalendarSettings {
    // --- Detection ---------------------------------------------------------
    /** Primary event tag, without the `#`. */
    eventTag: string;
    /** Extra event tags, comma or newline separated. */
    eventTagAliases: string;
    /** Primary todo tag, without the `#`. */
    todoTag: string;
    /** Extra todo tags, comma or newline separated. */
    todoTagAliases: string;

    /** Frontmatter property holding the date. */
    dateProp: string;
    /**
     * Extra date properties, comma separated. Lets notes that date themselves
     * differently (for example `due`, `scheduled`) appear alongside the main
     * property without changing it.
     */
    datePropAliases: string;
    /** Frontmatter property holding the start time. */
    startProp: string;
    /** Frontmatter property holding the end time. */
    endProp: string;
    /**
     * Optional single time property (e.g. `18:00-20:00`) used when the start
     * and end properties are empty.
     */
    timeProp: string;
    /** Frontmatter property holding the display title. */
    titleProp: string;
    /** Frontmatter property marking a note-level todo as completed. */
    completedProp: string;
    /** Whether completed todos are shown. */
    showCompleted: boolean;

    // --- Inline markdown tasks ---------------------------------------------
    /** Also read `- [ ] ... 📅 YYYY-MM-DD` tasks from note bodies. */
    inlineTasks: boolean;
    /** Tags that disqualify an inline task, comma separated. */
    inlineExcludeTags: string;
    /** Require the todo tag on an inline task instead of accepting any dated task. */
    inlineRequireTodoTag: boolean;

    // --- Templates and folders ---------------------------------------------
    journalTemplate: string;
    eventTemplate: string;
    todoTemplate: string;
    journalFolder: string;
    eventFolder: string;
    todoFolder: string;

    // --- Display -----------------------------------------------------------
    /** `0` = Sunday, `1` = Monday. */
    firstDayOfWeek: 0 | 1;
    /** Reduce paddings and row heights. */
    compactMode: boolean;
    /** Show ISO week numbers beside the month grid. */
    showWeekNumbers: boolean;
    /** Push the selected date into the existing `Views/kalender` dashboard state. */
    syncDashboard: boolean;

    // --- Internal ----------------------------------------------------------
    /** Set once the shipped templates have been written to the vault. */
    templatesInstalled: boolean;
}

export const DEFAULT_SETTINGS: CalendarSettings = {
    eventTag: "event",
    eventTagAliases: "",
    todoTag: "todo",
    todoTagAliases: "",

    dateProp: "date",
    datePropAliases: "",
    startProp: "start",
    endProp: "end",
    timeProp: "time",
    titleProp: "title",
    completedProp: "done",
    showCompleted: false,

    inlineTasks: true,
    inlineExcludeTags: "checklist",
    inlineRequireTodoTag: false,

    journalTemplate: "98_Vorlagen/Calendar Suite/Journal.md",
    eventTemplate: "98_Vorlagen/Calendar Suite/Event.md",
    todoTemplate: "98_Vorlagen/Calendar Suite/Todo.md",
    journalFolder: "99_Journal/Tage",
    eventFolder: "01_Inbox",
    todoFolder: "01_Inbox",

    firstDayOfWeek: 1,
    compactMode: false,
    showWeekNumbers: false,
    syncDashboard: true,
    templatesInstalled: false
};

/** Splits a comma / newline / semicolon separated settings string. */
export function splitList(value: string | undefined | null): string[] {
    if (!value) return [];
    return value
        .split(/[\n,;]+/)
        .map(part => part.trim())
        .filter(Boolean);
}

/** `#Work` -> `work`. */
export function normaliseTag(tag: string): string {
    return tag.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase();
}

/** Every tag that should count as an event (primary + aliases). */
export function eventTagSet(settings: CalendarSettings): Set<string> {
    return new Set(
        [settings.eventTag, ...splitList(settings.eventTagAliases)]
            .map(normaliseTag)
            .filter(Boolean)
    );
}

/** Every tag that should count as a todo (primary + aliases). */
export function todoTagSet(settings: CalendarSettings): Set<string> {
    return new Set(
        [settings.todoTag, ...splitList(settings.todoTagAliases)]
            .map(normaliseTag)
            .filter(Boolean)
    );
}

export function excludeTagSet(settings: CalendarSettings): Set<string> {
    return new Set(splitList(settings.inlineExcludeTags).map(normaliseTag).filter(Boolean));
}

export function intersects(actual: Set<string>, wanted: Set<string>): boolean {
    if (wanted.size === 0) return false;
    for (const tag of wanted) if (actual.has(tag)) return true;
    return false;
}

/** `98_Vorlagen/Calendar Suite/Event.md` -> `98_Vorlagen/Calendar Suite`. */
export function folderOf(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx === -1 ? "" : path.slice(0, idx);
}

export function ensureMdExtension(path: string): string {
    if (!path) return path;
    return /\.(md|base)$/i.test(path) ? path : `${path}.md`;
}
