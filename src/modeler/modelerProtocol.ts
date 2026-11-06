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
 * What the model viewer webview and the extension say to each other.
 * Shared by both sides, so free of `vscode`.
 */

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import type {
    IDiagramDocument,
    ISchemaModel,
} from "./modelFormat.js";
import type { IPageSettings } from "./pageSettings.js";

/**
 * What a viewer shows, as a panel is restored from after a restart: a
 * schema of a connection, or an MSM project.
 */
export type ModelerTarget =
    | { kind: "connection"; connection: string; schema: string; diagram: string }
    | { kind: "project"; projectPath: string; diagram: string };

/** Where a project's saves stand. */
export type SaveState =
    | { state: "pending" | "saving" | "saved" }
    | { state: "failed"; message: string };

/** The snapshot's objects, as a schema edit leaves them. */
export type ISchemaObjects = Pick<ISchemaModel,
    "sourceHash" | "tables" | "views" | "routines">;

/** Messages from the viewer to the extension. */
export type ModelerWebviewMessage =
    /** The page has loaded and can take the model. */
    | { type: "ready" }
    /** The diagram shown, however it was picked: for the tab's title. */
    | { type: "diagramShown"; name: string }
    /** A diagram changed: to be kept and saved (editable models only). */
    | { type: "diagramChanged"; document: IDiagramDocument }
    /** The picture of an image figure that came without one. */
    | { type: "imageWanted"; diagram: string; figureId: string }
    /**
     * Schema objects to change in the project's SQL; with the diagrams the
     * change also changed (a figure placed for a new table), which are
     * saved once the edit is made, and not at all where it fails.
     */
    | { type: "schemaEdit"; edits: IMsmSchemaEdit[];
        documents?: IDiagramDocument[];
        /**
         * Whether the viewer takes the change back itself where msm
         * refuses it (a new table, its columns kept to fix), rather than
         * the project being read again.
         */
        recover?: boolean };

/** Messages from the extension to the viewer. */
export type ModelerHostMessage =
    /** The model to show, where it came from, and the diagram to open. */
    | {
        type: "load";
        model: ISchemaModel;
        source: string;
        pageSettings: IPageSettings;
        /** The diagram to show first: the one opened in the tree. */
        diagram?: string;
        /** Whether diagrams are saved and schema objects can be edited. */
        editable: boolean;
        /** What the panel is restored from, kept in the webview's state. */
        target: ModelerTarget;
    }
    /** Show another of the model's diagrams: opened again in the tree. */
    | { type: "showDiagram"; name: string }
    /** The model could not be read. */
    | { type: "error"; message: string }
    /** An image figure's picture, or why there is none. */
    | {
        type: "image";
        diagram: string;
        figureId: string;
        image?: string;
        error?: string;
    }
    /** What a schema edit came to: the new snapshot, or its error. */
    | {
        type: "schemaEdited";
        objects?: ISchemaObjects;
        error?: string;
    }
    /** Where the saves stand. */
    | { type: "saveState"; save: SaveState };
