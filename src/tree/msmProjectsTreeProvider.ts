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
    normalizeFolder,
    parentFolder,
    ROOT_FOLDER,
    subfoldersOf,
} from "../connections/connectionFolders.js";
import { reportError } from "../errorMessages.js";
import type { IMsmApi, IMsmListedProject } from "../mcp/msmApi.js";
import type { ConnectionColor } from "../mcp/types.js";
import { colorUriOf } from "./connectionColors.js";
import {
    FolderColors,
    FolderSet,
    isWithin,
    rebase,
    type IFolderMemento,
} from "./customFolders.js";

/** The id the MSM Projects view is contributed under. */
export const MSM_PROJECTS_VIEW_ID = "mariadb.msmProjects";

/** What a drag in the view carries: the rows dragged. */
export const MSM_PROJECTS_DRAG_MIME = "application/vnd.mariadb.msmprojects";

/**
 * Where in the global state the view keeps what the server does not: the
 * folders made with New Folder, the collapsed ones and the folders' colors,
 * as the Connections view does under keys of its own.
 */
export const MSM_FOLDERS_KEY = "mariadb.msmProjects.folders";
export const MSM_COLLAPSED_FOLDERS_KEY = "mariadb.msmProjects.collapsedFolders";
export const MSM_FOLDER_COLORS_KEY = "mariadb.msmProjects.folderColors";

/** A folder of the list. */
export interface IMsmFolderNode {
    kind: "folder";
    /** `/Shop/Production`. */
    path: string;
    /** `Production`. */
    name: string;
    /** Nothing filed at or below it: only then can it be removed. */
    empty: boolean;
}

/** A project of the list. */
export interface IMsmProjectNode {
    kind: "project";
    project: IMsmListedProject;
    /** Its development version; undefined where it could not be read. */
    version?: string;
}

/** A file or folder inside a project folder, as the Explorer shows it. */
export interface IMsmFileNode {
    kind: "file";
    path: string;
    directory: boolean;
}

export type MsmProjectsNode = IMsmFolderNode | IMsmProjectNode | IMsmFileNode;

/** What the view needs from the extension. */
export interface IMsmProjectsHost {
    msmApi(): Promise<IMsmApi>;
    /** Where the folders, collapsed folders and colors persist. */
    memento?: IFolderMemento;
    log(message: string): void;
}

/** The suffix a project folder's name ends in. */
const PROJECT_SUFFIX = ".msm.project";

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
    const name = basename(project.projectPath);

    return name.endsWith(PROJECT_SUFFIX)
        ? name.slice(0, -PROJECT_SUFFIX.length) : name;
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

    return [node.version, node.project.mcpAccess ? "MCP" : undefined]
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

    public readonly dragMimeTypes = [MSM_PROJECTS_DRAG_MIME];
    public readonly dropMimeTypes = [MSM_PROJECTS_DRAG_MIME];

    readonly #onDidChangeTreeData =
        new vscode.EventEmitter<MsmProjectsNode | undefined>();
    public readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;

    /** The projects the rows were drawn from, until the next refresh. */
    #listing: Promise<IMsmProjectNode[]> | undefined;

    public readonly customFolders: FolderSet;
    public readonly collapsedFolders: FolderSet;
    public readonly folderColors: FolderColors;

    public constructor(private readonly host: IMsmProjectsHost) {
        this.customFolders = new FolderSet(host.memento, MSM_FOLDERS_KEY);
        this.collapsedFolders = new FolderSet(host.memento,
            MSM_COLLAPSED_FOLDERS_KEY);
        this.folderColors = new FolderColors(host.memento,
            MSM_FOLDER_COLORS_KEY);
    }

    /**
     * Reads the list again and redraws the view.
     *
     * @returns Nothing.
     */
    public refresh(): void {
        this.#listing = undefined;
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
     *          their parents, and those made with New Folder.
     */
    public async folders(): Promise<string[]> {
        const projects = await this.projects();

        return allFolders([
            ...projects.map((node) => { return node.project.folder; }),
            ...this.customFolders.list(),
        ]);
    }

    public getTreeItem(node: MsmProjectsNode): vscode.TreeItem {
        switch (node.kind) {
            case "folder": {
                return this.#folderItem(node);
            }

            case "project": {
                return projectItem(node);
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
                return await this.#folderChildren(ROOT_FOLDER);
            }

            switch (node.kind) {
                case "folder": {
                    return await this.#folderChildren(node.path);
                }

                case "project": {
                    return node.project.exists
                        ? await filesIn(node.project.projectPath) : [];
                }

                default: {
                    return node.directory ? await filesIn(node.path) : [];
                }
            }
        } catch (error) {
            // A tree that throws shows nothing and says nothing.
            reportError(this.host.log, error, "list the MSM projects");

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
        if (node.kind === "file") {
            return undefined;
        }
        const folder = node.kind === "folder"
            ? parentFolder(node.path) : node.project.folder;

        return folder === ROOT_FOLDER ? undefined : {
            kind: "folder",
            path: folder,
            name: folder.split("/").pop() ?? folder,
            // A folder something is in.
            empty: false,
        };
    }

    /**
     * Notes a folder the user collapsed, and redraws it closed.
     *
     * @param node The row collapsed.
     *
     * @returns Nothing.
     */
    public async collapsed(node: MsmProjectsNode): Promise<void> {
        if (node.kind === "folder") {
            await this.collapsedFolders.add(node.path);
            this.#onDidChangeTreeData.fire(node);
        }
    }

    /**
     * Notes a folder the user expanded, and redraws it open.
     *
     * @param node The row expanded.
     *
     * @returns Nothing.
     */
    public async expanded(node: MsmProjectsNode): Promise<void> {
        if (node.kind === "folder"
            && await this.collapsedFolders.delete(node.path)) {
            this.#onDidChangeTreeData.fire(node);
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
        this.refresh();
    }

    /**
     * Removes an empty folder, and what is kept of it.
     *
     * @param folder The folder.
     *
     * @returns Nothing.
     */
    public async removeFolder(folder: IMsmFolderNode): Promise<void> {
        await this.customFolders.remove(folder.path);
        await this.collapsedFolders.remove(folder.path);
        await this.folderColors.remove(folder.path);
        this.refresh();
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
        const dragged = source.filter((node) => {
            return node.kind !== "file";
        });
        if (dragged.length > 0) {
            dataTransfer.set(MSM_PROJECTS_DRAG_MIME,
                new vscode.DataTransferItem(dragged));
        }
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
        const carried: unknown = dataTransfer.get(MSM_PROJECTS_DRAG_MIME)
            ?.value;
        const rows = Array.isArray(carried)
            ? (carried as Array<MsmProjectsNode | undefined>) : [];
        const into = target === undefined ? ROOT_FOLDER : msmFolderOf(target);
        if (into === undefined) {
            return;
        }

        const candidates = rows.filter((node): node is IMsmFolderNode => {
            return node?.kind === "folder" && !isWithin(into, node.path)
                && parentFolder(node.path) !== into;
        });
        const folders = candidates.filter((folder) => {
            return !candidates.some((other) => {
                return other !== folder && isWithin(folder.path, other.path);
            });
        });
        const projects = rows.filter((node): node is IMsmProjectNode => {
            return node?.kind === "project" && !folders.some((folder) => {
                return isWithin(node.project.folder, folder.path);
            });
        });
        if (folders.length === 0 && projects.length === 0) {
            return;
        }

        await this.#refile(folders.map((folder) => {
            return {
                from: folder.path,
                to: normalizeFolder(`${into}/${folder.name}`),
            };
        }), projects.map((node) => {
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
            for (const { projectPath, folder } of all) {
                if (listed.get(projectPath) !== folder) {
                    await api.updateProject(projectPath, { folder });
                    this.host.log(`Moved '${projectPath}' to '${folder}'.`);
                }
            }
            for (const { from, to } of folders) {
                await this.customFolders.move(from, to);
                await this.collapsedFolders.move(from, to);
                await this.folderColors.move(from, to);
            }
        } catch (error) {
            reportError(this.host.log, error, "move the MSM projects");
        } finally {
            this.refresh();
        }
    }

    // --- rows -------------------------------------------------------------

    /**
     * @returns The projects, each with its development version, read side
     *          by side.
     */
    async #list(): Promise<IMsmProjectNode[]> {
        const api = await this.host.msmApi();
        const listed = await api.listProjects();

        return await Promise.all(listed.map(async (project) => {
            const node: IMsmProjectNode = { kind: "project", project };
            if (!project.exists) {
                return node;
            }
            try {
                const info = await api.projectInformation(project.projectPath);

                return { ...node, version: info.currentDevelopmentVersion };
            } catch (error) {
                this.host.log(`Reading the MSM project `
                    + `${project.projectPath} failed: ${String(error)}`);

                return node;
            }
        }));
    }

    /**
     * @param folder A folder of the list; `/` for the top level.
     *
     * @returns Its subfolders, sorted, then its projects, by label.
     */
    async #folderChildren(folder: string): Promise<MsmProjectsNode[]> {
        const projects = await this.projects();
        const folders = await this.folders();
        const subfolders = subfoldersOf(folders, folder).map((path) => {
            return {
                kind: "folder" as const,
                path,
                name: path.split("/").pop() ?? path,
                empty: !projects.some((node) => {
                    return isWithin(node.project.folder, path);
                }),
            };
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
        const open = !this.collapsedFolders.has(node.path);
        const item = new vscode.TreeItem(node.name, open
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `msmFolder:${node.path}`;
        // `.empty` is what offers Remove Folder.
        item.contextValue = node.empty
            ? "mariadbMsmFolder.empty" : "mariadbMsmFolder";
        item.iconPath = new vscode.ThemeIcon(open ? "folder-opened" : "folder");
        item.tooltip = node.path;
        const color = this.folderColors.get(node.path);
        if (color !== undefined) {
            item.resourceUri = colorUriOf(color, "folder", node.path);
        }

        return item;
    }

    public dispose(): void {
        this.#onDidChangeTreeData.dispose();
    }
}

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
    item.id = `msmProject:${project.projectPath}`;
    item.description = projectDescription(node);
    item.contextValue = project.exists
        ? "mariadbMsmProject" : "mariadbMsmProject.missing";
    item.iconPath = new vscode.ThemeIcon(project.exists ? "package" : "warning");
    item.tooltip = [
        project.projectPath,
        project.schemaName === undefined
            ? undefined : `Schema ${project.schemaName}`,
        node.version === undefined
            ? undefined : `Development version ${node.version}`,
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
    item.id = `msmFile:${node.path}`;
    item.resourceUri = uri;
    item.iconPath = node.directory ? vscode.ThemeIcon.Folder
        : vscode.ThemeIcon.File;
    item.contextValue = node.directory
        ? "mariadbMsmDirectory" : "mariadbMsmFile";
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
