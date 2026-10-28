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
    ROOT_FOLDER,
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
    /** Which picture the tile has: MariaDB's, or MySQL's for a MySQL URI. */
    family: "mariadb" | "mysql";
}

/** Everything the page shows. */
export interface IOverviewSnapshot {
    connections: IOverviewConnection[];
    /**
     * The folders the user made and has not filled yet: a folder exists
     * otherwise only as a path a connection is filed under.
     */
    customFolders: string[];
}

/** A folder, as its tile shows it. */
export interface IOverviewFolder {
    /** The whole path, `/Sandboxes/note_app`. */
    path: string;
    /** The last name in it: `note_app`. */
    name: string;
}

/** What one folder holds: its subfolders, sorted, then its connections. */
export interface IOverviewContents {
    folders: IOverviewFolder[];
    connections: IOverviewConnection[];
}

/**
 * @param snapshot The connections and folders.
 * @param folder The folder; `/` for the top level.
 *
 * @returns What the folder holds, as the Connections view shows it:
 *          folders first, then the connections in listing order.
 */
export const folderContents = (
    snapshot: IOverviewSnapshot,
    folder: string,
): IOverviewContents => {
    const depth = folderNames(folder).length;
    const folders = allFolders([
        ...snapshot.connections.map((connection) => { return connection.path; }),
        ...snapshot.customFolders,
    ]).filter((path) => {
        return folderNames(path).length === depth + 1
            && (depth === 0 || path.startsWith(`${folder}/`));
    }).map((path): IOverviewFolder => {
        return { path, name: folderNames(path).at(-1)! };
    });

    return {
        folders,
        connections: snapshot.connections.filter((connection) => {
            return connection.path === folder;
        }),
    };
};

/**
 * @param snapshot The connections and folders.
 * @param folder A folder the page was showing.
 *
 * @returns The folder, or the nearest one above it that is still there -
 *          the top level at last - once it was moved or emptied away.
 */
export const existingFolder = (
    snapshot: IOverviewSnapshot,
    folder: string,
): string => {
    const known = new Set(allFolders([
        ...snapshot.connections.map((connection) => { return connection.path; }),
        ...snapshot.customFolders,
    ]));
    let names = folderNames(folder);
    while (names.length > 0 && !known.has(`/${names.join("/")}`)) {
        names = names.slice(0, -1);
    }

    return names.length === 0 ? ROOT_FOLDER : `/${names.join("/")}`;
};

/**
 * @param folder A folder.
 *
 * @returns The folder it is in; the top level for the top level.
 */
export const parentFolder = (folder: string): string => {
    const names = folderNames(folder).slice(0, -1);

    return names.length === 0 ? ROOT_FOLDER : `/${names.join("/")}`;
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
        return { path: `/${names.slice(0, index + 1).join("/")}`, name };
    });
};
