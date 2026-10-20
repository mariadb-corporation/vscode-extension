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
    decodeObject,
    decodeScalar,
    decodeStructured,
    McpToolError,
} from "./protocol.js";

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

/** The `msm.*` tools, as typed calls. */
export interface IMsmApi {
    createProject(options: IMsmCreateOptions): Promise<string>;
    projectInformation(projectPath: string): Promise<IMsmProjectInfo>;
    releasedVersions(projectPath: string): Promise<string[]>;
    deploymentScriptVersions(projectPath: string): Promise<string[]>;
    prepareRelease(options: IMsmReleaseOptions): Promise<string[]>;
    generateDeploymentScript(
        options: IMsmDeploymentScriptOptions): Promise<string>;
    deploySchema(options: IMsmDeployOptions): Promise<string>;
}

/**
 * @param toolName The tool that answered.
 * @param value What it answered: a list of `[major, minor, patch]`.
 *
 * @returns Them as "major.minor.patch", in the order given.
 */
const versionStrings = (toolName: string, value: unknown): string[] => {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new McpToolError(toolName,
            `${toolName} answered with ${JSON.stringify(value)}, not a list.`);
    }

    return value.map((version) => {
        return Array.isArray(version)
            ? version.map((part) => { return String(part); }).join(".")
            : String(version);
    });
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

        return decodeScalar(name, await this.caller.callTool(name, {
            schema_name: options.schemaName,
            target_path: options.targetPath,
            ...(options.copyrightHolder === undefined
                ? {} : { copyright_holder: options.copyrightHolder }),
            ...(options.license === undefined
                ? {} : { license: options.license }),
            ...(options.overwriteExisting === true
                ? { overwrite_existing: true } : {}),
            ...(options.allowSpecialChars === true
                ? { allow_special_chars: true } : {}),
            ...(options.enforceTargetPath === true
                ? { enforce_target_path: true } : {}),
        }));
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
            name, { schema_project_path: projectPath }));
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns The versions released, "1.0.0", oldest first.
     */
    public async releasedVersions(projectPath: string): Promise<string[]> {
        const name = "msm.get_released_versions";

        return versionStrings(name, decodeStructured(name,
            await this.caller.callTool(name,
                { schema_project_path: projectPath })));
    }

    /**
     * @param projectPath The project folder.
     *
     * @returns The versions a deployment script was generated for.
     */
    public async deploymentScriptVersions(
        projectPath: string,
    ): Promise<string[]> {
        const name = "msm.get_deployment_script_versions";

        return versionStrings(name, decodeStructured(name,
            await this.caller.callTool(name,
                { schema_project_path: projectPath })));
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
        const value = decodeStructured(name, await this.caller.callTool(name, {
            schema_project_path: options.projectPath,
            version: options.version,
            next_version: options.nextVersion,
            ...(options.allowToStayOnSameVersion === true
                ? { allow_to_stay_on_same_version: true } : {}),
            ...(options.overwriteExisting === true
                ? { overwrite_existing: true } : {}),
        }));

        return Array.isArray(value)
            ? value.map((file) => { return String(file); }) : [];
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

        return decodeScalar(name, await this.caller.callTool(name, {
            schema_project_path: options.projectPath,
            version: options.version,
            ...(options.overwriteExisting === true
                ? { overwrite_existing: true } : {}),
        }));
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

        return decodeScalar(name, await this.caller.callTool(name, {
            connection_id: options.connectionId,
            schema_project_path: options.projectPath,
            ...(options.version === undefined
                ? {} : { version: options.version }),
            ...(options.backup === true ? { backup: true } : {}),
            ...(options.backupDirectory === undefined
                ? {} : { backup_directory: options.backupDirectory }),
        }, MSM_DEPLOY_TIMEOUT_MS));
    }
}
