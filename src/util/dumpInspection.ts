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

import type { IDumpInfo, UtilOptions } from "../mcp/utilApi.js";
import { errorText } from "../text.js";
import {
    dumpProblem,
    initialExcluded,
    loadFilters,
    schemasToComplete,
    selectionProblem,
    withFullSchema,
} from "./dumpSelection.js";
import type { IUtilProblem } from "./utilFields.js";
import type { IDumpRead, IUtilInspectedMessage } from "./utilProtocol.js";

/** Reads a dump's metadata: `util.inspect_dump`. */
export type InspectDump = (url: string, schema?: string) => Promise<IDumpInfo>;

/**
 * A load dialog's dump: what it holds, read with `util.inspect_dump`, and
 * the load options its Objects tab comes to. The dialog panel hands the
 * dialog's messages on to it and posts what it answers.
 *
 * Only the newest read of a path counts. A schema's every name is read
 * once per dump, however often it is asked for, and merged into the dump
 * as it is then.
 */
export class DumpInspection {
    #read: IDumpRead | undefined;
    /** Counts the reads, so that only the newest one's answer is kept. */
    #reads = 0;
    /** The schemas being read, or read, with every name, for this dump. */
    #schemas = new Map<string, Promise<void>>();

    /**
     * @param inspect Reads a dump.
     * @param intoSchema The schema Load Table Dump loads into, if any.
     * @param log Where a failed read of a schema's names goes.
     */
    public constructor(
        private readonly inspect: InspectDump,
        private readonly intoSchema: string | undefined,
        private readonly log: (message: string) => void,
    ) { }

    /**
     * Reads what the dump at a path holds.
     *
     * @param path The dump's folder or zip.
     *
     * @returns The dialog's message, with the boxes to start with; or
     *          undefined where a newer read has the say.
     */
    public async read(path: string): Promise<IUtilInspectedMessage | undefined> {
        const read = ++this.#reads;
        this.#schemas.clear();

        let dump: IDumpRead = { path };
        if (path !== "") {
            try {
                dump = { path, info: await this.inspect(path) };
            } catch (error) {
                dump = { path, error: errorText(error) };
            }
        }
        if (read !== this.#reads) {
            return undefined;
        }
        this.#read = dump;

        return {
            type: "inspected", ...dump,
            ...(dump.info === undefined ? {}
                : { excluded: initialExcluded(dump.info, this.intoSchema) }),
        };
    }

    /**
     * Reads every name of one of the dump's schemas, where it listed only
     * some.
     *
     * @param schema The schema.
     *
     * @returns The dialog's message with the dump as it is now, or
     *          undefined where it could not be read or another dump was
     *          read meanwhile.
     */
    public async readSchema(
        schema: string,
    ): Promise<IUtilInspectedMessage | undefined> {
        const path = this.#read?.path;
        try {
            await this.#complete(schema);
        } catch (error) {
            this.log(`Could not read every name of ${schema} in `
                + `${path ?? ""}: ${errorText(error)}`);

            return undefined;
        }

        return this.#read?.path === path && this.#read?.info !== undefined
            ? { type: "inspected", ...this.#read } : undefined;
    }

    /**
     * The options a load gets from what the dump holds and what is
     * unticked, where it can be loaded where the dialog was opened.
     *
     * @param path The dump's folder or zip.
     * @param excluded The boxes unticked.
     *
     * @returns The options, or why it cannot be loaded.
     */
    public async loadOptions(path: string, excluded: string[]): Promise<{
        options: UtilOptions;
    } | { problem: IUtilProblem }> {
        if (this.#read?.path !== path) {
            await this.read(path);
        }
        const info = this.#read?.info;
        if (info === undefined) {
            return { problem: { field: "path",
                message: this.#read?.error ?? "This is not a dump." } };
        }
        const problem = dumpProblem(info, this.intoSchema)
            ?? selectionProblem(info, excluded, this.intoSchema);
        if (problem !== undefined) {
            return { problem: { field: "path", message: problem } };
        }

        // A whole kind of objects unticked needs every name of it.
        await Promise.all(schemasToComplete(info, excluded).map((schema) => {
            return this.#complete(schema);
        }));

        return {
            options: loadFilters(this.#read!.info!, excluded, this.intoSchema),
        };
    }

    /**
     * Reads a schema's every name, once per dump, into the dump.
     *
     * @param schema The schema.
     */
    async #complete(schema: string): Promise<void> {
        const read = this.#read;
        if (read?.info === undefined) {
            return;
        }
        let reading = this.#schemas.get(schema);
        if (reading === undefined) {
            reading = (async () => {
                const full = await this.inspect(read.path, schema);
                // Into the dump as it is now: other schemas may have been
                // read meanwhile.
                if (this.#read?.path === read.path
                    && this.#read.info !== undefined) {
                    this.#read = { path: read.path,
                        info: withFullSchema(this.#read.info, full) };
                }
            })();
            this.#schemas.set(schema, reading);
            // A failed read may be tried again.
            reading.catch(() => {
                if (this.#schemas.get(schema) === reading) {
                    this.#schemas.delete(schema);
                }
            });
        }
        await reading;
    }
}
