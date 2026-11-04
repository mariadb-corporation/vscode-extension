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

import { MSM_COMMANDS, MSM_LIST_COMMANDS } from "../../msm/msmCommands.js";
import { MSM_FOLDER_COMMANDS } from "../../msm/msmProjectsCommands.js";

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
        commands: Array<{
            command: string;
            title: string;
            category?: string;
            icon?: string;
        }>;
        menus: Record<string, IMenuEntry[]>;
        submenus: Array<{ id: string; label: string }>;
        viewsWelcome: Array<{ view: string; contents: string; when?: string }>;
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
        const all = [...Object.values(MSM_COMMANDS),
            ...Object.values(MSM_LIST_COMMANDS),
            ...Object.values(MSM_FOLDER_COMMANDS)];
        expect(commands.filter((entry) => {
            return entry.command.startsWith("mariadb.msm.");
        }).map((entry) => { return entry.command; }).sort())
            .toEqual(all.sort());
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
            MSM_LIST_COMMANDS.addToProjects,
        ]);
    });

    it("lists every command in the submenu, grouped in order", () => {
        // Edit MSM Project is on the MSM Projects view's rows: it edits
        // how the view lists a project, which one in the Explorer may not be.
        expect(menus[SUBMENU].map((entry) => { return entry.command; }).sort())
            .toEqual([...Object.values(MSM_COMMANDS).filter((id) => {
                return id !== MSM_COMMANDS.edit;
            }), MSM_LIST_COMMANDS.addToProjects].sort());
        expect(menus[SUBMENU].map((entry) => { return entry.group; })).toEqual([
            "1_create@1", "2_project@1", "3_release@1", "3_release@2",
            "4_deploy@1", "5_list@1",
        ]);
    });
});

describe("the MSM Projects view's menus", () => {
    const VIEW = "view == mariadb.msmProjects";
    const onRow = (viewItem: string, inline: boolean): Array<string | undefined> => {
        return menus["view/item/context"].filter((entry) => {
            const when = entry.when ?? "";
            if (!when.startsWith(`${VIEW} && viewItem `)) {
                return false;
            }
            const test = when.slice(`${VIEW} && viewItem `.length);
            const matches = test.startsWith("== ")
                ? test.slice(3) === viewItem
                : new RegExp(test.slice(4, -1), "u").test(viewItem);

            return matches && (entry.group ?? "").startsWith("inline")
                === inline;
        }).map((entry) => { return entry.command; });
    };

    it("has New, Open, New Folder and Refresh in its toolbar", () => {
        expect(menus["view/title"].filter((entry) => {
            return entry.when?.startsWith(VIEW) === true;
        }).map((entry) => { return entry.command; })).toEqual([
            MSM_LIST_COMMANDS.newProject, MSM_LIST_COMMANDS.openProject,
            MSM_FOLDER_COMMANDS.newFolder, MSM_FOLDER_COMMANDS.refresh,
        ]);
    });

    it("keeps only Refresh in its toolbar on a shell without MSM Projects",
        () => {
            const unsupported = "mariadb.msmProjectsView != unsupported";
            expect(menus["view/title"].filter((entry) => {
                return entry.when === `${VIEW} && ${unsupported}`;
            }).map((entry) => { return entry.command; })).toEqual([
                MSM_LIST_COMMANDS.newProject, MSM_LIST_COMMANDS.openProject,
                MSM_FOLDER_COMMANDS.newFolder,
            ]);
        });

    it("says how the listing goes, as the other views do", () => {
        const welcome = manifest.contributes.viewsWelcome.filter((entry) => {
            return entry.view === "mariadb.msmProjects";
        });
        const key = "mariadb.msmProjectsView";
        expect(welcome.map((entry) => { return entry.when; })).toEqual([
            [`${key} != installing`, `${key} != failed`, `${key} != listed`,
                `${key} != unsupported`].join(" && "),
            `${key} == installing`,
            `${key} == failed`,
            `${key} == listed`,
            `${key} == unsupported`,
        ]);
        expect(welcome[2].contents)
            .toContain("(command:mariadb.msm.refreshProjects)");
        expect(welcome[3].contents)
            .toContain("(command:mariadb.msm.newProjectInView)");
    });

    it("asks for a newer MariaDB Shell where it has no MSM Projects", () => {
        const welcome = manifest.contributes.viewsWelcome.find((entry) => {
            return entry.view === "mariadb.msmProjects"
                && entry.when === "mariadb.msmProjectsView == unsupported";
        });
        expect(welcome?.contents).toBe("This version of the MariaDB Shell "
            + "does not support MSM Projects. Please update to a newer "
            + "version of the MariaDB Shell to use this view.");
    });

    it("offers the Explorer's operations on a project, as icons too", () => {
        const operations = [MSM_COMMANDS.info, MSM_COMMANDS.release,
            MSM_COMMANDS.deploymentScript, MSM_COMMANDS.deploy];
        expect(onRow("mariadbMsmProject", true)).toEqual(operations);
        expect(onRow("mariadbMsmProject", false)).toEqual([...operations,
            MSM_COMMANDS.edit, MSM_LIST_COMMANDS.removeFromProjects]);
        for (const id of operations) {
            expect(commands.find((entry) => {
                return entry.command === id;
            })?.icon, id).toMatch(/^\$\(.+\)$/u);
        }
    });

    it("only offers removing a project whose folder is gone", () => {
        expect(onRow("mariadbMsmProject.missing", true))
            .toEqual([MSM_LIST_COMMANDS.removeFromProjects]);
        expect(onRow("mariadbMsmProject.missing", false))
            .toEqual([MSM_LIST_COMMANDS.removeFromProjects]);
    });

    it("offers Remove Folder on an empty folder only", () => {
        const folder = onRow("mariadbMsmFolder", false);
        expect(folder).toEqual([MSM_LIST_COMMANDS.newProject,
            MSM_LIST_COMMANDS.openProject, MSM_FOLDER_COMMANDS.newFolder,
            MSM_FOLDER_COMMANDS.renameFolder,
            MSM_FOLDER_COMMANDS.setFolderColor]);
        expect(onRow("mariadbMsmFolder.empty", false))
            .toEqual([...folder, MSM_FOLDER_COMMANDS.removeFolder]);
    });

    it("builds the dialogs' frontend with the other webviews", () => {
        expect(manifest.scripts["build:webview"])
            .toContain("vite build --config vite.msm.config.ts");
    });
});
