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
 * A schema's rows, below and including the schema: its Diagrams folder and
 * diagrams, a folder per object type and the objects in it. Two trees draw
 * them: the Connections view, from a live database (a node carries the
 * connection's `uri`), and the MSM Projects view, from a project's
 * development script as msm's schema snapshot has it (a node carries the
 * `projectPath`). What differs is where the objects are read and which
 * menus a row gets, so each tree passes the start of the rows' context
 * values: `mariadb` (`mariadbObject.table`) or `mariadbMsm`
 * (`mariadbMsmObject.table`).
 */

import * as vscode from "vscode";

import type { IObjectInfo, ObjectType } from "../mcp/types.js";
import type { ISchemaDefinition } from "../modeler/modelFormat.js";
import {
    schemaObjectUri,
    type ISchemaObjectRef,
    type SchemaObjectPlace,
} from "../modeler/modelerProtocol.js";

/** Resolves an icon name to the light and dark files to show for it. */
export type IconResolver = (name: string) => {
    light: vscode.Uri;
    dark: vscode.Uri;
};

/**
 * Builds an icon resolver over the extension's `images` folder, which holds
 * a `light` and a `dark` variant of every icon.
 *
 * @param extensionUri The root of the installed extension.
 *
 * @returns The resolver.
 */
export const createIconResolver = (
    extensionUri: vscode.Uri,
): IconResolver => {
    return (name: string) => {
        return {
            light: vscode.Uri.joinPath(extensionUri, "images", "light", name),
            dark: vscode.Uri.joinPath(extensionUri, "images", "dark", name),
        };
    };
};

/** The caption each object group is shown under. */
export const OBJECT_GROUP_LABELS: Record<ObjectType, string> = {
    table: "Tables",
    view: "Views",
    function: "Functions",
    procedure: "Procedures",
    sequence: "Sequences",
    trigger: "Triggers",
    event: "Events",
};

/** The icon shown for a group of objects of one type. */
const GROUP_ICONS: Record<ObjectType, string | vscode.ThemeIcon> = {
    table: "schemaTables.svg",
    view: "schemaViews.svg",
    function: "schemaFunctions.svg",
    procedure: "schemaProcedures.svg",
    // The upstream icon set has no sequence icon, so this one falls back to
    // a codicon rather than borrowing an unrelated picture.
    sequence: new vscode.ThemeIcon("symbol-numeric"),
    trigger: "schemaTableTriggers.svg",
    event: "schemaEvents.svg",
};

/** The icon shown for a single object. */
const OBJECT_ICONS: Record<ObjectType, string | vscode.ThemeIcon> = {
    table: "schemaTable.svg",
    view: "schemaView.svg",
    function: "schemaFunction.svg",
    procedure: "schemaProcedure.svg",
    sequence: new vscode.ThemeIcon("symbol-numeric"),
    trigger: "schemaTableTrigger.svg",
    event: "schemaEvent.svg",
};

/** The icon of a Diagrams folder and of a diagram. */
const DIAGRAM_ICON = new vscode.ThemeIcon("type-hierarchy-sub");

/**
 * The start of a schema row's context value, naming the tree it is in:
 * the menus of one tree are not offered on the other's rows.
 */
export type SchemaRowPrefix = "mariadb" | "mariadbMsm";

/**
 * What every schema row is drawn from, wherever it lives. A tree's nodes
 * add where that is (`uri` or `projectPath`).
 */
export interface ISchemaRow {
    kind: "schema";
    schema: string;
    /** What `db.list_schemas` says the schema is; left unsaid if a user's. */
    schemaType?: string;
    comment?: string;
}

export interface IObjectGroupRow {
    kind: "objectGroup";
    schema: string;
    objectType: ObjectType;
}

export interface IObjectRow {
    kind: "object";
    schema: string;
    objectType: ObjectType;
    name: string;
    comment?: string;
}

export interface IDiagramsRow {
    kind: "diagrams";
    schema?: string;
}

export interface IDiagramEntryRow {
    kind: "diagram";
    name: string;
    /** How many figures it has, where the tree knows. */
    figures?: number;
}

/**
 * @param place Where the schema is: `{ uri }` or `{ projectPath }`.
 * @param schema The schema.
 * @param objectTypes Its folders, in the order shown.
 *
 * @returns A folder node per object type.
 */
export const objectGroupsOf = <P extends object>(
    place: P,
    schema: string,
    objectTypes: readonly ObjectType[],
): (P & IObjectGroupRow)[] => {
    return objectTypes.map((objectType) => {
        return { ...place, kind: "objectGroup", schema, objectType };
    });
};

/**
 * @param group The folder.
 * @param objects What is in it.
 * @param place Where the schema is, as the folder carries it.
 *
 * @returns An object node per object.
 */
export const objectsOf = <P extends object>(
    place: P,
    group: IObjectGroupRow,
    objects: readonly IObjectInfo[],
): (P & IObjectRow)[] => {
    return objects.map((object) => {
        return {
            ...place,
            kind: "object",
            schema: group.schema,
            objectType: group.objectType,
            name: object.name,
            comment: object.comment,
        };
    });
};

/**
 * The object types msm's schema snapshot has, in the Connections view's
 * order: the snapshot has no sequences, triggers or events.
 */
export const OUTLINE_OBJECT_TYPES: readonly ObjectType[] =
    ["table", "view", "function", "procedure"];

/**
 * @param definition msm's schema snapshot of a project's script.
 * @param objectType The objects wanted.
 *
 * @returns Them as `db.list_objects` lists a live schema's: by name, a
 *          table with its comment. A routine without a kind is taken for a
 *          procedure.
 */
export const outlineObjects = (
    definition: ISchemaDefinition,
    objectType: ObjectType,
): IObjectInfo[] => {
    const listed: IObjectInfo[] = (() => {
        switch (objectType) {
            case "table": {
                return definition.tables.map((table) => {
                    const comment = table.options?.comment;

                    return typeof comment === "string" && comment !== ""
                        ? { name: table.name, comment }
                        : { name: table.name };
                });
            }

            case "view": {
                return (definition.views ?? []).map((view) => {
                    return { name: view.name };
                });
            }

            case "function":
            case "procedure": {
                return (definition.routines ?? []).filter((routine) => {
                    return (routine.kind ?? "procedure") === objectType;
                }).map((routine) => { return { name: routine.name }; });
            }

            default: {
                return [];
            }
        }
    })();

    return listed.sort((a, b) => {
        return a.name.localeCompare(b.name, undefined,
            { sensitivity: "base" });
    });
};

/**
 * Places the tables, views and routines run on on the open diagram of
 * their schema: what dragging them there does.
 */
export const ADD_TO_DIAGRAM_COMMAND = "mariadb.addToDiagram";

/** The mime type a drag onto a diagram (or an editor) reads. */
export const URI_LIST_MIME = "text/uri-list";

/**
 * @param rows Rows dragged, with where each one's schema is.
 *
 * @returns The `text/uri-list` of the tables, views and routines among
 *          them, which a diagram places where they are dropped; nothing
 *          where there is none.
 */
export const objectUriList = (
    rows: ReadonlyArray<{ place: SchemaObjectPlace; row: IObjectRow }>,
): string | undefined => {
    const uris = rows.flatMap(({ place, row }) => {
        const ref = objectRefOf(row);

        return ref === undefined ? [] : [schemaObjectUri(place, ref)];
    });

    return uris.length === 0 ? undefined : uris.join("\r\n");
};

/**
 * @param row A row of an object.
 *
 * @returns The object, where a diagram can show it: a table, view or
 *          routine.
 */
export const objectRefOf = (row: IObjectRow): ISchemaObjectRef | undefined => {
    switch (row.objectType) {
        case "table":
        case "view":
        case "procedure":
        case "function": {
            return { type: row.objectType, name: row.name };
        }

        default: {
            return undefined;
        }
    }
};

/**
 * What a schema's own rows are called before a tree's prefix, and the
 * user's schemas' type, which is not shown.
 */
const USER_SCHEMA = "User Schema";

/** A row of a schema's subtree. */
export class SchemaSubtreeItem<T> extends vscode.TreeItem {
    public constructor(
        public readonly node: T,
        label: string,
        icon: string | vscode.ThemeIcon,
        hasChildren: boolean,
        resolveIcon: IconResolver,
    ) {
        super(label, hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.iconPath = typeof icon === "string" ? resolveIcon(icon) : icon;
    }
}

/** A schema. */
export class SchemaTreeItem<T extends ISchemaRow>
    extends SchemaSubtreeItem<T> {

    public constructor(node: T, resolveIcon: IconResolver,
        prefix: SchemaRowPrefix = "mariadb") {
        super(node, node.schema, "schema.svg", true, resolveIcon);
        this.contextValue = `${prefix}Schema`;

        // Only a system schema says what it is: a column of "User Schema"
        // down the tree is what the user came for and tells them nothing.
        const type = node.schemaType;
        this.description = type === undefined || type === USER_SCHEMA
            ? undefined : type;
        this.tooltip = node.comment
            || (type === undefined ? node.schema : `${node.schema} (${type})`);
    }
}

/** The folder of a schema's diagrams, first among its children. */
export class DiagramsTreeItem<T extends IDiagramsRow>
    extends SchemaSubtreeItem<T> {

    public constructor(node: T, resolveIcon: IconResolver,
        prefix: SchemaRowPrefix, tooltip: string) {
        super(node, "Diagrams", DIAGRAM_ICON, true, resolveIcon);
        this.contextValue = `${prefix}Diagrams`;
        this.tooltip = tooltip;
    }
}

/**
 * A diagram. Opened by its inline button, its menu, or a double-click:
 * VS Code has no double-click on tree rows, so every click runs a command
 * that opens on the second within a moment.
 */
export class DiagramTreeItem<T extends IDiagramEntryRow>
    extends SchemaSubtreeItem<T> {

    public constructor(node: T, resolveIcon: IconResolver,
        prefix: SchemaRowPrefix, clickCommand: string) {
        // The Diagrams folder's icon, until a diagram has one of its own.
        super(node, node.name, DIAGRAM_ICON, false, resolveIcon);
        this.contextValue = `${prefix}Diagram`;
        if (node.figures !== undefined) {
            this.description = node.figures === 1
                ? "1 figure" : `${node.figures} figures`;
        }
        this.command = {
            command: clickCommand,
            title: "Open Diagram",
            arguments: [node],
        };
    }
}

/** The folder holding all objects of one type in a schema. */
export class ObjectGroupTreeItem<T extends IObjectGroupRow>
    extends SchemaSubtreeItem<T> {

    public constructor(node: T, resolveIcon: IconResolver,
        prefix: SchemaRowPrefix = "mariadb") {
        super(node, OBJECT_GROUP_LABELS[node.objectType],
            GROUP_ICONS[node.objectType], true, resolveIcon);
        this.contextValue = `${prefix}ObjectGroup.${node.objectType}`;
    }
}

/** A single database object. */
export class ObjectTreeItem<T extends IObjectRow>
    extends SchemaSubtreeItem<T> {

    public constructor(node: T, resolveIcon: IconResolver,
        prefix: SchemaRowPrefix = "mariadb") {
        super(node, node.name, OBJECT_ICONS[node.objectType], false,
            resolveIcon);
        this.contextValue = `${prefix}Object.${node.objectType}`;
        this.tooltip = node.comment || undefined;
    }
}
