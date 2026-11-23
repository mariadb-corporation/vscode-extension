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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ConnectionManager } from "../../connections/connectionManager.js";
import { CurrentSchemas } from "../../connections/currentSchemas.js";
import { OBJECT_TYPES, type ObjectType } from "../../mcp/types.js";
import type {
    IConnectionNode,
    IObjectNode,
    ISchemaNode,
} from "../../tree/connectionsModel.js";
import {
    dropCommandOf,
    registerSchemaRowCommands,
} from "../../tree/schemaRowCommands.js";
import { SystemSchemaVisibility } from "../../tree/systemSchemas.js";
import { createFakeApi, createFakeSettings, createRecordingLog } from
    "../helpers.js";
import {
    MockTextDocument,
    Uri,
    env,
    registeredCommands,
    resetVscodeMock,
    setActiveTextEditor,
    setWarningMessageAnswer,
    warningMessageCalls,
} from "../mocks/vscode.js";

const DBA = "mariadb://dba@localhost:3310";

const CITY: IObjectNode = {
    kind: "object",
    uri: DBA,
    schema: "world",
    objectType: "table",
    name: "city",
};

const WORLD: ISchemaNode = {
    kind: "schema",
    uri: DBA,
    schema: "world",
    schemaType: "User Schema",
    comment: "",
};

const run = async (command: string, ...args: unknown[]): Promise<void> => {
    await registeredCommands.get(command)!(...args);
};

const createHost = () => {
    const api = createFakeApi({
        connections: [DBA],
        connectionIds: { [DBA]: "uuid-dba" },
        sqlResults: {
            "SHOW CREATE TABLE `world`.`city`": {
                result_sets: [{
                    columns: ["Table", "Create Table"],
                    rows: [{
                        "Table": "city",
                        "Create Table": "CREATE TABLE `city` (`id` int)",
                    }],
                }],
            },
        },
    });
    const connections = new ConnectionManager(
        () => { return Promise.resolve(api); },
        createFakeSettings(),
    );
    const scripts: string[] = [];
    let refreshed = 0;
    const host = {
        connections,
        editors: {
            runScript: (_uri: string, script: string) => {
                scripts.push(script);

                return Promise.resolve();
            },
            openSqlEditor: () => {
                return Promise.reject(new Error("not expected"));
            },
            bindConnection: () => { /* nothing to bind in a test */ },
        },
        currentSchemas: new CurrentSchemas(connections),
        systemSchemas: new SystemSchemaVisibility(),
        refreshTree: () => { refreshed += 1; },
        log: createRecordingLog(),
    };
    registerSchemaRowCommands(host as never);

    return { api, host, scripts, refreshed: () => { return refreshed; } };
};

describe("the Connections view's schema and object commands", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("drops an object once the user confirmed it", async () => {
        const { scripts } = createHost();

        setWarningMessageAnswer(undefined);
        await run("mariadb.dropTable", CITY);
        expect(scripts).toEqual([]);

        setWarningMessageAnswer("Drop");
        await run("mariadb.dropTable", CITY);
        expect(warningMessageCalls.at(-1)?.message)
            .toBe("Drop the table world.city?");
        expect(scripts).toEqual(["DROP TABLE `world`.`city`;"]);

        setWarningMessageAnswer("Drop");
        await run("mariadb.dropSchema", WORLD);
        expect(scripts.at(-1)).toBe("DROP DATABASE `world`;");
    });

    it("copies a name and a CREATE statement", async () => {
        createHost();

        await run("mariadb.copyName", CITY);
        expect(env.clipboard.text).toBe("city");

        await run("mariadb.copyCreateStatement", CITY);
        expect(env.clipboard.text).toBe("CREATE TABLE `city` (`id` int)");
    });

    it("sends a name to where the caret is in the active SQL editor",
        async () => {
            createHost();
            const replaced: string[] = [];
            const editor = {
                document: new MockTextDocument(Uri.file("/work/q.sql"),
                    "mariadb-sql", ""),
                selections: [{}],
                edit: (build: (builder: {
                    replace: (at: unknown, text: string) => void;
                }) => void) => {
                    build({ replace: (_at, text) => { replaced.push(text); } });

                    return Promise.resolve(true);
                },
            };
            setActiveTextEditor(editor);
            // showTextDocument answers its own editor; the one shown is the
            // one written to.
            const { window } = await import("../mocks/vscode.js");
            const show = window.showTextDocument;
            window.showTextDocument = (() => {
                return Promise.resolve(editor);
            }) as never;

            try {
                await run("mariadb.sendNameToEditor", WORLD);
            } finally {
                window.showTextDocument = show;
            }

            expect(replaced).toEqual(["world"]);
        });

    it("sets the current schema", async () => {
        const { host } = createHost();
        await host.connections.connect(DBA);

        await run("mariadb.setCurrentSchema", WORLD);

        expect(host.currentSchemas.of(DBA)).toBe("world");
    });

    it("hides and shows a connection's system schemas", async () => {
        const { host, refreshed } = createHost();
        const node = { kind: "connection", uri: DBA } as IConnectionNode;

        await run("mariadb.hideSystemSchemas", node);
        expect(host.systemSchemas.hides(DBA)).toBe(true);
        await run("mariadb.showSystemSchemas", node);
        expect(host.systemSchemas.hides(DBA)).toBe(false);
        expect(refreshed()).toBe(2);
    });
});

describe("the menus of the schema and object commands", () => {
    interface IEntry { command?: string; submenu?: string; when?: string }
    const manifest = JSON.parse(readFileSync(
        join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8",
    )) as {
        contributes: {
            commands: Array<{ command: string }>;
            menus: Record<string, IEntry[]>;
        };
    };
    const items = manifest.contributes.menus["view/item/context"]!;

    /**
     * @returns Whether an entry is offered on a row of the Connections
     *          view with this context value. Only the forms used here.
     */
    const offeredOn = (entry: IEntry, viewItem: string): boolean => {
        return (entry.when ?? "").split(" || ").some((alternative) => {
            if (!alternative.includes("view == mariadb.connections")) {
                return false;
            }
            const equals = /viewItem == (\S+)/u.exec(alternative);
            if (equals) {
                return equals[1] === viewItem;
            }
            const matches = /viewItem =~ \/(.+?)\/(?:\s|$)/u.exec(alternative);

            return matches !== null
                && new RegExp(matches[1]!.replaceAll("\\\\", "\\"), "u")
                    .test(viewItem);
        });
    };

    const commandsOn = (viewItem: string): string[] => {
        return items.filter((entry) => {
            return offeredOn(entry, viewItem);
        }).map((entry) => { return entry.command ?? entry.submenu ?? ""; });
    };

    it.each(OBJECT_TYPES)("offers each %s its own drop", (type: ObjectType) => {
        const offered = commandsOn(`mariadbObject.${type}`);

        expect(offered).toContain(dropCommandOf(type));
        expect(offered.filter((command) => {
            return command.startsWith("mariadb.drop");
        })).toHaveLength(1);
        expect(offered).toContain("mariadb.copyToClipboard");
        expect(offered).toContain("mariadb.sendToEditor");
    });

    it("offers Set As Current Schema on any schema but the current one",
        () => {
            expect(commandsOn("mariadbSchema"))
                .toContain("mariadb.setCurrentSchema");
            const current = commandsOn("mariadbSchema.current");
            expect(current).not.toContain("mariadb.setCurrentSchema");
            // The rest is the same.
            expect(current).toContain("mariadb.dropSchema");
            expect(current).toContain("mariadb.mrs.addSchema");
        });

    it("offers Show or Hide System Schemas by the connection's state", () => {
        const shown = commandsOn(
            "mariadbConnection.connected.systemShown.notDefault");
        expect(shown).toContain("mariadb.hideSystemSchemas");
        expect(shown).not.toContain("mariadb.showSystemSchemas");
        expect(shown).toContain("mariadb.duplicateConnection");
        expect(shown).toContain("mariadb.loadSqlScript");
        expect(commandsOn("mariadbConnection.disconnected.systemHidden.default"))
            .toContain("mariadb.showSystemSchemas");
    });

    it("keeps every new command out of the palette", () => {
        const hidden = new Set(manifest.contributes.menus.commandPalette!
            .filter((entry) => { return entry.when === "false"; })
            .map((entry) => { return entry.command; }));

        for (const command of [...OBJECT_TYPES.map(dropCommandOf),
            "mariadb.dropSchema", "mariadb.setCurrentSchema",
            "mariadb.copyName", "mariadb.copyCreateStatement",
            "mariadb.sendNameToEditor", "mariadb.sendCreateStatementToEditor",
            "mariadb.duplicateConnection", "mariadb.loadSqlScript",
            "mariadb.showSystemSchemas", "mariadb.hideSystemSchemas"]) {
            expect(hidden.has(command), command).toBe(true);
        }
    });
});
