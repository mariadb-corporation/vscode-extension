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

import { beforeEach, describe, expect, it } from "vitest";

import {
    MSM_NAVIGATION_COMMANDS,
    ProjectNavigation,
} from "../../msm/projectNavigation.js";
import { DoubleClick } from "../../tree/doubleClick.js";
import {
    errorMessages,
    registeredCommands,
    resetVscodeMock,
    shownEditors,
} from "../mocks/vscode.js";

const PROJECT = "/work/shop.msm.project";
const SCRIPT = `${PROJECT}/development/shop_next.sql`;

const OUTLINE = {
    schemas: [{ name: "shop", declared: true,
        range: { start: { line: 4, character: 0 },
            end: { line: 4, character: 30 } },
        tables: [{ name: "orders",
            range: { start: { line: 9, character: 0 },
                end: { line: 12, character: 2 } },
            selection_range: { start: { line: 9, character: 13 },
                end: { line: 9, character: 21 } } }] }],
};

describe("ProjectNavigation", () => {
    let now: number;
    let shown: string[];

    const run = async (id: string, node: unknown): Promise<void> => {
        await registeredCommands.get(id)!(node);
    };

    /** Two clicks on a row, a moment apart. */
    const doubleClick = async (node: unknown): Promise<void> => {
        await run(MSM_NAVIGATION_COMMANDS.rowClicked, node);
        now += 100;
        await run(MSM_NAVIGATION_COMMANDS.rowClicked, node);
    };

    const editor = (index = 0) => {
        const { document, selection } = shownEditors[index] as unknown as {
            document: { fsPath: string };
            selection: { start: { line: number; character: number } }; };

        return [document.fsPath, selection.start.line,
            selection.start.character];
    };

    beforeEach(() => {
        resetVscodeMock();
        now = 1000;
        shown = [];
        new ProjectNavigation({
            outline: () => { return Promise.resolve(OUTLINE); },
            developmentScript: () => { return Promise.resolve(SCRIPT); },
            showInDiagram: (projectPath, diagram, id) => {
                shown.push(`${projectPath} ${diagram} ${id}`);
            },
            log: () => { /* not looked at */ },
        }, new DoubleClick(() => { return now; })).register();
    });

    const table = { kind: "object", projectPath: PROJECT, schema: "shop",
        objectType: "table", name: "orders" };

    it("opens an object's statement on its button, its name selected",
        async () => {
            await run(MSM_NAVIGATION_COMMANDS.openDefinition, table);

            expect(editor()).toEqual([SCRIPT, 9, 13]);
        });

    it("opens it on a double-click only", async () => {
        await run(MSM_NAVIGATION_COMMANDS.rowClicked, table);
        expect(shownEditors).toEqual([]);

        now += 100;
        await run(MSM_NAVIGATION_COMMANDS.rowClicked, table);
        expect(editor()).toEqual([SCRIPT, 9, 13]);
    });

    it("opens the schema's CREATE DATABASE", async () => {
        await doubleClick({ kind: "schema", projectPath: PROJECT,
            schema: "shop", snapshot: true });

        expect(editor()).toEqual([SCRIPT, 4, 0]);
    });

    it("opens a REST row's statement where the row has it", async () => {
        await doubleClick({ kind: "restObject", projectPath: PROJECT,
            file: SCRIPT, line: 120 });

        expect(editor()).toEqual([SCRIPT, 120, 0]);
    });

    it("says so where the script does not create the object", async () => {
        await run(MSM_NAVIGATION_COMMANDS.openDefinition, { ...table,
            objectType: "view", name: "gone" });

        expect(errorMessages.join()).toMatch(/does not create the view gone/u);
    });

    it("shows a figure, a layer or a group's member in its diagram",
        async () => {
            const place = { projectPath: PROJECT, diagram: "Main" };
            await doubleClick({ ...place, kind: "diagramFigure",
                figure: { id: "f1" } });
            await run(MSM_NAVIGATION_COMMANDS.showInDiagram, { ...place,
                kind: "diagramLayer", layer: { id: "L1" } });
            await run(MSM_NAVIGATION_COMMANDS.showInDiagram, { ...place,
                kind: "diagramMember", figureId: "g1" });

            expect(shown).toEqual([`${PROJECT} Main f1`, `${PROJECT} Main L1`,
                `${PROJECT} Main g1`]);
            expect(shownEditors).toEqual([]);
        });
});
