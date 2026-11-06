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

import { liveDetails } from "../../details/objectDetails.js";
import type { IObjectDetails } from "../../mcp/types.js";

const basic = (name: string, type: string): IObjectDetails["basic"] => {
    return { schema: "shop", name, type, comment: null };
};

describe("a live object's details", () => {
    it("has a table's keys from its constraints and the foreign keys it "
        + "holds, not those onto it", () => {
        const body = liveDetails({
            basic: basic("orders", "table"),
            columns: [],
            constraints: [
                { constraint_name: "PRIMARY", constraint_type: "PRIMARY KEY",
                    column_name: "id" },
                { constraint_name: "PRIMARY", constraint_type: "PRIMARY KEY",
                    column_name: "line" },
                { constraint_name: "by_code", constraint_type: "UNIQUE",
                    column_name: "code" },
                { constraint_name: "fk_orders_customer",
                    constraint_type: "FOREIGN KEY", column_name: "customer_id" },
                { constraint_name: "positive", constraint_type: "CHECK",
                    column_name: null },
            ],
            references: [
                { name: "customer", ref_column_names: "customer_id",
                    table_schema: "shop", table_name: "orders",
                    reference_mapping: { kind: "n:1",
                        constraint: "shop.fk_orders_customer",
                        referenced_schema: "shop", referenced_table: "customer",
                        column_mapping: [{ base: "customer_id", ref: "id" }] } },
                { name: "invoice", ref_column_names: "order_id",
                    table_schema: "shop", table_name: "invoice",
                    reference_mapping: { kind: "1:n",
                        constraint: "shop.fk_invoice_orders",
                        column_mapping: [{ base: "order_id", ref: "id" }] } },
            ],
        }, { type: "table", name: "orders" });

        expect(body).toMatchObject({ type: "table", table: {
            indexes: [
                { name: null, kind: "primary", columns: ["id", "line"] },
                { name: "by_code", kind: "unique", columns: ["code"] },
            ],
            foreign_keys: [{ name: "fk_orders_customer",
                columns: ["customer_id"], references: { schema: null,
                    table: "customer", columns: ["id"] } }],
        } });
    });

    it("has a routine's parameters and what it returns", () => {
        expect(liveDetails({
            basic: basic("total", "function"),
            parameters: [{ name: "n", mode: null, datatype: "int(11)",
                parameter_default: null }],
            returns: "decimal(10,2)",
        }, { type: "function", name: "total" })).toEqual({ type: "function",
            routine: { name: "total", kind: "function",
                parameters: [{ mode: null, name: "n", type: "int(11)" }],
                returns: "decimal(10,2)" } });
    });

    it("has a trigger's timing, events, table and body", () => {
        expect(liveDetails({
            basic: basic("stamp", "trigger"),
            details: { action_timing: "BEFORE", event_manipulation: "INSERT",
                table_name: "orders", action_statement: "SET NEW.at = NOW()",
                definer: "root@localhost" },
        }, { type: "trigger", name: "stamp" })).toEqual({ type: "trigger",
            trigger: { name: "stamp", timing: "BEFORE", events: "INSERT",
                table: "orders", body: "SET NEW.at = NOW()",
                definer: "root@localhost" } });
    });

    it("has an event's schedule as CREATE EVENT writes it", () => {
        expect(liveDetails({
            basic: { ...basic("tidy", "event"), comment: "Nightly" },
            details: { event_type: "RECURRING", interval_value: "1",
                interval_field: "DAY", starts: "2026-01-01 00:00:00",
                ends: null, status: "ENABLED", on_completion: "NOT PRESERVE",
                event_definition: "DELETE FROM log", definer: "root@%" },
        }, { type: "event", name: "tidy" })).toEqual({ type: "event", event: {
            name: "tidy", schedule: "EVERY 1 DAY STARTS '2026-01-01 00:00:00'",
            status: "ENABLE", on_completion_preserve: false,
            comment: "Nightly", body: "DELETE FROM log", definer: "root@%" } });
    });

    it("has a sequence's type, start and increment", () => {
        expect(liveDetails({
            basic: basic("ids", "sequence"),
            details: { data_type: "bigint", start_value: 1, increment: 5 },
        }, { type: "sequence", name: "ids" })).toEqual({ type: "sequence",
            sequence: { name: "ids", type: "bigint", start: "1",
                increment: "5" } });
    });
});
