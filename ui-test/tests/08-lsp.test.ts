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
    BottomBarPanel,
    ContentAssist,
    CustomTreeSection,
    EditorView,
    MarkerType,
    TextEditor,
} from "vscode-extension-tester";

import {
    CONNECTION,
    extensionLog,
    FILES,
    inlineAction,
    openSection,
    runCommand,
    screenshot,
    SERVER_TIMEOUT,
    treeItem,
    updateUserSettings,
    waitFor,
} from "../lib/ui";

/**
 * The SQL language server, mariadb-lsp: found on the PATH and started for
 * a SQL file, a syntax error in the Problems view until it is fixed,
 * completion from the tables of the file's connection, which the server
 * reads from the sandbox itself with the password the extension stored,
 * and from a catalog file named in the settings while the server runs.
 */

let connections: CustomTreeSection;

/** Opens a new SQL editor on the sandbox and puts the text in it. */
const sqlEditor = async (text: string): Promise<TextEditor> => {
    await inlineAction(await treeItem(connections, CONNECTION),
        "New SQL Editor");
    const editor = await waitFor(async () => {
        const title = await (await new EditorView().getActiveTab())?.getTitle();

        return title?.includes("MariaDB connection") === true
            ? new TextEditor() : undefined;
    }, "the new SQL editor");
    await setBody(editor, text);

    return editor;
};

/** Replaces what is below the connection header. */
const setBody = async (editor: TextEditor, text: string): Promise<void> => {
    const header = (await editor.getText()).split("\n")[0];
    await editor.setText(`${header}\n${text}`);
};

/** Closes the SQL editors without saving them. */
const discardEditors = async (): Promise<void> => {
    const editors = new EditorView();
    for (const title of await editors.getOpenEditorTitles()) {
        if (title.includes("MariaDB connection")) {
            await editors.openEditor(title);
            await runCommand("View: Revert and Close Editor");
        }
    }
};

/**
 * Opens the completion list until it offers a label: what is offered
 * may come from a catalog the server is still reading.
 *
 * @param editor The editor, its caret where completion is wanted.
 * @param label What has to be offered.
 * @param what What is waited for, for the timeout's message.
 *
 * @returns Every label offered then.
 */
const completionsWith = async (
    editor: TextEditor,
    label: string,
    what: string,
): Promise<string[]> => {
    return await waitFor(async () => {
        const assist = await editor.toggleContentAssist(true) as ContentAssist;
        const items = await Promise.all((await assist.getItems()).map(
            async (item) => {
                return await item.getLabel();
            }));
        await editor.toggleContentAssist(false);

        return items.includes(label) ? items : undefined;
    }, `${what}\n${extensionLog()}`, SERVER_TIMEOUT);
};

/**
 * Picks an item from the completion list, opening it if it is not open:
 * an item ending in a '.' opens it again by itself.
 *
 * @param editor The editor, its caret where completion is wanted.
 * @param label The item to pick.
 *
 * @returns Nothing.
 */
const pickCompletion = async (
    editor: TextEditor,
    label: string,
): Promise<void> => {
    await waitFor(async () => {
        const assist = await editor.toggleContentAssist(true) as ContentAssist;
        const item = await assist.getItem(label, 1000);
        if (item === undefined) {
            await editor.toggleContentAssist(false);

            return undefined;
        }
        await item.click();

        return true;
    }, `${label} in the completion list\n${extensionLog()}`, SERVER_TIMEOUT);
};

/**
 * Waits for a line of the editor to read `expected`.
 *
 * @param editor The editor.
 * @param line The line, from 1.
 * @param expected What it should read.
 *
 * @returns Nothing; on a timeout the error quotes what it read last.
 */
const lineBecomes = async (
    editor: TextEditor,
    line: number,
    expected: string,
): Promise<void> => {
    let last = "";
    try {
        await waitFor(async () => {
            last = await editor.getTextAtLine(line);

            return last === expected ? true : undefined;
        }, `line ${String(line)}`);
    } catch {
        assert.equal(last, expected);
    }
};

/**
 * Waits until the editor holds `expected` below its connection header.
 *
 * @param editor The editor.
 * @param expected The lines below the header.
 * @param what What is waited for, for the timeout's message.
 */
const bodyBecomes = async (
    editor: TextEditor,
    expected: string[],
    what: string,
): Promise<void> => {
    let last: string[] = [];
    try {
        await waitFor(async () => {
            last = (await editor.getText()).split("\n").slice(1);
            while (last.length > 0 && last.at(-1) === "") {
                last.pop();
            }

            return last.join("\n") === expected.join("\n") ? true : undefined;
        }, what, SERVER_TIMEOUT);
    } catch {
        assert.deepEqual(last, expected);
    }
};

/** Clicks the editor toolbar's format button. */
const clickFormat = async (): Promise<void> => {
    const button = await waitFor(async () => {
        return await new EditorView().getAction(
            "Format SQL (Selection or File)");
    }, "the format button in the editor toolbar");
    await button.click();
};

/** Two statements, neither laid out; the first is too long for a line. */
const UNFORMATTED = [
    "select c.name, c2.name from uitest.city as c left outer join "
    + "uitest.country as c2 on c.country_id = c2.id where c.id > 10;",
    "select id from uitest.city where id > 1;",
];

/** The first of them laid out (VS Code's default indentation: 4 spaces). */
const FIRST_FORMATTED = [
    "SELECT c.name, c2.name",
    "FROM uitest.city AS c",
    "    LEFT OUTER JOIN uitest.country AS c2 ON c.country_id = c2.id",
    "WHERE c.id > 10;",
];

/** The second of them laid out. */
const SECOND_FORMATTED = "SELECT id FROM uitest.city WHERE id > 1;";

/** The messages of the error markers in the Problems view. */
const errorMarkers = async (): Promise<string[]> => {
    const problems = await new BottomBarPanel().openProblemsView();
    const markers = await problems.getAllVisibleMarkers(MarkerType.Error);

    return await Promise.all(markers.map(async (marker) => {
        return await marker.getText();
    }));
};

describe("SQL language server", () => {
    before(async () => {
        connections = await openSection("Connections");
    });

    // Each test opens editors of its own; left open, they move the
    // focus off the tree row whose New SQL Editor button the next needs.
    afterEach(async () => {
        await discardEditors();
    });

    after(async () => {
        await new BottomBarPanel().toggle(false);
    });

    it("marks a syntax error until it is fixed", async () => {
        const editor = await sqlEditor("SELEC 1;\n");
        const errors = await waitFor(async () => {
            const found = await errorMarkers();

            return found.length > 0 ? found : undefined;
        }, `a syntax error in the Problems view\n${extensionLog()}`,
        SERVER_TIMEOUT);
        assert.match(errors.join("\n"), /syntax error near 'SELEC'/);
        await screenshot("08-syntax-error");
        assert.match(extensionLog(40),
            /mariadb-lsp \S+ found (on the PATH|in ~\/\.local\/bin)/);

        await setBody(editor, "SELECT 1;\n");
        await waitFor(async () => {
            return (await errorMarkers()).length === 0 ? true : undefined;
        }, "the syntax error gone", SERVER_TIMEOUT);
    });

    it("completes the tables of the file's connection", async () => {
        const editor = await sqlEditor("SELECT * FROM uitest.");
        await editor.moveCursor(2, "SELECT * FROM uitest.".length + 1);
        // The server reads the sandbox's catalog in the background; until
        // it has, the list has no tables, so it is asked again.
        const labels = await completionsWith(editor, "city",
            "the sandbox's tables in the completion list");
        assert.ok(labels.includes("country"), labels.join(", "));
    });

    it("goes from a schema to a table to a column, adding the table to FROM",
        async () => {
            const editor = await sqlEditor("SELECT ");
            await editor.moveCursor(2, "SELECT ".length + 1);
            // No schema in the connection's URI: the schemas come first.
            await pickCompletion(editor, "uitest");
            await pickCompletion(editor, "city");
            await pickCompletion(editor, "name");
            await lineBecomes(editor, 2, "SELECT c.name FROM uitest.city AS c");

            // Another column: the table's own first, then the tables it
            // has a foreign key with, joined on it.
            await editor.typeText(", ");
            const labels = await completionsWith(editor, "country",
                "the related table after the comma");
            assert.deepEqual(labels.slice(0, 3),
                ["c.country_id", "c.id", "c.name"]);
            await pickCompletion(editor, "country");
            await pickCompletion(editor, "name");
            // Past 80 characters: the join starts a line of its own, one
            // level deeper than FROM.
            await lineBecomes(editor, 2,
                "SELECT c.name, c2.name FROM uitest.city AS c");
            await lineBecomes(editor, 3,
                "  LEFT OUTER JOIN uitest.country AS c2 ON c.country_id = c2.id");
            await screenshot("08-joined");
        });

    it("formats the file with Format Document", async () => {
        const editor = await sqlEditor(UNFORMATTED.join("\n") + "\n");
        await runCommand("Format Document");
        await bodyBecomes(editor, [...FIRST_FORMATTED, SECOND_FORMATTED],
            "the file formatted by the language server");
    });

    it("formats the whole file from the toolbar when nothing is selected",
        async () => {
            const editor = await sqlEditor(UNFORMATTED.join("\n") + "\n");
            await editor.moveCursor(2, 1);
            await clickFormat();
            await bodyBecomes(editor, [...FIRST_FORMATTED, SECOND_FORMATTED],
                "the whole file formatted from the toolbar");
            await screenshot("08-formatted");
        });

    it("formats only the selected statement from the toolbar", async () => {
        const editor = await sqlEditor(UNFORMATTED.join("\n") + "\n");
        await editor.selectText("select id");
        await clickFormat();
        await bodyBecomes(editor, [UNFORMATTED[0], SECOND_FORMATTED],
            "the selected statement formatted, the other left as it was");
    });

    it("completes the tables of a catalog file named in the settings",
        async () => {
            const catalog = join(FILES, "catalog.sql");
            writeFileSync(catalog,
                "CREATE TABLE offline.ledger (id INT, amount DECIMAL(10,2));\n");
            const editor = await sqlEditor("SELECT * FROM offline.");
            await editor.moveCursor(2, "SELECT * FROM offline.".length + 1);
            // Sent to the running server, which reads the file then.
            updateUserSettings({ "mariadb.lsp.catalogFiles": [catalog] });
            try {
                await completionsWith(editor, "ledger",
                    "the catalog file's table in the completion list");
                await screenshot("08-catalog-file");
            } finally {
                updateUserSettings({ "mariadb.lsp.catalogFiles": undefined });
            }
        });
});
