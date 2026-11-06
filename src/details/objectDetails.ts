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

import type { IObjectDetails } from "../mcp/types.js";
import type { ISchemaObjectRef } from "../modeler/modelerProtocol.js";
import type {
    IOutlineEvent,
    IOutlineRoutine,
    IOutlineSequence,
    IOutlineTable,
    IOutlineTrigger,
    IOutlineView,
    ISchemaDefinition,
} from "../modeler/modelFormat.js";
import type { TableDetailChange } from "./detailEdits.js";

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
    /** Whether it can be changed here: a project's object. */
    editable: boolean;
    /**
     * What the source cannot tell: a live table's indexes and foreign
     * keys, say.
     */
    partial?: string;
    object: ObjectDetailsBody;
}

/** Messages from the extension to the view. */
export type DetailsHostMessage =
    /** The object to show; nothing, with why, where there is none. */
    | { type: "show"; details?: IObjectDetailsView; message?: string }
    /** A change was refused, with why; or one is being made. */
    | { type: "status"; error?: string; busy?: boolean };

/** Messages from the view to the extension. */
export type DetailsWebviewMessage =
    | { type: "ready" }
    | { type: "change"; change: TableDetailChange };

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
 * @param details What `db.get_object_details` says of the object.
 * @param ref The object asked about.
 *
 * @returns It in the outline's shape: a table's columns with its primary
 *          key, from the columns' flags; a view's columns.
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
    switch (ref.type) {
        case "table": {
            const key = (details.columns ?? []).filter((column) => {
                return column.is_primary === 1;
            }).map((column) => { return column.name; });

            return { type: "table", table: {
                name: details.basic.name,
                columns,
                indexes: key.length === 0 ? []
                    : [{ name: null, kind: "primary", columns: key }],
                ...(details.basic.comment
                    ? { options: { comment: details.basic.comment } } : {}),
            } };
        }

        case "view": {
            return { type: "view", view: { name: details.basic.name,
                columns: columns.map((column) => { return column.name; }) } };
        }

        case "procedure":
        case "function": {
            return { type: ref.type, routine: { name: details.basic.name,
                kind: ref.type } };
        }

        // The server tells their names and comments only.
        case "trigger": {
            return { type: "trigger", trigger: { name: details.basic.name,
                timing: "", events: "", table: "" } };
        }

        case "event": {
            return { type: "event", event: { name: details.basic.name,
                comment: details.basic.comment ?? null } };
        }

        default: {
            return { type: "sequence",
                sequence: { name: details.basic.name } };
        }
    }
};
