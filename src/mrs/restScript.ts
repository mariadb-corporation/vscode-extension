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

import { hasContent, scanStatements } from "../sql/statementSpans.js";
import {
    ENABLED_STATE,
    type EnabledState,
    type IMrsObject,
    type IMrsSchema,
    type IMrsService,
    type MrsObjectType,
} from "./mrsTypes.js";

/**
 * REST SQL kept in a script instead of a server's metadata: the REST
 * services, schemas and objects an MSM project's development script
 * creates in its MSM Section 180, read from the statements themselves, and
 * the statements a dialog saves put among them.
 *
 * Only what the tree and the dialogs need is read of a statement: what it
 * creates, where, of which database object, and its access flags. Free of
 * `vscode`.
 */

/** The MSM section a project's REST statements are kept in. */
export const REST_SECTION = "180";

/** What a `CREATE REST ...` statement of a script creates. */
export interface IRestScriptEntry {
    kind: "service" | "schema" | "object";
    /** Where the statement starts in the text read, comments before it left out. */
    start: number;
    /** Where it ends, its delimiter included. */
    end: number;
    /** The service's `[devs@]/path`. */
    servicePath: string;
    /** The REST schema's path; a service has none. */
    schemaPath?: string;
    /** The REST object's path. */
    requestPath?: string;
    /** The database schema a REST schema or object is of. */
    dbSchema?: string;
    /** The database object a REST object is of. */
    dbObject?: string;
    objectType?: MrsObjectType;
    enabled: EnabledState;
    requiresAuth: boolean;
    published: boolean;
    comments: string | null;
}

/** A word of a statement: a keyword, a name, a path or a text. */
interface IToken {
    /** It without its quotes. */
    text: string;
    /** A qualified name's parts, `schema` and `name`. */
    parts: string[];
    /** Whether it is a text in single or double quotes. */
    quoted: boolean;
}

/**
 * @param sql A text.
 * @param at Where a quote opens.
 *
 * @returns What it quotes, a doubled quote and a backslash escape read as
 *          the server reads them, and where the text goes on after it.
 */
const quotedAt = (sql: string, at: number): { text: string; next: number } => {
    const quote = sql[at]!;
    let text = "";
    let i = at + 1;
    while (i < sql.length) {
        const char = sql[i]!;
        if (char === "\\" && quote !== "`" && i + 1 < sql.length) {
            text += sql[i + 1]!;
            i += 2;
        } else if (char === quote) {
            if (sql[i + 1] !== quote) {
                return { text, next: i + 1 };
            }
            text += quote;
            i += 2;
        } else {
            text += char;
            i += 1;
        }
    }

    return { text, next: i };
};

/**
 * @param sql A text.
 * @param at Where a `{` opens.
 *
 * @returns Where the text goes on after its `}`: a data mapping or a JSON
 *          value, whose words are not the statement's.
 */
const afterBlock = (sql: string, at: number): number => {
    let depth = 0;
    let i = at;
    while (i < sql.length) {
        const char = sql[i]!;
        if (char === "'" || char === "\"" || char === "`") {
            i = quotedAt(sql, i).next;
            continue;
        }
        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return i + 1;
            }
        }
        i += 1;
    }

    return i;
};

/**
 * @param sql One statement.
 *
 * @returns Its words in order, without its comments, data mappings and
 *          JSON values.
 */
const tokensOf = (sql: string): IToken[] => {
    const tokens: IToken[] = [];
    let current: IToken | undefined;
    const part = (text: string): void => {
        current ??= { text: "", parts: [""], quoted: false };
        current.parts[current.parts.length - 1] += text;
    };
    const close = (): void => {
        if (current !== undefined) {
            current.text = current.parts.join(".");
            tokens.push(current);
            current = undefined;
        }
    };

    let i = 0;
    while (i < sql.length) {
        const char = sql[i]!;
        if (sql.startsWith("--", i) || char === "#") {
            close();
            const end = sql.indexOf("\n", i);
            i = end < 0 ? sql.length : end;
        } else if (sql.startsWith("/*", i)) {
            close();
            const end = sql.indexOf("*/", i + 2);
            i = end < 0 ? sql.length : end + 2;
        } else if (char === "'" || char === "\"") {
            close();
            const { text, next } = quotedAt(sql, i);
            tokens.push({ text, parts: [text], quoted: true });
            i = next;
        } else if (char === "`") {
            const { text, next } = quotedAt(sql, i);
            part(text);
            i = next;
        } else if (char === "{") {
            close();
            i = afterBlock(sql, i);
        } else if (/[\s;(),}]/u.test(char)) {
            close();
            i += 1;
        } else if (char === "." && current !== undefined) {
            current.parts.push("");
            i += 1;
        } else {
            part(char);
            i += 1;
        }
    }
    close();

    return tokens;
};

/** Reads a statement's words one after the other. */
class Words {
    #at = 0;

    public constructor(private readonly tokens: IToken[]) { }

    /**
     * @param keywords Keywords, in order.
     *
     * @returns Whether they come next; they are then passed.
     */
    public take(...keywords: string[]): boolean {
        const found = keywords.every((keyword, index) => {
            const token = this.tokens[this.#at + index];

            return token !== undefined && !token.quoted
                && token.text.toUpperCase() === keyword;
        });
        if (found) {
            this.#at += keywords.length;
        }

        return found;
    }

    /** @returns The next word, which is then passed. */
    public next(): IToken | undefined {
        const token = this.tokens[this.#at];
        this.#at += 1;

        return token;
    }

    /** @returns Whether a keyword comes next, which is not passed. */
    public at(...keywords: string[]): boolean {
        const token = this.tokens[this.#at];

        return token !== undefined && !token.quoted
            && keywords.includes(token.text.toUpperCase());
    }

    /** @returns The words not read yet. */
    public rest(): IToken[] {
        return this.tokens.slice(this.#at);
    }
}

/**
 * @param tokens The words after what a statement creates and where.
 *
 * @returns The access flags among them.
 */
const flagsOf = (tokens: IToken[]): Pick<IRestScriptEntry,
    "enabled" | "requiresAuth" | "published" | "comments"> => {
    const words = tokens.map((token) => {
        return token.quoted ? "" : token.text.toUpperCase();
    });
    const has = (...sequence: string[]): boolean => {
        return words.some((_, at) => {
            return sequence.every((word, index) => {
                return words[at + index] === word;
            });
        });
    };
    const comment = words.indexOf("COMMENT");
    const text = comment < 0 ? undefined : tokens[comment + 1];

    return {
        enabled: has("DISABLED") ? ENABLED_STATE.disabled
            : has("PRIVATE") ? ENABLED_STATE.private : ENABLED_STATE.enabled,
        requiresAuth: has("AUTHENTICATION", "REQUIRED"),
        published: has("PUBLISHED"),
        comments: text?.quoted === true && text.text !== "" ? text.text : null,
    };
};

/** A REST object's keyword, and the kind of database object it serves. */
const OBJECT_KEYWORDS: Record<string, MrsObjectType> = {
    VIEW: "VIEW", PROCEDURE: "PROCEDURE", FUNCTION: "FUNCTION",
};

/**
 * @param sql One statement.
 * @param last The service and REST schema the script created last, which
 *             a statement naming none is taken to mean.
 * @param last.servicePath The service.
 * @param last.schemaPath The REST schema.
 *
 * @returns What it creates, where it is a `CREATE REST SERVICE`, `SCHEMA`,
 *          `VIEW`, `PROCEDURE` or `FUNCTION`.
 */
const entryOf = (
    sql: string,
    last: { servicePath?: string; schemaPath?: string },
): Omit<IRestScriptEntry, "start" | "end"> | undefined => {
    const words = new Words(tokensOf(sql));
    if (!words.take("CREATE")) {
        return undefined;
    }
    words.take("OR", "REPLACE");
    if (!words.take("REST")) {
        return undefined;
    }

    if (words.take("SERVICE")) {
        words.take("IF", "NOT", "EXISTS");
        const path = words.next();

        return path === undefined ? undefined
            : { kind: "service", servicePath: path.text,
                ...flagsOf(words.rest()) };
    }

    if (words.take("SCHEMA") || words.take("DATABASE")) {
        words.take("IF", "NOT", "EXISTS");
        const path = words.at("ON", "FROM") ? undefined : words.next();
        let servicePath = last.servicePath;
        if (words.take("ON")) {
            words.take("SERVICE");
            servicePath = words.next()?.text;
        }
        const dbSchema = words.take("FROM") ? words.next()?.text : undefined;
        if (servicePath === undefined || dbSchema === undefined) {
            return undefined;
        }

        return { kind: "schema", servicePath,
            schemaPath: path?.text ?? `/${dbSchema}`, dbSchema,
            ...flagsOf(words.rest()) };
    }

    // CREATE REST [DATA] [MAPPING] VIEW is a view by its full name.
    words.take("DATA");
    words.take("MAPPING");
    const objectType = OBJECT_KEYWORDS[
        words.next()?.text.toUpperCase() ?? ""];
    if (objectType === undefined) {
        return undefined;
    }
    words.take("IF", "NOT", "EXISTS");
    const path = words.next();
    let { servicePath, schemaPath } = last;
    if (words.take("ON")) {
        if (words.take("SERVICE")) {
            servicePath = words.next()?.text;
        }
        if (words.take("SCHEMA") || words.take("DATABASE")) {
            schemaPath = words.next()?.text;
        }
    }
    const source = words.take("AS") ? words.next() : undefined;
    if (path === undefined || servicePath === undefined
        || schemaPath === undefined || source === undefined) {
        return undefined;
    }

    return {
        kind: "object", servicePath, schemaPath, requestPath: path.text,
        ...(source.parts.length > 1 ? { dbSchema: source.parts[0]! } : {}),
        dbObject: source.parts.at(-1)!,
        objectType,
        ...flagsOf(words.rest()),
    };
};

/**
 * @param sql REST SQL: a project's MSM Section 180.
 *
 * @returns The REST services, schemas and objects it creates, in the
 *          script's order.
 */
export const parseRestScript = (sql: string): IRestScriptEntry[] => {
    const entries: IRestScriptEntry[] = [];
    const last: { servicePath?: string; schemaPath?: string } = {};

    for (const span of scanStatements(sql)) {
        if (!hasContent(span)) {
            continue;
        }
        const end = span.span.start + span.span.length;
        const entry = entryOf(sql.slice(span.contentStart, end), last);
        if (entry === undefined) {
            continue;
        }
        if (entry.kind === "service") {
            last.servicePath = entry.servicePath;
            delete last.schemaPath;
        } else if (entry.kind === "schema") {
            last.servicePath = entry.servicePath;
            last.schemaPath = entry.schemaPath;
        }
        entries.push({ ...entry, start: span.contentStart, end });
    }

    return entries;
};

/** Paths are compared as the server compares them: whatever their case. */
const samePath = (left?: string, right?: string): boolean => {
    return left?.toLowerCase() === right?.toLowerCase();
};

/**
 * @param left What a statement creates.
 * @param right What another one does.
 *
 * @returns Whether both create the same thing.
 */
const sameEntry = (
    left: Omit<IRestScriptEntry, "start" | "end">,
    right: Omit<IRestScriptEntry, "start" | "end">,
): boolean => {
    return left.kind === right.kind
        && samePath(left.servicePath, right.servicePath)
        && samePath(left.schemaPath, right.schemaPath)
        && samePath(left.requestPath, right.requestPath);
};

/**
 * @param path A service's `[devs@]/path`.
 *
 * @returns Its request path.
 */
const contextRoot = (path: string): string => {
    return path.slice(path.lastIndexOf("@/") + 1);
};

/**
 * @param entries What a script creates.
 *
 * @returns Its REST services, as far as the script says what a server
 *          would report of them.
 */
export const scriptServices = (entries: IRestScriptEntry[]): IMrsService[] => {
    return entries.filter((entry) => { return entry.kind === "service"; })
        .map((entry) => {
            return {
                id: `service:${entry.servicePath}`,
                url_context_root: contextRoot(entry.servicePath),
                full_service_path: entry.servicePath,
                name: contextRoot(entry.servicePath),
                enabled: entry.enabled === ENABLED_STATE.disabled ? 0 : 1,
                published: entry.published,
                comments: entry.comments,
                options: null,
                metadata: null,
                auth_path: null,
                auth_completed_url: null,
                auth_completed_url_validation: null,
                auth_completed_page_content: null,
                in_development: null,
            };
        });
};

/**
 * @param entries What a script creates.
 * @param servicePath A service.
 *
 * @returns The REST schemas the script creates on it.
 */
export const scriptSchemas = (
    entries: IRestScriptEntry[],
    servicePath: string,
): IMrsSchema[] => {
    return entries.filter((entry) => {
        return entry.kind === "schema"
            && samePath(entry.servicePath, servicePath);
    }).map((entry) => {
        return {
            id: `schema:${entry.servicePath}:${entry.schemaPath!}`,
            service_id: `service:${entry.servicePath}`,
            name: entry.dbSchema!,
            schema_type: "DATABASE_SCHEMA",
            request_path: entry.schemaPath!,
            requires_auth: entry.requiresAuth,
            enabled: entry.enabled,
            items_per_page: null,
            comments: entry.comments,
            options: null,
            metadata: null,
        };
    });
};

/**
 * @param entries What a script creates.
 * @param servicePath A service.
 * @param schemaPath A REST schema on it.
 *
 * @returns The REST objects the script creates on it.
 */
export const scriptObjects = (
    entries: IRestScriptEntry[],
    servicePath: string,
    schemaPath: string,
): IMrsObject[] => {
    return entries.filter((entry) => {
        return entry.kind === "object"
            && samePath(entry.servicePath, servicePath)
            && samePath(entry.schemaPath, schemaPath);
    }).map((entry) => {
        return {
            id: `object:${entry.servicePath}:${entry.schemaPath!}:`
                + entry.requestPath!,
            rest_schema_id: `schema:${entry.servicePath}:${entry.schemaPath!}`,
            name: entry.dbObject!,
            schema_name: entry.dbSchema ?? "",
            request_path: entry.requestPath!,
            object_type: entry.objectType!,
            crud_operations: [],
            format: "FEED",
            enabled: entry.enabled,
            requires_auth: entry.requiresAuth,
            items_per_page: null,
            media_type: null,
            auth_stored_procedure: null,
            comments: entry.comments,
            options: null,
            metadata: null,
        };
    });
};

/**
 * Puts statements a dialog saved among a script's REST SQL: a REST
 * service, schema or object the script creates already has its statement
 * replaced where it stands, as `CREATE OR REPLACE` says; anything else
 * goes last, after what it is created on.
 *
 * @param sql The script's REST SQL.
 * @param statements The statements to put there, each with its delimiter.
 *
 * @returns The REST SQL with them; what follows the last statement -
 *          blank lines before the next section - is kept.
 */
export const withRestStatements = (
    sql: string,
    statements: string[],
): string => {
    const tail = /\s*$/u.exec(sql)?.[0] ?? "";
    let body = sql.slice(0, sql.length - tail.length);

    for (const statement of statements) {
        const added = entryOf(statement, {});
        const existing = added === undefined ? undefined
            : parseRestScript(body).find((entry) => {
                return sameEntry(entry, added);
            });
        body = existing === undefined
            ? `${body}${body === "" ? "\n" : "\n\n"}${statement.trim()}`
            : body.slice(0, existing.start) + statement.trim()
                + body.slice(existing.end);
    }

    return body + (tail.includes("\n") ? tail : "\n");
};

/** Where a section's body is in a development script. */
export interface ISectionSpan {
    /** After the section's header. */
    start: number;
    /** Before the next section's header, or the script's end. */
    end: number;
}

/** A section's header: a box of `--` lines naming it on its second. */
const SECTION_HEADER
    = /^-- #+[ \t]*\r?\n-- MSM Section (\d+):.*\r?\n(?:--.*\r?\n)*?-- #+[ \t]*(?:\r?\n|$)/gmu;

/**
 * @param script An MSM development script.
 * @param sectionId A section's number, `180`.
 *
 * @returns Where the section's body is, or undefined where the script has
 *          no such section.
 */
export const sectionSpan = (
    script: string,
    sectionId: string,
): ISectionSpan | undefined => {
    let start: number | undefined;
    for (const header of script.matchAll(SECTION_HEADER)) {
        if (start !== undefined) {
            return { start, end: header.index };
        }
        if (header[1] === sectionId) {
            start = header.index + header[0].length;
        }
    }

    return start === undefined ? undefined : { start, end: script.length };
};

/**
 * @param script An MSM development script.
 *
 * @returns Its REST SQL - the body of MSM Section 180 - and the line it
 *          starts on, counted from 0; undefined where it has no such
 *          section.
 */
export const restSectionOf = (
    script: string,
): { sql: string; line: number } | undefined => {
    const span = sectionSpan(script, REST_SECTION);
    if (span === undefined) {
        return undefined;
    }

    return {
        sql: script.slice(span.start, span.end),
        line: script.slice(0, span.start).split("\n").length - 1,
    };
};

/**
 * @param script An MSM development script.
 * @param statements REST SQL statements a dialog saved.
 *
 * @returns The body of its MSM Section 180 with them, and where that body
 *          is in the script as it was.
 *
 * @throws Error where the script has no such section.
 */
export const restSectionEdit = (
    script: string,
    statements: string[],
): { span: ISectionSpan; sql: string } => {
    const span = sectionSpan(script, REST_SECTION);
    if (span === undefined) {
        throw new Error("The development script has no MSM Section "
            + `${REST_SECTION} (REST Service Definition) to keep REST `
            + "statements in.");
    }

    return {
        span,
        sql: withRestStatements(script.slice(span.start, span.end),
            statements),
    };
};
