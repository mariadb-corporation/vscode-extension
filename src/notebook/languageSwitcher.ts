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

import { detectLanguage } from "./languageDetection.js";
import { isMariaDbNotebook } from "./notebookConnection.js";

/** How long typing has to pause before a cell's language is looked at. */
export const DETECT_DELAY_MS = 300;

/** The scheme of a notebook cell's document. */
const CELL_SCHEME = "vscode-notebook-cell";

/**
 * Switches a MariaDB Notebook's code cells between SQL and TypeScript as
 * they are typed, where how a cell starts settles it (`detectLanguage`).
 * A new cell starts in the language of the one above it, which VS Code
 * does itself.
 *
 * A cell whose language the user picked by hand is left alone from then
 * on: `languagePinned` in its metadata, saved with the notebook. VS Code
 * closes a cell's document and opens it again when its language changes;
 * one that comes back in a language other than the one last seen - and not
 * the one switched to here - was changed by hand.
 */
export class LanguageSwitcher implements vscode.Disposable {
    /** Cell document -> the language it was last seen in, or switched to. */
    readonly #expected = new Map<string, string>();
    readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
    readonly #disposables: vscode.Disposable[] = [];

    /**
     * @param log Where a failed switch is noted.
     * @param delayMs How long typing has to pause first.
     */
    public constructor(
        private readonly log: (message: string) => void,
        private readonly delayMs = DETECT_DELAY_MS,
    ) {
        this.#disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0) {
                    this.#schedule(event.document);
                }
            }),
            vscode.workspace.onDidOpenTextDocument((document) => {
                this.#seen(document);
            }),
        );
    }

    /**
     * Looks at a cell's language right away, as a pause in typing would.
     *
     * @param document The cell's document.
     *
     * @returns Once it is switched, or found not to need it.
     */
    public async detectNow(document: vscode.TextDocument): Promise<void> {
        const key = document.uri.toString();
        clearTimeout(this.#timers.get(key));
        this.#timers.delete(key);
        await this.#detect(document);
    }

    /**
     * @param document A document that changed.
     *
     * @returns Nothing.
     */
    #schedule(document: vscode.TextDocument): void {
        if (document.uri.scheme !== CELL_SCHEME) {
            return;
        }

        const key = document.uri.toString();
        if (!this.#expected.has(key)) {
            this.#expected.set(key, document.languageId);
        }
        clearTimeout(this.#timers.get(key));
        this.#timers.set(key, setTimeout(() => {
            this.#timers.delete(key);
            void this.#detect(document);
        }, this.delayMs));
    }

    /**
     * Notes the language a cell's document came back in, and pins the cell
     * where that was the user's doing.
     *
     * @param document A document that was opened.
     *
     * @returns Nothing.
     */
    #seen(document: vscode.TextDocument): void {
        if (document.uri.scheme !== CELL_SCHEME) {
            return;
        }

        const key = document.uri.toString();
        const expected = this.#expected.get(key);
        this.#expected.set(key, document.languageId);
        if (expected === undefined || expected === document.languageId) {
            return;
        }

        const found = this.#cellOf(document);
        if (found !== undefined && !this.#pinned(found.cell)) {
            void this.#pin(found.notebook, found.cell);
        }
    }

    /**
     * Switches a cell to the language its text says, where it says one.
     *
     * @param document The cell's document.
     *
     * @returns Nothing.
     */
    async #detect(document: vscode.TextDocument): Promise<void> {
        const found = this.#cellOf(document);
        if (found === undefined
            || found.cell.kind !== vscode.NotebookCellKind.Code
            || this.#pinned(found.cell)) {
            return;
        }

        const language = detectLanguage(document.getText());
        if (language === undefined || language === document.languageId) {
            return;
        }

        this.#expected.set(document.uri.toString(), language);
        try {
            await vscode.languages.setTextDocumentLanguage(document, language);
        } catch (error) {
            this.#expected.set(document.uri.toString(), document.languageId);
            this.log(`Could not switch a notebook cell to ${language}: ${
                error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * @param document A cell's document.
     *
     * @returns The cell, and the MariaDB Notebook it is in.
     */
    #cellOf(document: vscode.TextDocument): {
        notebook: vscode.NotebookDocument;
        cell: vscode.NotebookCell;
    } | undefined {
        const key = document.uri.toString();
        for (const notebook of vscode.workspace.notebookDocuments) {
            if (!isMariaDbNotebook(notebook)) {
                continue;
            }
            const cell = notebook.getCells().find((candidate) => {
                return candidate.document.uri.toString() === key;
            });
            if (cell !== undefined) {
                return { notebook, cell };
            }
        }

        return undefined;
    }

    /**
     * @param cell A cell.
     *
     * @returns Whether its language was picked by hand.
     */
    #pinned(cell: vscode.NotebookCell): boolean {
        return cell.metadata.languagePinned === true;
    }

    /**
     * Records in a cell that its language was picked by hand.
     *
     * @param notebook The notebook it is in.
     * @param cell The cell.
     *
     * @returns Nothing.
     */
    async #pin(
        notebook: vscode.NotebookDocument,
        cell: vscode.NotebookCell,
    ): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [vscode.NotebookEdit.updateCellMetadata(
            cell.index, { ...cell.metadata, languagePinned: true })]);
        await vscode.workspace.applyEdit(edit);
    }

    /**
     * Stops listening.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        for (const timer of this.#timers.values()) {
            clearTimeout(timer);
        }
        this.#timers.clear();
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
    }
}
