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
 * The statements the Connections view runs on a schema or one of its
 * objects: `USE`, `DROP` and `SHOW CREATE`, and the definition picked out
 * of what `SHOW CREATE` answers. Built, never parsed.
 */

import type { ObjectType } from "../mcp/types.js";
import { quoteIdentifier } from "./queryBuilder.js";

/** A schema, or an object in one. */
export interface IObjectTarget {
    schema: string;
    /** Left out for the schema itself. */
    object?: { type: ObjectType; name: string };
}

/**
 * @param schema A schema.
 *
 * @returns The `USE` that makes it the session's default.
 */
export const useSchemaSql = (schema: string): string => {
    return `USE ${quoteIdentifier(schema)}`;
};

/**
 * @param target The schema or object.
 *
 * @returns Its name, qualified by its schema where it is an object.
 */
const qualifiedName = (target: IObjectTarget): string => {
    return target.object === undefined
        ? quoteIdentifier(target.schema)
        : `${quoteIdentifier(target.schema)}.`
        + `${quoteIdentifier(target.object.name)}`;
};

/**
 * @param target The schema or object.
 *
 * @returns The keyword it is dropped and shown with.
 */
const keywordOf = (target: IObjectTarget): string => {
    return target.object === undefined
        ? "DATABASE"
        : target.object.type.toUpperCase();
};

/**
 * @param target The schema or object.
 *
 * @returns The statement that drops it.
 */
export const dropSql = (target: IObjectTarget): string => {
    return `DROP ${keywordOf(target)} ${qualifiedName(target)};`;
};

/**
 * @param target The schema or object.
 *
 * @returns The `SHOW CREATE` that answers its definition.
 */
export const showCreateSql = (target: IObjectTarget): string => {
    return `SHOW CREATE ${keywordOf(target)} ${qualifiedName(target)}`;
};

/**
 * The definition in a row of `SHOW CREATE ...`: the `Create Table`,
 * `Create View`, `Create Function` (...) column, or a trigger's `SQL
 * Original Statement`. A sequence answers `Create Table` too.
 *
 * @param row The row.
 *
 * @returns The statement; undefined where the row has none - a routine's
 *          is NULL to a user without the privilege to see its body.
 */
export const createStatementOf = (
    row: Record<string, unknown> | undefined,
): string | undefined => {
    if (row === undefined) {
        return undefined;
    }
    const column = Object.keys(row).find((name) => {
        return /^Create /u.test(name) || name === "SQL Original Statement";
    });
    const value = column === undefined ? undefined : row[column];

    return typeof value === "string" && value !== "" ? value : undefined;
};
