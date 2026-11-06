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
 * The data types a column can be given, as the schema diagram's column
 * editor offers them: every type MariaDB has, the ones that take a length
 * with Workbench's default length, and the ones that need values typed in
 * (ENUM, SET, VECTOR) left open after their parenthesis.
 */

/** A data type to pick for a column. */
export interface IColumnTypeChoice {
    /** What the list shows, and what is matched against what is typed. */
    label: string;
    /** What picking it writes. */
    insert: string;
    /** Whether that is the whole type: false where values follow. */
    complete: boolean;
}

/**
 * @param label The type as listed.
 * @param insert What picking it writes, where that differs.
 *
 * @returns The choice.
 */
const choice = (label: string, insert = label): IColumnTypeChoice => {
    return { label, insert, complete: !insert.endsWith("(") };
};

/** Every column type, alphabetically. */
export const COLUMN_TYPES: readonly IColumnTypeChoice[] = [
    choice("BIGINT"),
    choice("BIGINT UNSIGNED"),
    choice("BINARY(16)"),
    choice("BIT(1)"),
    choice("BLOB"),
    choice("BOOLEAN"),
    choice("CHAR(1)"),
    choice("DATE"),
    choice("DATETIME"),
    choice("DECIMAL(10,2)"),
    choice("DOUBLE"),
    choice("ENUM(…)", "ENUM("),
    choice("FLOAT"),
    choice("GEOMETRY"),
    choice("GEOMETRYCOLLECTION"),
    choice("INET4"),
    choice("INET6"),
    choice("INT"),
    choice("INT UNSIGNED"),
    choice("JSON"),
    choice("LINESTRING"),
    choice("LONGBLOB"),
    choice("LONGTEXT"),
    choice("MEDIUMBLOB"),
    choice("MEDIUMINT"),
    choice("MEDIUMTEXT"),
    choice("MULTILINESTRING"),
    choice("MULTIPOINT"),
    choice("MULTIPOLYGON"),
    choice("POINT"),
    choice("POLYGON"),
    choice("SET(…)", "SET("),
    choice("SMALLINT"),
    choice("TEXT"),
    choice("TIME"),
    choice("TIMESTAMP"),
    choice("TINYBLOB"),
    choice("TINYINT"),
    choice("TINYTEXT"),
    choice("UUID"),
    choice("VARBINARY(255)"),
    choice("VARCHAR(45)"),
    choice("VECTOR(…)", "VECTOR("),
    choice("YEAR"),
];

/** The type picked when nothing is typed yet. */
export const PREFERRED_COLUMN_TYPE = "UUID";

/**
 * @param typed What is typed for the type, in any case.
 * @param choices The types to pick from.
 *
 * @returns The types that start with it, in their order; every one where
 *          nothing is typed.
 */
export const matchingTypes = (
    typed: string,
    choices: readonly IColumnTypeChoice[] = COLUMN_TYPES,
): IColumnTypeChoice[] => {
    const prefix = typed.trim().toUpperCase();

    return choices.filter((entry) => {
        return entry.label.toUpperCase().startsWith(prefix)
            || entry.insert.toUpperCase().startsWith(prefix);
    });
};
