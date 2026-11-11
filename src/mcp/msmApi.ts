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
 * The kinds an import is told which to take of: not triggers, which come
 * with their table.
 */
export const IMPORTED_KINDS = ["tables", "sequences", "views", "procedures",
    "functions", "events"] as const;

export type ImportedKind = typeof IMPORTED_KINDS[number];

/** An object of a live schema, as the listing has it. */
export interface IMsmLiveObject {
    name: string;
    /** A table's or a view's. */
    comment?: string;
    /** A table's, which come with it. */
    triggers?: string[];
    /** A view's sources, see {@link IMsmViewRead}. */
    reads?: IMsmViewRead[] | null;
}

/**
 * An object of the schema a view reads, or calls: a table, a view, a
 * sequence or a stored function, by the listing's key for its kind.
 */
export interface IMsmViewRead {
    kind: ImportedKind;
    name: string;
}

/**
 * A schema on a server, as `msm.list_live_schema_objects` lists what
 * `msm.import_live_schema` can take of it; each list sorted by name.
 */
export interface IMsmLiveSchema {
    schema: string;
    tables: Array<{ name: string; comment: string; triggers: string[] }>;
    /**
     * Each view's `reads`: what of the schema it reads, sorted; null
     * where msm could not read its definition (no SHOW VIEW), left out
     * by an msm before mariadb-shell-plugins #104.
     */
    views: Array<{ name: string; comment: string;
        reads?: IMsmViewRead[] | null; }>;
    procedures: Array<{ name: string }>;
    functions: Array<{ name: string }>;
    triggers: Array<{ name: string; table: string }>;
    events: Array<{ name: string }>;
    sequences: Array<{ name: string }>;
    /** The version msm deployed of it, "1.0.0", or null for none. */
    schema_version: string | null;
    /** msm's own objects (its version view, `msm_*` routines), never taken. */
    left_out: string[];
}

/**
 * @param live A schema, as msm lists it.
 * @param kind A kind an import is told about.
 *
 * @returns Its objects of that kind.
 */
export const liveObjectsOf = (
    live: IMsmLiveSchema,
    kind: ImportedKind,
): readonly IMsmLiveObject[] => {
    return live[kind];
};

/** The names of each kind to import. The tables bring their triggers. */
export type MsmLiveObjects = Record<ImportedKind, string[]>;

/** What `msm.import_live_schema` is told: a new project's, and the source. */
export interface IMsmImportOptions extends Omit<IMsmCreateOptions,
    "schemaName" | "allowSpecialChars"> {
    /** The session `db.connect` opened. */
    connectionId: string;
    /** The schema on the server; the project gets its name. */
    schema: string;
    /** Left out, every object, those made meanwhile too. */
    objects?: MsmLiveObjects;
}

/** What an `import_live_schema` task ends with. */
export interface IMsmImportResult {
    project_path: string;
    schema: string;
    tables: number;
    sequences: number;
    views: number;
    routines: number;
    triggers: number;
    events: number;
    schema_version: string | null;
    /**
     * What was left out, and why: a foreign key, an unreadable view; none
     * where it is not there.
     */
    warnings?: string[];
    files: string[];
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
    /**
     * The last version it released; undefined where it has none, or the
     * shell does not say (read as none).
     */
    lastReleasedVersion?: string;
}

/** Why msm will not rename a project's schema. */
export type SchemaRenameRefusal = "released" | "invalid-name" | "same-name"
    | "folder-exists" | "lsp-missing" | "restricted";

/**
 * What `msm.rename_schema` answers, the same for a dry run (what it would
 * do) and a rename (what it did).
 */
export interface IMsmSchemaRename {
    allowed: boolean;
    /** Why not, where not allowed. */
    reason?: SchemaRenameRefusal | string;
    /** msm's words for it. */
    message?: string;
    /** Where the project is, or will be: its folder may move. */
    projectPath: string;
    previousProjectPath: string;
    /** The files written, or that would be, under the new folder. */
    files: string[];
    /**
     * The statements that move deployed databases to the new name: none
     * while only unreleased projects can be renamed.
     */
    migration: string[];
    /** What msm leaves to the user: dependents, dynamic SQL, dev servers. */
    warnings: string[];
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

/** What `msm.layout_schema_diagram` did. */
export interface IMsmDiagramLayout {
    name: string;
    /** The figures laid out, by what they show. */
    placed: string[];
    connections_added: number;
    files: string[];
}

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

/**
 * The kinds of schema object msm adds from a SQL template
 * (`msm.add_schema_object`); a table is made with the table editor.
 */
export const MSM_OBJECT_KINDS = ["view", "procedure", "function", "trigger",
    "event", "sequence"] as const;

export type MsmObjectKind = typeof MSM_OBJECT_KINDS[number];

/** What `msm.get_object_templates` answers with. */
export interface IMsmObjectTemplates {
    /**
     * Each kind's default: a plain CREATE statement with string.Template
     * placeholders (`${name}`, a trigger's `${table}`).
     */
    templates: Record<MsmObjectKind, string>;
    /** The placeholders each kind's template may use. */
    placeholders: Record<MsmObjectKind, string[]>;
}

/** What a new schema object is made of. */
export interface IMsmNewObject {
    kind: MsmObjectKind;
    name: string;
    /** The user's template; left out, msm's default. */
    template?: string;
    /** A trigger's table. */
    table?: string;
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

/** What `msm.add_schema_object` answers with. */
export interface IMsmObjectAdded extends IMsmSchemaEditResult {
    /** The file the new statement is in, and the line it starts on (1-based). */
    file: string;
    line: number;
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
    listLiveSchemaObjects(connectionId: string,
        schema: string): Promise<IMsmLiveSchema>;
    importLiveSchema(options: IMsmImportOptions): Promise<ITaskStarted>;
    layoutSchemaDiagram(projectPath: string,
        name: string): Promise<IMsmDiagramLayout>;
    renameSchemaDiagram(projectPath: string, name: string,
        newName: string): Promise<string[]>;
    renameSchema(projectPath: string, newName: string | undefined,
        dryRun: boolean): Promise<IMsmSchemaRename>;
    updateSchemaDefinition(projectPath: string): Promise<void>;
    editSchema(projectPath: string, edits: IMsmSchemaEdit[],
        baseHash: string): Promise<IMsmSchemaEditResult>;
    getObjectTemplates(): Promise<IMsmObjectTemplates>;
    addSchemaObject(projectPath: string, object: IMsmNewObject,
        baseHash: string): Promise<IMsmObjectAdded>;
}

/** `msm.edit_schema`'s answer, by the server's names. */
interface IEditResultOnTheWire {
    rows?: IDiagramRow[];
    files?: string[];
    migration?: string[];
    migration_file?: string | null;
    notes?: Array<{ kind?: string; message: string }>;
}

/**
 * @param result What msm.edit_schema, or msm.add_schema_object, said.
 *
 * @returns It as the extension reads it, every list there.
 */
const editResultOf = (result: IEditResultOnTheWire): IMsmSchemaEditResult => {
    return {
        rows: result.rows ?? [],
        files: result.files ?? [],
        migration: result.migration ?? [],
        ...(typeof result.migration_file === "string"
            ? { migrationFile: result.migration_file } : {}),
        notes: result.notes ?? [],
    };
};

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
    last_released_version?: string | null;
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
        // An older shell leaves it out: read as no release.
        ...(typeof listed.last_released_version === "string"
            ? { lastReleasedVersion: listed.last_released_version } : {}),
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
 * @param options A new project's, of msm.create_project or
 *                msm.import_live_schema.
 *
 * @returns The arguments both tools take for it, by the server's names.
 */
const newProjectArgs = (
    options: Omit<IMsmCreateOptions, "schemaName" | "allowSpecialChars">,
): Record<string, unknown> => {
    return {
        target_path: options.targetPath,
        copyright_holder: options.copyrightHolder,
        license: options.license,
        overwrite_existing: options.overwriteExisting,
        enforce_target_path: options.enforceTargetPath,
        year_of_creation: options.yearOfCreation,
        mcp_access: options.mcpAccess,
        folder: options.folder,
        caption: options.caption,
        color: options.color,
    };
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
            allow_special_chars: options.allowSpecialChars,
            ...newProjectArgs(options),
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
    listLiveSchemaObjects: (
        connectionId: string,
        schema: string,
    ): Record<string, unknown> => {
        return { connection_id: connectionId, schema };
    },
    importLiveSchema: (options: IMsmImportOptions): Record<string, unknown> => {
        return given({
            connection_id: options.connectionId,
            schema: options.schema,
            objects: options.objects,
            ...newProjectArgs(options),
        });
    },
    layoutSchemaDiagram: (
        projectPath: string,
        name: string,
    ): Record<string, unknown> => {
        // Every figure laid out again, not only the unplaced.
        return { name, keep_placed: false, schema_project_path: projectPath };
    },
    renameSchemaDiagram: (
        projectPath: string,
        name: string,
        newName: string,
    ): Record<string, unknown> => {
        return { name, new_name: newName, schema_project_path: projectPath };
    },
    renameSchema: (
        projectPath: string,
        newName: string | undefined,
        dryRun: boolean,
    ): Record<string, unknown> => {
        // A dry run without a name checks what does not depend on one.
        return { schema_project_path: projectPath,
            ...(newName === undefined ? {} : { new_schema_name: newName }),
            dry_run: dryRun };
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
    addSchemaObject: (
        projectPath: string,
        object: IMsmNewObject,
        baseHash: string,
    ): Record<string, unknown> => {
        return given({
            schema_project_path: projectPath,
            kind: object.kind,
            name: object.name,
            base_hash: baseHash,
            template: object.template,
            table: object.table,
        });
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
     * Lists what of a schema on a server an import can take.
     *
     * @param connectionId The connection's session.
     * @param schema The schema.
     *
     * @returns Its objects by kind, and msm's own, which are left out.
     */
    public async listLiveSchemaObjects(
        connectionId: string,
        schema: string,
    ): Promise<IMsmLiveSchema> {
        const tool = "msm.list_live_schema_objects";

        return decodeObject<IMsmLiveSchema>(tool, await this.caller.callTool(
            tool, msmToolArgs.listLiveSchemaObjects(connectionId, schema)));
    }

    /**
     * Starts making a project from a schema on a server, as a task (type
     * `msm`, kind `import_live_schema`) that the `task.*` tools follow.
     * What would refuse it (the folder, the license, the selection) refuses
     * this call, before a task starts.
     *
     * @param options The source and the new project.
     *
     * @returns The task to follow; it ends with an {@link IMsmImportResult}.
     */
    public async importLiveSchema(
        options: IMsmImportOptions,
    ): Promise<ITaskStarted> {
        const tool = "msm.import_live_schema";

        return decodeObject<ITaskStarted>(tool, await this.caller.callTool(
            tool, msmToolArgs.importLiveSchema(options)));
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
    /**
     * Lays a diagram of a project out again: every table, view, sequence
     * and group figure; figures on a layer, notes and images keep their
     * place. Foreign keys not drawn get a connection.
     *
     * @param projectPath The project folder.
     * @param name The diagram.
     *
     * @returns What msm placed, and the files it wrote.
     */
    public async layoutSchemaDiagram(
        projectPath: string,
        name: string,
    ): Promise<IMsmDiagramLayout> {
        const tool = "msm.layout_schema_diagram";

        return decodeObject<IMsmDiagramLayout>(tool, await this.caller.callTool(
            tool, msmToolArgs.layoutSchemaDiagram(projectPath, name)));
    }

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
     * Renames a project's schema, or, as a dry run, says whether it can and
     * what it would change. msm refuses a project with a release; a refused
     * dry run answers why (`reason`), a refused rename throws.
     *
     * @param projectPath The project folder.
     * @param newName The schema's new name; left out of a dry run, what
     *                does not depend on it is checked (a release, MCP
     *                access, mariadb-lsp's `rename_schema`).
     * @param dryRun Whether only to ask.
     *
     * @returns msm's answer.
     */
    public async renameSchema(
        projectPath: string,
        newName: string | undefined,
        dryRun: boolean,
    ): Promise<IMsmSchemaRename> {
        const tool = "msm.rename_schema";
        const answer = decodeObject<{
            allowed?: boolean;
            reason?: string | null;
            message?: string | null;
            project_path?: string;
            previous_project_path?: string;
            files?: string[];
            migration?: string[];
            warnings?: string[];
        }>(tool, await this.caller.callTool(tool,
            msmToolArgs.renameSchema(projectPath, newName, dryRun)));

        return {
            allowed: answer.allowed === true,
            ...(answer.reason ? { reason: answer.reason } : {}),
            ...(answer.message ? { message: answer.message } : {}),
            projectPath: answer.project_path ?? projectPath,
            previousProjectPath: answer.previous_project_path ?? projectPath,
            files: answer.files ?? [],
            migration: answer.migration ?? [],
            warnings: answer.warnings ?? [],
        };
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

        return editResultOf(decodeObject<IEditResultOnTheWire>(name,
            await this.caller.callTool(name,
                msmToolArgs.editSchema(projectPath, edits, baseHash))));
    }

    /**
     * @returns msm's default template of each kind of schema object it
     *          adds, and the placeholders each may use.
     */
    public async getObjectTemplates(): Promise<IMsmObjectTemplates> {
        const tool = "msm.get_object_templates";

        return decodeObject<IMsmObjectTemplates>(tool,
            await this.caller.callTool(tool, {}));
    }

    /**
     * Adds a view, routine, trigger, event or sequence to the project from
     * a SQL template filled with its name, where msm keeps that kind (its
     * section, or the section's breakout file), as an edit of the schema.
     *
     * @param projectPath The project folder.
     * @param object What to add.
     * @param baseHash The snapshot's `source_hash` it was named against.
     *
     * @returns The edit's result, and where the new statement is.
     */
    public async addSchemaObject(
        projectPath: string,
        object: IMsmNewObject,
        baseHash: string,
    ): Promise<IMsmObjectAdded> {
        const tool = "msm.add_schema_object";
        const result = decodeObject<IEditResultOnTheWire & {
            file: string; line: number; }>(tool,
            await this.caller.callTool(tool, msmToolArgs.addSchemaObject(
                projectPath, object, baseHash)));

        return { ...editResultOf(result), file: result.file,
            line: result.line };
    }
}
