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
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
    By,
    CustomTreeSection,
    EditorView,
    TextEditor,
    WebView,
    Workbench,
} from "vscode-extension-tester";

import {
    answerFileDialog,
    buttonEnabled,
    childLabels,
    clickLabelled,
    clickButton,
    clearNotifications,
    CONNECTION,
    DEPLOY_TIMEOUT,
    dialogText,
    fieldValue,
    inDialog,
    inSandboxDialog,
    inlineAction,
    inputUp,
    menuAction,
    pickQuick,
    FILES,
    hasTreeItem,
    menuConfirm,
    openDialog,
    openSection,
    SANDBOX_PASSWORD,
    SANDBOX_PORT,
    runCommand,
    screenshot,
    SECOND_PORT,
    selectTab,
    SERVER_TIMEOUT,
    setField,
    setChecked,
    setFieldByCaption,
    submitDialog,
    treeItem,
    waitFor,
    waitDialogClosed,
    waitForAction,
    waitForNotification,
    waitGone,
} from "../lib/ui";

/**
 * Dump and Load: a schema dumped to disk and loaded back under another
 * name, a table exported to a file and imported into another table, and a
 * slow dump cancelled from the Tasks view. Each runs as a task in the MCP
 * server, followed by a notification and a row in the Tasks view.
 *
 * What the server ends up holding is checked with the shell on the
 * command line, outside the UI under test. Runs on the sandbox and the
 * `uitest` schema of `01-sandbox`.
 */

const SUBMENU = "Dump and Load";
const SECOND_CONNECTION = ["Sandboxes", `root@127.0.0.1:${String(SECOND_PORT)}`];
const SCHEMA = ["uitest"];
const DUMP = join(FILES, "uitest-dump");
/** A dump of uitest in one file, and of its country table. */
const ZIP_DUMP = join(FILES, "uitest.mariadb.dump.zip");
const TABLE_ZIP = join(FILES, "country.mariadb.dump.zip");
/** The nation schema's dump the repository keeps, zipped as Finder does. */
const NATIONS_ZIP = join(FILES, "nations.mariadb.dump.zip");
const NATIONS_ASSET = resolve(__dirname, "../../../ui-test/assets",
    "nations.mariadb.dump.zip");
const EXPORT = join(FILES, "country.tsv");

/** The connection's label in dialog titles, as the extension names it. */
const CONNECTION_LABEL = `root@127.0.0.1:${SANDBOX_PORT}`;

/**
 * Runs SQL on the sandbox with the shell the run put first on the PATH.
 *
 * @param statement One statement.
 * @param port The sandbox's port.
 *
 * @returns Its rows, a line each, the columns tab separated.
 */
const sql = (statement: string, port = SANDBOX_PORT): string => {
    return execFileSync("mariadb-shell", [
        `--uri=mariadb://root@127.0.0.1:${String(port)}/mysql`,
        `--password=${SANDBOX_PASSWORD}`,
        "--py", "-e",
        "import os\n"
        + "rows = session.run_sql(os.environ['UI_TEST_SQL']).fetch_all()\n"
        + "print('\\n'.join('\\t'.join(str(v) for v in r) for r in rows))",
    ], {
        // stderr kept: it warns about the password on the command line.
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, UI_TEST_SQL: statement },
    }).trim();
};

let connections: CustomTreeSection;

/**
 * Refreshes the Connections view until a row shows up: one made outside
 * the extension is listed once the tree reads it again.
 *
 * @param path The labels on the way to the row's parent.
 * @param label The row.
 *
 * @returns Nothing.
 */
const waitForChild = async (path: string[], label: string): Promise<void> => {
    await waitFor(async () => {
        connections = await openSection("Connections");
        await (await connections.getAction("Refresh Connections"))?.click();

        return (await childLabels(connections, path)).includes(label);
    }, `${label} in the tree`, SERVER_TIMEOUT);
};

/**
 * @param table A table of `uitest`, made outside the extension.
 *
 * @returns Once the tree lists it.
 */
const waitForTable = async (table: string): Promise<void> => {
    await waitForChild([...CONNECTION, ...SCHEMA, "Tables"], table);
};

/**
 * Opens Dump Schema to Disk on `uitest`.
 *
 * @returns The dialog's title.
 */
const openDumpSchema = async (): Promise<string> => {
    const title = "Dump uitest to Disk";
    connections = await openSection("Connections");
    await openDialog(connections, [...CONNECTION, ...SCHEMA],
        [SUBMENU, "Dump Schema to Disk..."], title);

    return title;
};

/**
 * Waits for the notification that says how a task ended.
 *
 * @param title The task's title, which is its dialog's.
 * @param timeout How long it may take.
 *
 * @returns The notification's message.
 */
const waitEnded = async (
    title: string,
    timeout = DEPLOY_TIMEOUT,
): Promise<string> => {
    return await waitFor(async () => {
        for (const notification of await new Workbench().getNotifications()) {
            const message = await notification.getMessage();
            if (message.startsWith(`${title} `)) {
                await notification.dismiss().catch(() => { /* gone */ });

                return message;
            }
        }

        return undefined;
    }, `"${title}" to end`, timeout);
};

/**
 * Waits for a task to complete, failing with how it ended otherwise.
 *
 * @param title The task's title, which is its dialog's.
 *
 * @returns Nothing.
 */
const waitCompleted = async (title: string): Promise<void> => {
    let ended: string | undefined;
    try {
        ended = await waitEnded(title);
    } finally {
        if (ended !== `${title} completed.`) {
            await screenshot(`06-not-completed-${title}`
                .replace(/[^A-Za-z0-9-]+/g, "_"));
        }
    }
    assert.equal(ended, `${title} completed.`);
};

/**
 * @returns The text of the task log open in the editor, once one is.
 */
const logText = async (): Promise<string> => {
    return await waitFor(async () => {
        const title = await (await new EditorView().getActiveTab())
            ?.getTitle();

        return title?.endsWith(".log") === true
            ? await new TextEditor().getText() : undefined;
    }, "a task's log in the editor");
};

/**
 * @param title A task's title.
 *
 * @returns Its row's description in the Tasks view: its state or stage.
 */
const taskState = async (title: string): Promise<string> => {
    const tasks = await openSection("Tasks");
    const row = await treeItem(tasks, [title]);

    return await row.getDescription() ?? "";
};

/**
 * Opens a load's dialog from a row's Dump and Load submenu. The entry asks
 * for the dump first: VS Code's simple file dialog in these runs, after a
 * quick pick of a zip or a folder where one picker cannot take both (all
 * but macOS).
 *
 * @param path The labels on the way to the row.
 * @param entry The submenu's entry.
 * @param dump The dump's zip or folder.
 *
 * @returns Nothing.
 */
const openLoad = async (
    path: string[],
    entry: string,
    dump: string,
): Promise<void> => {
    connections = await openSection("Connections");
    await menuAction(connections, path, [SUBMENU, entry], inputUp,
        "the dump picker");
    if (process.platform !== "darwin") {
        await pickQuick(dump.endsWith(".zip") ? "ZIP File..." : "Dump Folder...");
    }
    await answerFileDialog(dump);
};

/**
 * Waits for a load's dialog to have read its dump.
 *
 * @param view The dialog.
 *
 * @returns Its text then.
 */
const waitInspected = async (view: WebView): Promise<string> => {
    return await waitFor(async () => {
        const text = await dialogText(view);

        return /dump in a (ZIP file|folder)|This is a dump|Not a dump|Cannot read/u
            .test(text)
            ? text : undefined;
    }, "the dialog to read the dump");
};

/**
 * Makes a schema outside the extension, and waits for the tree to list it.
 *
 * @param name The schema.
 *
 * @returns Nothing.
 */
const createSchema = async (name: string): Promise<void> => {
    sql(`CREATE DATABASE ${name}`);
    await waitForChild(CONNECTION, name);
};

describe("Dump and Load", () => {
    before(async () => {
        connections = await openSection("Connections");
        await clearNotifications();
    });

    it("dumps a schema to disk from its Dump and Load submenu", async () => {
        const title = await openDumpSchema();
        await inDialog(title, async (view) => {
            await setField(view, "path", DUMP);
            await screenshot("06-dump-dialog");
            await submitDialog(view, "Dump", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.equal(await taskState(title), "completed");
        // A row of the connection's Actions, with the call under it.
        await waitForAction(/Dump uitest to Disk.*Completed/);
        await waitForAction(/Total duration/);
        await screenshot("06-actions");
        const files = readdirSync(DUMP);
        assert.ok(files.includes("@.done.json"), files.join(", "));
        assert.ok(files.some((name) => {
            return name.startsWith("uitest@country");
        }), files.join(", "));
        await screenshot("06-dumped");
    });

    it("opens a task's own log from the Tasks view", async () => {
        const tasks = await openSection("Tasks");
        await (await treeItem(tasks, ["Dump uitest to Disk"])).click();
        const text = await waitFor(async () => {
            const title = await (await new EditorView().getActiveTab())
                ?.getTitle();

            return title?.endsWith(".log") === true
                ? await new TextEditor().getText() : undefined;
        }, "the task's log");
        assert.match(text, /^Dump uitest to Disk\n/u);
        assert.match(text, /Call: util\.dump_schemas\(uitest, /u);
        assert.match(text, /Completed\.\n$/u);
        await new EditorView().closeAllEditors();
    });

    it("loads the dump into another schema from the connection's submenu",
        async () => {
            const title = `Load a Dump into ${CONNECTION_LABEL}`;
            await openLoad(CONNECTION, "Load Dump from Disk...", DUMP);
            await inDialog(title, async (view) => {
                // What the folder holds, read before anything is loaded.
                assert.match(await waitInspected(view),
                    /Schema dump in a folder/u);
                await selectTab(view, "Basic");
                await setField(view, "schema", "uitest_copy");
                await submitDialog(view, "Load", SERVER_TIMEOUT * 2);
            });
            // The Actions tab comes up at the load's row as it starts.
            await waitForAction(/Load a Dump into/u);
            await waitCompleted(title);

            assert.equal(sql("SELECT name FROM uitest_copy.country "
                + "ORDER BY id"), "Austria\nGermany");
            // A load refreshes the tree once it is done.
            connections = await openSection("Connections");
            await waitFor(async () => {
                return (await childLabels(connections, CONNECTION))
                    .includes("uitest_copy");
            }, "uitest_copy in the tree", SERVER_TIMEOUT);
        });

    it("dumps a schema to one ZIP file", async () => {
        const title = await openDumpSchema();
        await inDialog(title, async (view) => {
            await setChecked(view, "zip", true);
            // Ticking it names the path a zip.
            assert.match(await fieldValue(view, "path"),
                /\.mariadb\.dump\.zip$/u);
            await setField(view, "path", ZIP_DUMP);
            await submitDialog(view, "Dump", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.ok(existsSync(ZIP_DUMP), ZIP_DUMP);
        // The folder it was packed from is gone.
        assert.ok(!existsSync(ZIP_DUMP.replace(/\.zip$/u, ".tmp")));
    });

    it("keeps the dialog open when the dump zip exists", async () => {
        const title = await openDumpSchema();
        await inDialog(title, async (view) => {
            // The last dump went to a zip, so this one starts as one.
            assert.equal(await (await view.findWebElement(By.css(
                "[name='zip']"))).isSelected(), true);
            await setField(view, "path", ZIP_DUMP);
            await clickButton(view, "Dump");
            await waitFor(async () => {
                return (await dialogText(view)).includes("exists already");
            }, "the dialog to say the zip exists");
            await clickButton(view, "Cancel");
        });
        await waitDialogClosed(title);
    });

    it("loads a zipped schema dump, leaving out an unticked table",
        async () => {
            copyFileSync(NATIONS_ASSET, NATIONS_ZIP);
            const title = `Load a Dump into ${CONNECTION_LABEL}`;
            await openLoad(CONNECTION, "Load Dump from Disk...", NATIONS_ZIP);
            await inDialog(title, async (view) => {
                assert.match(await waitInspected(view),
                    /Schema dump in a ZIP file/u);
                await screenshot("06-load-objects");
                await clickLabelled(view, "Open Tables");
                // A box's name is its key (`dumpSelection.ts`).
                await setChecked(view, '["tables","nation","guests"]', false);
                await submitDialog(view, "Load", SERVER_TIMEOUT * 2);
            });
            await waitForAction(/Load a Dump into/u);
            await waitCompleted(title);

            const tables = sql("SELECT table_name FROM information_schema"
                + ".tables WHERE table_schema = 'nation' ORDER BY 1")
                .split("\n");
            assert.ok(tables.includes("countries"), tables.join(", "));
            assert.ok(!tables.includes("guests"), tables.join(", "));
            // A load that completed leaves no extracted folder behind.
            assert.ok(!existsSync(NATIONS_ZIP.replace(/\.zip$/u,
                ".extracted")));
        });

    it("loads a table dump only into a schema", async () => {
        const dumpTitle = "Dump country to Disk";
        connections = await openSection("Connections");
        await openDialog(connections,
            [...CONNECTION, ...SCHEMA, "Tables", "country"],
            [SUBMENU, "Dump Table to Disk..."], dumpTitle);
        await inDialog(dumpTitle, async (view) => {
            await setChecked(view, "zip", true);
            await setField(view, "path", TABLE_ZIP);
            await submitDialog(view, "Dump", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(dumpTitle);

        // Not from the connection: a table dump goes into a schema.
        const loadTitle = `Load a Dump into ${CONNECTION_LABEL}`;
        await openLoad(CONNECTION, "Load Dump from Disk...", TABLE_ZIP);
        await inDialog(loadTitle, async (view) => {
            assert.match(await waitInspected(view),
                /Load Table Dump from Disk/u);
            assert.equal(await buttonEnabled(view, "Load"), false);
            await clickButton(view, "Cancel");
        });
        await waitDialogClosed(loadTitle);

        await createSchema("uitest_tables");
        const title = "Load a Table Dump into uitest_tables";
        await openLoad([...CONNECTION, "uitest_tables"],
            "Load Table Dump from Disk...", TABLE_ZIP);
        await inDialog(title, async (view) => {
            assert.match(await waitInspected(view), /Table dump in a ZIP/u);
            await submitDialog(view, "Load", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.equal(sql("SELECT name FROM uitest_tables.country "
            + "ORDER BY id"), "Austria\nGermany");
    });

    it("exports a table to a file", async () => {
        const title = "Export uitest.country to a File";
        connections = await openSection("Connections");
        await openDialog(connections,
            [...CONNECTION, ...SCHEMA, "Tables", "country"],
            [SUBMENU, "Export Table Data to File..."], title);
        await inDialog(title, async (view) => {
            await setField(view, "path", EXPORT);
            await submitDialog(view, "Export", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.ok(existsSync(EXPORT));
        assert.equal(readFileSync(EXPORT, "utf8"), "1\tAustria\n2\tGermany\n");
    });

    it("imports the file into another table", async () => {
        sql("CREATE TABLE uitest.country_import LIKE uitest.country");
        await waitForTable("country_import");
        const title = "Import Data into uitest.country_import";
        connections = await openSection("Connections");
        await openDialog(connections,
            [...CONNECTION, ...SCHEMA, "Tables", "country_import"],
            [SUBMENU, "Import Data from File..."], title);
        await inDialog(title, async (view) => {
            await setField(view, "path", EXPORT);
            await submitDialog(view, "Import", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.equal(sql("SELECT name FROM uitest.country_import "
            + "ORDER BY id"), "Austria\nGermany");
    });

    it("cancels a slow dump from the Tasks view", async () => {
        // Enough rows that a dump held to 1 KB/s is still running when the
        // Cancel button is pressed.
        sql("CREATE TABLE uitest.big (id INT PRIMARY KEY, pad CHAR(100)) "
            + "AS SELECT seq AS id, REPEAT('x', 100) AS pad "
            + "FROM uitest.seq_1_to_20000");
        await waitForTable("big");
        const title = "Dump big to Disk";
        connections = await openSection("Connections");
        await openDialog(connections,
            [...CONNECTION, ...SCHEMA, "Tables", "big"],
            [SUBMENU, "Dump Table to Disk..."], title);
        await inDialog(title, async (view) => {
            await setField(view, "path", join(FILES, "big-dump"));
            await selectTab(view, "Advanced");
            await setField(view, "maxRate", "1k");
            await submitDialog(view, "Dump", SERVER_TIMEOUT * 2);
        });

        // The row follows the stage and, while data moves, its percent.
        const tasks = await openSection("Tasks");
        await waitFor(async () => {
            return /^Dumping data \d+%$/.test(await taskState(title));
        }, "the row to show the dump's percent", SERVER_TIMEOUT);
        await screenshot("06-running");

        // Its log can be watched while it runs: a click on its row.
        await (await treeItem(tasks, [title])).click();
        const running = await logText();
        assert.match(running, /^Dump big to Disk\n/u);
        assert.match(running, /Running data dump/u);
        assert.doesNotMatch(running, /Cancelled\.\n$/u);

        // One click, as a user's: the list redraws at most once a second
        // while the dump runs, so the click is not lost under a redraw.
        await inlineAction(await treeItem(await openSection("Tasks"),
            [title]), "Cancel Task");
        await waitForNotification(`${title} was cancelled.`, SERVER_TIMEOUT);
        assert.equal(await taskState(title), "cancelled");
        // The open log followed it to its end.
        await waitFor(async () => {
            return /Cancelled\.\n$/u.test(await logText());
        }, "the open log to say it was cancelled");
        await new EditorView().closeAllEditors();
    });

    it("opens a failed task's log from its notification, and shows the "
        + "error under its row", async () => {
        const title = `Load a Dump into ${CONNECTION_LABEL}`;

        // A folder that holds no dump is refused before anything starts.
        const notADump = join(FILES, "not-a-dump");
        mkdirSync(notADump, { recursive: true });
        writeFileSync(join(notADump, "readme.txt"), "no dump here");
        await openLoad(CONNECTION, "Load Dump from Disk...", notADump);
        await inDialog(title, async (view) => {
            assert.match(await waitInspected(view), /Not a dump/u);
            assert.equal(await buttonEnabled(view, "Load"), false);
            await clickButton(view, "Cancel");
        });
        await waitDialogClosed(title);

        // A fresh dump of uitest loaded back under its own name: its tables
        // are there already, so the task fails. Fresh, as a dump that was
        // loaded before resumes from its progress file, which does not
        // check for objects that exist.
        const fresh = join(FILES, "uitest-dump-again");
        const dumpTitle = await openDumpSchema();
        await inDialog(dumpTitle, async (view) => {
            await setChecked(view, "zip", false);
            await setField(view, "path", fresh);
            await submitDialog(view, "Dump", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(dumpTitle);
        await openLoad(CONNECTION, "Load Dump from Disk...", fresh);
        await inDialog(title, async (view) => {
            await waitInspected(view);
            await submitDialog(view, "Load", SERVER_TIMEOUT * 2);
        });

        const failure = await waitFor(async () => {
            for (const notification of await new Workbench()
                .getNotifications()) {
                if ((await notification.getMessage())
                    .startsWith(`${title} failed`)) {
                    return notification;
                }
            }

            return undefined;
        }, "the failure notification", DEPLOY_TIMEOUT);
        await screenshot("06-failed");
        await failure.takeAction("Show Log");
        const log = await logText();
        assert.match(log, /^Load a Dump into /u);
        assert.match(log, /\nCall: util\.load_dump\(/u);
        assert.match(log, /FAILED: .+\n$/u);
        await new EditorView().closeAllEditors();

        // In the Actions tab: the row says it failed, the error is under it.
        const failed = log.match(/FAILED: (.+)\n$/u)?.[1] ?? "";
        await waitForAction(/^Load a Dump into .*\| Failed/u);
        await waitForAction(new RegExp(failed.slice(0, 40)
            .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    });

    it("keeps the dialog open when the dump folder is not empty",
        async () => {
            const title = await openDumpSchema();
            await inDialog(title, async (view) => {
                await setField(view, "path", DUMP);
                await clickButton(view, "Dump");
                // Said at the folder, before anything starts.
                const said = await waitFor(async () => {
                    const text = await dialogText(view);

                    return text.includes("not empty") ? text : undefined;
                }, "the dialog to say the folder is not empty");
                assert.match(said, /Pick a new or an empty one/u);
                await screenshot("06-not-empty");
                await clickButton(view, "Cancel");
            });
            await waitDialogClosed(title);
        });

    it("copies a schema to another server", async () => {
        await runCommand("MariaDB: New Sandbox…");
        await inSandboxDialog(async (view) => {
            await setFieldByCaption(view, "Port", String(SECOND_PORT));
            // A password of its own, which the later tests log in with.
            await setChecked(view, "generatePassword", false);
            await setFieldByCaption(view, "Root Password", SANDBOX_PASSWORD);
            await setFieldByCaption(view, "Confirm Root Password",
                SANDBOX_PASSWORD);
            await submitDialog(view, "Create", DEPLOY_TIMEOUT);
        });
        connections = await openSection("Connections");
        // Out of sight below the first connection's rows otherwise, and
        // ExTester sees only the rows drawn.
        await (await treeItem(connections, CONNECTION)).collapse();
        await treeItem(connections, [...SECOND_CONNECTION, "mysql"]);

        const title = "Copy uitest to Another Server";
        await openDialog(connections, [...CONNECTION, ...SCHEMA],
            [SUBMENU, "Copy Schema to Another Server..."], title);
        await inDialog(title, async (view) => {
            const target = await view.findWebElement(By.xpath(
                "//select[@name='target']/option[contains(., "
                + `':${String(SECOND_PORT)}')]`));
            await target.click();
            await screenshot("06-copy-dialog");
            await submitDialog(view, "Copy", SERVER_TIMEOUT * 2);
        });
        await waitCompleted(title);

        assert.equal(sql("SELECT name FROM uitest.country ORDER BY id",
            SECOND_PORT), "Austria\nGermany");
    });

    it("deletes the second sandbox", async () => {
        const sandboxes = await openSection("Sandboxes");
        await menuConfirm(sandboxes, [`localhost:${String(SECOND_PORT)}`],
            ["Delete Sandbox"], "Delete");
        connections = await openSection("Connections");
        await waitGone(connections, SECOND_CONNECTION);
    });

    it("clears the finished tasks from the Tasks view", async () => {
        const tasks = await openSection("Tasks");
        const action = await waitFor(async () => {
            return await tasks.getAction("Clear Finished Tasks");
        }, "the Clear Finished Tasks button");
        await action?.click();
        // Looked for by title: ExTester cannot read the rows of an empty
        // tree ("element not interactable").
        for (const title of ["Dump uitest to Disk", "Dump big to Disk",
            "Export uitest.country to a File",
            "Copy uitest to Another Server",
            `Load a Dump into ${CONNECTION_LABEL}`]) {
            await waitFor(async () => {
                return !await hasTreeItem(tasks, [title]);
            }, `${title} to leave the Tasks view`);
        }
        sql("DROP SCHEMA uitest_copy");
    });
});
