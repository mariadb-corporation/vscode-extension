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

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Checks what the `.vsix` is made of, as `.vscodeignore` lets it through
 * (`vsce ls`), for what the VS Code Marketplace refuses as "suspicious
 * content" - which it says without saying what:
 *
 * - a download piped into an interpreter, a script run from memory, an
 *   execution policy switched off: what malware does, and what the MariaDB
 *   Shell's own install instructions have users paste;
 * - files that are no part of an extension: a dotfile (a Mac's
 *   `.DS_Store`), a source map, TypeScript.
 *
 * `npm run package` runs it after `vsce package`, so CI and `/release`
 * fail on what the upload would. The skills come from another repository,
 * so a skill documenting `curl ... | sh` is caught here too.
 */

/** Text the Marketplace takes for a download run as code. */
const SUSPICIOUS: ReadonlyArray<[RegExp, string]> = [
    // Into a shell, whatever is piped: `curl ... | bash`, or a script
    // fetched first and then `printf ... | VAR=x bash`. The shell ends a
    // command - a space, a quote, `;`, `&`, the line's end - so `to(pl|sh)`
    // in a bundled library's regular expression is not one.
    [/(?<!\|)\|\s*(?:sudo\s+)?(?:[A-Za-z_]\w*=\S*\s+)*(?:ba|z|da)?sh(?=[\s"'`;&]|$)/mu,
        "a script piped into a shell"],
    [/\|\s*iex\b|\bInvoke-Expression\b/iu, "a script run with iex"],
    [/ExecutionPolicy["',\s]+Bypass/iu, "PowerShell's execution policy bypassed"],
    [/-EncodedCommand\b/iu, "an encoded PowerShell command"],
    [/\.DownloadString\(/iu, "a script downloaded into memory"],
];

/** Files that are no part of an extension. */
const OUT_OF_PLACE: ReadonlyArray<[RegExp, string]> = [
    [/(?:^|\/)\.[^/]+$/u, "a dotfile"],
    [/\.map$/u, "a source map"],
    [/\.(?:ts|mts|cts)$/u, "TypeScript"],
];

/** What is read for text: everything but the font and the images. */
const BINARY = /\.(?:png|jpg|jpeg|gif|ttf|woff2?)$/u;

/**
 * @param files The package's files, as `vsce ls` lists them.
 * @param read Reads one of them as text.
 *
 * @returns What the Marketplace would refuse, a line each; none where
 *          nothing is.
 */
export const packageProblems = (
    files: readonly string[],
    read: (file: string) => string,
): string[] => {
    const problems: string[] = [];
    for (const file of files) {
        for (const [pattern, what] of OUT_OF_PLACE) {
            if (pattern.test(file)) {
                problems.push(`${file}: ${what}`);
            }
        }
        if (BINARY.test(file)) {
            continue;
        }
        // The whole text, not line by line: a bundle lists an array's
        // elements a line each, "-ExecutionPolicy", then "Bypass".
        const text = read(file);
        for (const [pattern, what] of SUSPICIOUS) {
            const found = pattern.exec(text);
            if (found !== null) {
                const line = text.slice(0, found.index).split("\n").length;
                problems.push(`${file}:${String(line)}: ${what}`);
            }
        }
    }

    return problems;
};

/**
 * @param root The extension's folder.
 *
 * @returns Its package's files, as `vsce ls` lists them.
 */
export const packageFiles = (root: string): string[] => {
    const vsce = path.join(root, "node_modules", "@vscode", "vsce", "vsce");

    return execFileSync(process.execPath, [vsce, "ls", "--no-dependencies"],
        { cwd: root, encoding: "utf8" }).split("\n").filter((file) => {
        return file.trim() !== "";
    });
};

if (import.meta.main) {
    const root = path.resolve(import.meta.dirname, "..");
    const problems = packageProblems(packageFiles(root), (file) => {
        return fs.readFileSync(path.join(root, file), "utf8");
    });
    if (problems.length > 0) {
        console.error("check:package: the package carries what the "
            + "Marketplace refuses:\n" + problems.map((problem) => {
            return `  ${problem}`;
        }).join("\n"));
        process.exitCode = 1;
    } else {
        console.log("check:package: nothing the Marketplace refuses.");
    }
}
