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

import { By, type WebElement } from "vscode-extension-tester";

import { driver, sleep } from "./ui.js";

/**
 * Real input through the Chrome DevTools protocol, for what WebDriver's
 * actions cannot do: an HTML5 drag. ChromeDriver's pointer actions start
 * none, so a drag from a tree row is made here as a user's is: the mouse
 * pressed and moved on the row starts the workbench's own drag, which
 * Chromium hands back (`Input.setInterceptDrags`) with the data VS Code
 * put on it, and which is then moved where it should go and dropped
 * (`Input.dispatchDragEvent`), with the modifiers a user would hold.
 */

/** Node's own WebSocket, which the ES-only lib of these tests does not type. */
interface ISocket {
    send(data: string): void;
    close(): void;
    addEventListener(type: "message", listener: (event: { data: string }) => void): void;
    addEventListener(type: "open" | "error" | "close",
        listener: (event: unknown) => void): void;
}
declare const WebSocket: new (url: string) => ISocket;

/** A drag's data, as Chromium hands it back and takes it again. */
export interface IDragData {
    items: Array<{ mimeType: string; data: string }>;
    dragOperationsMask: number;
    files?: string[];
}

/** The DevTools protocol modifier of the Shift key. */
const SHIFT = 8;

/** A connection to the workbench page. */
class DevTools {
    #nextId = 1;
    readonly #waiting = new Map<number, {
        done: (result: unknown) => void;
        failed: (error: Error) => void;
    }>();
    readonly #listeners = new Map<string, Array<(params: unknown) => void>>();

    public constructor(private readonly socket: ISocket) {
        socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data) as {
                id?: number;
                method?: string;
                params?: unknown;
                result?: unknown;
                error?: { message: string };
            };
            if (message.id !== undefined) {
                const waiting = this.#waiting.get(message.id);
                this.#waiting.delete(message.id);
                if (message.error !== undefined) {
                    waiting?.failed(new Error(message.error.message));
                } else {
                    waiting?.done(message.result);
                }
            } else if (message.method !== undefined) {
                for (const listener of this.#listeners.get(message.method) ?? []) {
                    listener(message.params);
                }
            }
        });
    }

    /**
     * @param method A protocol method.
     * @param params Its parameters.
     *
     * @returns Its result.
     */
    public send(method: string, params: object = {}): Promise<unknown> {
        const id = this.#nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));

        return new Promise((done, failed) => {
            this.#waiting.set(id, { done, failed });
        });
    }

    /**
     * @param method An event.
     * @param timeout How long to wait for it.
     *
     * @returns The next one's parameters.
     */
    public next<T>(method: string, timeout: number): Promise<T> {
        return new Promise((done, failed) => {
            const timer = setTimeout(() => {
                failed(new Error(`No ${method} within ${timeout} ms`));
            }, timeout);
            const listeners = this.#listeners.get(method) ?? [];
            listeners.push((params) => {
                clearTimeout(timer);
                done(params as T);
            });
            this.#listeners.set(method, listeners);
        });
    }

    public close(): void {
        this.socket.close();
    }
}

/**
 * @returns A connection to the VS Code window's workbench page, through
 *          the debugging address ChromeDriver started Electron with.
 */
const workbench = async (): Promise<DevTools> => {
    const capabilities = await driver().getCapabilities();
    const address = (capabilities.get("goog:chromeOptions") as
        { debuggerAddress?: string } | undefined)?.debuggerAddress;
    if (address === undefined) {
        throw new Error("ChromeDriver reported no debuggerAddress for "
            + "VS Code: no DevTools protocol to drag with");
    }
    const targets = await (await fetch(`http://${address}/json/list`))
        .json() as Array<{ type: string; url: string;
            webSocketDebuggerUrl: string }>;
    const page = targets.find((target) => {
        return target.type === "page" && target.url.includes("workbench");
    });
    if (page === undefined) {
        throw new Error("No workbench page among the DevTools targets: "
            + targets.map((target) => { return target.url; }).join(", "));
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, failed) => {
        socket.addEventListener("open", done);
        socket.addEventListener("error", () => {
            failed(new Error(`Could not connect to ${page.url}`));
        });
    });

    return new DevTools(socket);
};

/**
 * @param element An element of the workbench (not inside a webview).
 *
 * @returns Its middle, in the page's CSS pixels.
 */
export const middleOf = async (
    element: WebElement,
): Promise<{ x: number; y: number }> => {
    const rect = await element.getRect();

    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

/**
 * Drags an element of the workbench over a point, as a user does with the
 * mouse, holding Shift over the target as VS Code asks for a drag into a
 * webview, and drops it on the title bar (see below for why not there).
 *
 * @param from The element dragged: a tree row.
 * @param to The point dragged over, in the page's CSS pixels.

 * @returns The data VS Code put on the drag.
 */
export const shiftDrag = async (
    from: WebElement,
    to: { x: number; y: number },
): Promise<IDragData> => {
    const devTools = await workbench();
    try {
        await devTools.send("Input.setInterceptDrags", { enabled: true });
        const intercepted = devTools.next<{ data: IDragData }>(
            "Input.dragIntercepted", 5000);
        const start = await middleOf(from);
        const mouse = (type: string, x: number, y: number, buttons: number,
            modifiers = 0) => {
            return devTools.send("Input.dispatchMouseEvent", {
                type, x, y, button: "left", buttons, clickCount: 1,
                modifiers,
            });
        };
        await mouse("mouseMoved", start.x, start.y, 0);
        await mouse("mousePressed", start.x, start.y, 1);
        // Far enough for the workbench to start its drag.
        for (let step = 1; step <= 5; step += 1) {
            await mouse("mouseMoved", start.x + step * 4, start.y + step * 2, 1);
            await sleep(30);
        }
        const { data } = await intercepted;

        // Over the target, Shift held, the way a pointer moves there: VS
        // Code lets a drag into a webview only while Shift is down.
        const drag = (type: string, x: number, y: number) => {
            return devTools.send("Input.dispatchDragEvent", {
                type, x, y, data, modifiers: SHIFT,
            });
        };
        await drag("dragEnter", to.x - 40, to.y - 20);
        for (let step = 0; step <= 8; step += 1) {
            await drag("dragOver", to.x - 40 + step * 5, to.y - 20 + step * 2.5);
            await sleep(50);
        }
        // Dropped outside the webview, on the title bar. A drop over the
        // webview never ends the drag Chromium handed over: Electron
        // refuses it, and from then on no input at all - mouse or keys,
        // WebDriver's or the DevTools protocol's - reaches the workbench,
        // so every test after a drag failed. The diagram does not need the
        // drop: it learns of the drag from the tree, and places the table
        // where the pointer next moves over it.
        const out = await middleOf(await driver().findElement(
            By.css(".part.titlebar")));
        for (let step = 1; step <= 4; step += 1) {
            await drag("dragOver", to.x + (out.x - to.x) * step / 4,
                to.y + (out.y - to.y) * step / 4);
            await sleep(30);
        }
        await drag("drop", out.x, out.y);
        await mouse("mouseReleased", out.x, out.y, 0, SHIFT);

        return data;
    } finally {
        await devTools.send("Input.setInterceptDrags", { enabled: false })
            .catch(() => { /* the window went */ });
        devTools.close();
    }
};

/**
 * Moves the mouse to a point, no button held, as a user's hand does.
 *
 * @param to The point, in the page's CSS pixels.
 *
 * @returns Nothing.
 */
export const moveMouse = async (to: { x: number; y: number }): Promise<void> => {
    const devTools = await workbench();
    try {
        for (let step = 0; step < 3; step += 1) {
            await devTools.send("Input.dispatchMouseEvent", {
                type: "mouseMoved", x: to.x + step * 3, y: to.y + step * 2,
                button: "none", buttons: 0,
            });
            await sleep(30);
        }
    } finally {
        devTools.close();
    }
};
