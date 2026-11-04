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
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
    CustomTreeItem,
    CustomTreeSection,
    EditorView,
    SideBarView,
    VSBrowser,
} from "vscode-extension-tester";

import {
    answerFileDialog,
    childLabels,
    clickButton,
    contextMenuEntries,
    dialogText,
    explorerMenuAction,
    fieldValue,
    hasTreeItem,
    inDialog,
    inlineAction,
    isDialogOpen,
    menuAction,
    openSection,
    screenshot,
    SERVER_TIMEOUT,
    setChecked,
    setField,
    submitDialog,
    treeItem,
    waitDialogClosed,
    waitFor,
    waitForAction,
    waitGone,
    WORKSPACE,
} from "../lib/ui.js";

/**
 * The MSM Projects view, in the MariaDB Schema Management activity bar
 * entry: a project created from its toolbar (a file dialog names it, the
 * New MSM Project dialog does the rest), its files, editing it, the
 * Explorer's operations on its row, and adding and removing projects from
 * the Explorer and with Open MSM Project. The `msm-projects` suite's VS
 * Code has a workspace folder open for it (see run.ts).
 */

const CONTAINER = "MariaDB Schema Management";
const VIEW = "MSM Projects";
const SCHEMA = "msm_view";
const CAPTION = "View Shop";
const FOLDER = "projects";
const PROJECT_FOLDER = `${SCHEMA}.msm.project`;
const SUBMENU = "MariaDB Schema Management";

const projectPath = (): string => {
    return join(WORKSPACE, FOLDER, PROJECT_FOLDER);
};

const view = (): Promise<CustomTreeSection> => {
    return openSection(VIEW, CONTAINER);
};

/** Waits for a row to say something beside its label. */
const waitForDescription = async (
    path: string[],
    description: string,
): Promise<CustomTreeItem> => {
    let said = "";

    return await waitFor(async () => {
        const row = await treeItem(await view(), path);
        said = await row.getDescription() ?? "";

        return said === description ? row : undefined;
    }, `the row ${path.join(" > ")} to say '${description}' (says `
        + `'${said}')`, SERVER_TIMEOUT);
};

/**
 * Presses a button of the view's toolbar. The view is alone in its
 * container, so VS Code draws its toolbar in the side bar's title, and
 * the section's own header, with its buttons, stays hidden.
 */
const toolbar = async (label: string): Promise<void> => {
    await view();
    const action = await waitFor(async () => {
        return await new SideBarView().getTitlePart().getAction(label);
    }, `the toolbar button ${label}`);
    await action!.click();
};

describe("MSM Projects view", () => {
    before(async function () {
        if (WORKSPACE === "") {
            // Run through the msm-projects suite, which opens the workspace.
            this.skip();
        }
        await VSBrowser.instance.waitForWorkbench();
        mkdirSync(join(WORKSPACE, FOLDER), { recursive: true });
    });

    it("starts empty, offering New and Open", async () => {
        const section = await view();
        const welcome = await waitFor(async () => {
            return await section.findWelcomeContent();
        }, "the view's welcome content", SERVER_TIMEOUT);
        const buttons = await Promise.all((await welcome!.getButtons())
            .map(async (button) => { return await button.getTitle(); }));
        assert.deepEqual(buttons,
            ["New MSM Project...", "Open MSM Project..."]);
    });

    it("creates a project from the toolbar: a file dialog names it, the "
        + "dialog does the rest", async () => {
        await toolbar("New MSM Project...");
        await answerFileDialog(projectPath());
        await waitFor(async () => {
            return await isDialogOpen("New MSM Project");
        }, "the New MSM Project dialog", SERVER_TIMEOUT);

        await inDialog("New MSM Project", async (dialog) => {
            // Named by the file dialog.
            assert.equal(await fieldValue(dialog, "schemaName"), SCHEMA);
            assert.equal(await fieldValue(dialog, "targetPath"),
                join(WORKSPACE, FOLDER));
            await setField(dialog, "copyrightHolder", "UI Test");
            await setField(dialog, "caption", CAPTION);
            await setField(dialog, "folder", "/Shop");
            // Kept from LLMs unless ticked.
            assert.match(await dialogText(dialog), /Allow MCP Access/u);
            await screenshot("10-new-msm-project-in-view");
            await submitDialog(dialog, "Create", SERVER_TIMEOUT,
                "Creating the project...");
        });

        assert.ok(existsSync(join(projectPath(), "msm.project.json")));
        await waitForAction(/^Created MSM project for schema msm_view/u);
        // Filed as asked; no MCP access, so only the version beside it.
        await waitForDescription(["Shop", CAPTION], "0.0.1");
    });

    it("shows the project's files, which open with a click", async () => {
        const section = await view();
        await waitFor(async () => {
            const files = await childLabels(section, ["Shop", CAPTION]);

            return files.includes("msm.project.json")
                && files.includes("development");
        }, "the project's files", SERVER_TIMEOUT);

        const file = await treeItem(section,
            ["Shop", CAPTION, "msm.project.json"]);
        await file.click();
        await waitFor(async () => {
            return (await new EditorView().getOpenEditorTitles())
                .includes("msm.project.json");
        }, "the file's editor");
    });

    it("offers the Explorer's operations on the project's row", async () => {
        const row = await treeItem(await view(), ["Shop", CAPTION]);
        const entries = await contextMenuEntries(row);
        for (const entry of [
            "Show MSM Project Information...", "Prepare MSM Release...",
            "Generate MSM Deployment Script...", "Deploy MSM Schema...",
            "Edit MSM Project...", "Remove from MSM Projects",
        ]) {
            assert.ok(entries.includes(entry), `${entry} in ${entries.join()}`);
        }

        const title = `MSM Project Information - ${SCHEMA}`;
        await inlineAction(await treeItem(await view(), ["Shop", CAPTION]),
            "Show MSM Project Information...");
        await waitFor(async () => {
            return await isDialogOpen(title);
        }, "the information dialog", SERVER_TIMEOUT);
        await inDialog(title, async (dialog) => {
            assert.match(await dialogText(dialog),
                /Development Version\s+0\.0\.1/u);
            await clickButton(dialog, "Close");
        });
        await waitDialogClosed(title);
    });

    it("edits the project, giving LLMs access", async () => {
        const title = `Edit MSM Project - ${SCHEMA}`;
        await menuAction(await view(), ["Shop", CAPTION],
            ["Edit MSM Project..."], async () => {
                return await isDialogOpen(title);
            }, "the Edit MSM Project dialog");

        await inDialog(title, async (dialog) => {
            assert.equal(await fieldValue(dialog, "developmentVersion"),
                "0.0.1");
            assert.equal(await fieldValue(dialog, "folder"), "/Shop");
            await setField(dialog, "developmentVersion", "0.1.0");
            await setField(dialog, "folder", "/");
            await setChecked(dialog, "mcpAccess", true);
            await screenshot("10-edit-msm-project");
            await submitDialog(dialog, "Update", SERVER_TIMEOUT,
                "Updating the project...");
        });

        await waitForAction(/^Updated MSM project msm_view/u);
        // At the top level now, and marked as reachable over MCP.
        await waitForDescription([CAPTION], "0.1.0 · MCP");
    });

    it("removes the project from the view, and the Explorer adds it back",
        async () => {
            await menuAction(await view(), [CAPTION],
                ["Remove from MSM Projects"], async () => {
                    return !await hasTreeItem(await view(), [CAPTION]);
                }, "the project gone from the view");
            assert.ok(existsSync(projectPath()), "the folder stays on disk");

            // Its caption went with the entry: it is listed by its schema,
            // at the top level, and without MCP access, as added here.
            await explorerMenuAction([FOLDER, PROJECT_FOLDER],
                [SUBMENU, "Add to MSM Projects"], async () => {
                    return await hasTreeItem(await view(), [SCHEMA]);
                }, "the project back in the view");
            await waitForAction(/^Added MSM project msm_view\.msm\.project/u);
            await waitForDescription([SCHEMA], "0.1.0");
        });

    it("opens an existing project with a file dialog", async () => {
        await menuAction(await view(), [SCHEMA],
            ["Remove from MSM Projects"], async () => {
                return !await hasTreeItem(await view(), [SCHEMA]);
            }, "the project gone from the view");
        await waitGone(await view(), [SCHEMA]);

        await toolbar("Open MSM Project...");
        await answerFileDialog(join(projectPath(), "msm.project.json"));

        await waitForDescription([SCHEMA], "0.1.0");
    });
});
