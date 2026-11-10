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

import {
    captionProblem,
    isConnectionColor,
} from "../connections/connectionDetails.js";
import type { ConnectionColor } from "../mcp/types.js";
import {
    IMPORTED_KINDS,
    liveObjectsOf,
    type IMsmCopyright,
    type IMsmLiveObject,
    type IMsmLiveSchema,
    type IMsmViewRead,
    type ImportedKind,
    type MsmLiveObjects,
} from "../mcp/msmApi.js";
import {
    type IOnlineAlterEntry,
    type IOnlineAlterOptions,
    type OnlineAlterTexts,
    readTexts,
    textsOf,
} from "../tableEditor/onlineAlter.js";
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
    | "import"
    | "edit"
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

/**
 * A copyright of a project, as msm.project.json has it: who holds it,
 * and the years its notice names (`2024, 2026`).
 */
export interface IMsmCopyrightValues {
    holder: string;
    /** `2024`. */
    yearOfCreation: string;
    /** "" where the notice names the first year alone. */
    yearOfLastUpdate: string;
    /** Whether msm moves the last year on with each year's first change. */
    tracksUpdates: boolean;
}

/** What a dialog is opened on: the project, as the server reads it. */
export interface IMsmProjectContext {
    /** The `<schema>.msm.project` folder. */
    projectPath: string;
    schemaName: string;
    /** A template's name, or {@link CUSTOM_LICENSE}. */
    license: string;
    /** The text of a custom license; "" for none. */
    customLicense: string;
    /** Every copyright, in the order the project lists them. */
    copyrights: IMsmCopyrightValues[];
    currentDevelopmentVersion: string;
    /** "1.0.0", or undefined before the first release. */
    lastReleasedVersion?: string;
    /** Oldest first. */
    releasedVersions: string[];
    /** The versions a deployment script was generated for. */
    deploymentScriptVersions: string[];
    schemaDevelopmentFilePath: string;
}

/**
 * How a project is filed and shown in the MSM Projects list: what New MSM
 * Project and Edit MSM Project both ask for.
 */
export interface IMsmListValues {
    /** The folder of the list: `/` or `/Shop`. */
    folder: string;
    caption: string;
    /** "" for none. */
    color: ConnectionColor | "";
    /** Whether LLMs may work on it through an MCP server without --gui. */
    mcpAccess: boolean;
}

/** What New MSM Project asks for. */
export interface IMsmCreateValues extends IMsmListValues {
    schemaName: string;
    /** The folder the project folder is made in. */
    targetPath: string;
    copyrightHolder: string;
    /** The copyright's first year: `2024`. */
    yearOfCreation: string;
    license: string;
    /** The license's text, where `license` is {@link CUSTOM_LICENSE}. */
    customLicense: string;
    allowSpecialChars: boolean;
    /** Replace a project folder of the same name. */
    overwriteExisting: boolean;
    /** Make the target folder where it does not exist. */
    createTargetPath: boolean;
}

/**
 * What New MSM Project from Schema asks for: a new project's values, the
 * schema name being the live schema's, and the objects to take of it.
 */
export interface IMsmImportValues extends IMsmCreateValues {
    /** The connection the schema is on. */
    connection: string;
    /** The names ticked, by kind; a table's triggers come with it. */
    objects: MsmLiveObjects;
}

/** What Edit MSM Project asks for. */
export interface IMsmEditValues extends IMsmListValues {
    developmentVersion: string;
    license: string;
    /** The license's text, where `license` is {@link CUSTOM_LICENSE}. */
    customLicense: string;
    /** The project's copyrights, the first its main one. */
    copyrights: IMsmCopyrightValues[];
    /**
     * The project's general online ALTER TABLE values (msm.project.json's
     * `onlineAlter`, not its tables'), as typed; a field left empty takes
     * msm's default.
     */
    onlineAlter: OnlineAlterTexts;
}

/**
 * What Edit MSM Project's Online Schema Change tab shows of the project's
 * `onlineAlter` setting.
 */
export interface IMsmOnlineAlterContext {
    /** msm's values, where the project sets none. */
    defaults: Required<IOnlineAlterOptions>;
    /** The project's general values, without the tables'. */
    setting: IOnlineAlterEntry;
    /** The tables with settings of their own, which take precedence. */
    tables: string[];
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
    /** A version with a deployment script; empty only where none has. */
    version: string;
    backup: boolean;
    /** Empty for the project's own `backups` folder. */
    backupDirectory: string;
}

/** The values of each dialog, by its kind. */
export interface IMsmValuesOf {
    create: IMsmCreateValues;
    import: IMsmImportValues;
    edit: IMsmEditValues;
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
    import: "New MSM Project from Schema",
    edit: "Edit MSM Project",
    info: "MSM Project Information",
    release: "Prepare Release",
    deploymentScript: "Generate Deployment Script",
    deploy: "Deploy Schema",
};

/** The suffix that makes a folder a schema project. */
const MSM_PROJECT_SUFFIX = ".msm.project";

/**
 * @param filePath A file saved.
 *
 * @returns The schema project whose development script it is part of
 *          (`development/<schema>_next.sql`, or a section file under
 *          `development/`); nothing for any other file.
 */
export const projectOfScriptFile = (filePath: string): string | undefined => {
    const match = /^(.*\.msm\.project)[\\/]development[\\/].*\.sql$/iu
        .exec(filePath);

    return match?.[1];
};

/**
 * A version, as the plugin takes it: major.minor.patch, without leading
 * zeros - the plugin names a release's files by the text, so `01.0.0`
 * would be a second release of 1.0.0 beside the first.
 */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

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
 * @param fileName A name typed into New MSM Project's file dialog:
 *                 `shop` or `shop.msm.project`.
 *
 * @returns The schema it names: the name without the suffix.
 */
export const schemaNameOfFolder = (fileName: string): string => {
    const name = fileName.trim();

    return name.endsWith(MSM_PROJECT_SUFFIX)
        ? name.slice(0, -MSM_PROJECT_SUFFIX.length) : name;
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

// --- The list's settings -------------------------------------------------

/** What a project not yet listed is filed and shown with. */
export const LIST_DEFAULTS: IMsmListValues = {
    folder: "/",
    caption: "",
    color: "",
    mcpAccess: false,
};

/**
 * @param values How a project is to be filed and shown.
 *
 * @returns The first problem, or undefined where the list takes it.
 */
export const listProblem = (
    values: IMsmListValues,
): IMsmProblem | undefined => {
    const caption = captionProblem(values.caption);
    if (caption !== undefined) {
        return { field: "caption", message: caption };
    }
    if (values.color !== "" && !isConnectionColor(values.color)) {
        return { field: "color", message: "Choose one of the colors." };
    }

    return undefined;
};

// --- Licenses ----------------------------------------------------------

/** msm's name for a license whose text the project holds itself. */
export const CUSTOM_LICENSE = "CUSTOM";

/** The placeholders msm fills in a license's text. */
export const LICENSE_PLACEHOLDERS = ["copyright_notices", "copyright_holder",
    "year"] as const;

/**
 * What a custom license's text starts with: a comment, as every script's
 * header is one, with the copyright notices at its top.
 */
export const CUSTOM_LICENSE_START = "/*\n${copyright_notices}\n *\n"
    + " * The terms the project's scripts are licensed under.\n */";

/**
 * @param text A custom license's text.
 *
 * @returns Why msm would refuse it, or why the scripts would not run with
 *          it: a placeholder msm does not fill (it reads `$name` and
 *          `${name}`, and `$$` as a `$`), or no SQL comment.
 */
export const customLicenseProblem = (text: string): string | undefined => {
    const trimmed = text.trim();
    if (trimmed === "") {
        return "Enter the license's text.";
    }
    // As Python's string.Template reads it.
    for (const match of text.matchAll(
        /\$(?:(\$)|([_a-z][_a-z0-9]*)|\{([_a-z][_a-z0-9]*)\}|)/giu)) {
        const name = match[2] ?? match[3];
        if (match[1] === "$") {
            continue;
        }
        if (name === undefined) {
            return "A $ has to start a placeholder, ${copyright_notices}, "
                + "${copyright_holder} or ${year}; write $$ for a $ itself.";
        }
        if (!(LICENSE_PLACEHOLDERS as readonly string[]).includes(name)) {
            return `msm does not fill \${${name}}: use `
                + "${copyright_notices}, ${copyright_holder} or ${year}.";
        }
    }
    const lines = trimmed.split("\n").filter((line) => {
        return line.trim() !== "";
    });
    const isComment = (trimmed.startsWith("/*") && trimmed.endsWith("*/"))
        || lines.every((line) => { return /^\s*(--|#)/u.test(line); });
    if (!isComment) {
        return "The text goes at the top of every script, so it has to be an "
            + "SQL comment: /* ... */, or lines starting with --.";
    }

    return undefined;
};

/**
 * @param values A dialog's license.
 *
 * @returns Why its custom text is refused, on the text's field.
 */
const licenseProblem = (values: { license: string; customLicense: string },
): IMsmProblem | undefined => {
    if (values.license !== CUSTOM_LICENSE) {
        return undefined;
    }
    const message = customLicenseProblem(values.customLicense);

    return message === undefined ? undefined
        : { field: "customLicense", message };
};

// --- Copyright years ---------------------------------------------------

/** @returns This year, as msm writes it into a notice: `2026`. */
export const currentYear = (): string => {
    return String(new Date().getFullYear());
};

/**
 * @param copyright A copyright.
 *
 * @returns The years its notice names, as msm writes them: `2024, 2026`.
 */
export const copyrightYears = (copyright: IMsmCopyrightValues): string => {
    const first = copyright.yearOfCreation.trim();
    const last = copyright.yearOfLastUpdate.trim();

    return last === "" || last === first ? first : `${first}, ${last}`;
};

/**
 * @param index A copyright's place in the list.
 * @param key One of its values.
 *
 * @returns Its field's name in Edit MSM Project: `copyrights.0.holder`.
 */
export const copyrightField = (index: number,
    key: keyof IMsmCopyrightValues): string => {
    return `copyrights.${index}.${key}`;
};

/**
 * @param text A year field.
 * @param field Its name.
 * @param what What it is, for the message.
 *
 * @returns Why it is no year msm takes: four digits, not in the future.
 */
const yearProblem = (text: string, field: string,
    what: string): IMsmProblem | undefined => {
    const year = text.trim();
    if (!/^\d{4}$/u.test(year)) {
        return { field, message: `Enter the ${what} as four digits: `
            + `${currentYear()}.` };
    }
    if (year > currentYear()) {
        return { field, message: `The ${what} ${year} lies in the future.` };
    }

    return undefined;
};

/**
 * @param copyrights The copyrights of Edit MSM Project.
 *
 * @returns The first that msm would refuse: a holder or year missing, a
 *          year in the future, or a last year before the first.
 */
export const copyrightsProblem = (
    copyrights: IMsmCopyrightValues[],
): IMsmProblem | undefined => {
    if (copyrights.length === 0) {
        return { field: "copyrights",
            message: "A project needs a copyright holder. Add one." };
    }
    for (const [index, copyright] of copyrights.entries()) {
        const field = (name: keyof IMsmCopyrightValues): string => {
            return copyrightField(index, name);
        };
        if (copyright.holder.trim() === "") {
            return { field: field("holder"),
                message: "Enter the copyright holder." };
        }
        const problem = yearProblem(copyright.yearOfCreation,
            field("yearOfCreation"), "first year")
            ?? (copyright.yearOfLastUpdate.trim() === "" ? undefined
                : yearProblem(copyright.yearOfLastUpdate,
                    field("yearOfLastUpdate"), "last year"));
        if (problem !== undefined) {
            return problem;
        }
        const first = copyright.yearOfCreation.trim();
        const last = copyright.yearOfLastUpdate.trim();
        if (last !== "" && last < first) {
            return { field: field("yearOfLastUpdate"),
                message: `The last year cannot be before the first, ${first}.` };
        }
    }

    return undefined;
};

/**
 * @param copyrights Copyrights as typed.
 *
 * @returns Them as msm.project.json has them: trimmed, a last year left
 *          out where there is none.
 */
export const storedCopyrights = (copyrights: IMsmCopyrightValues[],
): IMsmCopyright[] => {
    return copyrights.map((copyright) => {
        const last = copyright.yearOfLastUpdate.trim();

        return {
            holder: copyright.holder.trim(),
            yearOfCreation: copyright.yearOfCreation.trim(),
            ...(last === "" ? {} : { yearOfLastUpdate: last }),
            tracksUpdates: copyright.tracksUpdates,
        };
    });
};

// --- New MSM Project ---------------------------------------------------

/**
 * @param folder The folder the project is created in.
 * @param schemaName The schema, where the file dialog named it.
 * @param list How the new project is filed in the MSM Projects list.
 *
 * @returns What New MSM Project starts with.
 */
export const createDefaults = (
    folder: string,
    schemaName = "",
    list: Partial<IMsmListValues> = {},
): IMsmCreateValues => {
    return {
        ...LIST_DEFAULTS,
        ...list,
        schemaName,
        targetPath: folder,
        copyrightHolder: "",
        yearOfCreation: currentYear(),
        license: "None",
        customLicense: CUSTOM_LICENSE_START,
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
    // In the order of the wizard's pages (Project, Location, MSM Projects
    // View), so the first problem is never on a page after one that has a
    // problem too: Next goes on while the first problem is further on.
    if (values.copyrightHolder.trim() === "") {
        return {
            field: "copyrightHolder",
            message: "Enter the copyright holder: your name, or your "
                + "company's.",
        };
    }
    const year = yearProblem(values.yearOfCreation, "yearOfCreation",
        "year of creation") ?? licenseProblem(values);
    if (year !== undefined) {
        return year;
    }
    if (values.targetPath.trim() === "") {
        return {
            field: "targetPath",
            message: "Choose the folder to create the project in.",
        };
    }

    return listProblem(values);
};

// --- New MSM Project from Schema --------------------------------------

/**
 * @param live The schema, as msm lists it.
 * @param kind A kind an import is told about.
 *
 * @returns The names of its objects of that kind, in the listing's order.
 */
export const liveNamesOf = (
    live: IMsmLiveSchema,
    kind: ImportedKind,
): string[] => {
    return liveObjectsOf(live, kind).map((item) => { return item.name; });
};

/**
 * @param live The schema, as msm lists it.
 *
 * @returns Every object an import can be told to take of it, by kind.
 */
export const liveObjectNames = (
    live: IMsmLiveSchema,
): MsmLiveObjects => {
    return Object.fromEntries(IMPORTED_KINDS.map((kind) => {
        return [kind, liveNamesOf(live, kind)];
    })) as MsmLiveObjects;
};

/**
 * @param live The schema, as msm lists it.
 * @param objects The names ticked.
 * @param kind A kind.
 *
 * @returns Whether every object of that kind is ticked: the ticked are
 *          always some of the listing's, once each.
 */
export const allTicked = (
    live: IMsmLiveSchema,
    objects: MsmLiveObjects,
    kind: ImportedKind,
): boolean => {
    return objects[kind].length === live[kind].length;
};

/**
 * @param connection The connection the schema is on.
 * @param live The schema, as msm lists it.
 * @param folder The folder the project is created in.
 * @param list How the new project is filed in the MSM Projects list.
 *
 * @returns What New MSM Project from Schema starts with: every object
 *          ticked, and the schema's own name, which msm takes as it is.
 */
export const importDefaults = (
    connection: string,
    live: IMsmLiveSchema,
    folder: string,
    list: Partial<IMsmListValues> = {},
): IMsmImportValues => {
    return {
        ...createDefaults(folder, live.schema, list),
        allowSpecialChars: true,
        connection,
        objects: liveObjectNames(live),
    };
};

/**
 * @param live The schema, as msm lists it.
 * @param objects The names ticked.
 * @param kind The kind of the one ticked or unticked, or of all of a kind.
 * @param names Their names.
 * @param on Ticked, or not.
 *
 * @returns The names ticked then, in the listing's order.
 */
export const tickedObjects = (
    live: IMsmLiveSchema,
    objects: MsmLiveObjects,
    kind: ImportedKind,
    names: readonly string[],
    on: boolean,
): MsmLiveObjects => {
    const set = new Set(objects[kind]);
    for (const name of names) {
        if (on) {
            set.add(name);
        } else {
            set.delete(name);
        }
    }

    return {
        ...objects,
        [kind]: liveNamesOf(live, kind).filter((name) => {
            return set.has(name);
        }),
    };
};

/**
 * @param objects The names ticked.
 * @param view A view of the schema, as msm lists it.
 *
 * @returns What of the schema the view reads that is not ticked, in the
 *          listing's order (kind, then name): the project would not deploy
 *          the view without it. Nothing for a view not ticked itself, or
 *          whose reads msm could not tell.
 */
export const unticked = (
    objects: MsmLiveObjects,
    view: IMsmLiveObject,
): IMsmViewRead[] => {
    if (!objects.views.includes(view.name)) {
        return [];
    }

    return (view.reads ?? []).filter((read) => {
        return !objects[read.kind].includes(read.name);
    });
};

/**
 * @param live The schema, as msm lists it.
 * @param objects The names ticked.
 *
 * @returns What `msm.import_live_schema` is sent: nothing where every
 *          object is ticked, so msm takes them all, those made meanwhile
 *          too; else every kind, one with none ticked as an empty list.
 *          Never triggers: the tables bring theirs.
 */
export const importedObjects = (
    live: IMsmLiveSchema,
    objects: MsmLiveObjects,
): MsmLiveObjects | undefined => {
    const everything = IMPORTED_KINDS.every((kind) => {
        return allTicked(live, objects, kind);
    });

    return everything ? undefined : { ...objects };
};

/**
 * @param values What New MSM Project from Schema says.
 *
 * @returns The first problem, or undefined where it can be imported.
 */
export const importProblem = (
    values: IMsmImportValues,
): IMsmProblem | undefined => {
    const none = IMPORTED_KINDS.every((kind) => {
        return values.objects[kind].length === 0;
    });
    if (none) {
        return {
            field: "objects",
            message: "Tick the objects to import. For an empty project, use "
                + "New MSM Project.",
        };
    }

    return createProblem(values);
};

// --- Edit MSM Project --------------------------------------------------

/**
 * @param project The project, as read.
 * @param listed How it is filed and shown in the list.
 *
 * @returns What Edit MSM Project starts with.
 */
export const editDefaults = (
    project: IMsmProjectContext,
    listed: IMsmListValues,
    onlineAlter: IOnlineAlterEntry = {},
): IMsmEditValues => {
    return {
        ...listed,
        developmentVersion: project.currentDevelopmentVersion,
        license: project.license,
        customLicense: project.customLicense === ""
            ? CUSTOM_LICENSE_START : project.customLicense,
        copyrights: project.copyrights.map((copyright) => {
            return { ...copyright };
        }),
        onlineAlter: textsOf(onlineAlter),
    };
};

/**
 * @param key An online ALTER TABLE value.
 *
 * @returns Its field's name in Edit MSM Project.
 */
export const onlineAlterField = (key: keyof OnlineAlterTexts): string => {
    return `onlineAlter.${key}`;
};

/**
 * @param texts The Online Schema Change tab's fields.
 *
 * @returns The first that is no value, as msm would refuse it.
 */
export const onlineAlterProblem = (
    texts: OnlineAlterTexts,
): IMsmProblem | undefined => {
    const [first] = readTexts(texts).problems;

    return first === undefined ? undefined
        : { field: onlineAlterField(first.key), message: first.message };
};

/**
 * @param project The project.
 * @param values What Edit MSM Project says.
 *
 * @returns The first problem, or undefined where it can be updated.
 */
export const editProblem = (
    project: IMsmProjectContext,
    values: IMsmEditValues,
): IMsmProblem | undefined => {
    const problem = versionProblem(values.developmentVersion,
        "developmentVersion", "development version");
    if (problem !== undefined) {
        return problem;
    }
    const last = project.lastReleasedVersion;
    if (last !== undefined
        && compareVersions(values.developmentVersion, last) < 0) {
        return {
            field: "developmentVersion",
            message: "The development version cannot be lower than the last "
                + `released one, ${last}.`,
        };
    }

    // In the order of the tabs.
    return licenseProblem(values) ?? copyrightsProblem(values.copyrights)
        ?? listProblem(values)
        ?? onlineAlterProblem(values.onlineAlter);
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
    if (!project.deploymentScriptVersions.includes(values.version)) {
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
    if (kind === "import") {
        return importProblem(values as IMsmImportValues);
    }
    if (kind === "info") {
        return undefined;
    }
    if (project === undefined) {
        return { message: "The project could not be read." };
    }

    switch (kind) {
        case "edit": {
            return editProblem(project, values as IMsmEditValues);
        }

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
