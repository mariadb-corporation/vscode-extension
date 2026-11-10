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

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import * as vscode from "vscode";

import {
    callArguments,
    GENERAL_ACTIONS,
} from "../connections/connectionActivity.js";
import { normalizeCaption } from "../connections/connectionDetails.js";
import { connectionLabel } from "../connections/connectionUri.js";
import {
    normalizeFolder,
    ROOT_FOLDER,
} from "../connections/connectionFolders.js";
import { reportError } from "../errorMessages.js";
import { pathExists } from "../shell/nodeRuntime.js";
import {
    MSM_LICENSES,
    changedOnlineAlter,
    msmToolArgs,
    type IMsmApi,
    type IMsmCreateOptions,
    type IMsmDeployOptions,
    type IMsmDeploymentScriptOptions,
    type IMsmListedProject,
    type IMsmProjectDetails,
    type IMsmProjectInfo,
    type IMsmProjectSettings,
    type IMsmReleaseOptions,
} from "../mcp/msmApi.js";
import { ActionGroup, type ActionPutter } from "../restd/actionGroup.js";
import { counted, errorText } from "../text.js";
import {
    createDefaults,
    currentYear,
    deployDefaults,
    deploymentScriptDefaults,
    editDefaults,
    isProjectFolder,
    MSM_TITLES,
    projectFolderName,
    releaseDefaults,
    schemaNameOfFolder,
    storedCopyrights,
    type IMsmCreateValues,
    type IMsmEditValues,
    type IMsmListValues,
    type IMsmDeploymentScriptValues,
    type IMsmDeployValues,
    type IMsmOnlineAlterContext,
    type IMsmProblem,
    type IMsmProjectContext,
    type IMsmReleaseValues,
    type MsmDialogKind,
} from "./msmFields.js";
import {
    entryKey,
    generalOf,
    type IOnlineAlterEntry,
    readTexts,
    withGeneral,
} from "../tableEditor/onlineAlter.js";
import { pickFolder } from "../webview/dialogPanel.js";
import {
    msmFolderOf,
    type MsmProjectsNode,
} from "../tree/msmProjectsTreeProvider.js";
import {
    MsmDialogPanel,
    type IMsmDialogHost,
    type IMsmDialogSpec,
} from "./msmDialogPanel.js";

/** What the MariaDB Schema Management commands need from the extension. */
export interface IMsmCommandsHost {
    extensionUri: vscode.Uri;
    msmApi(): Promise<IMsmApi>;
    /**
     * Opens a session of the extension's on a URI, by its name; its
     * connection id.
     */
    connect(uri: string, session: string): Promise<string>;
    /** Closes a session `connect` opened. */
    disconnect(uri: string, session: string): Promise<void>;
    /** The configured connections, which a schema can be deployed onto. */
    connectionUris(): Promise<string[]>;
    /** The default connection, which Deploy Schema starts on. */
    defaultConnection(): string | undefined;
    /** Where a folder is created from the palette: the workspace's. */
    defaultFolder(): string;
    put: ActionPutter;
    /** Brings up the panel on a connection's actions. */
    showActions(connection: string): void;
    /** A deploy changed a server: the tree and completion read it again. */
    refresh(uri: string): void;
    /** Whether a path exists; the disk's, unless a test says otherwise. */
    exists?(path: string): Promise<boolean>;
    /** The MSM Projects list changed: the view reads it again. */
    projectsChanged?(): void;
    /** A project was taken off the MSM Projects list. */
    projectRemoved?(projectPath: string): void;
    /** The folders of the MSM Projects view, which the dialogs offer. */
    projectFolders?(): Promise<string[]>;
    /** A project as the MSM Projects view last listed it, if it does. */
    listedProject?(projectPath: string): Promise<IMsmListedProject | undefined>;
    /** Shows a project in the MSM Projects view. */
    revealProject?(projectPath: string): Promise<void>;
    log(message: string): void;
}

/**
 * What a deploy's own session is called, numbered per deploy. Not the
 * tree's: a deployment script can run for half an hour, a backup dump
 * first, and changes the session's schema, which the Connections view and
 * completion would otherwise wait behind and see.
 */
export const MSM_DEPLOY_SESSION = "MSM Deploy";

/** Makes the deploys' sessions' names unique, as deploys may overlap. */
let deploys = 0;

/** The dialogs on a project: all but New MSM Project. */
type ProjectDialogKind = Exclude<MsmDialogKind, "create" | "edit">;

/** The MSM Projects list's commands, beside the dialogs'. */
export const MSM_LIST_COMMANDS = {
    newProject: "mariadb.msm.newProjectInView",
    openProject: "mariadb.msm.openProjectInView",
    addToProjects: "mariadb.msm.addToProjects",
    removeFromProjects: "mariadb.msm.removeFromProjects",
} as const;

/**
 * @param listed A project as the list has it.
 *
 * @returns How the dialogs show its filing.
 */
const listValuesOf = (listed: IMsmListedProject): IMsmListValues => {
    return {
        folder: listed.folder,
        caption: listed.caption,
        color: listed.color ?? "",
        mcpAccess: listed.mcpAccess,
    };
};

/**
 * @param values How a project is to be filed and shown.
 * @param before How it is, where it is listed.
 *
 * @returns What has to be sent: what differs, all of it for a new one.
 */
export const changedDetails = (
    values: IMsmListValues,
    before?: IMsmListValues,
): IMsmProjectDetails => {
    // Each in its one spelling, so `Shop/` against `/Shop` is no change.
    const normalized = (list: IMsmListValues): IMsmListValues => {
        return {
            folder: normalizeFolder(list.folder),
            caption: normalizeCaption(list.caption),
            color: list.color,
            mcpAccess: list.mcpAccess,
        };
    };
    const now = normalized(values);
    const was = before === undefined ? undefined : normalized(before);

    return Object.fromEntries(Object.entries(now).filter(([key, value]) => {
        return was?.[key as keyof IMsmListValues] !== value;
    })) as IMsmProjectDetails;
};

/**
 * @param arg What a command was handed: the Explorer's folder, a row of
 *            the MSM Projects view, or nothing from the palette.
 *
 * @returns The project folder it names, if it names one.
 */
export const projectPathOf = (arg: unknown): string | undefined => {
    if (arg instanceof vscode.Uri) {
        return arg.fsPath;
    }
    const row = arg as MsmProjectsNode | undefined;

    if (row?.kind === "project") {
        return row.project.projectPath;
    }

    // The rows of a project's schema carry their project.
    return row !== undefined && row.kind !== "folder" && row.kind !== "file"
        ? row.projectPath : undefined;
};

/**
 * @param taken The names of the project's diagrams.
 *
 * @returns The name a new diagram is offered: "Diagram 1", numbered past
 *          the ones in use, in any case.
 */
export const newDiagramName = (taken: readonly string[]): string => {
    const used = new Set(taken.map((name) => { return name.toLowerCase(); }));
    let number = 1;
    while (used.has(`diagram ${number}`)) {
        number += 1;
    }

    return `Diagram ${number}`;
};

/**
 * @param taken The names of the project's diagrams.
 * @param name A name for a new one.
 *
 * @returns Whether a diagram has that name already, in any case: their
 *          files would collide where the file system ignores case.
 */
const diagramNameTaken = (
    taken: readonly string[],
    name: string,
): boolean => {
    const wanted = name.toLowerCase();

    return taken.some((other) => { return other.toLowerCase() === wanted; });
};

/** The name msm keeps for a project's schema snapshot row. */
const SNAPSHOT_ROW_NAME = "schema_definition";

/**
 * @param taken The names of the project's other diagrams.
 * @param value A name entered for a new or a renamed one.
 *
 * @returns Why msm would refuse it, else nothing.
 */
export const diagramNameProblem = (
    taken: readonly string[],
    value: string,
): string | undefined => {
    const name = value.trim();
    if (name === "") {
        return "Enter a name.";
    }
    // In any case: its file would collide where the file system ignores it.
    if (name.toLowerCase() === SNAPSHOT_ROW_NAME) {
        return `${SNAPSHOT_ROW_NAME} is the name of the schema snapshot.`;
    }

    return diagramNameTaken(taken, name)
        ? `The project has a diagram ${name} already.` : undefined;
};

/** The commands, by the dialog each opens. */
export const MSM_COMMANDS: Record<MsmDialogKind, string> = {
    create: "mariadb.msm.createProject",
    edit: "mariadb.msm.editProject",
    info: "mariadb.msm.showProjectInformation",
    release: "mariadb.msm.prepareRelease",
    deploymentScript: "mariadb.msm.generateDeploymentScript",
    deploy: "mariadb.msm.deploySchema",
};

/**
 * @param name The tool.
 * @param args Its arguments, as `msmToolArgs` builds them.
 *
 * @returns The call as its row shows it, as every other call's is:
 *          `msm.prepare_release(version=1.0.0, next_version=1.0.1)`. The
 *          connection's id is left out: a UUID says nothing to a reader,
 *          and the action names the connection.
 */
export const msmCall = (
    name: string,
    args: Record<string, unknown>,
): string => {
    return `${name}(${callArguments({ ...args, connection_id: undefined })})`;
};

/**
 * @param info What the server read of the project.
 * @param projectPath Its folder.
 * @param released The versions released.
 * @param scripts The versions with a deployment script.
 *
 * @returns What the dialogs show of it.
 */
export const projectContext = (
    info: IMsmProjectInfo,
    projectPath: string,
    released: string[],
    scripts: string[],
): IMsmProjectContext => {
    const year = info.yearOfCreation ?? currentYear();
    const listed = (info.copyrights ?? []).filter((copyright) => {
        return copyright.holder !== "";
    });
    // An older msm, or project, has the one holder alone.
    const stored = listed.length > 0 || info.copyrightHolder === undefined
        || info.copyrightHolder === "" ? listed
        : [{ holder: info.copyrightHolder, yearOfCreation: year }];
    const copyrights = stored.map((copyright) => {
        return {
            holder: copyright.holder,
            yearOfCreation: String(copyright.yearOfCreation ?? year),
            yearOfLastUpdate: copyright.yearOfLastUpdate === undefined
                ? "" : String(copyright.yearOfLastUpdate),
            tracksUpdates: copyright.tracksUpdates ?? false,
        };
    });

    return {
        projectPath,
        schemaName: info.schemaName,
        license: info.license ?? "None",
        copyrights,
        currentDevelopmentVersion: info.currentDevelopmentVersion,
        ...(info.lastReleasedVersion === null
            ? {} : { lastReleasedVersion: info.lastReleasedVersion }),
        releasedVersions: released,
        deploymentScriptVersions: scripts,
        schemaDevelopmentFilePath: info.schemaDevelopmentFilePath,
    };
};

/**
 * The Explorer's MariaDB Schema Management submenu: creating a schema
 * project in a folder, and on a `*.msm.project` folder its information,
 * preparing a release, generating a deployment script and deploying the
 * schema. Each opens a dialog, and each thing done - the project read
 * included - is one action of the Actions tab, with a row per `msm.*`
 * call under it.
 */
export class MsmCommands {
    public constructor(private readonly host: IMsmCommandsHost) { }

    /**
     * @returns The registrations, for the extension to dispose.
     */
    public register(): vscode.Disposable[] {
        const command = (
            id: string,
            handler: (folder: string, arg: unknown) => Promise<void>,
            pick?: () => Promise<string | undefined>,
        ): vscode.Disposable => {
            return vscode.commands.registerCommand(id,
                async (folder?: unknown) => {
                    try {
                        const path = projectPathOf(folder) ?? await pick?.();
                        if (path !== undefined) {
                            await handler(path, folder);
                        }
                    } catch (error) {
                        reportError(this.host.log, error);
                    }
                });
        };
        const kinds: ProjectDialogKind[] = [
            "info", "release", "deploymentScript", "deploy",
        ];

        return [
            command(MSM_COMMANDS.create, (folder) => {
                return this.createProject(folder);
            }, () => { return Promise.resolve(this.host.defaultFolder()); }),
            ...kinds.map((kind) => {
                return command(MSM_COMMANDS[kind], (folder) => {
                    return this.open(kind, folder);
                }, () => {
                    return pickFolder("Choose a Schema Project Folder");
                });
            }),
            command(MSM_COMMANDS.edit, (folder, arg) => {
                const row = arg as MsmProjectsNode | undefined;

                return this.edit(folder,
                    row?.kind === "project" ? row.project : undefined);
            }, () => {
                return pickFolder("Choose a Schema Project Folder");
            }),
            command(MSM_LIST_COMMANDS.addToProjects, (folder) => {
                return this.addToProjects(folder);
            }, () => {
                return pickFolder("Choose a Schema Project Folder");
            }),
            // Only on a listed project's row: nothing to pick it from.
            command(MSM_LIST_COMMANDS.removeFromProjects, (folder) => {
                return this.removeFromProjects(folder);
            }),
            this.#viewCommand(MSM_LIST_COMMANDS.newProject, (folder) => {
                return this.newProjectInView(folder);
            }),
            this.#viewCommand(MSM_LIST_COMMANDS.openProject, (folder) => {
                return this.openProjectInView(folder);
            }),
        ];
    }

    /**
     * @param id A command of the MSM Projects view's toolbar or folders.
     * @param handler What it does, in the folder of the list it was used on.
     *
     * @returns Its registration.
     */
    #viewCommand(
        id: string,
        handler: (folder: string) => Promise<void>,
    ): vscode.Disposable {
        return vscode.commands.registerCommand(id, async (row?: unknown) => {
            try {
                await handler(msmFolderOf(row as MsmProjectsNode | undefined)
                    ?? ROOT_FOLDER);
            } catch (error) {
                reportError(this.host.log, error);
            }
        });
    }

    /**
     * New MSM Project from the MSM Projects view: a file dialog names the
     * project folder - where it goes and the schema it is for - and New
     * MSM Project opens on that, for the rest.
     *
     * @param listFolder The folder of the view it is filed in.
     */
    public async newProjectInView(listFolder: string): Promise<void> {
        const chosen = await vscode.window.showSaveDialog({
            title: "New MSM Project: Name the Project Folder",
            saveLabel: "Continue",
            defaultUri: vscode.Uri.file(join(this.host.defaultFolder(),
                "schema.msm.project")),
        });
        if (chosen === undefined) {
            return;
        }

        await this.createProject(dirname(chosen.fsPath),
            schemaNameOfFolder(basename(chosen.fsPath)), { folder: listFolder },
            "view");
    }

    /**
     * Open MSM Project from the MSM Projects view: a file dialog picks a
     * project folder, and it is added. On macOS it may pick the folder's
     * `msm.project.json` too; Windows and Linux have no dialog that picks
     * both, so there it picks the folder only.
     *
     * @param listFolder The folder of the view it is filed in.
     */
    public async openProjectInView(listFolder: string): Promise<void> {
        const chosen = await vscode.window.showOpenDialog({
            title: "Open MSM Project",
            openLabel: "Open MSM Project",
            canSelectFiles: process.platform === "darwin",
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(this.host.defaultFolder()),
        });
        const path = chosen?.[0]?.fsPath;
        if (path === undefined) {
            return;
        }

        await this.addToProjects(basename(path) === "msm.project.json"
            ? dirname(path) : path, listFolder);
    }

    /**
     * Adds a project to the MSM Projects list, as an action, and shows it
     * in the view.
     *
     * @param projectPath The project folder.
     * @param listFolder The folder of the view to file it in; left out, a
     *                   listed project stays where it is.
     */
    public async addToProjects(
        projectPath: string,
        listFolder?: string,
    ): Promise<void> {
        const name = basename(projectPath);
        const words = {
            doing: `Adding MSM project ${name} to the MSM Projects view`,
            done: `Added MSM project ${name} to the MSM Projects view`,
        };
        const details: IMsmProjectDetails = listFolder === undefined
            ? {} : { folder: listFolder };
        await this.#listAction(words, msmCall("msm.add_project",
            msmToolArgs.addProject(projectPath, details)), async (api) => {
            return (await api.addProject(projectPath, details)).projectPath;
        });
        this.host.projectsChanged?.();
        this.#afterwards(async () => {
            await this.host.revealProject?.(projectPath);
        });
    }

    /**
     * Takes a project off the MSM Projects list; its folder stays.
     *
     * @param projectPath The project folder, as listed.
     */
    public async removeFromProjects(projectPath: string): Promise<void> {
        const name = basename(projectPath);
        const words = {
            doing: `Removing MSM project ${name} from the MSM Projects view`,
            done: `Removed MSM project ${name} from the MSM Projects view`,
        };
        try {
            await this.#listAction(words, msmCall("msm.remove_project",
                msmToolArgs.removeProject(projectPath)), (api) => {
                return api.removeProject(projectPath);
            });
            this.host.projectRemoved?.(projectPath);
        } finally {
            this.host.projectsChanged?.();
        }
    }

    /**
     * Changes the MSM Projects list in one call, as an action of its own
     * with that call as its one step; a failure brings the Actions tab up
     * on it.
     *
     * @param words What the action and its step say.
     * @param call The call, as its row shows it.
     * @param run Makes it, answering with the project folder it was on.
     */
    async #listAction(
        words: { doing: string; done: string },
        call: string,
        run: (api: IMsmApi) => Promise<string>,
    ): Promise<void> {
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        const detail = (path: string): string => { return path; };
        try {
            await group.run(() => {
                return group.step(words, call, async () => {
                    return run(await this.host.msmApi());
                }, { detail });
            }, detail);
        } catch (error) {
            this.host.showActions(GENERAL_ACTIONS);
            throw error;
        }
    }

    /**
     * Opens Edit MSM Project: the project read, and how the list has it.
     *
     * @param projectPath The project folder.
     * @param row How the list has it, where the command came from its row;
     *            else as the MSM Projects view last listed it.
     */
    public async edit(
        projectPath: string,
        row?: IMsmListedProject,
    ): Promise<void> {
        const listed = row ?? await this.host.listedProject?.(projectPath);
        if (listed === undefined) {
            throw new Error(`${basename(projectPath)} is not in the MSM `
                + "Projects view. Add it there first.");
        }
        const [project, folders, online] = await Promise.all([
            this.#read(projectPath), this.#folders(),
            this.#onlineAlter(projectPath),
        ]);
        const before = listValuesOf(listed);
        const title = `${MSM_TITLES.edit} - ${project.schemaName}`;
        const general = "context" in online ? online.context.setting
            : undefined;
        MsmDialogPanel.show(this.host.extensionUri, {
            kind: "edit",
            title,
            project,
            values: editDefaults(project, before, general),
            folders,
            ...("context" in online ? { onlineAlter: online.context }
                : { onlineAlterProblem: online.problem }),
        }, {
            submit: (values) => {
                return this.#update(project, before, values, general);
            },
            onFailed: () => { this.host.showActions(GENERAL_ACTIONS); },
            log: this.host.log,
        });
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns Its online ALTER TABLE setting, for Edit MSM Project's
     *          Online Schema Change tab; or why msm gave none.
     */
    async #onlineAlter(projectPath: string): Promise<
        { context: IMsmOnlineAlterContext } | { problem: string }> {
        try {
            const read = await (await this.host.msmApi())
                .getOnlineAlterSettings(projectPath);

            return { context: {
                defaults: read.defaults,
                setting: generalOf(read.setting),
                tables: Object.keys(read.setting.tables ?? {}).sort(),
            } };
        } catch (error) {
            return { problem: "Online schema change settings need a "
                + `MariaDB Shell whose msm has them: ${errorText(error)}` };
        }
    }

    /**
     * @returns The folders the dialogs offer; none where they cannot be
     *          listed, which leaves the field to be typed into.
     */
    async #folders(): Promise<string[]> {
        try {
            return await this.host.projectFolders?.() ?? [];
        } catch {
            return [];
        }
    }

    /**
     * Applies Edit MSM Project: the development version, where it
     * changed, then how the list files and shows it.
     *
     * @param project The project, as read.
     * @param before How the list had it.
     * @param values What Edit MSM Project says.
     * @param onlineBefore The project's general online ALTER TABLE
     *                     values, as read; undefined where msm gave none,
     *                     which leaves them as they are.
     */
    async #update(
        project: IMsmProjectContext,
        before: IMsmListValues,
        values: IMsmEditValues,
        onlineBefore?: IOnlineAlterEntry,
    ): Promise<void> {
        const version = values.developmentVersion.trim();
        const details = changedDetails(values, before);
        const online = readTexts(values.onlineAlter).entry;
        const onlineChanged = onlineBefore !== undefined
            && entryKey(online) !== entryKey(onlineBefore);
        const copyrights = storedCopyrights(values.copyrights);
        const copyrightsChanged = JSON.stringify(copyrights)
            !== JSON.stringify(storedCopyrights(project.copyrights));
        const words = {
            doing: `Updating MSM project ${project.schemaName}`,
            done: `Updated MSM project ${project.schemaName}`,
        };
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        const { projectPath } = project;
        try {
            await group.run(async () => {
                if (version !== project.currentDevelopmentVersion) {
                    await group.step({
                        doing: `Setting the development version to ${version}`,
                        done: `Set the development version to ${version}`,
                    }, msmCall("msm.set_development_version",
                        msmToolArgs.setDevelopmentVersion(projectPath,
                            version)), async () => {
                        await (await this.host.msmApi())
                            .setDevelopmentVersion(projectPath, version);
                    });
                }
                if (Object.keys(details).length > 0) {
                    await group.step({
                        doing: "Updating the MSM Projects view's entry",
                        done: "Updated the MSM Projects view's entry",
                    }, msmCall("msm.update_project",
                        msmToolArgs.updateProject(projectPath, details)),
                    async () => {
                        return (await this.host.msmApi()).updateProject(
                            projectPath, details);
                    });
                }
                // One call for what msm.project.json holds, with what
                // changed; the online setting as a whole, read just now.
                if (onlineChanged || copyrightsChanged) {
                    const api = await this.host.msmApi();
                    const onlineAlter = onlineChanged ? await group.step({
                        doing: "Reading the online ALTER TABLE setting",
                        done: "Read the online ALTER TABLE setting",
                    }, msmCall("msm.get_online_alter_settings",
                        msmToolArgs.getOnlineAlterSettings(projectPath)),
                    () => {
                        return changedOnlineAlter(api, projectPath,
                            (setting) => {
                                return withGeneral(setting, online);
                            });
                    }) : undefined;
                    const settings: IMsmProjectSettings = {
                        ...(copyrightsChanged ? { copyrights } : {}),
                        ...(onlineAlter === undefined ? {} : { onlineAlter }),
                    };
                    await group.step({
                        doing: "Writing the project settings",
                        done: "Wrote the project settings",
                    }, msmCall("msm.set_project_settings",
                        msmToolArgs.setProjectSettings(projectPath,
                            settings)), () => {
                        return api.setProjectSettings(projectPath, settings);
                    });
                }
            }, () => { return projectPath; });
        } finally {
            this.host.projectsChanged?.();
        }
    }

    /**
     * Opens New MSM Project on a folder.
     *
     * @param folder The folder the project is to be made in.
     * @param schemaName The schema, where it was named already.
     * @param list How it is to be filed in the MSM Projects view.
     * @param from Where it was asked for: the new project is shown there,
     *             so the side bar stays as it is.
     */
    public async createProject(
        folder: string,
        schemaName = "",
        list: Partial<IMsmListValues> = {},
        from: "explorer" | "view" = "explorer",
    ): Promise<void> {
        MsmDialogPanel.show(this.host.extensionUri, {
            kind: "create",
            title: MSM_TITLES.create,
            values: createDefaults(folder, schemaName, list),
            licenses: MSM_LICENSES,
            folders: await this.#folders(),
        }, {
            check: (values) => { return this.#checkCreate(values); },
            submit: (values) => { return this.#create(values, from); },
            onFailed: () => { this.host.showActions(GENERAL_ACTIONS); },
            log: this.host.log,
        });
    }

    /**
     * Reads a project and opens a dialog on it.
     *
     * @param kind The dialog.
     * @param projectPath The `*.msm.project` folder.
     */
    public async open(
        kind: ProjectDialogKind,
        projectPath: string,
    ): Promise<void> {
        if (!isProjectFolder(projectPath)) {
            throw new Error(`${basename(projectPath)} is not a schema `
                + `project folder: its name has to end in .msm.project.`);
        }

        // Deploy Schema's connections are read side by side with it.
        const connections = kind === "deploy"
            ? this.host.connectionUris() : undefined;
        // Handled where it is awaited; not left unhandled should the
        // project's reading fail first.
        connections?.catch(() => { /* awaited in #show */ });
        await this.#show(kind, await this.#read(projectPath), connections);
    }

    /**
     * Opens a dialog on a project read already.
     *
     * @param kind The dialog.
     * @param project The project.
     * @param connectionUris The connections Deploy Schema offers, where
     *                       they are being read already.
     */
    async #show(
        kind: ProjectDialogKind,
        project: IMsmProjectContext,
        connectionUris?: Promise<string[]>,
    ): Promise<void> {
        const title = `${MSM_TITLES[kind]} - ${project.schemaName}`;
        const show = <K extends ProjectDialogKind>(
            spec: Omit<IMsmDialogSpec<K>, "title" | "project">,
            host: Omit<IMsmDialogHost<K>, "log">,
        ): void => {
            MsmDialogPanel.show(this.host.extensionUri, {
                ...spec, title, project,
            } as IMsmDialogSpec<K>, {
                onFailed: () => { this.host.showActions(GENERAL_ACTIONS); },
                ...host,
                log: this.host.log,
            });
        };

        switch (kind) {
            case "info": {
                show({ kind, values: {} }, {
                    open: async (what) => {
                        if (what === "developmentFile") {
                            await this.#showFile(
                                project.schemaDevelopmentFilePath);
                        } else {
                            // In its place, on the project as read.
                            await this.#show(what, project);
                        }
                    },
                });
                break;
            }

            case "release": {
                show({ kind, values: releaseDefaults(project) }, {
                    submit: (values) => {
                        return this.#release(project, values);
                    },
                });
                break;
            }

            case "deploymentScript": {
                show({ kind, values: deploymentScriptDefaults(project) }, {
                    submit: (values) => {
                        return this.#generate(project, values);
                    },
                });
                break;
            }

            default: {
                const uris = await (connectionUris
                    ?? this.host.connectionUris());
                const connections = uris.map((uri) => {
                    return { uri, label: connectionLabel(uri) };
                });
                show({
                    kind, connections,
                    values: deployDefaults(project, connections,
                        this.host.defaultConnection()),
                }, {
                    submit: (values) => {
                        return this.#deploy(project, values);
                    },
                    // An action of the connection deployed onto.
                    onFailed: (values) => {
                        this.host.showActions(values.connection);
                    },
                });
            }
        }
    }

    /**
     * Reads a project, as one action: its information, then its releases
     * and its deployment scripts, side by side.
     *
     * @param projectPath The project folder.
     *
     * @returns What the dialogs show of it.
     */
    async #read(projectPath: string): Promise<IMsmProjectContext> {
        const name = basename(projectPath);
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, {
            doing: `Reading MSM project ${name}`,
            done: `Read MSM project ${name}`,
        });
        const at = msmToolArgs.project(projectPath);
        try {
            return await group.run(async () => {
                const api = await this.host.msmApi();
                // First, as it says whether the folder is a project at all.
                const info = await group.step({
                    doing: "Reading the project information",
                    done: "Read the project information",
                }, msmCall("msm.get_project_information", at), () => {
                    return api.projectInformation(projectPath);
                }, {
                    detail: (read) => {
                        return `Schema ${read.schemaName}, development `
                            + `version ${read.currentDevelopmentVersion}`;
                    },
                });
                const [released, scripts] = await Promise.all([
                    group.step({
                        doing: "Listing the released versions",
                        done: "Listed the released versions",
                    }, msmCall("msm.get_released_versions", at), () => {
                        return api.releasedVersions(projectPath);
                    }, { detail: versionsDetail("released version") }),
                    group.step({
                        doing: "Listing the deployment scripts",
                        done: "Listed the deployment scripts",
                    }, msmCall("msm.get_deployment_script_versions", at),
                    () => {
                        return api.deploymentScriptVersions(projectPath);
                    }, { detail: versionsDetail("deployment script") }),
                ]);

                return projectContext(info, projectPath, released, scripts);
            }, (project) => {
                return `${project.schemaName} `
                    + project.currentDevelopmentVersion;
            });
        } catch (error) {
            this.host.showActions(GENERAL_ACTIONS);
            throw error;
        }
    }

    /**
     * Refuses what the server would, before calling it, where the reason
     * belongs to a field: a project folder there already, or a folder that
     * is not there.
     *
     * @param values What New MSM Project says.
     *
     * @returns The problem, if there is one.
     */
    async #checkCreate(
        values: IMsmCreateValues,
    ): Promise<IMsmProblem | undefined> {
        const exists = this.host.exists ?? pathExists;
        // As the plugin reads it: `~` is the home folder. A relative path
        // it resolves against its own folder, which is not known here, so
        // that is left to it.
        const typed = values.targetPath.trim();
        const target = /^~(?=$|[\\/])/u.test(typed)
            ? homedir() + typed.slice(1) : typed;
        if (!isAbsolute(target)) {
            return undefined;
        }
        if (!values.createTargetPath && !await exists(target)) {
            return {
                field: "targetPath",
                message: "This folder does not exist. Tick Create the Folder "
                    + "to have it made.",
            };
        }
        const project = join(target, projectFolderName(values.schemaName));
        if (!values.overwriteExisting && await exists(project)) {
            return {
                field: "schemaName",
                message: `${basename(project)} exists in this folder already. `
                    + "Tick Replace Existing Project to create it anew.",
            };
        }

        return undefined;
    }

    /**
     * Creates the project, then opens its development script and shows
     * the project where it was asked for: the folder in the Explorer, or
     * its row in the MSM Projects view. Not both, as showing the row
     * switches the side bar to the view.
     *
     * @param values What New MSM Project says.
     * @param from Where New MSM Project was asked for.
     */
    async #create(
        values: IMsmCreateValues,
        from: "explorer" | "view",
    ): Promise<void> {
        const schemaName = values.schemaName.trim();
        const targetPath = values.targetPath.trim();
        const copyrightHolder = values.copyrightHolder.trim();
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, {
            doing: `Creating MSM project for schema ${schemaName}`,
            done: `Created MSM project for schema ${schemaName}`,
        });
        // Filed and shown in the MSM Projects list as it is made; only what
        // differs from a new project's place there - the top level, no
        // caption or color - is sent.
        const folder = normalizeFolder(values.folder);
        const caption = values.caption.trim();
        const options: IMsmCreateOptions = {
            schemaName, targetPath, copyrightHolder,
            license: values.license,
            allowSpecialChars: values.allowSpecialChars,
            overwriteExisting: values.overwriteExisting,
            enforceTargetPath: values.createTargetPath,
            yearOfCreation: values.yearOfCreation.trim(),
            mcpAccess: values.mcpAccess,
            ...(folder === ROOT_FOLDER ? {} : { folder }),
            ...(caption === "" ? {} : { caption }),
            ...(values.color === "" ? {} : { color: values.color }),
        };
        const projectPath = await group.run(() => {
            return group.step({
                doing: "Creating the project folder",
                done: "Created the project folder",
            }, msmCall("msm.create_project",
                msmToolArgs.createProject(options)), async () => {
                return (await this.host.msmApi()).createProject(options);
            }, { detail: (path) => { return path; } });
        }, (path) => { return path; });
        this.host.projectsChanged?.();

        // The project is made once the folder is: reading it back, to open
        // its development script, is not the creation failing - pressing
        // Create again would be refused, the folder being there.
        this.#afterwards(async () => {
            const info = await this.#readBack(projectPath);
            await this.#showFile(info.schemaDevelopmentFilePath);
            if (from === "view") {
                await this.host.revealProject?.(projectPath);
            } else {
                await this.#reveal(projectPath);
            }
        });
    }

    /**
     * Reads a project just created, as an action of its own.
     *
     * @param projectPath The project folder.
     *
     * @returns Its information.
     */
    async #readBack(projectPath: string): Promise<IMsmProjectInfo> {
        const name = basename(projectPath);
        const words = {
            doing: `Reading the new MSM project ${name}`,
            done: `Read the new MSM project ${name}`,
        };
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        try {
            return await group.run(() => {
                return group.step(words, msmCall("msm.get_project_information",
                    msmToolArgs.project(projectPath)), async () => {
                    return (await this.host.msmApi())
                        .projectInformation(projectPath);
                }, {
                    detail: (info) => { return info.schemaDevelopmentFilePath; },
                });
            }, (info) => { return info.schemaDevelopmentFilePath; });
        } catch (error) {
            throw new Error(`${name} was created, but could not be read: `
                + errorText(error));
        }
    }

    /**
     * Prepares the release, then opens the files it wrote.
     *
     * @param project The project.
     * @param values What Prepare Release says.
     */
    async #release(
        project: IMsmProjectContext,
        values: IMsmReleaseValues,
    ): Promise<void> {
        const version = values.version.trim();
        const nextVersion = values.nextVersion.trim();
        const words = {
            doing: `Preparing release ${version} of ${project.schemaName}`,
            done: `Prepared release ${version} of ${project.schemaName}`,
        };
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        const options: IMsmReleaseOptions = {
            projectPath: project.projectPath, version, nextVersion,
            allowToStayOnSameVersion: values.allowToStayOnSameVersion,
            overwriteExisting: values.overwriteExisting,
        };
        const files = await group.run(() => {
            return group.step(words, msmCall("msm.prepare_release",
                msmToolArgs.prepareRelease(options)), async () => {
                return (await this.host.msmApi()).prepareRelease(options);
            }, {
                detail: (written) => {
                    return [`${counted(written.length, "file")} written`,
                        ...written.map((file) => { return basename(file); })]
                        .join("\n");
                },
            });
        }, () => { return `Development goes on with ${nextVersion}`; });

        // Opened side by side; shown in order, so the tabs keep it.
        this.#afterwards(async () => {
            const documents = await Promise.all(files.map((file) => {
                return vscode.workspace.openTextDocument(vscode.Uri.file(file));
            }));
            for (const document of documents) {
                await vscode.window.showTextDocument(document,
                    { preview: false });
            }
        });
    }

    /**
     * Generates the deployment script, then opens it.
     *
     * @param project The project.
     * @param values What Generate Deployment Script says.
     */
    async #generate(
        project: IMsmProjectContext,
        values: IMsmDeploymentScriptValues,
    ): Promise<void> {
        const what = `the deployment script for ${project.schemaName} `
            + values.version;
        const words = {
            doing: `Generating ${what}`, done: `Generated ${what}`,
        };
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        const options: IMsmDeploymentScriptOptions = {
            projectPath: project.projectPath,
            version: values.version,
            overwriteExisting: values.overwriteExisting,
        };
        const script = await group.run(() => {
            return group.step(words, msmCall("msm.generate_deployment_script",
                msmToolArgs.generateDeploymentScript(options)), async () => {
                return (await this.host.msmApi()).generateDeploymentScript(
                    options);
            }, { detail: (path) => { return path; } });
        }, (path) => { return path; });

        this.#afterwards(() => { return this.#showFile(script); });
    }

    /**
     * Deploys the schema onto a connection, as an action of that
     * connection's, on a session of its own, and has the tree and
     * completion read the server again.
     *
     * @param project The project.
     * @param values What Deploy Schema says.
     */
    async #deploy(
        project: IMsmProjectContext,
        values: IMsmDeployValues,
    ): Promise<void> {
        const { version } = values;
        const backupDirectory = values.backup
            && values.backupDirectory.trim() !== ""
            ? values.backupDirectory.trim() : undefined;
        const server = connectionLabel(values.connection);
        const what = `${project.schemaName} ${version} onto ${server}`;
        const group = new ActionGroup(this.host.put, values.connection, {
            doing: `Deploying ${what}`,
            done: `Deployed ${what}`,
        });
        deploys += 1;
        const session = `${MSM_DEPLOY_SESSION} ${String(deploys)}`;
        try {
            await group.run(async () => {
                const connectionId = await group.step({
                    doing: `Connecting to ${server}`,
                    done: `Connected to ${server}`,
                }, msmCall("db.connect", { uri: values.connection }), () => {
                    return this.host.connect(values.connection, session);
                });
                const options: IMsmDeployOptions = {
                    projectPath: project.projectPath, connectionId, version,
                    backup: values.backup,
                    ...(backupDirectory === undefined
                        ? {} : { backupDirectory }),
                };

                try {
                    return await group.step({
                        doing: `Deploying schema ${project.schemaName}`,
                        done: `Deployed schema ${project.schemaName}`,
                    }, msmCall("msm.deploy_schema",
                        msmToolArgs.deploySchema(options)), async () => {
                        return (await this.host.msmApi())
                            .deploySchema(options);
                    }, { detail: (said) => { return said; } });
                } finally {
                    // Its work done, whichever way: nothing else uses it.
                    await this.host.disconnect(values.connection, session)
                        .catch((error: unknown) => {
                            this.host.log(`Closing ${session} on ${server} `
                                + `failed: ${String(error)}`);
                        });
                }
            }, (said) => { return said; });
        } finally {
            // However it went: a script that failed partway may have made
            // or changed the schema already, or a backup been loaded back.
            this.host.refresh(values.connection);
        }
    }

    /**
     * Shows what the work wrote, once it is done and its dialog closes: a
     * file that cannot be opened is not the work failing - it was done, and
     * doing it again would be refused - so it is said on its own.
     *
     * @param show What to show.
     */
    #afterwards(show: () => Promise<void>): void {
        void show().catch((error: unknown) => {
            reportError(this.host.log, error);
        });
    }

    /**
     * Opens a file in an editor of its own, kept open.
     *
     * @param path The file.
     */
    async #showFile(path: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(path));
        await vscode.window.showTextDocument(document, { preview: false });
    }

    /**
     * Shows a folder in the Explorer, where it is in the workspace: one
     * outside it the Explorer does not show.
     *
     * @param path The folder.
     */
    async #reveal(path: string): Promise<void> {
        const uri = vscode.Uri.file(path);
        if (vscode.workspace.getWorkspaceFolder(uri) !== undefined) {
            await vscode.commands.executeCommand("revealInExplorer", uri);
        }
    }
}

/**
 * @param what What is listed, singular.
 *
 * @returns What a list of versions came to: "2 released versions: 1.0.0,
 *          1.0.1", or "No released versions".
 */
const versionsDetail = (what: string): (versions: string[]) => string => {
    return (versions) => {
        return versions.length === 0 ? `No ${what}s`
            : `${counted(versions.length, what)}: ${versions.join(", ")}`;
    };
};
