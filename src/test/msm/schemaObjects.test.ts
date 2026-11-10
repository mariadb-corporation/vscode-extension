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

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type {
    IMsmApi,
    IMsmNewObject,
    IMsmObjectTemplates,
} from "../../mcp/msmApi.js";
import type { ISchemaDefinition } from "../../modeler/modelFormat.js";
import {
    MSM_ADD_COMMANDS,
    MSM_TEMPLATE_COMMANDS,
    ObjectTemplates,
    objectNameProblem,
    SchemaObjectCommands,
} from "../../msm/schemaObjects.js";
import {
    errorMessages,
    informationMessages,
    inputBoxAnswers,
    inputBoxCalls,
    quickPickAnswers,
    quickPickCalls,
    registeredCommands,
    resetVscodeMock,
    shownEditors,
} from "../mocks/vscode.js";

const PROJECT = "/work/shop.msm.project";

const SNAPSHOT = {
    format: "msm-schema-definition/1",
    schema: "shop",
    source_hash: "h1",
    tables: [{ name: "orders", columns: [] }, { name: "items", columns: [] }],
    views: [{ name: "open_orders", definition: "SELECT 1" }],
    routines: [{ name: "total", kind: "function" }],
    triggers: [],
    events: [],
    sequences: [],
} as unknown as ISchemaDefinition;

const DEFAULTS: IMsmObjectTemplates = {
    templates: {
        view: "CREATE VIEW ${name} AS SELECT 1",
        procedure: "CREATE PROCEDURE ${name}() BEGIN END",
        function: "CREATE FUNCTION ${name}() RETURNS INT RETURN 1",
        trigger: "CREATE TRIGGER ${name} BEFORE INSERT ON ${table} "
            + "FOR EACH ROW BEGIN END",
        event: "CREATE EVENT ${name} ON SCHEDULE EVERY 1 DAY DO BEGIN END",
        sequence: "CREATE SEQUENCE ${name}",
    },
    placeholders: { view: ["name", "schema", "table"],
        procedure: ["name", "schema"], function: ["name", "schema"],
        trigger: ["name", "schema", "table"], event: ["name", "schema"],
        sequence: ["name", "schema"] },
};

describe("objectNameProblem", () => {
    it("refuses a name taken in the kind's namespace, in any case", () => {
        expect(objectNameProblem("view", SNAPSHOT, " ")).toBe("Enter a name.");
        // Tables, views and sequences share one.
        expect(objectNameProblem("view", SNAPSHOT, "Orders"))
            .toBe("The schema has a table Orders already.");
        expect(objectNameProblem("sequence", SNAPSHOT, "open_orders"))
            .toBe("The schema has a view open_orders already.");
        // A procedure may share a function's name.
        expect(objectNameProblem("procedure", SNAPSHOT, "total"))
            .toBeUndefined();
        expect(objectNameProblem("function", SNAPSHOT, "TOTAL"))
            .toBe("The schema has a function TOTAL already.");
        expect(objectNameProblem("event", SNAPSHOT, "x".repeat(65)))
            .toMatch(/64 characters/u);
    });
});

describe("ObjectTemplates", () => {
    it("keeps the user's template per kind, msm's where there is none",
        async () => {
            const folder = join(mkdtempSync(join(tmpdir(), "templates-")),
                "kept");
            const templates = new ObjectTemplates(folder);

            expect(await templates.read("view")).toBeUndefined();
            const file = await templates.ensure("view", "CREATE VIEW ${name}");
            expect(file).toBe(join(folder, "view.sql"));
            expect(await templates.read("view")).toBe("CREATE VIEW ${name}");
            // A template the user has is not overwritten by msm's.
            await templates.ensure("view", "other");
            expect(readFileSync(file, "utf8")).toBe("CREATE VIEW ${name}");

            expect(await templates.reset("view")).toBe(true);
            expect(await templates.read("view")).toBeUndefined();
            expect(await templates.reset("view")).toBe(false);
        });
});

describe("SchemaObjectCommands", () => {
    let added: Array<{ projectPath: string; object: IMsmNewObject;
        baseHash: string }>;
    let newTables: string[];
    let updated: string[];
    let templates: ObjectTemplates;

    const setUp = (withSnapshot = true): void => {
        const snapshot = withSnapshot ? SNAPSHOT : undefined;
        added = [];
        newTables = [];
        updated = [];
        templates = new ObjectTemplates(mkdtempSync(join(tmpdir(), "t-")));
        new SchemaObjectCommands({
            msmApi: () => {
                return Promise.resolve({
                    getObjectTemplates: () => { return Promise.resolve(DEFAULTS); },
                } as unknown as IMsmApi);
            },
            snapshot: () => { return Promise.resolve(snapshot); },
            addObject: (projectPath, object, baseHash) => {
                added.push({ projectPath, object, baseHash });

                return Promise.resolve({
                    file: `${PROJECT}/development/sections/150.sql`, line: 12 });
            },
            newTable: (projectPath, schema) => {
                newTables.push(`${projectPath} ${schema}`);
            },
            snapshotUpdated: (projectPath) => {
                updated.push(projectPath);

                return Promise.resolve();
            },
            templates,
            log: () => { /* nothing */ },
        }).register();
    };

    const group = (objectType: string): unknown => {
        return { kind: "objectGroup", projectPath: PROJECT, schema: "shop",
            objectType };
    };

    const run = async (id: string, arg: unknown): Promise<void> => {
        await registeredCommands.get(id)!(arg);
    };

    beforeEach(() => { resetVscodeMock(); });

    it("opens the table editor on a new table for Add Table", async () => {
        setUp();
        await run(MSM_ADD_COMMANDS.table, group("table"));

        expect(newTables).toEqual([`${PROJECT} shop`]);
        expect(inputBoxCalls).toEqual([]);
    });

    it("names a view, has msm add it from its template, and opens it at "
        + "its statement", async () => {
        setUp();
        inputBoxAnswers.push(" recent ");
        await run(MSM_ADD_COMMANDS.view, group("view"));

        expect(inputBoxCalls[0].validateInput?.("orders"))
            .toBe("The schema has a table orders already.");
        // msm's template: none sent.
        expect(added).toEqual([{ projectPath: PROJECT,
            object: { kind: "view", name: "recent" }, baseHash: "h1" }]);
        expect(updated).toEqual([PROJECT]);
        const [editor] = shownEditors as unknown as Array<{
            document: { fsPath: string };
            selection: { start: { line: number } }; }>;
        expect(editor.document.fsPath)
            .toBe(`${PROJECT}/development/sections/150.sql`);
        expect(editor.selection.start.line).toBe(11);
    });

    it("sends the user's template where there is one", async () => {
        setUp();
        await templates.ensure("procedure", "CREATE PROCEDURE ${name}() "
            + "BEGIN SELECT 1; END");
        inputBoxAnswers.push("refresh");
        await run(MSM_ADD_COMMANDS.procedure, group("procedure"));

        expect(added[0].object).toEqual({ kind: "procedure", name: "refresh",
            template: "CREATE PROCEDURE ${name}() BEGIN SELECT 1; END" });
    });

    it("asks a trigger's table from the schema's tables", async () => {
        setUp();
        inputBoxAnswers.push("orders_bi");
        quickPickAnswers.push("orders");
        await run(MSM_ADD_COMMANDS.trigger, group("trigger"));

        expect(quickPickCalls[0].map((item) => { return item.label; }))
            .toEqual(["orders", "items"]);
        expect(added[0].object).toEqual({ kind: "trigger", name: "orders_bi",
            table: "orders" });
    });

    it("adds nothing where the name or the table is not given", async () => {
        setUp();
        inputBoxAnswers.push(undefined);
        await run(MSM_ADD_COMMANDS.event, group("event"));
        inputBoxAnswers.push("t");
        quickPickAnswers.push("nothing picked");
        await run(MSM_ADD_COMMANDS.trigger, group("trigger"));

        expect(added).toEqual([]);
    });

    it("says why without a snapshot to name against", async () => {
        setUp(false);
        await run(MSM_ADD_COMMANDS.sequence, group("sequence"));

        expect(errorMessages.join()).toMatch(/no schema snapshot/u);
        expect(added).toEqual([]);
    });

    it("does nothing on another row", async () => {
        setUp();
        await run(MSM_ADD_COMMANDS.view, { kind: "object", name: "x" });

        expect(inputBoxCalls).toEqual([]);
    });

    it("opens a kind's template, a copy of msm's at first, and resets it",
        async () => {
            setUp();
            await run(MSM_TEMPLATE_COMMANDS.edit, group("trigger"));

            expect(await templates.read("trigger"))
                .toBe(DEFAULTS.templates.trigger);
            expect((shownEditors[0] as unknown as { document: {
                fsPath: string; }; }).document.fsPath)
                .toBe(templates.fileOf("trigger"));
            expect(informationMessages[0]).toMatch(/\$\{name\}, \$\{schema\}, \$\{table\}/u);

            await run(MSM_TEMPLATE_COMMANDS.reset, group("trigger"));
            expect(await templates.read("trigger")).toBeUndefined();
            expect(informationMessages[1]).toBe("New triggers start from "
                + "msm's template again.");
        });
});
