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

import * as vscode from "vscode";

import { colorLabel } from "../connections/connectionDetails.js";
import {
    normalizeFolder,
    ROOT_FOLDER,
} from "../connections/connectionFolders.js";
import { reportError } from "../errorMessages.js";
import { CONNECTION_COLORS } from "../mcp/types.js";
import { themeColorOf } from "../tree/connectionColors.js";
import {
    msmFolderOf,
    type MsmProjectsNode,
    type MsmProjectsTreeProvider,
} from "../tree/msmProjectsTreeProvider.js";

/**
 * The MSM Projects view's own commands, beside those of `MsmCommands`:
 * refreshing it, and its folders - made, renamed, colored and removed as
 * the Connections view's are, on folders kept apart from those.
 */
export const MSM_FOLDER_COMMANDS = {
    refresh: "mariadb.msm.refreshProjects",
    newFolder: "mariadb.msm.newProjectFolder",
    renameFolder: "mariadb.msm.renameProjectFolder",
    setFolderColor: "mariadb.msm.setProjectFolderColor",
    removeFolder: "mariadb.msm.removeProjectFolder",
} as const;

/**
 * @param tree The MSM Projects view's provider.
 * @param log Where failures are written.
 *
 * @returns The registrations, for the extension to dispose.
 */
export const registerMsmProjectsCommands = (
    tree: MsmProjectsTreeProvider,
    log: (message: string) => void,
): vscode.Disposable[] => {
    const command = (
        id: string,
        handler: (node?: MsmProjectsNode) => Promise<void>,
    ): vscode.Disposable => {
        return vscode.commands.registerCommand(id,
            async (node?: MsmProjectsNode) => {
                try {
                    await handler(node);
                } catch (error) {
                    reportError(log, error);
                }
            });
    };

    return [
        command(MSM_FOLDER_COMMANDS.refresh, () => {
            tree.refresh();

            return Promise.resolve();
        }),

        command(MSM_FOLDER_COMMANDS.newFolder, async (node) => {
            const parent = msmFolderOf(node) ?? ROOT_FOLDER;
            const name = await vscode.window.showInputBox({
                title: "New Folder",
                prompt: parent === ROOT_FOLDER
                    ? "The name of the new folder. A '/' makes a folder "
                    + "inside another."
                    : `The name of the new folder in ${parent}. A '/' makes `
                    + "a folder inside another.",
                validateInput: (value) => {
                    return normalizeFolder(value) === ROOT_FOLDER
                        ? "Enter a folder name." : undefined;
                },
            });
            if (name !== undefined) {
                await tree.newFolder(normalizeFolder(`${parent}/${name}`));
            }
        }),

        command(MSM_FOLDER_COMMANDS.renameFolder, async (node) => {
            if (node?.kind !== "folder") {
                return;
            }
            const name = await vscode.window.showInputBox({
                title: "Rename Folder",
                prompt: `The new name of ${node.path}. Every project in it `
                    + "and below it moves along.",
                value: node.name,
                validateInput: (value) => {
                    if (value.trim() === "") {
                        return "Enter a folder name.";
                    }

                    return value.includes("/")
                        ? "A folder name cannot contain '/'. Drag the folder "
                        + "to move it into another."
                        : undefined;
                },
            });
            if (name !== undefined) {
                await tree.renameFolder(node, name.trim());
            }
        }),

        command(MSM_FOLDER_COMMANDS.setFolderColor, async (node) => {
            if (node?.kind !== "folder") {
                return;
            }
            const current = tree.folderColors.get(node.path);
            const picked = await vscode.window.showQuickPick([
                ...CONNECTION_COLORS.map((color) => {
                    return {
                        label: colorLabel(color),
                        color,
                        iconPath: new vscode.ThemeIcon("circle-filled",
                            themeColorOf(color)),
                        ...(color === current
                            ? { description: "current" } : {}),
                    };
                }),
                {
                    label: colorLabel(undefined),
                    color: undefined,
                    ...(current === undefined
                        ? { description: "current" } : {}),
                },
            ], { title: `Folder Color of ${node.path}` });
            if (picked !== undefined && picked.color !== current) {
                await tree.setFolderColor(node, picked.color);
            }
        }),

        command(MSM_FOLDER_COMMANDS.removeFolder, async (node) => {
            // Only an empty one: a folder with projects is where they are.
            if (node?.kind === "folder" && node.empty) {
                await tree.removeFolder(node);
            }
        }),
    ];
};
