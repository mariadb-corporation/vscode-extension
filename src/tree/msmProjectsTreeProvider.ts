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

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import * as vscode from "vscode";

import {
    allFolders,
    folderNames,
    normalizeFolder,
    parentFolder,
    ROOT_FOLDER,
    subfoldersOf,
} from "../connections/connectionFolders.js";
import { reportError } from "../errorMessages.js";
import { McpToolError } from "../mcp/protocol.js";
import type { IServerStatus } from "../mcp/serverStarter.js";
import type {
    IMsmApi, IMsmDiagramListing, IMsmListedProject,
} from "../mcp/msmApi.js";
import { OBJECT_TYPES, type ConnectionColor } from "../mcp/types.js";
import { schemaNameOfFolder } from "../msm/msmFields.js";
import {
    schemaDefinitionOf, type ISchemaDefinition,
} from "../modeler/modelFormat.js";
import { colorUriOf } from "./connectionColors.js";
import type { IFolderNode } from "./connectionsModel.js";
import {
    FolderColors,
    FolderSet,
    foldersToMove,
    isWithin,
    rebase,
    type IFolderMemento,
} from "./customFolders.js";
import { ExpandedRows } from "./expandedRows.js";
import {
    DiagramsTreeItem,
    DiagramTreeItem,
    ObjectGroupTreeItem,
    objectGroupsOf,
    objectsOf,
    draggedObjects,
    objectUriList,
    ObjectTreeItem,
    outlineObjects,
    SchemaTreeItem,
    type IconResolver,
    type IDiagramEntryRow,
    type IDiagramsRow,
    type IObjectGroupRow,
    type IObjectRow,
    type ISchemaRow,
} from "./schemaTree.js";
import { FolderTreeItem } from "./treeItems.js";
import { ViewStateTracker, type ViewState } from "./viewState.js";
import { errorText } from "../text.js";

/** The id the MSM Projects view is contributed under. */
export const MSM_PROJECTS_VIEW_ID = "mariadb.msmProjects";

/**
 * The context key the view's welcome content switches on, a `ViewState`:
 * `unsupported` where the MariaDB Shell has no MSM Projects list yet (one
 * released before `msm.list_projects`).
 */
export const MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY = "mariadb.msmProjectsView";

/**
 * @param error Why listing the projects failed.
 *
 * @returns Whether it failed because the MariaDB Shell is too old to have
 *          the MSM Projects list, which answers `Unknown tool: <name>`: the
 *          name with the server's tool-name separator, `.` by default
 *          (`msm.list_projects`), `_` with `--toolNameSeparator=_`.
 */
export const isUnsupportedShell = (error: unknown): boolean => {
    return error instanceof McpToolError
        && /Unknown tool: msm[._]/u.test(error.message);
};

/** What a drag in the view carries: the rows dragged. */
export const MSM_PROJECTS_DRAG_MIME = "application/vnd.mariadb.msmprojects";

/**
 * Where in the global state the view keeps what the server does not: the
 * folders made with New Folder, the collapsed ones and the folders' colors,
 * as the Connections view does under keys of its own.
 */
export const MSM_FOLDERS_KEY = "mariadb.msmProjects.folders";
export const MSM_COLLAPSED_FOLDERS_KEY = "mariadb.msmProjects.collapsedFolders";
/** Where the rows left expanded (projects, schemas, groups, ...) are kept. */
export const MSM_EXPANDED_ROWS_KEY = "mariadb.msmProjects.expandedRows";
export const MSM_FOLDER_COLORS_KEY = "mariadb.msmProjects.folderColors";

/** A folder of the list, as the Connections view's folders are. */
export type IMsmFolderNode = IFolderNode;

/**
 * @param path A folder of the list.
 * @param empty Whether nothing is filed at or below it.
 *
 * @returns Its row.
 */
const folderNode = (path: string, empty: boolean): IMsmFolderNode => {
    return { kind: "folder", path, name: folderNames(path).at(-1)!, empty };
};

/** A project of the list. */
export interface IMsmProjectNode {
    kind: "project";
    project: IMsmListedProject;
}

/** A file or folder inside a project folder, as the Explorer shows it. */
export interface IMsmFileNode {
    kind: "file";
    path: string;
    directory: boolean;
}

/** Where a row of a project's schema is: the project folder. */
export interface IMsmProjectPlace {
    projectPath: string;
}

/**
 * A project's schema, first among its rows, as the Connections view draws
 * a live one: its objects are those of the development script, as msm's
 * schema snapshot has them.
 */
export interface IMsmSchemaNode extends IMsmProjectPlace, ISchemaRow {
    /**
     * Whether the snapshot was made from the script as it is; undefined
     * where the project has none yet, or the shell cannot say.
     */
    current?: boolean;
    /** Whether the project has a snapshot at all. */
    snapshot: boolean;
}

/** The folder of a project's schema diagrams, first in its schema. */
export interface IMsmDiagramsNode extends IMsmProjectPlace, IDiagramsRow {}

/** A schema diagram of a project. */
export interface IMsmDiagramNode extends IMsmProjectPlace, IDiagramEntryRow {
    figures: number;
}

/** The folder of one type of the project's schema objects. */
export interface IMsmObjectGroupNode extends IMsmProjectPlace, IObjectGroupRow {}

/** A table, view or routine of the project's development script. */
export interface IMsmObjectNode extends IMsmProjectPlace, IObjectRow {}

export type MsmProjectsNode = IMsmFolderNode | IMsmProjectNode | IMsmFileNode
    | IMsmSchemaNode | IMsmDiagramsNode | IMsmDiagramNode
    | IMsmObjectGroupNode | IMsmObjectNode;

/**
 * The command a click on a project's diagram runs: VS Code has no
 * double-click on tree rows, so the second click within a moment opens it.
 */
export const MSM_DIAGRAM_CLICK_COMMAND = "mariadb.msm.diagramClicked";

/** The commands on a project's diagrams. */
export const MSM_DIAGRAM_COMMANDS = {
    /**
     * Opens a diagram: the row's, else one of a project's (the row's, the
     * Explorer folder's, or one picked), asking which where it has several.
     */
    open: "mariadb.msm.openSchemaDiagram",
    /** Adds an empty diagram to a project and opens it, to model on. */
    create: "mariadb.msm.newSchemaDiagram",
    /** Renames a diagram, from its row. */
    rename: "mariadb.msm.renameSchemaDiagram",
    /** Deletes a diagram from its project, once confirmed; from its row. */
    remove: "mariadb.msm.deleteSchemaDiagram",
} as const;

/** The commands on a project's schema row. */
export const MSM_SCHEMA_COMMANDS = {
    /** Makes msm's snapshot of the development script again. */
    updateSnapshot: "mariadb.msm.updateSchemaSnapshot",
} as const;

/** What the view needs from the extension. */
export interface IMsmProjectsHost {
    msmApi(): Promise<IMsmApi>;
    /** The icons of a schema's rows, as the Connections view has them. */
    resolveIcon: IconResolver;
    /** How the server's startup is going, which the welcome content says. */
    status?: IServerStatus;
    /** Where the folders, collapsed folders and colors persist. */
    memento?: IFolderMemento;
    log(message: string): void;
}

/**
 * @param project A listed project.
 *
 * @returns What its row is called: its caption, else its schema, else its
 *          folder's name without the suffix.
 */
export const projectLabel = (project: IMsmListedProject): string => {
    if (project.caption !== "") {
        return project.caption;
    }
    if (project.schemaName !== undefined) {
        return project.schemaName;
    }

    return schemaNameOfFolder(basename(project.projectPath));
};

/**
 * @param node A project row.
 *
 * @returns What its row says beside the label, as a connection's says
 *          `address · MCP`: the development version, and `MCP` where LLMs
 *          may work on it; `missing` for a folder that is gone.
 */
export const projectDescription = (node: IMsmProjectNode): string => {
    if (!node.project.exists) {
        return "missing";
    }

    return [node.project.developmentVersion,
        node.project.mcpAccess ? "MCP" : undefined]
        .filter((part) => { return part !== undefined; })
        .join(" · ");
};

/**
 * @param node A row.
 *
 * @returns The folder of the list it works in: a folder row's own, a
 *          project's folder, nothing for a file.
 */
export const msmFolderOf = (
    node: MsmProjectsNode | undefined,
): string | undefined => {
    if (node === undefined) {
        return undefined;
    }

    switch (node.kind) {
        case "folder": {
            return node.path;
        }

        case "project": {
            return node.project.folder;
        }

        default: {
            return undefined;
        }
    }
};

/**
 * Feeds the MSM Projects view: the MSM Projects list the server keeps
 * (`msm.list_projects`), filed in its folders, each project with its
 * development version and whether LLMs may work on it, and expandable to
 * the files in its folder.
 *
 * As in the Connections view, the server knows a folder only as the place
 * a project is filed: folders made with New Folder, the collapsed ones and
 * the folders' colors are kept here, in the global state.
 */
export class MsmProjectsTreeProvider
    implements vscode.TreeDataProvider<MsmProjectsNode>,
    vscode.TreeDragAndDropController<MsmProjectsNode>, vscode.Disposable {

    // Not text/uri-list: VS Code then marks the drag as one of resources,
    // and the editor area lays its drop overlay over a diagram's webview,
    // which takes the drop even with Shift held. A diagram asks for the
    // objects dragged instead (draggedObjects).
    public readonly dragMimeTypes = [MSM_PROJECTS_DRAG_MIME];
    public readonly dropMimeTypes = [MSM_PROJECTS_DRAG_MIME];

    readonly #onDidChangeTreeData =
        new vscode.EventEmitter<MsmProjectsNode | undefined>();
    public readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;

    /** The projects the rows were drawn from, until the next refresh. */
    #listing: Promise<IMsmProjectNode[]> | undefined;
    /** Each project's diagrams and snapshot state, until the next refresh. */
    readonly #listings =
        new Map<string, Promise<IMsmDiagramListing | undefined>>();
    /** Each project's schema snapshot, until the next refresh. */
    readonly #snapshots =
        new Map<string, Promise<ISchemaDefinition | undefined>>();
    readonly #viewState: ViewStateTracker;

    public readonly customFolders: FolderSet;
    public readonly collapsedFolders: FolderSet;
    /** Every other row left expanded; folders are open unless collapsed. */
    public readonly expandedRows: ExpandedRows;
    public readonly folderColors: FolderColors;

    public constructor(private readonly host: IMsmProjectsHost) {
        this.customFolders = new FolderSet(host.memento, MSM_FOLDERS_KEY);
        this.collapsedFolders = new FolderSet(host.memento,
            MSM_COLLAPSED_FOLDERS_KEY);
        this.expandedRows = new ExpandedRows(host.memento,
            MSM_EXPANDED_ROWS_KEY);
        this.folderColors = new FolderColors(host.memento,
            MSM_FOLDER_COLORS_KEY);
        this.#viewState = new ViewStateTracker(
            MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY, host.status);
    }

    /** @returns What the view should say while it has no rows. */
    public get state(): ViewState {
        return this.#viewState.state;
    }

    /**
     * Reads the list again and redraws the view.
     *
     * @returns Nothing.
     */
    public refresh(): void {
        this.#listing = undefined;
        this.#listings.clear();
        this.#snapshots.clear();
        this.#onDidChangeTreeData.fire(undefined);
    }

    /**
     * Reads a project's diagrams and snapshot again and redraws the view;
     * the list of projects is kept.
     *
     * @param projectPath The project whose schema changed.
     *
     * @returns Nothing.
     */
    public refreshProject(projectPath: string): void {
        this.#listings.delete(projectPath);
        this.#snapshots.delete(projectPath);
        this.#onDidChangeTreeData.fire(undefined);
    }

    /**
     * @returns The projects, as last listed (listing them where they were
     *          not yet).
     */
    public projects(): Promise<IMsmProjectNode[]> {
        if (this.#listing === undefined) {
            const listing = this.#list();
            this.#listing = listing;
            // A failed listing is tried again on the next draw.
            listing.catch(() => {
                if (this.#listing === listing) {
                    this.#listing = undefined;
                }
            });
        }

        return this.#listing;
    }

    /**
     * @param projectPath A project folder.
     *
     * @returns Its row, where it is listed.
     */
    public async projectAt(
        projectPath: string,
    ): Promise<IMsmProjectNode | undefined> {
        return (await this.projects()).find((node) => {
            return node.project.projectPath === projectPath;
        });
    }

    /**
     * @returns Every folder of the view: those projects are filed in, with
     *          their parents, and those made with New Folder. The projects
     *          are as last listed; before a listing - the view not drawn
     *          yet - only the folders made with New Folder, so a dialog
     *          asking for them does not wait for the server to start.
     */
    public async folders(): Promise<string[]> {
        return this.#foldersOf(this.#listing === undefined
            ? [] : await this.#listing);
    }

    /**
     * @param projects The projects listed.
     *
     * @returns The folders they are filed in, with their parents, and
     *          those made with New Folder.
     */
    #foldersOf(projects: IMsmProjectNode[]): string[] {
        return allFolders([
            ...projects.map((node) => { return node.project.folder; }),
            ...this.customFolders.list(),
        ]);
    }

    public getTreeItem(node: MsmProjectsNode): vscode.TreeItem {
        const item = this.#itemOf(node);
        // VS Code reopens none of an extension's rows after a restart.
        if (node.kind !== "folder" && item.id !== undefined
            && item.collapsibleState
                === vscode.TreeItemCollapsibleState.Collapsed
            && this.expandedRows.has(item.id)) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }

        return item;
    }

    /**
     * @param node A row.
     *
     * @returns Its item, as it is drawn before the rows left expanded.
     */
    #itemOf(node: MsmProjectsNode): vscode.TreeItem {
        switch (node.kind) {
            case "folder": {
                return this.#folderItem(node);
            }

            case "project": {
                return projectItem(node);
            }

            case "schema": {
                return schemaItem(node, this.host.resolveIcon);
            }

            case "diagrams": {
                return diagramsItem(node, this.host.resolveIcon);
            }

            case "diagram": {
                return diagramItem(node, this.host.resolveIcon);
            }

            case "objectGroup": {
                const item = new ObjectGroupTreeItem(node, this.host.resolveIcon,
                    "mariadbMsm");
                item.id = rowIdOf(node);

                return item;
            }

            case "object": {
                const item = new ObjectTreeItem(node, this.host.resolveIcon,
                    "mariadbMsm");
                item.id = rowIdOf(node);

                return item;
            }

            default: {
                return fileItem(node);
            }
        }
    }

    public async getChildren(
        node?: MsmProjectsNode,
    ): Promise<MsmProjectsNode[]> {
        try {
            if (node === undefined) {
                return await this.#topLevel();
            }

            switch (node.kind) {
                case "folder": {
                    return await this.#folderChildren(node.path);
                }

                case "project": {
                    if (!node.project.exists) {
                        return [];
                    }
                    const [schema, files] = await Promise.all([
                        this.#schemaOf(node.project),
                        filesIn(node.project.projectPath),
                    ]);

                    return [schema, ...files];
                }

                case "schema": {
                    const place = { projectPath: node.projectPath };

                    return [
                        { ...place, kind: "diagrams", schema: node.schema },
                        ...objectGroupsOf(place, node.schema,
                            OBJECT_TYPES),
                    ];
                }

                case "diagrams": {
                    return await this.#diagramsOf(node.projectPath);
                }

                case "objectGroup": {
                    const definition = await this.snapshot(node.projectPath);

                    return definition === undefined ? [] : objectsOf(
                        { projectPath: node.projectPath }, node,
                        outlineObjects(definition, node.objectType));
                }

                case "diagram":
                case "object": {
                    return [];
                }

                default: {
                    return node.directory ? await filesIn(node.path) : [];
                }
            }
        } catch (error) {
            // A tree that throws shows nothing and says nothing.
            reportError(this.host.log, error, whatFailed(node));

            return [];
        }
    }

    /**
     * @param projectPath A project folder.
     *
     * @returns Its diagrams and its snapshot's state, as msm lists them,
     *          read once until the next refresh; nothing from a MariaDB
     *          Shell too old to have them, which is logged, not notified on
     *          every expand.
     */
    #listingOf(projectPath: string): Promise<IMsmDiagramListing | undefined> {
        return this.#cached(this.#listings, projectPath, async () => {
            try {
                return await (await this.host.msmApi())
                    .listSchemaDiagrams(projectPath);
            } catch (error) {
                if (isUnsupportedShell(error)) {
                    this.host.log("The MariaDB Shell has no schema diagrams "
                        + "for MSM projects; a newer version is needed.");

                    return undefined;
                }
                throw error;
            }
        });
    }

    /**
     * @param projectPath A project folder.
     *
     * @returns msm's schema snapshot of its development script, read once
     *          until the next refresh; nothing where it has none.
     */
    public snapshot(projectPath: string): Promise<ISchemaDefinition | undefined> {
        return this.#cached(this.#snapshots, projectPath, async () => {
            const listing = await this.#listingOf(projectPath);
            if (!listing?.schemaDefinition) {
                return undefined;
            }

            // One diagram's row at most comes with the snapshot, not all.
            return schemaDefinitionOf(await (await this.host.msmApi())
                .getSchemaDiagrams(projectPath, listing.diagrams[0]?.name));
        });
    }

    /**
     * @param cache Where answers are kept until the next refresh.
     * @param key What is asked about.
     * @param read Reads the answer.
     *
     * @returns The kept answer, read where there is none; a failed read is
     *          not kept, so the next draw tries again.
     */
    #cached<T>(cache: Map<string, Promise<T>>, key: string,
        read: () => Promise<T>): Promise<T> {
        const kept = cache.get(key);
        if (kept !== undefined) {
            return kept;
        }
        const reading = read();
        cache.set(key, reading);
        reading.catch(() => {
            if (cache.get(key) === reading) {
                cache.delete(key);
            }
        });

        return reading;
    }

    /**
     * @param project A listed project.
     *
     * @returns Its schema row: named as the project's schema, saying
     *          whether msm's snapshot is the script's as it is.
     */
    async #schemaOf(project: IMsmListedProject): Promise<IMsmSchemaNode> {
        const listing = await this.#listingOf(project.projectPath);

        return {
            kind: "schema",
            projectPath: project.projectPath,
            schema: project.schemaName
                ?? schemaNameOfFolder(basename(project.projectPath)),
            snapshot: listing?.schemaDefinition !== undefined,
            current: listing?.schemaDefinition?.current,
        };
    }

    /**
     * @param projectPath A project folder.
     *
     * @returns Its schema diagrams, as msm lists them.
     */
    async #diagramsOf(projectPath: string): Promise<IMsmDiagramNode[]> {
        const listing = await this.#listingOf(projectPath);

        return (listing?.diagrams ?? []).map((diagram) => {
            return {
                kind: "diagram",
                projectPath,
                name: diagram.name,
                figures: diagram.figures,
            };
        });
    }

    /**
     * @returns The top level's rows, telling the welcome content how the
     *          listing went: a failure is logged and said there, not
     *          notified on every draw, as in the other views.
     */
    async #topLevel(): Promise<MsmProjectsNode[]> {
        try {
            const children = await this.#folderChildren(ROOT_FOLDER);
            this.#viewState.listed();

            return children;
        } catch (error) {
            if (isUnsupportedShell(error)) {
                this.host.log("The MariaDB Shell has no MSM Projects list; "
                    + "a newer version is needed.");
                this.#viewState.unsupported();
            } else {
                this.host.log("Failed to list the MSM projects: "
                    + errorText(error));
                this.#viewState.failed();
            }

            return [];
        }
    }

    /**
     * @param node A row.
     *
     * @returns The folder row it is in, which `reveal` walks up through;
     *          undefined at the top level and for files, never revealed.
     */
    public getParent(node: MsmProjectsNode): MsmProjectsNode | undefined {
        if (node.kind !== "folder" && node.kind !== "project") {
            return undefined;
        }
        const folder = node.kind === "folder"
            ? parentFolder(node.path) : node.project.folder;

        // A folder something is in.
        return folder === ROOT_FOLDER ? undefined : folderNode(folder, false);
    }

    /**
     * Notes a row the user collapsed: a folder is redrawn closed, any other
 * row is drawn closed after a restart.
     *
     * @param node The row collapsed.
     *
     * @returns Nothing.
     */
    public async collapsed(node: MsmProjectsNode): Promise<void> {
        if (node.kind === "folder") {
            await this.collapsedFolders.add(node.path);
            this.#onDidChangeTreeData.fire(node);
        } else {
            await this.expandedRows.delete(rowIdOf(node));
        }
    }

    /**
     * Notes a row the user expanded: a folder is redrawn open, any other row
 * is drawn open again after a restart.
     *
     * @param node The row expanded.
     *
     * @returns Nothing.
     */
    public async expanded(node: MsmProjectsNode): Promise<void> {
        if (node.kind === "folder") {
            if (await this.collapsedFolders.delete(node.path)) {
                this.#onDidChangeTreeData.fire(node);
            }
        } else {
            await this.expandedRows.add(rowIdOf(node));
        }
    }

    // --- folders ----------------------------------------------------------

    /**
     * Makes a folder, which stays until it is removed.
     *
     * @param path The folder.
     *
     * @returns Nothing.
     */
    public async newFolder(path: string): Promise<void> {
        await this.customFolders.add(path);
        // Kept here alone: the server's list is as it was.
        this.#onDidChangeTreeData.fire(undefined);
    }

    /**
     * Removes an empty folder, and what is kept of it.
     *
     * @param folder The folder.
     *
     * @returns Nothing.
     */
    public async removeFolder(folder: IMsmFolderNode): Promise<void> {
        await Promise.all([
            this.customFolders.remove(folder.path),
            this.collapsedFolders.remove(folder.path),
            this.folderColors.remove(folder.path),
        ]);
        this.#onDidChangeTreeData.fire(undefined);
    }

    /**
     * Renames a folder: every project in and below it is filed anew.
     *
     * @param folder The folder.
     * @param name Its new name, one folder name.
     *
     * @returns Nothing.
     */
    public async renameFolder(
        folder: IMsmFolderNode,
        name: string,
    ): Promise<void> {
        const renamed = normalizeFolder(`${parentFolder(folder.path)}/${name}`);
        if (renamed !== folder.path && renamed !== ROOT_FOLDER) {
            await this.#refile([{ from: folder.path, to: renamed }], []);
        }
    }

    /**
     * @param folder The folder.
     * @param color Its color; undefined for none.
     *
     * @returns Nothing.
     */
    public async setFolderColor(
        folder: IMsmFolderNode,
        color: ConnectionColor | undefined,
    ): Promise<void> {
        await this.folderColors.set(folder.path, color);
        this.#onDidChangeTreeData.fire(undefined);
    }

    // --- drag and drop ----------------------------------------------------

    /**
     * Starts a drag of the projects and folders selected; files stay where
     * they are on disk.
     *
     * @param source The rows dragged.
     * @param dataTransfer What the drag carries.
     */
    public handleDrag(
        source: readonly MsmProjectsNode[],
        dataTransfer: vscode.DataTransfer,
    ): void {
        // Folders and projects are filed elsewhere in the view.
        const dragged = source.filter((node) => {
            return node.kind === "folder" || node.kind === "project";
        });
        if (dragged.length > 0) {
            dataTransfer.set(MSM_PROJECTS_DRAG_MIME,
                new vscode.DataTransferItem(dragged));
        }
        // Tables, views and routines go onto a diagram of the project.
        const uris = objectUriList(source.flatMap((node) => {
            return node.kind === "object"
                ? [{ place: { projectPath: node.projectPath }, row: node }]
                : [];
        }));
        // A webview gets nothing a tree sets: a diagram asks for them on
        // the drop.
        draggedObjects.remember(uris);
    }

    /**
     * Files what was dragged where it was dropped: in the folder dropped
     * on, the folder of the project dropped on, or the top level. A folder
     * moves whole, keeping its name; one dropped into itself goes nowhere.
     *
     * @param target The row dropped on; undefined for empty space.
     * @param dataTransfer What the drag carries.
     *
     * @returns Nothing.
     */
    public async handleDrop(
        target: MsmProjectsNode | undefined,
        dataTransfer: vscode.DataTransfer,
    ): Promise<void> {
        // A drag that ended here is not one for a diagram.
        draggedObjects.take();
        const carried: unknown = dataTransfer.get(MSM_PROJECTS_DRAG_MIME)
            ?.value;
        const rows = Array.isArray(carried)
            ? (carried as Array<MsmProjectsNode | undefined>) : [];
        const into = target === undefined ? ROOT_FOLDER : msmFolderOf(target);
        if (into === undefined) {
            return;
        }

        const folders = foldersToMove(rows.filter(
            (node): node is IMsmFolderNode => { return node?.kind === "folder"; }),
        into);
        // A project dragged along with the folder it is in moves with it.
        const projects = rows.filter((node): node is IMsmProjectNode => {
            return node?.kind === "project" && !folders.some(({ from }) => {
                return isWithin(node.project.folder, from);
            });
        });
        if (folders.length === 0 && projects.length === 0) {
            return;
        }

        await this.#refile(folders, projects.map((node) => {
            return { projectPath: node.project.projectPath, folder: into };
        }));
    }

    /**
     * Moves folders and projects, and redraws the view however it went.
     *
     * @param folders Each folder to move, with all that is in it.
     * @param filings Projects to file somewhere of their own.
     *
     * @returns Nothing.
     */
    async #refile(
        folders: Array<{ from: string; to: string }>,
        filings: Array<{ projectPath: string; folder: string }>,
    ): Promise<void> {
        try {
            const projects = await this.projects();
            const all = [...filings];
            for (const node of projects) {
                for (const { from, to } of folders) {
                    if (isWithin(node.project.folder, from)) {
                        all.push({
                            projectPath: node.project.projectPath,
                            folder: rebase(node.project.folder, from, to),
                        });
                    }
                }
            }

            const api = await this.host.msmApi();
            const listed = new Map(projects.map((node) => {
                return [node.project.projectPath, node.project.folder];
            }));
            // One after the other, as `fileConnections` moves connections:
            // each call rewrites the server's one list, and two at once
            // could lose each other's change.
            for (const { projectPath, folder } of all) {
                if (listed.get(projectPath) !== folder) {
                    await api.updateProject(projectPath, { folder });
                    this.host.log(`Moved '${projectPath}' to '${folder}'.`);
                }
            }
            for (const { from, to } of folders) {
                await Promise.all([
                    this.customFolders.move(from, to),
                    this.collapsedFolders.move(from, to),
                    this.folderColors.move(from, to),
                ]);
            }
        } catch (error) {
            reportError(this.host.log, error, "move the MSM projects");
        } finally {
            this.refresh();
        }
    }

    // --- rows -------------------------------------------------------------

    /**
     * @returns The projects, each with its development version, as the
     *          server lists them.
     */
    async #list(): Promise<IMsmProjectNode[]> {
        const listed = await (await this.host.msmApi()).listProjects();
        // The rows of projects no longer listed are not kept open.
        void this.expandedRows.prune((id) => {
            return listed.some((project) => {
                return isRowOf(id, project.projectPath);
            });
        });

        return listed.map((project) => {
            // In the one spelling the folder rows are drawn from, whatever
            // wrote the entry: a project filed in `Shop/` is in `/Shop`.
            return {
                kind: "project",
                project: { ...project, folder: normalizeFolder(project.folder) },
            };
        });
    }

    /**
     * @param folder A folder of the list; `/` for the top level.
     *
     * @returns Its subfolders, sorted, then its projects, by label.
     */
    async #folderChildren(folder: string): Promise<MsmProjectsNode[]> {
        const projects = await this.projects();
        const subfolders = subfoldersOf(this.#foldersOf(projects), folder)
            .map((path) => {
                return folderNode(path, !projects.some((node) => {
                    return isWithin(node.project.folder, path);
                }));
            });
        const inHere = projects.filter((node) => {
            return node.project.folder === folder;
        }).sort((left, right) => {
            return projectLabel(left.project)
                .localeCompare(projectLabel(right.project));
        });

        return [...subfolders, ...inHere];
    }

    /**
     * @param node A folder.
     *
     * @returns Its row, open unless the user closed it, in its color.
     */
    #folderItem(node: IMsmFolderNode): vscode.TreeItem {
        return new FolderTreeItem(node, !this.collapsedFolders.has(node.path),
            this.folderColors.get(node.path),
            { id: "msmFolder", contextValue: "mariadbMsmFolder" });
    }

    public dispose(): void {
        this.#viewState.dispose();
        this.#onDidChangeTreeData.dispose();
    }
}

/**
 * @param node A row other than a folder.
 *
 * @returns Its id: the same across refreshes and restarts, so the rows
 *          left expanded are drawn so again.
 */
const rowIdOf = (node: Exclude<MsmProjectsNode, IMsmFolderNode>): string => {
    switch (node.kind) {
        case "project": {
            return `msmProject:${node.project.projectPath}`;
        }

        case "schema": {
            return `msmSchema:${node.projectPath}`;
        }

        case "diagrams": {
            return `msmDiagrams:${node.projectPath}`;
        }

        case "diagram": {
            return `msmDiagram:${node.projectPath}:${node.name}`;
        }

        case "objectGroup": {
            return `msmGroup:${node.projectPath}:${node.objectType}`;
        }

        case "object": {
            return `msmObject:${node.projectPath}:${node.objectType}:`
                + node.name;
        }

        default: {
            return `msmFile:${node.path}`;
        }
    }
};

/**
 * @param id A row's id, as `rowIdOf` makes it.
 * @param projectPath A project folder.
 *
 * @returns Whether the row is the project's or one of its rows: the path
 *          ends there or goes on into it, so `/a/p` is not taken for
 *          `/a/p2`.
 */
const isRowOf = (id: string, projectPath: string): boolean => {
    const at = id.indexOf(":") + 1;

    return id.startsWith(projectPath, at)
        && ["", ":", "/", "\\"].includes(
            id.charAt(at + projectPath.length));
};

/**
 * @param node A project.
 *
 * @returns Its row: expandable to its files, colored as the user chose,
 *          with its menu by whether it is still there.
 */
const projectItem = (node: IMsmProjectNode): vscode.TreeItem => {
    const { project } = node;
    const item = new vscode.TreeItem(projectLabel(project), project.exists
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
    item.id = rowIdOf(node);
    item.description = projectDescription(node);
    item.contextValue = project.exists
        ? "mariadbMsmProject" : "mariadbMsmProject.missing";
    item.iconPath = new vscode.ThemeIcon(project.exists ? "package" : "warning");
    item.tooltip = [
        project.projectPath,
        project.schemaName === undefined
            ? undefined : `Schema ${project.schemaName}`,
        project.developmentVersion === undefined
            ? undefined : `Development version ${project.developmentVersion}`,
        project.exists ? undefined : "The project folder is missing.",
        project.mcpAccess
            ? "LLMs may work on it through the MariaDB MCP server."
            : "Only this extension works on it: LLMs have no MCP access.",
    ].filter((line) => { return line !== undefined; }).join("\n");
    // Drawn by `ConnectionColorDecorations`, as a connection's color is.
    if (project.color !== undefined) {
        item.resourceUri = colorUriOf(project.color, "msmProject",
            project.projectPath);
    }

    return item;
};

/**
 * @param node A project's schema.
 * @param resolveIcon The icons' lookup.
 *
 * @returns Its row, first among the project's, with the Connections view's
 *          schema icon; it says where msm's snapshot is not the script's.
 */
const schemaItem = (
    node: IMsmSchemaNode,
    resolveIcon: IconResolver,
): vscode.TreeItem => {
    const item = new SchemaTreeItem(node, resolveIcon, "mariadbMsm");
    item.id = rowIdOf(node);
    if (!node.snapshot) {
        item.description = "no snapshot yet";
        item.tooltip = `The schema ${node.schema} has no snapshot yet: `
            + "Update Schema Snapshot makes it from the development script.";
    } else if (node.current === false) {
        item.description = "snapshot older than the script";
        item.tooltip = `The objects of ${node.schema} as msm's snapshot `
            + "has them, which the development script changed since: Update "
            + "Schema Snapshot makes it again.";
    } else {
        item.tooltip = `The objects of ${node.schema}, as the development `
            + "script has them";
    }

    return item;
};

/**
 * @param node A project's Diagrams folder.
 * @param resolveIcon The icons' lookup.
 *
 * @returns Its row, first in the project's schema.
 */
const diagramsItem = (
    node: IMsmDiagramsNode,
    resolveIcon: IconResolver,
): vscode.TreeItem => {
    const item = new DiagramsTreeItem(node, resolveIcon, "mariadbMsm",
        "The schema diagrams of the project, kept in MSM Section 160 of its "
        + "development script");
    item.id = rowIdOf(node);

    return item;
};

/**
 * @param node A project's diagram.
 * @param resolveIcon The icons' lookup.
 *
 * @returns Its row: opened by its inline button, its menu, or a
 *          double-click.
 */
const diagramItem = (
    node: IMsmDiagramNode,
    resolveIcon: IconResolver,
): vscode.TreeItem => {
    const item = new DiagramTreeItem(node, resolveIcon, "mariadbMsm",
        MSM_DIAGRAM_CLICK_COMMAND);
    item.id = rowIdOf(node);

    return item;
};

/**
 * @param node A file or folder in a project.
 *
 * @returns Its row, as the Explorer draws it: the theme's file icon, and
 *          a file opening on a click.
 */
const fileItem = (node: IMsmFileNode): vscode.TreeItem => {
    const uri = vscode.Uri.file(node.path);
    const item = new vscode.TreeItem(basename(node.path), node.directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
    item.id = rowIdOf(node);
    item.resourceUri = uri;
    item.iconPath = node.directory ? vscode.ThemeIcon.Folder
        : vscode.ThemeIcon.File;
    item.tooltip = node.path;
    if (!node.directory) {
        item.command = {
            command: "vscode.open",
            title: "Open",
            arguments: [uri],
        };
    }

    return item;
};

/**
 * @param node The row whose children could not be listed; undefined for
 *             the top level.
 *
 * @returns What failed, for the error message: the listing, or reading a
 *          folder on disk, named - not the listing, which went fine.
 */
const whatFailed = (node: MsmProjectsNode | undefined): string => {
    if (node?.kind === "project") {
        return `read ${node.project.projectPath}`;
    }
    if (node?.kind === "file") {
        return `read ${node.path}`;
    }
    if (node?.kind === "diagrams") {
        return `list the diagrams of ${node.projectPath}`;
    }

    return "list the MSM projects";
};

/**
 * @param folder A folder on disk.
 *
 * @returns What is in it, folders first, each sorted by name as the
 *          Explorer sorts.
 */
const filesIn = async (folder: string): Promise<IMsmFileNode[]> => {
    const entries = await readdir(folder, { withFileTypes: true });

    return entries
        .map((entry) => {
            return {
                kind: "file" as const,
                path: join(folder, entry.name),
                directory: entry.isDirectory(),
            };
        })
        .sort((left, right) => {
            if (left.directory !== right.directory) {
                return left.directory ? -1 : 1;
            }

            return basename(left.path).localeCompare(basename(right.path));
        });
};
