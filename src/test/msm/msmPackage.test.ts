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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MSM_COMMANDS } from "../../msm/msmCommands.js";

const EXTENSION_ROOT = join(
    dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface IMenuEntry {
    command?: string;
    submenu?: string;
    when?: string;
    group?: string;
}

const manifest = JSON.parse(readFileSync(
    join(EXTENSION_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    contributes: {
        commands: Array<{ command: string; title: string; category?: string }>;
        menus: Record<string, IMenuEntry[]>;
        submenus: Array<{ id: string; label: string }>;
    };
};
const { commands, menus, submenus } = manifest.contributes;

const SUBMENU = "mariadb.msm.explorer";

/** What a `when` clause says of a folder, as VS Code would judge it. */
const shownOn = (when: string, folder: string): boolean => {
    const isProject = /\.msm\.project$/u.test(folder);
    const clause = when
        .replace("explorerResourceIsFolder", "true")
        .replace("!(resourceFilename =~ /\\.msm\\.project$/)", String(!isProject))
        .replace("resourceFilename =~ /\\.msm\\.project$/", String(isProject));
    if (!/^(?:true|false)(?: && (?:true|false))*$/u.test(clause)) {
        throw new Error(`Cannot judge '${when}'.`);
    }

    return !clause.includes("false");
};

describe("the MariaDB Schema Management menu", () => {
    it("contributes every command, in the MariaDB category", () => {
        for (const id of Object.values(MSM_COMMANDS)) {
            const command = commands.find((entry) => {
                return entry.command === id;
            });
            expect(command?.category, id).toBe("MariaDB");
            // Each opens a dialog, or a picker first.
            expect(command?.title, id).toMatch(/\.\.\.$/u);
        }
        expect(commands.filter((entry) => {
            return entry.command.startsWith("mariadb.msm.");
        })).toHaveLength(Object.keys(MSM_COMMANDS).length);
    });

    it("is a submenu of the Explorer's folders, beside the REST Service's",
        () => {
            expect(submenus).toContainEqual({
                id: SUBMENU, label: "MariaDB Schema Management",
            });
            expect(menus["explorer/context"]).toContainEqual({
                submenu: SUBMENU, when: "explorerResourceIsFolder",
                group: "7_mariadb@2",
            });
        });

    it("offers New MSM Project on a plain folder only", () => {
        const shown = menus[SUBMENU].filter((entry) => {
            return shownOn(entry.when ?? "", "/work/shop");
        }).map((entry) => { return entry.command; });

        expect(shown).toEqual([MSM_COMMANDS.create]);
    });

    it("offers the project's commands on a project folder", () => {
        const shown = menus[SUBMENU].filter((entry) => {
            return shownOn(entry.when ?? "", "/work/sakila.msm.project");
        }).map((entry) => { return entry.command; });

        expect(shown).toEqual([
            MSM_COMMANDS.info, MSM_COMMANDS.release,
            MSM_COMMANDS.deploymentScript, MSM_COMMANDS.deploy,
        ]);
    });

    it("lists every command in the submenu, grouped in order", () => {
        expect(menus[SUBMENU].map((entry) => { return entry.command; }).sort())
            .toEqual(Object.values(MSM_COMMANDS).sort());
        expect(menus[SUBMENU].map((entry) => { return entry.group; })).toEqual([
            "1_create@1", "2_project@1", "3_release@1", "3_release@2",
            "4_deploy@1",
        ]);
    });

    it("builds the dialogs' frontend with the other webviews", () => {
        expect(manifest.scripts["build:webview"])
            .toContain("vite build --config vite.msm.config.ts");
    });
});
