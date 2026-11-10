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
 * Online ALTER TABLE, as the table editor's Online Alter Table tab sets it
 * for a table: msm runs each ALTER TABLE the least disruptive way the
 * server accepts (ALGORITHM=INSTANT, then NOCOPY, INPLACE and COPY with
 * LOCK=NONE, a Galera NBO where allowed, then LOCK=SHARED and LOCK=EXCLUSIVE), within
 * these limits (mariadb-shell-plugins `msm_plugin/lib/online_alter.py`).
 * A project's table keeps its entry in `msm.project.json`, which
 * deployments use; a live table's is kept in the workspace, and Apply
 * runs the table's ALTERs through msm. Pure, shared by the extension and
 * the webview.
 */

/** The lock a Galera NBO step takes; none allows no NBO. */
export type NboLock = "SHARED" | "EXCLUSIVE";

/**
 * msm's limits, its camelCase keys. A key left out takes the value from
 * above (the project's, else msm's default); a size of null is no limit,
 * 0 never.
 */
export interface IOnlineAlterOptions {
    /** The largest table an online COPY runs on. */
    maxRebuildBytes?: number | null;
    /** The largest table on Galera for a step other than INSTANT. */
    galeraMaxBytes?: number | null;
    /** The lock a Galera NBO step takes; null allows none. */
    nboLock?: NboLock | null;
    /** The largest table a step that blocks writes runs on. */
    maxLockedBytes?: number | null;
    /** Seconds each attempt waits for the metadata lock. */
    lockWait?: number;
    /** How often an attempt whose lock wait ran out is made again. */
    maxRetries?: number;
}

/** A table's entry: whether it is on, and its own limits. */
export interface IOnlineAlterEntry extends IOnlineAlterOptions {
    enabled?: boolean;
}

/** What the tab shows of a table. */
export interface IOnlineAlterData {
    /**
     * What applies where the table's entry sets nothing: the project's
     * values over msm's defaults, or msm's defaults for a live table.
     */
    inherited: Required<IOnlineAlterEntry>;
    /** The table's own entry; empty, it follows the inherited values. */
    table: IOnlineAlterEntry;
    /** Where the entry is kept: msm.project.json, or the workspace. */
    keptIn: "project" | "workspace";
}

/** The option keys, in the tab's order. */
export const ONLINE_ALTER_KEYS = ["maxRebuildBytes", "galeraMaxBytes",
    "nboLock", "maxLockedBytes", "lockWait", "maxRetries"] as const;

/** The options that are table sizes. */
export const SIZE_KEYS = ["maxRebuildBytes", "galeraMaxBytes",
    "maxLockedBytes"] as const;

export type SizeKey = typeof SIZE_KEYS[number];

/** The options that are counts. */
export const COUNT_KEYS = ["lockWait", "maxRetries"] as const;

export type CountKey = typeof COUNT_KEYS[number];

/** What a size field reads as no limit. */
export const NO_LIMIT = "unlimited";

const UNITS: ReadonlyArray<[string, number]> = [
    ["TiB", 1024 ** 4], ["GiB", 1024 ** 3], ["MiB", 1024 ** 2],
    ["KiB", 1024], ["B", 1],
];

/**
 * @param bytes A size, or null for no limit.
 *
 * @returns It in the largest unit it is a whole number of: `10 GiB`.
 */
export const sizeText = (bytes: number | null): string => {
    if (bytes === null) {
        return NO_LIMIT;
    }
    if (bytes === 0) {
        return "0";
    }
    const [unit, size] = UNITS.find(([, each]) => {
        return bytes % each === 0;
    }) ?? ["B", 1];

    return `${bytes / size} ${unit}`;
};

/**
 * @param text What a size field holds: `10 GiB`, `512M`, `1.5 g`, `0`, a
 *             number of bytes, or `unlimited`.
 *
 * @returns The size; null for no limit; undefined where it is no size.
 */
export const parseSize = (text: string): number | null | undefined => {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === NO_LIMIT || trimmed === "no limit") {
        return null;
    }
    const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)(?:i?b)?$/u.exec(trimmed);
    if (match === null) {
        return undefined;
    }
    const power = ["", "k", "m", "g", "t"].indexOf(match[2]);

    return Math.round(Number(match[1]) * 1024 ** power);
};

/**
 * @param text What a count field holds.
 *
 * @returns The count; undefined where it is not a whole number from 0.
 */
export const parseCount = (text: string): number | undefined => {
    const trimmed = text.trim();

    return /^\d+$/u.test(trimmed) ? Number(trimmed) : undefined;
};

/** The tab's fields as typed: a key left empty takes the inherited value. */
export type OnlineAlterTexts = Record<SizeKey | CountKey, string> & {
    /** "" follows the inherited value. */
    enabled: "" | "on" | "off";
    /** "" follows the inherited value; "off" allows no NBO. */
    nboLock: "" | "off" | NboLock;
};

/**
 * @param entry A table's entry.
 *
 * @returns The tab's fields for it.
 */
export const textsOf = (entry: IOnlineAlterEntry): OnlineAlterTexts => {
    const size = (key: SizeKey): string => {
        const value = entry[key];

        return value === undefined ? "" : sizeText(value);
    };
    const count = (key: CountKey): string => {
        const value = entry[key];

        return value === undefined ? "" : String(value);
    };

    return {
        enabled: entry.enabled === undefined ? ""
            : entry.enabled ? "on" : "off",
        maxRebuildBytes: size("maxRebuildBytes"),
        galeraMaxBytes: size("galeraMaxBytes"),
        nboLock: entry.nboLock === undefined ? ""
            : entry.nboLock ?? "off",
        maxLockedBytes: size("maxLockedBytes"),
        lockWait: count("lockWait"),
        maxRetries: count("maxRetries"),
    };
};

/** The tab's fields read back: the entry, or why a field is not one. */
export interface IReadTexts {
    entry: IOnlineAlterEntry;
    problems: string[];
}

/** The fields' names, as the tab labels them. */
export const ONLINE_ALTER_LABELS: Record<SizeKey | CountKey, string> = {
    maxRebuildBytes: "Online rebuilds up to",
    galeraMaxBytes: "Galera tables up to",
    maxLockedBytes: "Locked tables up to",
    lockWait: "Lock wait (seconds)",
    maxRetries: "Lock retries",
};

/**
 * @param texts The tab's fields.
 *
 * @returns The entry they make, and what in them is no value.
 */
export const readTexts = (texts: OnlineAlterTexts): IReadTexts => {
    const entry: IOnlineAlterEntry = {};
    const problems: string[] = [];
    if (texts.enabled !== "") {
        entry.enabled = texts.enabled === "on";
    }
    for (const key of SIZE_KEYS) {
        if (texts[key].trim() === "") {
            continue;
        }
        const size = parseSize(texts[key]);
        if (size === undefined) {
            problems.push(`${ONLINE_ALTER_LABELS[key]}: "${texts[key]}" is `
                + `no size (e.g. 10 GiB, 512 MiB, 0 or ${NO_LIMIT}).`);
        } else {
            entry[key] = size;
        }
    }
    if (texts.nboLock !== "") {
        entry.nboLock = texts.nboLock === "off" ? null : texts.nboLock;
    }
    for (const key of COUNT_KEYS) {
        if (texts[key].trim() === "") {
            continue;
        }
        const count = parseCount(texts[key]);
        if (count === undefined) {
            problems.push(`${ONLINE_ALTER_LABELS[key]}: "${texts[key]}" is `
                + "not a whole number.");
        } else {
            entry[key] = count;
        }
    }

    return { entry, problems };
};

/**
 * @param entry A table's entry.
 *
 * @returns It with its keys in one order, to tell two apart.
 */
export const entryKey = (entry: IOnlineAlterEntry): string => {
    const keys: Array<keyof IOnlineAlterEntry> = ["enabled",
        ...ONLINE_ALTER_KEYS];

    return JSON.stringify(keys.map((key) => {
        return [key, entry[key]];
    }).filter(([, value]) => { return value !== undefined; }));
};

/**
 * @param entry A table's entry.
 *
 * @returns Its limits, for msm: without `enabled`.
 */
export const optionsOf = (entry: IOnlineAlterEntry): IOnlineAlterOptions => {
    const { enabled: _enabled, ...options } = entry;

    return options;
};

/**
 * msm.project.json's whole `onlineAlter` setting: the project's general
 * values, and the tables' own entries. msm.set_project_settings takes it
 * only as a whole, so each writer changes its part and sends all of it.
 */
export interface IOnlineAlterSetting extends IOnlineAlterEntry {
    tables?: Record<string, IOnlineAlterEntry>;
}

/**
 * @param general The general values.
 * @param tables The tables' entries.
 *
 * @returns The setting they make: an empty entry, and tables when none
 *          has one, are left out.
 */
const settingOf = (general: IOnlineAlterEntry,
    tables: Record<string, IOnlineAlterEntry>): IOnlineAlterSetting => {
    const kept = Object.fromEntries(Object.entries(tables).filter(
        ([, entry]) => { return Object.keys(entry).length > 0; }));

    return Object.keys(kept).length === 0 ? { ...general }
        : { ...general, tables: kept };
};

/**
 * @param setting The setting, as read.
 *
 * @returns Its general values alone.
 */
export const generalOf = (setting: IOnlineAlterSetting): IOnlineAlterEntry => {
    const { tables: _tables, ...general } = setting;

    return general;
};

/**
 * @param setting The setting, as read.
 * @param general The project's new general values.
 *
 * @returns The setting with them, the tables' entries kept.
 */
export const withGeneral = (setting: IOnlineAlterSetting,
    general: IOnlineAlterEntry): IOnlineAlterSetting => {
    return settingOf(general, setting.tables ?? {});
};

/**
 * @param setting The setting, as read.
 * @param table A table.
 * @param entry Its new entry; null or empty drops it, so the table takes
 *              the general values.
 *
 * @returns The setting with it, the rest kept.
 */
export const withTable = (setting: IOnlineAlterSetting, table: string,
    entry: IOnlineAlterEntry | null): IOnlineAlterSetting => {
    const tables = { ...setting.tables ?? {} };
    if (entry === null) {
        delete tables[table];
    } else {
        tables[table] = entry;
    }

    return settingOf(generalOf(setting), tables);
};
