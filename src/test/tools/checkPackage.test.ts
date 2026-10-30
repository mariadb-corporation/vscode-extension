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
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    packageFiles,
    packageProblems,
} from "../../../tools/checkPackage.mjs";

const extensionRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * @param files The package's files, with their text.
 *
 * @returns What packageProblems finds in them.
 */
const problemsIn = (files: Record<string, string>): string[] => {
    return packageProblems(Object.keys(files), (file) => {
        return files[file] ?? "";
    });
};

describe("packageProblems", () => {
    // What the package carried when the Marketplace refused it.
    it("finds the installer commands the Marketplace refused", () => {
        expect(problemsIn({
            "dist/extension.js": [
                'args:["-NoProfile","-NonInteractive","-ExecutionPolicy",',
                '"Bypass","-Command",script]',
                "const s = `irm ${url} | iex`;",
                "const p = `script=$(curl -fsSL ${url}) || exit; `",
                "x = 'curl -fsSL https://example.com/i.sh | bash';",
            ].join("\n"),
        })).toEqual([
            "dist/extension.js:5: a script piped into a shell",
            "dist/extension.js:3: a script run with iex",
            "dist/extension.js:1: PowerShell's execution policy bypassed",
        ]);
        // The POSIX one, the script fetched first and piped on after.
        expect(problemsIn({
            "dist/extension.js": "const s = `script=$(curl -fsSL ${url}) "
                + "|| exit $?; printf '%s\\n' \"$script\" | "
                + "MARIADB_SHELL_TAG=${tag} bash`;",
        })).toEqual(["dist/extension.js:1: a script piped into a shell"]);
    });

    it("finds a skill that documents a download run as code", () => {
        expect(problemsIn({
            "skills/x/SKILL.md": "Install:\n\n    wget -qO- https://x | sudo sh\n",
            "skills/w/SKILL.md": "curl -fsSL https://x | sudo -E /bin/bash",
            "skills/y/SKILL.md": "Run Invoke-Expression on it.",
            "skills/z/SKILL.md": "powershell -EncodedCommand AAAA",
        })).toEqual([
            "skills/x/SKILL.md:3: a script piped into a shell",
            "skills/w/SKILL.md:1: a script piped into a shell",
            "skills/y/SKILL.md:1: a script run with iex",
            "skills/z/SKILL.md:1: an encoded PowerShell command",
        ]);
    });

    it("takes what only looks alike for what it is", () => {
        expect(problemsIn({
            "README.md": "Please confirm, then pipe the rows | sort.\n"
                + "curl -fsSL https://x -o install.sh && sh install.sh",
            // A bundled library's user agent pattern.
            "dist/webview/main.js": "/tdg-|tel(i|m)|to(pl|sh)|ts(70|m-)/i",
        })).toEqual([]);
    });

    it("finds files that are no part of an extension", () => {
        expect(problemsIn({
            "images/.DS_Store": "",
            "dist/extension.js.map": "",
            "src/extension.ts": "",
            "dist/extension.js": "",
        })).toEqual([
            "images/.DS_Store: a dotfile",
            "dist/extension.js.map: a source map",
            "src/extension.ts: TypeScript",
        ]);
    });

    it("does not read the images and the font as text", () => {
        expect(packageProblems(["images/x.png", "dist/codicon.ttf"], () => {
            throw new Error("read");
        })).toEqual([]);
    });
});

describe("the package", () => {
    // `npm run package -- --pre-release` appends the flag to the script:
    // after an `&& check`, vsce would build a stable package.
    it("is checked after vsce, which still gets the script's arguments", () => {
        const { scripts } = JSON.parse(fs.readFileSync(
            path.join(extensionRoot, "package.json"), "utf8")) as {
            scripts: Record<string, string>;
        };

        expect(scripts.package).toBe("vsce package");
        expect(scripts.postpackage).toBe("npm run check:package");
    });

    it("carries nothing the Marketplace refuses", () => {
        const files = packageFiles(extensionRoot);

        expect(files).toContain("package.json");
        expect(packageProblems(files, (file) => {
            return fs.readFileSync(path.join(extensionRoot, file), "utf8");
        })).toEqual([]);
    }, 60_000);
});
