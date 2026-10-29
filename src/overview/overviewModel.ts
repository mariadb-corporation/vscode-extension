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

import {
    allFolders,
    folderNames,
    normalizeFolder,
    parentFolder,
    ROOT_FOLDER,
    subfoldersOf,
} from "../connections/connectionFolders.js";
import type { ConnectionKind, ConnectionColor } from "../mcp/types.js";

/**
 * What the MariaDB Workbench overview shows: every connection and every
 * folder at once, so the page walks the folders without asking the host
 * again. Pure; shared by the webview and the host.
 */

/** One connection, as its tile shows it. */
export interface IOverviewConnection {
    uri: string;
    /** Which list it is in: with the URI, what identifies it. */
    kind: ConnectionKind;
    /** The folder it is filed in; `/` for the top level. */
    path: string;
    /** What the tile is headed; the address where it has no caption. */
    caption?: string;
    color?: ConnectionColor;
    /** `user@host:port/schema`: the URI without scheme and options. */
    address: string;
    isDefault: boolean;
    /**
     * The picture the tile has: the Connections view's icon for the
     * connection, by its scheme and whether it is the default - its file
     * under `images/light` without the extension, `connectionMariaDBSSH`.
     */
    icon: string;
}

/** Everything the page shows. */
export interface IOverviewSnapshot {
    connections: IOverviewConnection[];
    /**
     * The folders the user made and has not filled yet: a folder exists
     * otherwise only as a path a connection is filed under.
     */
    customFolders: string[];
    /** The colors the user gave folders, by path. */
    folderColors: Record<string, ConnectionColor>;
}

/** A folder, as its tile shows it. */
export interface IOverviewFolder {
    /** The whole path, `/Sandboxes/note_app`. */
    path: string;
    /** The last name in it: `note_app`. */
    name: string;
    color?: ConnectionColor;
}

/** What one folder holds: its subfolders, sorted, then its items. */
export interface IOverviewContents<T> {
    folders: IOverviewFolder[];
    items: T[];
}

/**
 * One entry of a deployment's menu: a command of the Deployments view, and
 * the row it runs on.
 */
export interface IOverviewCommand {
    command: string;
    /** Its title, as the view's menu has it. */
    title: string;
    /** The REST Daemon it runs on; the sandbox, where there is none. */
    directory?: string;
}

/**
 * A deployment - a sandbox, so far - as its tile shows it: what the
 * Deployments view's row says, its icon, and its menu, all as the host
 * worked them out.
 */
export interface IOverviewDeployment {
    /** The sandbox's port, which names it. */
    port: number;
    /** The folder it is in, as the Deployments view files it: `/Sandboxes`. */
    path: string;
    /** Its version and state, and its REST Daemons'. */
    description: string;
    /** Its row's codicon, `vm-running`, with `~spin` while busy. */
    icon: string;
    /** The theme color its icon is drawn in, if any: `testing.iconPassed`. */
    iconColor?: string;
    /**
     * What its menu offers now: the sandbox's commands, then each REST
     * Daemon's, a group apiece.
     */
    menu: IOverviewCommand[][];
}

/**
 * @param folders Every folder there is.
 * @param folder A folder the page was showing.
 *
 * @returns The folder, or the nearest one above it that is still there -
 *          the top level at last - once it was moved or emptied away.
 */
const nearestFolder = (folders: string[], folder: string): string => {
    const known = new Set(folders);
    let shown = normalizeFolder(folder);
    while (shown !== ROOT_FOLDER && !known.has(shown)) {
        shown = parentFolder(shown);
    }

    return shown;
};

/**
 * @param items Connections or deployments, each with its folder.
 * @param extraFolders Folders there are with nothing in them.
 *
 * @returns Every folder there is, parents included.
 */
const foldersOf = (
    items: ReadonlyArray<{ path: string }>,
    extraFolders: readonly string[],
): string[] => {
    return allFolders([
        ...items.map((item) => { return item.path; }),
        ...extraFolders,
    ]);
};

/**
 * What one folder holds, as the Connections and Deployments views show
 * it: folders first, then the items in listing order.
 *
 * @param items The connections or the deployments.
 * @param folder The folder; `/` for the top level.
 * @param extraFolders Folders there are with nothing in them - the ones
 *        made with New Folder.
 * @param colors The colors folders were given, by path.
 *
 * @returns Its folders and items.
 */
export const folderContents = <T extends { path: string }>(
    items: readonly T[],
    folder: string,
    extraFolders: readonly string[] = [],
    colors: Readonly<Record<string, ConnectionColor>> = {},
): IOverviewContents<T> => {
    return {
        folders: subfoldersOf(foldersOf(items, extraFolders), folder)
            .map((path): IOverviewFolder => {
                const color = colors[path];

                return {
                    path,
                    name: folderNames(path).at(-1)!,
                    ...(color === undefined ? {} : { color }),
                };
            }),
        items: items.filter((item) => { return item.path === folder; }),
    };
};

/**
 * The folder a section starts in, until the user picks one: the folder of
 * its one connection or deployment, where it has just one - the sandbox a
 * first deployment made and its connection, both filed under `/Sandboxes`,
 * a click away - else the top level.
 *
 * @param items The connections or the deployments.
 *
 * @returns The folder to show.
 */
export const startingFolder = (
    items: ReadonlyArray<{ path: string }>,
): string => {
    return items.length === 1 ? items[0].path : ROOT_FOLDER;
};

/**
 * @param items The connections or the deployments.
 * @param folder A folder the page was showing; none where the user has
 *        not picked one, and the section is in its `startingFolder`.
 * @param extraFolders Folders there are with nothing in them.
 *
 * @returns The folder, or the nearest one above it that is still there.
 */
export const existingFolder = (
    items: ReadonlyArray<{ path: string }>,
    folder: string | undefined,
    extraFolders: readonly string[] = [],
): string => {
    return nearestFolder(foldersOf(items, extraFolders),
        folder ?? startingFolder(items));
};

/**
 * @param folder A folder.
 *
 * @returns The way to it from the top level, a step per folder, as the
 *          breadcrumb above the tiles shows it.
 */
export const folderTrail = (folder: string): IOverviewFolder[] => {
    const names = folderNames(folder);

    return names.map((name, index) => {
        return {
            path: normalizeFolder(names.slice(0, index + 1).join("/")),
            name,
        };
    });
};
