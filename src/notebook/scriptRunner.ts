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

import { Worker } from "node:worker_threads";

import { errorText } from "../text.js";
import type {
    FromWorkerMessage,
    PrintedValue,
    ToWorkerMessage,
} from "./scriptProtocol.js";

/** What the runner needs of a worker thread, so a test can stand in. */
export interface IScriptWorker {
    postMessage(message: ToWorkerMessage): void;
    on(event: "message", listener: (message: FromWorkerMessage) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "exit", listener: (code: number) => void): void;
    terminate(): Promise<number>;
}

/** What a running cell is given to do its work through. */
export interface IScriptHost {
    /** Shows something the cell printed, as it is printed. */
    print(value: PrintedValue): void;
    /** Runs SQL on the notebook's connection and answers its rows. */
    runSql(sql: string): Promise<Array<Record<string, unknown>>>;
}

/** How a cell's run ended. */
export interface IScriptOutcome {
    /** What it failed with, its stack cut to the cell's own frames. */
    error?: string;
    /** True where it was interrupted, and its notebook's state with it. */
    interrupted?: boolean;
}

/** One cell running on a worker. */
interface IRunning {
    runId: number;
    host: IScriptHost;
    settle(outcome: IScriptOutcome): void;
}

/** A notebook's worker, and the cell running on it, if any. */
interface INotebookWorker {
    worker: IScriptWorker;
    running?: IRunning;
}

/**
 * Runs the TypeScript cells of each notebook in a worker thread of its own,
 * one cell at a time. A notebook's worker - and with it anything
 * else its cells left behind - lives until it is interrupted, the worker
 * fails, or the notebook is closed.
 */
export class ScriptRunner {
    readonly #workers = new Map<string, INotebookWorker>();
    #runCount = 0;

    /**
     * @param createWorker Starts a worker thread: the built
     *        `notebookWorker.js`, outside the tests.
     */
    public constructor(
        private readonly createWorker: () => IScriptWorker,
    ) { }

    /**
     * @param path Where the built worker is.
     *
     * @returns A runner starting its workers from there.
     */
    public static fromFile(path: string): ScriptRunner {
        return new ScriptRunner(() => {
            return new Worker(path) as unknown as IScriptWorker;
        });
    }

    /**
     * Runs a cell's TypeScript in its notebook's worker.
     *
     * @param notebook Which notebook, as `Uri.toString()` renders it.
     * @param code The cell's TypeScript.
     * @param host What it prints to and runs SQL through.
     *
     * @returns How it ended.
     */
    public run(
        notebook: string,
        code: string,
        host: IScriptHost,
    ): Promise<IScriptOutcome> {
        const held = this.#workerFor(notebook);
        if (held.running !== undefined) {
            return Promise.resolve({
                error: "Another cell of this notebook is still running.",
            });
        }

        this.#runCount += 1;
        const runId = this.#runCount;

        return new Promise((resolve) => {
            held.running = {
                runId,
                host,
                settle: (outcome) => {
                    held.running = undefined;
                    resolve(outcome);
                },
            };
            held.worker.postMessage({ type: "run", runId, code });
        });
    }

    /**
     * Stops what a notebook's worker is running, and the worker with it:
     * the next cell starts on a fresh one, nothing declared.
     *
     * @param notebook Which notebook.
     *
     * @returns Nothing.
     */
    public interrupt(notebook: string): void {
        const held = this.#workers.get(notebook);
        if (held === undefined) {
            return;
        }

        this.#workers.delete(notebook);
        held.running?.settle({ interrupted: true });
        void held.worker.terminate();
    }

    /**
     * Lets go of a notebook's worker, as when it is closed.
     *
     * @param notebook Which notebook.
     *
     * @returns Nothing.
     */
    public forget(notebook: string): void {
        this.interrupt(notebook);
    }

    /**
     * @param notebook Which notebook.
     *
     * @returns Its worker, started if it has none.
     */
    #workerFor(notebook: string): INotebookWorker {
        const known = this.#workers.get(notebook);
        if (known !== undefined) {
            return known;
        }

        const held: INotebookWorker = { worker: this.createWorker() };
        this.#workers.set(notebook, held);
        held.worker.on("message", (message) => {
            void this.#onMessage(held, message);
        });
        const lost = (why: string): void => {
            if (this.#workers.get(notebook) === held) {
                this.#workers.delete(notebook);
            }
            held.running?.settle({ error: why });
        };
        held.worker.on("error", (error) => {
            lost(`The notebook's TypeScript worker failed: ${error.message}`);
        });
        held.worker.on("exit", (code) => {
            lost(`The notebook's TypeScript worker stopped (exit code ${code}).`);
        });

        return held;
    }

    /**
     * Handles a message from a worker.
     *
     * @param held The worker it came from.
     * @param message What it said.
     *
     * @returns Nothing.
     */
    async #onMessage(
        held: INotebookWorker,
        message: FromWorkerMessage,
    ): Promise<void> {
        const running = held.running;
        // What a cell's timer prints once the cell is over has nowhere to go.
        if (running === undefined || running.runId !== message.runId) {
            return;
        }

        switch (message.type) {
            case "print": {
                running.host.print(message.value);
                break;
            }

            case "runSql": {
                let reply: ToWorkerMessage;
                try {
                    reply = {
                        type: "sqlResult",
                        requestId: message.requestId,
                        rows: await running.host.runSql(message.sql),
                    };
                } catch (error) {
                    reply = {
                        type: "sqlResult",
                        requestId: message.requestId,
                        error: errorText(error),
                    };
                }
                held.worker.postMessage(reply);
                break;
            }

            case "done": {
                running.settle(message.error === undefined
                    ? {}
                    : { error: message.error });
                break;
            }
        }
    }

    /**
     * Stops every worker.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        for (const notebook of [...this.#workers.keys()]) {
            this.interrupt(notebook);
        }
    }
}
