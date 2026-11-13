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
 * The titles of the Actions tab's rows for `msm.edit_schema` calls: what
 * the edits do, in words, rather than one title for every edit.
 */

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";

/** How many edits a title names before it counts the rest. */
const NAMED_EDITS = 2;

/** An op's verb, while it runs and once it ran. */
const VERBS: Record<string, [string, string]> = {
    add: ["Adding", "Added"],
    drop: ["Dropping", "Dropped"],
    rename: ["Renaming", "Renamed"],
    replace: ["Replacing", "Replaced"],
    modify: ["Changing", "Changed"],
    set: ["Setting", "Set"],
};

/** The words of an op's object kind, where they are not its own. */
const KIND_WORDS: Record<string, string> = {
    foreign_key: "foreign key",
    primary_key: "primary key",
    table_options: "options",
};

/**
 * @param value A member naming an object: its name, or the object with
 *              one.
 *
 * @returns The name, if it has one.
 */
const nameOf = (value: unknown): string | undefined => {
    const name = typeof value === "object" && value !== null
        ? (value as { name?: unknown }).name : value;

    return typeof name === "string" && name !== "" ? name : undefined;
};

/** @returns Columns as a list in parentheses. */
const columnList = (columns: unknown): string | undefined => {
    return Array.isArray(columns) && columns.length > 0
        ? `(${columns.map(String).join(", ")})` : undefined;
};

/**
 * @param edit An index or foreign key op: named, by `kind: "primary"`, or
 *             by its columns; an add carries the key as a member.
 * @param kind `index` or `foreign_key`.
 *
 * @returns The key in words, as `the index idx` or `the primary key`.
 */
const keyWords = (edit: IMsmSchemaEdit, kind: string): string => {
    const key = (edit[kind] ?? edit) as Record<string, unknown>;
    if (key.kind === "primary") {
        return "the primary key";
    }
    const words = key.kind === "unique" ? "the unique index"
        : KIND_WORDS[kind] === undefined ? `the ${kind}` : `the ${KIND_WORDS[kind]}`;
    const name = nameOf(key.name);
    if (name !== undefined) {
        return `${words} ${name}`;
    }
    const columns = columnList(key.columns);

    return columns === undefined ? words : `${words} on ${columns}`;
};

/**
 * @param edit A routine op: `kind` on the op, or on the routine added.
 *
 * @returns `procedure` or `function`, else `routine`.
 */
const routineKind = (edit: IMsmSchemaEdit): string => {
    const kind = edit.kind ?? (edit.routine as { kind?: unknown } | undefined)
        ?.kind;

    return kind === "procedure" || kind === "function" ? kind : "routine";
};

/**
 * Says what one edit does, without its verb.
 *
 * @param edit The edit.
 * @param kind The op's object kind: `column` of `add_column`.
 * @param verb The op's verb: `add`.
 *
 * @returns The rest of the phrase, or nothing for an op not known here.
 */
const objectWords = (edit: IMsmSchemaEdit, kind: string,
    verb: string): string | undefined => {
    const table = nameOf(edit.table);
    const onTable = table === undefined ? "" : ` ${verb === "add" ? "to"
        : "of"} ${table}`;
    const renamed = typeof edit.new_name === "string"
        ? ` to ${edit.new_name}` : "";
    switch (kind) {
        case "column": {
            const column = nameOf(edit.column);

            return column === undefined ? undefined
                : `the column ${column}${onTable}${renamed}`;
        }

        case "index":
        case "foreign_key": {
            return `${keyWords(edit, kind)}${onTable}`;
        }

        case "primary_key": {
            const columns = columnList(edit.columns);

            return `the primary key of ${table ?? "a table"}`
                + (columns === undefined ? "" : ` to ${columns}`);
        }

        case "table_options": {
            const options = edit.options as Record<string, unknown> | undefined;
            const only = options === undefined ? [] : Object.keys(options);

            return only.length === 1 && only[0] === "comment"
                ? `the comment of ${table ?? "a table"}`
                : `the options of ${table ?? "a table"}`;
        }

        case "routine": {
            const name = nameOf(edit.routine);

            return name === undefined ? undefined
                : `the ${routineKind(edit)} ${name}${renamed}`;
        }

        case "table":
        case "view":
        case "trigger":
        case "event":
        case "sequence": {
            const name = nameOf(edit[kind]);

            return name === undefined ? undefined
                : `the ${kind} ${name}${renamed}`;
        }

        default:
            return undefined;
    }
};

/**
 * Says what one edit does, as a phrase that starts with its verb.
 *
 * @param edit The edit.
 *
 * @returns The phrase while it runs and once it ran, or nothing for an
 *          op not known here.
 */
export const editPhrase = (
    edit: IMsmSchemaEdit,
): { doing: string; done: string } | undefined => {
    const [verb, ...rest] = edit.op.split("_");
    const verbs = VERBS[verb];
    const words = verbs === undefined ? undefined
        : objectWords(edit, rest.join("_"), verb);
    if (verbs === undefined || words === undefined) {
        return undefined;
    }

    return { doing: `${verbs[0]} ${words}`, done: `${verbs[1]} ${words}` };
};

/**
 * The title of an `msm.edit_schema` call's row in the Actions tab: its
 * first edits in words, and how many more there are.
 *
 * @param edits The edits of the call.
 * @param schema The schema they are made in.
 *
 * @returns The title while it runs and once it ran.
 */
export const editTitle = (
    edits: readonly IMsmSchemaEdit[],
    schema: string,
): { doing: string; done: string } => {
    const phrases = edits.slice(0, NAMED_EDITS).map(editPhrase);
    if (edits.length === 0 || phrases.some((phrase) => {
        return phrase === undefined;
    })) {
        return {
            doing: `Editing the schema of ${schema}`,
            done: `Edited the schema of ${schema}`,
        };
    }
    const more = edits.length - phrases.length;
    const tail = more === 0 ? ""
        : ` and ${String(more)} more change${more === 1 ? "" : "s"}`;
    const join = (key: "doing" | "done"): string => {
        return phrases.map((phrase, index) => {
            const text = phrase![key];

            return index === 0 ? text
                : text.charAt(0).toLowerCase() + text.slice(1);
        }).join(", ");
    };

    return {
        doing: `${join("doing")}${tail} in ${schema}`,
        done: `${join("done")}${tail} in ${schema}`,
    };
};
