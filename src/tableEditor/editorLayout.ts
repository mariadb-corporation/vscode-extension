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
 * Where in the editor area's grid a table editor goes: below the active
 * group, splitting it only where it is not split top and bottom already,
 * so opening one editor after another does not nest split in split.
 */

/**
 * The editor area's grid, as `vscode.getEditorLayout` answers it: a
 * branch lays its groups side by side (orientation 0) or one above the
 * other (1), the orientation turning at each level down; a group with no
 * `groups` is an editor group.
 */
export interface IEditorLayout {
    orientation: number;
    groups: IEditorLayoutGroup[];
}

/** A group of the grid: an editor group, or a branch of them. */
export interface IEditorLayoutGroup {
    groups?: IEditorLayoutGroup[];
    size?: number;
}

/** The orientation of a branch whose groups are one above the other. */
const STACKED = 1;

/**
 * Where the editor goes, below the active group:
 * - `{ column }`: the group below it, the one of that view column;
 * - `"active"`: the active group, the lowest of its stack already;
 * - `"split"`: a new group below it, where it has none above or below.
 */
export type BelowActive = { column: number } | "active" | "split";

/**
 * @param group A group of the grid.
 *
 * @returns How many editor groups it holds.
 */
const leaves = (group: IEditorLayoutGroup): number => {
    return group.groups === undefined || group.groups.length === 0
        ? 1
        : group.groups.reduce((sum, child) => { return sum + leaves(child); }, 0);
};

/**
 * @param layout The editor area's grid.
 * @param activeColumn The active group's view column. View columns count
 *                     the editor groups in the grid's order, from 1.
 *
 * @returns Where an editor below the active group goes.
 */
export const belowActive = (layout: IEditorLayout,
    activeColumn: number): BelowActive => {
    // Walks the grid, counting the editor groups before each branch.
    const find = (groups: IEditorLayoutGroup[], orientation: number,
        first: number): BelowActive | undefined => {
        let column = first;
        for (const [index, group] of groups.entries()) {
            const count = leaves(group);
            if (activeColumn >= column && activeColumn < column + count) {
                if (count > 1) {
                    return find(group.groups!, 1 - orientation, column);
                }
                if (orientation !== STACKED) {
                    return "split";
                }

                return index === groups.length - 1
                    ? "active" : { column: column + 1 };
            }
            column += count;
        }

        return undefined;
    };

    return find(layout.groups, layout.orientation, 1) ?? "split";
};
