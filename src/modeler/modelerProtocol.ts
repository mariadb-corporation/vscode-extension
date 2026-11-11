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

import type {
    DiagramItem,
    DiagramItemChange,
} from "../details/objectDetails.js";
import type { IDetailEdits } from "../details/detailEdits.js";
import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import { OBJECT_TYPES, type ObjectType } from "../mcp/types.js";
import type {
    IDiagramDocument,
    IRestObjectDefinition,
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

/**
 * How a diagram was last looked at, to open it the same way: kept by
 * VS Code (the workspace's state), not in the diagram.
 */
export interface IDiagramView {
    /** The zoom, 1 being life size. */
    zoom: number;
    /** The point of the page at the middle of the view. */
    x: number;
    y: number;
    /** The projection: flat, or the 3D view. */
    mode: "2d" | "iso";
    /** The 3D view picked: a preset's id, or the user's own angles. */
    isoPreset: string;
    /** The 3D view's angles, in radians. */
    tilt: number;
    turn: number;
}

/** An object of a diagram's schema, by name. */
export interface ISchemaObjectRef {
    type: ObjectType;
    name: string;
}

/** A REST object of a project's MSM Section 180, by its paths. */
export interface IRestObjectRef {
    type: "rest";
    service: string;
    schema: string;
    /** Its request path. */
    name: string;
}

/** What a tree's row places on a diagram. */
export type DiagramObjectRef = ISchemaObjectRef | IRestObjectRef;

/**
 * The scheme of the URIs a tree's rows carry in a drag's `text/uri-list`:
 * `mariadb-schema-object:/table/customer?project=<path>`, or
 * `?connection=<uri>&schema=<schema>` for a live schema's row; a REST
 * object's, `/rest/<service>/<schema>/<object>`, each path encoded whole.
 * A drop on a diagram reads them back.
 */
export const SCHEMA_OBJECT_SCHEME = "mariadb-schema-object";

/** Where a schema object is: a project's script, or a live schema. */
export type SchemaObjectPlace =
    | { projectPath: string }
    | { connection: string; schema: string };

/**
 * @param place Where the object is.
 * @param ref The object.
 *
 * @returns Its URI for a drag.
 */
export const schemaObjectUri = (
    place: SchemaObjectPlace,
    ref: DiagramObjectRef,
): string => {
    const query = "projectPath" in place
        ? `project=${encodeURIComponent(place.projectPath)}`
        : `connection=${encodeURIComponent(place.connection)}`
            + `&schema=${encodeURIComponent(place.schema)}`;

    const path = ref.type === "rest"
        ? [ref.service, ref.schema, ref.name] : [ref.name];

    return `${SCHEMA_OBJECT_SCHEME}:/${ref.type}/`
        + `${path.map(encodeURIComponent).join("/")}?${query}`;
};

const OBJECT_TYPE_NAMES = new Set<string>(OBJECT_TYPES);

/**
 * @param uriList A drag's `text/uri-list`: URIs, one a line (`#` lines
 *                are comments).
 *
 * @returns The schema objects among them, with where each is; other URIs
 *          are left out.
 */
export const parseSchemaObjectUris = (
    uriList: string,
): Array<{ place: SchemaObjectPlace; ref: DiagramObjectRef }> => {
    const found: Array<{ place: SchemaObjectPlace; ref: DiagramObjectRef }> = [];
    const pattern = new RegExp(`^${SCHEMA_OBJECT_SCHEME}:/([a-z]+)/([^?]+)`
        + "\\?(.*)$", "u");
    for (const line of uriList.split(/\r?\n/u)) {
        const match = pattern.exec(line.trim());
        if (match === null) {
            continue;
        }
        const ref = refOf(match[1], match[2].split("/").map(decodeURIComponent));
        const query = new URLSearchParams(match[3]);
        const project = query.get("project");
        const connection = query.get("connection");
        const schema = query.get("schema");
        const place: SchemaObjectPlace | undefined = project !== null
            ? { projectPath: project }
            : connection !== null && schema !== null
                ? { connection, schema } : undefined;
        if (ref !== undefined && place !== undefined) {
            found.push({ place, ref });
        }
    }

    return found;
};

/**
 * @param type A URI's type.
 * @param paths Its paths, decoded: a schema object's name, or a REST
 *              object's service, schema and request path.
 *
 * @returns What it places; undefined for an unknown type, or for paths
 *          that are not the type's.
 */
const refOf = (type: string, paths: string[]): DiagramObjectRef | undefined => {
    if (type === "rest") {
        const [service, schema, name] = paths;

        return paths.length === 3
            ? { type, service: service!, schema: schema!, name: name! }
            : undefined;
    }

    return OBJECT_TYPE_NAMES.has(type) && paths.length === 1
        ? { type: type as ObjectType, name: paths[0]! } : undefined;
};

/**
 * @param place Where dropped objects are.
 * @param target What a viewer shows.
 *
 * @returns Whether they are of its schema.
 */
export const isPlaceOf = (
    place: SchemaObjectPlace,
    target: ModelerTarget,
): boolean => {
    return "projectPath" in place
        ? target.kind === "project" && target.projectPath === place.projectPath
        : target.kind === "connection" && target.connection === place.connection
            && target.schema === place.schema;
};

/** Where a project's saves stand. */
export type SaveState =
    | { state: "pending" | "saving" | "saved" }
    | { state: "failed"; message: string };

/** The snapshot's objects, as a schema edit leaves them. */
export type ISchemaObjects = Pick<ISchemaModel,
    "sourceHash" | "tables" | "views" | "routines" | "triggers" | "events"
    | "sequences">;

/** Messages from the viewer to the extension. */
export type ModelerWebviewMessage =
    /** The page has loaded and can take the model. */
    | { type: "ready" }
    /** The diagram shown, however it was picked: for the tab's title. */
    | { type: "diagramShown"; name: string }
    /** How a diagram is looked at now, to open it so again. */
    | { type: "viewChanged"; diagram: string; view: IDiagramView }
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
        recover?: boolean }
    /**
     * The schema objects the selected figures show, for the Object Details
     * view: tables, views, and a routine group's routines.
     */
    | { type: "selection"; objects: ISchemaObjectRef[]; item?: DiagramItem }
    /** The one item selected changed: moved, resized, undone. */
    | { type: "item"; item?: DiagramItem }
    /**
     * Something without schema objects the page can read was dropped at
     * this point of the page (client coordinates): rows of a tree, whose
     * objects VS Code keeps from the page and the extension knows. With
     * the drop's types, for the log.
     */
    | { type: "treeDrop"; x: number; y: number; types: string[] }
    /**
     * The pointer moved in the page after a pause, at this point (client
     * coordinates): where the rows of a drag from a tree go, should one
     * have just ended. VS Code drops none into a webview, so the pointer's
     * coming back after the drag stands in for the drop.
     */
    | { type: "pointerArrived"; x: number; y: number }
    /** A table card's menu: Edit Table, in the table editor. */
    | { type: "editTable"; table: string }
    /** The toolbar's menu: Auto Layout, of a project's diagram. */
    | { type: "layoutDiagram"; diagram: string };

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
        /** How each diagram was last looked at, by name. */
        views?: Record<string, IDiagramView>;
    }
    /** Show another of the model's diagrams: opened again in the tree. */
    | { type: "showDiagram"; name: string }
    /** Object Details changed the selected item. */
    | { type: "changeItem"; id: string; change: DiagramItemChange }
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
    | { type: "saveState"; save: SaveState }
    /**
     * Places objects the schema has on the diagram shown: Add to Diagram
     * on a tree's rows, in the middle of the view.
     */
    | { type: "placeObjects"; objects: DiagramObjectRef[] }
    /**
     * The project's MSM Section 180 changed: what its REST object
     * figures show.
     */
    | { type: "restObjects"; objects: IRestObjectDefinition[] }
    /**
     * The answer to a `treeDrop`, or to a `pointerArrived` after a drag
     * from a tree: the dragged rows' `text/uri-list` (for a `treeDrop`,
     * empty where the drag had no objects), and where they go.
     */
    | { type: "treeDropped"; uriList: string; x: number; y: number }
    /**
     * A change made in the Object Details view: shown, put in the
     * history, sent as a `schemaEdit` and taken back where msm refuses it.
     */
    | { type: "applySchemaChange"; change: IDetailEdits };
