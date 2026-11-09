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
 * The table editor's messages, between its panel and its page. Pure,
 * shared by the extension and the webview.
 */

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import type {
    IOutlineTable,
    IOutlineTrigger,
} from "../modeler/modelFormat.js";
import type { IOnlineAlterData, IOnlineAlterEntry } from "./onlineAlter.js";

/** Which table an editor edits. */
export type TableEditorTarget =
    | { kind: "connection"; connection: string; schema: string; table: string }
    | { kind: "project"; projectPath: string; schema: string; table: string };

/** A collation the column editor offers, with its character set. */
export interface ICollationChoice {
    charset: string;
    collation: string;
}

/** What the page edits. */
export interface ITableEditorData {
    /** Whether Save changes a live database (ALTER statements run). */
    live: boolean;
    table: IOutlineTable;
    triggers: IOutlineTrigger[];
    /** The table's CREATE TABLE as written. */
    ddl: string;
    /** The schema's tables and their columns, for foreign keys. */
    tables: Record<string, string[]>;
    collations: ICollationChoice[];
    /** The Online Alter Table tab's settings of the table. */
    onlineAlter?: IOnlineAlterData;
    /** Why the tab has none: msm cannot give them. */
    onlineAlterProblem?: string;
}

/** What the panel sends the page. */
export type TableEditorHostMessage =
    | { type: "load"; data: ITableEditorData }
    | { type: "loadFailed"; message: string }
    | { type: "preview"; request: number; statements: string[];
        notes: string[]; error?: string }
    | { type: "applied"; notes: string[] }
    | { type: "applyFailed"; message: string; done: string[] }
    | { type: "busy"; busy: boolean };

/** What the page sends the panel. */
export type TableEditorWebviewMessage =
    | { type: "ready" }
    | { type: "refresh" }
    | { type: "preview"; request: number; edits: IMsmSchemaEdit[] }
    | { type: "apply"; edits: IMsmSchemaEdit[];
        /** The table's online ALTER entry, where the tab changed it. */
        onlineAlter?: IOnlineAlterEntry }
    | { type: "viewData" };

/**
 * @param target A table.
 *
 * @returns What tells its editor from every other.
 */
export const tableEditorKey = (target: TableEditorTarget): string => {
    // A project has one schema, which the tree and a diagram may title
    // apart: the folder's name until msm's model says it.
    const where = target.kind === "connection"
        ? `connection:${target.connection}|${target.schema}`
        : `project:${target.projectPath}`;

    return `${where}|${target.table.toLowerCase()}`;
};
