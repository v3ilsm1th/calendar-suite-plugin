/**
 * state.ts
 *
 * Two small pieces of infrastructure shared by every view:
 *
 * 1. `DateStore` – the single selected-date state. All three views subscribe
 *    to it, so clicking a day in the Month Calendar updates the Day Overview
 *    and the Day Timeline immediately. The store survives Dataview re-runs and
 *    code-block re-renders because it lives on the plugin instance, not in the
 *    DOM.
 *
 * 2. A render-binding registry – every `render()` call registers a teardown
 *    function against the container it drew into. Rendering into a container
 *    twice tears down the previous binding first, and detached containers are
 *    swept, so repeated Dataview refreshes cannot leak listeners or intervals.
 */

export type Unsubscribe = () => void;

export class DateStore {
    private date: string;
    private readonly listeners = new Set<() => void>();
    /** Called after the date changes, used to bridge to the dashboard views. */
    private readonly afterChange: (iso: string) => void;

    constructor(initial: string, afterChange: (iso: string) => void = () => { /* noop */ }) {
        this.date = initial;
        this.afterChange = afterChange;
    }

    getDate(): string {
        return this.date;
    }

    setDate(next: string): boolean {
        if (next === this.date) return false;
        this.date = next;
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.error("Calendar Suite: date listener failed", err);
            }
        }
        try {
            this.afterChange(next);
        } catch (err) {
            console.error("Calendar Suite: date bridge failed", err);
        }
        return true;
    }

    subscribe(listener: () => void): Unsubscribe {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    clear(): void {
        this.listeners.clear();
    }
}

interface Binding {
    element: HTMLElement;
    destroy: () => void;
}

const bindings = new Map<HTMLElement, Binding>();

/**
 * Registers `destroy` for `element`, replacing any previous binding and
 * sweeping out bindings whose element has been removed from the document.
 */
export function bind(element: HTMLElement, destroy: () => void): void {
    const previous = bindings.get(element);
    if (previous) {
        try {
            previous.destroy();
        } catch (err) {
            console.error("Calendar Suite: teardown failed", err);
        }
    }

    for (const [key, binding] of bindings) {
        if (key === element || key.isConnected) continue;
        try {
            binding.destroy();
        } catch (err) {
            console.error("Calendar Suite: stale teardown failed", err);
        }
        bindings.delete(key);
    }

    bindings.set(element, { element, destroy });
}

/** Tears down every live binding. Called from `Plugin.onunload`. */
export function destroyAllBindings(): void {
    for (const binding of bindings.values()) {
        try {
            binding.destroy();
        } catch (err) {
            console.error("Calendar Suite: unload teardown failed", err);
        }
    }
    bindings.clear();
}

export function activeBindingCount(): number {
    return bindings.size;
}
