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

import * as assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    By,
    CustomTreeSection,
    EditorView,
    InputBox,
    VSBrowser,
} from "vscode-extension-tester";

import { middleOf, moveMouse, shiftDrag } from "../lib/cdp.js";
import {
    answerInput,
    driver,
    extensionLog,
    hasTreeItem,
    menuAction,
    openSection,
    screenshot,
    SERVER_TIMEOUT,
    sleep,
    treeItem,
    waitFor,
    WORKSPACE,
} from "../lib/ui.js";

/**
 * Schema diagrams of an MSM project: its snapshot made from the script,
 * a diagram made and opened, and tables placed on it from the MSM
 * Projects view, with Add to Diagram and dragged from the tree. Runs
 * after 10-msm-projects, whose project (`msm_view`, at the top level of
 * the view) it gives tables.
 */

const CONTAINER = "MariaDB Schema Management";
const VIEW = "MSM Projects";
const SCHEMA = "msm_view";
const DIAGRAM = "Main";
const PROJECT = join(WORKSPACE, "projects", `${SCHEMA}.msm.project`);
const SCHEMA_ROW = [SCHEMA, SCHEMA];

const TABLES = `
CREATE TABLE IF NOT EXISTS \`customer\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (\`id\`)
);

CREATE TABLE IF NOT EXISTS \`orders\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`customer_id\` INT UNSIGNED NOT NULL,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`fk_orders_customer\` FOREIGN KEY (\`customer_id\`)
        REFERENCES \`customer\` (\`id\`)
);
`;

const view = (): Promise<CustomTreeSection> => {
    return openSection(VIEW, CONTAINER);
};

/** @returns The project's development script and its section files. */
const scriptText = (): string => {
    const folder = join(PROJECT, "development");

    return readdirSync(folder, { recursive: true, encoding: "utf8" })
        .filter((name) => { return name.endsWith(".sql"); })
        .map((name) => { return readFileSync(join(folder, name), "utf8"); })
        .join("\n");
};

/**
 * @param table A table.
 *
 * @returns Whether the project's diagram has a figure of it, as saved.
 */
const hasFigure = (table: string): boolean => {
    return new RegExp(`"type": "TableFigure",\\s*"name": "${table}"`, "u")
        .test(scriptText());
};

/**
 * Waits for a table's figure to be saved to the project: a placed figure
 * is saved a moment after the viewer settles.
 */
const waitForFigure = async (table: string, how: string): Promise<void> => {
    await waitFor(async () => { return hasFigure(table); },
        `a figure of ${table} saved to the project, placed ${how}`,
        SERVER_TIMEOUT).catch((error: unknown) => {
        throw new Error(`${String(error)}\nThe extension's log:\n`
            + extensionLog(40));
    });
};

describe("MSM schema diagrams", () => {
    before(async function () {
        if (WORKSPACE === "") {
            // Run through the msm suite, which opens the workspace.
            this.skip();
        }
        await VSBrowser.instance.waitForWorkbench();
        // Two tables in the script's Section 140, written as a user would.
        const file = join(PROJECT, "development", `${SCHEMA}_next.sql`);
        const script = readFileSync(file, "utf8");
        const marker = /(-- CREATE TABLE statements and standard INSERTs\.\n-- #+\n)/u;
        assert.match(script, marker, "Section 140 of the script");
        writeFileSync(file, script.replace(marker, `$1${TABLES}`));
    });

    it("makes the project's snapshot, which lists its tables", async () => {
        await menuAction(await view(), SCHEMA_ROW,
            ["Update Schema Snapshot"], async () => {
                return await hasTreeItem(await view(),
                    [...SCHEMA_ROW, "Tables", "orders"]);
            }, "the script's tables in the view");
        assert.ok(await hasTreeItem(await view(),
            [...SCHEMA_ROW, "Tables", "customer"]));
    });

    it("makes a diagram and opens it", async () => {
        await menuAction(await view(), [...SCHEMA_ROW, "Diagrams"],
            ["New Schema Diagram..."], async () => {
                try {
                    await InputBox.create(1000);

                    return true;
                } catch {
                    return false;
                }
            }, "the new diagram's name asked");
        await answerInput(DIAGRAM);
        await waitFor(async () => {
            return (await new EditorView().getOpenEditorTitles())
                .includes(`${DIAGRAM} (${SCHEMA})`);
        }, "the diagram's editor", SERVER_TIMEOUT);
        await hasTreeItem(await view(), [...SCHEMA_ROW, "Diagrams", DIAGRAM]);
        await screenshot("11-diagram-open");
    });

    it("places a table with Add to Diagram", async () => {
        await menuAction(await view(), [...SCHEMA_ROW, "Tables", "customer"],
            ["Add to Diagram"], async () => { return hasFigure("customer"); },
            "a figure of customer saved to the project");
        await screenshot("11-add-to-diagram");
    });

    it("places a table dragged from the tree where the pointer comes back",
        async () => {
            // Electron refuses a drop from the workbench into a webview, so
            // the drag passes over the diagram and ends outside it (see
            // shiftDrag), and the diagram places the table as the pointer
            // next moves in it.
            const row = await treeItem(await view(),
                [...SCHEMA_ROW, "Tables", "orders"]);
            const editor = await driver().findElement(By.css(
                ".editor-group-container.active .editor-container"));
            const to = await middleOf(editor);
            await shiftDrag(row, to);
            await sleep(600);
            await moveMouse({ x: to.x + 10, y: to.y + 10 });
            await screenshot("11-drag-placed");
            await waitForFigure("orders", "by a drag from the tree");
        });
});
