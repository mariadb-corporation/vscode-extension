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

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Where the test VS Code opens: on a display of its own where the machine
 * has one, so the main screen stays the user's while the tests drive the
 * window - a click or a key on it would make them fail.
 *
 * `UI_TEST_DISPLAY` picks it: unset, the second display if there is one;
 * `main`, the main one, as VS Code would anyway; a number, that display,
 * 1 being the main one. Only macOS is asked for its displays; elsewhere
 * VS Code places the window itself.
 *
 * VS Code opens its first window with the bounds it stored last, in
 * `User/globalStorage/storage.json` of its user data folder. ExTester
 * deletes that folder and writes it anew right before it launches VS Code,
 * all in one function, `VSBrowser.start`: the one call in between that
 * can be wrapped is its `codeUtil.getDefaultSettings`, so the bounds are
 * written there. Both are internals - ExTester's call and VS Code's file -
 * and a version that changes either leaves the window where VS Code puts
 * it, which the tests do not depend on.
 */

/** A display's usable area: top-left based, as VS Code stores bounds. */
interface IArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * @returns The displays' usable areas, the main one first - without the
 *          menu bar and the Dock - or none where they cannot be read.
 */
const displayAreas = (): IArea[] => {
    if (process.platform !== "darwin") {
        return [];
    }
    try {
        // AppKit's frames are bottom-left based, the main display's bottom
        // at 0, and y growing upwards; VS Code's are top-left based.
        const script = 'ObjC.import("AppKit");'
            + "var screens = $.NSScreen.screens.js;"
            + "var top = screens[0].frame.size.height;"
            + "JSON.stringify(screens.map(function (s) {"
            + "  var f = s.visibleFrame;"
            + "  return { x: f.origin.x, y: top - f.origin.y - f.size.height,"
            + "    width: f.size.width, height: f.size.height };"
            + "}));";

        const listed = execFileSync("osascript",
            ["-l", "JavaScript", "-e", script], { encoding: "utf8" });

        return JSON.parse(listed) as IArea[];
    } catch {
        return [];
    }
};

/**
 * @returns The display `UI_TEST_DISPLAY` asks for, or undefined to leave
 *          the window where VS Code puts it.
 */
const chosenArea = (): IArea | undefined => {
    const asked = process.env.UI_TEST_DISPLAY ?? "";
    if (asked === "main") {
        return undefined;
    }
    const areas = displayAreas();
    if (asked === "") {
        return areas[1];
    }
    const index = Number(asked);
    if (!Number.isInteger(index) || index < 1 || index > areas.length) {
        console.warn(`UI_TEST_DISPLAY=${asked}: there are `
            + `${String(areas.length)} displays; the window opens where `
            + "VS Code puts it.");

        return undefined;
    }

    return index === 1 ? undefined : areas[index - 1];
};

/**
 * Has the test VS Code open on the display asked for; see the module's
 * comment. To be called as the test files load, before ExTester's root
 * hook launches VS Code.
 */
export const placeWindow = (): void => {
    const storage = process.env.UI_TEST_STORAGE;
    const area = chosenArea();
    if (storage === undefined || area === undefined) {
        return;
    }
    const load = createRequire(__filename);
    const codeUtil = load("vscode-extension-tester/out/util/codeUtil.js") as {
        getDefaultSettings: (...args: unknown[]) => unknown;
    };
    const defaults = codeUtil.getDefaultSettings;
    codeUtil.getDefaultSettings = (...args: unknown[]): unknown => {
        const file = join(storage, "settings", "User", "globalStorage",
            "storage.json");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({
            windowsState: {
                // mode 1: a window of these bounds, neither maximized nor
                // full screen.
                lastActiveWindow: { uiState: { mode: 1, ...area } },
                openedWindows: [],
            },
        }));

        return defaults(...args);
    };
};

/**
 * The app in front as the tests started, by its bundle's path: the focus
 * goes back to it once VS Code has taken it, as macOS gives a window that
 * opens. Keys typed into the app meanwhile would otherwise land in the
 * test window and make a test fail.
 */
let frontApp: string | undefined;

/**
 * Notes the app in front, before VS Code launches. macOS only;
 * `lsappinfo` needs no permission to tell. `UI_TEST_FOCUS=vscode` leaves
 * the focus with VS Code.
 */
export const rememberFrontApp = (): void => {
    if (process.platform !== "darwin"
        || process.env.UI_TEST_FOCUS === "vscode") {
        return;
    }
    try {
        const front = execFileSync("lsappinfo", ["front"],
            { encoding: "utf8" }).trim();
        const info = execFileSync("lsappinfo",
            ["info", "-only", "bundlepath", front], { encoding: "utf8" });
        const path = /"LSBundlePath"="(.*)"/u.exec(info)?.[1];
        // Not a test VS Code a suite before left in front.
        if (path !== undefined && !path.includes("extest")) {
            frontApp = path;
        }
    } catch {
        // Nothing to give the focus back to.
    }
};

/**
 * Gives the focus back to the app noted, once VS Code is up: by its path,
 * so a VS Code of the user's own is the one picked, not the test one.
 * Twice, as VS Code may activate its window a moment after the workbench
 * is there.
 */
export const giveFocusBack = async (): Promise<void> => {
    const app = frontApp;
    if (app === undefined) {
        return;
    }
    for (const delay of [0, 1500]) {
        await new Promise((resolve) => { setTimeout(resolve, delay); });
        spawnSync("open", ["-a", app]);
    }
};
