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

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** The plugin, as the TypeScript server loads it. */
const plugin = require("../../../ts-plugin/index.js") as {
    createInit(folder: string): () => {
        create(info: unknown): unknown;
    };
    withTypings(fileNames: string[], typings: string): string[];
};
const typings = require("../../../ts-plugin/typings.js") as string;

/** A MariaDB Notebook's cell, as the server names it. */
const CELL = "^/vscode-notebook-cell/ts-nul-authority/w/a.mariadb-notebook#c1";

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

describe("the TypeScript server plugin", () => {
    it("adds the typings to a project with a MariaDB Notebook's cell", () => {
        expect(plugin.withTypings(["/w/x.ts", CELL], "/t.d.ts"))
            .toEqual(["/w/x.ts", CELL, "/t.d.ts"]);
        expect(plugin.withTypings([CELL, "/t.d.ts"], "/t.d.ts"))
            .toEqual([CELL, "/t.d.ts"]);
        // A Jupyter notebook's, or a file's, project is left as it is.
        expect(plugin.withTypings([
            "^/vscode-notebook-cell/ts-nul-authority/w/a.ipynb#c1",
            "/w/x.ts",
        ], "/t.d.ts")).toHaveLength(2);
    });

    it("writes the typings once, and serves them to the project", () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ts-plugin-"));
        folders.push(folder);
        const files = [CELL];
        const host = { getScriptFileNames: () => { return files; } };
        const languageService = {};
        const create = plugin.createInit(folder)().create;

        expect(create({
            languageServiceHost: host,
            languageService,
            project: { projectService: { logger: { info: () => {} } } },
        })).toBe(languageService);

        const names = host.getScriptFileNames();
        expect(names).toHaveLength(2);
        expect(fs.readFileSync(names[1], "utf8")).toBe(typings);
        expect(fs.readdirSync(folder)).toHaveLength(1);
    });

    it("describes the runtime as cells use it", () => {
        const cell = [
            "const rows = await runSql(\"SELECT name, n FROM t\");",
            "print(rows.length, rows[0]?.name);",
            "PieGraph.render(rows, PieGraphLayout.Donut,",
            "    { name: \"name\", value: \"n\" });",
            "Graph.render({",
            "    title: { text: \"Load\", horizontalAlignment: \"Start\" },",
            "    series: [",
            "        { type: \"line\", curve: \"Natural\", data: [",
            "            { xValue: new Date(), yValue: 1, group: \"a\" }] },",
            "        { type: \"bar\", data: [[\"x\", \"y\"], [\"a\", 1]] },",
            "        { type: \"pie\", radius: [0, 100],",
            "            data: [{ name: \"a\", value: 1 }] },",
            "    ],",
            "});",
        ].join("\n");
        const files = new Map([["/typings.d.ts", typings], ["/cell.ts", cell]]);
        const options: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2022,
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
            strict: true,
            noEmit: true,
        };
        const host = ts.createCompilerHost(options);
        const program = ts.createProgram(["/typings.d.ts", "/cell.ts"], options, {
            ...host,
            fileExists: (name) => {
                return files.has(name) || host.fileExists(name);
            },
            readFile: (name) => {
                return files.get(name) ?? host.readFile(name);
            },
            getSourceFile: (name, version) => {
                const text = files.get(name);

                return text === undefined
                    ? host.getSourceFile(name, version)
                    : ts.createSourceFile(name, text, version);
            },
        });

        // A cell's top-level await is fine at run time, and VS Code shows
        // no semantic error in a cell anyway.
        const errors = ts.getPreEmitDiagnostics(program).filter((error) => {
            return error.code !== 1375 && error.code !== 1378;
        }).map((error) => {
            return ts.flattenDiagnosticMessageText(error.messageText, "\n");
        });
        expect(errors).toEqual([]);
    });
});
