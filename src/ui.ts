/**
 * ui.ts
 *
 * Tiny DOM helpers shared by the three views. Everything is created with
 * `textContent` rather than `innerHTML`, so note titles and task text can
 * never inject markup into the dashboard.
 */

import { App } from "obsidian";
import { ensureMdExtension } from "./settings";

type TagName = keyof HTMLElementTagNameMap;

export function el<K extends TagName>(
    tag: K,
    className?: string | null,
    text?: string | number | null
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

export function clear(node: Node): void {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/** Small unobtrusive button, mirroring `.nd-knopf-klein` from the snippet. */
export function button(
    label: string,
    className: string,
    onClick: (event: MouseEvent) => void,
    title?: string
): HTMLButtonElement {
    const node = el("button", className, label);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
    });
    return node;
}

/**
 * Internal link that opens through the workspace API. Uses Obsidian's own
 * `internal-link` class so hover previews, Ctrl-hover and the active theme
 * keep working exactly as they do for normal wiki links.
 */
export function internalLink(app: App, path: string, text: string, className?: string): HTMLAnchorElement {
    const target = ensureMdExtension(path);
    const anchor = el("a", `internal-link ${className ?? ""}`.trim());
    anchor.textContent = text;
    anchor.href = target;
    anchor.setAttribute("data-href", target);
    anchor.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void app.workspace.openLinkText(target, "", false);
    });
    return anchor;
}

/** `3` -> `Events` / `Event` style counters used in group headers. */
export function plural(count: number, singular: string, pluralWord?: string): string {
    return count === 1 ? singular : (pluralWord ?? `${singular}s`);
}

export function emptyState(text: string): HTMLElement {
    return el("div", "cs-empty", text);
}

export function badge(count: number, accent = false): HTMLElement {
    return el("span", `cs-badge${accent ? " cs-badge--accent" : ""}`, String(count));
}

export function groupHeader(title: string, count?: number, accent = false): HTMLElement {
    const head = el("div", "cs-group-head");
    head.appendChild(el("span", "cs-group-title", title));
    if (count !== undefined) head.appendChild(badge(count, accent && count > 0));
    return head;
}

/** Segmented control used for the Timeline / List toggle. */
export function segmented<T extends string>(
    options: Array<{ value: T; label: string; title?: string }>,
    active: T,
    onChange: (value: T) => void
): HTMLElement {
    const node = el("div", "cs-seg");
    node.setAttribute("role", "group");
    for (const option of options) {
        const item = button(
            option.label,
            `cs-seg-item${option.value === active ? " is-active" : ""}`,
            () => onChange(option.value),
            option.title
        );
        item.setAttribute("aria-pressed", String(option.value === active));
        node.appendChild(item);
    }
    return node;
}

/** Small count chip used in the Day Overview header. */
export function statChip(label: string, value: number, accent = false): HTMLElement {
    const chip = el("span", "cs-chip");
    chip.appendChild(el("b", null, String(value)));
    chip.appendChild(document.createTextNode(` ${label}`));
    if (accent && value > 0) chip.classList.add("cs-chip--accent");
    return chip;
}
