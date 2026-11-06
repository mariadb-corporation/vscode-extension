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

import { reportError } from "../errorMessages.js";
import { buildWebviewHtml, webviewOptions } from "../webview/html.js";
import { errorText } from "../text.js";
import type { IModelSource } from "./modelSources.js";
import type {
    ModelerHostMessage,
    ModelerWebviewMessage,
} from "./modelerProtocol.js";
import { DEFAULT_PAGE_SETTINGS } from "./pageSettings.js";

/**
 * The webview panels of the schema diagram viewer: one per schema of a
 * connection, or per MSM project, opened on one of its diagrams. Opening
 * another diagram of the same schema shows it in the panel that is up.
 * Where the model comes from, and where changes go, is its source's
 * business (`modelSources.ts`).
 *
 * What is drawn, and how, lives in the webview (`webview/src/modeler/`).
 */

/** What a panel needs from the outside, so a test can supply its own. */
export interface IModelerHost {
    log(message: string): void;
}

/** The view type the panels are registered under. */
export const MODELER_VIEW_TYPE = "mariadb.modelViewer";

/**
 * @param schema The schema.
 * @param diagram The diagram shown.
 *
 * @returns The panel's title.
 */
const modelerTitle = (schema: string, diagram: string): string => {
    return `${diagram} (${schema})`;
};

/** A schema diagram viewer. */
export class ModelerPanel {
    static readonly #open = new Map<string, ModelerPanel>();

    #panel: vscode.WebviewPanel;
    #disposables: vscode.Disposable[] = [];
    /** The diagram to show once the model is there. */
    #diagram: string;
    /** The model being read for the page's first `ready`. */
    #reading?: ReturnType<IModelSource["read"]>;
    /** The snapshot's hash schema edits are made against. */
    #sourceHash?: string;
    /** The schema edits under way, which run one at a time. */
    #editing: Promise<void> = Promise.resolve();
    #schema: string;

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly source: IModelSource,
        diagram: string,
        private readonly host: IModelerHost,
    ) {
        this.#panel = panel;
        this.#diagram = diagram;
        this.#schema = source.schemaTitle;
    }

    /**
     * Shows a diagram: in the source's panel that is up, else in a new one.
     *
     * @param extensionUri The root of the installed extension.
     * @param source Where the model comes from.
     * @param diagram The diagram to show.
     * @param host What the panel needs from the extension.
     *
     * @returns Nothing.
     */
    public static show(
        extensionUri: vscode.Uri,
        source: IModelSource,
        diagram: string,
        host: IModelerHost,
    ): void {
        const open = ModelerPanel.#open.get(source.key);
        if (open !== undefined) {
            open.#showDiagram(diagram);
            open.#panel.reveal(vscode.ViewColumn.Active);

            return;
        }

        const title = modelerTitle(source.schemaTitle, diagram);
        const panel = vscode.window.createWebviewPanel(
            MODELER_VIEW_TYPE,
            title,
            vscode.ViewColumn.Active,
            {
                ...webviewOptions(extensionUri),
                // The scene is costly to build; keep it while the tab is
                // in the background.
                retainContextWhenHidden: true,
            },
        );
        ModelerPanel.#attach(extensionUri, panel, source, diagram, host);
    }

    /**
     * Takes a panel VS Code restored after a restart, which the webview's
     * state says the source of.
     *
     * @param extensionUri The root of the installed extension.
     * @param panel The panel.
     * @param source Where its model comes from.
     * @param diagram The diagram it showed.
     * @param host What the panel needs from the extension.
     *
     * @returns Nothing.
     */
    public static revive(
        extensionUri: vscode.Uri,
        panel: vscode.WebviewPanel,
        source: IModelSource,
        diagram: string,
        host: IModelerHost,
    ): void {
        const open = ModelerPanel.#open.get(source.key);
        if (open !== undefined) {
            // Restored twice: one panel per source.
            panel.dispose();

            return;
        }
        panel.webview.options = webviewOptions(extensionUri);
        ModelerPanel.#attach(extensionUri, panel, source, diagram, host);
    }

    static #attach(
        extensionUri: vscode.Uri,
        panel: vscode.WebviewPanel,
        source: IModelSource,
        diagram: string,
        host: IModelerHost,
    ): void {
        const title = modelerTitle(source.schemaTitle, diagram);
        panel.title = title;
        panel.webview.html = buildWebviewHtml(panel.webview, extensionUri,
            "modeler", title);

        const current = new ModelerPanel(panel, source, diagram, host);
        // Read while the page starts, not after.
        current.#reading = source.read();
        // A read the page never asks for (closed first) fails quietly.
        current.#reading.catch(() => { /* reported on ready */ });
        ModelerPanel.#open.set(source.key, current);
        source.onSaveState = (save) => {
            current.#post({ type: "saveState", save });
        };
        current.#disposables.push(
            panel.webview.onDidReceiveMessage((message: unknown) => {
                void current.#handle(message as ModelerWebviewMessage);
            }),
            panel.onDidDispose(() => { current.dispose(); }),
        );
    }

    #post(message: ModelerHostMessage): void {
        void this.#panel.webview.postMessage(message);
    }

    /** The diagram shown, and the tab's title with it. */
    #setDiagram(name: string): void {
        this.#diagram = name;
        this.#panel.title = modelerTitle(this.#schema, name);
    }

    #showDiagram(name: string): void {
        this.#setDiagram(name);
        this.#post({ type: "showDiagram", name });
    }

    async #handle(message: ModelerWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                await this.#load();
                break;
            }

            case "diagramShown": {
                this.#setDiagram(message.name);
                break;
            }

            case "diagramChanged": {
                this.source.changed?.(message.document);
                break;
            }

            case "imageWanted": {
                await this.#sendImage(message.diagram, message.figureId);
                break;
            }

            case "schemaEdit": {
                // One after the other: each is made against the snapshot
                // the one before it left.
                const edit = this.#editing.then(() => {
                    return this.#editSchema(message.edits);
                });
                this.#editing = edit;
                await edit;
                break;
            }

            default:
        }
    }

    /** Reads the model, and sends it to the page. */
    async #load(): Promise<void> {
        try {
            // Started as the panel opened, alongside the page's own start;
            // a reload of the page reads again.
            const reading = this.#reading ?? this.source.read();
            this.#reading = undefined;
            const { model, source } = await reading;
            this.#schema = model.schema;
            this.#sourceHash = model.sourceHash;
            this.#setDiagram(this.#diagram);
            this.host.log(`Showing the diagrams of ${model.schema} `
                + `from ${source}`);
            this.#post({
                type: "load",
                model,
                source,
                pageSettings: DEFAULT_PAGE_SETTINGS,
                diagram: this.#diagram,
                editable: this.source.editable,
                target: this.source.target(this.#diagram),
            });
        } catch (error) {
            const text = errorText(error);
            this.host.log(`Could not read the diagrams of `
                + `${this.#schema}: ${text}`);
            this.#post({ type: "error", message: text });
        }
    }

    async #sendImage(diagram: string, figureId: string): Promise<void> {
        if (this.source.image === undefined) {
            return;
        }
        try {
            const image = await this.source.image(diagram, figureId);
            this.#post({ type: "image", diagram, figureId, image });
        } catch (error) {
            this.#post({ type: "image", diagram, figureId,
                error: errorText(error) });
        }
    }

    async #editSchema(
        edits: Parameters<NonNullable<IModelSource["edit"]>>[0],
    ): Promise<void> {
        if (this.source.edit === undefined || this.#sourceHash === undefined) {
            this.#post({ type: "schemaEdited",
                error: "The schema of this diagram cannot be edited." });

            return;
        }
        try {
            const { model, notes } = await this.source.edit(edits,
                this.#sourceHash);
            this.#sourceHash = model.sourceHash;
            this.#post({
                type: "schemaEdited",
                objects: {
                    ...(model.sourceHash === undefined
                        ? {} : { sourceHash: model.sourceHash }),
                    tables: model.tables,
                    views: model.views,
                    routines: model.routines,
                },
            });
            if (notes.length > 0) {
                void vscode.window.showWarningMessage(
                    `The change to ${this.#schema} needs a look: `
                    + notes.join(" "));
            }
        } catch (error) {
            const text = reportError(this.host.log, error,
                `change the schema ${this.#schema}`);
            this.#post({ type: "schemaEdited", error: text });
            // The viewer showed the change already: it goes back to what
            // the project says.
            await this.#load();
        }
    }

    /**
     * Tears the panel down; what is waiting to be saved is saved.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        if (ModelerPanel.#open.get(this.source.key) === this) {
            ModelerPanel.#open.delete(this.source.key);
        }
        this.source.onSaveState = undefined;
        void this.source.flush?.().catch((error: unknown) => {
            this.host.log(`Could not save the diagrams of ${this.#schema}: `
                + errorText(error));
        });
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#disposables = [];
    }
}
