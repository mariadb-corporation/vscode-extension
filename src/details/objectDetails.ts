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
 * What the Object Details view shows of a table, view or routine, and the
 * messages between the view and the extension. One model for both places
 * an object comes from: a project's development script (msm's schema
 * snapshot, editable) and a live schema (`db.get_object_details`, read
 * only for now). Pure, shared by the extension and the webview.
 */

import type { FigureSide } from "../modeler/modelFormat.js";
import type { IObjectDetails } from "../mcp/types.js";
import type { ISchemaObjectRef } from "../modeler/modelerProtocol.js";
import type {
    IOutlineEvent,
    IOutlineForeignKey,
    IOutlineIndex,
    IOutlineRoutine,
    IOutlineSequence,
    IOutlineTable,
    IOutlineTrigger,
    IOutlineView,
    ISchemaDefinition,
} from "../modeler/modelFormat.js";

/** The object itself, as the outline writes it. */
export type ObjectDetailsBody =
    | { type: "table"; table: IOutlineTable }
    | { type: "view"; view: IOutlineView }
    | { type: "procedure" | "function"; routine: IOutlineRoutine }
    | { type: "trigger"; trigger: IOutlineTrigger }
    | { type: "event"; event: IOutlineEvent }
    | { type: "sequence"; sequence: IOutlineSequence };

/** What the view shows. */
export interface IObjectDetailsView {
    schema: string;
    /** Where the object is: "project shop" or the connection's caption. */
    where: string;
    object: ObjectDetailsBody;
}

/**
 * A table figure selected on a diagram, as the view shows and edits it:
 * where it is on the page (its layer's position included), how far it
 * stands above its layer in the 3D view, its size, and whether its height
 * follows what it shows. In page units.
 */
export interface IDiagramFigureItem {
    kind: "figure";
    id: string;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    autoHeight: boolean;
    /** Whether it stands upright on the page, rather than lying on it. */
    upright: boolean;
    /** Its colour as stored: "" for its kind's. */
    color: string;
    /** Whether the diagram can be changed: a live schema's is read only. */
    editable: boolean;
}

/**
 * A layer selected on a diagram: its place, height above the page and
 * size, and the tables filed under it. In page units.
 */
export interface IDiagramLayerItem {
    kind: "layer";
    id: string;
    name: string;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    /** The tables on it, by name, as Workbench files them. */
    tables: string[];
    /** Its colour as stored. */
    color: string;
    editable: boolean;
}

/** A relationship line selected on a diagram. */
export interface IDiagramConnectionItem {
    kind: "connection";
    id: string;
    /** The table holding the foreign key. */
    source: string;
    /** The table it references. */
    target: string;
    /** How far the middle segment is moved from halfway, in page units. */
    offset: number;
    /** Whether it is drawn as a stub out of each table instead. */
    split: boolean;
    /**
     * 1:n, else 1:1; left out where the foreign key is not in the schema
     * snapshot.
     */
    many?: boolean;
    /** Whether the foreign key's columns are in the source's primary key. */
    identifying?: boolean;
    /** The side of each end placed by hand; left out where automatic. */
    startDock?: DockSide;
    endDock?: DockSide;
    editable: boolean;
}

/** A side of a table a line's end can be placed on. */
export type DockSide = FigureSide;

/** The one diagram item selected, as the view shows it. */
export type DiagramItem = IDiagramFigureItem | IDiagramLayerItem
    | IDiagramConnectionItem;

/** What the view changes of a diagram item: the fields given. */
export type DiagramItemChange = Partial<
    Pick<IDiagramFigureItem, "x" | "y" | "z" | "width" | "height"
        | "autoHeight" | "color" | "upright">
    & Pick<IDiagramConnectionItem, "offset" | "split" | "many"
        | "identifying">
    & {
        /** An end placed by hand put back on the automatic layout. */
        resetDock: "start" | "end";
    }>;

/**
 * What the view is sent: an object to show (with the diagram item it was
 * selected as), or the diagram item alone, changed.
 */
export type DetailsHostMessage =
    | {
        type: "show";
        details?: IObjectDetailsView;
        message?: string;
        item?: DiagramItem;
    }
    | { type: "item"; item?: DiagramItem };

/** What the view sends: that it is listening, or a diagram item's change. */
export type DetailsWebviewMessage =
    | { type: "ready" }
    | { type: "changeItem"; id: string; change: DiagramItemChange };

/**
 * @param definition msm's snapshot of a project's script.
 * @param ref The object.
 *
 * @returns It, where the snapshot has it.
 */
export const outlineDetails = (
    definition: ISchemaDefinition,
    ref: ISchemaObjectRef,
): ObjectDetailsBody | undefined => {
    switch (ref.type) {
        case "table": {
            const table = definition.tables.find((entry) => {
                return entry.name === ref.name;
            });

            return table === undefined ? undefined : { type: "table", table };
        }

        case "view": {
            const view = definition.views?.find((entry) => {
                return entry.name === ref.name;
            });

            return view === undefined ? undefined : { type: "view", view };
        }

        case "procedure":
        case "function": {
            const type = ref.type;
            const routine = definition.routines?.find((entry) => {
                return entry.name === ref.name
                    && (entry.kind ?? "procedure") === type;
            });

            return routine === undefined ? undefined : { type, routine };
        }

        case "trigger": {
            const trigger = definition.triggers?.find((entry) => {
                return entry.name === ref.name;
            });

            return trigger === undefined
                ? undefined : { type: "trigger", trigger };
        }

        case "event": {
            const event = definition.events?.find((entry) => {
                return entry.name === ref.name;
            });

            return event === undefined ? undefined : { type: "event", event };
        }

        default: {
            const sequence = definition.sequences?.find((entry) => {
                return entry.name === ref.name;
            });

            return sequence === undefined
                ? undefined : { type: "sequence", sequence };
        }
    }
};

/**
 * @param value A value of INFORMATION_SCHEMA, as the server sends it.
 *
 * @returns It as text; nothing where it is null.
 */
const text = (value: unknown): string | undefined => {
    return value === null || value === undefined ? undefined : String(value);
};

/**
 * @param details What `db.get_object_details` says of a table.
 *
 * @returns Its primary and unique keys, from its constraints; where the
 *          server sends none, the primary key from the columns' flags.
 */
const liveIndexes = (details: IObjectDetails): IOutlineIndex[] => {
    if (details.constraints === undefined) {
        const key = (details.columns ?? []).filter((column) => {
            return column.is_primary === 1;
        }).map((column) => { return column.name; });

        return key.length === 0 ? []
            : [{ name: null, kind: "primary", columns: key }];
    }
    const indexes = new Map<string, IOutlineIndex>();
    for (const row of details.constraints) {
        const kind = row.constraint_type === "PRIMARY KEY" ? "primary"
            : row.constraint_type === "UNIQUE" ? "unique" : undefined;
        if (kind === undefined || row.column_name === null) {
            continue;
        }
        const index = indexes.get(row.constraint_name) ?? { name: kind
            === "primary" ? null : row.constraint_name, kind, columns: [] };
        index.columns.push(row.column_name);
        indexes.set(row.constraint_name, index);
    }

    return [...indexes.values()];
};

/**
 * @param details What `db.get_object_details` says of a table.
 *
 * @returns The foreign keys it holds (the `n:1` references).
 */
const liveForeignKeys = (details: IObjectDetails): IOutlineForeignKey[] => {
    return (details.references ?? []).filter((reference) => {
        return reference.reference_mapping.kind === "n:1";
    }).map((reference) => {
        const mapping = reference.reference_mapping;
        const schema = mapping.referenced_schema;

        return {
            name: mapping.constraint.slice(mapping.constraint.indexOf(".") + 1),
            columns: mapping.column_mapping.map((pair) => { return pair.base; }),
            references: {
                schema: schema === undefined || schema === details.basic.schema
                    ? null : schema,
                table: mapping.referenced_table ?? reference.name,
                columns: mapping.column_mapping.map((pair) => {
                    return pair.ref;
                }),
            },
        };
    });
};

/**
 * @param details What `db.get_object_details` says of an event.
 *
 * @returns Its schedule as `CREATE EVENT` writes it.
 */
const liveSchedule = (details: Record<string, unknown>): string | undefined => {
    if (details.event_type === "ONE TIME") {
        return details.execute_at === null ? undefined
            : `AT '${text(details.execute_at)}'`;
    }
    if (details.interval_value === null || details.interval_value === undefined) {
        return undefined;
    }

    return [`EVERY ${text(details.interval_value)} ${text(details.interval_field)}`,
        details.starts ? `STARTS '${text(details.starts)}'` : "",
        details.ends ? `ENDS '${text(details.ends)}'` : ""]
        .filter((part) => { return part !== ""; }).join(" ");
};

/** INFORMATION_SCHEMA's event status, as `CREATE EVENT` writes it. */
const EVENT_STATUS: Record<string, string> = {
    ENABLED: "ENABLE",
    DISABLED: "DISABLE",
    SLAVESIDE_DISABLED: "DISABLE ON SLAVE",
};

/**
 * @param details What `db.get_object_details` says of the object.
 * @param ref The object asked about.
 *
 * @returns It in the outline's shape, with all of it the outline has room
 *          for.
 */
export const liveDetails = (
    details: IObjectDetails,
    ref: ISchemaObjectRef,
): ObjectDetailsBody => {
    const columns = (details.columns ?? []).map((column) => {
        return {
            name: column.name,
            type: column.datatype,
            nullable: column.not_null !== 1,
            default: column.column_default,
            auto_increment: column.id_generation === "auto_inc",
            comment: column.comment === "" ? null : column.comment,
        };
    });
    const own = details.details ?? {};
    const name = details.basic.name;
    switch (ref.type) {
        case "table": {
            return { type: "table", table: {
                name,
                columns,
                indexes: liveIndexes(details),
                foreign_keys: liveForeignKeys(details),
                ...(details.basic.comment
                    ? { options: { comment: details.basic.comment } } : {}),
            } };
        }

        case "view": {
            return { type: "view", view: { name,
                columns: columns.map((column) => { return column.name; }) } };
        }

        case "procedure":
        case "function": {
            return { type: ref.type, routine: {
                name,
                kind: ref.type,
                parameters: (details.parameters ?? []).map((parameter) => {
                    return {
                        mode: parameter.mode,
                        name: parameter.name,
                        type: parameter.parameter_default === null
                            ? parameter.datatype
                            : `${parameter.datatype} DEFAULT `
                                + parameter.parameter_default,
                    };
                }),
                returns: details.returns ?? null,
            } };
        }

        case "trigger": {
            return { type: "trigger", trigger: {
                name,
                timing: text(own.action_timing) ?? "",
                events: (text(own.event_manipulation) ?? "")
                    .split(",").join(" OR "),
                table: text(own.table_name) ?? "",
                body: text(own.action_statement),
                definer: text(own.definer) ?? null,
            } };
        }

        case "event": {
            const completion = text(own.on_completion);

            return { type: "event", event: {
                name,
                schedule: liveSchedule(own),
                status: EVENT_STATUS[text(own.status) ?? ""]
                    ?? text(own.status) ?? null,
                on_completion_preserve: completion === undefined ? null
                    : completion === "PRESERVE",
                comment: details.basic.comment ?? null,
                body: text(own.event_definition),
                definer: text(own.definer) ?? null,
            } };
        }

        default: {
            return { type: "sequence", sequence: {
                name,
                type: text(own.data_type) ?? null,
                start: text(own.start_value) ?? null,
                increment: text(own.increment) ?? null,
            } };
        }
    }
};
