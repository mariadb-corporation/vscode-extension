/*
 * Copyright (c) 2026, MariaDB plc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License, version 2.0,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See
 * the GNU General Public License, version 2.0, for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA
 */

/**
 * How each diagram was last looked at - zoom, place, projection - kept by
 * VS Code in the workspace's state, not in the diagrams: looking at a
 * diagram changes no file. A diagram opens again as it was left. The
 * views of diagrams that are gone (deleted or renamed in msm, a connection
 * deleted, a project taken off the list) are dropped, so the state does
 * not grow and a new diagram of an old name opens fitted.
 */

import type { IFolderMemento } from "../tree/customFolders.js";
import type { IDiagramView } from "./modelerProtocol.js";

/** The workspace state's key: the sources' diagrams' views, by source. */
export const DIAGRAM_VIEWS_KEY = "mariadb.diagramViews";

/** Each source's diagrams' views, by diagram name. */
type KeptViews = Record<string, Record<string, IDiagramView>>;

/**
 * @param value Something kept, perhaps by an older version.
 *
 * @returns Whether it is a view.
 */
const isView = (value: unknown): value is IDiagramView => {
    const view = value as Partial<IDiagramView> | null;

    return typeof view === "object" && view !== null
        && [view.zoom, view.x, view.y, view.tilt, view.turn,
            view.height ?? 0].every((number) => {
            return typeof number === "number" && Number.isFinite(number);
        })
        && (view.mode === "2d" || view.mode === "iso"
            || view.mode === "front")
        && typeof view.isoPreset === "string";
};

export class DiagramViews {
    public constructor(private readonly memento: IFolderMemento) { }

    /**
     * @param source A model source's key (a project, a live schema).
     *
     * @returns How its diagrams were last looked at, by name.
     */
    public of(source: string): Record<string, IDiagramView> {
        const kept = this.#all()[source] ?? {};

        return Object.fromEntries(Object.entries(kept).filter(([, view]) => {
            return isView(view);
        }));
    }

    /**
     * Keeps how a diagram is looked at now. What is read back is checked
     * then, as an older version may have kept it.
     *
     * @param source Its model source's key.
     * @param diagram Its name.
     * @param view The view.
     *
     * @returns Once it is kept.
     */
    public async keep(source: string, diagram: string,
        view: IDiagramView): Promise<void> {
        const all = this.#all();
        await this.memento.update(DIAGRAM_VIEWS_KEY, {
            ...all,
            [source]: { ...all[source], [diagram]: view },
        });
    }

    /**
     * Drops the views of a source's diagrams it no longer has: called with
     * its diagrams each time its model is read, which is where a diagram
     * deleted or renamed outside the extension shows.
     *
     * @param source The model source's key.
     * @param diagrams The names of the diagrams it has.
     *
     * @returns Once they are dropped.
     */
    public async prune(source: string,
        diagrams: readonly string[]): Promise<void> {
        const names = new Set(diagrams);
        await this.#change(source, (kept) => {
            return Object.fromEntries(Object.entries(kept).filter(([name]) => {
                return names.has(name);
            }));
        });
    }

    /**
     * Drops one diagram's view: a new diagram that takes a name opens
     * fitted, not as an old one of that name was left.
     *
     * @param source The model source's key.
     * @param diagram The diagram's name.
     *
     * @returns Once it is dropped.
     */
    public async forget(source: string, diagram: string): Promise<void> {
        await this.#change(source, ({ [diagram]: _gone, ...left }) => {
            return left;
        });
    }

    /**
     * Moves a diagram's view to its new name: a renamed diagram opens as
     * it was left, and without one, fitted (not as an old diagram of the
     * new name was left).
     *
     * @param source The model source's key.
     * @param from The diagram's old name.
     * @param to Its new name.
     *
     * @returns Once it is moved.
     */
    public async rename(source: string, from: string,
        to: string): Promise<void> {
        await this.#change(source, (kept) => {
            const { [from]: view, [to]: _stale, ...others } = kept;

            return view === undefined ? others : { ...others, [to]: view };
        });
    }

    /**
     * Moves a source's views to another key: its project folder moved.
     *
     * @param from The source's key before.
     * @param to Its key now.
     *
     * @returns Once kept.
     */
    public async moveSource(from: string, to: string): Promise<void> {
        const all = this.#all();
        const { [from]: kept, ...others } = all;
        if (kept !== undefined && from !== to) {
            await this.memento.update(DIAGRAM_VIEWS_KEY,
                { ...others, [to]: kept });
        }
    }

    /**
     * Drops the views of whole sources: a connection deleted, a project
     * taken off the list.
     *
     * @param match Whether a source's key is one to drop.
     *
     * @returns Once they are dropped.
     */
    public async forgetSources(match: (source: string) => boolean):
        Promise<void> {
        const all = this.#all();
        const left = Object.fromEntries(Object.entries(all).filter(([key]) => {
            return !match(key);
        }));
        if (Object.keys(left).length !== Object.keys(all).length) {
            await this.memento.update(DIAGRAM_VIEWS_KEY, left);
        }
    }

    /**
     * Changes a source's views, writing only where they changed; a source
     * left with none goes.
     *
     * @param source The model source's key.
     * @param change Its views as they are to be, from the ones it has.
     *
     * @returns Once they are written.
     */
    async #change(source: string,
        change: (kept: Record<string, IDiagramView>) =>
            Record<string, IDiagramView>): Promise<void> {
        const all = this.#all();
        const kept = all[source];
        if (kept === undefined) {
            return;
        }
        const left = change(kept);
        if (JSON.stringify(left) === JSON.stringify(kept)) {
            return;
        }
        const { [source]: _gone, ...others } = all;
        await this.memento.update(DIAGRAM_VIEWS_KEY,
            Object.keys(left).length === 0
                ? others : { ...others, [source]: left });
    }

    #all(): KeptViews {
        const all = this.memento.get<unknown>(DIAGRAM_VIEWS_KEY, {});

        return typeof all === "object" && all !== null ? all as KeptViews : {};
    }
}
