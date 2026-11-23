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
 * The connections whose system schemas (`mysql`, `information_schema`,
 * `performance_schema`, `sys`) the Connections view leaves out, kept
 * across restarts. Shown by default, as they always were.
 */

import { withDefaultScheme } from "../connections/connectionUri.js";
import { memoryMemento, type IFolderMemento } from "./customFolders.js";

/** The memento key the connections are kept under. */
export const HIDDEN_SYSTEM_SCHEMAS_KEY =
    "mariadb.connections.hiddenSystemSchemas";

export class SystemSchemaVisibility {
    /**
     * @param memento Where the choice persists. Left out, it lasts as long
     *                as this object does.
     */
    public constructor(
        private readonly memento: IFolderMemento = memoryMemento(),
    ) { }

    /**
     * @param uri A connection.
     *
     * @returns Whether its system schemas are left out.
     */
    public hides(uri: string): boolean {
        return this.#list().includes(withDefaultScheme(uri));
    }

    /**
     * @param uri A connection.
     * @param hidden Whether its system schemas are to be left out.
     *
     * @returns Nothing.
     */
    public async set(uri: string, hidden: boolean): Promise<void> {
        const key = withDefaultScheme(uri);
        const others = this.#list().filter((listed) => {
            return listed !== key;
        });
        await this.memento.update(HIDDEN_SYSTEM_SCHEMAS_KEY,
            hidden ? [...others, key] : others);
    }

    #list(): string[] {
        return this.memento.get<string[]>(HIDDEN_SYSTEM_SCHEMAS_KEY, []);
    }
}
