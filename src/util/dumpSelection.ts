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
 * What a dump holds and which of it a load takes: the objects the Load
 * dialog's Objects tab lists from `util.inspect_dump`, the boxes unticked
 * there, and the load options they come to. Also the `.mariadb.dump.zip`
 * name a dump to one file gets.
 *
 * Plain data and pure functions, shared by the extension and the webview.
 *
 * The dialog keeps what is UNticked, and the load gets it as exclude
 * filters: names `util.inspect_dump` did not list (it lists 100 of each
 * kind) are then loaded, as they are in the shell.
 */

import type {
    IDumpInfo,
    IDumpSchemaInfo,
    UtilOptions,
} from "../mcp/utilApi.js";

/** What a dump written to one file is named with. */
export const ZIP_SUFFIX = ".mariadb.dump.zip";

/**
 * @param path A path.
 *
 * @returns Whether it names a dump in one file.
 */
export const isZipDump = (path: string): boolean => {
    return path.trim().toLowerCase().endsWith(ZIP_SUFFIX);
};

/**
 * Turns a dump's path into a zip's or back, as Dump to Self-Contained ZIP
 * File is ticked or unticked.
 *
 * @param path The path the dialog holds.
 * @param zip Whether the dump goes to one file.
 *
 * @returns The path with `.mariadb.dump.zip` at its end, or without it.
 */
export const withZipSuffix = (path: string, zip: boolean): string => {
    const trimmed = path.trim().replace(/[\\/]+$/u, "");
    if (trimmed === "") {
        return path;
    }
    if (zip) {
        return isZipDump(trimmed) ? trimmed : `${trimmed}${ZIP_SUFFIX}`;
    }

    return isZipDump(trimmed) ? trimmed.slice(0, -ZIP_SUFFIX.length) : path;
};

/**
 * A name for a filter option, `schema.table`: quoted where the shell would
 * not read it otherwise.
 *
 * @param name A schema's or an object's name.
 *
 * @returns It, in backticks where it needs them.
 */
export const quoteName = (name: string): string => {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/u.test(name)
        ? name : `\`${name.replaceAll("`", "``")}\``;
};

/** The kinds of a schema's objects the dialog lists, in its order. */
export type DumpGroup =
    | "tables" | "views" | "functions" | "procedures" | "events";

export const DUMP_GROUPS: ReadonlyArray<{
    group: DumpGroup;
    label: string;
    count: "table_count" | "view_count" | "function_count"
        | "procedure_count" | "event_count";
}> = [
    { group: "tables", label: "Tables", count: "table_count" },
    { group: "views", label: "Views", count: "view_count" },
    { group: "functions", label: "Functions", count: "function_count" },
    { group: "procedures", label: "Procedures", count: "procedure_count" },
    { group: "events", label: "Events", count: "event_count" },
];

// --- the boxes, by key ---------------------------------------------------------

/** The box of a whole schema. */
export const schemaKey = (schema: string): string => {
    return JSON.stringify(["schema", schema]);
};

/** The box of one kind of a schema's objects: its Tables, say. */
export const groupKey = (schema: string, group: DumpGroup): string => {
    return JSON.stringify(["group", schema, group]);
};

/** The box of one object. */
export const objectKey = (schema: string, group: DumpGroup,
    name: string): string => {
    return JSON.stringify([group, schema, name]);
};

/** The box of the user accounts as a whole. */
export const USERS_KEY = JSON.stringify(["users"]);

/** The box of one account. */
export const userKey = (account: string): string => {
    return JSON.stringify(["user", account]);
};

/**
 * @param excluded The boxes unticked.
 * @param keys A box and the boxes above it.
 *
 * @returns Whether it is loaded: neither it nor a box above it unticked.
 */
export const isIncluded = (
    excluded: ReadonlySet<string>,
    ...keys: string[]
): boolean => {
    return keys.every((key) => { return !excluded.has(key); });
};

// --- where a dump may go -------------------------------------------------------

/**
 * @param info The dump.
 * @param intoSchema The schema it is loaded into, if any.
 *
 * @returns Whether its user accounts can be loaded: an instance dump's,
 *          loaded as it was dumped.
 */
export const offersUsers = (info: IDumpInfo, intoSchema?: string): boolean => {
    return intoSchema === undefined && info.includes_users;
};

/**
 * What keeps a dump from being loaded where the dialog was opened.
 *
 * @param info The dump.
 * @param intoSchema The schema Load Table Dump was opened on; undefined for
 *                   a connection's Load Dump.
 *
 * @returns Why it cannot be, or undefined where it can.
 */
export const dumpProblem = (
    info: IDumpInfo,
    intoSchema?: string,
): string | undefined => {
    if (!info.complete) {
        return "This dump is not complete: it is still being written, or it "
            + "stopped before the end. Only a complete dump can be loaded.";
    }
    const schemas = info.schemas.map((schema) => { return schema.name; });

    if (intoSchema === undefined) {
        return info.kind === "dumpTables"
            ? `This is a dump of tables of ${schemas.join(", ")}. Load it `
                + "into a schema with the schema's Load and Dump > Load Table "
                + "Dump from Disk..."
            : undefined;
    }

    // The shell's schema option takes a dump of one schema only.
    if (info.kind === "dumpTables"
        || (info.kind === "dumpSchemas" && info.schema_count === 1)) {
        return undefined;
    }

    return `This is a dump of ${info.kind === "dumpInstance"
        ? "a whole server" : `${String(info.schema_count)} schemas`}. Only `
        + `a table dump, or a dump of one schema, can be loaded into `
        + `${intoSchema}. Load this one with the connection's Load and Dump > `
        + "Load Dump from Disk...";
};

/**
 * The boxes unticked when the dialog opens: the user accounts, as the shell
 * does not load them by default; and, loading one schema's dump into
 * another schema, its routines and events, which would otherwise land
 * there with the tables wanted.
 *
 * @param info The dump.
 * @param intoSchema The schema it is loaded into, if any.
 *
 * @returns The keys of those boxes.
 */
export const initialExcluded = (
    info: IDumpInfo,
    intoSchema?: string,
): string[] => {
    const excluded = [USERS_KEY];
    if (intoSchema !== undefined && info.kind !== "dumpTables") {
        for (const schema of info.schemas) {
            for (const group of ["functions", "procedures", "events"] as const) {
                excluded.push(groupKey(schema.name, group));
            }
        }
    }

    return excluded;
};

// --- the load options ----------------------------------------------------------

/**
 * @param schema A schema of the dump.
 * @param group A kind of its objects.
 *
 * @returns Whether `util.inspect_dump` left names of it out.
 */
export const isCapped = (schema: IDumpSchemaInfo, group: DumpGroup): boolean => {
    const count = DUMP_GROUPS.find((entry) => { return entry.group === group; })!
        .count;

    return schema[count] > schema[group].length;
};

/**
 * The schemas whose every name the options need, as a whole kind of their
 * objects is unticked while the dump listed only some of its names.
 *
 * @param info The dump.
 * @param excluded The boxes unticked.
 *
 * @returns Their names, to inspect with the call's `schema` argument.
 */
export const schemasToComplete = (
    info: IDumpInfo,
    excluded: Iterable<string>,
): string[] => {
    const out = new Set(excluded);

    return info.schemas.filter((schema) => {
        return !out.has(schemaKey(schema.name))
            && DUMP_GROUPS.some(({ group }) => {
                return out.has(groupKey(schema.name, group))
                    && isCapped(schema, group);
            });
    }).map((schema) => { return schema.name; });
};

/**
 * @param info The dump.
 * @param full The dump inspected with the `schema` argument: that schema
 *             with every name.
 *
 * @returns The dump with that schema's every name, and the users' too
 *          (`util.inspect_dump` lists them all with a schema).
 */
export const withFullSchema = (info: IDumpInfo, full: IDumpInfo): IDumpInfo => {
    const byName = new Map(full.schemas.map((schema) => {
        return [schema.name, schema];
    }));

    return {
        ...info,
        users: full.users.length > info.users.length ? full.users : info.users,
        schemas: info.schemas.map((schema) => {
            return byName.get(schema.name) ?? schema;
        }),
    };
};

/**
 * @param info The dump.
 * @param excluded The boxes unticked.
 * @param intoSchema The schema it is loaded into, if any.
 *
 * @returns Why nothing would be loaded, or undefined.
 */
export const selectionProblem = (
    info: IDumpInfo,
    excluded: Iterable<string>,
    intoSchema?: string,
): string | undefined => {
    const out = new Set(excluded);
    const anySchema = info.schemas.some((schema) => {
        return !out.has(schemaKey(schema.name));
    });
    const users = offersUsers(info, intoSchema) && !out.has(USERS_KEY);

    return anySchema || users ? undefined
        : "Nothing is ticked: tick what to load.";
};

/** The load option each kind of object is left out with. */
const EXCLUDE_OPTION: Record<DumpGroup, string> = {
    // The shell's table filters cover views too.
    tables: "excludeTables",
    views: "excludeTables",
    functions: "excludeRoutines",
    procedures: "excludeRoutines",
    events: "excludeEvents",
};

/**
 * The load options that leave out what is unticked.
 *
 * @param info The dump; where a whole kind of objects of a schema is
 *             unticked, with every name of it (see
 *             {@link schemasToComplete}).
 * @param excluded The boxes unticked.
 * @param intoSchema The schema it is loaded into, if any.
 *
 * @returns `excludeSchemas`, `excludeTables`, `excludeRoutines`,
 *          `excludeEvents`, `loadUsers` and `excludeUsers`, each only where
 *          it leaves something out, and `schema` for a load into a schema.
 */
export const loadFilters = (
    info: IDumpInfo,
    excluded: Iterable<string>,
    intoSchema?: string,
): UtilOptions => {
    const out = new Set(excluded);
    const lists: Record<string, string[]> = {};
    const add = (option: string, name: string): void => {
        (lists[option] ??= []).push(name);
    };

    for (const schema of info.schemas) {
        if (out.has(schemaKey(schema.name))) {
            add("excludeSchemas", schema.name);
            continue;
        }
        for (const { group } of DUMP_GROUPS) {
            const whole = out.has(groupKey(schema.name, group));
            for (const name of schema[group]) {
                if (whole || out.has(objectKey(schema.name, group, name))) {
                    // The filters name the dump's schema, also where it
                    // goes into another.
                    add(EXCLUDE_OPTION[group],
                        `${quoteName(schema.name)}.${quoteName(name)}`);
                }
            }
        }
    }

    const options: UtilOptions = {};
    for (const option of ["excludeSchemas", "excludeTables",
        "excludeRoutines", "excludeEvents"]) {
        if (lists[option] !== undefined) {
            options[option] = [...new Set(lists[option])];
        }
    }

    if (offersUsers(info, intoSchema) && !out.has(USERS_KEY)) {
        options.loadUsers = true;
        const users = info.users.filter((account) => {
            return out.has(userKey(account));
        });
        if (users.length > 0) {
            options.excludeUsers = users;
        }
    }
    if (intoSchema !== undefined) {
        options.schema = intoSchema;
    }

    return options;
};

// --- what the dialog says of a dump ------------------------------------------

/**
 * @param bytes A size.
 *
 * @returns It for a person: `1.4 MB`.
 */
export const sizeText = (bytes: number): string => {
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return unit === 0 ? `${String(bytes)} bytes`
        : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

const KIND_LABELS: Record<string, string> = {
    dumpInstance: "Instance dump",
    dumpSchemas: "Schema dump",
    dumpTables: "Table dump",
};

/**
 * @param count How many.
 * @param noun What, singular.
 *
 * @returns `1 table`, `9 tables`.
 */
export const countText = (count: number, noun: string): string => {
    return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
};

/**
 * What the Load dialog says of a dump, above its Objects tab.
 *
 * @param info The dump.
 *
 * @returns Its lines: what and whence, then how big.
 */
export const dumpSummary = (info: IDumpInfo): string[] => {
    const { server, server_version: version, user } = info.source;
    const what = [
        `${KIND_LABELS[info.kind ?? ""] ?? "Dump"} in a `
            + `${info.format === "zip" ? "ZIP file" : "folder"}`,
        ...(server === null ? [] : [`from ${server}`
            + (version === null ? "" : ` (${version})`)
            + (user === null ? "" : ` by ${user}`)]),
        ...(info.begin === null ? [] : [`made ${info.begin}`]),
    ].join(", ");

    const tables = info.schemas.reduce((sum, schema) => {
        return sum + schema.table_count;
    }, 0);
    const rows = info.rows ?? info.estimated_rows ?? undefined;
    const data = info.data_bytes ?? info.estimated_data_bytes ?? undefined;
    const size = [
        countText(info.schema_count, "schema"),
        countText(tables, "table"),
        ...(rows === undefined || rows === null ? []
            : [`${info.complete ? "" : "about "}${countText(rows, "row")}`]),
        ...(data === undefined || data === null ? []
            : [`${sizeText(data)} of data`]),
        `${sizeText(info.size_bytes)} on disk`,
        ...(info.disk_needed_bytes === undefined ? []
            : [`needs ${sizeText(info.disk_needed_bytes)} free to load`]),
    ].join(" · ");

    return [what, size];
};
