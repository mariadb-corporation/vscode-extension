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
 * Placing objects the schema has already on a diagram: what an object
 * dragged from a tree (or added with its Add to Diagram) puts there. Pure, so it is tested without a scene.
 *
 * As in Workbench, a table or view is shown once per diagram, and a table
 * comes with the connections of its foreign keys to the tables shown, and
 * of theirs to it. The routines dropped together go on one new routine
 * group, the events on one new event group; a sequence gets a figure; a
 * trigger is shown on its table's card, which comes where it is not
 * shown.
 */

import type { ISchemaObjectRef } from "../../../src/modeler/modelerProtocol.js";
import {
    EVENT_GROUP_FIGURE,
    ROUTINE_GROUP_FIGURE,
    SEQUENCE_FIGURE,
    TABLE_FIGURE,
    VIEW_FIGURE,
    type IModelConnection,
    type IModelDiagram,
    type IModelFigure,
} from "../../../src/modeler/modelFormat.js";
import type { ISchemaObjectLists } from "./schemaEdits.js";
import { numberedName } from "./schemaEdits.js";

/** What placing objects adds, and what it leaves out and why. */
export interface IPlacement {
    figures: IModelFigure[];
    connections: IModelConnection[];
    /** Each object not placed, with why: "customer is shown already". */
    skipped: string[];
}

/** How far apart figures placed together are, left edge to left edge. */
const FIGURE_STEP = 240;

/** How many figures placed together go in a row. */
const FIGURES_PER_ROW = 4;

/** How far apart the rows are. */
const ROW_STEP = 220;

/**
 * @param refs The objects, as dropped or asked for.
 * @param diagram The diagram they go on.
 * @param objects The schema's objects, as the viewer has them.
 * @param point Where the first goes; the others follow in rows.
 * @param newId Makes a figure's or connection's id.
 *
 * @returns The figures and connections to add.
 */
export const placementOf = (
    refs: readonly ISchemaObjectRef[],
    diagram: IModelDiagram,
    objects: ISchemaObjectLists,
    point: { x: number; y: number },
    newId: () => string,
): IPlacement => {
    const figures: IModelFigure[] = [];
    const skipped: string[] = [];
    const routines: string[] = [];
    const events: string[] = [];
    const at = (): { left: number; top: number } => {
        const index = figures.length;

        return {
            left: Math.round(point.x
                + (index % FIGURES_PER_ROW) * FIGURE_STEP),
            top: Math.round(point.y
                + Math.floor(index / FIGURES_PER_ROW) * ROW_STEP),
        };
    };
    const shown = (test: (figure: IModelFigure) => boolean): boolean => {
        return diagram.figures.some(test) || figures.some(test);
    };

    for (const ref of refs) {
        switch (ref.type) {
            case "table": {
                const table = objects.tables.find((entry) => {
                    return entry.name === ref.name;
                });
                if (table === undefined) {
                    skipped.push(`${ref.name} is not a table of the schema`);
                } else if (shown((figure) => {
                    return figure.table === table.name;
                })) {
                    skipped.push(`${table.name} is shown already`);
                } else {
                    figures.push({ id: newId(), type: TABLE_FIGURE,
                        name: table.name, table: table.name, ...at() });
                }
                break;
            }

            case "view": {
                const view = objects.views.find((entry) => {
                    return entry.name === ref.name;
                });
                if (view === undefined) {
                    skipped.push(`${ref.name} is not a view of the schema`);
                } else if (shown((figure) => {
                    return figure.view === view.name;
                })) {
                    skipped.push(`${view.name} is shown already`);
                } else {
                    figures.push({ id: newId(), type: VIEW_FIGURE,
                        name: view.name, view: view.name, ...at() });
                }
                break;
            }

            case "sequence": {
                const sequence = (objects.sequences ?? []).find((entry) => {
                    return entry.name === ref.name;
                });
                if (sequence === undefined) {
                    skipped.push(`${ref.name} is not a sequence of the schema`);
                } else if (shown((figure) => {
                    return figure.sequence === sequence.name;
                })) {
                    skipped.push(`${sequence.name} is shown already`);
                } else {
                    figures.push({ id: newId(), type: SEQUENCE_FIGURE,
                        name: sequence.name, sequence: sequence.name,
                        ...at() });
                }
                break;
            }

            case "event": {
                const event = (objects.events ?? []).find((entry) => {
                    return entry.name === ref.name;
                });
                if (event === undefined) {
                    skipped.push(`${ref.name} is not an event of the schema`);
                } else if (events.includes(event.name) || shown((figure) => {
                    return figure.events?.includes(event.name) ?? false;
                })) {
                    skipped.push(`${event.name} is shown already`);
                } else {
                    events.push(event.name);
                }
                break;
            }

            case "trigger": {
                // Its table's card lists it: the table comes, if it is not
                // shown yet.
                const trigger = (objects.triggers ?? []).find((entry) => {
                    return entry.name === ref.name;
                });
                const table = objects.tables.find((entry) => {
                    return entry.name === trigger?.table;
                });
                if (trigger === undefined || table === undefined) {
                    skipped.push(`${ref.name} is not a trigger of the schema`);
                } else if (shown((figure) => {
                    return figure.table === table.name;
                })) {
                    skipped.push(`${trigger.name} is shown on ${table.name}`);
                } else {
                    figures.push({ id: newId(), type: TABLE_FIGURE,
                        name: table.name, table: table.name, ...at() });
                }
                break;
            }

            default: {
                const routine = objects.routines.find((entry) => {
                    return entry.name === ref.name
                        && (entry.kind ?? "procedure") === ref.type;
                });
                if (routine === undefined) {
                    skipped.push(`${ref.name} is not a ${ref.type} of the `
                        + "schema");
                } else if (routines.includes(routine.name) || shown(
                    (figure) => {
                        return figure.routines?.includes(routine.name)
                            ?? false;
                    })) {
                    skipped.push(`${routine.name} is shown already`);
                } else {
                    routines.push(routine.name);
                }
            }
        }
    }
    if (routines.length > 0) {
        figures.push({
            id: newId(),
            type: ROUTINE_GROUP_FIGURE,
            name: numberedName("routines", diagram.figures.map((figure) => {
                return figure.name;
            })),
            routines,
            ...at(),
        });
    }
    if (events.length > 0) {
        figures.push({
            id: newId(),
            type: EVENT_GROUP_FIGURE,
            name: numberedName("events", diagram.figures.map((figure) => {
                return figure.name;
            })),
            events,
            ...at(),
        });
    }

    return { figures, connections: connectionsOf(figures, diagram, objects,
        newId), skipped };
};

/**
 * @param placed The figures being placed.
 * @param diagram The diagram, before them.
 * @param objects The schema's objects.
 * @param newId Makes a connection's id.
 *
 * @returns A connection for each foreign key between two tables shown,
 *          one of them just placed, that has none yet.
 */
const connectionsOf = (
    placed: readonly IModelFigure[],
    diagram: IModelDiagram,
    objects: ISchemaObjectLists,
    newId: () => string,
): IModelConnection[] => {
    // A table's first figure is the one its connections go to.
    const figureOf = new Map<string, string>();
    const isNew = new Set<string>();
    for (const figure of [...diagram.figures, ...placed]) {
        if (figure.table !== undefined && !figureOf.has(figure.table)) {
            figureOf.set(figure.table, figure.id);
        }
    }
    for (const figure of placed) {
        if (figure.table !== undefined) {
            isNew.add(figure.table);
        }
    }
    const connections: IModelConnection[] = [];
    for (const table of objects.tables) {
        const child = figureOf.get(table.name);
        if (child === undefined) {
            continue;
        }
        for (const key of table.foreign_keys ?? []) {
            const parent = figureOf.get(key.references.table);
            const drawn = diagram.connections.some((connection) => {
                return connection.table === table.name
                    && connection.foreignKey === key.name;
            });
            if (parent === undefined || drawn || !(isNew.has(table.name)
                || isNew.has(key.references.table))) {
                continue;
            }
            connections.push({ id: newId(), foreignKey: key.name,
                table: table.name, startFigure: child, endFigure: parent,
                visible: true });
        }
    }

    return connections;
};

/**
 * @param diagram The diagram shown.
 * @param ids The figures selected.
 * @param objects The schema's objects.
 *
 * @returns The schema objects they show, for the Object Details view: a
 *          table's, a view's, a routine group's routines.
 */
export const objectsOfFigures = (
    diagram: IModelDiagram,
    ids: readonly string[],
    objects: ISchemaObjectLists,
): ISchemaObjectRef[] => {
    return ids.flatMap((id): ISchemaObjectRef[] => {
        const figure = diagram.figures.find((entry) => {
            return entry.id === id;
        });
        if (figure?.table !== undefined) {
            return [{ type: "table", name: figure.table }];
        }
        if (figure?.view !== undefined) {
            return [{ type: "view", name: figure.view }];
        }
        if (figure?.sequence !== undefined) {
            return [{ type: "sequence", name: figure.sequence }];
        }
        if (figure?.events !== undefined) {
            return figure.events.map((name): ISchemaObjectRef => {
                return { type: "event", name };
            });
        }

        return (figure?.routines ?? []).flatMap((name) => {
            const routine = objects.routines.find((entry) => {
                return entry.name === name;
            });

            return routine === undefined ? []
                : [{ type: routine.kind ?? "procedure", name }];
        });
    });
};
