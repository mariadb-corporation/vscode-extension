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

import type { ConnectionManager } from "../connections/connectionManager.js";
import type { SqlEditorBinding } from "../editor/sqlEditorBinding.js";
import { ExecutionService } from "../sql/executionService.js";
import { errorText } from "../text.js";
import type {
    HostMessage,
    IResultSet,
    WebviewMessage,
} from "../webview/protocol.js";
import type {
    IApplyContext,
    INotebookResultView,
    ResultViewProvider,
} from "../webview/resultViewProvider.js";
import {
    type IHostRendererMessage,
    type IRendererMessage,
    NOTEBOOK_RENDERER_ID,
} from "./notebookProtocol.js";

/** A cell's view as held here: where it is, and where to reach it. */
interface IHeldView extends INotebookResultView {
    /** The notebook it is in, as `Uri.toString()` renders it. */
    notebook: string;
    /** The cell it is under, where it came from a run of this session. */
    cell?: string;
    /** The editor it last spoke from, which replies go to. */
    editor?: vscode.NotebookEditor;
}

/** What a cell's run hands over for its view. */
export interface INotebookViewRegistration {
    viewId: string;
    notebook: vscode.NotebookDocument;
    cell: vscode.NotebookCell;
    connection: string;
    applyContext: IApplyContext;
    resultSets: IResultSet[];
}

/**
 * The views of the result sets under notebook cells, and the renderer
 * messaging that connects them to the extension.
 *
 * A run of a cell registers its view; the view's messages are then
 * handled as the panel's are (`ResultViewProvider.onNotebookMessage`),
 * except a refresh, which re-runs the statement here and puts the new
 * result in the same tab. A reopened notebook's outputs are views of a
 * session long gone: such a view is taken up from what it sends with its
 * `ready`, and connects the first time it needs to.
 */
export class NotebookResults implements vscode.Disposable {
    readonly #views = new Map<string, IHeldView>();
    readonly #messaging: vscode.NotebookRendererMessaging;
    readonly #disposables: vscode.Disposable[] = [];

    /**
     * @param resultView What the panel and the views share.
     * @param editors Runs a statement again, for a refresh.
     * @param connections Opens a connection for a reopened notebook's view.
     * @param log Where failures are noted.
     */
    public constructor(
        private readonly resultView: ResultViewProvider,
        private readonly editors: SqlEditorBinding,
        private readonly connections: ConnectionManager,
        private readonly log: (message: string) => void,
    ) {
        this.#messaging = vscode.notebooks.createRendererMessaging(
            NOTEBOOK_RENDERER_ID);
        this.#disposables.push(
            this.#messaging.onDidReceiveMessage(async (event) => {
                await this.#onMessage(event.editor,
                    event.message as IRendererMessage);
            }),
            vscode.workspace.onDidCloseNotebookDocument((notebook) => {
                this.#forget((view) => {
                    return view.notebook === notebook.uri.toString();
                });
            }),
        );
    }

    /**
     * Takes up the view of a cell's run, in place of the one its last run
     * left.
     *
     * @param registration The run's view, and where it is.
     *
     * @returns Nothing.
     */
    public register(registration: INotebookViewRegistration): void {
        const cell = registration.cell.document.uri.toString();
        this.forgetCell(registration.cell);
        this.#views.set(registration.viewId, this.#held({
            id: registration.viewId,
            notebook: registration.notebook.uri.toString(),
            cell,
            connection: registration.connection,
            resultSets: registration.resultSets,
            applyContext: registration.applyContext,
        }));
    }

    /**
     * Lets go of the view a cell's last run left, which a new run replaces.
     *
     * @param cell The cell.
     *
     * @returns Nothing.
     */
    public forgetCell(cell: vscode.NotebookCell): void {
        const key = cell.document.uri.toString();
        this.#forget((view) => { return view.cell === key; });
    }

    /**
     * @param viewId A view's id.
     *
     * @returns The view, if it is held.
     */
    public view(viewId: string): INotebookResultView | undefined {
        return this.#views.get(viewId);
    }

    /**
     * @param fields What the view is.
     * @param fields.id Its id.
     * @param fields.notebook The notebook it is in.
     * @param fields.cell The cell it is under, where known.
     * @param fields.connection The connection its cell ran on.
     * @param fields.resultSets Its result sets.
     * @param fields.applyContext Where it writes back, where connected.
     *
     * @returns The view, reaching the editor it last spoke from.
     */
    #held(fields: {
        id: string;
        notebook: string;
        cell?: string;
        connection: string;
        resultSets: IResultSet[];
        applyContext?: IApplyContext;
    }): IHeldView {
        const view: IHeldView = {
            ...fields,
            label: this.connections.labelFor(fields.connection),
            send: (message: HostMessage) => {
                const wrapped: IHostRendererMessage = {
                    viewId: view.id,
                    message,
                };
                void this.#messaging.postMessage(wrapped, view.editor);
            },
        };

        return view;
    }

    /**
     * Handles a message from a view.
     *
     * @param editor The notebook editor it came from.
     * @param received What it sent.
     *
     * @returns Nothing.
     */
    async #onMessage(
        editor: vscode.NotebookEditor,
        received: IRendererMessage,
    ): Promise<void> {
        if (typeof received?.viewId !== "string") {
            return;
        }

        let view = this.#views.get(received.viewId);
        if (view === undefined && received.seed !== undefined) {
            view = this.#held({
                id: received.viewId,
                notebook: editor.notebook.uri.toString(),
                connection: received.seed.connection,
                resultSets: received.seed.resultSets,
            });
            this.#views.set(view.id, view);
        }
        if (view === undefined) {
            this.log("A notebook result set spoke, but its cell's run is "
                + "no longer known; run the cell again.");

            return;
        }
        view.editor = editor;

        const message: WebviewMessage = received.message;
        try {
            if (message.type === "refresh") {
                await this.#refresh(view, message.resultId);

                return;
            }
            if (message.type === "applyChanges" || message.type === "page") {
                await this.#connect(view);
            }
            await this.resultView.onNotebookMessage(view, message);
        } catch (error) {
            this.log(`A notebook result set's ${message.type} failed: `
                + errorText(error));
        }
    }

    /**
     * Opens the connection a reopened notebook's view writes back and
     * pages through, the first time it needs one.
     *
     * @param view The view.
     *
     * @returns Nothing; a failure leaves it unconnected, which the grid is
     *          then told as for any result set no longer available.
     */
    async #connect(view: IHeldView): Promise<void> {
        if (view.applyContext !== undefined) {
            return;
        }

        try {
            const connectionId = await this.connections.connect(
                view.connection);
            view.applyContext = {
                connectionUri: view.connection,
                connectionId,
                service: new ExecutionService(await this.connections.api()),
            };
        } catch (error) {
            this.log(`Could not connect to ${view.connection} for a notebook `
                + `result set: ${errorText(error)}`);
        }
    }

    /**
     * Runs a result set's statement again and puts what it returns in the
     * same tab.
     *
     * @param view The view it is in.
     * @param resultId The result set.
     *
     * @returns Nothing; a failure is the grid's to say.
     */
    async #refresh(view: IHeldView, resultId: string): Promise<void> {
        const shown = view.resultSets.find((set) => {
            return set.id === resultId;
        });
        if (shown === undefined || shown.statement.trim().length === 0) {
            return;
        }

        let error: string | undefined;
        try {
            const { report, connectionId, service } =
                await this.editors.executeScript(
                    view.connection, `${shown.statement};`, {
                        runId: this.editors.nextRunId(),
                        stopOnError: true,
                        label: "1 statement",
                    });
            view.applyContext = {
                connectionUri: view.connection,
                connectionId,
                service,
            };
            const fresh = report.resultSets[0];
            if (fresh !== undefined) {
                // A new id, so the grid starts afresh on it: the edits
                // just written back are in its rows now.
                view.resultSets = view.resultSets.map((set) => {
                    return set.id === resultId
                        ? { ...fresh, caption: set.caption }
                        : set;
                });
                view.send(this.resultView.notebookState(view));

                return;
            }
            error = report.actions.flatMap((run) => {
                return run.children ?? [];
            }).find((row) => {
                return row.kind === "error";
            })?.message ?? "The statement returned no result set.";
        } catch (failure) {
            error = errorText(failure);
        }

        view.send({ type: "pageFailed", resultId, error });
    }

    /**
     * @param which Picks the views to let go of.
     *
     * @returns Nothing.
     */
    #forget(which: (view: IHeldView) => boolean): void {
        for (const [id, view] of this.#views) {
            if (which(view)) {
                this.#views.delete(id);
            }
        }
    }

    /**
     * Stops listening, and lets go of every view.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#views.clear();
    }
}
