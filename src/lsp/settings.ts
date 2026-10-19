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
 * The `mariadb.lsp.*` settings the server takes as initialization options
 * and, when they change, through `workspace/didChangeConfiguration`.
 */

/** A configuration section, as far as these settings need it. */
export interface ISettingsReader {
    /**
     * @param key The key below `mariadb.lsp`.
     * @param defaultValue What an unset key is.
     *
     * @returns The value.
     */
    get<T>(key: string, defaultValue: T): T;
}

/**
 * The settings below `mariadb.lsp` whose change is sent to the running
 * server, rather than restarting it.
 */
export const LIVE_SERVER_SETTINGS = [
    "catalogFiles",
    "catalogRefreshSeconds",
    "keywordCase",
    "indentation",
    "lineWidth",
    "sqlMode",
    "debounceMs",
    "maxDiagnostics",
    "progressThresholdMB",
] as const;

/**
 * The settings below `mariadb.lsp` whose change restarts the server.
 * `serverVersion` is one: the server ignores a version it cannot read,
 * so it cannot be told to go back to its own when the setting is cleared.
 */
export const RESTART_SERVER_SETTINGS = [
    "enabled",
    "path",
    "threads",
    "serverVersion",
] as const;

/**
 * @param value A setting's value.
 *
 * @returns It if it is a whole number of at least 0, else undefined, which
 *          leaves the server's default.
 */
const count = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
};

/** The values the server's `indentation` takes. */
const INDENTATIONS = ["editor", "tab", "2 spaces", "4 spaces"];

/**
 * The server's options, as the settings say, under the server's names.
 * Every live one is there, so a setting put back to its default reaches
 * a running server too; the settings' defaults are the server's.
 *
 * @param settings The `mariadb.lsp` section.
 *
 * @returns The options.
 */
export const serverSettings = (
    settings: ISettingsReader,
): Record<string, unknown> => {
    const files = settings.get<unknown>("catalogFiles", []);
    const megabytes = settings.get<unknown>("progressThresholdMB", 4);
    const indentation = settings.get<unknown>("indentation", "editor");
    const options: Record<string, unknown> = {
        catalogFiles: Array.isArray(files)
            ? files.filter((entry): entry is string => {
                return typeof entry === "string" && entry.trim() !== "";
            })
            : [],
        catalogRefreshSeconds: count(
            settings.get<unknown>("catalogRefreshSeconds", 0)),
        keywordCase: settings.get<unknown>("keywordCase", "upper") === "lower"
            ? "lower"
            : "upper",
        indentation: INDENTATIONS.find((value) => {
            return value === indentation;
        }) ?? "editor",
        lineWidth: count(settings.get<unknown>("lineWidth", 80)),
        sqlMode: String(settings.get<unknown>("sqlMode", "")),
        debounceMs: count(settings.get<unknown>("debounceMs", 150)),
        maxDiagnostics: count(settings.get<unknown>("maxDiagnostics", 1000)),
        progressThreshold: typeof megabytes === "number" && megabytes >= 0
            ? Math.round(megabytes * 1024 * 1024)
            : undefined,
    };
    const version = String(settings.get<unknown>("serverVersion", "")).trim();
    if (version !== "") {
        options.serverVersion = version;
    }

    return Object.fromEntries(Object.entries(options).filter(([, value]) => {
        return value !== undefined;
    }));
};
