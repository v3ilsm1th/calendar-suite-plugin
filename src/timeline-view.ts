/**
 * timeline-view.ts
 *
 * Day timeline for the shared selected date, with a compact List alternative.
 *
 * Events that carry a start (and optionally an end) time are positioned on a
 * 24 hour axis; everything else sits in the "All day / Unscheduled" section
 * above it, so a missing time never hides an entry.
 */

import { ViewEnv } from "./env";
import { addDays, formatRange, formatShortDay, minutesToLabel, todayIso, weekdayLong } from "./date-utils";
import { CalendarEntry, TimelineMode } from "./types";
import { bind } from "./state";
import { button, clear, el, emptyState, groupHeader, internalLink, segmented, statChip } from "./ui";

const HOUR_ROWS = 24;
const MIN_BLOCK_MINUTES = 30;

interface Positioned {
    entry: CalendarEntry;
    start: number;
    end: number;
    column: number;
    columns: number;
    cluster: number;
}

export type { Positioned };

export function mountTimeline(container: HTMLElement, env: ViewEnv): () => void {
    let mode: TimelineMode = "timeline";
    let unsubscribeDate: (() => void) | null = null;
    let unsubscribeIndex: (() => void) | null = null;
    let timer: number | null = null;

    const stopTimer = (): void => {
        if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
        }
    };

    const render = (): void => {
        stopTimer();
        clear(container);
        container.appendChild(buildCard(env, mode, next => {
            mode = next;
            render();
        }));
        if (todayIso() === env.store.getDate()) {
            // Keeps the "now" marker and the dimmed past hours honest without
            // rebuilding the whole card every minute.
            timer = window.setInterval(() => refreshNowMarker(container), 60_000);
        }
    };

    // Register the teardown first: it runs the *previous* binding's cleanup
    // (which empties this container) before the new DOM is built.
    const destroy = (): void => {
        stopTimer();
        unsubscribeDate?.();
        unsubscribeIndex?.();
        unsubscribeDate = null;
        unsubscribeIndex = null;
        clear(container);
    };
    bind(container, destroy);

    render();

    unsubscribeDate = env.store.subscribe(render);
    unsubscribeIndex = env.index.subscribe(render);

    return destroy;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function buildCard(env: ViewEnv, mode: TimelineMode, onModeChange: (mode: TimelineMode) => void): HTMLElement {
    const settings = env.settings();
    const iso = env.store.getDate();
    const today = todayIso();
    const isToday = iso === today;

    const day = env.index.getDay(iso);
    const entries = [
        ...day.events,
        ...day.todos.filter(todo => settings.showCompleted || !todo.completed)
    ];

    const timed = entries
        .filter(entry => entry.start !== null)
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.title.localeCompare(b.title, "en"));

    const untimed = entries
        .filter(entry => entry.start === null)
        .sort((a, b) => Number(a.kind > b.kind) - Number(b.kind > a.kind) || a.title.localeCompare(b.title, "en"));

    const card = el("div", `cs-card cs-tl${settings.compactMode ? " is-compact" : ""}`);

    // --- Header: day navigation + view toggle -------------------------------
    const head = el("div", "cs-tl-head");

    const nav = el("div", "cs-tl-nav");
    nav.appendChild(button("‹", "cs-icon-btn", () => env.store.setDate(addDays(iso, -1)), "Previous day"));

    const label = el("div", "cs-tl-date");
    label.appendChild(el("span", null, formatShortDay(iso)));
    label.appendChild(el("span", "cs-tl-weekday", weekdayLong(iso)));
    if (isToday) label.appendChild(el("span", "cs-pill cs-pill--today", "Today"));
    nav.appendChild(label);

    if (!isToday) {
        nav.appendChild(button("Today", "cs-btn cs-btn--sm", () => env.store.setDate(today), "Back to today"));
    }
    nav.appendChild(button("›", "cs-icon-btn", () => env.store.setDate(addDays(iso, 1)), "Next day"));
    head.appendChild(nav);

    head.appendChild(segmented<TimelineMode>([
        { value: "timeline", label: "Timeline", title: "Timeline view" },
        { value: "list", label: "List", title: "List view" }
    ], mode, onModeChange));

    card.appendChild(head);

    // --- Counters + quick create -------------------------------------------
    const bar = el("div", "cs-tl-bar");
    const chips = el("div", "cs-chips cs-chips--tight");
    chips.appendChild(statChip("events", day.events.length, true));
    chips.appendChild(statChip("todos", day.todos.filter(t => settings.showCompleted || !t.completed).length, true));
    bar.appendChild(chips);

    const actions = el("div", "cs-actions");
    actions.appendChild(button("New event", "cs-btn cs-btn--sm", () => void env.createFor("event", iso), "New event on this day"));
    actions.appendChild(button("New todo", "cs-btn cs-btn--sm", () => void env.createFor("todo", iso), "New todo on this day"));
    bar.appendChild(actions);
    card.appendChild(bar);

    // --- Nothing at all -----------------------------------------------------
    if (entries.length === 0) {
        const empty = el("div", "cs-tl-nothing");
        empty.appendChild(emptyState("No events"));
        empty.appendChild(emptyState("No todos"));
        card.appendChild(empty);
        return card;
    }

    // --- All day / Unscheduled ---------------------------------------------
    if (untimed.length > 0) {
        const section = el("div", "cs-tl-allday");
        section.appendChild(el("div", "cs-section-label", "All day / Unscheduled"));
        const list = el("div", "cs-list");
        for (const entry of untimed) list.appendChild(simpleRow(env, entry));
        section.appendChild(list);
        card.appendChild(section);
    }

    // --- Body ---------------------------------------------------------------
    if (mode === "list") {
        card.appendChild(buildList(env, timed, untimed));
    } else {
        card.appendChild(buildAxis(env, timed, isToday));
    }

    return card;
}

// ---------------------------------------------------------------------------
// Timeline axis
// ---------------------------------------------------------------------------

function buildAxis(env: ViewEnv, timed: CalendarEntry[], isToday: boolean): HTMLElement {
    const wrapper = el("div", "cs-tl-axis");
    const grid = el("div", "cs-tl-grid");
    grid.style.setProperty("--cs-hour-count", String(HOUR_ROWS));

    const nowHour = new Date().getHours();

    for (let hour = 0; hour < HOUR_ROWS; hour++) {
        const row = el("div", "cs-tl-hour");
        row.dataset.hour = String(hour);
        if (isToday && hour < nowHour) row.classList.add("is-past");
        if (isToday && hour === nowHour) row.classList.add("is-now");

        row.appendChild(el("span", "cs-tl-hour-label", `${String(hour).padStart(2, "0")}:00`));

        const slot = el("div", "cs-tl-hour-slot");
        if (isToday && hour === nowHour) {
            slot.appendChild(el("span", "cs-now-chip", `now ${minutesToLabel(new Date().getHours() * 60 + new Date().getMinutes())}`));
        }
        row.appendChild(slot);
        grid.appendChild(row);
    }

    const layer = el("div", "cs-tl-layer");
    layer.style.setProperty("--cs-hour-count", String(HOUR_ROWS));

    for (const item of layout(timed)) {
        layer.appendChild(buildBlock(env, item));
    }
    grid.appendChild(layer);

    wrapper.appendChild(grid);
    return wrapper;
}

/**
 * Greedy column packing so overlapping entries sit side by side.
 *
 * Entries are grouped into *clusters* (maximal runs that overlap transitively);
 * each cluster gets as many columns as it actually needs, so unrelated events
 * later in the day still get the full width.
 */
export function layout(entries: CalendarEntry[]): Positioned[] {
    const items: Positioned[] = entries.map(entry => {
        const rawStart = entry.start ?? 0;
        const rawEnd = entry.end !== null && entry.end > rawStart ? entry.end : rawStart + MIN_BLOCK_MINUTES;
        // Clamp the start into the day first, then keep the end inside the day
        // and always at least one block tall (an event that starts at/after
        // midnight still needs to be visible).
        const start = Math.max(0, Math.min(1440 - MIN_BLOCK_MINUTES, rawStart));
        const end = Math.max(start + MIN_BLOCK_MINUTES, Math.min(1440, rawEnd));
        return {
            entry,
            start,
            end,
            column: 0,
            columns: 1,
            cluster: 0
        };
    });

    items.sort((a, b) => a.start - b.start || b.end - a.end);
    if (items.length === 0) return items;

    const columnEnds: number[] = [];
    const clusterColumns: number[] = [];
    let cluster = -1;
    let clusterEnd = -1;

    for (const item of items) {
        if (item.start >= clusterEnd) {
            cluster += 1;
            clusterEnd = item.end;
            columnEnds.length = 0;
        } else {
            clusterEnd = Math.max(clusterEnd, item.end);
        }
        item.cluster = cluster;

        let column = columnEnds.findIndex(end => end <= item.start);
        if (column === -1) {
            column = columnEnds.length;
            columnEnds.push(item.end);
        } else {
            columnEnds[column] = item.end;
        }

        item.column = column;
        clusterColumns[cluster] = Math.max(clusterColumns[cluster] ?? 0, columnEnds.length);
    }

    for (const item of items) {
        item.columns = clusterColumns[item.cluster] ?? 1;
    }

    return items;
}

function buildBlock(env: ViewEnv, item: Positioned): HTMLElement {
    const block = el("div", `cs-block cs-block--${item.entry.kind}`);

    // Positioned against the hour axis: top/height come from the CSS hour
    // height so compact mode only has to change one variable.
    const columns = Math.max(1, item.columns);
    block.style.top = `calc(var(--cs-hour-h) * ${item.start / 60})`;
    block.style.height = `calc(var(--cs-hour-h) * ${Math.max(item.end - item.start, MIN_BLOCK_MINUTES) / 60})`;
    block.style.left = `${(item.column / columns) * 100}%`;
    block.style.width = `calc(${100 / columns}% - 4px)`;

    const time = item.entry.end !== null && item.entry.end > item.start
        ? `${minutesToLabel(item.start)}-${minutesToLabel(item.end)}`
        : (item.entry.timeText || minutesToLabel(item.start));

    block.appendChild(el("span", "cs-block-time", time));
    block.appendChild(el("span", "cs-block-title", item.entry.title));

    block.title = `${item.entry.title} · ${time} · ${item.entry.path}`;
    block.tabIndex = 0;
    block.addEventListener("click", () => void env.open(item.entry.path, item.entry.line));
    block.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void env.open(item.entry.path, item.entry.line);
        }
    });
    return block;
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

function buildList(env: ViewEnv, timed: CalendarEntry[], untimed: CalendarEntry[]): HTMLElement {
    const list = el("div", "cs-tl-list");

    const all = [
        ...untimed,
        ...timed
    ].sort((a, b) => {
        const aKey = a.start ?? Number.MAX_SAFE_INTEGER;
        const bKey = b.start ?? Number.MAX_SAFE_INTEGER;
        if (aKey !== bKey) return aKey - bKey;
        return a.title.localeCompare(b.title, "en");
    });

    const body = el("div", "cs-list");
    for (const entry of all) body.appendChild(simpleRow(env, entry));
    list.appendChild(body);
    return list;
}

// ---------------------------------------------------------------------------
// Shared rows
// ---------------------------------------------------------------------------

function simpleRow(env: ViewEnv, entry: CalendarEntry): HTMLElement {
    const row = el("div", `cs-row cs-row--${entry.kind}`);

    const time = entry.start !== null
        ? formatRange(entry.start, entry.end, "")
        : (entry.timeText || "All day");
    row.appendChild(el("span", "cs-row-time", time || "All day"));

    const link = internalLink(env.app, entry.path, entry.title, "cs-row-title");
    link.title = entry.path;
    row.appendChild(link);

    row.tabIndex = 0;
    row.addEventListener("click", event => {
        if (event.target instanceof HTMLAnchorElement) return;
        void env.open(entry.path, entry.line);
    });
    row.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            void env.open(entry.path, entry.line);
        }
    });
    return row;
}

// ---------------------------------------------------------------------------
// Live "now" marker
// ---------------------------------------------------------------------------

function refreshNowMarker(container: HTMLElement): void {
    const now = new Date();
    const hour = now.getHours();

    container.querySelectorAll<HTMLElement>(".cs-tl-hour").forEach(node => {
        const value = Number(node.dataset.hour);
        node.classList.toggle("is-past", value < hour);
        node.classList.toggle("is-now", value === hour);
    });

    const chip = container.querySelector(".cs-now-chip");
    if (chip) {
        chip.textContent = `now ${minutesToLabel(hour * 60 + now.getMinutes())}`;
    } else {
        const slot = container.querySelector(`.cs-tl-hour[data-hour="${hour}"] .cs-tl-hour-slot`);
        if (slot) {
            const fresh = el("span", "cs-now-chip", `now ${minutesToLabel(hour * 60 + now.getMinutes())}`);
            slot.insertBefore(fresh, slot.firstChild);
        }
    }
}

/** Re-exported so the dashboard composer can reuse group headers. */
export { groupHeader };
