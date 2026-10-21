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
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { By, EditorView, VSBrowser, Workbench } from "vscode-extension-tester";

import {
    clearNotifications,
    clickButton,
    CONNECTION,
    DEPLOY_TIMEOUT,
    dialogText,
    explorerItem,
    explorerMenuAction,
    explorerSubmenuEntries,
    fieldValue,
    inDialog,
    openExplorerDialog,
    openSection,
    SANDBOX_PORT,
    screenshot,
    selectOption,
    SERVER_TIMEOUT,
    setChecked,
    setField,
    submitDialog,
    treeItem,
    waitDialogClosed,
    waitFor,
    waitForAction,
    waitForNotification,
    WORKSPACE,
} from "../lib/ui.js";

/**
 * MariaDB Schema Management from the Explorer: a schema project created in
 * a workspace folder, its information, a release, its deployment script
 * and its deployment onto the suite's sandbox - each through its dialog,
 * each an action of the Actions tab. The `msm` suite's VS Code has a
 * workspace folder open for it (see run.ts).
 */

const SUBMENU = "MariaDB Schema Management";
const SCHEMA = "msm_shop";
const FOLDER = "projects";
const PROJECT_FOLDER = `${SCHEMA}.msm.project`;

/** The submenu's entries on a folder that is not a project. */
const FOLDER_ENTRIES = ["New MSM Project..."];

/** The submenu's entries on a project folder. */
const PROJECT_ENTRIES = [
    "Show MSM Project Information...",
    "Prepare MSM Release...",
    "Generate MSM Deployment Script...",
    "Deploy MSM Schema...",
];

const projectPath = (): string => {
    return join(WORKSPACE, FOLDER, PROJECT_FOLDER);
};

/** Waits for an editor tab, as the commands open the files they wrote. */
const waitForEditor = async (title: string): Promise<void> => {
    await waitFor(async () => {
        return (await new EditorView().getOpenEditorTitles()).includes(title);
    }, `the editor ${title}`, SERVER_TIMEOUT);
};

/** Fills New MSM Project for the suite's project. */
const fillCreate = async (view: Parameters<Parameters<
    typeof inDialog>[1]>[0]): Promise<void> => {
    await setField(view, "schemaName", SCHEMA);
    await setField(view, "copyrightHolder", "UI Test");
    await selectOption(view, "license", "MIT");
};

describe("MariaDB Schema Management", () => {
    before(async function () {
        if (WORKSPACE === "") {
            // Run through the msm suite, which opens the workspace.
            this.skip();
        }
        await VSBrowser.instance.waitForWorkbench();
        mkdirSync(join(WORKSPACE, FOLDER), { recursive: true });
    });

    it("offers only New MSM Project on a folder that is no project",
        async () => {
            assert.deepEqual(await explorerSubmenuEntries([FOLDER], SUBMENU),
                FOLDER_ENTRIES);
        });

    it("creates a project with the New MSM Project dialog", async () => {
        await openExplorerDialog([FOLDER], [SUBMENU, "New MSM Project..."],
            "New MSM Project");
        await inDialog("New MSM Project", async (view) => {
            // It starts in the folder right-clicked.
            assert.equal(await fieldValue(view, "targetPath"),
                join(WORKSPACE, FOLDER));
            await fillCreate(view);
            assert.match(await dialogText(view),
                /The project folder is msm_shop\.msm\.project\./u);
            await screenshot("09-new-msm-project");
            await submitDialog(view, "Create", SERVER_TIMEOUT,
                "Creating the project...");
        });

        // Its development script is opened, and the folder is in the
        // Explorer.
        await waitForEditor(`${SCHEMA}_next.sql`);
        assert.ok(existsSync(join(projectPath(), "msm.project.json")));
        await explorerItem(FOLDER, PROJECT_FOLDER);
        await waitForAction(/^Created MSM project for schema msm_shop/u);
    });

    it("refuses to create the same project again, saying why", async () => {
        await openExplorerDialog([FOLDER], [SUBMENU, "New MSM Project..."],
            "New MSM Project");
        await inDialog("New MSM Project", async (view) => {
            await fillCreate(view);
            await clickButton(view, "Create");
            await waitFor(async () => {
                return (await dialogText(view)).includes(
                    "exists in this folder already");
            }, "the dialog to say the project exists");
            await clickButton(view, "Cancel");
        });
        await waitDialogClosed("New MSM Project");
    });

    it("offers the project's commands on its folder", async () => {
        assert.deepEqual(
            await explorerSubmenuEntries([FOLDER, PROJECT_FOLDER], SUBMENU),
            PROJECT_ENTRIES);
    });

    it("shows the project's information", async () => {
        const title = `MSM Project Information - ${SCHEMA}`;
        await openExplorerDialog([FOLDER, PROJECT_FOLDER],
            [SUBMENU, "Show MSM Project Information..."], title);
        await inDialog(title, async (view) => {
            const text = await dialogText(view);
            assert.match(text, /Development Version\s+0\.0\.1/u);
            assert.match(text, /Last Release\s+Not released yet/u);
            assert.match(text, /License\s+MIT/u);
            // Nothing released: nothing to generate or deploy.
            const generate = await view.findWebElement(By.xpath(
                "//button[normalize-space()='Generate Deployment Script...']"));
            assert.equal(await generate.isEnabled(), false);
            await screenshot("09-msm-project-information");
            await clickButton(view, "Close");
        });
        await waitDialogClosed(title);
        await waitForAction(/^Read MSM project msm_shop\.msm\.project/u);
    });

    it("prepares a release with the Prepare Release dialog", async () => {
        // A table, so the release has something to deploy.
        const script = join(projectPath(), "development", `${SCHEMA}_next.sql`);
        writeFileSync(script, readFileSync(script, "utf8").replace(
            /(-- #+\n-- MSM Section 150)/u,
            "CREATE TABLE `item` (`id` INT PRIMARY KEY, "
            + "`name` VARCHAR(40));\n\n\n$1"));

        const title = `Prepare Release - ${SCHEMA}`;
        await openExplorerDialog([FOLDER, PROJECT_FOLDER],
            [SUBMENU, "Prepare MSM Release..."], title);
        await inDialog(title, async (view) => {
            // The development version, and the one after it.
            assert.equal(await fieldValue(view, "version"), "0.0.1");
            assert.equal(await fieldValue(view, "nextVersion"), "0.0.2");
            await screenshot("09-prepare-release");
            await submitDialog(view, "Prepare Release", SERVER_TIMEOUT,
                "Preparing the release...");
        });

        await waitForEditor(`${SCHEMA}_0.0.1.sql`);
        assert.ok(existsSync(join(projectPath(), "releases", "versions",
            `${SCHEMA}_0.0.1.sql`)));
        await waitForAction(/^Prepared release 0\.0\.1 of msm_shop/u);
    });

    it("asks before releasing a version again", async () => {
        const title = `Prepare Release - ${SCHEMA}`;
        await openExplorerDialog([FOLDER, PROJECT_FOLDER],
            [SUBMENU, "Prepare MSM Release..."], title);
        await inDialog(title, async (view) => {
            // Development has moved on.
            assert.equal(await fieldValue(view, "version"), "0.0.2");
            await setField(view, "version", "0.0.1");
            await clickButton(view, "Prepare Release");
            await waitFor(async () => {
                return (await dialogText(view)).includes(
                    "0.0.1 has been released already");
            }, "the dialog to say 0.0.1 is released");
            await clickButton(view, "Cancel");
        });
        await waitDialogClosed(title);
    });

    it("generates the deployment script", async () => {
        const title = `Generate Deployment Script - ${SCHEMA}`;
        await openExplorerDialog([FOLDER, PROJECT_FOLDER],
            [SUBMENU, "Generate MSM Deployment Script..."], title);
        await inDialog(title, async (view) => {
            assert.equal(await fieldValue(view, "version"), "0.0.1");
            await submitDialog(view, "Generate", SERVER_TIMEOUT,
                "Generating the deployment script...");
        });

        await waitForEditor(`${SCHEMA}_deployment_0.0.1.sql`);
        await waitForAction(
            /^Generated the deployment script for msm_shop 0\.0\.1/u);
    });

    it("deploys the schema onto the sandbox", async () => {
        const title = `Deploy Schema - ${SCHEMA}`;
        await openExplorerDialog([FOLDER, PROJECT_FOLDER],
            [SUBMENU, "Deploy MSM Schema..."], title);
        await inDialog(title, async (view) => {
            await selectOption(view, "connection",
                `root@127.0.0.1:${String(SANDBOX_PORT)}`);
            // A new schema: there is nothing to back up.
            await setChecked(view, "backup", false);
            await screenshot("09-deploy-schema");
            await submitDialog(view, "Deploy", DEPLOY_TIMEOUT,
                "Deploying the schema...");
        });

        // An action of the sandbox's connection, and the tree has it.
        await waitForAction(
            /^Deployed msm_shop 0\.0\.1 onto root@127\.0\.0\.1:\d+/u,
            DEPLOY_TIMEOUT);
        const connections = await openSection("Connections");
        await treeItem(connections, [...CONNECTION, SCHEMA, "Tables", "item"]);
    });

    it("reports a project that cannot be read, in the Actions tab too",
        async () => {
            const settings = join(projectPath(), "msm.project.json");
            renameSync(settings, `${settings}.moved`);
            try {
                await clearNotifications();
                let said = "";
                await explorerMenuAction([FOLDER, PROJECT_FOLDER],
                    [SUBMENU, "Show MSM Project Information..."], async () => {
                        for (const notification of
                            await new Workbench().getNotifications()) {
                            said = await notification.getMessage();
                            if (said.includes("does not contain")) {
                                return true;
                            }
                        }

                        return false;
                    }, "the failure's notification");
                assert.match(said, /does not contain a MSM project folder/u);
                await waitForNotification("does not contain");
                await waitForAction(
                    /^Reading MSM project msm_shop\.msm\.project failed/u);
            } finally {
                renameSync(`${settings}.moved`, settings);
            }
        });
});
