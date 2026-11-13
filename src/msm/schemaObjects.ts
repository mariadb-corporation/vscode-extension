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
 * from a SQL template filled with its name, which msm places where it
 * keeps that kind (`msm.set_schema_statements`). The templates are msm's,
 * unless the user changed one: a changed template is a file of the
 * extension's own storage. Deleting one from its object row, which msm
 * does (`msm.drop_schema_object`).
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as vscode from "vscode";

import { reportError } from "../errorMessages.js";
import {
    MSM_OBJECT_KINDS,
    type IMsmApi,
    type IMsmExpectedObject,
    type IMsmObjectTemplates,
    type MsmObjectKind,
} from "../mcp/msmApi.js";
import type { ObjectType } from "../mcp/types.js";
import type { ISchemaDefinition } from "../modeler/modelFormat.js";
import type {
    IMsmObjectGroupNode,
    IMsmObjectNode,
} from "../tree/msmProjectsTreeProvider.js";
import { OBJECT_TYPE_LABELS, outlineObjects } from "../tree/schemaTree.js";
import { TEMPLATE_PLACEHOLDER } from "./msmFields.js";

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

/** Delete <Kind>..., by the kind of the object row it is on. */
export const MSM_DELETE_COMMANDS: Record<ObjectType, string> = {
    table: "mariadb.msm.deleteTable",
    view: "mariadb.msm.deleteView",
    procedure: "mariadb.msm.deleteProcedure",
    function: "mariadb.msm.deleteFunction",
    trigger: "mariadb.msm.deleteTrigger",
    event: "mariadb.msm.deleteEvent",
    sequence: "mariadb.msm.deleteSequence",
};

/** A template's own commands, on the group rows of the kinds that have one. */
export const MSM_TEMPLATE_COMMANDS = {
    /** Opens the kind's template, the user's or a copy of msm's. */
    edit: "mariadb.msm.editObjectTemplate",
    /** Goes back to msm's template. */
    reset: "mariadb.msm.resetObjectTemplate",
} as const;

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

/**
 * @param kind A kind msm adds from a template.
 * @param definition The project's snapshot.
 *
 * @returns The names a new object of that kind may not take, lower case,
 *          with the kind that has each.
 */
export const takenNames = (
    kind: MsmObjectKind,
    definition: ISchemaDefinition,
): ReadonlyMap<string, ObjectType> => {
    return new Map(NAMESPACES[kind].flatMap((type) => {
        return outlineObjects(definition, type).map((object) => {
            return [object.name.toLowerCase(), type] as const;
        });
    }));
};

/**
 * @param taken The names taken, as {@link takenNames} gives them.
 * @param value A name typed.
 *
 * @returns Why it cannot be the new object's name, else nothing. msm
 *          checks it again, with every rule an identifier has.
 */
export const objectNameProblem = (
    taken: ReadonlyMap<string, ObjectType>,
    value: string,
): string | undefined => {
    const name = value.trim();
    if (name === "") {
        return "Enter a name.";
    }
    if (name.length > 64) {
        return "A name can be 64 characters at most.";
    }
    if (name.includes("`")) {
        return "A name cannot have a backtick: the templates quote it with "
            + "them.";
    }
    const type = taken.get(name.toLowerCase());

    return type === undefined ? undefined
        : `The schema has a ${type} ${name} already.`;
};

/**
 * Fills a template as msm does (string.Template): the CREATE statement of
 * a new object. Its SQL is not read; msm checks that it creates what was
 * asked for.
 *
 * @param kind The kind, for the messages.
 * @param template The template.
 * @param placeholders The ones the kind takes.
 * @param values The name, the schema and a trigger's table.
 *
 * @returns The statement, without its `;`.
 */
export const fillTemplate = (
    kind: MsmObjectKind,
    template: string,
    placeholders: readonly string[],
    values: { name: string; schema: string; table?: string },
): string => {
    if (template.trim() === "") {
        throw new Error(`The template of a ${kind} must be its CREATE `
            + "statement.");
    }
    const given: Record<string, string | undefined> = values;
    const filled = template.replace(TEMPLATE_PLACEHOLDER,
        (_match, dollar?: string, named?: string, braced?: string) => {
            if (dollar !== undefined) {
                return "$";
            }
            const placeholder = named ?? braced;
            if (placeholder === undefined) {
                throw new Error(`The template of a ${kind} has a $ that is `
                    + "no placeholder: write $$ for one.");
            }
            const value = placeholders.includes(placeholder)
                ? given[placeholder] : undefined;
            if (value === undefined) {
                throw new Error(`The template of a ${kind} uses the `
                    + `placeholder \${${placeholder}}; it takes `
                    + `${placeholders.map((name) => {
                        return `\${${name}}`;
                    }).join(", ")}.`);
            }

            return value;
        });

    return filled.trim().replace(/;+$/u, "").trimEnd();
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
            const text = await readFile(this.fileOf(kind), "utf8");

            // One emptied is no template: msm's is taken.
            return text.trim() === "" ? undefined : text;
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
        await mkdir(this.folder, { recursive: true });
        // Only where there is none: the user's is kept.
        await writeFile(file, start, { encoding: "utf8", flag: "wx" })
            .catch((error: unknown) => {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                    throw error;
                }
            });

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
        try {
            await rm(this.fileOf(kind));

            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
            throw error;
        }
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
    /**
     * Adds an object's CREATE through msm, in turn with the diagrams'
     * edits; msm refuses a statement that does not create what is
     * expected.
     */
    addObject(projectPath: string, statement: string,
        expect: IMsmExpectedObject,
        baseHash: string): Promise<{ file: string; line: number }>;
    /**
     * Drops an object through msm, in turn with the diagrams' edits; msm
     * refuses one another object needs.
     *
     * @returns msm's notes, for a person.
     */
    dropObject(projectPath: string, kind: ObjectType,
        name: string): Promise<string[]>;
    /** Opens the table editor on a new table of the project. */
    newTable(projectPath: string, schema: string): void;
    /** The snapshot changed: the tree, Object Details and diagrams follow. */
    snapshotUpdated(projectPath: string): Promise<void>;
    templates: ObjectTemplates;
    log(message: string): void;
}

/** The commands that add schema objects, and edit their templates. */
export class SchemaObjectCommands {
    /** msm's templates, asked for once: they do not change. */
    #defaults?: Promise<IMsmObjectTemplates>;

    public constructor(private readonly host: ISchemaObjectsHost) { }

    /**
     * @returns The registrations, for the extension to dispose.
     */
    public register(): vscode.Disposable[] {
        const onGroup = (
            id: string,
            handler: (row: IMsmObjectGroupNode) => Promise<void>,
            what: string,
        ): vscode.Disposable => {
            return vscode.commands.registerCommand(id, async (row?: unknown) => {
                const group = row as IMsmObjectGroupNode | undefined;
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
            // Each on its own kind's rows only: the row says the kind.
            ...Object.values(MSM_ADD_COMMANDS).map((id) => {
                return onGroup(id, (row) => {
                    return this.add(row);
                }, "add the schema object");
            }),
            ...Object.values(MSM_DELETE_COMMANDS).map((id) => {
                return vscode.commands.registerCommand(id,
                    async (row?: unknown) => {
                        const object = row as IMsmObjectNode | undefined;
                        // Only on a project's object row.
                        if (object?.kind !== "object"
                            || typeof object.projectPath !== "string") {
                            return;
                        }
                        try {
                            await this.delete(object);
                        } catch (error) {
                            reportError(this.host.log, error,
                                "delete the schema object");
                        }
                    });
            }),
            onGroup(MSM_TEMPLATE_COMMANDS.edit, async (row) => {
                if (isTemplated(row.objectType)) {
                    await this.editTemplate(row.objectType);
                }
            }, "open the template"),
            onGroup(MSM_TEMPLATE_COMMANDS.reset, async (row) => {
                if (isTemplated(row.objectType)) {
                    await this.resetTemplate(row.objectType);
                }
            }, "reset the template"),
        ];
    }

    /**
     * Adds an object of a group row's kind: a table in the table editor,
     * any other from its template, named first.
     *
     * @param row The group row.
     */
    public async add(row: IMsmObjectGroupNode): Promise<void> {
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
        // Asked for while the name is typed; awaited once it is.
        const defaults = this.#templates();
        defaults.catch(() => { /* reported where awaited */ });
        const taken = takenNames(kind, definition);
        const name = await vscode.window.showInputBox({
            title: `Add ${OBJECT_TYPE_LABELS[kind]}`,
            prompt: `The name of the new ${kind} in ${row.schema}.`,
            validateInput: (value) => {
                return objectNameProblem(taken, value);
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
        const expect: IMsmExpectedObject = { kind, name: name.trim(),
            ...(table === undefined ? {} : { table }) };
        const [templates, mine] = await Promise.all([defaults,
            this.host.templates.read(kind)]);
        const statement = fillTemplate(kind, mine ?? templates.templates[kind],
            templates.placeholders[kind] ?? [],
            { ...expect, schema: row.schema });
        const added = await this.host.addObject(row.projectPath, statement,
            expect, definition.source_hash);
        await this.host.snapshotUpdated(row.projectPath);
        // Where the new statement starts, for its body to be written.
        const at = new vscode.Position(Math.max(added.line - 1, 0), 0);
        await vscode.window.showTextDocument(vscode.Uri.file(added.file), {
            preview: false, selection: new vscode.Range(at, at),
        });
    }

    /**
     * Deletes the object of a project's object row, once confirmed: msm
     * removes its statements, and the trees and diagrams follow.
     *
     * @param row The object row.
     */
    public async delete(row: IMsmObjectNode): Promise<void> {
        const kind = row.objectType;
        const label = OBJECT_TYPE_LABELS[kind];
        const action = `Delete ${label}`;
        const answer = await vscode.window.showWarningMessage(
            `Delete the ${kind} ${row.name} from the MSM project of `
            + `${row.schema}?`, { modal: true, detail: kind === "table"
                ? "Its triggers are deleted with it. Once the project has "
                    + "a release, the next update script drops it."
                : "Once the project has a release, the next update script "
                    + "drops it." }, action);
        if (answer !== action) {
            return;
        }
        const notes = await this.host.dropObject(row.projectPath, kind,
            row.name);
        await this.host.snapshotUpdated(row.projectPath);
        for (const note of notes) {
            void vscode.window.showInformationMessage(note);
        }
    }

    /**
     * Opens the user's template of a kind, made from msm's where there is
     * none: saving it is changing it.
     *
     * @param type The kind.
     */
    public async editTemplate(type: MsmObjectKind): Promise<void> {
        const defaults = await this.#templates();
        const start = defaults.templates[type] as string | undefined;
        if (start === undefined) {
            throw new Error(`msm has no template of a ${type}.`);
        }
        const file = await this.host.templates.ensure(type, start);
        await vscode.window.showTextDocument(vscode.Uri.file(file),
            { preview: false });
        const placeholders = (defaults.placeholders[type] ?? [])
            .map((name) => { return `\${${name}}`; }).join(", ");
        void vscode.window.showInformationMessage(`The template every new `
            + `${type} starts from; saving it keeps it. Its Add fills in `
            + `${placeholders || "nothing"}.`);
    }

    /** @returns msm's templates, asked for once. */
    async #templates(): Promise<IMsmObjectTemplates> {
        this.#defaults ??= this.host.msmApi().then((api) => {
            return api.getObjectTemplates();
        });

        // Asked again next time where asking failed.
        return await this.#defaults.catch((error: unknown) => {
            this.#defaults = undefined;
            throw error;
        });
    }

    /**
     * Goes back to msm's template of a kind.
     *
     * @param type The kind.
     */
    public async resetTemplate(type: MsmObjectKind): Promise<void> {
        const had = await this.host.templates.reset(type);
        void vscode.window.showInformationMessage(had
            ? `New ${type}s start from msm's template again.`
            : `New ${type}s start from msm's template already.`);
    }
}

/**
 * @param type A kind of schema object.
 *
 * @returns Whether msm adds it from a template: every kind but tables.
 */
const isTemplated = (type: ObjectType): type is MsmObjectKind => {
    return (MSM_OBJECT_KINDS as readonly string[]).includes(type);
};
