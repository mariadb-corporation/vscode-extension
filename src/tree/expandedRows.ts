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


import type { IFolderMemento } from "./customFolders.js";

/**
 * The rows of a tree the user left expanded, by their item ids, kept in a
 * memento: VS Code does not reopen an extension's tree rows after a
 * restart, so the tree draws these expanded.
 */
export class ExpandedRows {
    /**
     * @param memento Where the ids persist.
     * @param key The key they are kept under.
     */
    public constructor(
        private readonly memento: IFolderMemento,
        private readonly key: string,
    ) { }

    /**
     * @param id A row's item id.
     *
     * @returns Whether it was left expanded.
     */
    public has(id: string): boolean {
        return this.#ids().includes(id);
    }

    /**
     * @param id A row expanded.
     *
     * @returns Once kept.
     */
    public async add(id: string): Promise<void> {
        if (!this.has(id)) {
            await this.memento.update(this.key, [...this.#ids(), id]);
        }
    }

    /**
     * @param id A row collapsed.
     *
     * @returns Once kept.
     */
    public async delete(id: string): Promise<void> {
        if (this.has(id)) {
            await this.memento.update(this.key, this.#ids().filter((kept) => {
                return kept !== id;
            }));
        }
    }

    /**
     * Forgets the rows of what is gone.
     *
     * @param keep Whether a row's id is of something still there.
     *
     * @returns Once kept.
     */
    public async prune(keep: (id: string) => boolean): Promise<void> {
        const ids = this.#ids();
        const kept = ids.filter(keep);
        if (kept.length !== ids.length) {
            await this.memento.update(this.key, kept);
        }
    }

    #ids(): string[] {
        return this.memento.get<string[]>(this.key, []);
    }
}
