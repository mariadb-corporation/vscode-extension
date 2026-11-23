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

import { memoryMemento } from "../../tree/customFolders.js";
import {
    HIDDEN_SYSTEM_SCHEMAS_KEY,
    SystemSchemaVisibility,
} from "../../tree/systemSchemas.js";

describe("SystemSchemaVisibility", () => {
    it("shows them by default, and keeps a connection's choice", async () => {
        const memento = memoryMemento();
        const visibility = new SystemSchemaVisibility(memento);
        expect(visibility.hides("dba@localhost:3310")).toBe(false);

        await visibility.set("dba@localhost:3310", true);
        await visibility.set("dba@localhost:3310", true);

        // Kept once, under the URI with its scheme, so either spelling is
        // the same connection.
        expect(memento.get(HIDDEN_SYSTEM_SCHEMAS_KEY, []))
            .toEqual(["mariadb://dba@localhost:3310"]);
        expect(new SystemSchemaVisibility(memento)
            .hides("mariadb://dba@localhost:3310")).toBe(true);
        expect(visibility.hides("app@localhost:3311")).toBe(false);

        await visibility.set("dba@localhost:3310", false);
        expect(visibility.hides("dba@localhost:3310")).toBe(false);
    });
});
