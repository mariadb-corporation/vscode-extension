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
    graphValueOf,
    PieGraphLayout,
    pieGraphOptions,
    printedValueOf,
    rewriteCell,
} from "../../notebook/scriptSandbox.js";
import { ScriptRunner } from "../../notebook/scriptRunner.js";
import type { INotebookSdk } from "../../notebook/scriptProtocol.js";
import { createInProcessWorker } from "./inProcessWorker.js";

describe("the TypeScript sandbox", () => {
    it("strips the types and keeps the cell's lines", () => {
        const compiled = compileCell(
            "const a: number = 1;\ninterface I { x: number }\na + 1");

        expect(compiled.code.startsWith("(async () => {;(    a = 1);"))
            .toBe(true);
        expect(compiled.code).not.toContain("number");
        expect(compiled.code.split("\n")).toHaveLength(4);
        // The wrapper on the first line, `return (` on the last.
        expect([...compiled.shifts]).toEqual([[1, 14], [3, 8]]);
    });

    it("returns a cell's last expression, as a REPL shows it", () => {
        const wrap = (body: string): string => {
            return `(async () => {${body}\n})()`;
        };

        expect(rewriteCell(wrap("f(1);\nawait f(2)"))).toEqual({
            code: wrap("f(1);\nreturn (await f(2));"),
            returnLine: 2,
        });
        // Not an assignment, a block or a directive.
        for (const body of ["obj.x = 1;", "if (a) { 5 }", "\"use strict\";",
            ""]) {
            expect(rewriteCell(wrap(body))).toEqual({ code: wrap(body) });
        }
        expect(rewriteCell("not (valid")).toEqual({ code: "not (valid" });
    });

    it("makes what a cell declares the notebook's", () => {
        const wrap = (body: string): string => {
            return `(async () => {${body}\n})()`;
        };

        expect(rewriteCell(wrap(
            "const rows = await f()\nlet a, b = 2;\n"
            + "const { x, y: [z = 1, ...rest], ...others } = o;\n"
            + "function g(n) { return n }\nclass C {}")).code).toBe(wrap(
            ";(    rows = await f())\n;(  a = undefined, b = 2);\n"
            + ";(    { x, y: [z = 1, ...rest], ...others } = o);\n"
            + "function g(n) { return n };globalThis.g = g;\n"
            + "class C {};globalThis.C = C;")
            + ";var rows, a, b, x, z, rest, others;");
        // A line before it with no semicolon is not called with it.
        expect(rewriteCell(wrap("foo()\nconst x = 1")).code)
            .toBe(`${wrap("foo()\n;(    x = 1)")};var x;`);
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
        expect(describeFailure(error, 2, new Map([[2, 4]])))
            .toBe("TypeError: bad\n    at cell.ts:2:2");
        expect(describeFailure("thrown")).toBe("Uncaught 'thrown'");
    });
});

describe("the graphs", () => {
    const rows = [{ Continent: "Asia", n: 51 }, { Continent: "Europe", n: 46 }];

    it("maps the layouts' names to numbers and back, as an enum", () => {
        expect(PieGraphLayout.Donut).toBe(0);
        expect(PieGraphLayout.Pie).toBe(3);
        expect(PieGraphLayout[1]).toBe("ThickDonut");
    });

    it("makes a pie of rows, as the MySQL Shell's PieGraph did", () => {
        expect(pieGraphOptions(rows, PieGraphLayout.Donut as number,
            { name: "Continent", value: "n" })).toEqual({
            series: [{
                type: "pie",
                data: [{ name: "Asia", value: 51 }, { name: "Europe", value: 46 }],
                radius: [96, 160],
            }],
        });
        // Two columns in turn, and a pie where no layout is given.
        expect(pieGraphOptions(rows)).toMatchObject({
            series: [{ radius: [0, 160],
                data: [{ name: "Asia", value: 51 }, { name: "Europe", value: 46 }] }],
        });
        expect(pieGraphOptions([{ name: "a", value: "2", other: 1 }]))
            .toMatchObject({ series: [{ data: [{ name: "a", value: 2 }] }] });
    });

    it("says why rows make no pie", () => {
        expect(() => { return pieGraphOptions("rows"); })
            .toThrow(/must be an array/);
        expect(() => { return pieGraphOptions([{ a: 1, b: 2, c: 3 }]); })
            .toThrow(/needs the keys/);
        expect(() => { return pieGraphOptions([{ a: 1 }]); })
            .toThrow(/a name and a value/);
        expect(() => { return graphValueOf(42); }).toThrow(/an object/);
    });

    it("sends a graph's options as JSON, a date as its ISO text", () => {
        const when = new Date(Date.UTC(2026, 0, 2));

        expect(graphValueOf({ series: [{ type: "line",
            data: [{ xValue: when, yValue: 1 }] }] })).toEqual({
            kind: "graph",
            json: JSON.stringify({ series: [{ type: "line",
                data: [{ xValue: "2026-01-02T00:00:00.000Z", yValue: 1 }] }] }),
        });
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
            call: () => { return Promise.resolve({}); },
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
            call: () => { return Promise.resolve({}); },
        };

        const who = "print(typeof who === 'undefined' ? 'none' : who);";
        await runner.run("a", "const who = 'a';", host);
        await runner.run("b", who, host);
        await runner.run("a", who, host);
        runner.forget("a");
        await runner.run("a", who, host);

        expect(printed).toEqual(["none", "a", "none"]);

        runner.dispose();
    });
});

describe("the REST SDK in a notebook's runtime", () => {
    /**
     * A host that records what the cells printed and answers their calls.
     *
     * @param answers What each call answers.
     *
     * @returns The host, and what was printed.
     */
    const recordingHost = (answers: Partial<Record<string, {
        value?: unknown;
        sdk?: INotebookSdk;
    }>> = {}) => {
        const printed: string[] = [];
        const calls: Array<[string, Record<string, unknown>]> = [];

        return {
            printed,
            calls,
            host: {
                print: (value: { kind: string; text?: string; json?: string;
                    stream?: string }) => {
                    printed.push(`${value.stream ?? value.kind}: `
                        + `${value.text ?? value.json ?? ""}`);
                },
                runSql: () => { return Promise.resolve([]); },
                call: (call: string, args: Record<string, unknown>) => {
                    calls.push([call, args]);

                    return Promise.resolve(answers[call] ?? {});
                },
            },
        };
    };

    const sdk = (version: string, code: string): INotebookSdk => {
        return { version, code };
    };

    it("loads it before the cell, once a version", async () => {
        const runner = new ScriptRunner(createInProcessWorker);
        const { host, printed } = recordingHost();
        const first = sdk("1", "loads = (typeof loads === \"undefined\" ? 0 "
            + ": loads) + 1;\nclass Svc { hello() { return \"hi\"; } }\n"
            + "const svc = new Svc();");

        await runner.run("nb", "svc.hello()", host, first);
        await runner.run("nb", "loads", host, first);
        await runner.run("nb", "loads", host, { ...first, version: "2" });

        expect(printed).toEqual(["stdout: hi", "stdout: 1", "stdout: 2"]);
        runner.dispose();
    });

    it("says where it does not load, and runs the cell all the same",
        async () => {
            const runner = new ScriptRunner(createInProcessWorker);
            const { host, printed } = recordingHost();

            await runner.run("nb", "1 + 1", host,
                sdk("1", "throw new Error(\"broken\");"));
            await runner.run("nb", "2 + 2", host, sdk("1", "ignored"));

            expect(printed).toEqual([
                "stderr: The REST SDK could not be loaded: Error: broken",
                "stdout: 2",
                "stdout: 4",
            ]);
            runner.dispose();
        });

    it("prints it, builds it again, and sends the dialogs' calls away",
        async () => {
            const runner = new ScriptRunner(createInProcessWorker);
            const { host, printed, calls } = recordingHost({
                refreshSdk: { sdk: sdk("2", "const fresh = \"yes\";") },
            });

            await runner.run("nb", "mrsPrintSdkCode();", host,
                sdk("1", "const old = 1;"));
            await runner.run("nb", "await mrsRefreshSdkCode();\nfresh", host);
            await runner.run("nb", "mrsEditService(\"s\");", host);

            expect(calls.map(([call]) => { return call; }))
                .toEqual(["refreshSdk"]);
            expect(printed).toEqual([
                "stdout: const old = 1;",
                "stdout: yes",
                "stderr: mrsEditService: not in a notebook yet - use the REST "
                    + "Service in the MariaDB Connections view.",
            ]);
            runner.dispose();
        });

    it("logs in, the SDK's objects made again with the token", async () => {
        const runner = new ScriptRunner(createInProcessWorker);
        const { host, printed, calls } = recordingHost({
            authenticate: { value: { app: "MRS", username: "jane",
                password: "pw" } },
        });
        const service = sdk("1", [
            "class MrsBaseService {",
            "    constructor(public url: string, public path?: string) {}",
            "    async authenticate(o: { app: string; password: string }) {",
            "        return o.password === \"pw\"",
            "            ? { authApp: o.app, jwt: \"token\" }",
            "            : { errorMessage: \"wrong\" };",
            "    }",
            "}",
            "const svc = { token: typeof mrsLoginResult === \"undefined\"",
            "    ? undefined : mrsLoginResult.jwt };",
        ].join("\n"));

        // Not awaited, as the SDK's generated authenticate does not: the
        // cell is over once the login is.
        await runner.run("nb", "mrsAuthenticate(\"https://s\", \"/auth\");",
            host, service);
        await runner.run("nb", "svc.token", host);

        expect(calls).toEqual([["authenticate",
            { serviceUrl: "https://s", app: undefined, username: undefined }]]);
        expect(printed).toEqual([
            "stdout: Logged in to https://s as jane.",
            "stdout: token",
        ]);
        runner.dispose();
    });

    it("says why a login did not happen", async () => {
        const runner = new ScriptRunner(createInProcessWorker);
        const cancelled = recordingHost();
        const wrong = recordingHost({
            authenticate: { value: { app: "MRS", username: "jane",
                password: "no" } },
        });
        const service = sdk("1", "class MrsBaseService {\n"
            + "    async authenticate() { return { errorMessage: \"wrong\" }; }\n}");

        await runner.run("nb", "await mrsAuthenticate(\"https://s\", \"/a\");",
            cancelled.host, service);
        await runner.run("nb", "await mrsAuthenticate(\"https://s\", \"/a\");",
            wrong.host, service);

        expect(cancelled.printed)
            .toEqual(["stderr: Not logged in: the login was cancelled."]);
        expect(wrong.printed).toEqual(["stderr: wrong"]);
        runner.dispose();
    });
});
