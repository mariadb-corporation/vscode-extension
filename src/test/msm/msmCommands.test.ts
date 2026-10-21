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

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GENERAL_ACTIONS } from "../../connections/connectionActivity.js";
import type { IMsmApi, IMsmProjectInfo } from "../../mcp/msmApi.js";
import {
    MSM_COMMANDS,
    MsmCommands,
    msmCall,
    projectContext,
} from "../../msm/msmCommands.js";
import { MSM_DIALOG_VIEW_TYPE } from "../../msm/msmDialogPanel.js";
import type {
    IMsmCreateValues,
    IMsmDeployValues,
    IMsmReleaseValues,
} from "../../msm/msmFields.js";
import type {
    IMsmLoadMessage,
    MsmHostMessage,
    MsmWebviewMessage,
} from "../../msm/msmProtocol.js";
import type { IActionRow } from "../../webview/protocol.js";
import {
    errorMessages,
    fileDialogs,
    registeredCommands,
    resetVscodeMock,
    setWorkspaceFolders,
    shownDocuments,
    Uri,
    webviewPanels,
    type MockWebviewPanel,
} from "../mocks/vscode.js";

const PROJECT = "/work/sakila.msm.project";
const SERVER = "mariadb://root@127.0.0.1:3310";

const info = (changes: Partial<IMsmProjectInfo> = {}): IMsmProjectInfo => {
    return {
        schemaName: "sakila", schemaFileName: "sakila",
        copyrights: [{ holder: "Ada" }], copyrightHolder: "Ada",
        license: "MIT", currentDevelopmentVersion: "1.0.1",
        lastReleasedVersion: "1.0.0",
        schemaDevelopmentFilePath: `${PROJECT}/development/sakila_next.sql`,
        ...changes,
    };
};

interface IRecorded {
    /** Every msm.* call, by method, with its arguments. */
    calls: Array<{ name: string; args: unknown[] }>;
    /** Every row put up, by the connection it is filed under. */
    rows: Array<{ connection: string; row: IActionRow }>;
    connected: string[];
    shownActions: string[];
    refreshed: string[];
    logs: string[];
    revealed: string[];
}

interface ISetUp {
    /** A method of the fake API that fails, and its message. */
    fail?: [keyof IMsmApi, string];
    released?: string[];
    scripts?: string[];
    /** The paths that exist, for the create checks. */
    existing?: string[];
    connections?: string[];
    defaultConnection?: string;
}

const setUp = (options: ISetUp = {}): IRecorded => {
    const recorded: IRecorded = {
        calls: [], rows: [], connected: [], shownActions: [], refreshed: [],
        logs: [], revealed: [],
    };
    const answer = <T>(name: keyof IMsmApi, value: T) => {
        return (...args: unknown[]): Promise<T> => {
            recorded.calls.push({ name, args });
            if (options.fail?.[0] === name) {
                return Promise.reject(new Error(options.fail[1]));
            }

            return Promise.resolve(value);
        };
    };
    const api: IMsmApi = {
        createProject: answer("createProject", PROJECT),
        projectInformation: answer("projectInformation", info()),
        releasedVersions: answer("releasedVersions",
            options.released ?? ["0.9.0", "1.0.0"]),
        deploymentScriptVersions: answer("deploymentScriptVersions",
            options.scripts ?? ["0.9.0"]),
        prepareRelease: answer("prepareRelease", [
            `${PROJECT}/releases/versions/sakila_1.0.1.sql`,
            `${PROJECT}/releases/updates/sakila_1.0.0_to_1.0.1.sql`,
        ]),
        generateDeploymentScript: answer("generateDeploymentScript",
            `${PROJECT}/releases/deployment/sakila_deployment_1.0.0.sql`),
        deploySchema: answer("deploySchema",
            "Schema sakila deployed in version 1.0.0."),
    };
    setWorkspaceFolders([{ name: "work", uri: Uri.file("/work") }]);
    registeredCommands.set("revealInExplorer", (uri: unknown) => {
        recorded.revealed.push((uri as Uri).fsPath);
    });

    new MsmCommands({
        extensionUri: Uri.file("/ext") as never,
        msmApi: () => { return Promise.resolve(api); },
        connect: (uri) => {
            recorded.connected.push(uri);

            return Promise.resolve(`id-of-${uri}`);
        },
        connectionUris: () => {
            return Promise.resolve(options.connections ?? [SERVER]);
        },
        defaultConnection: () => { return options.defaultConnection; },
        defaultFolder: () => { return "/home/me"; },
        put: (connection, row) => { recorded.rows.push({ connection, row }); },
        showActions: (connection) => { recorded.shownActions.push(connection); },
        refresh: (uri) => { recorded.refreshed.push(uri); },
        exists: (path) => {
            return Promise.resolve((options.existing ?? ["/work"])
                .includes(path));
        },
        log: (message) => { recorded.logs.push(message); },
    }).register();

    return recorded;
};

const panel = (): MockWebviewPanel => {
    return webviewPanels[webviewPanels.length - 1]!;
};

const posted = (): MsmHostMessage[] => {
    return panel().webview.posted as MsmHostMessage[];
};

const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
};

const receive = async (message: MsmWebviewMessage): Promise<void> => {
    panel().webview.receive(message);
    await settle();
};

const run = async (command: string, ...args: unknown[]): Promise<void> => {
    void registeredCommands.get(command)!(...args);
    await settle();
};

const loaded = async (): Promise<IMsmLoadMessage> => {
    await receive({ type: "ready" });

    return posted().find((message) => {
        return message.type === "load";
    }) as IMsmLoadMessage;
};

const errorsPosted = (): string[] => {
    return posted().flatMap((message) => {
        return message.type === "error" ? [message.message] : [];
    });
};

/** The last version of each action's row, the step rows under it. */
const actions = (recorded: IRecorded): Map<string, {
    connection: string;
    row: IActionRow;
}> => {
    const byId = new Map<string, { connection: string; row: IActionRow }>();
    for (const put of recorded.rows) {
        byId.set(put.row.id, put);
    }

    return byId;
};

const lastAction = (recorded: IRecorded): {
    connection: string;
    row: IActionRow;
} => {
    return [...actions(recorded).values()].pop()!;
};

const folder = (path: string): Uri => {
    return Uri.file(path);
};

describe("msmCall", () => {
    it("shows a call's arguments, leaving out those not given", () => {
        expect(msmCall("msm.prepare_release", {
            version: "1.0.0", next_version: "1.0.1", overwrite_existing: true,
            allow_to_stay_on_same_version: undefined,
        })).toBe("msm.prepare_release(version=1.0.0, next_version=1.0.1, "
            + "overwrite_existing=true)");
        // As every other call's row: a URI without its name.
        expect(msmCall("db.connect", { uri: "mariadb://a" }))
            .toBe("db.connect(mariadb://a)");
        expect(msmCall("t", {})).toBe("t()");
        // The connection's id is a UUID: the action names the connection.
        expect(msmCall("msm.deploy_schema", { connection_id: "c1", version: "1" }))
            .toBe("msm.deploy_schema(version=1)");
    });
});

describe("projectContext", () => {
    it("takes the holders from the copyright list", () => {
        expect(projectContext(info({
            copyrights: [{ holder: "Ada" }, { holder: "Bob" }],
        }), PROJECT, ["1.0.0"], []).copyrightHolders).toEqual(["Ada", "Bob"]);
    });

    it("falls back to the one holder of an older project", () => {
        const context = projectContext(info({ copyrights: [] }), PROJECT,
            [], []);

        expect(context.copyrightHolders).toEqual(["Ada"]);
    });

    it("leaves the last release out before there is one", () => {
        const context = projectContext(info({ lastReleasedVersion: null }),
            PROJECT, [], []);

        expect(context.lastReleasedVersion).toBeUndefined();
        expect(context.license).toBe("MIT");
    });
});

describe("New MSM Project", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("opens a dialog on the folder right-clicked, with the licenses", async () => {
        setUp();
        await run(MSM_COMMANDS.create, folder("/work"));

        expect(panel().viewType).toBe(MSM_DIALOG_VIEW_TYPE);
        expect(panel().title).toBe("New MSM Project");
        const load = await loaded();
        expect(load.kind).toBe("create");
        expect((load.values as IMsmCreateValues).targetPath).toBe("/work");
        expect(load.licenses).toEqual(["None", "BSD", "GPL-2.0", "MIT"]);
    });

    it("starts in the workspace folder from the palette", async () => {
        setUp();
        await run(MSM_COMMANDS.create);

        const load = await loaded();
        expect((load.values as IMsmCreateValues).targetPath).toBe("/home/me");
    });

    it("creates the project, opens its development script and shows it",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "sakila",
                copyrightHolder: " Ada ", license: "MIT",
            } });

            expect(recorded.calls.map((call) => { return call.name; }))
                .toEqual(["createProject", "projectInformation"]);
            expect(recorded.calls[0].args).toEqual([{
                schemaName: "sakila", targetPath: "/work",
                copyrightHolder: "Ada", license: "MIT",
                allowSpecialChars: false, overwriteExisting: false,
                enforceTargetPath: false,
            }]);
            expect(panel().disposed).toBe(true);
            expect(shownDocuments.map((document) => {
                return document.uri.fsPath;
            })).toEqual([`${PROJECT}/development/sakila_next.sql`]);
            expect(recorded.revealed).toEqual([PROJECT]);
        });

    it("leaves the Explorer alone for a project outside the workspace",
        async () => {
            const recorded = setUp();
            // The project is created in /work, which is no workspace folder.
            setWorkspaceFolders([{ name: "other", uri: Uri.file("/other") }]);
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "sakila",
                copyrightHolder: "Ada",
            } });

            expect(panel().disposed).toBe(true);
            expect(shownDocuments).toHaveLength(1);
            expect(recorded.revealed).toEqual([]);
        });

    it("is one General Action, with a row per call under it", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.create, folder("/work"));
        const load = await loaded();
        await receive({ type: "submit", values: {
            ...(load.values as IMsmCreateValues), schemaName: "sakila",
            copyrightHolder: "Ada",
        } });

        const { connection, row } = lastAction(recorded);
        expect(connection).toBe(GENERAL_ACTIONS);
        expect(row.role).toBe("run");
        expect(row.kind).toBe("info");
        expect(row.message).toBe("Created MSM project for schema sakila");
        expect(row.summary).toBe(PROJECT);
        expect(row.children?.map((child) => { return child.message; }))
            .toEqual(["Created the project folder", "Read the new project"]);
        expect(row.children?.[0].statement).toBe(PROJECT);
        // Every row was up while it ran, the spinner on it.
        expect(recorded.rows[0].row.kind).toBe("pending");
        expect(recorded.rows[0].row.message)
            .toBe("Creating MSM project for schema sakila…");
    });

    it("keeps the dialog open on a problem in a field, calling nothing",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "123",
                copyrightHolder: "Ada",
            } });

            expect(posted()).toContainEqual(expect.objectContaining({
                type: "error", field: "schemaName",
            }));
            expect(recorded.calls).toEqual([]);
            expect(recorded.rows).toEqual([]);
            expect(panel().disposed).toBe(false);
        });

    it("refuses a folder that is not there, unless it is to be made", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.create, folder("/nowhere"));
        const load = await loaded();
        const values = {
            ...(load.values as IMsmCreateValues), schemaName: "sakila",
            copyrightHolder: "Ada",
        };

        await receive({ type: "submit", values });
        expect(posted()).toContainEqual(expect.objectContaining({
            type: "error", field: "targetPath",
        }));
        expect(recorded.calls).toEqual([]);

        await receive({ type: "submit",
            values: { ...values, createTargetPath: true } });
        expect(recorded.calls[0].args[0]).toMatchObject({
            targetPath: "/nowhere", enforceTargetPath: true,
        });
    });

    it("refuses to replace a project unless told to", async () => {
        const recorded = setUp({ existing: ["/work", PROJECT] });
        await run(MSM_COMMANDS.create, folder("/work"));
        const load = await loaded();
        const values = {
            ...(load.values as IMsmCreateValues), schemaName: "sakila",
            copyrightHolder: "Ada",
        };

        await receive({ type: "submit", values });
        expect(errorsPosted()).toEqual([expect.stringMatching(
            /sakila\.msm\.project exists in this folder already/u)]);
        expect(recorded.calls).toEqual([]);

        await receive({ type: "submit",
            values: { ...values, overwriteExisting: true } });
        expect(recorded.calls[0].args[0]).toMatchObject({
            overwriteExisting: true,
        });
    });

    it("looks at the real disk when no test says otherwise", async () => {
        const work = mkdtempSync(join(tmpdir(), "msm-create-"));
        mkdirSync(join(work, "sakila.msm.project"));
        resetVscodeMock();
        const recorded: string[] = [];
        new MsmCommands({
            extensionUri: Uri.file("/ext") as never,
            msmApi: () => {
                recorded.push("msmApi");

                return Promise.reject(new Error("not called"));
            },
            connect: () => { return Promise.resolve(""); },
            connectionUris: () => { return Promise.resolve([]); },
            defaultConnection: () => { return undefined; },
            defaultFolder: () => { return work; },
            put: () => { /* nothing */ },
            showActions: () => { /* nothing */ },
            refresh: () => { /* nothing */ },
            log: () => { /* nothing */ },
        }).register();
        await run(MSM_COMMANDS.create, folder(work));
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmCreateValues), schemaName: "sakila",
            copyrightHolder: "Ada",
        } });

        expect(errorsPosted()).toEqual([expect.stringMatching(/exists/u)]);
        expect(recorded).toEqual([]);
    });

    it("shows the server's refusal in the dialog, and the failed action",
        async () => {
            const recorded = setUp({
                fail: ["createProject", "The project folder already exists."],
            });
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "sakila",
                copyrightHolder: "Ada",
            } });

            expect(errorsPosted()).toEqual(
                ["The project folder already exists."]);
            expect(panel().disposed).toBe(false);
            const { row } = lastAction(recorded);
            expect(row.kind).toBe("error");
            expect(row.message)
                .toBe("Creating MSM project for schema sakila failed");
            expect(row.jumpToRowId).toBe(row.children?.[0].id);
            expect(row.children?.[0].message).toBe("Creating the project "
                + "folder failed: The project folder already exists.");
            expect(row.children?.[0].statement).toMatch(
                /^msm\.create_project\(schema_name=sakila, target_path=\/work/u);
            expect(recorded.shownActions).toEqual([GENERAL_ACTIONS]);
            expect(posted().at(-1)).toEqual({ type: "busy", busy: false });
        });

    it("picks a folder with Browse", async () => {
        setUp();
        await run(MSM_COMMANDS.create, folder("/work"));
        await loaded();
        fileDialogs.openAnswer = [Uri.file("/picked")];

        await receive({ type: "browse", field: "targetPath", current: "/work" });

        expect(fileDialogs.openCalls.at(-1)).toMatchObject({
            canSelectFolders: true, canSelectFiles: false,
        });
        expect(posted()).toContainEqual({
            type: "browsed", field: "targetPath", path: "/picked",
        });
    });

    it("closes on Cancel, having done nothing", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.create, folder("/work"));
        await loaded();

        await receive({ type: "cancel" });

        expect(panel().disposed).toBe(true);
        expect(recorded.calls).toEqual([]);
    });
});

describe("a project's dialogs", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("reads the project first, as an action of its own", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.release, folder(PROJECT));

        expect(recorded.calls.map((call) => { return call.name; })).toEqual([
            "projectInformation", "releasedVersions", "deploymentScriptVersions",
        ]);
        const { connection, row } = lastAction(recorded);
        expect(connection).toBe(GENERAL_ACTIONS);
        expect(row.message).toBe("Read MSM project sakila.msm.project");
        expect(row.summary).toBe("sakila 1.0.1");
        expect(row.children?.map((child) => {
            return [child.message, child.statement];
        })).toEqual([
            ["Read the project information",
                "Schema sakila, development version 1.0.1"],
            ["Listed the released versions",
                "2 released versions: 0.9.0, 1.0.0"],
            ["Listed the deployment scripts", "1 deployment script: 0.9.0"],
        ]);
    });

    it("says so where the project cannot be read, and opens no dialog",
        async () => {
            const recorded = setUp({
                fail: ["projectInformation", "The path does not contain a "
                    + "MSM project folder."],
            });
            await run(MSM_COMMANDS.info, folder(PROJECT));

            expect(webviewPanels).toEqual([]);
            expect(errorMessages.join("\n")).toMatch(/does not contain/u);
            expect(lastAction(recorded).row.kind).toBe("error");
            expect(recorded.shownActions).toEqual([GENERAL_ACTIONS]);
        });

    it("refuses a folder that is not a project, by its name", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.release, folder("/work/sakila"));

        expect(errorMessages.join("\n")).toMatch(/not a schema project folder/u);
        expect(recorded.calls).toEqual([]);
    });

    it("asks for the project folder from the palette", async () => {
        const recorded = setUp();
        fileDialogs.openAnswer = [Uri.file(PROJECT)];

        await run(MSM_COMMANDS.info);

        expect(fileDialogs.openCalls.at(-1)).toMatchObject({
            title: "Choose a Schema Project Folder", canSelectFolders: true,
        });
        expect(recorded.calls[0]).toEqual({
            name: "projectInformation", args: [PROJECT],
        });
        expect(panel().title).toBe("MSM Project Information - sakila");
    });

    it("does nothing where the palette's picker was cancelled", async () => {
        const recorded = setUp();
        fileDialogs.openAnswer = undefined;

        await run(MSM_COMMANDS.deploy);

        expect(recorded.calls).toEqual([]);
        expect(webviewPanels).toEqual([]);
    });
});

describe("MSM Project Information", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("shows the project, as the server read it", async () => {
        setUp();
        await run(MSM_COMMANDS.info, folder(PROJECT));

        const load = await loaded();
        expect(load.kind).toBe("info");
        expect(load.project).toEqual({
            projectPath: PROJECT, schemaName: "sakila", license: "MIT",
            copyrightHolders: ["Ada"], currentDevelopmentVersion: "1.0.1",
            lastReleasedVersion: "1.0.0", releasedVersions: ["0.9.0", "1.0.0"],
            deploymentScriptVersions: ["0.9.0"],
            schemaDevelopmentFilePath: `${PROJECT}/development/sakila_next.sql`,
        });
    });

    it("opens the development script", async () => {
        setUp();
        await run(MSM_COMMANDS.info, folder(PROJECT));
        await loaded();

        await receive({ type: "open", what: "developmentFile" });

        expect(shownDocuments.map((document) => {
            return document.uri.fsPath;
        })).toEqual([`${PROJECT}/development/sakila_next.sql`]);
    });

    it("goes on to another dialog on the same project, in its place", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.info, folder(PROJECT));
        await loaded();
        const first = panel();
        const reads = recorded.calls.length;

        await receive({ type: "open", what: "release" });

        expect(first.disposed).toBe(true);
        expect(panel().title).toBe("Prepare Release - sakila");
        // On the project as read: not read again.
        expect(recorded.calls).toHaveLength(reads);
    });
});

describe("Prepare Release", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("starts on the development version and the next one", async () => {
        setUp();
        await run(MSM_COMMANDS.release, folder(PROJECT));

        const load = await loaded();
        expect(load.values).toEqual({
            version: "1.0.1", nextVersion: "1.0.2",
            allowToStayOnSameVersion: false, overwriteExisting: false,
        });
    });

    it("prepares the release, opens what it wrote, as one action", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.release, folder(PROJECT));
        const load = await loaded();

        await receive({ type: "submit", values: load.values });

        expect(recorded.calls.at(-1)).toEqual({
            name: "prepareRelease",
            args: [{
                projectPath: PROJECT, version: "1.0.1", nextVersion: "1.0.2",
                allowToStayOnSameVersion: false, overwriteExisting: false,
            }],
        });
        expect(panel().disposed).toBe(true);
        expect(shownDocuments).toHaveLength(2);
        const { connection, row } = lastAction(recorded);
        expect(connection).toBe(GENERAL_ACTIONS);
        expect(row.message).toBe("Prepared release 1.0.1 of sakila");
        expect(row.summary).toBe("Development goes on with 1.0.2");
        expect(row.children?.[0].statement).toBe("2 files written\n"
            + "sakila_1.0.1.sql\nsakila_1.0.0_to_1.0.1.sql");
    });

    it("refuses a release the plugin would refuse, before calling it",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.release, folder(PROJECT));
            await loaded();
            const before = recorded.calls.length;

            await receive({ type: "submit", values: {
                version: "1.0.0", nextVersion: "1.0.1",
                allowToStayOnSameVersion: false, overwriteExisting: false,
            } satisfies IMsmReleaseValues });

            expect(posted()).toContainEqual(expect.objectContaining({
                type: "error", field: "overwriteExisting",
            }));
            expect(recorded.calls).toHaveLength(before);
        });

    it("shows a failed release in the dialog and the Actions tab", async () => {
        const recorded = setUp({ fail: ["prepareRelease", "No statements."] });
        await run(MSM_COMMANDS.release, folder(PROJECT));
        const load = await loaded();

        await receive({ type: "submit", values: load.values });

        expect(errorsPosted()).toEqual(["No statements."]);
        expect(lastAction(recorded).row.message)
            .toBe("Preparing release 1.0.1 of sakila failed");
        expect(lastAction(recorded).row.children?.[0].statement)
            .toBe(`msm.prepare_release(schema_project_path=${PROJECT}, `
            + "version=1.0.1, next_version=1.0.2)");
        expect(recorded.shownActions).toEqual([GENERAL_ACTIONS]);
        expect(recorded.logs.join("\n")).toMatch(/Prepare Release - sakila failed/u);
    });
});

describe("Generate Deployment Script", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("generates the newest release's script and opens it", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.deploymentScript, folder(PROJECT));
        const load = await loaded();
        expect(load.values).toEqual({ version: "1.0.0", overwriteExisting: false });

        await receive({ type: "submit", values: load.values });

        expect(recorded.calls.at(-1)).toEqual({
            name: "generateDeploymentScript",
            args: [{ projectPath: PROJECT, version: "1.0.0",
                overwriteExisting: false }],
        });
        expect(shownDocuments.map((document) => {
            return document.uri.fsPath;
        })).toEqual([`${PROJECT}/releases/deployment/sakila_deployment_1.0.0.sql`]);
        const { row } = lastAction(recorded);
        expect(row.message)
            .toBe("Generated the deployment script for sakila 1.0.0");
        expect(row.summary).toBe(
            `${PROJECT}/releases/deployment/sakila_deployment_1.0.0.sql`);
    });

    it("asks before generating a script again", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.deploymentScript, folder(PROJECT));
        await loaded();
        const before = recorded.calls.length;

        await receive({ type: "submit",
            values: { version: "0.9.0", overwriteExisting: false } });
        expect(recorded.calls).toHaveLength(before);

        await receive({ type: "submit",
            values: { version: "0.9.0", overwriteExisting: true } });
        expect(recorded.calls.at(-1)?.args[0]).toMatchObject({
            version: "0.9.0", overwriteExisting: true,
        });
    });
});

describe("Deploy Schema", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("offers the connections, starting on the default one", async () => {
        setUp({
            connections: [SERVER, "mariadb://root@other:3306"],
            defaultConnection: "mariadb://root@other:3306",
        });
        await run(MSM_COMMANDS.deploy, folder(PROJECT));

        const load = await loaded();
        expect(load.connections).toEqual([
            { uri: SERVER, label: "root@127.0.0.1:3310" },
            { uri: "mariadb://root@other:3306", label: "root@other:3306" },
        ]);
        expect((load.values as IMsmDeployValues).connection)
            .toBe("mariadb://root@other:3306");
    });

    it("deploys onto the connection, as an action of that connection's",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.deploy, folder(PROJECT));
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmDeployValues),
                backupDirectory: " /backups ",
            } });

            expect(recorded.connected).toEqual([SERVER]);
            expect(recorded.calls.at(-1)).toEqual({
                name: "deploySchema",
                args: [{
                    projectPath: PROJECT, connectionId: `id-of-${SERVER}`,
                    version: "0.9.0", backup: true, backupDirectory: "/backups",
                }],
            });
            expect(recorded.refreshed).toEqual([SERVER]);
            expect(panel().disposed).toBe(true);
            const { connection, row } = lastAction(recorded);
            expect(connection).toBe(SERVER);
            expect(row.message)
                .toBe("Deployed sakila 0.9.0 onto root@127.0.0.1:3310");
            expect(row.summary).toBe("Schema sakila deployed in version 1.0.0.");
            expect(row.children?.map((child) => { return child.statement; }))
                .toEqual([
                    `db.connect(${SERVER})`,
                    "Schema sakila deployed in version 1.0.0.",
                ]);
        });

    it("sends no backup folder where none is to be made", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.deploy, folder(PROJECT));
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmDeployValues), backup: false,
            backupDirectory: "/ignored",
        } });

        expect(recorded.calls.at(-1)?.args[0]).toEqual({
            projectPath: PROJECT, connectionId: `id-of-${SERVER}`,
            version: "0.9.0", backup: false,
        });
        expect(lastAction(recorded).row.children?.[1]).toBeDefined();
    });

    it("brings up the connection's actions where a deploy fails", async () => {
        const recorded = setUp({
            fail: ["deploySchema", "Access denied for user 'root'"],
        });
        await run(MSM_COMMANDS.deploy, folder(PROJECT));
        const load = await loaded();

        await receive({ type: "submit", values: load.values });

        expect(errorsPosted()).toEqual(["Access denied for user 'root'"]);
        expect(recorded.shownActions).toEqual([SERVER]);
        expect(recorded.refreshed).toEqual([]);
        const { connection, row } = lastAction(recorded);
        expect(connection).toBe(SERVER);
        expect(row.kind).toBe("error");
        expect(row.children?.[1].statement).toBe(
            `msm.deploy_schema(schema_project_path=${PROJECT}, `
            + "version=0.9.0, backup=true)");
    });

    it("refuses to deploy before a connection is chosen", async () => {
        const recorded = setUp({
            connections: [SERVER, "mariadb://root@other:3306"],
        });
        await run(MSM_COMMANDS.deploy, folder(PROJECT));
        const load = await loaded();

        await receive({ type: "submit", values: load.values });

        expect(posted()).toContainEqual(expect.objectContaining({
            type: "error", field: "connection",
        }));
        expect(recorded.connected).toEqual([]);
    });
});
