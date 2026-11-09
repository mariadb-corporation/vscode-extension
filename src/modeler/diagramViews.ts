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
 * diagram changes no file. A diagram opens again as it was left.
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
        && [view.zoom, view.x, view.y, view.tilt, view.turn].every((number) => {
            return typeof number === "number" && Number.isFinite(number);
        })
        && (view.mode === "2d" || view.mode === "iso")
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

    #all(): KeptViews {
        const all = this.memento.get<unknown>(DIAGRAM_VIEWS_KEY, {});

        return typeof all === "object" && all !== null ? all as KeptViews : {};
    }
}
