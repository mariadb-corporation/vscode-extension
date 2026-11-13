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
 * Where a schema or a schema object of an MSM project is defined: found
 * in mariadb-lsp's outline of the development script (lsp-server
 * `docs/outline-format.md`), which says the statement's `range`, the
 * name's `selection_range`, and for an object of an included file its
 * `source` in `includes`. Pure: no SQL is read here.
 */

import type { ObjectType } from "../mcp/types.js";

/** A position of the outline: 0-based line, UTF-16 character. */
export interface IOutlinePosition {
    line: number;
    character: number;
}

/** A range of the outline. */
export interface IOutlineRange {
    start: IOutlinePosition;
    end: IOutlinePosition;
}

/** Where a definition is: the file, the statement, and the name in it. */
export interface IDefinitionPlace {
    file: string;
    range: IOutlineRange;
    /** The name as written; the statement's range where there is none. */
    selection: IOutlineRange;
}

/** What is looked for: the schema, or one of its objects. */
export type DefinitionTarget =
    | { kind: "schema"; schema: string }
    | { kind: "object"; schema: string; type: ObjectType; name: string };

/** An object of the outline, as far as this reads it. */
interface IOutlineEntry {
    name?: unknown;
    kind?: unknown;
    declared?: unknown;
    range?: IOutlineRange;
    selection_range?: IOutlineRange;
    source?: unknown;
}

/** The outline's member listing objects of a type. */
const MEMBERS: Record<ObjectType, string> = {
    table: "tables",
    view: "views",
    procedure: "routines",
    function: "routines",
    trigger: "triggers",
    event: "events",
    sequence: "sequences",
};

/** @returns The entries of an outline member, those that are objects. */
const entries = (value: unknown): IOutlineEntry[] => {
    return Array.isArray(value)
        ? value.filter((entry): entry is IOutlineEntry => {
            return typeof entry === "object" && entry !== null;
        })
        : [];
};

/**
 * @param list Entries.
 * @param name A name.
 *
 * @returns The entry of the name: as written, else in any case (the
 *          server's lower_case_table_names aside, a script may spell a
 *          name otherwise).
 */
const named = <T extends IOutlineEntry>(list: readonly T[],
    name: string): T | undefined => {
    return list.find((entry) => { return entry.name === name; })
        ?? list.find((entry) => {
            return typeof entry.name === "string"
                && entry.name.toLowerCase() === name.toLowerCase();
        });
};

/**
 * @param outline The outline.
 * @param entry An entry of it.
 * @param script The development script, which the outline was made of.
 *
 * @returns Where the entry is, or nothing for one without a range.
 */
const placeOf = (outline: Record<string, unknown>, entry: IOutlineEntry,
    script: string): IDefinitionPlace | undefined => {
    if (entry.range === undefined) {
        return undefined;
    }
    let file = script;
    if (typeof entry.source === "number") {
        const include = entries(outline.includes)[entry.source] as
            { file?: unknown } | undefined;
        if (typeof include?.file !== "string") {
            return undefined;
        }
        file = include.file;
    }

    return { file, range: entry.range,
        selection: entry.selection_range ?? entry.range };
};

/**
 * Finds where a schema or one of its objects is defined.
 *
 * @param outline mariadb-lsp's outline of the development script.
 * @param target What to find.
 * @param script The development script's path.
 *
 * @returns Where it is, or nothing where the script does not define it
 *          (a schema it does not declare, an object it does not create).
 */
export const definitionOf = (
    outline: unknown,
    target: DefinitionTarget,
    script: string,
): IDefinitionPlace | undefined => {
    if (typeof outline !== "object" || outline === null) {
        return undefined;
    }
    const top = outline as Record<string, unknown>;
    const schemas = entries(top.schemas) as Array<IOutlineEntry
        & Record<string, unknown>>;
    // The project's schema by name, else every schema: a script may name
    // it through a placeholder (`${schema_name}`).
    const own = named(schemas, target.schema);
    if (target.kind === "schema") {
        const declared = own?.declared === true ? own : schemas.find(
            (schema) => { return schema.declared === true; });

        return declared === undefined ? undefined
            : placeOf(top, declared, script);
    }
    const ordered = own === undefined ? schemas
        : [own, ...schemas.filter((schema) => { return schema !== own; })];
    for (const schema of ordered) {
        const candidates = entries(schema[MEMBERS[target.type]])
            .filter((entry) => {
                // A procedure and a function may share a name.
                return MEMBERS[target.type] !== "routines"
                    || entry.kind === undefined || entry.kind === target.type;
            });
        const found = named(candidates, target.name);
        if (found !== undefined) {
            return placeOf(top, found, script);
        }
    }

    return undefined;
};
