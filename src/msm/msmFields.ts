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

import { compareVersions, newestFirst } from "../versionOrder.js";

/**
 * The MariaDB Schema Management dialogs' fields: what each starts with,
 * what it refuses and why. Pure, so the dialog checks as the user types
 * and the extension checks the same again before calling the server.
 *
 * The rules are the msm plugin's own (`msm_plugin/lib/management.py`),
 * checked here so that a dialog says what is wrong beside the field
 * rather than after a round trip. The schema name is checked here too: a
 * plugin older than mariadb-shell-plugins #67 has its own check inverted -
 * it checks only where special characters are allowed - and accepts a
 * name of digits only.
 */

/** The dialogs, by what they do. */
export type MsmDialogKind =
    | "create"
    | "info"
    | "release"
    | "deploymentScript"
    | "deploy";

/** A connection a schema can be deployed onto. */
export interface IMsmConnectionChoice {
    /** Its URI, which is what is sent back. */
    uri: string;
    /** The address, without the scheme. */
    label: string;
}

/** What a dialog is opened on: the project, as the server reads it. */
export interface IMsmProjectContext {
    /** The `<schema>.msm.project` folder. */
    projectPath: string;
    schemaName: string;
    license: string;
    /** Every copyright holder, in the order the project lists them. */
    copyrightHolders: string[];
    currentDevelopmentVersion: string;
    /** "1.0.0", or undefined before the first release. */
    lastReleasedVersion?: string;
    /** Oldest first. */
    releasedVersions: string[];
    /** The versions a deployment script was generated for. */
    deploymentScriptVersions: string[];
    schemaDevelopmentFilePath: string;
}

/** What New MSM Project asks for. */
export interface IMsmCreateValues {
    schemaName: string;
    /** The folder the project folder is made in. */
    targetPath: string;
    copyrightHolder: string;
    license: string;
    allowSpecialChars: boolean;
    /** Replace a project folder of the same name. */
    overwriteExisting: boolean;
    /** Make the target folder where it does not exist. */
    createTargetPath: boolean;
}

/** What Prepare Release asks for. */
export interface IMsmReleaseValues {
    version: string;
    nextVersion: string;
    allowToStayOnSameVersion: boolean;
    overwriteExisting: boolean;
}

/** What Generate Deployment Script asks for. */
export interface IMsmDeploymentScriptValues {
    version: string;
    overwriteExisting: boolean;
}

/** What Deploy Schema asks for. */
export interface IMsmDeployValues {
    /** The connection's URI; empty until one is picked. */
    connection: string;
    /** Empty for the newest version with a deployment script. */
    version: string;
    backup: boolean;
    /** Empty for the project's own `backups` folder. */
    backupDirectory: string;
}

/** The values of each dialog, by its kind. */
export interface IMsmValuesOf {
    create: IMsmCreateValues;
    info: Record<string, never>;
    release: IMsmReleaseValues;
    deploymentScript: IMsmDeploymentScriptValues;
    deploy: IMsmDeployValues;
}

export type MsmValues = IMsmValuesOf[MsmDialogKind];

/** A field the dialog marks, and why. */
export interface IMsmProblem {
    /** The field's name, or undefined for the dialog as a whole. */
    field?: string;
    message: string;
}

/** What the dialogs are called, as their tab titles and headers. */
export const MSM_TITLES: Record<MsmDialogKind, string> = {
    create: "New MSM Project",
    info: "MSM Project Information",
    release: "Prepare Release",
    deploymentScript: "Generate Deployment Script",
    deploy: "Deploy Schema",
};

/** The suffix that makes a folder a schema project. */
const MSM_PROJECT_SUFFIX = ".msm.project";

/** A version, as the plugin takes it: major.minor.patch. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

/** A schema name usable without quotes. */
const PLAIN_SCHEMA_NAME = /^[A-Za-z0-9_][A-Za-z0-9_$]*$/u;

/** Characters no file name may hold, as the plugin strips them. */
const NOT_IN_A_FILE_NAME = /[\\/:*?"<>|]/gu;

/**
 * @param version "1.2.3".
 *
 * @returns Its numbers, or undefined where it is not major.minor.patch.
 */
export const parseVersion = (
    version: string,
): [number, number, number] | undefined => {
    const match = VERSION.exec(version.trim());

    return match === null ? undefined
        : [Number(match[1]), Number(match[2]), Number(match[3])];
};

export { compareVersions, newestFirst };

/**
 * @param version "1.2.3".
 *
 * @returns The version after it, its patch counted up: "1.2.4". What is
 *          not a version is returned as it is.
 */
export const nextPatchVersion = (version: string): string => {
    const parts = parseVersion(version);

    return parts === undefined ? version
        : `${String(parts[0])}.${String(parts[1])}.${String(parts[2] + 1)}`;
};

/**
 * @param schemaName The schema.
 *
 * @returns The project folder's name, as the plugin makes it: spaces as
 *          underscores, characters no file name may hold left out.
 */
export const projectFolderName = (schemaName: string): string => {
    return schemaName.trim().replace(/\s+/gu, "_")
        .replace(NOT_IN_A_FILE_NAME, "") + MSM_PROJECT_SUFFIX;
};

/**
 * @param path A folder's path.
 *
 * @returns Whether it is a schema project folder, by its name.
 */
export const isProjectFolder = (path: string): boolean => {
    return path.replace(/[\\/]+$/u, "").endsWith(MSM_PROJECT_SUFFIX);
};

/**
 * @param version What a version field holds.
 * @param field Its name.
 * @param what What it is, for the message: "release version".
 *
 * @returns Why it is not a version, or undefined where it is one.
 */
const versionProblem = (
    version: string,
    field: string,
    what: string,
): IMsmProblem | undefined => {
    if (version.trim() === "") {
        return { field, message: `Enter the ${what}.` };
    }
    if (parseVersion(version) === undefined) {
        return {
            field,
            message: `The ${what} has to be major.minor.patch, `
                + "such as 1.0.0.",
        };
    }

    return undefined;
};

// --- New MSM Project ---------------------------------------------------

/**
 * @param folder The folder the project is created in.
 *
 * @returns What New MSM Project starts with.
 */
export const createDefaults = (folder: string): IMsmCreateValues => {
    return {
        schemaName: "",
        targetPath: folder,
        copyrightHolder: "",
        license: "None",
        allowSpecialChars: false,
        overwriteExisting: false,
        createTargetPath: false,
    };
};

/**
 * @param values What New MSM Project says.
 *
 * @returns The first problem, or undefined where it can be created.
 */
export const createProblem = (
    values: IMsmCreateValues,
): IMsmProblem | undefined => {
    const name = values.schemaName.trim();
    if (name === "") {
        return { field: "schemaName", message: "Enter the schema's name." };
    }
    if (!values.allowSpecialChars) {
        if (!PLAIN_SCHEMA_NAME.test(name)) {
            return {
                field: "schemaName",
                message: "Only basic Latin letters, digits, dollar and "
                    + "underscore can be used, and it cannot start with a "
                    + "dollar. Tick Allow Special Characters to use others.",
            };
        }
        if (/^\d+$/u.test(name)) {
            return {
                field: "schemaName",
                message: "A schema name cannot be digits only. Tick Allow "
                    + "Special Characters to use it anyway.",
            };
        }
    }
    if (name.length > 64) {
        return {
            field: "schemaName",
            message: "A schema name can be 64 characters at most.",
        };
    }
    if (projectFolderName(name) === MSM_PROJECT_SUFFIX) {
        return {
            field: "schemaName",
            message: "The name leaves nothing to name the project folder by.",
        };
    }
    if (values.targetPath.trim() === "") {
        return {
            field: "targetPath",
            message: "Choose the folder to create the project in.",
        };
    }
    if (values.copyrightHolder.trim() === "") {
        return {
            field: "copyrightHolder",
            message: "Enter the copyright holder: your name, or your "
                + "company's.",
        };
    }

    return undefined;
};

// --- Prepare Release ---------------------------------------------------

/**
 * @param project The project.
 *
 * @returns What Prepare Release starts with: the development version,
 *          and the one after it to go on with.
 */
export const releaseDefaults = (
    project: IMsmProjectContext,
): IMsmReleaseValues => {
    const version = project.currentDevelopmentVersion;

    return {
        version,
        nextVersion: nextPatchVersion(version),
        allowToStayOnSameVersion: false,
        overwriteExisting: false,
    };
};

/**
 * @param project The project.
 * @param values What Prepare Release says.
 *
 * @returns The first problem, or undefined where it can be released.
 */
export const releaseProblem = (
    project: IMsmProjectContext,
    values: IMsmReleaseValues,
): IMsmProblem | undefined => {
    const problem = versionProblem(values.version, "version",
        "release version")
        ?? versionProblem(values.nextVersion, "nextVersion",
            "next development version");
    if (problem !== undefined) {
        return problem;
    }

    const last = project.lastReleasedVersion;
    if (last !== undefined && compareVersions(values.version, last) < 0) {
        return {
            field: "version",
            message: `The version cannot be lower than the last released `
                + `one, ${last}.`,
        };
    }

    const order = compareVersions(values.nextVersion, values.version);
    if (order < 0) {
        return {
            field: "nextVersion",
            message: "The next development version cannot be lower than the "
                + "version released.",
        };
    }
    if (order === 0 && !values.allowToStayOnSameVersion) {
        return {
            field: "nextVersion",
            message: "The next development version has to be higher than the "
                + "version released. Tick Stay on the Same Version to go on "
                + "developing it.",
        };
    }

    if (project.releasedVersions.includes(values.version.trim())
        && !values.overwriteExisting) {
        return {
            field: "overwriteExisting",
            message: `Version ${values.version.trim()} has been released `
                + "already. Tick Replace Existing Files to release it again.",
        };
    }

    return undefined;
};

// --- Generate Deployment Script -----------------------------------------

/**
 * @param project The project.
 *
 * @returns What Generate Deployment Script starts with: the newest
 *          release.
 */
export const deploymentScriptDefaults = (
    project: IMsmProjectContext,
): IMsmDeploymentScriptValues => {
    return {
        version: newestFirst(project.releasedVersions)[0] ?? "",
        overwriteExisting: false,
    };
};

/**
 * @param project The project.
 * @param values What Generate Deployment Script says.
 *
 * @returns The first problem, or undefined where it can be generated.
 */
export const deploymentScriptProblem = (
    project: IMsmProjectContext,
    values: IMsmDeploymentScriptValues,
): IMsmProblem | undefined => {
    if (project.releasedVersions.length === 0) {
        return {
            message: "No version has been released yet. Prepare a release "
                + "first.",
        };
    }
    if (!project.releasedVersions.includes(values.version)) {
        return {
            field: "version",
            message: "Choose a released version.",
        };
    }
    if (project.deploymentScriptVersions.includes(values.version)
        && !values.overwriteExisting) {
        return {
            field: "overwriteExisting",
            message: `There is a deployment script for ${values.version} `
                + "already. Tick Replace Existing File to generate it again.",
        };
    }

    return undefined;
};

// --- Deploy Schema -----------------------------------------------------

/**
 * @param project The project.
 * @param connections The connections it can be deployed onto.
 * @param preferred The connection to start on where it is listed: the
 *                  default connection.
 *
 * @returns What Deploy Schema starts with: the newest deployment script.
 */
export const deployDefaults = (
    project: IMsmProjectContext,
    connections: readonly IMsmConnectionChoice[],
    preferred?: string,
): IMsmDeployValues => {
    const listed = connections.some((choice) => {
        return choice.uri === preferred;
    });

    return {
        connection: listed ? preferred ?? ""
            : connections.length === 1 ? connections[0].uri : "",
        version: newestFirst(project.deploymentScriptVersions)[0] ?? "",
        backup: true,
        backupDirectory: "",
    };
};

/**
 * @param project The project.
 * @param values What Deploy Schema says.
 *
 * @returns The first problem, or undefined where it can be deployed.
 */
export const deployProblem = (
    project: IMsmProjectContext,
    values: IMsmDeployValues,
): IMsmProblem | undefined => {
    if (project.deploymentScriptVersions.length === 0) {
        return {
            message: "There is no deployment script yet. Generate one for "
                + "a released version first.",
        };
    }
    if (values.connection === "") {
        return {
            field: "connection",
            message: "Choose the connection to deploy onto.",
        };
    }
    if (values.version !== ""
        && !project.deploymentScriptVersions.includes(values.version)) {
        return {
            field: "version",
            message: "Choose a version with a deployment script.",
        };
    }

    return undefined;
};

/**
 * @param kind The dialog.
 * @param project The project, for all but New MSM Project.
 * @param values What it says.
 *
 * @returns Its first problem, or undefined where it can go ahead.
 */
export const msmProblem = (
    kind: MsmDialogKind,
    project: IMsmProjectContext | undefined,
    values: MsmValues,
): IMsmProblem | undefined => {
    if (kind === "create") {
        return createProblem(values as IMsmCreateValues);
    }
    if (kind === "info") {
        return undefined;
    }
    if (project === undefined) {
        return { message: "The project could not be read." };
    }

    switch (kind) {
        case "release": {
            return releaseProblem(project, values as IMsmReleaseValues);
        }

        case "deploymentScript": {
            return deploymentScriptProblem(project,
                values as IMsmDeploymentScriptValues);
        }

        default: {
            return deployProblem(project, values as IMsmDeployValues);
        }
    }
};
