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
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GENERAL_ACTIONS } from "../../connections/connectionActivity.js";
import type {
    IMsmApi,
    IMsmImportResult,
    IMsmListedProject,
    IMsmLiveSchema,
    IMsmProjectInfo,
} from "../../mcp/msmApi.js";
import type { ITaskState } from "../../mcp/taskApi.js";
import {
    changedDetails,
    MSM_COMMANDS,
    MSM_IMPORT_COMMAND,
    MSM_LIST_COMMANDS,
    MsmCommands,
    msmCall,
    diagramNameProblem,
    newDiagramName,
    projectContext,
} from "../../msm/msmCommands.js";
import { MSM_DIALOG_VIEW_TYPE } from "../../msm/msmDialogPanel.js";
import { textsOf } from "../../tableEditor/onlineAlter.js";
import {
    CUSTOM_LICENSE_START,
    type IMsmCreateValues,
    type IMsmDeployValues,
    type IMsmEditValues,
    type IMsmImportValues,
    type IMsmReleaseValues,
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
    warningMessages,
    webviewPanels,
    workspace,
    type MockWebviewPanel,
} from "../mocks/vscode.js";

const PROJECT = "/work/sakila.msm.project";
const SERVER = "mariadb://root@127.0.0.1:3310";

/** The project as msm.list_projects reports it. */
const LISTED: IMsmListedProject = {
    projectPath: PROJECT, folder: "/Shop", caption: "", color: "green",
    mcpAccess: false, schemaName: "sakila", exists: true,
};

const info = (changes: Partial<IMsmProjectInfo> = {}): IMsmProjectInfo => {
    return {
        schemaName: "sakila", schemaFileName: "sakila",
        copyrights: [{ holder: "Ada", yearOfCreation: "2024",
            tracksUpdates: true }], copyrightHolder: "Ada",
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
    /** The sessions connected and disconnected, `<uri> <session>` each. */
    sessions: string[];
    disconnected: string[];
    shownActions: string[];
    refreshed: string[];
    logs: string[];
    revealed: string[];
    /** How often the MSM Projects view was told to read the list again. */
    projectsChanged: number;
    /** The projects taken off the list. */
    removedProjects: string[];
    /** The projects shown in the MSM Projects view. */
    revealedProjects: string[];
    /** The tasks followed, by their title. */
    followed: string[];
    /** The tasks that did not start: `<connection> <title>: <error>`. */
    startFailed: string[];
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
    /** What msm.list_projects answers. */
    listed?: IMsmListedProject[];
    /** What msm.get_project_information answers, changed. */
    info?: Partial<IMsmProjectInfo>;
    /** msm.project.json's onlineAlter, as msm.get_online_alter_settings has it. */
    online?: Record<string, unknown>;
    /** How an import's task ends. */
    imported?: Partial<ITaskState>;
}

/** A schema on a server, as msm.list_live_schema_objects lists it. */
const LIVE: IMsmLiveSchema = {
    schema: "sakila",
    tables: [{ name: "actor", comment: "", triggers: ["actor_bi"] },
        { name: "film", comment: "Films", triggers: [] }],
    views: [{ name: "actor_info", comment: "" }],
    procedures: [{ name: "rewards" }],
    functions: [],
    triggers: [{ name: "actor_bi", table: "actor" }],
    events: [],
    sequences: [],
    schema_version: "1.0.0",
    left_out: ["msm_schema_version"],
};

/** What an import's task ends with. */
const IMPORTED: IMsmImportResult = {
    project_path: "/work/sakila.msm.project", schema: "sakila", tables: 2,
    sequences: 0, views: 1, routines: 1, triggers: 1, events: 0,
    schema_version: "1.0.0", warnings: [], files: [],
};

/** msm's online ALTER TABLE defaults. */
const ONLINE_ALTER_DEFAULTS = { maxRebuildBytes: 10 * 1024 ** 3,
    galeraMaxBytes: 256 * 1024 ** 2, nboLock: null, maxLockedBytes: null,
    lockWait: 5, maxRetries: 10 };

const setUp = (options: ISetUp = {}): IRecorded => {
    const recorded: IRecorded = {
        calls: [], rows: [], connected: [], sessions: [], disconnected: [],
        shownActions: [], refreshed: [],
        logs: [], revealed: [], projectsChanged: 0, revealedProjects: [],
        removedProjects: [], followed: [], startFailed: [],
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
        projectInformation: answer("projectInformation", info(options.info)),
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
        listProjects: answer("listProjects", options.listed ?? [LISTED]),
        addProject: answer("addProject", LISTED),
        updateProject: answer("updateProject", LISTED),
        removeProject: answer("removeProject", PROJECT),
        listSchemaDiagrams: answer("listSchemaDiagrams", { diagrams: [] }),
        getSchemaDiagrams: answer("getSchemaDiagrams", []),
        getSchemaDiagramImage: answer("getSchemaDiagramImage", ""),
        setSchemaDiagram: answer("setSchemaDiagram", []),
        createEmptySchemaDiagram: answer("createEmptySchemaDiagram", undefined),
        removeSchemaDiagram: answer("removeSchemaDiagram", []),
        renameSchemaDiagram: answer("renameSchemaDiagram", []),
        renameSchema: answer("renameSchema", { allowed: true,
            projectPath: PROJECT, previousProjectPath: PROJECT, files: [],
            migration: [], warnings: [] }),
        layoutSchemaDiagram: answer("layoutSchemaDiagram",
            { name: "Main", placed: [], connections_added: 0, files: [] }),
        getOnlineAlterSettings: answer("getOnlineAlterSettings", {
            defaults: ONLINE_ALTER_DEFAULTS, setting: options.online ?? {} }),
        setProjectSettings: answer("setProjectSettings", []),
        onlineAlterDefaults: answer("onlineAlterDefaults",
            ONLINE_ALTER_DEFAULTS),
        onlineAlterTable: answer("onlineAlterTable",
            { task_id: "t1", status: "pending" }),
        updateSchemaDefinition: answer("updateSchemaDefinition", undefined),
        editSchema: answer("editSchema", {
            rows: [], files: [], migration: [], notes: [],
        }),
        setDevelopmentVersion: answer("setDevelopmentVersion", undefined),
        listLiveSchemaObjects: answer("listLiveSchemaObjects", LIVE),
        importLiveSchema: answer("importLiveSchema",
            { task_id: "t2", status: "pending" }),
        getObjectTemplates: answer("getObjectTemplates",
            { templates: {}, placeholders: {} } as never),
        addSchemaObject: answer("addSchemaObject", { rows: [], files: [],
            migration: [], notes: [], file: "", line: 1 }),
    };
    setWorkspaceFolders([{ name: "work", uri: Uri.file("/work") }]);
    registeredCommands.set("revealInExplorer", (uri: unknown) => {
        recorded.revealed.push((uri as Uri).fsPath);
    });

    new MsmCommands({
        extensionUri: Uri.file("/ext") as never,
        msmApi: () => { return Promise.resolve(api); },
        connect: (uri, session) => {
            recorded.connected.push(uri);
            recorded.sessions.push(`${uri} ${session}`);

            return Promise.resolve(`id-of-${uri}`);
        },
        disconnect: (uri, session) => {
            recorded.disconnected.push(`${uri} ${session}`);

            return Promise.resolve();
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
        projectsChanged: () => { recorded.projectsChanged += 1; },
        projectRemoved: (projectPath) => {
            recorded.removedProjects.push(projectPath);
        },
        projectFolders: () => { return Promise.resolve(["/Shop"]); },
        listedProject: (projectPath) => {
            return Promise.resolve((options.listed ?? [LISTED]).find(
                (project) => { return project.projectPath === projectPath; }));
        },
        revealProject: (path) => {
            recorded.revealedProjects.push(path);

            return Promise.resolve();
        },
        followTask: (started, followed) => {
            recorded.followed.push(followed.title);

            return Promise.resolve({
                task_id: started.task_id, status: "completed",
                result: IMPORTED, ...options.imported,
            } as ITaskState);
        },
        startFailed: (connection, title, _call, error) => {
            recorded.startFailed.push(`${connection} ${title}: ${error}`);
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

describe("newDiagramName", () => {
    it("numbers a new diagram past the names in use, in any case", () => {
        expect(newDiagramName([])).toBe("Diagram 1");
        expect(newDiagramName(["Main", "diagram 1", "Diagram 2"]))
            .toBe("Diagram 3");
    });

    it("takes a name in use in another case for taken", () => {
        expect(diagramNameProblem(["Main", "Diagram 1"], "diagram 1"))
            .toBe("The project has a diagram diagram 1 already.");
        expect(diagramNameProblem(["Main"], "Diagram 1")).toBeUndefined();
        expect(diagramNameProblem(["Main"], "  ")).toBe("Enter a name.");
        expect(diagramNameProblem(["Main"], "schema_definition"))
            .toMatch(/schema snapshot/u);
        expect(diagramNameProblem(["Main"], "Schema_Definition"))
            .toMatch(/schema snapshot/u);
        expect(diagramNameProblem(["Main"], " main ")).toBe(
            "The project has a diagram main already.");
        expect(diagramNameProblem(["Main"], "Overview")).toBeUndefined();
    });
});

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
        expect(msmCall("msm.deploy_schema",
            { connection_id: "c1", version: "1" }))
            .toBe("msm.deploy_schema(version=1)");
    });
});

describe("projectContext", () => {
    it("takes the holders and their years from the copyright list", () => {
        expect(projectContext(info({
            copyrights: [
                { holder: "Ada", yearOfCreation: "2024",
                    yearOfLastUpdate: "2026", tracksUpdates: true },
                { holder: "Bob", yearOfCreation: "2025" },
            ],
        }), PROJECT, ["1.0.0"], []).copyrights).toEqual([
            { holder: "Ada", yearOfCreation: "2024", yearOfLastUpdate: "2026",
                tracksUpdates: true },
            { holder: "Bob", yearOfCreation: "2025", yearOfLastUpdate: "",
                tracksUpdates: false },
        ]);
    });

    it("falls back to the one holder of an older project", () => {
        const context = projectContext(info({ copyrights: [],
            yearOfCreation: "2023" }), PROJECT, [], []);

        expect(context.copyrights).toEqual([{ holder: "Ada",
            yearOfCreation: "2023", yearOfLastUpdate: "",
            tracksUpdates: false }]);
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

    it("opens a dialog on the folder right-clicked, with the licenses",
        async () => {
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
                yearOfCreation: " 2024 ",
            } });

            expect(recorded.calls.map((call) => { return call.name; }))
                .toEqual(["createProject", "projectInformation"]);
            expect(recorded.calls[0].args).toEqual([{
                schemaName: "sakila", targetPath: "/work",
                copyrightHolder: "Ada", license: "MIT",
                allowSpecialChars: false, overwriteExisting: false,
                enforceTargetPath: false, yearOfCreation: "2024",
                mcpAccess: false,
            }]);
            expect(panel().disposed).toBe(true);
            expect(shownDocuments.map((document) => {
                return document.uri.fsPath;
            })).toEqual([`${PROJECT}/development/sakila_next.sql`]);
            // In the Explorer only: the view's reveal would switch the
            // side bar away from it.
            expect(recorded.revealed).toEqual([PROJECT]);
            expect(recorded.revealedProjects).toEqual([]);
        });

    it("creates a project with a custom license: none, then its text",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();
            const text = "-- Ours, ${year}.";

            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "sakila",
                copyrightHolder: "Ada", license: "CUSTOM", customLicense: text,
            } });

            // msm creates no project with a license text.
            expect(recorded.calls.map((call) => { return call.name; }))
                .toEqual(["createProject", "setProjectSettings",
                    "projectInformation"]);
            expect(recorded.calls[0].args[0]).toMatchObject(
                { license: "None" });
            expect(recorded.calls[1].args).toEqual([PROJECT,
                { license: "CUSTOM", customLicense: text }]);
            expect(shownDocuments.map((document) => {
                return document.uri.fsPath;
            })).toEqual([`${PROJECT}/development/sakila_next.sql`]);
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

    it("is a General Action, and reading the new project another", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.create, folder("/work"));
        const load = await loaded();
        await receive({ type: "submit", values: {
            ...(load.values as IMsmCreateValues), schemaName: "sakila",
            copyrightHolder: "Ada",
        } });

        const [created, read] = [...actions(recorded).values()];
        expect(created.connection).toBe(GENERAL_ACTIONS);
        expect(created.row.kind).toBe("info");
        expect(created.row.message)
            .toBe("Created MSM project for schema sakila");
        expect(created.row.summary).toBe(PROJECT);
        expect(created.row.children?.map((child) => { return child.message; }))
            .toEqual(["Created the project folder"]);
        expect(created.row.children?.[0].statement).toBe(PROJECT);
        expect(read.connection).toBe(GENERAL_ACTIONS);
        expect(read.row.kind).toBe("info");
        expect(read.row.message)
            .toBe("Read the new MSM project sakila.msm.project");
        // One call: its own row, no child saying it again.
        expect(read.row.children).toBeUndefined();
        // Every row was up while it ran, the spinner on it.
        expect(recorded.rows[0].row.kind).toBe("pending");
        expect(recorded.rows[0].row.message)
            .toBe("Creating MSM project for schema sakila…");
    });

    it("says on its own that the new project cannot be read, it being made",
        async () => {
            const recorded = setUp({
                fail: ["projectInformation", "Timed out."],
            });
            await run(MSM_COMMANDS.create, folder("/work"));
            const load = await loaded();
            await receive({ type: "submit", values: {
                ...(load.values as IMsmCreateValues), schemaName: "sakila",
                copyrightHolder: "Ada",
            } });

            // Created: the dialog closed, its action done.
            expect(panel().disposed).toBe(true);
            expect(errorsPosted()).toEqual([]);
            const [created, read] = [...actions(recorded).values()];
            expect(created.row.kind).toBe("info");
            // The reading is the failure, and says so.
            expect(read.row.kind).toBe("error");
            const said = new RegExp("sakila\\.msm\\.project was created, but "
                + "could not be read: Timed out\\.", "u");
            expect(errorMessages.join("\n")).toMatch(said);
            expect(shownDocuments).toEqual([]);
            expect(recorded.revealed).toEqual([]);
        });

    it("says on its own that the new script cannot be opened, the project made",
        async () => {
            const recorded = setUp();
            const open = workspace.openTextDocument;
            workspace.openTextDocument = () => {
                return Promise.reject(new Error("EACCES: permission denied"));
            };
            try {
                await run(MSM_COMMANDS.create, folder("/work"));
                const load = await loaded();
                await receive({ type: "submit", values: {
                    ...(load.values as IMsmCreateValues), schemaName: "sakila",
                    copyrightHolder: "Ada",
                } });
            } finally {
                workspace.openTextDocument = open;
            }

            // Done: the dialog closed, the action is done, not failed.
            expect(panel().disposed).toBe(true);
            expect(errorsPosted()).toEqual([]);
            expect(lastAction(recorded).row.kind).toBe("info");
            expect(recorded.shownActions).toEqual([]);
            expect(errorMessages.join("\n")).toMatch(/permission denied/u);
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

    it("refuses a folder that is not there, unless it is to be made",
        async () => {
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

    it("reads ~ as the home folder, and leaves a relative one to the server",
        async () => {
            const recorded = setUp({ existing: [homedir()] });
            for (const targetPath of ["~", "projects"]) {
                await run(MSM_COMMANDS.create, folder("/work"));
                const load = await loaded();
                await receive({ type: "submit", values: {
                    ...(load.values as IMsmCreateValues),
                    schemaName: "sakila", copyrightHolder: "Ada", targetPath,
                } });
            }

            expect(recorded.calls.filter((call) => {
                return call.name === "createProject";
            }).map((call) => {
                return (call.args[0] as { targetPath: string }).targetPath;
            })).toEqual(["~", "projects"]);
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
            disconnect: () => { return Promise.resolve(); },
            connectionUris: () => { return Promise.resolve([]); },
            defaultConnection: () => { return undefined; },
            defaultFolder: () => { return work; },
            put: () => { /* nothing */ },
            showActions: () => { /* nothing */ },
            refresh: () => { /* nothing */ },
            followTask: () => { return Promise.reject(new Error("no task")); },
            startFailed: () => { /* nothing */ },
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
            customLicense: "",
            copyrights: [{ holder: "Ada", yearOfCreation: "2024",
                yearOfLastUpdate: "", tracksUpdates: true }],
            currentDevelopmentVersion: "1.0.1",
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

    it("goes on to another dialog on the same project, in its place",
        async () => {
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
        // One call: one row, what the release came to before its files.
        expect(row.children).toBeUndefined();
        expect(row.statement).toBe("Development goes on with 1.0.2\n"
            + "2 files written\nsakila_1.0.1.sql\nsakila_1.0.0_to_1.0.1.sql");
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
        // The error is a row of its own, with the call.
        expect(lastAction(recorded).row.children?.[0].message)
            .toBe("Preparing release 1.0.1 of sakila failed: No statements.");
        expect(lastAction(recorded).row.children?.[0].statement)
            .toBe(`msm.prepare_release(schema_project_path=${PROJECT}, `
            + "version=1.0.1, next_version=1.0.2)");
        expect(recorded.shownActions).toEqual([GENERAL_ACTIONS]);
        expect(recorded.logs.join("\n"))
            .toMatch(/Prepare Release - sakila failed/u);
    });
});

describe("Generate Deployment Script", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("generates the newest release's script and opens it", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.deploymentScript, folder(PROJECT));
        const load = await loaded();
        expect(load.values)
            .toEqual({ version: "1.0.0", overwriteExisting: false });

        await receive({ type: "submit", values: load.values });

        expect(recorded.calls.at(-1)).toEqual({
            name: "generateDeploymentScript",
            args: [{ projectPath: PROJECT, version: "1.0.0",
                overwriteExisting: false }],
        });
        expect(shownDocuments.map((document) => {
            return document.uri.fsPath;
        })).toEqual(
            [`${PROJECT}/releases/deployment/sakila_deployment_1.0.0.sql`]);
        const { row } = lastAction(recorded);
        expect(row.message)
            .toBe("Generated the deployment script for sakila 1.0.0");
        expect(row.statement).toContain(
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
            // A session of its own, not the tree's, closed once done.
            expect(recorded.sessions).toEqual([
                expect.stringMatching(/ MSM Deploy \d+$/u) as unknown as string,
            ]);
            expect(recorded.disconnected).toEqual(recorded.sessions);
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
        // Closed however the deploy went.
        expect(recorded.disconnected).toEqual(recorded.sessions);
        expect(recorded.shownActions).toEqual([SERVER]);
        // Read again all the same: a script that failed partway may have
        // made the schema already.
        expect(recorded.refreshed).toEqual([SERVER]);
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


describe("the MSM Projects list", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("names a new project with a file dialog, then opens New MSM Project "
        + "on it", async () => {
        const recorded = setUp();
        fileDialogs.saveAnswer = Uri.file("/work/shop.msm.project");
        await run(MSM_LIST_COMMANDS.newProject,
            { kind: "folder", path: "/Shop" });
        const load = await loaded();

        expect(load.kind).toBe("create");
        expect(load.values).toMatchObject({
            schemaName: "shop", targetPath: "/work", folder: "/Shop",
            mcpAccess: false,
        });
        expect(load.folders).toEqual(["/Shop"]);

        await receive({ type: "submit", values: {
            ...(load.values as IMsmCreateValues), copyrightHolder: "Ada",
            caption: "Shop", mcpAccess: true,
        } });

        // Filed and captioned as it is made, in the one call.
        expect(recorded.calls.map((call) => { return call.name; }))
            .toEqual(["createProject", "projectInformation"]);
        expect(recorded.calls[0].args[0]).toMatchObject({
            mcpAccess: true, folder: "/Shop", caption: "Shop",
        });
        expect(recorded.calls[0].args[0]).not.toHaveProperty("color");
        // One step in the Actions tab: no filing after it.
        const [created] = [...actions(recorded).values()]
            .filter((put) => { return put.row.role === "run"; });
        expect(created.row.children?.map((child) => { return child.message; }))
            .toEqual(["Created the project folder"]);
        expect(recorded.projectsChanged).toBe(1);
        // In the view only, where it was asked for.
        expect(recorded.revealedProjects).toEqual([PROJECT]);
        expect(recorded.revealed).toEqual([]);
    });

    it("takes a name with or without the suffix, and stops on Cancel",
        async () => {
            setUp();
            fileDialogs.saveAnswer = undefined;
            await run(MSM_LIST_COMMANDS.newProject);
            expect(webviewPanels).toHaveLength(0);

            fileDialogs.saveAnswer = Uri.file("/work/notes");
            await run(MSM_LIST_COMMANDS.newProject);
            expect((await loaded()).values).toMatchObject({
                schemaName: "notes", folder: "/",
            });
        });

    it("opens an existing project, by its folder or its settings file",
        async () => {
            const recorded = setUp();
            fileDialogs.openAnswer = [Uri.file(`${PROJECT}/msm.project.json`)];
            await run(MSM_LIST_COMMANDS.openProject,
                { kind: "folder", path: "/Shop" });
            fileDialogs.openAnswer = [Uri.file(PROJECT)];
            await run(MSM_LIST_COMMANDS.openProject);

            expect(recorded.calls).toEqual([
                { name: "addProject", args: [PROJECT, { folder: "/Shop" }] },
                { name: "addProject", args: [PROJECT, { folder: "/" }] },
            ]);
            expect(fileDialogs.openCalls[0]).toMatchObject({
                canSelectFolders: true,
                canSelectFiles: process.platform === "darwin",
            });
            expect(recorded.projectsChanged).toBe(2);
            expect(recorded.rows.some(({ row }) => {
                return /^Added MSM project sakila\.msm\.project/u
                    .test(row.message);
            })).toBe(true);
        });

    it("picks a folder only where no dialog picks files and folders",
        async () => {
            const platform = Object.getOwnPropertyDescriptor(process,
                "platform")!;
            try {
                for (const name of ["linux", "win32"]) {
                    Object.defineProperty(process, "platform", { value: name });
                    const recorded = setUp();
                    fileDialogs.openAnswer = [Uri.file(PROJECT)];
                    await run(MSM_LIST_COMMANDS.openProject);

                    expect(fileDialogs.openCalls.at(-1), name).toMatchObject({
                        canSelectFiles: false, canSelectFolders: true,
                    });
                    expect(recorded.calls, name).toEqual([
                        { name: "addProject", args: [PROJECT, { folder: "/" }] },
                    ]);
                }
            } finally {
                Object.defineProperty(process, "platform", platform);
            }
        });

    it("adds a project from the Explorer, where it is", async () => {
        const recorded = setUp();
        await run(MSM_LIST_COMMANDS.addToProjects, folder(PROJECT));

        expect(recorded.calls).toEqual([
            { name: "addProject", args: [PROJECT, {}] },
        ]);
        expect(recorded.revealedProjects).toEqual([PROJECT]);
    });

    it("says why a project cannot be added, in the Actions tab too",
        async () => {
            const recorded = setUp({ fail: ["addProject",
                "The path /work/x does not contain a MSM project folder."] });
            await run(MSM_LIST_COMMANDS.addToProjects, folder("/work/x"));

            expect(errorMessages.join("\n")).toMatch(/does not contain/u);
            expect(recorded.shownActions).toEqual([GENERAL_ACTIONS]);
            expect(recorded.projectsChanged).toBe(0);
        });

    it("removes a project from the list, from its row", async () => {
        const recorded = setUp();
        await run(MSM_LIST_COMMANDS.removeFromProjects,
            { kind: "project", project: LISTED });

        expect(recorded.calls).toEqual([
            { name: "removeProject", args: [PROJECT] },
        ]);
        expect(recorded.projectsChanged).toBe(1);
        expect(recorded.removedProjects).toEqual([PROJECT]);
    });

    it("keeps a project's diagram views where msm does not remove it",
        async () => {
            const recorded = setUp({ fail: ["removeProject", "locked"] });
            await run(MSM_LIST_COMMANDS.removeFromProjects,
                { kind: "project", project: LISTED });

            expect(recorded.removedProjects).toEqual([]);
            expect(recorded.projectsChanged).toBe(1);
        });

    it("edits the development version and the list's settings, sending "
        + "only what changed", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
        const load = await loaded();

        // The row says how the list has it: not listed again.
        expect(recorded.calls.map((call) => { return call.name; }))
            .not.toContain("listProjects");
        expect(load.kind).toBe("edit");
        expect(load.title).toBe("Edit MSM Project - sakila");
        expect(load.values).toEqual({
            developmentVersion: "1.0.1", folder: "/Shop", caption: "",
            color: "green", mcpAccess: false, onlineAlter: textsOf({}),
            license: "MIT", customLicense: CUSTOM_LICENSE_START,
            copyrights: [{ holder: "Ada", yearOfCreation: "2024",
                yearOfLastUpdate: "", tracksUpdates: true }],
        });

        recorded.calls.length = 0;
        await receive({ type: "submit", values: {
            ...(load.values as IMsmEditValues), developmentVersion: "1.1.0",
            mcpAccess: true, color: "",
        } });

        expect(recorded.calls).toEqual([
            { name: "setDevelopmentVersion", args: [PROJECT, "1.1.0"] },
            { name: "updateProject", args: [PROJECT,
                { color: "", mcpAccess: true }] },
        ]);
        expect(panel().disposed).toBe(true);
        expect(recorded.projectsChanged).toBe(1);
    });

    it("sets the project's online schema change defaults, keeping its "
        + "tables' as they are when it does", async () => {
        const tables: Record<string, unknown> = { orders: { enabled: false } };
        const recorded = setUp({ online: { enabled: true, lockWait: 10,
            tables } });
        await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
        const load = await loaded();

        expect(recorded.calls).toContainEqual(
            { name: "getOnlineAlterSettings", args: [PROJECT] });
        expect(load.onlineAlter).toEqual({ defaults: ONLINE_ALTER_DEFAULTS,
            setting: { enabled: true, lockWait: 10 }, tables: ["orders"] });
        const values = load.values as IMsmEditValues;
        expect(values.onlineAlter.lockWait).toBe("10");

        // A table's entry set in the table editor while the dialog is open.
        tables.items = { lockWait: 1 };
        recorded.calls.length = 0;
        await receive({ type: "submit", values: { ...values, onlineAlter: {
            ...values.onlineAlter, lockWait: "", maxRebuildBytes: "2 GiB",
        } } });

        // The whole setting, read again: msm takes it only so.
        expect(recorded.calls).toEqual([
            { name: "getOnlineAlterSettings", args: [PROJECT] },
            { name: "setProjectSettings", args: [PROJECT, { onlineAlter: {
                enabled: true, maxRebuildBytes: 2 * 1024 ** 3,
                tables: { orders: { enabled: false },
                    items: { lockWait: 1 } } } }] },
        ]);
        expect(JSON.stringify([...actions(recorded).values()]))
            .toContain("msm.set_project_settings(");
    });

    it("switches between a custom license and a template in one call",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
            const load = await loaded();
            expect(load.licenses).toEqual(["None", "BSD", "GPL-2.0", "MIT"]);
            const values = load.values as IMsmEditValues;
            const text = "/*\n${copyright_notices}\n * Ours.\n */";
            recorded.calls.length = 0;

            await receive({ type: "submit", values: { ...values,
                license: "CUSTOM", customLicense: text } });

            expect(recorded.calls).toEqual([{ name: "setProjectSettings",
                args: [PROJECT, { license: "CUSTOM", customLicense: text }] }]);
        });

    it("drops a custom license's text for a template", async () => {
        const recorded = setUp({ info: { license: "custom",
            customLicense: "/* ours */" } });
        await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
        const values = (await loaded()).values as IMsmEditValues;
        expect(values.license).toBe("CUSTOM");
        expect(values.customLicense).toBe("/* ours */");
        recorded.calls.length = 0;

        await receive({ type: "submit", values: { ...values,
            license: "MIT" } });

        expect(recorded.calls).toEqual([{ name: "setProjectSettings",
            args: [PROJECT, { license: "MIT", customLicense: null }] }]);
    });

    it("drops the online setting, cleared, back to msm's defaults",
        async () => {
            const recorded = setUp({ online: { lockWait: 10 } });
            await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
            const values = (await loaded()).values as IMsmEditValues;
            recorded.calls.length = 0;

            await receive({ type: "submit", values: { ...values,
                onlineAlter: { ...values.onlineAlter, lockWait: "" } } });

            expect(recorded.calls.at(-1)).toEqual({ name: "setProjectSettings",
                args: [PROJECT, { onlineAlter: null }] });
            expect(JSON.stringify([...actions(recorded).values()]))
                .toContain("msm.get_online_alter_settings(");
        });

    it("writes changed copyrights and online defaults in one call",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
            const values = (await loaded()).values as IMsmEditValues;
            recorded.calls.length = 0;

            await receive({ type: "submit", values: { ...values,
                copyrights: [
                    { ...values.copyrights[0], yearOfCreation: "2023",
                        yearOfLastUpdate: " 2025 " },
                    { holder: " Bob ", yearOfCreation: "2025",
                        yearOfLastUpdate: "", tracksUpdates: false },
                ],
                onlineAlter: { ...values.onlineAlter, enabled: "off" },
            } });

            expect(recorded.calls).toEqual([
                { name: "getOnlineAlterSettings", args: [PROJECT] },
                { name: "setProjectSettings", args: [PROJECT, {
                    onlineAlter: { enabled: false },
                    copyrights: [
                        { holder: "Ada", yearOfCreation: "2023",
                            yearOfLastUpdate: "2025", tracksUpdates: true },
                        { holder: "Bob", yearOfCreation: "2025",
                            tracksUpdates: false },
                    ],
                }] },
            ]);
        });

    it("refuses a last copyright year before the first", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
        const values = (await loaded()).values as IMsmEditValues;
        recorded.calls.length = 0;

        await receive({ type: "submit", values: { ...values, copyrights: [
            { ...values.copyrights[0], yearOfLastUpdate: "2020" }] } });

        expect(recorded.calls).toEqual([]);
        expect(errorsPosted().join("\n"))
            .toMatch(/cannot be before the first, 2024/u);
    });

    it("leaves the online schema change defaults alone where msm gives none",
        async () => {
            const recorded = setUp({ fail: ["getOnlineAlterSettings",
                "Unknown tool"] });
            await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
            const load = await loaded();

            expect(load.onlineAlter).toBeUndefined();
            expect(load.onlineAlterProblem).toMatch(/Unknown tool/u);
            recorded.calls.length = 0;
            await receive({ type: "submit", values: load.values });

            expect(recorded.calls).toEqual([]);
        });

    it("refuses a development version below the last release", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.edit, { kind: "project", project: LISTED });
        const load = await loaded();
        recorded.calls.length = 0;

        await receive({ type: "submit", values: {
            ...(load.values as IMsmEditValues), developmentVersion: "0.9.0",
        } });

        expect(recorded.calls).toEqual([]);
        expect(errorsPosted().join("\n"))
            .toMatch(/cannot be lower than the last released one, 1\.0\.0/u);
    });

    it("edits a project from the Explorer as the view listed it",
        async () => {
            const recorded = setUp();
            await run(MSM_COMMANDS.edit, folder(PROJECT));

            expect(recorded.calls.map((call) => { return call.name; }))
                .not.toContain("listProjects");
            expect((await loaded()).values).toMatchObject({
                folder: "/Shop", color: "green",
            });
        });

    it("refuses to edit a project the list does not have", async () => {
        setUp({ listed: [] });
        await run(MSM_COMMANDS.edit, folder(PROJECT));

        expect(errorMessages.join("\n")).toMatch(/not in the MSM Projects/u);
        expect(webviewPanels).toHaveLength(0);
    });

    it("runs the Explorer's dialogs on a row of the view", async () => {
        const recorded = setUp();
        await run(MSM_COMMANDS.info, { kind: "project", project: LISTED });

        expect(recorded.calls[0]).toEqual({
            name: "projectInformation", args: [PROJECT],
        });
        expect((await loaded()).kind).toBe("info");
    });

    it("sends what changed, all of it for a project not yet listed", () => {
        const values = {
            folder: " /Shop ", caption: " Prod ", color: "red" as const,
            mcpAccess: true,
        };
        expect(changedDetails(values)).toEqual({
            folder: "/Shop", caption: "Prod", color: "red", mcpAccess: true,
        });
        expect(changedDetails(values, {
            folder: "/Shop", caption: "Prod", color: "", mcpAccess: true,
        })).toEqual({ color: "red" });
        expect(changedDetails({ ...values, folder: "" }, {
            folder: "/", caption: "Prod", color: "red", mcpAccess: true,
        })).toEqual({});
        // A folder in another spelling is the same folder.
        for (const folder of ["Shop/", "/Shop", "Shop", "//Shop//"]) {
            expect(changedDetails({ ...values, folder }, {
                folder: "/Shop", caption: "Prod", color: "red",
                mcpAccess: true,
            }), folder).toEqual({});
        }
        expect(changedDetails({ ...values, folder: "Shop/Prod/" }))
            .toMatchObject({ folder: "/Shop/Prod" });
    });
});

describe("New MSM Project from Schema", () => {
    beforeEach(() => { resetVscodeMock(); });

    const row = { kind: "schema", uri: SERVER, schema: "sakila" };

    it("lists the schema's objects on a session of its own, then opens the "
        + "wizard on them", async () => {
        const recorded = setUp();
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();

        expect(recorded.calls[0]).toEqual({ name: "listLiveSchemaObjects",
            args: [`id-of-${SERVER}`, "sakila"] });
        expect(recorded.sessions).toEqual([
            expect.stringMatching(/ MSM Import \d+$/u)]);
        // Closed once listed: the dialog may stay open a long while.
        expect(recorded.disconnected).toEqual(recorded.sessions);
        const action = lastAction(recorded);
        expect(action.connection).toBe(SERVER);
        expect(action.row.message).toBe("Read schema sakila for an MSM "
            + "project");
        expect(load.kind).toBe("import");
        expect(load.liveSchema).toEqual(LIVE);
        expect(load.source).toBe("root@127.0.0.1:3310");
        expect(load.values).toMatchObject({
            schemaName: "sakila", targetPath: "/home/me", connection: SERVER,
            allowSpecialChars: true,
            objects: { tables: ["actor", "film"], views: ["actor_info"],
                procedures: ["rewards"], functions: [], events: [],
                sequences: [] },
        });
    });

    it("does nothing without a schema row", async () => {
        const recorded = setUp();
        await run(MSM_IMPORT_COMMAND);

        expect(recorded.calls).toEqual([]);
        expect(webviewPanels).toEqual([]);
    });

    it("says why the schema cannot be listed, and opens no wizard",
        async () => {
            const recorded = setUp({ fail: ["listLiveSchemaObjects",
                "The server has no schema `sakila`."] });
            await run(MSM_IMPORT_COMMAND, row);

            expect(webviewPanels).toEqual([]);
            expect(errorMessages.join()).toMatch(/no schema `sakila`/u);
            expect(recorded.shownActions).toEqual([SERVER]);
            expect(recorded.disconnected).toEqual(recorded.sessions);
        });

    it("imports everything with no selection sent, follows the task, then "
        + "opens the project", async () => {
        const recorded = setUp();
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmImportValues), targetPath: "/work",
            copyrightHolder: " Ada ", license: "MIT", folder: "/Shop",
        } });

        expect(recorded.calls.map((call) => { return call.name; }))
            .toEqual(["listLiveSchemaObjects", "importLiveSchema",
                "projectInformation"]);
        expect(recorded.calls[1].args).toEqual([{
            connectionId: `id-of-${SERVER}`, schema: "sakila",
            targetPath: "/work", copyrightHolder: "Ada", license: "MIT",
            overwriteExisting: false, enforceTargetPath: false,
            yearOfCreation: (load.values as IMsmImportValues).yearOfCreation,
            mcpAccess: false,
            folder: "/Shop",
        }]);
        expect(panel().disposed).toBe(true);
        expect(recorded.followed).toEqual(
            ["Import schema sakila into an MSM project"]);
        // The task's own session, closed once it ended.
        expect(recorded.sessions).toHaveLength(2);
        expect(recorded.sessions[1]).not.toBe(recorded.sessions[0]);
        expect(recorded.disconnected).toEqual(recorded.sessions);
        expect(recorded.projectsChanged).toBe(1);
        expect(shownDocuments.map((document) => {
            return document.uri.fsPath;
        })).toEqual([`${PROJECT}/development/sakila_next.sql`]);
        expect(recorded.revealedProjects).toEqual([PROJECT]);
        expect(warningMessages).toEqual([]);
    });

    it("sends the objects ticked, every kind, never triggers", async () => {
        const recorded = setUp();
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();
        const values = load.values as IMsmImportValues;

        await receive({ type: "submit", values: {
            ...values, targetPath: "/work", copyrightHolder: "Ada",
            objects: { ...values.objects, tables: ["film"] },
        } });

        expect(recorded.calls[1].args[0]).toMatchObject({ objects: {
            tables: ["film"], views: ["actor_info"], procedures: ["rewards"],
            functions: [], events: [], sequences: [],
        } });
        expect(Object.keys((recorded.calls[1].args[0] as {
            objects: object; }).objects)).not.toContain("triggers");
    });

    it("keeps the wizard open on msm's refusal, the task not started",
        async () => {
            const recorded = setUp({ fail: ["importLiveSchema",
                "A trigger needs its table."] });
            await run(MSM_IMPORT_COMMAND, row);
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmImportValues), targetPath: "/work",
                copyrightHolder: "Ada",
            } });

            expect(panel().disposed).toBe(false);
            expect(errorsPosted().join()).toMatch(/needs its table/u);
            expect(recorded.followed).toEqual([]);
            expect(recorded.startFailed).toEqual([`${SERVER} Import schema `
                + "sakila into an MSM project: A trigger needs its table."]);
            expect(recorded.disconnected).toEqual(recorded.sessions);
        });

    it("refuses an existing project folder before calling msm", async () => {
        const recorded = setUp({ existing: ["/work", PROJECT] });
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmImportValues), targetPath: "/work",
            copyrightHolder: "Ada",
        } });

        expect(recorded.calls.map((call) => { return call.name; }))
            .toEqual(["listLiveSchemaObjects"]);
        expect(posted()).toContainEqual(expect.objectContaining({
            type: "error", field: "schemaName" }));
    });

    it("tells what was left out once imported", async () => {
        setUp({ imported: { result: { ...IMPORTED, warnings: [
            "The foreign key `fk` of `film` refers to `actor`, which is not "
                + "imported; it was left out.", "Another."] } } });
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmImportValues), targetPath: "/work",
            copyrightHolder: "Ada",
        } });

        expect(warningMessages).toEqual(["Import schema sakila into an MSM "
            + "project: The foreign key `fk` of `film` refers to `actor`, "
            + "which is not imported; it was left out. (and 1 more warning, "
            + "in the task's log)"]);
    });

    it("opens nothing where the task failed or was cancelled", async () => {
        const recorded = setUp({ imported: { status: "cancelled",
            result: null } });
        await run(MSM_IMPORT_COMMAND, row);
        const load = await loaded();

        await receive({ type: "submit", values: {
            ...(load.values as IMsmImportValues), targetPath: "/work",
            copyrightHolder: "Ada",
        } });

        expect(recorded.followed).toHaveLength(1);
        expect(recorded.projectsChanged).toBe(0);
        expect(shownDocuments).toEqual([]);
    });

    it("gives a custom license after the import, msm taking none",
        async () => {
            const recorded = setUp();
            await run(MSM_IMPORT_COMMAND, row);
            const load = await loaded();

            await receive({ type: "submit", values: {
                ...(load.values as IMsmImportValues), targetPath: "/work",
                copyrightHolder: "Ada", license: "CUSTOM",
                customLicense: "-- Ours.",
            } });

            expect(recorded.calls[1].args[0]).toMatchObject(
                { license: "None" });
            expect(recorded.calls.map((call) => { return call.name; }))
                .toEqual(["listLiveSchemaObjects", "importLiveSchema",
                    "setProjectSettings", "projectInformation"]);
        });
});
