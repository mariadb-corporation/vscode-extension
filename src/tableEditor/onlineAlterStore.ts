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
 * A live table's online ALTER TABLE entry, kept by VS Code in the
 * workspace's state: a live table has no project to keep it in. A
 * project's table keeps its entry in msm.project.json, through msm.
 */

import type { IFolderMemento } from "../tree/customFolders.js";
import type { IOnlineAlterEntry } from "./onlineAlter.js";

/** The workspace state's key: the entries, by table. */
export const ONLINE_ALTER_KEY = "mariadb.onlineAlterTables";

/** A live table: its connection, schema and name. */
export interface ILiveTable {
    connection: string;
    schema: string;
    table: string;
}

/**
 * @param table A live table.
 *
 * @returns What its entry is kept under.
 */
const keyOf = (table: ILiveTable): string => {
    return JSON.stringify([table.connection, table.schema, table.table]);
};

export class OnlineAlterStore {
    public constructor(private readonly memento: IFolderMemento) { }

    /**
     * @param table A live table.
     *
     * @returns Its entry; empty where it has none.
     */
    public get(table: ILiveTable): IOnlineAlterEntry {
        const entry = this.#all()[keyOf(table)];

        return typeof entry === "object" && entry !== null ? entry : {};
    }

    /**
     * @param table A live table.
     * @param entry Its entry; empty, it is dropped and the table takes
     *              msm's defaults.
     *
     * @returns Once it is kept.
     */
    public async set(table: ILiveTable, entry: IOnlineAlterEntry):
        Promise<void> {
        const { [keyOf(table)]: _old, ...others } = this.#all();
        await this.memento.update(ONLINE_ALTER_KEY,
            Object.keys(entry).length === 0
                ? others : { ...others, [keyOf(table)]: entry });
    }

    /**
     * Moves a renamed table's entry to its new name.
     *
     * @param table The table, by its old name.
     * @param name Its new name.
     *
     * @returns Once it is moved.
     */
    public async rename(table: ILiveTable, name: string): Promise<void> {
        const { [keyOf(table)]: entry, ...others } = this.#all();
        if (entry === undefined) {
            return;
        }
        // One write: the entry is never dropped without being moved.
        await this.memento.update(ONLINE_ALTER_KEY,
            { ...others, [keyOf({ ...table, table: name })]: entry });
    }

    #all(): Record<string, IOnlineAlterEntry> {
        const all = this.memento.get<unknown>(ONLINE_ALTER_KEY, {});

        return typeof all === "object" && all !== null
            ? all as Record<string, IOnlineAlterEntry> : {};
    }
}
