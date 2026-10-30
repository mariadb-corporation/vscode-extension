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

import type { HostMessage, WebviewMessage } from "../../src/webview/protocol.js";
import { post } from "./vscodeApi.js";

/**
 * How the result view talks to the extension. The panel and a maximized
 * tab are webviews of their own, and use the window's messages; a notebook
 * output speaks through its renderer's messaging instead.
 */
export interface IHostTransport {
    /** Sends a message to the extension. */
    post(message: WebviewMessage): void;

    /**
     * Listens for the extension's messages.
     *
     * @param listener Called with each.
     *
     * @returns A function that stops listening.
     */
    listen(listener: (message: HostMessage) => void): () => void;
}

/** A webview of the result view's own: the window's messages. */
export const windowTransport: IHostTransport = {
    post,
    listen: (listener) => {
        const onMessage = (event: MessageEvent<HostMessage>): void => {
            listener(event.data);
        };
        window.addEventListener("message", onMessage);

        return () => {
            window.removeEventListener("message", onMessage);
        };
    },
};
