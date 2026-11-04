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
import { CONNECTION_COLORS, type ConnectionColor } from "../mcp/types.js";
import { themeColorOf } from "./connectionColors.js";

/*
 * What New Folder, Rename Folder and Set Folder Color ask, the same in
 * every view with folders: the Connections view and the MSM Projects view.
 */

/**
 * Asks for the name of a new folder inside another.
 *
 * @param title What the prompt is for.
 * @param parent The folder it goes in; `/` for the top level.
 * @param placeHolder An example name, if any.
 *
 * @returns The new folder's path, or undefined when the user cancelled.
 */
export const askForNewFolder = async (
    title: string,
    parent: string,
    placeHolder?: string,
): Promise<string | undefined> => {
    const name = await vscode.window.showInputBox({
        title,
        prompt: parent === ROOT_FOLDER
            ? "The name of the new folder. A '/' makes a folder inside "
            + "another."
            : `The name of the new folder in ${parent}. A '/' makes a folder `
            + "inside another.",
        placeHolder,
        validateInput: (value) => {
            return normalizeFolder(value) === ROOT_FOLDER
                ? "Enter a folder name."
                : undefined;
        },
    });

    return name === undefined
        ? undefined
        : normalizeFolder(`${parent}/${name}`);
};

/**
 * Asks for a folder's new name. A rename stays where it is; moving is a
 * drag, so a `/` is refused.
 *
 * @param folder The folder.
 * @param item What is filed in the view's folders: "connection".
 *
 * @returns The new name, trimmed, or undefined when the user cancelled.
 */
export const askForFolderName = async (
    folder: { path: string; name: string },
    item: string,
): Promise<string | undefined> => {
    const name = await vscode.window.showInputBox({
        title: "Rename Folder",
        prompt: `The new name of ${folder.path}. Every ${item} in it and `
            + "below it moves along.",
        value: folder.name,
        validateInput: (value) => {
            if (value.trim() === "") {
                return "Enter a folder name.";
            }

            return value.includes("/")
                ? "A folder name cannot contain '/'. Drag the folder to move "
                + "it into another."
                : undefined;
        },
    });

    return name?.trim();
};

/**
 * Asks for a folder's color, from the connections' six or none.
 *
 * @param path The folder.
 * @param current Its color now; undefined for none.
 *
 * @returns The color picked, undefined for none; nothing when the user
 *          cancelled or picked the color it has.
 */
export const pickFolderColor = async (
    path: string,
    current: ConnectionColor | undefined,
): Promise<{ color: ConnectionColor | undefined } | undefined> => {
    const picked = await vscode.window.showQuickPick([
        ...CONNECTION_COLORS.map((color) => {
            return {
                label: colorLabel(color),
                color,
                iconPath: new vscode.ThemeIcon("circle-filled",
                    themeColorOf(color)),
                ...(color === current ? { description: "current" } : {}),
            };
        }),
        {
            label: colorLabel(undefined),
            color: undefined,
            ...(current === undefined ? { description: "current" } : {}),
        },
    ], { title: `Folder Color of ${path}` });

    return picked === undefined || picked.color === current
        ? undefined : { color: picked.color };
};
