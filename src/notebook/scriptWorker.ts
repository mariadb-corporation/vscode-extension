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
 * The entry of a notebook's TypeScript worker thread, built on its own to
 * `dist/notebookWorker.js` (`vite.worker.config.ts`) so the transpiler is
 * only loaded once a TypeScript cell runs. It only wires the thread's port
 * to the sandbox.
 */

import { parentPort } from "node:worker_threads";

import type { ToWorkerMessage } from "./scriptProtocol.js";
import { createScriptSandbox } from "./scriptSandbox.js";

const port = parentPort;
if (port !== null) {
    const sandbox = createScriptSandbox((message) => {
        port.postMessage(message);
    });
    port.on("message", (message: ToWorkerMessage) => {
        sandbox.receive(message);
    });
}
