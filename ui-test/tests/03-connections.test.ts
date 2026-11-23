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
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    By,
    CustomTreeItem,
    CustomTreeSection,
    EditorView,
    TextEditor,
} from "vscode-extension-tester";

import {
    answerFileDialog,
    answerInput,
    byCaption,
    cellTexts,
    childLabels,
    clearClipboard,
    clickButton,
    clipboard,
    contextMenuEntries,
    dialogErrors,
    discardEditors,
    FILES,
    hasTreeItem,
    inDialog,
    inputUp,
    inResults,
    isDialogOpen,
    menuAction,
    menuConfirm,
    openDialog,
    openSection,
    runCommand,
    SANDBOX_PASSWORD,
    SANDBOX_PORT,
    screenshot,
    SERVER_TIMEOUT,
    setFieldByCaption,
    sqlEditor,
    submitDialog,
    treeItem,
    typeInto,
    waitFor,
    waitGone,
} from "../lib/ui";

/**
 * The Connections view's own work: a connection added with the connection
 * editor, tested, edited, duplicated (the copy's current schema set,
 * followed and used, its system schemas hidden, a table's and a schema's
 * names and CREATE statements copied and sent to an editor, a table and a
 * schema dropped, a script loaded onto it), made the default, copied,
 * filed in a folder, opened and closed, and deleted again. It connects to
 * the sandbox the tests deployed, under a caption of its own.
 */

const CAPTION = "UI Copy";
const ADDRESS = `root@127.0.0.1:${SANDBOX_PORT}`;
const URI = `mariadb://${ADDRESS}`;
/** The duplicate of the renamed connection, its URI naming `uitest`. */
const DUPLICATE = `${CAPTION} 2 (copy)`;

let connections: CustomTreeSection;

/**
 * @param row A tree row.
 *
 * @returns The icon it is drawn with, as its CSS has it.
 */
const iconOf = async (row: CustomTreeItem): Promise<string> => {
    const icon = await row.findElement(
        By.css(".custom-view-tree-node-item-icon"));

    return await icon.getCssValue("background-image");
};

/**
 * @param schema A schema of the duplicate.
 *
 * @returns Whether its row is drawn as the current schema.
 */
const isCurrent = async (schema: string): Promise<boolean> => {
    return (await iconOf(await treeItem(connections, [DUPLICATE, schema])))
        .includes("schemaCurrent.svg");
};

/** Opens a new SQL editor on the duplicate, holding the text. */
const duplicateEditor = async (text: string): Promise<TextEditor> => {
    return await sqlEditor(connections, [DUPLICATE], text);
};

/** Runs the active editor's script and waits for a cell saying `text`. */
const runAndSee = async (text: string): Promise<void> => {
    await runCommand("MariaDB: Run SQL Script");
    await inResults(async (view) => {
        await waitFor(async () => {
            return (await cellTexts(view)).includes(text);
        }, `a cell saying ${text}`, SERVER_TIMEOUT);
    });
};

/** Fills in the editor's Basic tab for the sandbox. */
const fillBasic = async (view: Parameters<Parameters<typeof inDialog>[1]>[0])
    : Promise<void> => {
    await setFieldByCaption(view, "Caption", CAPTION);
    await typeInto(await view.findWebElement(
        By.css("[aria-label='Host Name/IP']")), "127.0.0.1");
    await setFieldByCaption(view, "Port", String(SANDBOX_PORT));
    await setFieldByCaption(view, "User Name", "root");
    await clickButton(view, "Set Password");
    const password = await view.findWebElement(
        By.css("[aria-label='Password']"));
    await password.sendKeys(SANDBOX_PASSWORD);
};

describe("Connections", () => {
    before(async () => {
        connections = await openSection("Connections");
    });

    it("adds a connection with the connection editor, after a test",
        async () => {
            await runCommand("MariaDB: New Connection…");
            await inDialog("New Database Connection", async (view) => {
                await fillBasic(view);
                await clickButton(view, "Test Connection");
                await waitFor(async () => {
                    const messages = await view.findWebElements(
                        By.css(".message.ok"));

                    return messages.length > 0;
                }, "the connection test to succeed");
                await screenshot("03-connection-editor");
                await submitDialog(view, "Create");
            });
            await waitFor(async () => {
                return await hasTreeItem(connections, [CAPTION]);
            }, "the new connection's row");
            const row = await treeItem(connections, [CAPTION]);
            // The caption replaces the address, which moves beside it.
            assert.match(await row.getDescription() ?? "", /127\.0\.0\.1/);
        });

    it("refuses a connection without a host or user", async () => {
        await runCommand("MariaDB: New Connection…");
        await inDialog("New Database Connection", async (view) => {
            await clickButton(view, "Create");
            await waitFor(async () => {
                return (await view.findWebElements(
                    By.css(".message.error, .invalid"))).length > 0;
            }, "the editor to say what is missing");
            await clickButton(view, "Cancel");
        });
        await waitFor(async () => {
            return !await isDialogOpen("New Database Connection");
        }, "the editor to close");
    });

    it("renames the connection with Edit Connection", async () => {
        await openDialog(connections, [CAPTION], ["Edit Connection"],
            `Edit ${URI}`);
        await inDialog(`Edit ${URI}`, async (view) => {
            await setFieldByCaption(view, "Caption", `${CAPTION} 2`);
            await submitDialog(view, "Save");
        });
        await waitFor(async () => {
            return await hasTreeItem(connections, [`${CAPTION} 2`]);
        }, "the renamed row");
        await waitGone(connections, [CAPTION]);
    });

    it("duplicates the connection, refusing a copy left as it was",
        async () => {
            const title = `Duplicate ${URI}`;
            await openDialog(connections, [`${CAPTION} 2`],
                ["Duplicate Connection…"], title);
            await inDialog(title, async (view) => {
                assert.equal(await (await view.findWebElement(
                    byCaption("Caption"))).getAttribute("value"), DUPLICATE);
                // As copied, it would be stored over the original.
                await clickButton(view, "Create");
                const errors = await waitFor(async () => {
                    const shown = await dialogErrors(view);

                    return shown.length > 0 ? shown : undefined;
                }, "the copy to be refused");
                assert.match(errors[0], /is a connection already/);

                await setFieldByCaption(view, "Default Schema", "uitest");
                // Changed, it is no longer the one refused - and an error
                // still shown would fail the save below.
                await waitFor(async () => {
                    return (await dialogErrors(view)).length === 0;
                }, "the refusal to clear");
                // Its password is not copied.
                await clickButton(view, "Set Password");
                await (await view.findWebElement(
                    By.css("[aria-label='Password']")))
                    .sendKeys(SANDBOX_PASSWORD);
                await submitDialog(view, "Create");
            });
            await waitFor(async () => {
                return await hasTreeItem(connections, [DUPLICATE]);
            }, "the duplicate's row");
            assert.match(await (await treeItem(connections, [DUPLICATE]))
                .getDescription() ?? "", /\/uitest/);
            // The original is still there.
            assert.ok(await hasTreeItem(connections, [`${CAPTION} 2`]));
        });

    it("marks the schema the URI names as the current one", async () => {
        await waitFor(async () => {
            return await isCurrent("uitest");
        }, "uitest drawn as the current schema", SERVER_TIMEOUT);
        assert.equal(await isCurrent("mysql"), false);
        await screenshot("03-current-schema");
        // Already current: nothing to set.
        const entries = await contextMenuEntries(
            await treeItem(connections, [DUPLICATE, "uitest"]));
        assert.ok(!entries.includes("Set As Current Schema"),
            entries.join(", "));
        assert.ok(entries.includes("Drop Schema…"), entries.join(", "));
    });

    it("hides the system schemas, and shows them again", async () => {
        assert.ok((await childLabels(connections, [DUPLICATE]))
            .includes("mysql"));
        await menuAction(connections, [DUPLICATE], ["Hide System Schemas"],
            async () => {
                const labels = await childLabels(connections, [DUPLICATE]);

                return !labels.includes("mysql")
                    && !labels.includes("information_schema")
                    && labels.includes("uitest");
            }, "the system schemas to go");
        await menuAction(connections, [DUPLICATE], ["Show System Schemas"],
            async () => {
                return (await childLabels(connections, [DUPLICATE]))
                    .includes("mysql");
            }, "the system schemas back");
    });

    it("sets another current schema, which the next run is in", async () => {
        await menuAction(connections, [DUPLICATE, "mysql"],
            ["Set As Current Schema"], async () => {
                return await isCurrent("mysql") && !await isCurrent("uitest");
            }, "mysql drawn as the current schema");

        // A session opened after the pick is put into it before it runs.
        await duplicateEditor("SELECT DATABASE() AS db;");
        await runAndSee("mysql");
        await discardEditors();
    });

    it("follows a USE run in an editor", async () => {
        await duplicateEditor("USE uitest;");
        await runCommand("MariaDB: Run SQL Script");
        await waitFor(async () => {
            return await isCurrent("uitest") && !await isCurrent("mysql");
        }, "uitest drawn as the current schema again", SERVER_TIMEOUT);
        await discardEditors();
    });

    it("copies a table's and a schema's name and CREATE statement",
        async () => {
            const city = [DUPLICATE, "uitest", "Tables", "city"];
            clearClipboard();
            await menuAction(connections, city,
                ["Copy to Clipboard", "Name"], async () => {
                    return clipboard() === "city";
                }, "the table's name on the clipboard");
            await menuAction(connections, city,
                ["Copy to Clipboard", "Create Statement"], async () => {
                    return clipboard().startsWith("CREATE TABLE `city`");
                }, "the table's CREATE statement on the clipboard");
            await menuAction(connections, [DUPLICATE, "uitest"],
                ["Copy to Clipboard", "Create Statement"], async () => {
                    return /^CREATE DATABASE `uitest`/.test(clipboard());
                }, "the schema's CREATE statement on the clipboard");
        });

    it("sends a name and a CREATE statement to the SQL editor", async () => {
        const editor = await duplicateEditor("");
        const city = [DUPLICATE, "uitest", "Tables", "city"];
        await menuAction(connections, city, ["Send to SQL Editor", "Name"],
            async () => {
                return (await new TextEditor().getText()).includes("city");
            }, "the name in the editor");
        await menuAction(connections, city,
            ["Send to SQL Editor", "Create Statement"], async () => {
                return (await new TextEditor().getText())
                    .includes("CREATE TABLE `city`");
            }, "the CREATE statement in the editor");
        // Into the editor that was open, not a new one.
        assert.ok((await editor.getText()).includes("MariaDB connection"));
        await discardEditors();
    });

    it("drops a table and a schema, once the user confirmed it", async () => {
        await duplicateEditor(
            "CREATE DATABASE uidrop;\nCREATE TABLE uidrop.t (id INT);");
        await runCommand("MariaDB: Run SQL Script");
        // The CREATEs redraw the connection.
        await waitFor(async () => {
            return await hasTreeItem(connections,
                [DUPLICATE, "uidrop", "Tables", "t"]);
        }, "the table to drop", SERVER_TIMEOUT);
        await discardEditors();

        assert.match(await menuConfirm(connections,
            [DUPLICATE, "uidrop", "Tables", "t"], ["Drop Table…"], "Drop"),
        /Drop the table uidrop\.t\?/);
        await waitGone(connections, [DUPLICATE, "uidrop", "Tables", "t"]);

        // Not dropped where the user said no.
        await menuConfirm(connections, [DUPLICATE, "uidrop"],
            ["Drop Schema…"], "Cancel");
        assert.ok(await hasTreeItem(connections, [DUPLICATE, "uidrop"]));
        assert.match(await menuConfirm(connections, [DUPLICATE, "uidrop"],
            ["Drop Schema…"], "Drop"), /Drop the schema uidrop\?/);
        await waitGone(connections, [DUPLICATE, "uidrop"]);
    });

    it("loads a SQL script from disk onto the connection", async () => {
        const file = join(FILES, "uitest-load.sql");
        writeFileSync(file, "SELECT DATABASE() AS db;\n");
        await menuAction(connections, [DUPLICATE],
            ["Load SQL Script from Disk…"], inputUp, "the file dialog");
        await answerFileDialog(file);
        await waitFor(async () => {
            return await (await new EditorView().getActiveTab())
                ?.getTitle() === "uitest-load.sql";
        }, "the script's editor");
        // Run on the duplicate, the one connection whose current schema
        // is uitest.
        await runAndSee("uitest");
        await discardEditors("uitest-load.sql");
    });

    it("deletes the duplicate", async () => {
        await menuConfirm(connections, [DUPLICATE], ["Delete Connection"],
            "Delete");
        await waitGone(connections, [DUPLICATE]);
        assert.ok(await hasTreeItem(connections, [`${CAPTION} 2`]));
    });

    it("makes it the default connection, and clears that again", async () => {
        const path = [`${CAPTION} 2`];
        await menuAction(connections, path, ["Set as Default Connection"],
            async () => {
                return (await (await treeItem(connections, path))
                    .getDescription() ?? "").includes("default");
            }, "the default marker");
        await menuAction(connections, path, ["Clear Default Connection"],
            async () => {
                return !(await (await treeItem(connections, path))
                    .getDescription() ?? "").includes("default");
            }, "the default marker to go");
    });

    it("copies the connection's URI", async () => {
        clearClipboard();
        await menuAction(connections, [`${CAPTION} 2`],
            ["Copy Connection URI"], async () => {
                return clipboard().trim() === URI;
            }, "the URI on the clipboard");
    });

    it("files the connection in a new folder, and renames it", async () => {
        await menuAction(connections, [`${CAPTION} 2`],
            ["New Folder with Selection…"], async () => {
                return true;
            }, "the folder prompt");
        await answerInput("Team");
        await waitFor(async () => {
            return await hasTreeItem(connections, ["Team", `${CAPTION} 2`]);
        }, "the connection in the folder");

        await menuAction(connections, ["Team"], ["Rename Folder…"],
            async () => { return true; }, "the rename prompt");
        await answerInput("Crew");
        await waitFor(async () => {
            return await hasTreeItem(connections, ["Crew", `${CAPTION} 2`]);
        }, "the renamed folder");
    });

    it("opens the connection, and closes it with Disconnect", async () => {
        const path = ["Crew", `${CAPTION} 2`];
        assert.ok((await childLabels(connections, path)).includes("uitest"));
        assert.ok((await contextMenuEntries(await treeItem(connections,
            path))).includes("Disconnect"));
        await menuAction(connections, path, ["Disconnect"], async () => {
            return (await contextMenuEntries(await treeItem(connections,
                path))).includes("Connect");
        }, "the connection to close");
        // Open before, with its schemas under it: closed now, not open
        // over nothing.
        await waitFor(async () => {
            return !await (await treeItem(connections, path)).isExpanded();
        }, "the closed connection's row to collapse");
        await menuAction(connections, path, ["Connect"], async () => {
            return (await contextMenuEntries(await treeItem(connections,
                path))).includes("Disconnect");
        }, "the connection to open");
    });

    it("deletes the connection, then the empty folder", async () => {
        assert.match(await menuConfirm(connections, ["Crew", `${CAPTION} 2`],
            ["Delete Connection"], "Delete"), /UI Copy 2|127\.0\.0\.1/);
        await waitGone(connections, ["Crew", `${CAPTION} 2`]);
        // The folder stays, empty, until it is removed.
        await menuAction(connections, ["Crew"], ["Remove Folder"],
            async () => {
                return !await hasTreeItem(connections, ["Crew"]);
            }, "the folder to go");
        // The sandbox's own connection is untouched.
        assert.ok(await hasTreeItem(connections, ["Sandboxes", ADDRESS]));
    });
});
