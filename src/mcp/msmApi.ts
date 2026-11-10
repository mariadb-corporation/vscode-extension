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

import type { IToolCaller } from "./mariaDbApi.js";
import {
    decodeList,
    decodeObject,
    decodeScalar,
    decodeVoid,
} from "./protocol.js";
import type {
    IDiagramDocument,
    IDiagramRow,
} from "../modeler/modelFormat.js";
import type {
    IOnlineAlterOptions,
    IOnlineAlterSetting,
} from "../tableEditor/onlineAlter.js";
import type { ITaskStarted } from "./taskApi.js";
import { CONNECTION_COLORS, type ConnectionColor } from "./types.js";

/** One copyright notice of a schema project. */
export interface IMsmCopyright {
    holder: string;
    yearOfCreation?: string;
    yearOfLastUpdate?: string;
    /** Whether its year follows the current one. */
    tracksUpdates?: boolean;
}

/**
 * What `msm.get_project_information` answers with: the project's
 * `msm.project.json` and what its files say about its versions.
 */
export interface IMsmProjectInfo {
    schemaName: string;
    /** The name its files are named after. */
    schemaFileName?: string;
    copyrightHolder?: string;
    copyrights?: IMsmCopyright[];
    license?: string;
    customLicense?: string;
    yearOfCreation?: string;
    schemaDependencies?: unknown[];
    /** The version `development/<schema>_next.sql` is for. */
    currentDevelopmentVersion: string;
    /** "1.0.0", or null before the first release. */
    lastReleasedVersion: string | null;
    /** `development/<schema>_next.sql`. */
    schemaDevelopmentFilePath: string;
}

/** What `msm.create_project` is asked to make. */
export interface IMsmCreateOptions {
    schemaName: string;
    /** The folder the project folder is made in. */
    targetPath: string;
    copyrightHolder?: string;
    /** One of {@link MSM_LICENSES}. */
    license?: string;
    overwriteExisting?: boolean;
    allowSpecialChars?: boolean;
    /** Make `targetPath` where it does not exist yet. */
    enforceTargetPath?: boolean;
    /** The copyright's first year, `2024`; left out, the current one. */
    yearOfCreation?: string;
    /**
     * Whether LLMs may work on it through an MCP server without `--gui`;
     * left out, they may not.
     */
    mcpAccess?: boolean;
    /** The folder of the MSM Projects list to file it in; `/` if left out. */
    folder?: string;
    /** Its caption in the list. */
    caption?: string;
    /** Its color in the list. */
    color?: ConnectionColor;
}

/**
 * A project of the MSM Projects list, as `msm.list_projects` reports it.
 * The list is the server's, kept in the msm plugin's data folder.
 */
export interface IMsmListedProject {
    /** The `<schema>.msm.project` folder, absolute. */
    projectPath: string;
    /** The folder of the list it is filed in: `/` or `/Shop/Production`. */
    folder: string;
    /** "" for none. */
    caption: string;
    /** Undefined for none, or one the extension does not know. */
    color?: ConnectionColor;
    /** Whether LLMs may work on it through a server without `--gui`. */
    mcpAccess: boolean;
    /** What its `msm.project.json` says; undefined where it cannot be read. */
    schemaName?: string;
    /** Whether the folder is still a project: a moved one stays listed. */
    exists: boolean;
    /** Its development version; undefined where it cannot be read. */
    developmentVersion?: string;
}

/**
 * How a project is filed and shown in the list. Each field is sent only
 * when set; "" clears a caption or a color.
 */
export interface IMsmProjectDetails {
    folder?: string;
    caption?: string;
    color?: ConnectionColor | "";
    mcpAccess?: boolean;
}

/** What `msm.prepare_release` is asked to do. */
export interface IMsmReleaseOptions {
    projectPath: string;
    version: string;
    nextVersion: string;
    allowToStayOnSameVersion?: boolean;
    overwriteExisting?: boolean;
}

/** What `msm.generate_deployment_script` is asked to do. */
export interface IMsmDeploymentScriptOptions {
    projectPath: string;
    version: string;
    overwriteExisting?: boolean;
}

/** What `msm.deploy_schema` is asked to do. */
export interface IMsmDeployOptions {
    projectPath: string;
    /** A connection opened with `db.connect`. */
    connectionId: string;
    /** The newest one a deployment script exists for, left out. */
    version?: string;
    /** Dump an existing schema first, to restore it should the update fail. */
    backup?: boolean;
    /** The project's `backups` folder, left out. */
    backupDirectory?: string;
}

/**
 * The licenses a project can be created with: the templates
 * `msm_plugin/templates/license` ships. The MCP server has no tool listing
 * them, so they are named here, and a template added there is to be added
 * here too.
 */
export const MSM_LICENSES = ["None", "BSD", "GPL-2.0", "MIT"] as const;

/**
 * How long a deployment may take: it runs a whole script on the server,
 * and may dump the schema first.
 */
export const MSM_DEPLOY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The settings of msm.project.json that `msm.set_project_settings`
 * writes; only those given change.
 */
export interface IMsmProjectSettings {
    /** Every holder, the first one the project's main one. */
    copyrights?: IMsmCopyright[];
    /** A template's name, or CUSTOM with `customLicense` in one call. */
    license?: string;
    /** The text of a CUSTOM license; null drops it, for a template. */
    customLicense?: string | null;
    /** The whole setting, the tables' entries too; null for msm's. */
    onlineAlter?: IOnlineAlterSetting | null;
}

/**
 * msm.set_project_settings takes the `onlineAlter` setting only as a
 * whole, so a writer of one part reads it just before: what another
 * writer changed since is kept.
 *
 * @param api The msm API.
 * @param projectPath The project folder.
 * @param change Changes the part: `withTable` or `withGeneral`.
 *
 * @returns The whole setting to write; null where nothing is left, so
 *          msm.project.json goes back to msm's defaults.
 */
export const changedOnlineAlter = async (
    api: IMsmApi,
    projectPath: string,
    change: (setting: IOnlineAlterSetting) => IOnlineAlterSetting,
): Promise<IOnlineAlterSetting | null> => {
    const changed = change(
        (await api.getOnlineAlterSettings(projectPath)).setting);

    return Object.keys(changed).length === 0 ? null : changed;
};

/** A project's online ALTER TABLE setting, as msm gives it for a table. */
export interface IMsmOnlineAlterSettings {
    /** The values where nothing is set. */
    defaults: Required<IOnlineAlterOptions>;
    /** msm.project.json's `onlineAlter`, normalized. */
    setting: IOnlineAlterSetting;
    table?: string | null;
    /** Whether it is on for the table. */
    enabled?: boolean;
}

/** A diagram of a project, as `msm.list_schema_diagrams` counts it. */
export interface IMsmDiagramSummary {
    name: string;
    figures: number;
    connections: number;
}

/** What `msm.list_schema_diagrams` says of a project's diagrams. */
export interface IMsmDiagramListing {
    /**
     * The snapshot's table count, and whether it was made from the
     * development script as it is now; undefined without a snapshot.
     */
    schemaDefinition?: { tables: number; current: boolean };
    diagrams: IMsmDiagramSummary[];
}

/**
 * One schema edit of `msm.edit_schema`: an `op` and its members, as the
 * language server's edit format has them (lsp-server
 * `docs/edit-format.md`): `rename_table` (table, new_name),
 * `rename_column` (table, column, new_name), ...
 */
export interface IMsmSchemaEdit {
    op: string;
    [member: string]: unknown;
}

/** What `msm.edit_schema` answers with. */
export interface IMsmSchemaEditResult {
    /** The diagrams view afterwards, the new snapshot first. */
    rows: IDiagramRow[];
    files: string[];
    /** The statements kept for the next release's update script. */
    migration: string[];
    migrationFile?: string;
    /** What the edits could not change themselves, for a person. */
    notes: Array<{ kind?: string; message: string }>;
}

/** The `msm.*` tools, as typed calls. */
export interface IMsmApi {
    createProject(options: IMsmCreateOptions): Promise<string>;
    listProjects(): Promise<IMsmListedProject[]>;
    addProject(projectPath: string,
        details?: IMsmProjectDetails): Promise<IMsmListedProject>;
    updateProject(projectPath: string,
        details: IMsmProjectDetails): Promise<IMsmListedProject>;
    removeProject(projectPath: string): Promise<string>;
    setDevelopmentVersion(projectPath: string, version: string): Promise<void>;
    projectInformation(projectPath: string): Promise<IMsmProjectInfo>;
    releasedVersions(projectPath: string): Promise<string[]>;
    deploymentScriptVersions(projectPath: string): Promise<string[]>;
    prepareRelease(options: IMsmReleaseOptions): Promise<string[]>;
    generateDeploymentScript(
        options: IMsmDeploymentScriptOptions): Promise<string>;
    deploySchema(options: IMsmDeployOptions): Promise<string>;
    listSchemaDiagrams(projectPath: string): Promise<IMsmDiagramListing>;
    getSchemaDiagrams(projectPath: string,
        diagram?: string): Promise<IDiagramRow[]>;
    getSchemaDiagramImage(projectPath: string, diagram: string,
        figureId: string): Promise<string>;
    setSchemaDiagram(projectPath: string,
        document: IDiagramDocument): Promise<string[]>;
    createEmptySchemaDiagram(projectPath: string, name: string): Promise<void>;
    removeSchemaDiagram(projectPath: string, name: string): Promise<string[]>;
    getOnlineAlterSettings(projectPath: string,
        table?: string): Promise<IMsmOnlineAlterSettings>;
    setProjectSettings(projectPath: string,
        settings: IMsmProjectSettings): Promise<string[]>;
    onlineAlterDefaults(): Promise<Required<IOnlineAlterOptions>>;
    onlineAlterTable(connectionId: string, schema: string, table: string,
        spec: string, options: IOnlineAlterOptions): Promise<ITaskStarted>;
    renameSchemaDiagram(projectPath: string, name: string,
        newName: string): Promise<string[]>;
    updateSchemaDefinition(projectPath: string): Promise<void>;
    editSchema(projectPath: string, edits: IMsmSchemaEdit[],
        baseHash: string): Promise<IMsmSchemaEditResult>;
}

/**
 * @param version `[major, minor, patch]`, as the msm tools list versions.
 *
 * @returns It as "major.minor.patch".
 */
const versionString = (version: unknown): string => {
    return Array.isArray(version)
        ? version.map((part) => { return String(part); }).join(".")
        : String(version);
};

/**
 * @param pairs A tool's arguments.
 *
 * @returns Them without those that were not given: undefined, or a flag
 *          that is off - the tool's own default.
 */
const given = (pairs: Record<string, unknown>): Record<string, unknown> => {
    return Object.fromEntries(Object.entries(pairs).filter(([, value]) => {
        return value !== undefined && value !== false;
    }));
};

/** A project as the server lists it, by its own names. */
interface IListedOnTheWire {
    project_path: string;
    folder?: string;
    caption?: string;
    color?: string;
    mcp_access?: boolean;
    schema_name?: string | null;
    exists?: boolean;
    development_version?: string | null;
}

/**
 * @param listed A project as the server lists it.
 *
 * @returns It as the extension reads it: a color it does not know is
 *          dropped, and a server that predates `mcp_access` is read as
 *          giving access, as every project had then.
 */
const listedProject = (listed: IListedOnTheWire): IMsmListedProject => {
    const color = CONNECTION_COLORS.find((known) => {
        return known === listed.color;
    });

    return {
        projectPath: listed.project_path,
        folder: listed.folder === undefined || listed.folder === ""
            ? "/" : listed.folder,
        caption: listed.caption ?? "",
        ...(color === undefined ? {} : { color }),
        mcpAccess: listed.mcp_access ?? true,
        ...(typeof listed.schema_name === "string"
            ? { schemaName: listed.schema_name } : {}),
        exists: listed.exists ?? true,
        ...(typeof listed.development_version === "string"
            ? { developmentVersion: listed.development_version } : {}),
    };
};

/**
 * @param prefix "" for msm.add_project, "new_" for msm.update_project.
 * @param details What to set.
 *
 * @returns The arguments, only those set.
 */
const detailArgs = (
    prefix: string,
    details: IMsmProjectDetails,
): Record<string, unknown> => {
    const args = {
        folder: details.folder,
        caption: details.caption,
        color: details.color,
        // Not `given`: an access of false has to be sent.
        mcp_access: details.mcpAccess,
    };

    return Object.fromEntries(Object.entries(args).filter(([, value]) => {
        return value !== undefined;
    }).map(([name, value]) => { return [`${prefix}${name}`, value]; }));
};

/**
 * The arguments each `msm.*` tool is called with, by the server's names:
 * what `MsmApi` sends, and what the Actions tab shows a call with.
 */
export const msmToolArgs = {
    project: (projectPath: string): Record<string, unknown> => {
        return { schema_project_path: projectPath };
    },
    createProject: (options: IMsmCreateOptions): Record<string, unknown> => {
        return given({
            schema_name: options.schemaName,
            target_path: options.targetPath,
            copyright_holder: options.copyrightHolder,
            license: options.license,
            overwrite_existing: options.overwriteExisting,
            allow_special_chars: options.allowSpecialChars,
            enforce_target_path: options.enforceTargetPath,
            year_of_creation: options.yearOfCreation,
            mcp_access: options.mcpAccess,
            folder: options.folder,
            caption: options.caption,
            color: options.color,
        });
    },
    addProject: (
        projectPath: string,
        details: IMsmProjectDetails = {},
    ): Record<string, unknown> => {
        return { project_path: projectPath, ...detailArgs("", details) };
    },
    updateProject: (
        projectPath: string,
        details: IMsmProjectDetails,
    ): Record<string, unknown> => {
        return { project_path: projectPath, ...detailArgs("new_", details) };
    },
    removeProject: (projectPath: string): Record<string, unknown> => {
        return { project_path: projectPath };
    },
    setDevelopmentVersion: (
        projectPath: string,
        version: string,
    ): Record<string, unknown> => {
        return { schema_project_path: projectPath, version };
    },
    prepareRelease: (options: IMsmReleaseOptions): Record<string, unknown> => {
        return given({
            schema_project_path: options.projectPath,
            version: options.version,
            next_version: options.nextVersion,
            allow_to_stay_on_same_version: options.allowToStayOnSameVersion,
            overwrite_existing: options.overwriteExisting,
        });
    },
    generateDeploymentScript: (
        options: IMsmDeploymentScriptOptions,
    ): Record<string, unknown> => {
        return given({
            schema_project_path: options.projectPath,
            version: options.version,
            overwrite_existing: options.overwriteExisting,
        });
    },
    getSchemaDiagrams: (
        projectPath: string,
        diagram?: string,
    ): Record<string, unknown> => {
        return given({ schema_project_path: projectPath, diagram });
    },
    getSchemaDiagramImage: (
        projectPath: string,
        diagram: string,
        figureId: string,
    ): Record<string, unknown> => {
        return {
            diagram,
            figure_id: figureId,
            schema_project_path: projectPath,
        };
    },
    setSchemaDiagram: (
        projectPath: string,
        document: IDiagramDocument,
    ): Record<string, unknown> => {
        return { document, schema_project_path: projectPath };
    },
    createEmptySchemaDiagram: (
        projectPath: string,
        name: string,
    ): Record<string, unknown> => {
        // No tables: msm's default is every one of the schema's.
        return { name, tables: [], schema_project_path: projectPath };
    },
    removeSchemaDiagram: (
        projectPath: string,
        name: string,
    ): Record<string, unknown> => {
        return { name, schema_project_path: projectPath };
    },
    getOnlineAlterSettings: (
        projectPath: string,
        table?: string,
    ): Record<string, unknown> => {
        return {
            ...(table === undefined ? {} : { table }),
            schema_project_path: projectPath,
        };
    },
    setProjectSettings: (
        projectPath: string,
        settings: IMsmProjectSettings,
    ): Record<string, unknown> => {
        return { settings, schema_project_path: projectPath };
    },
    onlineAlterTable: (
        connectionId: string,
        schema: string,
        table: string,
        spec: string,
        options: IOnlineAlterOptions,
    ): Record<string, unknown> => {
        return { connection_id: connectionId, schema, table, spec, options };
    },
    renameSchemaDiagram: (
        projectPath: string,
        name: string,
        newName: string,
    ): Record<string, unknown> => {
        return { name, new_name: newName, schema_project_path: projectPath };
    },
    editSchema: (
        projectPath: string,
        edits: IMsmSchemaEdit[],
        baseHash: string,
    ): Record<string, unknown> => {
        return {
            edits,
            base_hash: baseHash,
            schema_project_path: projectPath,
        };
    },
    deploySchema: (options: IMsmDeployOptions): Record<string, unknown> => {
        return given({
            connection_id: options.connectionId,
            schema_project_path: options.projectPath,
            version: options.version,
            backup: options.backup,
            backup_directory: options.backupDirectory,
        });
    },
};

/** The MariaDB Schema Management tools of the MariaDB MCP server. */
export class MsmApi implements IMsmApi {
    public constructor(private readonly caller: IToolCaller) { }

    /**
     * Creates a project folder, `<schema>.msm.project`, in a folder.
     *
     * @param options What to create.
     *
     * @returns The project folder's path.
     */
    public async createProject(options: IMsmCreateOptions): Promise<string> {
        const name = "msm.create_project";

        return decodeScalar(name, await this.caller.callTool(name,
            msmToolArgs.createProject(options)));
    }

    /**
     * @returns The MSM Projects list, sorted by path.
     */
    public async listProjects(): Promise<IMsmListedProject[]> {
        const name = "msm.list_projects";

        return decodeList<IListedOnTheWire>(name,
            await this.caller.callTool(name, {})).map(listedProject);
    }

    /**
     * Adds a project to the list; a listed one gets the details given.
     *
     * @param projectPath The project folder.
     * @param details How to file and show it.
     *
     * @returns It as listed.
     */
    public async addProject(
        projectPath: string,
        details: IMsmProjectDetails = {},
    ): Promise<IMsmListedProject> {
        const name = "msm.add_project";

        return listedProject(decodeObject<IListedOnTheWire>(name,
            await this.caller.callTool(name,
                msmToolArgs.addProject(projectPath, details))));
    }

    /**
     * Changes how a listed project is filed and shown.
     *
     * @param projectPath The project folder, as listed.
     * @param details What to change.
     *
     * @returns It as listed.
     */
    public async updateProject(
        projectPath: string,
        details: IMsmProjectDetails,
    ): Promise<IMsmListedProject> {
        const name = "msm.update_project";

        return listedProject(decodeObject<IListedOnTheWire>(name,
            await this.caller.callTool(name,
                msmToolArgs.updateProject(projectPath, details))));
    }

    /**
     * Takes a project off the list; its folder stays as it is.
     *
     * @param projectPath The project folder, as listed.
     *
     * @returns The path as it was listed.
     */
    public async removeProject(projectPath: string): Promise<string> {
        const name = "msm.remove_project";

        return decodeScalar(name, await this.caller.callTool(name,
            msmToolArgs.removeProject(projectPath)));
    }

    /**
     * @param projectPath The project folder.
     * @param version The version development goes on with.
     */
    public async setDevelopmentVersion(
        projectPath: string,
        version: string,
    ): Promise<void> {
        const name = "msm.set_development_version";

        decodeVoid(name, await this.caller.callTool(name,
            msmToolArgs.setDevelopmentVersion(projectPath, version)));
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns Its settings and versions.
     */
    public async projectInformation(
        projectPath: string,
    ): Promise<IMsmProjectInfo> {
        const name = "msm.get_project_information";

        return decodeObject<IMsmProjectInfo>(name, await this.caller.callTool(
            name, msmToolArgs.project(projectPath)));
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns The versions released, "1.0.0", oldest first.
     */
    public releasedVersions(projectPath: string): Promise<string[]> {
        return this.#versions("msm.get_released_versions", projectPath);
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns The versions a deployment script was generated for.
     */
    public deploymentScriptVersions(projectPath: string): Promise<string[]> {
        return this.#versions("msm.get_deployment_script_versions",
            projectPath);
    }

    /**
     * @param name A tool listing versions of a project.
     * @param projectPath The project folder.
     *
     * @returns Them as "major.minor.patch".
     */
    async #versions(name: string, projectPath: string): Promise<string[]> {
        return decodeList<unknown>(name, await this.caller.callTool(name,
            msmToolArgs.project(projectPath))).map(versionString);
    }

    /**
     * Releases the development version, and moves development on.
     *
     * @param options What to release.
     *
     * @returns The files written.
     */
    public async prepareRelease(
        options: IMsmReleaseOptions,
    ): Promise<string[]> {
        const name = "msm.prepare_release";

        return decodeList<string>(name, await this.caller.callTool(name,
            msmToolArgs.prepareRelease(options)));
    }

    /**
     * Writes the script that deploys a released version, from nothing or
     * from any earlier version.
     *
     * @param options What to generate.
     *
     * @returns The script's path.
     */
    public async generateDeploymentScript(
        options: IMsmDeploymentScriptOptions,
    ): Promise<string> {
        const name = "msm.generate_deployment_script";

        return decodeScalar(name, await this.caller.callTool(name,
            msmToolArgs.generateDeploymentScript(options)));
    }

    /**
     * Runs a version's deployment script on a server: creating the schema,
     * or updating it to that version.
     *
     * @param options What to deploy, and where.
     *
     * @returns What the server says was done.
     */
    public async deploySchema(options: IMsmDeployOptions): Promise<string> {
        const name = "msm.deploy_schema";

        return decodeScalar(name, await this.caller.callTool(name,
            msmToolArgs.deploySchema(options), MSM_DEPLOY_TIMEOUT_MS));
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns Its diagrams' names and counts, and its snapshot's state.
     */
    public async listSchemaDiagrams(
        projectPath: string,
    ): Promise<IMsmDiagramListing> {
        const name = "msm.list_schema_diagrams";
        const listing = decodeObject<{
            schema_definition?: { tables: number; current: boolean } | null;
            diagrams?: IMsmDiagramSummary[];
        }>(name, await this.caller.callTool(name,
            msmToolArgs.project(projectPath)));

        return {
            ...(listing.schema_definition
                ? { schemaDefinition: listing.schema_definition } : {}),
            diagrams: listing.diagrams ?? [],
        };
    }

    /**
     * @param projectPath The project folder.
     * @param diagram Only this diagram, with the snapshot; every row where
     *                left out.
     *
     * @returns The rows of its diagrams view; image figures carry
     *          `image_size` in place of their pictures.
     */
    public async getSchemaDiagrams(
        projectPath: string,
        diagram?: string,
    ): Promise<IDiagramRow[]> {
        const name = "msm.get_schema_diagrams";

        return decodeList<IDiagramRow>(name, await this.caller.callTool(name,
            msmToolArgs.getSchemaDiagrams(projectPath, diagram)));
    }

    /**
     * @param projectPath The project folder.
     * @param diagram The diagram.
     * @param figureId The image figure.
     *
     * @returns Its picture, a data URL.
     */
    public async getSchemaDiagramImage(
        projectPath: string,
        diagram: string,
        figureId: string,
    ): Promise<string> {
        const name = "msm.get_schema_diagram_image";

        return decodeScalar(name, await this.caller.callTool(name,
            msmToolArgs.getSchemaDiagramImage(projectPath, diagram,
                figureId)));
    }

    /**
     * Adds a diagram to a project, or replaces the one of its name. An
     * image figure sent without its picture keeps the stored one.
     *
     * @param projectPath The project folder.
     * @param document The diagram.
     *
     * @returns The files written.
     */
    public async setSchemaDiagram(
        projectPath: string,
        document: IDiagramDocument,
    ): Promise<string[]> {
        const name = "msm.set_schema_diagram";

        return decodeList<string>(name, await this.caller.callTool(name,
            msmToolArgs.setSchemaDiagram(projectPath, document)));
    }

    /**
     * Removes a diagram from a project.
     *
     * @param projectPath The project folder.
     * @param name The diagram's name.
     *
     * @returns The files written.
     */
    public async removeSchemaDiagram(
        projectPath: string,
        name: string,
    ): Promise<string[]> {
        const tool = "msm.remove_schema_diagram";

        return decodeList<string>(tool, await this.caller.callTool(tool,
            msmToolArgs.removeSchemaDiagram(projectPath, name)));
    }

    /**
     * @param projectPath The project folder.
     * @param table A table of it; left out, the setting alone is read.
     *
     * @returns Its online ALTER TABLE setting, and what the table gets.
     */
    public async getOnlineAlterSettings(
        projectPath: string,
        table?: string,
    ): Promise<IMsmOnlineAlterSettings> {
        const tool = "msm.get_online_alter_settings";

        return decodeObject<IMsmOnlineAlterSettings>(tool,
            await this.caller.callTool(tool,
                msmToolArgs.getOnlineAlterSettings(projectPath, table)));
    }

    /**
     * Writes settings of msm.project.json: each one given replaces what is
     * stored as a whole, null drops an optional one, and the rest stay.
     * msm checks them all first, and rewrites the development files'
     * notices for a change of the copyrights or the license.
     *
     * @param projectPath The project folder.
     * @param settings The settings to change.
     *
     * @returns The files written; none where nothing changed.
     */
    public async setProjectSettings(
        projectPath: string,
        settings: IMsmProjectSettings,
    ): Promise<string[]> {
        const tool = "msm.set_project_settings";

        return decodeList<string>(tool, await this.caller.callTool(tool,
            msmToolArgs.setProjectSettings(projectPath, settings)));
    }

    /**
     * @returns msm's online ALTER TABLE limits where nothing sets them,
     *          for a live table, which has no project.
     */
    public async onlineAlterDefaults(): Promise<Required<IOnlineAlterOptions>> {
        const tool = "msm.get_online_alter_defaults";

        return decodeObject<Required<IOnlineAlterOptions>>(tool,
            await this.caller.callTool(tool, {}));
    }

    /**
     * Starts one ALTER TABLE of a live table, run online, as a task (type
     * `msm`, kind `online_alter_table`) that the `task.*` tools follow.
     *
     * @param connectionId The connection's session.
     * @param schema The table's schema.
     * @param table The table.
     * @param spec What follows ``ALTER TABLE `t` ``, without ALGORITHM or
     *             LOCK.
     * @param options The limits; left out, msm's defaults.
     *
     * @returns The task to follow.
     */
    public async onlineAlterTable(
        connectionId: string,
        schema: string,
        table: string,
        spec: string,
        options: IOnlineAlterOptions,
    ): Promise<ITaskStarted> {
        const tool = "msm.online_alter_table";

        return decodeObject<ITaskStarted>(tool, await this.caller.callTool(
            tool, msmToolArgs.onlineAlterTable(connectionId, schema, table,
                spec, options)));
    }

    /**
     * Renames a diagram of a project, in one write, its pictures and all;
     * msm refuses a name another diagram has, in any case.
     *
     * @param projectPath The project folder.
     * @param name The diagram's name.
     * @param newName Its new name.
     *
     * @returns The files written.
     */
    public async renameSchemaDiagram(
        projectPath: string,
        name: string,
        newName: string,
    ): Promise<string[]> {
        const tool = "msm.rename_schema_diagram";

        return decodeList<string>(tool, await this.caller.callTool(tool,
            msmToolArgs.renameSchemaDiagram(projectPath, name, newName)));
    }

    /**
     * Adds an empty diagram to a project, to model on. msm makes the
     * schema snapshot again first where the script changed since, so the
     * diagram's tools edit against the current one.
     *
     * @param projectPath The project folder.
     * @param name The new diagram's name; msm refuses one that is taken.
     *
     * @returns Nothing.
     */
    public async createEmptySchemaDiagram(
        projectPath: string,
        name: string,
    ): Promise<void> {
        const tool = "msm.create_schema_diagram";
        decodeObject<object>(tool, await this.caller.callTool(tool,
            msmToolArgs.createEmptySchemaDiagram(projectPath, name)));
    }

    /**
     * Makes the project's schema snapshot again from its development
     * script, as the diagrams and the MSM Projects view read it.
     *
     * @param projectPath The project folder.
     *
     * @returns Nothing.
     */
    public async updateSchemaDefinition(projectPath: string): Promise<void> {
        const tool = "msm.update_schema_definition";
        decodeObject<object>(tool, await this.caller.callTool(tool,
            msmToolArgs.project(projectPath)));
    }

    /**
     * Changes schema objects in the project's SQL: the CREATE statements
     * are the source of truth, so a rename in a diagram is made there.
     *
     * @param projectPath The project folder.
     * @param edits The edits, in order.
     * @param baseHash The snapshot's `source_hash` they were made against.
     *
     * @returns The diagrams view afterwards, the files written, the
     *          migration kept for the next release and the notes.
     */
    public async editSchema(
        projectPath: string,
        edits: IMsmSchemaEdit[],
        baseHash: string,
    ): Promise<IMsmSchemaEditResult> {
        const name = "msm.edit_schema";
        const result = decodeObject<{
            rows?: IDiagramRow[];
            files?: string[];
            migration?: string[];
            migration_file?: string | null;
            notes?: Array<{ kind?: string; message: string }>;
        }>(name, await this.caller.callTool(name,
            msmToolArgs.editSchema(projectPath, edits, baseHash)));

        return {
            rows: result.rows ?? [],
            files: result.files ?? [],
            migration: result.migration ?? [],
            ...(typeof result.migration_file === "string"
                ? { migrationFile: result.migration_file } : {}),
            notes: result.notes ?? [],
        };
    }
}
