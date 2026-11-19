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

import type {
    IBusyMessage,
    ICancelMessage,
    IReadyMessage,
} from "../webview/dialogProtocol.js";
import type { IDumpInfo } from "../mcp/utilApi.js";
import type { IUtilOperationSpec, UtilValues } from "./utilFields.js";

/** What the dump, load, copy, export and import dialog is told. */
export interface IUtilLoadMessage {
    type: "load";
    spec: IUtilOperationSpec;
    values: UtilValues;
    /** The connections a copy can go to. */
    targets: IUtilTarget[];
}

/** A connection a copy can go to. */
export interface IUtilTarget {
    /** Its URI, which is what is sent back. */
    uri: string;
    /** What it is shown as: the address, without the scheme. */
    label: string;
}

/** A path picked with Browse. */
export interface IUtilBrowsedMessage {
    type: "browsed";
    path: string;
}

export interface IUtilStartErrorMessage {
    type: "startError";
    message: string;
    /** The field the problem is in, if it is in one. */
    field?: string;
}

/** A load's dump as read: what it holds, or why it could not be read. */
export interface IDumpRead {
    /** The path it was read from. */
    path: string;
    info?: IDumpInfo;
    error?: string;
}

/**
 * A load's dump, read with `util.inspect_dump`. Sent again, with every
 * name of a schema, after `inspectSchema`.
 */
export interface IUtilInspectedMessage extends IDumpRead {
    type: "inspected";
    /**
     * The boxes unticked to start with (`dumpSelection.ts`), for a dump
     * read anew; left out where the same dump was read again, which keeps
     * the boxes as they are.
     */
    excluded?: string[];
}

export type UtilHostMessage =
    | IUtilLoadMessage
    | IUtilBrowsedMessage
    | IUtilStartErrorMessage
    | IUtilInspectedMessage
    | IBusyMessage;

/** Browse was pressed: the extension opens a folder or file picker. */
export interface IUtilBrowseMessage {
    type: "browse";
    current: string;
    /** A dump to one file: a save dialog for a `.mariadb.dump.zip`. */
    zip?: boolean;
}

/** A load's path was typed: read what the dump there holds. */
export interface IUtilInspectMessage {
    type: "inspect";
    path: string;
}

/** A schema the dump listed only some names of was opened: read them all. */
export interface IUtilInspectSchemaMessage {
    type: "inspectSchema";
    schema: string;
}

export interface IUtilStartMessage {
    type: "start";
    values: UtilValues;
    /** A load: the boxes of its Objects tab unticked (`dumpSelection.ts`). */
    excluded?: string[];
}

export type UtilWebviewMessage =
    | IReadyMessage
    | IUtilBrowseMessage
    | IUtilInspectMessage
    | IUtilInspectSchemaMessage
    | IUtilStartMessage
    | ICancelMessage;
