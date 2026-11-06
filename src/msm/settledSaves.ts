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
 * Runs work for a key once saves of it have settled: Save All saves a
 * project's script and its section files one after the other, and one
 * snapshot is enough for them.
 */
export class SettledSaves {
    readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * @param work What a key's saves lead to; its failure is the caller's
     *             to report.
     * @param delayMs How long saves of a key settle.
     */
    public constructor(
        private readonly work: (key: string) => Promise<void>,
        private readonly delayMs = 300,
    ) {}

    /**
     * Runs the work for a key after the delay, restarting it on each save.
     *
     * @param key What was saved.
     */
    public run(key: string): void {
        clearTimeout(this.#timers.get(key));
        this.#timers.set(key, setTimeout(() => {
            this.#timers.delete(key);
            void this.work(key);
        }, this.delayMs));
    }

    /** Drops the saves waiting. */
    public dispose(): void {
        for (const timer of this.#timers.values()) {
            clearTimeout(timer);
        }
        this.#timers.clear();
    }
}
