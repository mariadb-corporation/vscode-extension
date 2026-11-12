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
import { samePath, servicePathParts } from "./restSql.js";
import type { IRestObjectDefinition } from "../modeler/modelFormat.js";

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

/** What every `CREATE REST ...` statement of a script says. */
interface IRestEntryBase {
    /** Where the statement starts in the text read, comments before it left out. */
    start: number;
    /** Where it ends, its delimiter included. */
    end: number;
    /** The line it starts on in the text read, counted from 0. */
    line: number;
    /** The service's `[devs@]/path`. */
    servicePath: string;
    enabled: EnabledState;
    requiresAuth: boolean;
    published: boolean;
    comments: string | null;
}

/** A `CREATE REST SERVICE`. */
export interface IRestServiceEntry extends IRestEntryBase {
    kind: "service";
}

/** A `CREATE REST SCHEMA`. */
export interface IRestSchemaEntry extends IRestEntryBase {
    kind: "schema";
    schemaPath: string;
    /** The database schema it is of. */
    dbSchema: string;
}

/** A `CREATE REST VIEW`, `PROCEDURE` or `FUNCTION`. */
export interface IRestObjectEntry extends IRestEntryBase {
    kind: "object";
    schemaPath: string;
    requestPath: string;
    /** Where the statement names one. */
    dbSchema?: string;
    dbObject: string;
    objectType: MrsObjectType;
}

/** What a `CREATE REST ...` statement of a script creates. */
export type IRestScriptEntry = IRestServiceEntry | IRestSchemaEntry
    | IRestObjectEntry;

/** An entry as one statement says it, before it is placed in a text. */
type RestStatement<T> = T extends unknown
    ? Omit<T, "start" | "end" | "line"> : never;

/** A word of a statement: a keyword, a name, a path or a text. */
interface IToken {
    /** It without its quotes. */
    text: string;
    /** A qualified name's parts, `schema` and `name`. */
    parts: string[];
    /** Whether it is a text in single or double quotes. */
    quoted: boolean;
    /** Whether any of it is in backticks: a name, never a keyword. */
    identifier: boolean;
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
 * @param at A place in it.
 *
 * @returns Where the text goes on after the comment that starts there -
 *          `-- `, `#` up to the line's end, or `/* ... *\/` - or undefined
 *          where none starts there.
 */
const afterComment = (sql: string, at: number): number | undefined => {
    if (sql.startsWith("--", at) || sql[at] === "#") {
        const end = sql.indexOf("\n", at);

        return end < 0 ? sql.length : end;
    }
    if (sql.startsWith("/*", at)) {
        const end = sql.indexOf("*/", at + 2);

        return end < 0 ? sql.length : end + 2;
    }

    return undefined;
};

/**
 * @param sql A text.
 * @param at A place in it.
 *
 * @returns Where the text goes on after the comment or the quoted text
 *          that starts there, whose braces open or close nothing; undefined
 *          where neither starts there.
 */
const afterTrivia = (sql: string, at: number): number | undefined => {
    const char = sql[at];

    return char === "'" || char === "\"" || char === "`"
        ? quotedAt(sql, at).next : afterComment(sql, at);
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
        const skipped = afterTrivia(sql, i);
        if (skipped !== undefined) {
            i = skipped;
            continue;
        }
        const char = sql[i]!;
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
    const part = (text: string, identifier = false): void => {
        current ??= { text: "", parts: [""], quoted: false, identifier };
        current.identifier ||= identifier;
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
        const comment = afterComment(sql, i);
        if (comment !== undefined) {
            close();
            i = comment;
        } else if (char === "'" || char === "\"") {
            close();
            const { text, next } = quotedAt(sql, i);
            tokens.push({ text, parts: [text], quoted: true,
                identifier: false });
            i = next;
        } else if (char === "`") {
            const { text, next } = quotedAt(sql, i);
            part(text, true);
            i = next;
        } else if (char === "," && current !== undefined
            && i + 1 < sql.length && !/[\s;(),]/u.test(sql[i + 1]!)) {
            // A service's developers, `mike,anna@/svc`: one path.
            part(char);
            i += 1;
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

            return token !== undefined && !token.quoted && !token.identifier
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

        return token !== undefined && !token.quoted && !token.identifier
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
const flagsOf = (tokens: IToken[]): Pick<IRestEntryBase,
    "enabled" | "requiresAuth" | "published" | "comments"> => {
    const words = tokens.map((token) => {
        return token.quoted || token.identifier ? ""
            : token.text.toUpperCase();
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
): RestStatement<IRestScriptEntry> | undefined => {
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
 * @param text A text.
 * @param offset A place in it.
 * @param from A place before it, and the line that is on.
 * @param from.offset The place.
 * @param from.line Its line.
 *
 * @returns The line the place is on, counted from 0.
 */
export const lineOf = (
    text: string,
    offset: number,
    from = { offset: 0, line: 0 },
): number => {
    let line = from.line;
    for (let at = text.indexOf("\n", from.offset); at >= 0 && at < offset;
        at = text.indexOf("\n", at + 1)) {
        line += 1;
    }

    return line;
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
    let counted = { offset: 0, line: 0 };

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
        // Counted on from the last entry: the statements come in order.
        counted = { offset: span.contentStart,
            line: lineOf(sql, span.contentStart, counted) };
        entries.push({ ...entry, start: span.contentStart, end,
            line: counted.line });
    }

    return entries;
};

/**
 * @param statement A REST object's statement.
 *
 * @returns Its fields in the statement's GraphQL notation, a line each:
 *          its `{ ... }` blocks of fields, a routine's with the
 *          `PARAMETERS` or `RESULT` clause that names each, as written
 *          but for the indent they share. Its OPTIONS and METADATA, JSON
 *          values, are not fields.
 */
export const fieldLinesOf = (statement: string): string[] => {
    const lines: string[] = [];
    let from = 0;
    let i = 0;
    while (i < statement.length) {
        const skipped = afterTrivia(statement, i);
        if (skipped !== undefined) {
            i = skipped;
        } else if (statement[i] === "{") {
            const end = afterBlock(statement, i);
            const before = statement.slice(from, i);
            // The clause right before the block, its class name with it: a
            // path, a database object or a CLASS reading like one is none.
            const clause = new RegExp("(?<!\\b(?:AS|CLASS)\\s+)(?<!\\S)"
                + "((?:PARAMETERS|RESULT)(?:\\s+[^\\s{]+)?)\\s*$", "iu")
                .exec(before)?.[1];
            const word = /(\w+)\s*$/u.exec(before)?.[1]?.toUpperCase();
            if (word !== "OPTIONS" && word !== "METADATA") {
                const head = clause === undefined ? ""
                    : `${clause.replace(/\s+/gu, " ")} `;
                const block = `${head}${statement.slice(i, end)}`
                    .split(/\r?\n/u);
                // The block's lines after the first share the
                // statement's indent; its closing brace has the least.
                const indent = Math.min(...block.slice(1).filter((line) => {
                    return line.trim() !== "";
                }).map((line) => {
                    return /^\s*/u.exec(line)![0].length;
                }));
                lines.push(block[0]!, ...block.slice(1).map((line) => {
                    return line.slice(Number.isFinite(indent) ? indent : 0)
                        .trimEnd();
                }));
            }
            from = end;
            i = end;
        } else {
            i += 1;
        }
    }

    return lines;
};

/**
 * @param sql REST SQL: a project's MSM Section 180.
 *
 * @returns The REST objects it creates, each by its last statement, with
 *          their fields as written.
 */
export const restObjectDefinitions = (
    sql: string,
): IRestObjectDefinition[] => {
    return latest(parseRestScript(sql).filter(
        (entry): entry is IRestObjectEntry => {
            return entry.kind === "object";
        })).map((entry) => {
        return {
            servicePath: entry.servicePath,
            schemaPath: entry.schemaPath,
            requestPath: entry.requestPath,
            objectType: entry.objectType,
            ...(entry.dbSchema === undefined
                ? {} : { dbSchema: entry.dbSchema }),
            dbObject: entry.dbObject,
            lines: fieldLinesOf(sql.slice(entry.start, entry.end)),
        };
    });
};

/**
 * @param entry A `CREATE REST SERVICE` of a script.
 *
 * @returns The service, as far as the script says what a server would
 *          report of it.
 */
export const serviceOf = (entry: IRestServiceEntry): IMrsService => {
    const path = servicePathParts(entry.servicePath).path;

    return {
        id: restServiceId(entry.servicePath),
        url_context_root: path,
        full_service_path: entry.servicePath,
        name: path,
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
};

/**
 * @param entry A `CREATE REST SCHEMA` of a script.
 *
 * @returns The REST schema, as a server would report it.
 */
export const schemaOf = (entry: IRestSchemaEntry): IMrsSchema => {
    return {
        ...restSchemaIds(entry.servicePath, entry.schemaPath),
        name: entry.dbSchema,
        schema_type: "DATABASE_SCHEMA",
        request_path: entry.schemaPath,
        requires_auth: entry.requiresAuth,
        enabled: entry.enabled,
        items_per_page: null,
        comments: entry.comments,
        options: null,
        metadata: null,
    };
};

/**
 * @param servicePath A project's REST service.
 *
 * @returns The id a project's REST service has, in place of a server's.
 */
export const restServiceId = (servicePath: string): string => {
    return `service:${servicePath}`;
};

/**
 * @param servicePath A project's REST service.
 * @param schemaPath One of its REST schemas.
 *
 * @returns The ids a project's REST schema has, in place of a server's.
 */
export const restSchemaIds = (
    servicePath: string,
    schemaPath: string,
): Pick<IMrsSchema, "id" | "service_id"> => {
    return {
        id: `schema:${servicePath}:${schemaPath}`,
        service_id: restServiceId(servicePath),
    };
};

/**
 * @param servicePath A project's REST service.
 * @param schemaPath One of its REST schemas.
 * @param requestPath One of its objects.
 *
 * @returns The ids a project's REST object has, in place of a server's.
 */
export const restObjectIds = (
    servicePath: string,
    schemaPath: string,
    requestPath: string,
): Pick<IMrsObject, "id" | "rest_schema_id"> => {
    return {
        id: `object:${servicePath}:${schemaPath}:${requestPath}`,
        rest_schema_id: restSchemaIds(servicePath, schemaPath).id,
    };
};

/**
 * @param entry A `CREATE REST VIEW`, `PROCEDURE` or `FUNCTION` of a script.
 *
 * @returns The REST object, as a server would report it.
 */
export const objectOf = (entry: IRestObjectEntry): IMrsObject => {
    return {
        ...restObjectIds(entry.servicePath, entry.schemaPath,
            entry.requestPath),
        name: entry.dbObject,
        schema_name: entry.dbSchema ?? "",
        request_path: entry.requestPath,
        object_type: entry.objectType,
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
};

/**
 * @param entry A statement's entry.
 *
 * @returns What tells it from everything else a script creates: its kind
 *          and paths, as the server compares them.
 */
const entryKey = (entry: IRestScriptEntry): string => {
    const paths = entry.kind === "service" ? [entry.servicePath]
        : entry.kind === "schema" ? [entry.servicePath, entry.schemaPath]
            : [entry.servicePath, entry.schemaPath, entry.requestPath];

    return [entry.kind, ...paths].join("\n").toLowerCase();
};

/**
 * @param entries Entries of a script.
 *
 * @returns Each thing they create once, by its last statement: a script
 *          run in order leaves what its last `CREATE OR REPLACE` made, and
 *          the tree's rows are told apart by their paths.
 */
const latest = <T extends IRestScriptEntry>(entries: T[]): T[] => {
    const byKey = new Map<string, T>();
    for (const entry of entries) {
        const key = entryKey(entry);
        byKey.delete(key);
        byKey.set(key, entry);
    }

    return [...byKey.values()];
};

/**
 * @param entries What a script creates.
 *
 * @returns The `CREATE REST SERVICE`s among it.
 */
export const serviceEntries = (
    entries: IRestScriptEntry[],
): IRestServiceEntry[] => {
    return latest(entries.filter((entry): entry is IRestServiceEntry => {
        return entry.kind === "service";
    }));
};

/**
 * @param entries What a script creates.
 * @param servicePath A service.
 *
 * @returns The `CREATE REST SCHEMA`s on it.
 */
export const schemaEntries = (
    entries: IRestScriptEntry[],
    servicePath: string,
): IRestSchemaEntry[] => {
    return latest(entries.filter((entry): entry is IRestSchemaEntry => {
        return entry.kind === "schema"
            && samePath(entry.servicePath, servicePath);
    }));
};

/**
 * @param entries What a script creates.
 * @param servicePath A service.
 * @param schemaPath A REST schema on it.
 *
 * @returns The REST objects created on it.
 */
export const objectEntries = (
    entries: IRestScriptEntry[],
    servicePath: string,
    schemaPath: string,
): IRestObjectEntry[] => {
    return latest(entries.filter((entry): entry is IRestObjectEntry => {
        return entry.kind === "object"
            && samePath(entry.servicePath, servicePath)
            && samePath(entry.schemaPath, schemaPath);
    }));
};

/** Where a section's body is in a development script. */
interface ISectionSpan {
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
        line: lineOf(script, span.start),
    };
};
