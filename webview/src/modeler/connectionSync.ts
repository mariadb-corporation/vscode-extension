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

import {
    figureType,
    TABLE_FIGURE,
    type IModelConnection,
    type IModelDiagram,
    type IModelFigure,
    type IOutlineForeignKey,
    type IOutlineTable,
} from "../../../src/modeler/modelFormat.js";
import { sameName } from "./catalog.js";
import { tableOf } from "./tableCard.js";

/**
 * A diagram's relationship lines follow the foreign keys the tables
 * shown define, not the keys' names: a key dropped and added again under
 * another name (as the table editor does with a key it changed), or
 * renamed in the SQL, keeps its line and the line's settings (its middle
 * segment, split, visibility). The stored connections only carry those
 * settings, and are matched to the keys here. Pure, so it can be tested
 * without WebGL.
 *
 * The rule, agreed with msm's `reconcile_diagram`:
 * 1. A connection belongs to its start figure's table (the child, which
 *    holds the key) and its end figure's table (the parent).
 * 2. It is the child's key of its name, case-insensitive, where that key
 *    references the parent; else a key of the child referencing the parent
 *    that no other connection between the same two figures has, the first
 *    in the order they are defined, the connections taken in diagram order
 *    once every name has been matched. A key is had per pair of figures, so
 *    two figures of one table each keep their line. A key onto another
 *    schema's table matches nothing (as msm's `_add_connections`).
 * 3. Matched, it takes the key's current name (and the table's); with no
 *    key left to match, or a figure gone, it goes.
 * 4. Each foreign key between two table figures shown that has no
 *    connection gets one.
 */

/**
 * @param diagram A diagram.
 *
 * @returns Its table figures by their table's name, lower case: the first
 *          one of a table, the one its connections go to.
 */
const tableFigures = (diagram: IModelDiagram): Map<string, IModelFigure> => {
    const figures = new Map<string, IModelFigure>();
    for (const figure of diagram.figures) {
        const name = tableOf(figure).toLowerCase();
        if (figureType(figure) === TABLE_FIGURE && !figures.has(name)) {
            figures.set(name, figure);
        }
    }

    return figures;
};

/**
 * Brings a diagram's connections in line with the foreign keys of its
 * tables, changing it in place.
 *
 * @param diagram The diagram.
 * @param tables The schema's tables.
 * @param newId Makes a new connection's id.
 * @param schema The snapshot's schema, where known: keys onto another
 *               schema's tables are left out.
 *
 * @returns Whether the diagram changed.
 */
export const syncConnections = (
    diagram: IModelDiagram,
    tables: readonly IOutlineTable[],
    newId: () => string,
    schema?: string,
): boolean => {
    const tableNamed = (name: string): IOutlineTable | undefined => {
        return tables.find((table) => { return sameName(table.name, name); });
    };
    const figureById = new Map(diagram.figures.map((figure) => {
        return [figure.id, figure] as const;
    }));
    const tableAt = (id: string): IOutlineTable | undefined => {
        const figure = figureById.get(id);

        return figure === undefined || figureType(figure) !== TABLE_FIGURE
            ? undefined : tableNamed(tableOf(figure));
    };
    const ownSchema = (key: IOutlineForeignKey): boolean => {
        const other = key.references.schema;

        return other === null || other === undefined || schema === undefined
            || sameName(other, schema);
    };
    const references = (key: IOutlineForeignKey,
        parent: IOutlineTable): boolean => {
        return ownSchema(key) && sameName(key.references.table, parent.name);
    };
    // Which keys have a line, per pair of figures.
    const taken = new Set<string>();
    const pairKey = (start: string, end: string,
        key: IOutlineForeignKey): string => {
        return `${start}\u0000${end}\u0000${key.name.toLowerCase()}`;
    };
    const matched = new Map<IModelConnection, IOutlineForeignKey>();
    let changed = false;

    // By name first, so a key that kept its name keeps its own line.
    const pairs = diagram.connections.map((connection) => {
        return {
            connection,
            child: tableAt(connection.startFigure),
            parent: tableAt(connection.endFigure),
        };
    });
    for (const { connection, child, parent } of pairs) {
        const { startFigure, endFigure } = connection;
        const key = child === undefined || parent === undefined ? undefined
            : (child.foreign_keys ?? []).find((candidate) => {
                return sameName(candidate.name, connection.foreignKey)
                    && references(candidate, parent)
                    && !taken.has(pairKey(startFigure, endFigure, candidate));
            });
        if (key !== undefined) {
            taken.add(pairKey(startFigure, endFigure, key));
            matched.set(connection, key);
        }
    }
    // Then by what the key is: the child's keys onto the parent left.
    for (const { connection, child, parent } of pairs) {
        if (matched.has(connection) || child === undefined
            || parent === undefined) {
            continue;
        }
        const { startFigure, endFigure } = connection;
        const key = (child.foreign_keys ?? []).find((candidate) => {
            return references(candidate, parent)
                && !taken.has(pairKey(startFigure, endFigure, candidate));
        });
        if (key !== undefined) {
            taken.add(pairKey(startFigure, endFigure, key));
            matched.set(connection, key);
        }
    }

    const kept: IModelConnection[] = [];
    for (const { connection, child } of pairs) {
        const key = matched.get(connection);
        if (key === undefined || child === undefined) {
            changed = true;
            continue;
        }
        if (connection.foreignKey !== key.name
            || connection.table !== child.name) {
            connection.foreignKey = key.name;
            connection.table = child.name;
            changed = true;
        }
        kept.push(connection);
    }

    // Every key between two tables shown has its line.
    const figures = tableFigures(diagram);
    for (const table of tables) {
        const child = figures.get(table.name.toLowerCase());
        if (child === undefined) {
            continue;
        }
        for (const key of table.foreign_keys ?? []) {
            const parent = figures.get(key.references.table.toLowerCase());
            if (parent === undefined || !ownSchema(key)
                || taken.has(pairKey(child.id, parent.id, key))) {
                continue;
            }
            taken.add(pairKey(child.id, parent.id, key));
            kept.push({ id: newId(), foreignKey: key.name, table: table.name,
                startFigure: child.id, endFigure: parent.id, visible: true });
            changed = true;
        }
    }
    if (changed) {
        diagram.connections = kept;
    }

    return changed;
};
