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
import { basename, isAbsolute, join } from "node:path";

import * as vscode from "vscode";

import {
    callArguments,
    GENERAL_ACTIONS,
} from "../connections/connectionActivity.js";
import { connectionLabel } from "../connections/connectionUri.js";
import { reportError } from "../errorMessages.js";
import { pathExists } from "../shell/nodeRuntime.js";
import {
    MSM_LICENSES,
    msmToolArgs,
    type IMsmApi,
    type IMsmCreateOptions,
    type IMsmDeployOptions,
    type IMsmDeploymentScriptOptions,
    type IMsmProjectInfo,
    type IMsmReleaseOptions,
} from "../mcp/msmApi.js";
import { ActionGroup, type ActionPutter } from "../restd/actionGroup.js";
import { counted, errorText } from "../text.js";
import {
    createDefaults,
    deployDefaults,
    deploymentScriptDefaults,
    isProjectFolder,
    MSM_TITLES,
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
import { pickFolder } from "../webview/dialogPanel.js";
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
type ProjectDialogKind = Exclude<MsmDialogKind, "create">;

/** The commands, by the dialog each opens. */
export const MSM_COMMANDS: Record<MsmDialogKind, string> = {
    create: "mariadb.msm.createProject",
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
        const kinds: ProjectDialogKind[] = [
            "info", "release", "deploymentScript", "deploy",
        ];

        return [
            command(MSM_COMMANDS.create, async (folder) => {
                this.createProject(folder);
            }, () => { return Promise.resolve(this.host.defaultFolder()); }),
            ...kinds.map((kind) => {
                return command(MSM_COMMANDS[kind], (folder) => {
                    return this.open(kind, folder);
                }, () => {
                    return pickFolder("Choose a Schema Project Folder");
                });
            }),
        ];
    }

    /**
     * Opens New MSM Project on a folder.
     *
     * @param folder The folder the project is to be made in.
     */
    public createProject(folder: string): void {
        MsmDialogPanel.show(this.host.extensionUri, {
            kind: "create",
            title: MSM_TITLES.create,
            values: createDefaults(folder),
            licenses: MSM_LICENSES,
        }, {
            check: (values) => { return this.#checkCreate(values); },
            submit: (values) => { return this.#create(values); },
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
        const options: IMsmCreateOptions = {
            schemaName, targetPath, copyrightHolder,
            license: values.license,
            allowSpecialChars: values.allowSpecialChars,
            overwriteExisting: values.overwriteExisting,
            enforceTargetPath: values.createTargetPath,
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

        // The project is made once the folder is: reading it back, to open
        // its development script, is not the creation failing - pressing
        // Create again would be refused, the folder being there.
        this.#afterwards(async () => {
            const info = await this.#readBack(projectPath);
            await this.#showFile(info.schemaDevelopmentFilePath);
            await this.#reveal(projectPath);
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
