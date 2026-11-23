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
    ConnectionManager,
    UI_BACKEND_SESSION,
} from "../../connections/connectionManager.js";
import {
    CurrentSchemas,
    schemaOfUri,
} from "../../connections/currentSchemas.js";
import { createFakeApi, createFakeSettings } from "../helpers.js";

const WORLD = "mariadb://dba@localhost:3310/world";

const createSchemas = () => {
    const api = createFakeApi({
        connections: [WORLD],
        connectionIds: { [WORLD]: "uuid-world" },
    });
    const connections = new ConnectionManager(
        () => { return Promise.resolve(api); },
        createFakeSettings(),
    );
    const schemas = new CurrentSchemas(connections);
    const changed: string[] = [];
    schemas.onDidChange((uri) => { changed.push(uri); });

    return { connections, schemas, changed };
};

describe("schemaOfUri", () => {
    it("reads the schema a URI names", () => {
        expect(schemaOfUri(WORLD)).toBe("world");
        expect(schemaOfUri("dba@localhost:3310/my%20db")).toBe("my db");
        expect(schemaOfUri("dba@localhost:3310")).toBeUndefined();
        expect(schemaOfUri("dba@localhost:3310/?ssl-mode=REQUIRED"))
            .toBeUndefined();
    });
});

describe("CurrentSchemas", () => {
    it("starts with the schema the URI names", () => {
        const { schemas } = createSchemas();

        expect(schemas.of(WORLD)).toBe("world");
        expect(schemas.changed(WORLD)).toBeUndefined();
        expect(schemas.pending(WORLD, "uuid-1")).toBeUndefined();
    });

    it("takes a pick, and has each session USE it once", async () => {
        const { connections, schemas, changed } = createSchemas();
        await connections.connect(WORLD, UI_BACKEND_SESSION);

        schemas.set(WORLD, "shop");

        expect(schemas.of(WORLD)).toBe("shop");
        expect(changed).toEqual([WORLD]);
        expect(schemas.pending(WORLD, "uuid-1")).toBe("shop");
        // Put into it with a USE.
        schemas.reported(WORLD, "uuid-1", "shop");
        expect(schemas.pending(WORLD, "uuid-1")).toBeUndefined();
        // Another session has not been moved yet.
        expect(schemas.pending(WORLD, "uuid-2")).toBe("shop");
        // Picking it again is no change.
        schemas.set(WORLD, "shop");
        expect(changed).toHaveLength(1);
    });

    it("follows what a session reported after a USE", async () => {
        const { connections, schemas, changed } = createSchemas();
        await connections.connect(WORLD);

        schemas.reported(WORLD, "uuid-1", "shop");

        expect(schemas.of(WORLD)).toBe("shop");
        expect(changed).toEqual([WORLD]);
        // The session that reported it is in it already.
        expect(schemas.pending(WORLD, "uuid-1")).toBeUndefined();
    });

    it("has no current schema once the one in use is dropped", async () => {
        const { connections, schemas } = createSchemas();
        await connections.connect(WORLD);
        schemas.reported(WORLD, "uuid-2", "world");

        schemas.reported(WORLD, "uuid-1", null);

        expect(schemas.of(WORLD)).toBeUndefined();
        expect(schemas.changed(WORLD)).toBeNull();
        // Nothing to USE.
        expect(schemas.pending(WORLD, "uuid-2")).toBeUndefined();
    });

    it("goes back to the URI's schema once the connection is closed",
        async () => {
            const { connections, schemas, changed } = createSchemas();
            await connections.connect(WORLD, UI_BACKEND_SESSION);
            schemas.set(WORLD, "shop");

            await connections.disconnect(WORLD);

            expect(schemas.of(WORLD)).toBe("world");
            expect(changed).toEqual([WORLD, WORLD]);
        });

    it("keeps one connection's pick apart from another's", async () => {
        const { connections, schemas } = createSchemas();
        await connections.connect(WORLD, UI_BACKEND_SESSION);

        schemas.set(WORLD, "shop");

        expect(schemas.of("mariadb://app@localhost:3311/app")).toBe("app");
        // A URI written without its scheme is the same connection.
        expect(schemas.of("dba@localhost:3310/world")).toBe("shop");
    });
});
