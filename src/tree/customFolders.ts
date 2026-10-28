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
    ROOT_FOLDER,
    folderNames,
    normalizeFolder,
} from "../connections/connectionFolders.js";
import { isConnectionColor } from "../connections/connectionDetails.js";
import type { ConnectionColor } from "../mcp/types.js";

/**
 * Sets of connection folders the extension keeps for itself, in its global
 * state so they survive a restart. There are two:
 *
 * * **The folders the user created** that may have nothing in them yet. The
 *   server knows a folder only as the path a connection is filed under, so a
 *   folder made with New Folder has nowhere to live there until a connection
 *   is moved into it. The tree shows these alongside the folders the
 *   connections imply; once a connection is in one, keeping it here too does
 *   no harm - a folder is shown once whichever says it exists.
 * * **The folders the user collapsed.** VS Code does not restore an
 *   extension tree's expanded rows across a restart, and folders are drawn
 *   open by default, so the collapsed ones are the exceptions worth keeping:
 *   a new or renamed folder then comes up open with nothing to look up, and
 *   an entry for a folder that is gone changes nothing.
 *
 * Beside them, **the folders' colors** (`FolderColors`): the server keeps a
 * connection's color in its `connections.json`, but a folder is no entry of
 * its own there, only the path connections are filed under.
 *
 * Global rather than per workspace, like the connections themselves: the
 * view shows the same tree in every window, and two windows should not
 * disagree about it.
 */

/** Where in the global state the created folders are kept. */
export const CUSTOM_FOLDERS_KEY = "mariadb.connections.folders";

/** Where in the global state the collapsed folders are kept. */
export const COLLAPSED_FOLDERS_KEY = "mariadb.connections.collapsedFolders";

/** Where in the global state the folders' colors are kept. */
export const FOLDER_COLORS_KEY = "mariadb.connections.folderColors";

/** The part of `vscode.Memento` this needs, so a test can supply its own. */
export interface IFolderMemento {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

/**
 * A memento that lasts as long as it does: what the folder stores keep to
 * where they were given none, in tests.
 *
 * @returns The memento.
 */
const memoryMemento = (): IFolderMemento => {
    const values = new Map<string, unknown>();

    return {
        get: <T>(key: string, defaultValue: T): T => {
            return values.has(key) ? values.get(key) as T : defaultValue;
        },
        update: (key: string, value: unknown) => {
            values.set(key, value);

            return Promise.resolve();
        },
    };
};

/** A persisted set of folder paths. */
export class FolderSet {
    /**
     * @param memento Where the folders persist. Left out, they last as long
     *                as this object does.
     * @param key The key they are kept under in the memento.
     */
    public constructor(
        private readonly memento: IFolderMemento = memoryMemento(),
        private readonly key = CUSTOM_FOLDERS_KEY,
    ) { }

    /**
     * @returns The folders, normalized and sorted.
     */
    public list(): string[] {
        const stored = this.memento.get<string[]>(this.key, []);

        return [...new Set(stored.map(normalizeFolder))]
            .filter((path) => { return path !== ROOT_FOLDER; })
            .sort((left, right) => { return left.localeCompare(right); });
    }

    /**
     * Adds a folder. Adding one that is there already changes nothing.
     *
     * @param path The folder.
     *
     * @returns Nothing.
     */
    public async add(path: string): Promise<void> {
        const folder = normalizeFolder(path);
        if (folder === ROOT_FOLDER) {
            return;
        }

        await this.#save([...this.list(), folder]);
    }

    /**
     * @param path The folder.
     *
     * @returns Whether it is in the set.
     */
    public has(path: string): boolean {
        return this.list().includes(normalizeFolder(path));
    }

    /**
     * Removes one folder, leaving the folders inside it.
     *
     * @param path The folder.
     *
     * @returns Whether it was in the set.
     */
    public async delete(path: string): Promise<boolean> {
        const folder = normalizeFolder(path);
        const kept = this.list();
        if (!kept.includes(folder)) {
            return false;
        }

        await this.#save(kept.filter((other) => { return other !== folder; }));

        return true;
    }

    /**
     * Removes a folder and every folder inside it.
     *
     * @param path The folder.
     *
     * @returns Nothing.
     */
    public async remove(path: string): Promise<void> {
        const folder = normalizeFolder(path);

        await this.#save(this.list().filter((kept) => {
            return !isWithin(kept, folder);
        }));
    }

    /**
     * Moves a folder and every folder inside it to a new place, keeping
     * where each sits relative to the one moved.
     *
     * @param from The folder being moved.
     * @param to Where it goes, its new path.
     *
     * @returns Nothing.
     */
    public async move(from: string, to: string): Promise<void> {
        const source = normalizeFolder(from);
        const target = normalizeFolder(to);

        await this.#save(this.list().map((kept) => {
            return isWithin(kept, source) ? rebase(kept, source, target) : kept;
        }));
    }

    /**
     * @param folders The folders to keep.
     *
     * @returns Nothing.
     */
    async #save(folders: string[]): Promise<void> {
        await this.memento.update(this.key, [...new Set(folders)]);
    }
}

/**
 * The colors the user gave folders, by path, persisted. A folder is drawn
 * in its color in the Connections view and on its overview tile, as a
 * connection is. The colors are the connections' own, by name.
 */
export class FolderColors {
    /**
     * @param memento Where the colors persist. Left out, they last as long
     *                as this object does.
     */
    public constructor(
        private readonly memento: IFolderMemento = memoryMemento(),
    ) { }

    /**
     * @returns Every colored folder's color, by its normalized path. An
     *          entry that is no folder or no color is left out.
     */
    public all(): Record<string, ConnectionColor> {
        const stored =
            this.memento.get<Record<string, unknown>>(FOLDER_COLORS_KEY, {});
        const colors: Record<string, ConnectionColor> = {};
        for (const [path, color] of Object.entries(stored)) {
            const folder = normalizeFolder(path);
            if (folder !== ROOT_FOLDER && isConnectionColor(color)) {
                colors[folder] = color;
            }
        }

        return colors;
    }

    /**
     * @param path The folder.
     *
     * @returns Its color; undefined for none.
     */
    public get(path: string): ConnectionColor | undefined {
        return this.all()[normalizeFolder(path)];
    }

    /**
     * Gives a folder a color, or takes it away.
     *
     * @param path The folder.
     * @param color Its color; undefined for none.
     *
     * @returns Nothing.
     */
    public async set(
        path: string,
        color: ConnectionColor | undefined,
    ): Promise<void> {
        const folder = normalizeFolder(path);
        if (folder === ROOT_FOLDER) {
            return;
        }

        const colors = this.all();
        if (color === undefined) {
            delete colors[folder];
        } else {
            colors[folder] = color;
        }
        await this.#save(colors);
    }

    /**
     * Takes the color of a folder and every folder inside it away.
     *
     * @param path The folder.
     *
     * @returns Nothing.
     */
    public async remove(path: string): Promise<void> {
        const folder = normalizeFolder(path);

        await this.#save(Object.fromEntries(Object.entries(this.all())
            .filter(([kept]) => { return !isWithin(kept, folder); })));
    }

    /**
     * Moves the colors of a folder and every folder inside it along with
     * it. Where a folder moves onto one that has a color, the one moved
     * keeps its own - or, having none, takes on the other's.
     *
     * @param from The folder being moved.
     * @param to Where it goes, its new path.
     *
     * @returns Nothing.
     */
    public async move(from: string, to: string): Promise<void> {
        const source = normalizeFolder(from);
        const target = normalizeFolder(to);
        const colors = this.all();
        const moved: Record<string, ConnectionColor> = {};
        const kept: Record<string, ConnectionColor> = {};
        for (const [path, color] of Object.entries(colors)) {
            if (isWithin(path, source)) {
                moved[rebase(path, source, target)] = color;
            } else {
                kept[path] = color;
            }
        }

        await this.#save({ ...kept, ...moved });
    }

    /**
     * @param colors The colors to keep.
     *
     * @returns Nothing.
     */
    async #save(colors: Record<string, ConnectionColor>): Promise<void> {
        await this.memento.update(FOLDER_COLORS_KEY, colors);
    }
}

/**
 * Whether a folder is the given one or inside it.
 *
 * @param path The folder to check.
 * @param folder The folder it may be in.
 *
 * @returns True when `path` is `folder` or below it.
 */
export const isWithin = (path: string, folder: string): boolean => {
    const outer = folderNames(folder);
    const inner = folderNames(path);

    return inner.length >= outer.length
        && outer.every((name, index) => { return inner[index] === name; });
};

/**
 * A path inside one folder, moved to the same place inside another.
 *
 * @param path The path, which is `from` or inside it.
 * @param from The folder being moved.
 * @param to Where it goes.
 *
 * @returns The path it has once moved.
 */
export const rebase = (path: string, from: string, to: string): string => {
    const rest = folderNames(path).slice(folderNames(from).length);

    return normalizeFolder([...folderNames(to), ...rest].join("/"));
};
