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
 * Tells SQL from TypeScript in a notebook cell, from how it starts. Free of
 * `vscode`: the switcher asks it, and only switches a cell where it is sure.
 */

import { MARIADB_SQL_LANGUAGE_ID } from "../editor/sqlLanguage.js";

/** The language of a TypeScript cell. */
export const TYPESCRIPT_LANGUAGE_ID = "typescript";

/** What a cell can be told to be. */
export type CellLanguage =
    typeof MARIADB_SQL_LANGUAGE_ID | typeof TYPESCRIPT_LANGUAGE_ID;

/**
 * The words a MariaDB statement starts with. Matched without regard to
 * case, but see `AMBIGUOUS` for those TypeScript starts with too.
 */
const SQL_STARTS = new Set([
    "alter", "analyze", "backup", "begin", "binlog", "cache", "call",
    "change", "check", "checksum", "commit", "create", "deallocate",
    "declare", "delete", "delimiter", "desc", "describe", "do", "drop",
    "execute", "explain", "flush", "get", "grant", "handler", "help",
    "insert", "install", "kill", "load", "lock", "optimize", "prepare",
    "purge", "release", "rename", "repair", "replace", "reset", "resignal",
    "revoke", "rollback", "savepoint", "select", "set", "show", "shutdown",
    "signal", "start", "stop", "table", "truncate", "uninstall", "unlock",
    "update", "use", "values", "with", "xa",
]);

/**
 * The words a TypeScript statement starts with, and SQL does not. A cell
 * starting with one is TypeScript, whatever follows.
 */
const TYPESCRIPT_STARTS = new Set([
    "abstract", "async", "await", "break", "class", "const", "console",
    "continue", "debugger", "enum", "export", "for", "function", "if",
    "import", "interface", "let", "namespace", "print", "return", "runSql",
    "switch", "throw", "try", "type", "var", "while", "yield",
]);

/**
 * The words both start statements with: `delete obj.key` and `DELETE FROM
 * t`, `do { } while ()` and `DO 1`, `set(...)` and `SET @a = 1`. One is SQL
 * where what follows reads as SQL - see `looksLikeSql`.
 */
const AMBIGUOUS = new Set(["delete", "do", "get", "set", "with"]);

/**
 * Drops the comments a cell opens with, saying which language's they were
 * where only one of them has that kind.
 *
 * @param text The cell's text.
 *
 * @returns The text from its first code on, and the language its comments
 *          alone point to: `--` and `#` are SQL's, `//` TypeScript's;
 *          `/* *\/` is both's.
 */
const dropComments = (
    text: string,
): { rest: string; hint?: CellLanguage } => {
    let rest = text.trimStart();
    let hint: CellLanguage | undefined;

    for (;;) {
        if (/^--(\s|$)/.test(rest) || rest.startsWith("#")) {
            hint ??= MARIADB_SQL_LANGUAGE_ID;
        } else if (rest.startsWith("//")) {
            hint ??= TYPESCRIPT_LANGUAGE_ID;
        } else if (rest.startsWith("/*")) {
            // A MariaDB executable comment is SQL to run.
            if (rest.startsWith("/*!") || rest.startsWith("/*M!")) {
                return { rest, hint: hint ?? MARIADB_SQL_LANGUAGE_ID };
            }
            const end = rest.indexOf("*/");
            if (end === -1) {
                return { rest: "", hint };
            }
            rest = rest.slice(end + 2).trimStart();
            continue;
        } else {
            return { rest, hint };
        }

        const end = rest.indexOf("\n");
        rest = end === -1 ? "" : rest.slice(end + 1).trimStart();
    }
};

/**
 * Whether what follows a word both languages start with reads as SQL.
 *
 * @param word The word, as written.
 * @param after What follows it.
 *
 * @returns True for SQL, false for TypeScript.
 */
const looksLikeSql = (word: string, after: string): boolean => {
    // `set(`, `delete obj.key`, `with.x`: a call, a property, an
    // assignment are TypeScript.
    if (/^\s*[(.[=]/.test(after) && !/^\s*==/.test(after)) {
        return /^\s*\(/.test(after) && word === word.toUpperCase()
            && word !== word.toLowerCase();
    }
    if (/^\s*\{/.test(after)) {
        return false;
    }

    const next = /^\s*([@\w`]+)\s*([^\s\w]?)/.exec(after);
    if (next === null) {
        // `DO` or `SET` and nothing yet: written upper case, it is SQL.
        return word === word.toUpperCase();
    }
    const [, nextWord, punctuation] = next;
    if (nextWord.startsWith("@") || nextWord.startsWith("`")) {
        return true;
    }

    switch (word.toLowerCase()) {
        case "delete": {
            // `delete obj.key` / `delete obj[key]`; DELETE takes FROM, a
            // modifier, or the tables it deletes from before FROM.
            return punctuation !== "." && punctuation !== "[";
        }

        case "with": {
            // A common table expression: WITH [RECURSIVE] name AS ( / (cols).
            return true;
        }

        default:
            // DO / GET / SET followed by a word: `SET NAMES`, `SET GLOBAL x`,
            // `GET DIAGNOSTICS`, `DO SLEEP(1)`.
            return punctuation !== "." && punctuation !== "[";
    }
};

/**
 * Tells the language of a notebook cell from how it starts.
 *
 * @param text The cell's text.
 *
 * @returns The language, or undefined where the start does not settle it -
 *          an empty cell, or one that could be either so far.
 */
export const detectLanguage = (text: string): CellLanguage | undefined => {
    const { rest, hint } = dropComments(text);
    if (rest.length === 0) {
        return hint;
    }

    // A literal, a block or an arrow function: only TypeScript starts so.
    if (/^["'`{[!\d]/.test(rest) || rest.startsWith("$")) {
        return TYPESCRIPT_LANGUAGE_ID;
    }

    // `(SELECT ...) UNION (SELECT ...)` against `(async () => ...)()`.
    if (rest.startsWith("(")) {
        return /^\(\s*(select|with|values|table)\b/i.test(rest)
            ? MARIADB_SQL_LANGUAGE_ID
            : TYPESCRIPT_LANGUAGE_ID;
    }

    const match = /^([A-Za-z_]\w*)/.exec(rest);
    if (match === null) {
        return hint;
    }
    const word = match[1];
    const after = rest.slice(word.length);

    if (TYPESCRIPT_STARTS.has(word)) {
        return TYPESCRIPT_LANGUAGE_ID;
    }

    const lower = word.toLowerCase();
    if (AMBIGUOUS.has(lower)) {
        if (after.trim().length === 0 && word !== word.toUpperCase()) {
            // `set` alone: either, until more is typed.
            return hint;
        }

        return looksLikeSql(word, after)
            ? MARIADB_SQL_LANGUAGE_ID
            : TYPESCRIPT_LANGUAGE_ID;
    }

    if (SQL_STARTS.has(lower)) {
        // `select(...)`, `update.x`: a function or an object of that name.
        return /^\s*[.=[]/.test(after) && !/^\s*==/.test(after)
            || (/^\(/.test(after) && word !== word.toUpperCase())
            ? TYPESCRIPT_LANGUAGE_ID
            : MARIADB_SQL_LANGUAGE_ID;
    }

    // Any other name is TypeScript once it is used: called, a property
    // read, assigned. A bare word is either, until more is typed.
    if (/^\s*(\(|\.|\[|=(?!=)|\+\+|--|\?\.|<)/.test(after)) {
        return TYPESCRIPT_LANGUAGE_ID;
    }

    return hint;
};
