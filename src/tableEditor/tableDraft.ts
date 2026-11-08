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
 * The table editor's working copy of a table (a draft), and the
 * `mariadb-lsp edit` ops (lsp-server `docs/edit-format.md`) that take the
 * table as it was to the draft. The editor changes the draft freely; only
 * Save works out the edits, so a change made and taken back sends nothing.
 * Pure, shared by the extension and the webview.
 *
 * Every row of the draft remembers where it came from (`origin`, its
 * position in the table as read), so a rename is told from a drop and an
 * add, and an unnamed index can still be dropped.
 */

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import type {
    IOutlineColumn,
    IOutlineForeignKey,
    IOutlineIndex,
    IOutlineKeyPart,
    IOutlineTable,
    IOutlineTrigger,
} from "../modeler/modelFormat.js";

/** A column of the draft. */
export interface IDraftColumn extends IOutlineColumn {
    /** A row read, marked to go on Save (shown struck out, to restore). */
    dropped?: boolean;
    /** Tells rows apart in the grid; never sent. */
    key: string;
    /** Its position among the table's columns as read; none for a new one. */
    origin?: number;
    /** Whether it is part of the primary key. */
    primary: boolean;
}

/** An index of the draft, the primary key left out (the columns say it). */
export interface IDraftIndex {
    /** A row read, marked to go on Save (shown struck out, to restore). */
    dropped?: boolean;
    key: string;
    origin?: number;
    /** Empty for an unnamed index (the server names it). */
    name: string;
    /** `index`, `unique`, `fulltext`, `spatial`, `vector`. */
    kind: string;
    keyParts: IOutlineKeyPart[];
    using: string | null;
    comment: string | null;
}

/** A foreign key of the draft. */
export interface IDraftForeignKey {
    /** A row read, marked to go on Save (shown struck out, to restore). */
    dropped?: boolean;
    key: string;
    origin?: number;
    name: string;
    columns: string[];
    referencedSchema: string | null;
    referencedTable: string;
    referencedColumns: string[];
    onDelete: string | null;
    onUpdate: string | null;
}

/** A trigger of the draft, on the table. */
export interface IDraftTrigger {
    /** A row read, marked to go on Save (shown struck out, to restore). */
    dropped?: boolean;
    key: string;
    origin?: number;
    name: string;
    /** `BEFORE` or `AFTER`. */
    timing: string;
    /** `INSERT`, `UPDATE`, `DELETE`, or several as `UPDATE OR DELETE`. */
    events: string;
    body: string;
}

/** The table as the editor has it. */
export interface ITableDraft {
    name: string;
    comment: string;
    columns: IDraftColumn[];
    indexes: IDraftIndex[];
    foreignKeys: IDraftForeignKey[];
    triggers: IDraftTrigger[];
}

/** The index kinds a table editor offers, the primary key left out. */
export const INDEX_KINDS = ["index", "unique", "fulltext", "spatial",
    "vector"] as const;

/** What `ON DELETE` / `ON UPDATE` can say; null leaves it unwritten. */
export const REFERENTIAL_ACTIONS = ["RESTRICT", "CASCADE", "SET NULL",
    "NO ACTION", "SET DEFAULT"] as const;

let keyCount = 0;

/**
 * @param prefix What kind of row it is.
 *
 * @returns A key no other row of this page has.
 */
export const newRowKey = (prefix: string): string => {
    keyCount += 1;

    return `${prefix}${keyCount}`;
};

/**
 * @param index An index as read.
 *
 * @returns Its key parts, from `columns` where the outline gave none.
 */
const keyPartsOf = (index: IOutlineIndex): IOutlineKeyPart[] => {
    return index.key_parts?.map((part) => {
        return { column: part.column, length: part.length ?? null,
            order: part.order ?? null };
    }) ?? index.columns.map((column) => {
        return { column, length: null, order: null };
    });
};

/**
 * @param table The table as read.
 * @param triggers Its triggers as read.
 *
 * @returns The draft the editor starts from.
 */
export const draftOf = (
    table: IOutlineTable,
    triggers: IOutlineTrigger[],
): ITableDraft => {
    const primary = new Set(primaryKeyOf(table).map((name) => {
        return name.toLowerCase();
    }));

    return {
        name: table.name,
        comment: table.options?.comment ?? "",
        columns: table.columns.map((column, origin) => {
            return { ...column, key: newRowKey("c"), origin,
                primary: primary.has(column.name.toLowerCase()) };
        }),
        indexes: (table.indexes ?? []).flatMap((index, origin) => {
            return index.kind === "primary" ? [] : [{
                key: newRowKey("i"),
                origin,
                name: index.name ?? "",
                kind: index.kind,
                keyParts: keyPartsOf(index),
                using: index.using ?? null,
                comment: index.comment ?? null,
            }];
        }),
        foreignKeys: (table.foreign_keys ?? []).map((key, origin) => {
            return {
                key: newRowKey("f"),
                origin,
                name: key.name,
                columns: [...key.columns],
                referencedSchema: key.references.schema,
                referencedTable: key.references.table,
                referencedColumns: [...key.references.columns],
                onDelete: key.on_delete ?? null,
                onUpdate: key.on_update ?? null,
            };
        }),
        triggers: triggers.map((trigger, origin) => {
            return {
                key: newRowKey("t"),
                origin,
                name: trigger.name,
                timing: trigger.timing,
                events: trigger.events,
                body: trigger.body ?? "",
            };
        }),
    };
};

/**
 * @param table A table as read.
 *
 * @returns The columns of its primary key, in the key's order.
 */
export const primaryKeyOf = (table: IOutlineTable): string[] => {
    return table.indexes?.find((index) => {
        return index.kind === "primary";
    })?.columns ?? [];
};

// ---------------------------------------------------------------------------
// Types: what the grid shows as Type and Length.

/** A column type taken apart: `smallint(5) unsigned`. */
export interface ITypeParts {
    /** `smallint`. */
    base: string;
    /** What is in the parentheses: `5`, `10,2`, `'a','b'`; empty if none. */
    length: string;
    /** What follows them: `unsigned`, `zerofill`. */
    rest: string;
}

/**
 * @param type A column type as the outline writes it.
 *
 * @returns Its parts; the parentheses found with quotes in mind, so an
 *          ENUM value holding `)` stays whole.
 */
export const splitType = (type: string): ITypeParts => {
    const open = type.indexOf("(");
    if (open < 0) {
        // `INT UNSIGNED`: the first word is the type, the rest attributes;
        // `DOUBLE PRECISION` and the like are kept whole.
        const match = /^(\S+)\s+(unsigned|signed|zerofill)\b(.*)$/i
            .exec(type.trim());

        return match === null
            ? { base: type.trim(), length: "", rest: "" }
            : { base: match[1], length: "",
                rest: `${match[2]}${match[3]}`.trim() };
    }
    let quote: string | undefined;
    let depth = 0;
    for (let index = open; index < type.length; index += 1) {
        const char = type[index];
        if (quote !== undefined) {
            if (char === quote) {
                quote = type[index + 1] === quote ? (index += 1, quote)
                    : undefined;
            }
        } else if (char === "'" || char === "\"") {
            quote = char;
        } else if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                return {
                    base: type.slice(0, open).trim(),
                    length: type.slice(open + 1, index),
                    rest: type.slice(index + 1).trim(),
                };
            }
        }
    }

    return { base: type.trim(), length: "", rest: "" };
};

/**
 * @param parts A type's parts, as edited.
 *
 * @returns The type to send.
 */
export const joinType = (parts: ITypeParts): string => {
    const length = parts.length.trim();

    return [`${parts.base.trim()}${length === "" ? "" : `(${length})`}`,
        parts.rest.trim()].filter((part) => {
        return part !== "";
    }).join(" ");
};

// ---------------------------------------------------------------------------
// Key parts as text: `last_name(10) DESC, first_name`.

/**
 * @param name A column name.
 *
 * @returns It as key parts write it: in backticks where it needs them.
 */
const keyPartName = (name: string): string => {
    return /^[A-Za-z0-9_$]+$/.test(name)
        ? name : `\`${name.replaceAll("`", "``")}\``;
};

/**
 * @param parts An index's key parts.
 *
 * @returns Them as one line.
 */
export const keyPartsText = (parts: IOutlineKeyPart[]): string => {
    return parts.map((part) => {
        return `${keyPartName(part.column)}${part.length ? `(${part.length})`
            : ""}${part.order ? ` ${part.order}` : ""}`;
    }).join(", ");
};

/**
 * @param text Key parts as one line.
 *
 * @returns The key parts; an error where one cannot be read.
 */
export const parseKeyParts = (text: string): IOutlineKeyPart[] | string => {
    const parts: IOutlineKeyPart[] = [];
    const pattern = /^\s*(`(?:[^`]|``)+`|[^\s(),`]+)\s*(?:\(\s*(\d+)\s*\))?\s*(ASC|DESC)?\s*$/i;
    for (const piece of splitTopLevel(text)) {
        if (piece.trim() === "") {
            continue;
        }
        const match = pattern.exec(piece);
        if (match === null) {
            return `"${piece.trim()}" is not a column, a column(length) or `
                + "a column followed by ASC or DESC.";
        }
        const name = match[1].startsWith("`")
            ? match[1].slice(1, -1).replaceAll("``", "`") : match[1];
        parts.push({
            column: name,
            length: match[2] === undefined ? null : Number(match[2]),
            order: match[3]?.toUpperCase() ?? null,
        });
    }

    return parts;
};

/**
 * @param text A list separated by commas.
 *
 * @returns Its pieces, commas in backticks kept.
 */
const splitTopLevel = (text: string): string[] => {
    const pieces: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of text) {
        if (char === "`") {
            quoted = !quoted;
        }
        if (char === "," && !quoted) {
            pieces.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    pieces.push(current);

    return pieces;
};

/**
 * @param text Column names separated by commas.
 *
 * @returns The names.
 */
export const parseNameList = (text: string): string[] => {
    return splitTopLevel(text).map((piece) => {
        const name = piece.trim();

        return name.startsWith("`") && name.endsWith("`") && name.length > 1
            ? name.slice(1, -1).replaceAll("``", "`") : name;
    }).filter((name) => {
        return name !== "";
    });
};

/**
 * @param names Column names.
 *
 * @returns Them as one line.
 */
export const nameListText = (names: string[]): string => {
    return names.map(keyPartName).join(", ");
};

// ---------------------------------------------------------------------------
// What a draft is checked for before it is saved.

/**
 * @param draft A draft.
 *
 * @returns It without the rows marked to go.
 */
export const withoutDropped = (draft: ITableDraft): ITableDraft => {
    const kept = <T extends { dropped?: boolean }>(rows: T[]): T[] => {
        return rows.filter((row) => { return row.dropped !== true; });
    };

    return { ...draft, columns: kept(draft.columns),
        indexes: kept(draft.indexes), foreignKeys: kept(draft.foreignKeys),
        triggers: kept(draft.triggers) };
};

/**
 * @param edited The draft.
 *
 * @returns What is wrong with it, for the user; empty where nothing is.
 */
export const draftProblems = (edited: ITableDraft): string[] => {
    const draft = withoutDropped(edited);
    const problems: string[] = [];
    if (draft.name.trim() === "") {
        problems.push("The table needs a name.");
    }
    if (draft.columns.length === 0) {
        problems.push("The table needs a column.");
    }
    const columns = new Set<string>();
    for (const [index, column] of draft.columns.entries()) {
        const name = column.name.trim().toLowerCase();
        if (name === "") {
            problems.push(`Column ${index + 1} needs a name.`);
        } else if (columns.has(name)) {
            problems.push(`There are two columns named ${column.name}.`);
        }
        columns.add(name);
        if (column.type.trim() === "") {
            problems.push(`The column ${column.name || index + 1} needs a `
                + "type.");
        }
    }
    const unknown = (names: string[]): string | undefined => {
        return names.find((name) => {
            return !columns.has(name.toLowerCase());
        });
    };
    const names = new Set<string>();
    const named = (kind: string, name: string): void => {
        const key = name.trim().toLowerCase();
        if (key === "") {
            return;
        }
        if (names.has(`${kind}:${key}`)) {
            problems.push(`There are two ${kind}s named ${name}.`);
        }
        names.add(`${kind}:${key}`);
    };
    for (const index of draft.indexes) {
        const label = index.name || "an unnamed index";
        named("index", index.name);
        if (index.keyParts.length === 0) {
            problems.push(`The index ${label} needs a column.`);
        }
        const missing = unknown(index.keyParts.map((part) => {
            return part.column;
        }));
        if (missing !== undefined) {
            problems.push(`The index ${label} names ${missing}, which the `
                + "table has no column of.");
        }
    }
    for (const key of draft.foreignKeys) {
        const label = key.name || "a foreign key";
        named("foreign key", key.name);
        if (key.name.trim() === "") {
            problems.push("A foreign key needs a name.");
        }
        if (key.columns.length === 0) {
            problems.push(`The foreign key ${label} needs a column.`);
        }
        const missing = unknown(key.columns);
        if (missing !== undefined) {
            problems.push(`The foreign key ${label} names ${missing}, which `
                + "the table has no column of.");
        }
        if (key.referencedTable.trim() === "") {
            problems.push(`The foreign key ${label} needs the table it `
                + "references.");
        }
        if (key.referencedColumns.length !== key.columns.length) {
            problems.push(`The foreign key ${label} needs as many referenced `
                + "columns as columns.");
        }
    }
    for (const trigger of draft.triggers) {
        named("trigger", trigger.name);
        if (trigger.name.trim() === "") {
            problems.push("A trigger needs a name.");
        }
        if (trigger.body.trim() === "") {
            problems.push(`The trigger ${trigger.name} needs a body.`);
        }
    }

    return problems;
};

// ---------------------------------------------------------------------------
// The edits.

/** A column's members as an edit sends them, with the outline's defaults. */
const COLUMN_DEFAULTS = {
    nullable: true,
    default: null,
    auto_increment: false,
    comment: null,
    charset: null,
    collation: null,
    generated: null,
    generated_storage: null,
    on_update: null,
    invisible: false,
} as const;

/** Members of a column read that the editor does not change, kept as is. */
const KEPT_COLUMN_MEMBERS = ["generated_row", "system_versioning",
    "options"] as const;

/**
 * @param column A column of the draft.
 * @param read The column as read, where it was.
 *
 * @returns It as an edit's Column: every member the editor has, and those
 *          it does not show taken from the column as read, as a member
 *          left out of `modify_column` takes the outline's default.
 */
export const columnMembers = (
    column: IDraftColumn,
    read?: IOutlineColumn,
): Record<string, unknown> => {
    const members: Record<string, unknown> = {
        name: column.name.trim(),
        type: column.type.trim(),
    };
    for (const [member, fallback] of Object.entries(COLUMN_DEFAULTS)) {
        const value = (column as unknown as Record<string, unknown>)[member];
        members[member] = value === undefined || value === ""
            ? fallback : value;
    }
    // A key column cannot be NULL: MariaDB makes it NOT NULL, and so does
    // the outline.
    if (column.primary) {
        members.nullable = false;
    }
    if (members.generated === null) {
        members.generated_storage = null;
    }
    for (const member of KEPT_COLUMN_MEMBERS) {
        const value = (read as unknown as Record<string, unknown> | undefined)
            ?.[member];
        if (value !== undefined && value !== null) {
            members[member] = value;
        }
    }

    return members;
};

/**
 * @param value A JSON value.
 *
 * @returns It as text with object keys sorted, to compare two values.
 */
const canonical = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        return `{${Object.keys(value).sort().map((key) => {
            return `${JSON.stringify(key)}:${canonical(
                (value as Record<string, unknown>)[key])}`;
        }).join(",")}}`;
    }

    return JSON.stringify(value) ?? "null";
};

/**
 * @param index An index of the draft.
 *
 * @returns It as an edit's Index.
 */
const indexMembers = (index: IDraftIndex): Record<string, unknown> => {
    return {
        ...(index.name.trim() === "" ? {} : { name: index.name.trim() }),
        kind: index.kind,
        key_parts: index.keyParts.map((part) => {
            return { column: part.column, length: part.length ?? null,
                order: part.order ?? null };
        }),
        ...(index.using ? { using: index.using } : {}),
        ...(index.comment ? { comment: index.comment } : {}),
    };
};

/**
 * @param key A foreign key of the draft.
 *
 * @returns It as an edit's ForeignKey.
 */
const foreignKeyMembers = (key: IDraftForeignKey): Record<string, unknown> => {
    return {
        name: key.name.trim(),
        columns: key.columns,
        references: {
            ...(key.referencedSchema ? { schema: key.referencedSchema } : {}),
            table: key.referencedTable.trim(),
            columns: key.referencedColumns,
        },
        ...(key.onDelete ? { on_delete: key.onDelete } : {}),
        ...(key.onUpdate ? { on_update: key.onUpdate } : {}),
    };
};

/**
 * @param trigger A trigger of the draft.
 * @param table The table's name.
 * @param read The trigger as read, where it was.
 *
 * @returns It as an edit's Trigger: what the editor does not show (`UPDATE
 *          OF` columns, FOLLOWS / PRECEDES) kept from the one read.
 */
const triggerMembers = (
    trigger: IDraftTrigger,
    table: string,
    read?: IOutlineTrigger,
): Record<string, unknown> => {
    return {
        name: trigger.name.trim(),
        timing: trigger.timing,
        events: trigger.events,
        table,
        body: trigger.body,
        ...(read?.update_columns?.length
            ? { update_columns: read.update_columns } : {}),
        ...(read?.order ? { order: read.order } : {}),
    };
};

/**
 * @param index An index as read.
 *
 * @returns How `drop_index` names it: by name, or by its columns.
 */
const indexTarget = (index: IOutlineIndex): Record<string, unknown> => {
    return index.name === null ? { columns: index.columns }
        : { name: index.name };
};

/**
 * @param key A foreign key as read.
 *
 * @returns How `drop_foreign_key` names it.
 */
const foreignKeyTarget = (
    key: IOutlineForeignKey,
): Record<string, unknown> => {
    return key.name ? { name: key.name } : { columns: key.columns };
};

/**
 * @param read The rows as read.
 * @param drafts The rows of the draft.
 *
 * @returns The rows read that the draft no longer has, by position.
 */
const removed = <T extends { origin?: number }>(
    read: unknown[],
    drafts: T[],
): number[] => {
    const kept = new Set(drafts.map((draft) => {
        return draft.origin;
    }));

    return read.flatMap((_, origin) => {
        return kept.has(origin) ? [] : [origin];
    });
};

/**
 * Works out the edits that take a table to the draft. Their order is the
 * one MariaDB needs: foreign keys and triggers that go or change are
 * dropped first, then indexes and columns; changed columns are modified
 * before new ones are added (each after the column before it); then the
 * primary key, new indexes, foreign keys, the comment and triggers.
 *
 * @param table The table as read.
 * @param triggers Its triggers as read.
 * @param draft The table as edited.
 *
 * @returns The edits; none where the draft is the table as read.
 */
export const tableEdits = (
    table: IOutlineTable,
    triggers: IOutlineTrigger[],
    edited: ITableDraft,
): IMsmSchemaEdit[] => {
    const draft = withoutDropped(edited);
    const edits: IMsmSchemaEdit[] = [];
    const name = draft.name.trim();
    if (name !== table.name) {
        edits.push({ op: "rename_table", table: table.name, new_name: name });
    }
    const readIndexes = table.indexes ?? [];
    const readKeys = table.foreign_keys ?? [];

    // What goes, and what changes (dropped here, added again below).
    const changedKeys = draft.foreignKeys.filter((key) => {
        const read = key.origin === undefined ? undefined : readKeys[key.origin];

        return read === undefined
            || canonical(foreignKeyMembers(key)) !== canonical(
                foreignKeyMembers(draftOf({ name, columns: [],
                    foreign_keys: [read] }, []).foreignKeys[0]));
    });
    for (const origin of [...removed(readKeys, draft.foreignKeys),
        ...changedKeys.flatMap((key) => {
            return key.origin === undefined ? [] : [key.origin];
        })].sort((a, b) => { return a - b; })) {
        edits.push({ op: "drop_foreign_key", table: name,
            ...foreignKeyTarget(readKeys[origin]) });
    }

    const recreatedTriggers: IDraftTrigger[] = [];
    const renamedTriggers: IDraftTrigger[] = [];
    for (const trigger of draft.triggers) {
        const read = trigger.origin === undefined
            ? undefined : triggers[trigger.origin];
        if (read === undefined) {
            recreatedTriggers.push(trigger);
        } else if (read.timing !== trigger.timing
            || read.events !== trigger.events
            || (read.body ?? "") !== trigger.body) {
            edits.push({ op: "drop_trigger", trigger: read.name, table: name });
            recreatedTriggers.push(trigger);
        } else if (read.name !== trigger.name.trim()) {
            renamedTriggers.push(trigger);
        }
    }
    for (const origin of removed(triggers, draft.triggers)) {
        edits.push({ op: "drop_trigger", trigger: triggers[origin].name,
            table: name });
    }

    const changedIndexes = draft.indexes.filter((index) => {
        const read = index.origin === undefined
            ? undefined : readIndexes[index.origin];

        return read === undefined
            || canonical(indexMembers(index)) !== canonical(indexMembers(
                draftOf({ name, columns: [], indexes: [read] }, [])
                    .indexes[0]));
    });
    const keptIndexes = new Set(draft.indexes.map((index) => {
        return index.origin;
    }));
    for (const [origin, index] of readIndexes.entries()) {
        const changed = changedIndexes.some((draftIndex) => {
            return draftIndex.origin === origin;
        });
        if (index.kind !== "primary" && (!keptIndexes.has(origin) || changed)) {
            edits.push({ op: "drop_index", table: name, ...indexTarget(index) });
        }
    }

    for (const origin of removed(table.columns, draft.columns)) {
        edits.push({ op: "drop_column", table: name,
            column: table.columns[origin].name });
    }
    for (const column of draft.columns) {
        const read = column.origin === undefined
            ? undefined : table.columns[column.origin];
        if (read !== undefined) {
            const members = columnMembers(column, read);
            const before = columnMembers({ ...read, key: column.key,
                primary: column.primary }, read);
            if (canonical(members) !== canonical(before)) {
                edits.push({ op: "modify_column", table: name,
                    column: read.name, new_column: members });
            }
        }
    }
    for (const [position, column] of draft.columns.entries()) {
        if (column.origin === undefined) {
            const previous = draft.columns[position - 1];
            edits.push({ op: "add_column", table: name,
                column: columnMembers(column),
                ...(previous === undefined ? { first: true }
                    : { after: previous.name.trim() }) });
        }
    }

    // The primary key, by the columns' names now: kept columns in the
    // key's order, then the ones ticked since, in the table's order.
    const readKey = primaryKeyOf(table).map((column) => {
        return column.toLowerCase();
    });
    const nameNow = new Map(draft.columns.flatMap((column) => {
        return column.origin === undefined ? []
            : [[table.columns[column.origin].name.toLowerCase(),
                column] as const];
    }));
    const keyNow = [
        ...readKey.flatMap((column) => {
            const draftColumn = nameNow.get(column);

            return draftColumn?.primary === true ? [draftColumn] : [];
        }),
        ...draft.columns.filter((column) => {
            return column.primary && (column.origin === undefined
                || !readKey.includes(
                    table.columns[column.origin].name.toLowerCase()));
        }),
    ].map((column) => { return column.name.trim(); });
    const keyBefore = readKey.flatMap((column) => {
        const draftColumn = nameNow.get(column);

        return draftColumn === undefined ? [] : [draftColumn.name.trim()];
    });
    if (canonical(keyNow) !== canonical(keyBefore)
        || (keyNow.length === 0 && readKey.length > 0
            && keyBefore.length > 0)) {
        edits.push(keyNow.length === 0
            ? { op: "drop_index", table: name, kind: "primary" }
            : { op: "set_primary_key", table: name, columns: keyNow });
    }

    for (const index of changedIndexes) {
        edits.push({ op: "add_index", table: name, index: indexMembers(index) });
    }
    for (const key of changedKeys) {
        edits.push({ op: "add_foreign_key", table: name,
            foreign_key: foreignKeyMembers(key) });
    }
    const comment = draft.comment.trim();
    if (comment !== (table.options?.comment ?? "")) {
        edits.push({ op: "set_table_options", table: name,
            options: { comment: comment === "" ? null : comment } });
    }
    for (const trigger of renamedTriggers) {
        edits.push({ op: "rename_trigger",
            trigger: triggers[trigger.origin ?? 0].name,
            new_name: trigger.name.trim() });
    }
    for (const trigger of recreatedTriggers) {
        edits.push({ op: "add_trigger", trigger: triggerMembers(trigger, name,
            trigger.origin === undefined
                ? undefined : triggers[trigger.origin]) });
    }

    return edits;
};
