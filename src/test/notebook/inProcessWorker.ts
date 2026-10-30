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

import type { FromWorkerMessage } from "../../notebook/scriptProtocol.js";
import type { IScriptWorker } from "../../notebook/scriptRunner.js";
import { createScriptSandbox } from "../../notebook/scriptSandbox.js";

/**
 * A notebook's TypeScript worker, run in-process: the real sandbox, its
 * messages passed asynchronously as a thread's would be.
 *
 * @returns The worker, and whether it was terminated.
 */
export const createInProcessWorker = (): IScriptWorker & {
    terminated: boolean;
} => {
    const listeners = {
        message: new Set<(message: FromWorkerMessage) => void>(),
        error: new Set<(error: Error) => void>(),
        exit: new Set<(code: number) => void>(),
    };
    const worker = {
        terminated: false,
        postMessage: (message: Parameters<IScriptWorker["postMessage"]>[0]) => {
            if (!worker.terminated) {
                queueMicrotask(() => { sandbox.receive(message); });
            }
        },
        on: (event: "message" | "error" | "exit", listener: never) => {
            (listeners[event] as Set<unknown>).add(listener);
        },
        terminate: () => {
            worker.terminated = true;
            for (const listener of listeners.exit) {
                listener(1);
            }

            return Promise.resolve(1);
        },
    };
    const sandbox = createScriptSandbox((message) => {
        queueMicrotask(() => {
            if (worker.terminated) {
                return;
            }
            for (const listener of listeners.message) {
                listener(message);
            }
        });
    });

    return worker as IScriptWorker & { terminated: boolean };
};
