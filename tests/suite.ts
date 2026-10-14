/**
 * suite.ts – behavioural tests for the parts of Calendar Suite that do not
 * need a running Obsidian instance.
 *
 * Run with: npm test
 */

import {
    addDays,
    buildMonthGrid,
    formatDayHeading,
    formatMonthYear,
    formatRange,
    isValidIsoDay,
    isoWeek,
    minutesToLabel,
    parseTimeRange,
    parseTimeToMinutes,
    todayIso,
    weekdayHeaders
} from "../src/date-utils";
import {
    DEFAULT_SETTINGS,
    ensureMdExtension,
    eventTagSet,
    intersects,
    normaliseTag,
    splitList,
    todoTagSet
} from "../src/settings";
import { applyTemplate, defaultTemplateFile } from "../src/templates";
import { cleanTaskText, dueDateOf, resolveDay, tagsInText } from "../src/data";
import { layout } from "../src/timeline-view";
import type { CalendarEntry } from "../src/types";

// ---------------------------------------------------------------------------
// Tiny assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail?: unknown): void {
    if (condition) {
        passed += 1;
        return;
    }
    failures.push(`${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

function eq(name: string, actual: unknown, expected: unknown): void {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (same) {
        passed += 1;
        return;
    }
    failures.push(`${name}\n     expected ${JSON.stringify(expected)}\n     actual   ${JSON.stringify(actual)}`);
}

function includes(name: string, haystack: string, needle: string): void {
    if (haystack.includes(needle)) {
        passed += 1;
        return;
    }
    failures.push(`${name}: expected to contain ${JSON.stringify(needle)}\n     got:\n${haystack}`);
}

function excludes(name: string, haystack: string, needle: string): void {
    if (!haystack.includes(needle)) {
        passed += 1;
        return;
    }
    failures.push(`${name}: must NOT contain ${JSON.stringify(needle)}`);
}

// ---------------------------------------------------------------------------
// date-utils
// ---------------------------------------------------------------------------

function testDateUtils(): void {
    ok("todayIso shape", /^\d{4}-\d{2}-\d{2}$/.test(todayIso()), todayIso());

    ok("valid day 2026-10-14", isValidIsoDay("2026-10-14"));
    ok("invalid day 2026-02-31", !isValidIsoDay("2026-02-31"));
    ok("valid leap day 2024-02-29", isValidIsoDay("2024-02-29"));
    ok("invalid non-leap day 2026-02-29", !isValidIsoDay("2026-02-29"));
    ok("rejects non-date text", !isValidIsoDay("tomorrow"));
    ok("rejects undefined", !isValidIsoDay(undefined));

    eq("addDays across month", addDays("2026-01-31", 1), "2026-02-01");
    eq("addDays backwards across month", addDays("2026-03-01", -1), "2026-02-28");
    eq("addDays across year", addDays("2026-12-31", 1), "2027-01-01");
    eq("addDays across leap year", addDays("2024-02-28", 1), "2024-02-29");

    eq("English day heading", formatDayHeading("2026-10-14"), "Wednesday, October 14, 2026");
    eq("English month heading", formatMonthYear(2026, 10), "October 2026");

    eq("weekday headers Monday-first", weekdayHeaders(1),
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    eq("weekday headers Sunday-first", weekdayHeaders(0),
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

    // October 2026 starts on a Thursday.
    const mondayFirst = buildMonthGrid(2026, 10, 1);
    eq("Monday-first grid length", mondayFirst.cells.length, 35);
    eq("Monday-first grid starts on Monday", mondayFirst.cells[0].iso, "2026-09-28");
    eq("Monday-first grid finds the 1st at index 3", mondayFirst.cells[3].iso, "2026-10-01");
    eq("grid rows align with weeks", mondayFirst.rowWeeks.length * 7, mondayFirst.cells.length);
    eq("week number of first row", mondayFirst.rowWeeks[0], 40);
    ok("grid contains the selected day",
        mondayFirst.cells.some(cell => cell.iso === "2026-10-14"));

    const sundayFirst = buildMonthGrid(2026, 10, 0);
    eq("Sunday-first grid starts on Sunday", sundayFirst.cells[0].iso, "2026-09-27");
    eq("Sunday-first grid length", sundayFirst.cells.length, 35);

    // Every generated cell must be a real day (no 2026-10-32 style artefacts).
    ok("every cell is a valid day", mondayFirst.cells.every(cell => isValidIsoDay(cell.iso)));

    eq("ISO week of 2026-01-01", isoWeek("2026-01-01"), 1);
    eq("ISO week of 2026-10-13", isoWeek("2026-10-13"), 42);
    eq("ISO week of 2026-12-31", isoWeek("2026-12-31"), 53);

    // Times ---------------------------------------------------------------
    eq("parse 18:00", parseTimeToMinutes("18:00"), 1080);
    eq("parse 18.30", parseTimeToMinutes("18.30"), 1110);
    eq("parse 9:00", parseTimeToMinutes("9:00"), 540);
    eq("parse 09:05", parseTimeToMinutes("09:05"), 545);
    eq("reject 25:00", parseTimeToMinutes("25:00"), null);
    eq("reject 18:99", parseTimeToMinutes("18:99"), null);
    eq("reject empty", parseTimeToMinutes(""), null);
    eq("reject plain text", parseTimeToMinutes("sometime"), null);

    const range = parseTimeRange("18:00–20:00");
    eq("range start (en dash)", range.start, 1080);
    eq("range end (en dash)", range.end, 1200);

    const hyphen = parseTimeRange("9:00 - 10:30");
    eq("range start (hyphen)", hyphen.start, 540);
    eq("range end (hyphen)", hyphen.end, 630);

    const single = parseTimeRange("18:00");
    eq("single start", single.start, 1080);
    eq("single end is null", single.end, null);

    const nothing = parseTimeRange("");
    eq("empty range start", nothing.start, null);
    eq("empty range end", nothing.end, null);
    eq("empty range text", nothing.text, "");

    const garbage = parseTimeRange("not a time");
    eq("garbage range start", garbage.start, null);
    eq("garbage range keeps raw text", garbage.text, "not a time");

    eq("minutes to label", minutesToLabel(1080), "18:00");
    eq("minutes to label pads", minutesToLabel(545), "09:05");
    eq("range label", formatRange(1080, 1200, ""), "18:00-20:00");
    eq("start only label", formatRange(540, null, ""), "09:00");
    eq("fallback label", formatRange(null, null, "All day"), "All day");
}

// ---------------------------------------------------------------------------
// settings helpers
// ---------------------------------------------------------------------------

function testSettings(): void {
    eq("splitList on commas", splitList("a, b, c"), ["a", "b", "c"]);
    eq("splitList on newlines", splitList("a\nb"), ["a", "b"]);
    eq("splitList mixed", splitList("a, b\n c; d"), ["a", "b", "c", "d"]);
    eq("splitList empty", splitList(""), []);
    eq("splitList undefined", splitList(undefined), []);

    eq("normaliseTag strips hash and lowercases", normaliseTag("#Work"), "work");
    eq("normaliseTag keeps nested tags", normaliseTag("#a/b"), "a/b");

    const events = eventTagSet({
        ...DEFAULT_SETTINGS,
        eventTag: "#Event",
        eventTagAliases: "termin, Sitzung"
    });
    eq("event tag set", [...events].sort(), ["event", "sitzung", "termin"]);

    const todos = todoTagSet({ ...DEFAULT_SETTINGS, todoTag: "todo", todoTagAliases: "aufgabe" });
    eq("todo tag set", [...todos].sort(), ["aufgabe", "todo"]);

    ok("intersects positive", intersects(new Set(["termin"]), events));
    ok("intersects negative", !intersects(new Set(["meeting"]), events));
    ok("intersects with empty wanted", !intersects(new Set(["event"]), new Set()));

    eq("ensureMdExtension adds .md", ensureMdExtension("a/b/Event"), "a/b/Event.md");
    eq("ensureMdExtension keeps .md", ensureMdExtension("a/b/Event.md"), "a/b/Event.md");
    eq("ensureMdExtension empty", ensureMdExtension(""), "");
}

// ---------------------------------------------------------------------------
// frontmatter date / tag resolution
// ---------------------------------------------------------------------------

function testResolveDay(): void {
    eq("ISO string", resolveDay("2026-10-14"), "2026-10-14");
    eq("ISO string with time", resolveDay("2026-10-14T18:00:00"), "2026-10-14");
    eq("German format", resolveDay("14.10.2026"), "2026-10-14");
    eq("slash format", resolveDay("2026/10/14"), "2026-10-14");
    eq("JS Date", resolveDay(new Date(2026, 9, 14)), "2026-10-14");
    eq("null", resolveDay(null), null);
    eq("undefined", resolveDay(undefined), null);
    eq("empty string", resolveDay(""), null);
    eq("plain text", resolveDay("sometime next week"), null);
    eq("impossible date", resolveDay("2026-02-31"), null);
    eq("invalid luxon-like object", resolveDay({ isValid: false }), null);
    eq("luxon-like object", resolveDay({ isValid: true, toFormat: () => "2026-10-14" }), "2026-10-14");
    eq("toISODate object", resolveDay({ toISODate: () => "2026-10-14" }), "2026-10-14");
    eq("epoch milliseconds", resolveDay(Date.UTC(2026, 9, 14, 12, 0, 0)), resolveDay(new Date(Date.UTC(2026, 9, 14, 12, 0, 0))));
    eq("boolean is not a date", resolveDay(true), null);
}

function testTagsInText(): void {
    const tags = tagsInText("Buy milk #work and #Home");
    ok("finds lowercased tag", tags.has("work"), [...tags]);
    ok("finds mixed-case tag", tags.has("home"), [...tags]);
    eq("no tags", [...tagsInText("no tags here")], []);
    eq("tag-free due marker", [...tagsInText("Do it 📅 2026-10-20")], []);
}

function testInlineTasks(): void {
    eq("due marker", dueDateOf("Buy milk 📅 2026-10-20"), "2026-10-20");
    eq("scheduled marker fallback", dueDateOf("Plan trip 🛫 2026-11-01"), "2026-11-01");
    eq("start marker fallback", dueDateOf("Begin 🛫 not-a-date ⏳ 2026-11-05"), "2026-11-05");
    eq("dataview inline field", dueDateOf("Ship it due:: 2026-10-20"), "2026-10-20");
    eq("no date at all", dueDateOf("Just a task"), null);
    eq("malformed date", dueDateOf("📅 2026-99-99"), null);

    eq("cleans date and tags", cleanTaskText("Buy milk 📅 2026-10-20 #home"), "Buy milk");
    eq("keeps plain text", cleanTaskText("Just a normal task"), "Just a normal task");
    eq("collapses whitespace", cleanTaskText("  lots   of   space  "), "lots of space");
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

const SETTINGS = DEFAULT_SETTINGS;

function testTemplates(): void {
    const withFrontmatter = [
        "---",
        "date: ",
        "start: ",
        "end: ",
        "tags:",
        "  - event",
        "---",
        "",
        "# Note",
        "",
        "Body stays untouched."
    ].join("\n");

    const filled = applyTemplate(withFrontmatter, {
        date: "2026-10-14",
        title: "Note",
        tag: "event",
        settings: SETTINGS
    });
    includes("fills empty date", filled, "date: 2026-10-14");
    includes("keeps existing tag", filled, "  - event");
    excludes("does not duplicate the tag", filled, "  - event\n  - event");
    includes("keeps body", filled, "Body stays untouched.");

    const missingTag = applyTemplate(withFrontmatter, {
        date: "2026-10-14",
        title: "Note",
        tag: "termin",
        settings: SETTINGS
    });
    includes("adds configured tag", missingTag, "  - termin");
    includes("keeps original tag too", missingTag, "  - event");

    const templater = [
        "---",
        'date: <% tp.date.now("YYYY-MM-DD") %>',
        "tags:",
        "  - event",
        "---",
        "",
        "<% tp.file.title %>"
    ].join("\n");
    const templaterFilled = applyTemplate(templater, {
        date: "2026-10-14",
        title: "Note",
        tag: "event",
        settings: SETTINGS
    });
    includes("replaces Templater date expression", templaterFilled, "date: 2026-10-14");
    excludes("removes the Templater date expression", templaterFilled, "tp.date.now");
    includes("leaves other Templater expressions alone", templaterFilled, "<% tp.file.title %>");

    const tokenised = [
        "---",
        "date: {{date}}",
        "done: false",
        "tags:",
        "  - todo",
        "---",
        "",
        "# {{title}}"
    ].join("\n");
    const tokenFilled = applyTemplate(tokenised, {
        date: "2026-10-14",
        title: "2026-10-14 Todo",
        tag: "todo",
        settings: SETTINGS
    });
    includes("substitutes {{date}}", tokenFilled, "date: 2026-10-14");
    includes("substitutes {{title}}", tokenFilled, "# 2026-10-14 Todo");

    const noFrontmatter = "# Just a heading\n\nSome text.";
    const wrapped = applyTemplate(noFrontmatter, {
        date: "2026-10-14",
        title: "Note",
        tag: "event",
        settings: SETTINGS
    });
    ok("adds frontmatter to a plain note", wrapped.startsWith("---\ndate: 2026-10-14\n"), wrapped);
    includes("adds the tag to new frontmatter", wrapped, "  - event");
    includes("keeps original content", wrapped, "# Just a heading");

    const inlineTags = ["---", "date: ", "tags: [arbeit]", "---", "", "body"].join("\n");
    const inlineFilled = applyTemplate(inlineTags, {
        date: "2026-10-14",
        title: "Note",
        tag: "event",
        settings: SETTINGS
    });
    includes("extends an inline tag list", inlineFilled, "tags: [arbeit, event]");

    // A template that already has the right date must not be clobbered with a
    // different, non-date value.
    const oddDate = ["---", "date: pinned", "---", "", "body"].join("\n");
    const oddFilled = applyTemplate(oddDate, {
        date: "2026-10-14",
        title: "Note",
        tag: "event",
        settings: SETTINGS
    });
    includes("never overwrites a non-date value", oddFilled, "date: pinned");

    // DataviewJS blocks inside templates must survive byte for byte.
    const withDataview = [
        "---",
        "tags:",
        "  - journal",
        "---",
        "",
        "```dataviewjs",
        'await dv.view("Views/kalender", {})',
        "```"
    ].join("\n");
    const dataviewFilled = applyTemplate(withDataview, {
        date: "2026-10-14",
        title: "Note",
        tag: undefined,
        settings: SETTINGS
    });
    includes("keeps dataviewjs blocks", dataviewFilled, 'await dv.view("Views/kalender", {})');
    includes("adds date without touching tags", dataviewFilled, "date: 2026-10-14");

    // Shipped default templates ---------------------------------------------
    const eventTemplate = defaultTemplateFile("event", SETTINGS);
    includes("event template has date", eventTemplate, "date: {{date}}");
    includes("event template has start", eventTemplate, "start: ");
    includes("event template has end", eventTemplate, "end: ");
    includes("event template has the event tag", eventTemplate, "  - event");

    const todoTemplate = defaultTemplateFile("todo", SETTINGS);
    includes("todo template has done flag", todoTemplate, "done: false");
    includes("todo template has the todo tag", todoTemplate, "  - todo");

    const journalTemplate = defaultTemplateFile("journal", SETTINGS);
    includes("journal template has date", journalTemplate, "date: {{date}}");
    includes("journal template has type", journalTemplate, "type: journal");

    // Property names must follow settings, not hardcode `date` / `done`.
    const customised = defaultTemplateFile("event", {
        ...SETTINGS,
        dateProp: "datum",
        startProp: "von",
        endProp: "bis",
        eventTag: "termin"
    });
    includes("event template uses configured date property", customised, "datum: {{date}}");
    includes("event template uses configured start property", customised, "von: ");
    includes("event template uses configured end property", customised, "bis: ");
    includes("event template uses configured tag", customised, "  - termin");
}

// ---------------------------------------------------------------------------
// timeline layout
// ---------------------------------------------------------------------------

function entry(partial: Partial<CalendarEntry>): CalendarEntry {
    return {
        path: "Note.md",
        title: "Note",
        kind: "event",
        date: "2026-10-14",
        start: null,
        end: null,
        timeText: "",
        completed: false,
        source: "note",
        line: null,
        text: null,
        ...partial
    };
}

function testLayout(): void {
    eq("empty layout", layout([]), []);

    const apart = layout([
        entry({ start: 540, end: 600, title: "A" }),
        entry({ start: 660, end: 720, title: "B" })
    ]);
    eq("non-overlapping entries share one column", apart.map(item => item.column), [0, 0]);
    eq("non-overlapping entries need one column", apart.map(item => item.columns), [1, 1]);

    const overlap = layout([
        entry({ start: 540, end: 660, title: "A" }),
        entry({ start: 600, end: 720, title: "B" })
    ]);
    eq("overlapping entries get different columns", overlap[0].column !== overlap[1].column, true);
    eq("overlapping entries split the width", overlap.map(item => item.columns), [2, 2]);

    // A later, unrelated pair must not inherit the earlier cluster's width.
    const mixed = layout([
        entry({ start: 540, end: 660, title: "A" }),
        entry({ start: 600, end: 720, title: "B" }),
        entry({ start: 900, end: 960, title: "C" })
    ]);
    const lone = mixed.find(item => item.entry.title === "C");
    ok("separate cluster stays full width", lone !== undefined && lone.columns === 1, mixed.map(i => [i.entry.title, i.columns]));

    const noEnd = layout([entry({ start: 540, end: null, title: "A" })]);
    eq("missing end gets a default span", noEnd[0].end, 570);

    const noStart = layout([entry({ start: null, end: null, title: "A" })]);
    eq("missing start is treated as midnight", noStart[0].start, 0);

    const outOfRange = layout([entry({ start: 3000, end: 4000, title: "A" })]);
    ok("out-of-range time is clamped into the day",
        outOfRange[0].start < 1440 && outOfRange[0].end <= 1440 && outOfRange[0].end > outOfRange[0].start,
        outOfRange[0]);

    const sorted = layout([
        entry({ start: 720, end: 780, title: "Later" }),
        entry({ start: 540, end: 600, title: "Earlier" })
    ]);
    eq("layout is sorted by start time",
        sorted.map(item => item.entry.title), ["Earlier", "Later"]);
}

// ---------------------------------------------------------------------------

testDateUtils();
testSettings();
testResolveDay();
testTagsInText();
testInlineTasks();
testTemplates();
testLayout();

if (failures.length > 0) {
    console.error(`\n${failures.length} test(s) FAILED:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(`\n${passed} passed, ${failures.length} failed.`);
    process.exitCode = 1;
} else {
    console.log(`All ${passed} tests passed.`);
}
