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
import type {
    IMsmConnectionChoice,
    IMsmProjectContext,
    MsmDialogKind,
    MsmValues,
} from "./msmFields.js";

/** What a MariaDB Schema Management dialog is told. */
export interface IMsmLoadMessage {
    type: "load";
    kind: MsmDialogKind;
    title: string;
    /** The project, for every dialog but New MSM Project. */
    project?: IMsmProjectContext;
    values: MsmValues;
    /** The licenses New MSM Project offers. */
    licenses?: readonly string[];
    /** The connections Deploy Schema offers. */
    connections?: IMsmConnectionChoice[];
}

/** A folder picked with Browse, for the field it was picked for. */
export interface IMsmBrowsedMessage {
    type: "browsed";
    field: string;
    path: string;
}

/** Why the host did not go ahead, or what failed when it did. */
export interface IMsmErrorMessage {
    type: "error";
    message: string;
    /** The field the problem is in, if it is in one. */
    field?: string;
}

export type MsmHostMessage =
    | IMsmLoadMessage
    | IMsmBrowsedMessage
    | IMsmErrorMessage
    | IBusyMessage;

/** Browse was pressed: the extension opens a folder picker. */
export interface IMsmBrowseMessage {
    type: "browse";
    field: string;
    current: string;
}

/** The dialog's main button. */
export interface IMsmSubmitMessage {
    type: "submit";
    values: MsmValues;
}

/**
 * One of the project information's buttons: the development script to
 * open, or another dialog on the same project.
 */
export interface IMsmOpenMessage {
    type: "open";
    what: "developmentFile" | "release" | "deploymentScript" | "deploy";
}

export type MsmWebviewMessage =
    | IReadyMessage
    | IMsmBrowseMessage
    | IMsmSubmitMessage
    | IMsmOpenMessage
    | ICancelMessage;
