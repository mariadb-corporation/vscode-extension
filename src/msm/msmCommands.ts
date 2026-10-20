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

import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

import * as vscode from "vscode";

import { GENERAL_ACTIONS } from "../connections/connectionActivity.js";
import { connectionLabel } from "../connections/connectionUri.js";
import { reportError } from "../errorMessages.js";
import {
    MSM_LICENSES,
    type IMsmApi,
    type IMsmProjectInfo,
} from "../mcp/msmApi.js";
import {
    ActionGroup,
    type ActionPutter,
    type IStepWords,
} from "../restd/actionGroup.js";
import { counted } from "../text.js";
import {
    createDefaults,
    deployDefaults,
    deploymentScriptDefaults,
    isProjectFolder,
    MSM_TITLES,
    newestFirst,
    projectFolderName,
    releaseDefaults,
    type IMsmCreateValues,
    type IMsmDeploymentScriptValues,
    type IMsmDeployValues,
    type IMsmProblem,
    type IMsmProjectContext,
    type IMsmReleaseValues,
    type MsmDialogKind,
} from "./msmFields.js";
import { MsmDialogPanel } from "./msmDialogPanel.js";

/** What the MariaDB Schema Management commands need from the extension. */
export interface IMsmCommandsHost {
    extensionUri: vscode.Uri;
    msmApi(): Promise<IMsmApi>;
    /** Opens the extension's connection to a URI; its connection id. */
    connect(uri: string): Promise<string>;
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
    log(message: string): void;
}

/** The commands, by the dialog each opens. */
export const MSM_COMMANDS: Record<MsmDialogKind, string> = {
    create: "mariadb.msm.createProject",
    info: "mariadb.msm.showProjectInformation",
    release: "mariadb.msm.prepareRelease",
    deploymentScript: "mariadb.msm.generateDeploymentScript",
    deploy: "mariadb.msm.deploySchema",
};

/**
 * @param value A value of a call.
 *
 * @returns It as the Actions tab shows a call's arguments: a string
 *          quoted, anything else as it is.
 */
const argument = (value: string | boolean): string => {
    return typeof value === "string"
        ? `'${value.replace(/'/gu, "\\'")}'` : String(value);
};

/**
 * @param name The tool.
 * @param args Its arguments; those undefined are left out.
 *
 * @returns The call as its row shows it: `msm.prepare_release(version=
 *          '1.0.0', next_version='1.0.1')`.
 */
export const msmCall = (
    name: string,
    args: Record<string, string | boolean | undefined>,
): string => {
    const shown = Object.entries(args).filter(([, value]) => {
        return value !== undefined;
    }).map(([key, value]) => {
        return `${key}=${argument(value as string | boolean)}`;
    });

    return `${name}(${shown.join(", ")})`;
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
    const holders = (info.copyrights ?? []).map((copyright) => {
        return copyright.holder;
    }).filter((holder) => { return holder !== ""; });

    return {
        projectPath,
        schemaName: info.schemaName,
        license: info.license ?? "None",
        copyrightHolders: holders.length > 0 ? holders
            : info.copyrightHolder === undefined || info.copyrightHolder === ""
                ? [] : [info.copyrightHolder],
        currentDevelopmentVersion: info.currentDevelopmentVersion,
        ...(info.lastReleasedVersion === null
            ? {} : { lastReleasedVersion: info.lastReleasedVersion }),
        releasedVersions: released,
        deploymentScriptVersions: scripts,
        schemaDevelopmentFilePath: info.schemaDevelopmentFilePath,
    };
};

/**
 * @param path A path.
 *
 * @returns Whether there is anything at it.
 */
const existsOnDisk = async (path: string): Promise<boolean> => {
    try {
        await stat(path);

        return true;
    } catch {
        return false;
    }
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
            handler: (folder: string) => Promise<void>,
            pick: () => Promise<string | undefined>,
        ): vscode.Disposable => {
            return vscode.commands.registerCommand(id,
                async (folder?: vscode.Uri) => {
                    try {
                        const path = folder?.fsPath ?? await pick();
                        if (path !== undefined) {
                            await handler(path);
                        }
                    } catch (error) {
                        reportError(this.host.log, error);
                    }
                });
        };
        const pickProject = (): Promise<string | undefined> => {
            return this.#pickFolder("Choose a Schema Project Folder");
        };

        return [
            command(MSM_COMMANDS.create, (folder) => {
                return this.createProject(folder);
            }, () => { return Promise.resolve(this.host.defaultFolder()); }),
            command(MSM_COMMANDS.info, (folder) => {
                return this.open("info", folder);
            }, pickProject),
            command(MSM_COMMANDS.release, (folder) => {
                return this.open("release", folder);
            }, pickProject),
            command(MSM_COMMANDS.deploymentScript, (folder) => {
                return this.open("deploymentScript", folder);
            }, pickProject),
            command(MSM_COMMANDS.deploy, (folder) => {
                return this.open("deploy", folder);
            }, pickProject),
        ];
    }

    /**
     * Opens New MSM Project on a folder.
     *
     * @param folder The folder the project is to be made in.
     */
    public createProject(folder: string): Promise<void> {
        MsmDialogPanel.show(this.host.extensionUri, {
            kind: "create",
            title: MSM_TITLES.create,
            values: createDefaults(folder),
            licenses: MSM_LICENSES,
        }, {
            check: (values) => {
                return this.#checkCreate(values as IMsmCreateValues);
            },
            submit: async (values) => {
                await this.#create(values as IMsmCreateValues);
            },
            onFailed: () => { this.host.showActions(GENERAL_ACTIONS); },
            log: this.host.log,
        });

        return Promise.resolve();
    }

    /**
     * Reads a project and opens a dialog on it.
     *
     * @param kind The dialog.
     * @param projectPath The `*.msm.project` folder.
     */
    public async open(
        kind: Exclude<MsmDialogKind, "create">,
        projectPath: string,
    ): Promise<void> {
        if (!isProjectFolder(projectPath)) {
            throw new Error(`${basename(projectPath)} is not a schema `
                + `project folder: its name has to end in .msm.project.`);
        }

        const project = await this.#read(projectPath);
        const title = `${MSM_TITLES[kind]} - ${project.schemaName}`;

        switch (kind) {
            case "info": {
                MsmDialogPanel.show(this.host.extensionUri, {
                    kind, title, project, values: {},
                }, {
                    submit: () => { return Promise.resolve(); },
                    open: async (what) => {
                        if (what === "developmentFile") {
                            await this.#showFile(
                                project.schemaDevelopmentFilePath);
                        } else {
                            await this.open(what, projectPath);
                        }
                    },
                    log: this.host.log,
                });
                break;
            }

            case "release": {
                MsmDialogPanel.show(this.host.extensionUri, {
                    kind, title, project, values: releaseDefaults(project),
                }, {
                    submit: async (values) => {
                        await this.#release(project,
                            values as IMsmReleaseValues);
                    },
                    onFailed: () => {
                        this.host.showActions(GENERAL_ACTIONS);
                    },
                    log: this.host.log,
                });
                break;
            }

            case "deploymentScript": {
                MsmDialogPanel.show(this.host.extensionUri, {
                    kind, title, project,
                    values: deploymentScriptDefaults(project),
                }, {
                    submit: async (values) => {
                        await this.#generate(project,
                            values as IMsmDeploymentScriptValues);
                    },
                    onFailed: () => {
                        this.host.showActions(GENERAL_ACTIONS);
                    },
                    log: this.host.log,
                });
                break;
            }

            default: {
                const connections = (await this.host.connectionUris())
                    .map((uri) => {
                        return { uri, label: connectionLabel(uri) };
                    });
                let target = "";
                MsmDialogPanel.show(this.host.extensionUri, {
                    kind, title, project, connections,
                    values: deployDefaults(project, connections,
                        this.host.defaultConnection()),
                }, {
                    submit: async (values) => {
                        target = (values as IMsmDeployValues).connection;
                        await this.#deploy(project, values as IMsmDeployValues);
                    },
                    onFailed: () => {
                        this.host.showActions(target === ""
                            ? GENERAL_ACTIONS : target);
                    },
                    log: this.host.log,
                });
            }
        }
    }

    /**
     * Reads a project, as one action: its information, its releases and
     * its deployment scripts.
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
        try {
            const api = await this.host.msmApi();
            const at = { schema_project_path: projectPath };
            const info = await group.step({
                doing: "Reading the project information",
                done: "Read the project information",
            }, msmCall("msm.get_project_information", at), () => {
                return api.projectInformation(projectPath);
            }, {
                detail: (read) => {
                    return `Schema ${read.schemaName}, development version `
                        + read.currentDevelopmentVersion;
                },
            });
            const released = await group.step({
                doing: "Listing the released versions",
                done: "Listed the released versions",
            }, msmCall("msm.get_released_versions", at), () => {
                return api.releasedVersions(projectPath);
            }, { detail: versionsDetail("released version") });
            const scripts = await group.step({
                doing: "Listing the deployment scripts",
                done: "Listed the deployment scripts",
            }, msmCall("msm.get_deployment_script_versions", at), () => {
                return api.deploymentScriptVersions(projectPath);
            }, { detail: versionsDetail("deployment script") });
            group.finish(`${info.schemaName} ${info.currentDevelopmentVersion}`);

            return projectContext(info, projectPath, released, scripts);
        } catch (error) {
            group.finish();
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
        const exists = this.host.exists ?? existsOnDisk;
        const target = values.targetPath.trim();
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
     * the folder in the Explorer.
     *
     * @param values What New MSM Project says.
     */
    async #create(values: IMsmCreateValues): Promise<void> {
        const schemaName = values.schemaName.trim();
        const targetPath = values.targetPath.trim();
        const copyrightHolder = values.copyrightHolder.trim();
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, {
            doing: `Creating MSM project for schema ${schemaName}`,
            done: `Created MSM project for schema ${schemaName}`,
        });
        let projectPath: string;
        let info: IMsmProjectInfo;
        try {
            const api = await this.host.msmApi();
            projectPath = await group.step({
                doing: "Creating the project folder",
                done: "Created the project folder",
            }, msmCall("msm.create_project", {
                schema_name: schemaName,
                target_path: targetPath,
                copyright_holder: copyrightHolder,
                license: values.license,
                allow_special_chars: values.allowSpecialChars || undefined,
                overwrite_existing: values.overwriteExisting || undefined,
                enforce_target_path: values.createTargetPath || undefined,
            }), () => {
                return api.createProject({
                    schemaName, targetPath, copyrightHolder,
                    license: values.license,
                    allowSpecialChars: values.allowSpecialChars,
                    overwriteExisting: values.overwriteExisting,
                    enforceTargetPath: values.createTargetPath,
                });
            }, { detail: (path) => { return path; } });
            info = await group.step({
                doing: "Reading the new project",
                done: "Read the new project",
            }, msmCall("msm.get_project_information",
                { schema_project_path: projectPath }), () => {
                return api.projectInformation(projectPath);
            }, {
                detail: (read) => { return read.schemaDevelopmentFilePath; },
            });
            group.finish(projectPath);
        } catch (error) {
            group.finish();
            throw error;
        }

        await this.#showFile(info.schemaDevelopmentFilePath);
        this.#reveal(projectPath);
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
        const files = await this.#single({
            doing: `Preparing release ${version} of ${project.schemaName}`,
            done: `Prepared release ${version} of ${project.schemaName}`,
        }, msmCall("msm.prepare_release", {
            version,
            next_version: nextVersion,
            allow_to_stay_on_same_version:
                values.allowToStayOnSameVersion || undefined,
            overwrite_existing: values.overwriteExisting || undefined,
        }), async () => {
            return (await this.host.msmApi()).prepareRelease({
                projectPath: project.projectPath, version, nextVersion,
                allowToStayOnSameVersion: values.allowToStayOnSameVersion,
                overwriteExisting: values.overwriteExisting,
            });
        }, (written) => {
            return [counted(written.length, "file") + " written",
                ...written.map((file) => { return basename(file); })]
                .join("\n");
        }, `Development goes on with ${nextVersion}`);

        for (const file of files) {
            await this.#showFile(file);
        }
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
        const script = await this.#single({
            doing: `Generating the deployment script for `
                + `${project.schemaName} ${values.version}`,
            done: `Generated the deployment script for `
                + `${project.schemaName} ${values.version}`,
        }, msmCall("msm.generate_deployment_script", {
            version: values.version,
            overwrite_existing: values.overwriteExisting || undefined,
        }), async () => {
            return (await this.host.msmApi()).generateDeploymentScript({
                projectPath: project.projectPath,
                version: values.version,
                overwriteExisting: values.overwriteExisting,
            });
        }, (path) => { return path; });

        await this.#showFile(script);
    }

    /**
     * Deploys the schema onto a connection, as an action of that
     * connection's, and has the tree and completion read it again.
     *
     * @param project The project.
     * @param values What Deploy Schema says.
     */
    async #deploy(
        project: IMsmProjectContext,
        values: IMsmDeployValues,
    ): Promise<void> {
        const version = values.version === ""
            ? newestFirst(project.deploymentScriptVersions)[0]
            : values.version;
        const backupDirectory = values.backup
            && values.backupDirectory.trim() !== ""
            ? values.backupDirectory.trim() : undefined;
        const server = connectionLabel(values.connection);
        const group = new ActionGroup(this.host.put, values.connection, {
            doing: `Deploying ${project.schemaName} ${version ?? ""} onto `
                + server,
            done: `Deployed ${project.schemaName} ${version ?? ""} onto `
                + server,
        });
        try {
            const connectionId = await group.step({
                doing: `Connecting to ${server}`,
                done: `Connected to ${server}`,
            }, msmCall("db.connect", { connection: values.connection }), () => {
                return this.host.connect(values.connection);
            });
            const message = await group.step({
                doing: `Deploying schema ${project.schemaName}`,
                done: `Deployed schema ${project.schemaName}`,
            }, msmCall("msm.deploy_schema", {
                version,
                backup: values.backup || undefined,
                backup_directory: backupDirectory,
            }), async () => {
                return (await this.host.msmApi()).deploySchema({
                    projectPath: project.projectPath, connectionId,
                    ...(version === undefined ? {} : { version }),
                    backup: values.backup,
                    ...(backupDirectory === undefined
                        ? {} : { backupDirectory }),
                });
            }, { detail: (said) => { return said; } });
            group.finish(message);
        } catch (error) {
            group.finish();
            throw error;
        }
        this.host.refresh(values.connection);
    }

    /**
     * Does one call on a project, as an action of one step under General
     * Actions.
     *
     * @param words What it is called.
     * @param call The call, as its row shows it.
     * @param work The call.
     * @param detail What it came to, for the step's row.
     * @param summary What it came to, for the action's row.
     *
     * @returns What the call returned.
     */
    async #single<T>(
        words: IStepWords,
        call: string,
        work: () => Promise<T>,
        detail: (value: T) => string,
        summary?: string,
    ): Promise<T> {
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);
        try {
            const value = await group.step(words, call, work, { detail });
            group.finish(summary ?? detail(value).split("\n")[0]);

            return value;
        } catch (error) {
            group.finish();
            throw error;
        }
    }

    /**
     * @param title What the picker is for.
     *
     * @returns The folder picked, or undefined.
     */
    async #pickFolder(title: string): Promise<string | undefined> {
        const picked = await vscode.window.showOpenDialog({
            title,
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Select Folder",
        });

        return picked?.[0]?.fsPath;
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
     * Shows a folder in the Explorer. Only a nicety: a folder outside the
     * workspace cannot be shown, which is not worth saying.
     *
     * @param path The folder.
     */
    #reveal(path: string): void {
        void Promise.resolve(vscode.commands.executeCommand(
            "revealInExplorer", vscode.Uri.file(path))).catch(() => {
            // Not in the workspace.
        });
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
