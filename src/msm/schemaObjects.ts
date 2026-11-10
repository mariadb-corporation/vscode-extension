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

/**
 * Adding schema objects to an MSM project from its object group rows in
 * the MSM Projects view: a table in the table editor, every other kind
 * from a SQL template msm fills with its name and places where it keeps
 * that kind. The templates are msm's, unless the user changed one: a
 * changed template is a file of the extension's own storage.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as vscode from "vscode";

import { reportError } from "../errorMessages.js";
import type {
    IMsmApi,
    IMsmNewObject,
    MsmObjectKind,
} from "../mcp/msmApi.js";
import type { ObjectType } from "../mcp/types.js";
import type { ISchemaDefinition } from "../modeler/modelFormat.js";
import { outlineObjects } from "../tree/schemaTree.js";

/** Add <Kind>..., by the kind of the group row it is on. */
export const MSM_ADD_COMMANDS: Record<ObjectType, string> = {
    table: "mariadb.msm.addTable",
    view: "mariadb.msm.addView",
    procedure: "mariadb.msm.addProcedure",
    function: "mariadb.msm.addFunction",
    trigger: "mariadb.msm.addTrigger",
    event: "mariadb.msm.addEvent",
    sequence: "mariadb.msm.addSequence",
};

/** A template's own commands, on the group rows of the kinds that have one. */
export const MSM_TEMPLATE_COMMANDS = {
    /** Opens the kind's template, the user's or a copy of msm's. */
    edit: "mariadb.msm.editObjectTemplate",
    /** Goes back to msm's template. */
    reset: "mariadb.msm.resetObjectTemplate",
} as const;

/** How a kind is named in prompts. */
const KIND_NAMES: Record<ObjectType, string> = {
    table: "table",
    view: "view",
    procedure: "procedure",
    function: "function",
    trigger: "trigger",
    event: "event",
    sequence: "sequence",
};

/**
 * The kinds whose names a new object's may not take: tables, views and
 * sequences share one namespace; a procedure and a function may share a
 * name.
 */
const NAMESPACES: Record<MsmObjectKind, readonly ObjectType[]> = {
    view: ["table", "view", "sequence"],
    sequence: ["table", "view", "sequence"],
    procedure: ["procedure"],
    function: ["function"],
    trigger: ["trigger"],
    event: ["event"],
};

/** A group row of a project's schema, as a command is handed it. */
interface IGroupRow {
    kind: "objectGroup";
    projectPath: string;
    schema: string;
    objectType: ObjectType;
}

/**
 * @param kind A kind msm adds from a template.
 * @param definition The project's snapshot.
 * @param value A name typed.
 *
 * @returns Why it cannot be the new object's name, else nothing. msm
 *          checks it again, with every rule an identifier has.
 */
export const objectNameProblem = (
    kind: MsmObjectKind,
    definition: ISchemaDefinition,
    value: string,
): string | undefined => {
    const name = value.trim();
    if (name === "") {
        return "Enter a name.";
    }
    if (name.length > 64) {
        return "A name can be 64 characters at most.";
    }
    const wanted = name.toLowerCase();
    for (const type of NAMESPACES[kind]) {
        if (outlineObjects(definition, type).some((object) => {
            return object.name.toLowerCase() === wanted;
        })) {
            return `The schema has a ${KIND_NAMES[type]} ${name} already.`;
        }
    }

    return undefined;
};

/**
 * The user's templates: a file per kind in a folder of the extension's
 * storage, `<kind>.sql`. A kind without one takes msm's.
 */
export class ObjectTemplates {
    public constructor(private readonly folder: string) { }

    /**
     * @param kind A kind.
     *
     * @returns Where the user's template of it is kept.
     */
    public fileOf(kind: MsmObjectKind): string {
        return join(this.folder, `${kind}.sql`);
    }

    /**
     * @param kind A kind.
     *
     * @returns The user's template of it, or nothing for msm's.
     */
    public async read(kind: MsmObjectKind): Promise<string | undefined> {
        try {
            return await readFile(this.fileOf(kind), "utf8");
        } catch {
            return undefined;
        }
    }

    /**
     * Makes the user's template of a kind where there is none, from
     * msm's.
     *
     * @param kind A kind.
     * @param start msm's template of it.
     *
     * @returns The template's file.
     */
    public async ensure(kind: MsmObjectKind, start: string): Promise<string> {
        const file = this.fileOf(kind);
        if (await this.read(kind) === undefined) {
            await mkdir(this.folder, { recursive: true });
            await writeFile(file, start, "utf8");
        }

        return file;
    }

    /**
     * Drops the user's template of a kind: msm's is used again.
     *
     * @param kind A kind.
     *
     * @returns Whether there was one.
     */
    public async reset(kind: MsmObjectKind): Promise<boolean> {
        const had = await this.read(kind) !== undefined;
        await rm(this.fileOf(kind), { force: true });

        return had;
    }
}

/** What adding schema objects needs from the extension. */
export interface ISchemaObjectsHost {
    msmApi(): Promise<IMsmApi>;
    /**
     * The project's snapshot; msm makes one first where the project has
     * none yet (a new project).
     */
    snapshot(projectPath: string): Promise<ISchemaDefinition | undefined>;
    /** Adds an object through msm, in turn with the diagrams' edits. */
    addObject(projectPath: string, object: IMsmNewObject,
        baseHash: string): Promise<{ file: string; line: number }>;
    /** Opens the table editor on a new table of the project. */
    newTable(projectPath: string, schema: string): void;
    /** The snapshot changed: the tree, Object Details and diagrams follow. */
    snapshotUpdated(projectPath: string): Promise<void>;
    templates: ObjectTemplates;
    log(message: string): void;
}

/** The commands that add schema objects, and edit their templates. */
export class SchemaObjectCommands {
    public constructor(private readonly host: ISchemaObjectsHost) { }

    /**
     * @returns The registrations, for the extension to dispose.
     */
    public register(): vscode.Disposable[] {
        const onGroup = (
            id: string,
            handler: (row: IGroupRow) => Promise<void>,
            what: string,
        ): vscode.Disposable => {
            return vscode.commands.registerCommand(id, async (row?: unknown) => {
                const group = row as IGroupRow | undefined;
                // Only on a project's group row: nothing to pick it from.
                if (group?.kind !== "objectGroup"
                    || typeof group.projectPath !== "string") {
                    return;
                }
                try {
                    await handler(group);
                } catch (error) {
                    reportError(this.host.log, error, what);
                }
            });
        };

        return [
            ...Object.entries(MSM_ADD_COMMANDS).map(([type, id]) => {
                return onGroup(id, (row) => {
                    return this.add({ ...row, objectType: type as ObjectType });
                }, `add the ${type}`);
            }),
            onGroup(MSM_TEMPLATE_COMMANDS.edit, (row) => {
                return this.editTemplate(row.objectType);
            }, "open the template"),
            onGroup(MSM_TEMPLATE_COMMANDS.reset, (row) => {
                return this.resetTemplate(row.objectType);
            }, "reset the template"),
        ];
    }

    /**
     * Adds an object of a group row's kind: a table in the table editor,
     * any other from its template, named first.
     *
     * @param row The group row.
     */
    public async add(row: IGroupRow): Promise<void> {
        const kind = row.objectType;
        if (kind === "table") {
            this.host.newTable(row.projectPath, row.schema);

            return;
        }
        const definition = await this.host.snapshot(row.projectPath);
        if (definition?.source_hash === undefined) {
            throw new Error("The project has no schema snapshot: run Update "
                + "Schema Snapshot on its schema row first.");
        }
        const name = await vscode.window.showInputBox({
            title: `Add ${capitalized(kind)}`,
            prompt: `The name of the new ${kind} in ${row.schema}.`,
            validateInput: (value) => {
                return objectNameProblem(kind, definition, value);
            },
        });
        if (name === undefined) {
            return;
        }
        let table: string | undefined;
        if (kind === "trigger") {
            const tables = definition.tables.map((entry) => {
                return entry.name;
            });
            if (tables.length === 0) {
                throw new Error("A trigger needs a table: the schema has "
                    + "none yet.");
            }
            table = await vscode.window.showQuickPick(tables, {
                title: `Add Trigger ${name.trim()}`,
                placeHolder: "The table the trigger is on",
            });
            if (table === undefined) {
                return;
            }
        }
        const template = await this.host.templates.read(kind);
        const added = await this.host.addObject(row.projectPath, {
            kind, name: name.trim(),
            ...(template === undefined ? {} : { template }),
            ...(table === undefined ? {} : { table }),
        }, definition.source_hash);
        await this.host.snapshotUpdated(row.projectPath);
        // Where the new statement starts, for its body to be written.
        const at = new vscode.Position(Math.max(added.line - 1, 0), 0);
        await vscode.window.showTextDocument(vscode.Uri.file(added.file), {
            preview: false, selection: new vscode.Range(at, at),
        });
    }

    /**
     * Opens the user's template of a kind, made from msm's where there is
     * none: saving it is changing it.
     *
     * @param type The group row's kind.
     */
    public async editTemplate(type: ObjectType): Promise<void> {
        if (type === "table") {
            return;
        }
        const defaults = await (await this.host.msmApi()).getObjectTemplates();
        const file = await this.host.templates.ensure(type,
            defaults.templates[type]);
        await vscode.window.showTextDocument(vscode.Uri.file(file),
            { preview: false });
        const placeholders = (defaults.placeholders[type] ?? [])
            .map((name) => { return `\${${name}}`; }).join(", ");
        void vscode.window.showInformationMessage(`The template every new `
            + `${type} starts from; saving it keeps it. msm fills in `
            + `${placeholders || "nothing"}.`);
    }

    /**
     * Goes back to msm's template of a kind.
     *
     * @param type The group row's kind.
     */
    public async resetTemplate(type: ObjectType): Promise<void> {
        if (type === "table") {
            return;
        }
        const had = await this.host.templates.reset(type);
        void vscode.window.showInformationMessage(had
            ? `New ${type}s start from msm's template again.`
            : `New ${type}s start from msm's template already.`);
    }
}

/**
 * @param kind A kind.
 *
 * @returns It with a capital: "Procedure".
 */
const capitalized = (kind: string): string => {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
};
