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

import { describe, expect, it } from "vitest";

import {
    ALLOWED_SQL,
    answerDbCall,
    DbCallError,
    type IDbCallHost,
} from "../../lsp/dbCall.js";
import { createFakeApi, type FakeApi } from "../helpers.js";

/** A host with one configured connection, open on demand. */
const host = (api: FakeApi, connections = ["dba@localhost:3310"]): IDbCallHost & {
    opened: string[];
} => {
    const opened: string[] = [];

    return {
        opened,
        listConnections: () => {
            return Promise.resolve(connections);
        },
        connect: (uri) => {
            opened.push(uri);

            return Promise.resolve("conn-1");
        },
        api: () => {
            return Promise.resolve(api);
        },
    };
};

describe("answerDbCall", () => {
    it("makes the typed call on the connection open on the URI", async () => {
        const api = createFakeApi({
            schemas: [{ schema_name: "store", schema_type: "User Schema",
                schema_comment: "" }],
            objects: { "store/table": [{ name: "item", comment: "" }] },
            details: {
                "store.item": {
                    basic: { schema: "store", name: "item", type: "table" },
                    columns: [],
                },
            },
        });
        const h = host(api);
        // The scheme the server adds is no different connection.
        const connection = "mariadb://dba@localhost:3310";
        await expect(answerDbCall(h, {
            connection, tool: "db.list_schemas", arguments: {},
        })).resolves.toEqual([{ schema_name: "store", schema_type: "User Schema",
            schema_comment: "" }]);
        await expect(answerDbCall(h, {
            connection, tool: "db.list_objects",
            arguments: { schema_name: "store", object_type: "table" },
        })).resolves.toEqual([{ name: "item", comment: "" }]);
        await expect(answerDbCall(h, {
            connection, tool: "db.get_object_details",
            arguments: { schema_name: "store", object_name: "item",
                object_type: "table" },
        })).resolves.toMatchObject({ basic: { name: "item" } });
        await expect(answerDbCall(h, {
            connection, tool: "db.execute_sql",
            arguments: { sql: [...ALLOWED_SQL][0] },
        })).resolves.toMatchObject({ result_sets: [expect.anything()] });
        // Opened as it is configured, not as the server spelled it.
        expect(new Set(h.opened)).toEqual(new Set(["dba@localhost:3310"]));
        expect(api.lookups).toEqual(["store.item:table"]);
    });

    it("refuses a connection that is not configured, to be asked again",
        async () => {
            const h = host(createFakeApi());
            await expect(answerDbCall(h, {
                connection: "mariadb://nobody@elsewhere:3306",
                tool: "db.list_schemas", arguments: {},
            })).rejects.toMatchObject({
                message: "mariadb://nobody@elsewhere:3306 is not a configured "
                    + "connection",
                permanent: false,
            });
            expect(h.opened).toEqual([]);
        });

    it("refuses other tools and bad arguments for good", async () => {
        const h = host(createFakeApi());
        const connection = "dba@localhost:3310";
        await expect(answerDbCall(h, {
            connection, tool: "db.execute_sql_script",
            arguments: { sql_script: "DROP DATABASE store" },
        })).rejects.toSatisfy((error: unknown) => {
            return error instanceof DbCallError && error.permanent;
        });
        await expect(answerDbCall(h, {
            connection, tool: "db.list_objects",
            arguments: { schema_name: "store", object_type: "user" },
        })).rejects.toMatchObject({ permanent: true });
        await expect(answerDbCall(h, {
            connection, tool: "db.execute_sql", arguments: { sql: 42 },
        })).rejects.toMatchObject({ permanent: true });
    });

    it("runs no SQL but the server's own, and opens nothing for it",
        async () => {
            const h = host(createFakeApi());
            for (const sql of ["DROP DATABASE store", "SELECT @@sql_mode",
                ` ${[...ALLOWED_SQL][0]}`]) {
                await expect(answerDbCall(h, {
                    connection: "dba@localhost:3310", tool: "db.execute_sql",
                    arguments: { sql },
                })).rejects.toMatchObject({
                    message: "the extension runs only the server's own "
                        + "statements",
                    permanent: true,
                });
            }
            expect(h.opened).toEqual([]);
        });
});
