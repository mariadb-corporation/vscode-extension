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
 * The current schema of each connection: the one its editors run in.
 *
 * It starts as the schema the connection's URI names. The Connections
 * view's Set As Current Schema changes it, and so does a run whose `USE`
 * (or `DROP DATABASE`) the editors' session reported - the binding reads
 * `DATABASE()` after such a run. A schema picked in the view is put into
 * each editors' session by a `USE` before that session's next run
 * (`pending`, then `reported`), so a session opened later starts there
 * too. It is also the schema the language server is told the editors are
 * in (`changed`).
 *
 * Kept while anything is open on the connection, the tree's session
 * included: closed altogether, its next sessions start from the URI's
 * schema again, and so does this.
 */

import type { ConnectionManager } from "./connectionManager.js";
import { parseConnectionUri, withDefaultScheme } from "./connectionUri.js";

/** Called with the URI of a connection whose current schema changed. */
export type CurrentSchemaListener = (uri: string) => void;

interface ICurrentSchemaState {
    /** The current schema; null where none is in use. */
    schema: string | null;
    /** The sessions known to be in it. */
    inSchema: Set<string>;
}

/** What this needs of the connection manager. */
export type CurrentSchemaConnections = Pick<ConnectionManager,
    "onDidChange" | "openConnections">;

/**
 * @param uri A connection URI.
 *
 * @returns The schema it names; undefined where it names none.
 */
export const schemaOfUri = (uri: string): string | undefined => {
    try {
        const schema = parseConnectionUri(uri).schema.trim();

        return schema === "" ? undefined : schema;
    } catch {
        return undefined;
    }
};

export class CurrentSchemas {
    /** Normalized connection URI -> what was picked or reported. */
    readonly #states = new Map<string, ICurrentSchemaState>();
    readonly #listeners = new Set<CurrentSchemaListener>();
    readonly #unsubscribe: () => void;

    public constructor(
        private readonly connections: CurrentSchemaConnections,
    ) {
        this.#unsubscribe = connections.onDidChange(() => {
            this.#forgetClosed();
        });
    }

    /**
     * @param uri The connection.
     *
     * @returns Its current schema: the one picked or last reported, else
     *          the one its URI names; undefined for none.
     */
    public of(uri: string): string | undefined {
        const state = this.#states.get(withDefaultScheme(uri));
        if (state === undefined) {
            return schemaOfUri(uri);
        }

        return state.schema ?? undefined;
    }

    /**
     * @param uri The connection.
     *
     * @returns The schema picked or reported since it was opened - null
     *          for none in use - or undefined where its sessions are still
     *          in the URI's own.
     */
    public changed(uri: string): string | null | undefined {
        return this.#states.get(withDefaultScheme(uri))?.schema;
    }

    /**
     * Makes a schema the current one, as Set As Current Schema does. Each
     * editors' session is moved into it before its next run.
     *
     * @param uri The connection.
     * @param schema The schema.
     *
     * @returns Nothing.
     */
    public set(uri: string, schema: string): void {
        const state = this.#stateOf(uri);
        if (state.schema === schema) {
            return;
        }
        state.schema = schema;
        state.inSchema.clear();
        this.#changed(uri);
    }

    /**
     * Takes the schema a session is in: reported after a run that may have
     * changed it, or put into with a `USE`.
     *
     * @param uri The connection.
     * @param connectionId The session.
     * @param schema `DATABASE()`: null when none is in use.
     *
     * @returns Nothing.
     */
    public reported(
        uri: string,
        connectionId: string,
        schema: string | null,
    ): void {
        const state = this.#stateOf(uri);
        if (state.schema === schema) {
            state.inSchema.add(connectionId);

            return;
        }
        // Every other session is moved into it before its next run.
        state.schema = schema;
        state.inSchema = new Set([connectionId]);
        this.#changed(uri);
    }

    /**
     * @param uri The connection.
     * @param connectionId An editors' session on it, about to run.
     *
     * @returns The schema to `USE` on it first; undefined where it is in
     *          the current one already, or nothing was picked.
     */
    public pending(uri: string, connectionId: string): string | undefined {
        const state = this.#states.get(withDefaultScheme(uri));
        if (state === undefined || state.schema === null) {
            return undefined;
        }

        return state.inSchema.has(connectionId) ? undefined : state.schema;
    }

    /**
     * @param listener Called with the URI of a connection whose current
     *        schema changed.
     *
     * @returns A function that stops listening.
     */
    public onDidChange(listener: CurrentSchemaListener): () => void {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    }

    public dispose(): void {
        this.#unsubscribe();
        this.#listeners.clear();
    }

    #stateOf(uri: string): ICurrentSchemaState {
        const key = withDefaultScheme(uri);
        let state = this.#states.get(key);
        if (state === undefined) {
            state = { schema: schemaOfUri(uri) ?? null, inSchema: new Set() };
            this.#states.set(key, state);
        }

        return state;
    }

    /**
     * Drops what is kept of a connection nothing is open on any more: its
     * next sessions start in its URI's schema.
     *
     * @returns Nothing.
     */
    #forgetClosed(): void {
        const open = new Set(this.connections.openConnections.map((uri) => {
            return withDefaultScheme(uri);
        }));
        for (const key of [...this.#states.keys()]) {
            if (!open.has(key)) {
                this.#states.delete(key);
                this.#changed(key);
            }
        }
    }

    #changed(uri: string): void {
        for (const listener of this.#listeners) {
            listener(uri);
        }
    }
}
