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
 * The language server's `mariadb/dbCall` requests: with `--mcp` it reads
 * a connection's catalog by asking for `db.*` tool calls, which the
 * extension makes on the MCP server it has, on the connection it has
 * open on that URI - or opens for it.
 */

import { withDefaultScheme } from "../connections/connectionUri.js";
import { OBJECT_TYPES, type IMariaDbApi, type ObjectType } from "../mcp/types.js";

/** The request, server to client. */
export const DB_CALL_REQUEST = "mariadb/dbCall";

/** What the server asks for. */
export interface IDbCallParams {
    /** The connection URI, as the document's context named it. */
    connection: string;
    /** The tool: `db.list_schemas`, `db.list_objects`, ... */
    tool: string;
    /** Its arguments, less `connection_id`, which the extension supplies. */
    arguments: Record<string, unknown>;
}

/**
 * A call that cannot be made. `permanent` says that asking again would
 * fail the same way, so the server does not retry.
 */
export class DbCallError extends Error {
    public constructor(message: string, public readonly permanent: boolean) {
        super(message);
    }
}

/** What answering needs from the rest of the extension. */
export interface IDbCallHost {
    /** The configured connections' URIs. */
    listConnections(): Promise<string[]>;
    /**
     * @param uri A configured connection.
     *
     * @returns The UUID of a connection open on it, opened if need be.
     */
    connect(uri: string): Promise<string>;
    /** The MCP server's API, starting it if need be. */
    api(): Promise<IMariaDbApi>;
    /** Notes what was refused, where a mismatch would otherwise go unseen. */
    log(message: string): void;
}

/** The tools the server may ask for; anything else is refused. */
const TOOLS = new Set([
    "db.list_schemas",
    "db.list_objects",
    "db.get_object_details",
    "db.execute_sql",
]);

/**
 * A statement as it is compared: runs of blanks as one space, no blanks
 * or `;` at the ends - so the server may lay its statement out anew.
 *
 * @param sql The statement.
 *
 * @returns Its comparable form.
 */
const normalized = (sql: string): string => {
    return sql.replace(/\s+/gu, " ").trim().replace(/\s*;$/u, "");
};

/**
 * The statements `db.execute_sql` may run, compared as {@link normalized}
 * says: the server's own, so it cannot run anything else on the user's
 * credentials. Kept in sync by hand with lsp-server (`k_server_sql` in
 * `libs/mariadblanguageserver/src/mcp_catalog.cc`): a statement the server
 * adds or changes there is refused here until this list has it too.
 */
export const ALLOWED_SQL: ReadonlySet<string> = new Set([
    "SELECT @@sql_mode AS sql_mode, VERSION() AS version, DATABASE() AS schema_name",
]);

const ALLOWED = new Set([...ALLOWED_SQL].map(normalized));

const text = (args: Record<string, unknown>, name: string): string => {
    const value = args[name];
    if (typeof value !== "string") {
        throw new DbCallError(`${name} has to be a string`, true);
    }

    return value;
};

const objectType = (args: Record<string, unknown>): ObjectType => {
    const value = text(args, "object_type");
    if (!(OBJECT_TYPES as readonly string[]).includes(value)) {
        throw new DbCallError(`${value} is not an object type`, true);
    }

    return value as ObjectType;
};

/**
 * Makes the call the server asked for.
 *
 * @param host The connections and the API.
 * @param params What the server asked for.
 *
 * @returns The tool's result, as the typed API decodes it.
 */
export const answerDbCall = async (
    host: IDbCallHost,
    params: IDbCallParams,
): Promise<unknown> => {
    if (!TOOLS.has(params.tool)) {
        throw new DbCallError(
            `the extension does not serve ${params.tool}`, true);
    }
    // Checked before anything is opened for it.
    if (params.tool === "db.execute_sql") {
        const sql = text(params.arguments, "sql");
        if (!ALLOWED.has(normalized(sql))) {
            // Refused for good, so the server will not say it again: a
            // server newer than ALLOWED_SQL shows here, or nowhere.
            host.log("Refused SQL the language server asked to run, which "
                + "is not in ALLOWED_SQL (src/lsp/dbCall.ts; a mariadb-lsp "
                + `newer than this extension?): ${sql}`);
            throw new DbCallError(
                "the extension runs only the server's own statements", true);
        }
    }
    // Only a configured connection is opened: the URI came out of a file's
    // header, and the server would retry one that is not there yet - it
    // may be added later.
    const wanted = withDefaultScheme(params.connection);
    const configured = (await host.listConnections()).find((uri) => {
        return withDefaultScheme(uri) === wanted;
    });
    if (configured === undefined) {
        throw new DbCallError(
            `${params.connection} is not a configured connection`, false);
    }
    const [api, connectionId] = await Promise.all([
        host.api(),
        host.connect(configured),
    ]);
    const args = params.arguments;
    switch (params.tool) {
        case "db.list_schemas":
            return await api.listSchemas(connectionId);
        case "db.list_objects":
            return await api.listObjects(connectionId,
                text(args, "schema_name"), objectType(args));
        case "db.get_object_details":
            return await api.getObjectDetails(connectionId,
                text(args, "schema_name"), text(args, "object_name"),
                objectType(args));
        default:
            return await api.executeSql(connectionId, text(args, "sql"));
    }
};
