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
    cellSyntaxMessage,
    compileCell,
    describeFailure,
    printedValueOf,
} from "../../notebook/scriptSandbox.js";
import { ScriptRunner } from "../../notebook/scriptRunner.js";
import { createInProcessWorker } from "./inProcessWorker.js";

describe("the TypeScript sandbox", () => {
    it("strips the types and keeps the cell's lines", () => {
        const compiled = compileCell(
            "const a: number = 1;\ninterface I { x: number }\nreturn a;");

        expect(compiled.startsWith("(async () => {const a = 1;")).toBe(true);
        expect(compiled).not.toContain("number");
        expect(compiled.split("\n")).toHaveLength(4);
    });

    it("says what a value printed is", () => {
        expect(printedValueOf("x")).toEqual(
            { kind: "text", stream: "stdout", text: "x" });
        expect(printedValueOf(3, "stderr")).toEqual(
            { kind: "text", stream: "stderr", text: "3" });
        expect(printedValueOf({ a: 1n })).toEqual(
            { kind: "json", json: "{\n  \"a\": \"1\"\n}" });
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(printedValueOf(cycle)).toMatchObject({ kind: "text" });
        expect(printedValueOf(undefined)).toEqual(
            { kind: "text", stream: "stdout", text: "undefined" });
    });

    it("says where a cell failed, in its own terms", () => {
        expect(cellSyntaxMessage("Unexpected token (1:25)"))
            .toBe("Unexpected token (1:11)");
        expect(cellSyntaxMessage("Unexpected token (3:5)"))
            .toBe("Unexpected token (3:5)");

        const error = new TypeError("bad");
        error.stack = "TypeError: bad\n    at cell.ts:2:6\n"
            + "    at cell.ts:3:3\n    at node:internal/vm:1:1";
        expect(describeFailure(error, 2)).toBe("TypeError: bad\n    at cell.ts:2:6");
        expect(describeFailure("thrown")).toBe("Uncaught 'thrown'");
    });
});

describe("ScriptRunner", () => {
    it("runs a notebook's cells one at a time", async () => {
        const runner = new ScriptRunner(createInProcessWorker);
        const printed: string[] = [];
        const host = {
            print: (value: { kind: string; text?: string }) => {
                printed.push(value.text ?? "");
            },
            runSql: () => { return Promise.resolve([]); },
        };

        const slow = runner.run("nb", "await new Promise((r) => "
            + "setTimeout(r, 5)); print('slow');", host);
        const refused = await runner.run("nb", "print('no')", host);
        expect(refused.error).toMatch(/still running/);
        expect(await slow).toEqual({});
        expect(printed).toEqual(["slow"]);

        runner.dispose();
    });

    it("keeps each notebook's state apart", async () => {
        const runner = new ScriptRunner(createInProcessWorker);
        const printed: string[] = [];
        const host = {
            print: (value: { kind: string; text?: string }) => {
                printed.push(value.text ?? "");
            },
            runSql: () => { return Promise.resolve([]); },
        };

        await runner.run("a", "$.who = 'a';", host);
        await runner.run("b", "print($.who ?? 'none');", host);
        await runner.run("a", "print($.who);", host);
        runner.forget("a");
        await runner.run("a", "print($.who ?? 'none');", host);

        expect(printed).toEqual(["none", "a", "none"]);

        runner.dispose();
    });
});
