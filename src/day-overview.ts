/**
 * day-overview.ts
 *
 * The Day Card: everything scheduled for the shared selected date, plus the
 * three quick-create actions. It re-renders whenever the selected date or the
 * vault index changes, so it always mirrors the Month Calendar.
 */

import { ViewEnv } from "./env";
import { formatDayHeading, todayIso, formatRange } from "./date-utils";
import { CalendarEntry } from "./types";
import { toggleInlineTask, toggleNoteCompletion } from "./note-utils";
import { bind } from "./state";
import { button, clear, el, emptyState, groupHeader, internalLink, plural, statChip } from "./ui";

export function mountDayOverview(container: HTMLElement, env: ViewEnv): () => void {
    let unsubscribeDate: (() => void) | null = null;
    let unsubscribeIndex: (() => void) | null = null;

    const render = (): void => {
        clear(container);
        container.appendChild(buildCard(env));
    };

    // Register the teardown first: it runs the *previous* binding's cleanup
    // (which empties this container) before the new DOM is built.
    const destroy = (): void => {
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

function buildCard(env: ViewEnv): HTMLElement {
    const settings = env.settings();
    const iso = env.store.getDate();
    const today = todayIso();
    const isToday = iso === today;

    const day = env.index.getDay(iso);
    const events = day.events;
    const todos = day.todos.filter(todo => settings.showCompleted || !todo.completed);
    const doneCount = day.todos.filter(todo => todo.completed).length;

    const card = el("div", `cs-card cs-day${settings.compactMode ? " is-compact" : ""}`);

    // --- Header ------------------------------------------------------------
    const head = el("div", "cs-day-head");

    const headingBlock = el("div", "cs-day-heading-block");
    headingBlock.appendChild(el("div", "cs-eyebrow", "Selected date"));
    headingBlock.appendChild(el("div", "cs-day-heading", formatDayHeading(iso)));
    if (isToday) headingBlock.appendChild(el("span", "cs-pill cs-pill--today", "Today"));
    head.appendChild(headingBlock);

    const actions = el("div", "cs-actions");
    actions.appendChild(button("New event", "cs-btn cs-btn--sm", () => void env.createFor("event", iso), `New event on ${formatDayHeading(iso)}`));
    actions.appendChild(button("New todo", "cs-btn cs-btn--sm", () => void env.createFor("todo", iso), `New todo on ${formatDayHeading(iso)}`));

    const journalExists = env.hasJournal(iso);
    actions.appendChild(button(
        journalExists ? "Open journal entry" : "New journal entry",
        `cs-btn cs-btn--sm${journalExists ? "" : " cs-btn--accent"}`,
        () => void env.openJournal(iso),
        journalExists ? "Open the journal entry for this day" : "Create a journal entry for this day"
    ));
    head.appendChild(actions);

    card.appendChild(head);

    // --- Counters ----------------------------------------------------------
    const chips = el("div", "cs-chips");
    chips.appendChild(statChip(plural(events.length, "event"), events.length, true));
    chips.appendChild(statChip(plural(todos.length, "todo"), todos.length, true));
    if (doneCount > 0) chips.appendChild(statChip("done", doneCount));
    card.appendChild(chips);

    // --- Events ------------------------------------------------------------
    const eventGroup = el("div", "cs-group");
    eventGroup.appendChild(groupHeader("Events", events.length));
    if (events.length === 0) {
        eventGroup.appendChild(emptyState("No events"));
    } else {
        const list = el("div", "cs-list");
        for (const entry of events) list.appendChild(eventRow(env, entry));
        eventGroup.appendChild(list);
    }
    card.appendChild(eventGroup);

    // --- Todos -------------------------------------------------------------
    const todoGroup = el("div", "cs-group");
    todoGroup.appendChild(groupHeader("Todos", todos.length));
    if (todos.length === 0) {
        todoGroup.appendChild(emptyState("No todos"));
    } else {
        const list = el("div", "cs-list");
        for (const entry of todos) list.appendChild(todoRow(env, entry, iso));
        todoGroup.appendChild(list);
    }
    card.appendChild(todoGroup);

    return card;
}

function eventRow(env: ViewEnv, entry: CalendarEntry): HTMLElement {
    const row = el("div", "cs-row cs-row--event");

    const time = el("span", "cs-row-time", entry.timeText || (entry.start !== null ? formatRange(entry.start, entry.end, "") : "All day"));
    row.appendChild(time);

    const link = internalLink(env.app, entry.path, entry.title, "cs-row-title");
    link.title = entry.path;
    row.appendChild(link);

    row.addEventListener("click", event => {
        if (event.target instanceof HTMLAnchorElement) return;
        void env.open(entry.path, entry.line);
    });
    row.tabIndex = 0;
    row.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            void env.open(entry.path, entry.line);
        }
    });
    return row;
}

function todoRow(env: ViewEnv, entry: CalendarEntry, iso: string): HTMLElement {
    const settings = env.settings();
    const row = el("div", `cs-todo${entry.completed ? " is-done" : ""}`);

    const check = el("input", "cs-todo-check") as HTMLInputElement;
    check.type = "checkbox";
    check.checked = entry.completed;
    check.setAttribute("aria-label", entry.completed ? "Mark as not done" : "Mark as done");
    check.addEventListener("change", async () => {
        const next = check.checked;
        check.disabled = true;
        const ok = entry.source === "inline"
            ? await toggleInlineTask(env.app, entry.path, entry.line, next)
            : await toggleNoteCompletion(env.app, settings, entry.path, next);

        if (ok) {
            check.disabled = false;
            env.index.invalidate();
        } else {
            check.checked = !next;
            check.disabled = false;
        }
    });
    row.appendChild(check);

    const body = el("div", "cs-todo-body");
    const text = el("div", "cs-todo-text", entry.title);
    if (entry.completed) text.classList.add("is-done");
    body.appendChild(text);

    const source = internalLink(env.app, entry.path, sourceLabel(entry), "cs-todo-source");
    source.title = entry.path;
    body.appendChild(source);
    row.appendChild(body);

    // Keep the checkbox from firing the row-level navigation.
    row.addEventListener("click", event => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.target instanceof HTMLAnchorElement) return;
        void env.open(entry.path, entry.line);
    });
    void iso;
    return row;
}

function sourceLabel(entry: CalendarEntry): string {
    const withoutExt = entry.path.replace(/\.md$/, "");
    const parts = withoutExt.split("/");
    const base = parts[parts.length - 1];
    if (parts.length > 1) return `${parts[parts.length - 2]}/${base}`;
    return base;
}
