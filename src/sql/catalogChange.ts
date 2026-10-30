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
 * A statement that starts with a keyword changing what a connection holds:
 * its schemas, tables, views, routines, events, REST Service - past blanks
 * and comments, and into an executable comment (`/*!50001 CREATE ...`,
 * `/*M! ...`), which the server runs and a dump writes views in. Only the
 * first keyword counts, so a `CREATE` in a literal or later in the
 * statement is no match.
 */
const CHANGES_CATALOG = new RegExp(
    "^(?:\\s+"
    + "|/\\*(?!M?!)[\\s\\S]*?\\*/"
    + "|--(?:\\s[^\\n]*)?(?:\\n|$)"
    + "|#[^\\n]*(?:\\n|$))*"
    + "(?:/\\*M?!\\d*\\s*)?"
    + "(?:CREATE|ALTER|DROP|RENAME)\\b",
    "i",
);

/**
 * @param statement One statement's text, as the script was split.
 *
 * @returns Whether running it changes a connection's catalog - what the
 *          Connections view lists under it and the language server
 *          completes from.
 */
export const changesCatalog = (statement: string): boolean => {
    return CHANGES_CATALOG.test(statement);
};
