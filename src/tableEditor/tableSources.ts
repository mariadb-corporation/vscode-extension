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
 * Where a table editor's table comes from, and where its changes go.
 *
 * - A live table is read as its `SHOW CREATE TABLE`, the tables a foreign
 *   key joins it to and its triggers, which `mariadb-lsp edit` reads into
 *   the outline the editor works on. Save gives the same script and the
 *   edits to the binary and runs the migration it answers with on the
 *   connection, one statement at a time: the other tables are in the
 *   script so a column their foreign keys use is changed as MariaDB needs
 *   (the key dropped and added back, error 1833).
 *   Where online ALTER TABLE is on for the table, its ALTERs (merged into
 *   one per table by the binary, with their `spec`) run through
 *   `msm.online_alter_table` instead, each a task of the Tasks view; its
 *   entry is kept in the workspace.
 * - A project's table is msm's schema snapshot's, the editor's edits made
 *   by `msm.edit_schema` in the project's queue (the diagrams' source).
 *   The binary reads the development script for the DDL tab and previews
 *   the migration msm will keep; it writes nothing. Its online ALTER
 *   entry is msm.project.json's, which deployments use.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
    IMsmOnlineAlterSettings,
    IMsmSchemaEdit,
} from "../mcp/msmApi.js";
import type { ITaskState } from "../mcp/taskApi.js";
import { errorText } from "../text.js";
import type {
    IOutlineTable,
    IOutlineTrigger,
    ISchemaDefinition,
} from "../modeler/modelFormat.js";
import {
    type ILspMigrationStatement,
    type LspEdit,
    type LspScript,
    sliceText,
    tableOfOutline,
} from "./lspEdit.js";
import {
    type IOnlineAlterData,
    type IOnlineAlterEntry,
    type IOnlineAlterOptions,
    optionsOf,
} from "./onlineAlter.js";
import type {
    ICollationChoice,
    ITableEditorData,
} from "./tableEditorProtocol.js";

/** What a Save previews. */
export interface ITablePreview {
    statements: string[];
    notes: string[];
}

/** What a Save came to. */
export interface ITableApplied {
    notes: string[];
}

/** A table editor's table: where it is read and changed. */
export interface ITableSource {
    /** The table's name now: a Save may rename it. */
    readonly table: string;
    read(): Promise<ITableEditorData>;
    /**
     * @param edits The edits.
     * @param onlineAlter The table's online ALTER entry, where the tab
     *                    changed it; else the one kept.
     */
    preview(edits: IMsmSchemaEdit[],
        onlineAlter?: IOnlineAlterEntry): Promise<ITablePreview>;
    /**
     * @param edits The edits; none where only the online ALTER entry
     *              changed.
     * @param onlineAlter The table's online ALTER entry, where the tab
     *                    changed it.
     */
    apply(edits: IMsmSchemaEdit[],
        onlineAlter?: IOnlineAlterEntry): Promise<ITableApplied>;
}

/**
 * @param error Why msm could not give the settings.
 *
 * @returns What the Online Alter Table tab says instead.
 */
const onlineAlterProblem = (error: unknown): string => {
    return "Online ALTER TABLE needs a MariaDB Shell whose msm has it: "
        + errorText(error);
};

/** Raised when a Save stopped part way: what ran stays run. */
export class PartlyAppliedError extends Error {
    /**
     * @param message What stopped it.
     * @param done The statements that ran.
     * @param changed Whether the table changed, and is to be read again:
     *                where statements ran, or a project's edits were saved.
     */
    public constructor(message: string, public readonly done: string[],
        public readonly changed = done.length > 0) {
        super(message);
    }
}

/**
 * What a live table's SQL Preview says above an ALTER TABLE that runs
 * through msm's online ALTER TABLE, not as written.
 */
export const ONLINE_ALTER_COMMENT = "-- Runs through online ALTER TABLE "
    + "(msm), not as written: the first step\n"
    + "-- the server accepts within this table's limits, of ALGORITHM="
    + "INSTANT,\n"
    + "-- then NOCOPY, INPLACE and COPY with LOCK=NONE, a Galera NBO, "
    + "LOCK=SHARED,\n"
    + "-- LOCK=EXCLUSIVE. Where none can run it, the table is left as it "
    + "is.\n";

/**
 * @param name An identifier.
 *
 * @returns It in backticks.
 */
export const quoteName = (name: string): string => {
    return `\`${name.replaceAll("`", "``")}\``;
};

/**
 * @param text A text.
 *
 * @returns It as an SQL string literal.
 */
export const quoteString = (text: string): string => {
    return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
};

/**
 * @param edits A Save's edits.
 *
 * @returns The name of the table they make, where they make one.
 */
const createdTable = (edits: IMsmSchemaEdit[]): string | undefined => {
    const created = edits.find((edit) => {
        return edit.op === "add_table";
    })?.table as { name?: unknown } | undefined;

    return typeof created?.name === "string" ? created.name : undefined;
};

/**
 * @param definition A project's snapshot.
 *
 * @returns Its tables' columns, by table, for the foreign keys' pickers.
 */
const tableColumns = (
    definition: ISchemaDefinition,
): Record<string, string[]> => {
    return Object.fromEntries(definition.tables.map((entry) => {
        return [entry.name, entry.columns.map((column) => {
            return column.name;
        })];
    }));
};

/**
 * @param edits Edits.
 *
 * @returns The table's name after them, where one renames it.
 */
const renamedTo = (edits: IMsmSchemaEdit[]): string | undefined => {
    const rename = edits.find((edit) => {
        return edit.op === "rename_table";
    });

    return typeof rename?.new_name === "string" ? rename.new_name : undefined;
};

/**
 * @param row A result row.
 * @param name A column of it, looked up without regard to case.
 *
 * @returns The value as text; empty where it has none.
 */
const field = (row: Record<string, unknown>, name: string): string => {
    const key = Object.keys(row).find((candidate) => {
        return candidate.toLowerCase() === name.toLowerCase();
    });
    const value = key === undefined ? undefined : row[key];

    return value === undefined || value === null ? "" : String(value);
};

/** What an ALTER TABLE run online came to. */
export interface IOnlineAlterOutcome {
    /** Whether it changed the table: not where no allowed step could. */
    applied: boolean;
    /** How it ran: INSTANT, NOCOPY, INPLACE, COPY, ..., or NEEDS_EXTERNAL. */
    method: string;
    reason?: string;
}

/**
 * @param state An `online_alter_table` task, ended.
 *
 * @returns What it came to; an error where it failed or was cancelled.
 */
export const onlineAlterOutcome = (state: ITaskState): IOnlineAlterOutcome => {
    if (state.status === "cancelled") {
        throw new Error("The online ALTER TABLE was cancelled; the table is "
            + "as it was.");
    }
    if (state.status !== "completed") {
        throw new Error(state.error ?? "The online ALTER TABLE failed.");
    }
    const result = (state.result ?? {}) as { method?: unknown;
        applied?: unknown; reason?: unknown };

    return {
        applied: result.applied !== false,
        method: typeof result.method === "string" ? result.method : "done",
        ...(typeof result.reason === "string" && result.reason !== ""
            ? { reason: result.reason } : {}),
    };
};

/** A live table's online ALTER TABLE: its entry, and its runs. */
export interface ILiveOnlineAlter {
    /** msm's limits where nothing sets them. */
    defaults(): Promise<Required<IOnlineAlterOptions>>;
    /** The table's entry, as the workspace keeps it. */
    get(table: string): IOnlineAlterEntry;
    set(table: string, entry: IOnlineAlterEntry): Promise<void>;
    /** Moves a renamed table's entry. */
    rename(table: string, name: string): Promise<void>;
    /**
     * Runs one ALTER TABLE of the table online, as a task; throws where it
     * failed or was cancelled.
     */
    run(table: string, spec: string,
        options: IOnlineAlterOptions): Promise<IOnlineAlterOutcome>;
}

/** What a live table is read and changed through. */
export interface ILiveTableDeps {
    /** Runs a query on the connection, its rows as objects. */
    query(sql: string): Promise<Array<Record<string, unknown>>>;
    /** Runs a statement that returns no rows. */
    execute(sql: string): Promise<void>;
    lsp: LspEdit;
    /** Online ALTER TABLE; without it, every statement runs as written. */
    onlineAlter?: ILiveOnlineAlter;
}

/** A table of a live connection. */
export class LiveTableSource implements ITableSource {
    #table: string;
    /** The script last read: what the edits are worked out against. */
    #script = "";
    /** msm's online ALTER TABLE defaults, once it gave them. */
    #onlineDefaults?: Required<IOnlineAlterOptions>;
    /**
     * Whether msm, asked for them, could not give them: it has no online
     * ALTER TABLE, so every statement runs as written.
     */
    #onlineMissing = false;

    public constructor(
        private readonly schema: string,
        table: string,
        private readonly deps: ILiveTableDeps,
    ) {
        this.#table = table;
    }

    public get table(): string {
        return this.#table;
    }

    /**
     * @param table A table of the schema.
     *
     * @returns Its CREATE TABLE.
     */
    async #showCreate(table: string): Promise<string> {
        const [row] = await this.deps.query(`SHOW CREATE TABLE ${
            quoteName(this.schema)}.${quoteName(table)}`);
        const ddl = row === undefined ? "" : field(row, "Create Table");
        if (ddl === "") {
            throw new Error(`${this.schema}.${table} is not a table.`);
        }

        return ddl;
    }

    public async read(): Promise<ITableEditorData> {
        const schema = quoteString(this.schema);
        const table = quoteString(this.#table);
        const ddl = await this.#showCreate(this.#table);
        const related = await this.deps.query("SELECT DISTINCT TABLE_NAME, "
            + "REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE "
            + `WHERE TABLE_SCHEMA = ${schema} AND REFERENCED_TABLE_SCHEMA = `
            + `${schema} AND (TABLE_NAME = ${table} OR REFERENCED_TABLE_NAME = `
            + `${table})`);
        const others = new Set<string>();
        for (const row of related) {
            for (const name of [field(row, "TABLE_NAME"),
                field(row, "REFERENCED_TABLE_NAME")]) {
                if (name !== "" && name.toLowerCase()
                    !== this.#table.toLowerCase()) {
                    others.add(name);
                }
            }
        }
        const otherDdl = await Promise.all([...others].map((name) => {
            return this.#showCreate(name);
        }));
        const triggerRows = await this.deps.query("SELECT TRIGGER_NAME FROM "
            + `information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = ${schema}`
            + ` AND EVENT_OBJECT_TABLE = ${table} ORDER BY ACTION_ORDER`);
        const triggerDdl = await Promise.all(triggerRows.map(async (row) => {
            const [created] = await this.deps.query(`SHOW CREATE TRIGGER ${
                quoteName(this.schema)}.${quoteName(field(row,
                "TRIGGER_NAME"))}`);

            return created === undefined
                ? "" : field(created, "SQL Original Statement");
        }));
        this.#script = [
            ...[ddl, ...otherDdl].map((statement) => {
                return `${statement};\n`;
            }),
            ...triggerDdl.filter((statement) => {
                return statement !== "";
            }).map((statement) => {
                return `DELIMITER $$\n${statement}$$\nDELIMITER ;\n`;
            }),
        ].join("\n");
        const result = await this.deps.lsp.edit({ text: this.#script }, null);
        const found = tableOfOutline(result.outline, null, this.#table);
        if (found === undefined) {
            throw new Error(`The SQL language server could not read the `
                + `table ${this.#table}.`);
        }

        const columns = await this.deps.query("SELECT TABLE_NAME, COLUMN_NAME "
            + `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${schema} `
            + "ORDER BY TABLE_NAME, ORDINAL_POSITION");
        const tables: Record<string, string[]> = {};
        for (const row of columns) {
            (tables[field(row, "TABLE_NAME")] ??= []).push(
                field(row, "COLUMN_NAME"));
        }
        const collations = (await this.deps.query("SELECT CHARACTER_SET_NAME, "
            + "COLLATION_NAME FROM information_schema.COLLATIONS ORDER BY "
            + "CHARACTER_SET_NAME, COLLATION_NAME")).map((row) => {
            return { charset: field(row, "CHARACTER_SET_NAME"),
                collation: field(row, "COLLATION_NAME") };
        });

        return {
            live: true,
            table: withoutPlaces(found.table),
            triggers: found.triggers.map(withoutPlaces),
            ddl,
            tables,
            collations,
            ...await this.#onlineAlterData(),
        };
    }

    /** The Online Alter Table tab's settings, or why there are none. */
    async #onlineAlterData(): Promise<Pick<ITableEditorData,
        "onlineAlter" | "onlineAlterProblem">> {
        const online = this.deps.onlineAlter;
        if (online === undefined) {
            return {};
        }
        try {
            this.#onlineDefaults ??= await online.defaults();
            this.#onlineMissing = false;

            return { onlineAlter: {
                inherited: { ...this.#onlineDefaults, enabled: true },
                table: online.get(this.#table),
                keptIn: "workspace",
            } };
        } catch (error) {
            this.#onlineMissing = true;

            return { onlineAlterProblem: onlineAlterProblem(error) };
        }
    }

    /**
     * @param edits The edits.
     *
     * @returns The binary's migration for them: an online ALTER needs
     *          each table's ALTERs merged, with their `spec`.
     */
    #migration(edits: IMsmSchemaEdit[]): ReturnType<LspEdit["edit"]> {
        return this.deps.lsp.edit({ text: this.#script }, null, edits,
            this.deps.onlineAlter !== undefined);
    }

    /**
     * @param edits A Save's edits.
     * @param entry The table's online ALTER entry.
     *
     * @returns Which of its statements run online: this table's ALTERs,
     *          under either name where the Save renames it, while the
     *          entry has it on and msm has online ALTER TABLE.
     */
    #runsOnline(edits: IMsmSchemaEdit[], entry: IOnlineAlterEntry):
        (statement: ILspMigrationStatement) => boolean {
        const names = new Set([this.#table, renamedTo(edits) ?? this.#table]
            .map((name) => { return name.toLowerCase(); }));
        const on = this.deps.onlineAlter !== undefined
            && !this.#onlineMissing && (entry.enabled ?? true);

        return (statement) => {
            return on && statement.spec !== undefined
                && statement.table !== undefined
                && names.has(statement.table.toLowerCase());
        };
    }

    /**
     * @param result The binary's answer.
     *
     * @returns Its notes: msm's are for its update scripts; run here, a
     *          trigger's CREATE needs nothing more.
     */
    static #notes(result: Awaited<ReturnType<LspEdit["edit"]>>): string[] {
        return result.notes.filter((note) => {
            return note.kind !== "trigger-created"
                && note.kind !== "trigger-recreated";
        }).map((note) => { return note.message; });
    }

    public async preview(edits: IMsmSchemaEdit[],
        onlineAlter?: IOnlineAlterEntry): Promise<ITablePreview> {
        const result = await this.#migration(edits);
        const online = this.#runsOnline(edits,
            onlineAlter ?? this.deps.onlineAlter?.get(this.#table) ?? {});

        return {
            statements: result.migration.map((statement) => {
                return online(statement)
                    ? ONLINE_ALTER_COMMENT + statement.sql : statement.sql;
            }),
            notes: LiveTableSource.#notes(result),
        };
    }

    /**
     * After a Save stopped part way: the table is followed to its new name
     * where the rename ran.
     *
     * @param edits The Save's edits.
     * @param done The statements that ran.
     */
    async #followRename(edits: IMsmSchemaEdit[], done: string[]):
        Promise<void> {
        const renamed = renamedTo(edits);
        if (renamed === undefined || done.length === 0) {
            return;
        }
        try {
            const rows = await this.deps.query("SELECT TABLE_NAME FROM "
                + "information_schema.TABLES WHERE TABLE_SCHEMA = "
                + `${quoteString(this.schema)} AND TABLE_NAME = ${
                    quoteString(renamed)}`);
            if (rows.length > 0) {
                await this.deps.onlineAlter?.rename(this.#table, renamed);
                this.#table = renamed;
            }
        } catch {
            // Not known: the table is read under the name it had.
        }
    }

    public async apply(edits: IMsmSchemaEdit[],
        onlineAlter?: IOnlineAlterEntry): Promise<ITableApplied> {
        const online = this.deps.onlineAlter;
        if (online !== undefined && onlineAlter !== undefined) {
            await online.set(this.#table, onlineAlter);
        }
        if (edits.length === 0) {
            return { notes: [] };
        }
        const entry = online?.get(this.#table) ?? {};
        const runsOnline = this.#runsOnline(edits, entry);
        const result = await this.#migration(edits);
        const notes = LiveTableSource.#notes(result);
        const done: string[] = [];
        // The statements carry no schema: the session's may be another.
        await this.deps.execute(`USE ${quoteName(this.schema)}`);
        for (const statement of result.migration) {
            try {
                if (online !== undefined && runsOnline(statement)) {
                    const outcome = await online.run(statement.table!,
                        statement.spec!, optionsOf(entry));
                    if (!outcome.applied) {
                        throw new Error("The ALTER TABLE was not run, and "
                            + "nothing was changed: no step online ALTER "
                            + "TABLE allows could run it"
                            + (outcome.reason === undefined ? "."
                                : ` (${outcome.reason}).`));
                    }
                    notes.push(`ALTER TABLE ran online: ${outcome.method}`
                        + (outcome.reason === undefined ? "."
                            : ` (${outcome.reason}).`));
                } else {
                    await this.deps.execute(statement.sql);
                }
            } catch (error) {
                await this.#followRename(edits, done);
                throw new PartlyAppliedError(errorText(error), done);
            }
            done.push(statement.sql);
        }
        const renamed = renamedTo(edits);
        if (renamed !== undefined) {
            await online?.rename(this.#table, renamed);
            this.#table = renamed;
        }

        return { notes };
    }
}

/** What a project's table is read and changed through. */
export interface IProjectTableDeps {
    /** msm's snapshot of the development script. */
    snapshot(): Promise<ISchemaDefinition | undefined>;
    /** Makes the edits through msm (`msm.edit_schema`). */
    edit(edits: IMsmSchemaEdit[], baseHash: string): Promise<string[]>;
    /** The development script, `development/<schema>_next.sql`. */
    scriptFile(): Promise<string | undefined>;
    lsp: LspEdit;
    readText?(file: string): Promise<string>;
    /** The project's online ALTER TABLE setting, through msm. */
    onlineAlter?: {
        get(table: string): Promise<IMsmOnlineAlterSettings>;
        /** Writes a table's entry; null drops it. */
        set(table: string, entry: IOnlineAlterEntry | null): Promise<void>;
    };
}

/**
 * @param settings A project's setting, as msm gives it.
 * @param table A table of it.
 *
 * @returns What the Online Alter Table tab shows of the table.
 */
export const projectOnlineAlter = (settings: IMsmOnlineAlterSettings,
    table: string): IOnlineAlterData => {
    const { tables, enabled, ...general } = settings.setting;

    return {
        inherited: { ...settings.defaults, ...general,
            enabled: enabled ?? true },
        // Table names match exactly, as msm matches them.
        table: tables?.[table] ?? {},
        keptIn: "project",
    };
};

/** The character sets and collations offered where no server is asked. */
export const COMMON_COLLATIONS: readonly ICollationChoice[] = [
    ["armscii8", "armscii8_general_ci"], ["ascii", "ascii_general_ci"],
    ["ascii", "ascii_bin"], ["binary", "binary"],
    ["latin1", "latin1_swedish_ci"], ["latin1", "latin1_general_ci"],
    ["latin1", "latin1_bin"], ["ucs2", "ucs2_general_ci"],
    ["utf16", "utf16_general_ci"], ["utf32", "utf32_general_ci"],
    ["utf8mb3", "utf8mb3_general_ci"], ["utf8mb3", "utf8mb3_unicode_ci"],
    ["utf8mb3", "utf8mb3_bin"], ["utf8mb4", "utf8mb4_general_ci"],
    ["utf8mb4", "utf8mb4_unicode_ci"], ["utf8mb4", "utf8mb4_unicode_520_ci"],
    ["utf8mb4", "utf8mb4_uca1400_ai_ci"], ["utf8mb4", "utf8mb4_uca1400_as_cs"],
    ["utf8mb4", "utf8mb4_bin"],
].map(([charset, collation]) => { return { charset, collation }; });

/** A table of an MSM project. */
export class ProjectTableSource implements ITableSource {
    /** "" for a new table, until a Save made it. */
    #table: string;

    public constructor(
        private readonly schema: string,
        table: string,
        private readonly deps: IProjectTableDeps,
    ) {
        this.#table = table;
    }

    public get table(): string {
        return this.#table;
    }

    async #definition(): Promise<ISchemaDefinition> {
        const definition = await this.deps.snapshot();
        if (definition === undefined) {
            throw new Error("The project has no schema snapshot: run Update "
                + "Schema Snapshot on its schema row first.");
        }

        return definition;
    }

    async #script(): Promise<LspScript> {
        const file = await this.deps.scriptFile();
        if (file === undefined) {
            throw new Error("The project has no development script.");
        }

        return { file };
    }

    public async read(): Promise<ITableEditorData> {
        const definition = await this.#definition();
        if (this.#table === "") {
            return {
                live: false,
                isNew: true,
                table: { name: "", columns: [] },
                triggers: [],
                ddl: "",
                tables: tableColumns(definition),
                collations: [...COMMON_COLLATIONS],
            };
        }
        const lower = this.#table.toLowerCase();
        const table = definition.tables.find((entry) => {
            return entry.name.toLowerCase() === lower;
        });
        if (table === undefined) {
            throw new Error(`The project's schema has no table ${
                this.#table}.`);
        }
        return {
            live: false,
            table,
            triggers: (definition.triggers ?? []).filter((trigger) => {
                return trigger.table.toLowerCase() === lower;
            }),
            ddl: await this.#ddl(table.name).catch((error: unknown) => {
                return `-- The CREATE TABLE could not be read: ${
                    error instanceof Error ? error.message : String(error)}`;
            }),
            tables: tableColumns(definition),
            collations: [...COMMON_COLLATIONS],
            ...await this.#onlineAlterData(table.name),
        };
    }

    /** The Online Alter Table tab's settings, or why there are none. */
    async #onlineAlterData(table: string): Promise<Pick<ITableEditorData,
        "onlineAlter" | "onlineAlterProblem">> {
        const online = this.deps.onlineAlter;
        if (online === undefined) {
            return {};
        }
        try {
            return { onlineAlter: projectOnlineAlter(await online.get(table),
                table) };
        } catch (error) {
            return { onlineAlterProblem: onlineAlterProblem(error) };
        }
    }

    /**
     * @param name The table.
     *
     * @returns Its CREATE TABLE as the project writes it.
     */
    async #ddl(name: string): Promise<string> {
        const script = await this.#script();
        const result = await this.deps.lsp.edit(script, this.schema);
        const found = tableOfOutline(result.outline, this.schema, name);
        const range = found?.table.range;
        if (found === undefined || range === undefined || !("file" in script)) {
            return "";
        }
        const include = found.table.source === undefined
            ? undefined : result.outline.includes?.[found.table.source];
        const relative = include?.path ?? include?.file;
        const file = relative === undefined ? script.file
            : path.resolve(path.dirname(script.file), relative);
        const text = await (this.deps.readText ?? ((where: string) => {
            return readFile(where, "utf8");
        }))(file);

        return sliceText(text, range.start, range.end);
    }

    public async preview(edits: IMsmSchemaEdit[]): Promise<ITablePreview> {
        // Merged as msm.edit_schema merges them, where the binary does.
        const result = await this.deps.lsp.edit(await this.#script(),
            this.schema, edits, true);

        return {
            statements: result.migration.map((statement) => {
                return statement.sql;
            }),
            notes: result.notes.map((note) => { return note.message; }),
        };
    }

    public async apply(edits: IMsmSchemaEdit[],
        onlineAlter?: IOnlineAlterEntry): Promise<ITableApplied> {
        let notes: string[] = [];
        if (edits.length > 0) {
            const definition = await this.#definition();
            if (definition.source_hash === undefined) {
                throw new Error("The project's schema snapshot has no hash "
                    + "to edit against: run Update Schema Snapshot first.");
            }
            notes = await this.deps.edit(edits, definition.source_hash);
            this.#table = renamedTo(edits) ?? createdTable(edits)
                ?? this.#table;
        }
        try {
            await this.#keepOnlineAlter(onlineAlter);
        } catch (error) {
            if (edits.length === 0) {
                throw error;
            }
            // The edits are saved: the table is read again as they left it.
            throw new PartlyAppliedError("The changes were saved to the "
                + "project, but not the table's online ALTER TABLE "
                + `settings: ${errorText(error)}`, [], true);
        }

        return { notes };
    }

    /**
     * Writes the table's online ALTER entry after the edits, under the
     * name they leave it (msm.edit_schema carries an entry over a rename
     * itself).
     *
     * @param entry Its entry, where the tab changed it; empty drops it.
     */
    async #keepOnlineAlter(entry: IOnlineAlterEntry | undefined):
        Promise<void> {
        if (this.deps.onlineAlter === undefined || entry === undefined) {
            return;
        }
        await this.deps.onlineAlter.set(this.#table,
            Object.keys(entry).length === 0 ? null : entry);
    }
}

/**
 * @param object An object of the outline.
 *
 * @returns It without where it is written, which edits do not take.
 */
const withoutPlaces = <T extends object>(object: T): T => {
    const copy = { ...object } as Record<string, unknown>;
    delete copy.range;
    delete copy.selection_range;
    delete copy.source;
    if (Array.isArray(copy.columns)) {
        copy.columns = (copy.columns as unknown[]).map((column) => {
            return typeof column === "object" && column !== null
                ? withoutPlaces(column) : column;
        });
    }

    return copy as T;
};

export type { IOutlineTable, IOutlineTrigger };
