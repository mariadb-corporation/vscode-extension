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
 * A stand-in for the `vscode` module. The extension host provides the real
 * one, which cannot be imported from a plain Node process, so the vitest
 * config aliases `vscode` onto this file.
 *
 * Only what the extension actually touches is modelled here, and every call
 * is recorded so tests can assert on it.
 */

/** The editor version `vscode.version` reports. */
export const version = "1.139.0";

export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
}

export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}

export interface Progress<T> {
    report(value: T): void;
}

export interface ProgressOptions {
    location: ProgressLocation | { viewId: string };
    title?: string;
    cancellable?: boolean;
}

export interface CancellationToken {
    isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): Disposable;
}

export interface Disposable {
    dispose(): unknown;
}

/** A stand-in for `vscode.Uri`, keeping only the path and the query. */
export class Uri {
    private constructor(
        public readonly scheme: string,
        public readonly path: string,
        public readonly query = "",
    ) { }

    public static from(components: {
        scheme: string;
        path?: string;
        query?: string;
    }): Uri {
        return new Uri(
            components.scheme, components.path ?? "", components.query ?? "");
    }

    public static file(path: string): Uri {
        return new Uri("file", path);
    }

    public static parse(value: string): Uri {
        const match = /^(\w+):\/\/(.*)$/.exec(value);

        return match
            ? new Uri(match[1], match[2])
            : new Uri("file", value);
    }

    public static joinPath(base: Uri, ...parts: string[]): Uri {
        const path = [base.path.replace(/\/$/, ""), ...parts].join("/");

        return new Uri(base.scheme, path);
    }

    public get fsPath(): string {
        return this.path;
    }

    public toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

export class DataTransferItem {
    public constructor(public readonly value: unknown) { }
}

export class DataTransfer {
    readonly #items = new Map<string, DataTransferItem>();

    public get(mimeType: string): DataTransferItem | undefined {
        return this.#items.get(mimeType);
    }

    public set(mimeType: string, value: DataTransferItem): void {
        this.#items.set(mimeType, value);
    }
}

export class ThemeColor {
    public constructor(public readonly id: string) { }
}

export class FileDecoration {
    public constructor(
        public readonly badge?: string,
        public readonly tooltip?: string,
        public readonly color?: ThemeColor,
    ) { }
}

export class ThemeIcon {
    public constructor(
        public readonly id: string,
        public readonly color?: ThemeColor,
    ) { }
}

export class TreeItem {
    public iconPath?: unknown;
    public contextValue?: string;
    public description?: string | boolean;
    public tooltip?: string;
    public command?: unknown;
    public resourceUri?: Uri;

    public constructor(
        public label: string,
        public collapsibleState: TreeItemCollapsibleState =
        TreeItemCollapsibleState.None,
    ) { }
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
}

export enum FileChangeType {
    Changed = 1,
    Created = 2,
    Deleted = 3,
}

export enum FilePermission {
    Readonly = 1,
}

/** A stand-in for FileSystemError, telling its kinds apart by `code`. */
export class FileSystemError extends Error {
    public constructor(message: string, public readonly code: string) {
        super(message);
    }

    public static FileNotFound(what?: unknown): FileSystemError {
        return new FileSystemError(`Not found: ${String(what)}`,
            "FileNotFound");
    }

    public static NoPermissions(what?: unknown): FileSystemError {
        return new FileSystemError(String(what), "NoPermissions");
    }

    public static Unavailable(what?: unknown): FileSystemError {
        return new FileSystemError(String(what), "Unavailable");
    }
}

/** Every `vscode.open` call: what was opened, and where. */
export const openedWith: Array<{ uri: Uri; options: unknown }> = [];

/** The file system providers registered, by scheme. */
export const fileSystemProviders = new Map<string, unknown>();

export class SemanticTokensLegend {
    public constructor(public readonly tokenTypes: string[]) { }
}

/** A token as a test asserts it: where it is, not how it is encoded. */
export interface MockSemanticToken {
    line: number;
    start: number;
    length: number;
}

/**
 * Keeps the positions it is given. The real builder encodes them
 * relative to each other, which is VS Code's business, not the
 * provider's.
 */
export class SemanticTokensBuilder {
    readonly #tokens: MockSemanticToken[] = [];

    public push(line: number, start: number, length: number): void {
        this.#tokens.push({ line, start, length });
    }

    public build(): { tokens: MockSemanticToken[] } {
        return { tokens: [...this.#tokens] };
    }
}

export class EventEmitter<T> {
    readonly #listeners = new Set<(value: T) => void>();

    public readonly event = (listener: (value: T) => void): Disposable => {
        this.#listeners.add(listener);

        return {
            dispose: () => {
                this.#listeners.delete(listener);
            },
        };
    };

    public fire(value: T): void {
        for (const listener of this.#listeners) {
            listener(value);
        }
    }

    public dispose(): void {
        this.#listeners.clear();
    }
}

export interface WithProgressCall {
    options: ProgressOptions;
    reported: string[];
    /** Presses the notification's Cancel button. */
    cancel: () => void;
}

/** Every `withProgress` call made since the last `resetVscodeMock()`. */
export const withProgressCalls: WithProgressCall[] = [];
export const informationMessages: string[] = [];
export const warningMessages: string[] = [];

/** What the next `showWarningMessage` answers with; see the mock below. */
let warningMessageAnswer: string | undefined;

/**
 * Makes the next warning dialog answer with the given button.
 *
 * @param answer The button to press, or undefined to dismiss it.
 *
 * @returns Nothing.
 */
export const setWarningMessageAnswer = (answer: string | undefined): void => {
    warningMessageAnswer = answer;
};
/** Every `showWarningMessage` call, with its options and buttons. */
export const warningMessageCalls: Array<{
    message: string;
    items: unknown[];
}> = [];
/** Every `showInformationMessage` call, with its options and buttons. */
export const informationMessageCalls: Array<{
    message: string;
    items: unknown[];
}> = [];

/** What the next `showInformationMessage` answers with. */
let informationMessageAnswer: string | undefined;

/**
 * Makes the next information message answer with the given button.
 *
 * @param answer The button to press, or undefined to dismiss it.
 *
 * @returns Nothing.
 */
export const setInformationMessageAnswer = (
    answer: string | undefined,
): void => {
    informationMessageAnswer = answer;
};
/** Every URI `env.openExternal` was asked to open. */
export const openedExternally: Uri[] = [];
export const errorMessages: string[] = [];

/** What the next `showErrorMessage` answers with: a button, or nothing. */
let errorMessageAnswer: string | undefined;

/**
 * Makes the next error notification answer with the given button.
 *
 * @param answer The button to press, or undefined to dismiss it.
 *
 * @returns Nothing.
 */
export const setErrorMessageAnswer = (answer: string | undefined): void => {
    errorMessageAnswer = answer;
};
export const outputChannels: MockOutputChannel[] = [];
export const statusBarItems: MockStatusBarItem[] = [];
export const treeViews: Array<{
    id: string;
    options: unknown;
    /** Fires the view's `onDidExpandElement`, as a user expanding a row. */
    expand: (element: unknown) => void;
    collapse: (element: unknown) => void;
    /** Sets the view's `selection`, as a user selecting rows. */
    select: (rows: unknown[]) => void;
    /** Shows or hides the view, firing its `onDidChangeVisibility`. */
    setVisible: (visible: boolean) => void;
}> = [];
/** Whether a tree view is shown when it is created; see `setTreeViewsShown`. */
let treeViewsShown = true;

/**
 * Makes the tree views created from now on start out hidden, or shown -
 * as a window comes up with another activity bar entry open, or its own.
 *
 * @param shown Whether they start out shown.
 */
export const setTreeViewsShown = (shown: boolean): void => {
    treeViewsShown = shown;
};
export const webviewPanels: MockWebviewPanel[] = [];
export const webviewViewProviders = new Map<string, {
    provider: { resolveWebviewView(view: MockWebviewView): void };
    options: unknown;
}>();
export const webviewViews: MockWebviewView[] = [];
/** The documents `workspace.openTextDocument` created. */
export const openedDocuments: MockTextDocument[] = [];
/** The documents `window.showTextDocument` was asked to show. */
export const shownDocuments: MockTextDocument[] = [];
/** The editors `window.showTextDocument` handed back. */
export const shownEditors: Array<{
    document: MockTextDocument;
    selection: Range;
}> = [];
/** The decoration types that were created. */
export const decorationTypes: MockDecorationType[] = [];

/** Every `registerFileDecorationProvider` call's provider, in order. */
export const fileDecorationProviders: unknown[] = [];
/** What `window.visibleTextEditors` reports. */
export let visibleTextEditors: MockTextEditor[] = [];

/**
 * Sets the editors the mock reports as visible.
 *
 * @param editors The visible editors.
 *
 * @returns Nothing.
 */
export const setVisibleTextEditors = (
    editors: MockTextEditor[],
): void => {
    visibleTextEditors = editors;
    window.visibleTextEditors = editors;
};
export const registeredCommands = new Map<
    string,
    (...args: unknown[]) => unknown
>();
/** The context keys set through the built-in `setContext` command. */
export const contextKeys = new Map<string, unknown>();
/** Everything shown with `window.setStatusBarMessage`. */
export const statusBarMessages: string[] = [];

/** The next answer `showQuickPick` should give, as a label. */
export const quickPickAnswers: string[] = [];
/**
 * Every set of items `showQuickPick` was offered; a plain string item is
 * recorded as an item with that label.
 */
export const quickPickCalls: Array<Array<{ label: string }>> = [];
/** The options every `showQuickPick` call was given. */
export const quickPickOptions: unknown[] = [];

/** What `showInputBox` answers with, in order; undefined is a cancel. */
export const inputBoxAnswers: Array<string | undefined> = [];

/** The options every `showInputBox` call was given. */
export const inputBoxCalls: Array<{
    prompt?: string;
    validateInput?: (value: string) => string | undefined;
}> = [];

/** The configuration `workspace.getConfiguration` serves. */
export const configuration = new Map<string, unknown>();
export const configurationUpdates: Array<{
    key: string;
    value: unknown;
    target: ConfigurationTarget;
}> = [];

/** A workspace folder: its name, and where it is where a test says. */
export interface IMockWorkspaceFolder {
    name: string;
    uri?: Uri;
}

/** Set to a non-empty array to make the mock look like a workspace. */
export let workspaceFolders: IMockWorkspaceFolder[] | undefined;

/**
 * Sets what `workspace.workspaceFolders` reports.
 *
 * @param folders The folders to report, or undefined for none.
 *
 * @returns Nothing.
 */
export const setWorkspaceFolders = (
    folders: IMockWorkspaceFolder[] | undefined,
): void => {
    workspaceFolders = folders;
    workspace.workspaceFolders = folders;
};

export class MockOutputChannel {
    public readonly lines: string[] = [];
    public shown = false;
    public disposed = false;

    public constructor(public readonly name: string) { }

    public appendLine(line: string): void {
        this.lines.push(line);
    }

    public show(_preserveFocus?: boolean): void {
        this.shown = true;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

export class MockStatusBarItem {
    public name?: string;
    public text = "";
    public tooltip?: string;
    public command?: string;
    public visible = false;
    public disposed = false;

    public constructor(
        public readonly alignment: StatusBarAlignment,
        public readonly priority?: number,
    ) { }

    public show(): void {
        this.visible = true;
    }

    public hide(): void {
        this.visible = false;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

export class MockWebview {
    public html = "";
    public readonly posted: unknown[] = [];
    public readonly cspSource = "vscode-webview://mock";
    #handler?: (message: unknown) => void;

    public asWebviewUri(uri: Uri): Uri {
        return uri;
    }

    public postMessage(message: unknown): Promise<boolean> {
        this.posted.push(message);

        return Promise.resolve(true);
    }

    public onDidReceiveMessage(
        handler: (message: unknown) => void,
    ): Disposable {
        this.#handler = handler;

        return { dispose: () => { this.#handler = undefined; } };
    }

    /** Drives a message in, as the frontend would. */
    public receive(message: unknown): void {
        this.#handler?.(message);
    }
}

/** A stand-in for a Position. */
export class Position {
    public constructor(
        public readonly line: number,
        public readonly character: number,
    ) { }
}

/** A stand-in for a Range. */
export class Range {
    public readonly start: Position;
    public readonly end: Position;

    // Both of the real Range's overloads, since callers use either.
    public constructor(start: Position, end: Position);
    public constructor(
        startLine: number,
        startCharacter: number,
        endLine: number,
        endCharacter: number,
    );
    public constructor(
        startOrLine: Position | number,
        endOrCharacter: Position | number,
        endLine?: number,
        endCharacter?: number,
    ) {
        if (typeof startOrLine === "number") {
            this.start = new Position(startOrLine,
                endOrCharacter as number);
            this.end = new Position(endLine as number,
                endCharacter as number);
        } else {
            this.start = startOrLine;
            this.end = endOrCharacter as Position;
        }
    }

    public get isEmpty(): boolean {
        return this.start.line === this.end.line
            && this.start.character === this.end.character;
    }
}

/** A stand-in for a Selection: a Range that knows which end moves. */
export class Selection extends Range {
    public readonly anchor: Position;
    public readonly active: Position;

    public constructor(anchor: Position, active: Position) {
        super(anchor, active);
        this.anchor = anchor;
        this.active = active;
    }
}

/** A stand-in for a TextDocument. */
export class MockTextDocument {
    public version = 1;

    public constructor(
        public readonly uri: Uri,
        public languageId: string,
        private text: string,
    ) { }

    public lineAt(line: number): { text: string } {
        return { text: this.text.split("\n")[line] ?? "" };
    }

    public getText(range?: unknown): string {
        return range === undefined ? this.text : this.text;
    }

    public setText(value: string): void {
        this.text = value;
        this.version += 1;
    }

    public positionAt(offset: number): Position {
        const before = this.text.slice(0, offset);
        const line = before.split("\n").length - 1;
        const lineStart = before.lastIndexOf("\n") + 1;

        return new Position(line, offset - lineStart);
    }

    public offsetAt(position: Position): number {
        const lines = this.text.split("\n");
        let offset = 0;
        for (let index = 0; index < position.line; index += 1) {
            offset += (lines[index]?.length ?? 0) + 1;
        }

        return offset + position.character;
    }
}

/** A stand-in for a TextEditor, recording the decorations applied. */
export class MockTextEditor {
    /** Every setDecorations call, as the ranges it was given. */
    public readonly decorationCalls: Array<{
        type: MockDecorationType;
        ranges: Range[];
    }> = [];

    public selection: Range = new Selection(new Position(0, 0),
        new Position(0, 0));

    public constructor(public readonly document: MockTextDocument) { }

    public setDecorations(
        type: MockDecorationType,
        ranges: Range[],
    ): void {
        this.decorationCalls.push({ type, ranges: [...ranges] });
    }

    /**
     * @returns The lines of the most recent decoration call.
     */
    public get decoratedLines(): number[] {
        const last = this.decorationCalls.at(-1);

        return (last?.ranges ?? []).map((range) => {
            return range.start.line;
        });
    }
}

export class MockDecorationType {
    public disposed = false;

    public constructor(public readonly options: unknown) { }

    public dispose(): void {
        this.disposed = true;
    }
}

/** A stand-in for a WebviewView, as the bottom panel hosts one. */
export class MockWebviewView {
    public readonly webview = new MockWebview();
    /** Shown beside the view's title in the panel header. */
    public description?: string;
    public visible = false;
    public shown = 0;
    public preserveFocus = false;
    #onDispose?: () => void;

    public constructor(public readonly viewType: string) { }

    public show(preserveFocus?: boolean): void {
        this.shown += 1;
        this.visible = true;
        this.preserveFocus = Boolean(preserveFocus);
    }

    public onDidDispose(handler: () => void): Disposable {
        this.#onDispose = handler;

        return { dispose: () => { this.#onDispose = undefined; } };
    }

    public dispose(): void {
        this.visible = false;
        this.#onDispose?.();
    }
}

export class MockWebviewPanel {
    public readonly webview = new MockWebview();
    public iconPath?: unknown;
    public disposed = false;
    public revealed = 0;
    #onDispose?: () => void;

    public constructor(
        public readonly viewType: string,
        // Not readonly: a panel reused for another subject retitles itself.
        public title: string,
        public viewColumn: ViewColumn | undefined,
        public readonly options: unknown,
    ) { }

    public reveal(column?: ViewColumn): void {
        this.revealed += 1;
        if (column !== undefined) {
            this.viewColumn = column;
        }
    }

    public onDidDispose(handler: () => void): Disposable {
        this.#onDispose = handler;

        return { dispose: () => { this.#onDispose = undefined; } };
    }

    public dispose(): void {
        this.disposed = true;
        this.#onDispose?.();
    }
}

/** The editor `window.activeTextEditor` reports. */
export let activeTextEditor: unknown;

/**
 * Sets the active editor the mock reports.
 *
 * @param editor The editor, or undefined for none.
 *
 * @returns Nothing.
 */
export const setActiveTextEditor = (editor: unknown): void => {
    activeTextEditor = editor;
    window.activeTextEditor = editor;
};

const activeEditorListeners = new Set<(editor: unknown) => void>();
const visibleEditorListeners =
    new Set<(editors: MockTextEditor[]) => void>();
const changeDocumentListeners = new Set<(event: unknown) => void>();
const closeDocumentListeners = new Set<(document: unknown) => void>();
const openDocumentListeners = new Set<(document: unknown) => void>();

/**
 * `workspace.textDocuments`: the documents opened with
 * `fireDocumentOpen` and not closed with `fireDocumentClose` since.
 */
export const textDocuments: MockTextDocument[] = [];
const configurationListeners = new Set<(event: unknown) => void>();

/** A registered semantic tokens provider, and what it was registered for. */
export interface SemanticTokensRegistration {
    selector: unknown;
    provider: {
        provideDocumentSemanticTokens(
            document: unknown,
            token: CancellationToken,
        ): unknown;
    };
    legend: SemanticTokensLegend;
}

/** Every `languages.registerDocumentSemanticTokensProvider` call. */
export const semanticTokensProviders: SemanticTokensRegistration[] = [];

/**
 * Fires the configuration change event.
 *
 * @param section The section that changed.
 *
 * @returns Nothing.
 */
export const fireConfigurationChange = (section: string): void => {
    for (const listener of configurationListeners) {
        listener({
            affectsConfiguration: (candidate: string) => {
                return section.startsWith(candidate);
            },
        });
    }
};

/**
 * Fires the visible editors change event.
 *
 * @param editors The editors that are now visible.
 *
 * @returns Nothing.
 */
export const fireVisibleEditorsChange = (
    editors: MockTextEditor[],
): void => {
    setVisibleTextEditors(editors);
    for (const listener of visibleEditorListeners) {
        listener(editors);
    }
};

/**
 * Fires the document change event.
 *
 * @param document The document that changed.
 *
 * @returns Nothing.
 */
export const fireDocumentChange = (document: MockTextDocument): void => {
    for (const listener of changeDocumentListeners) {
        listener({ document, contentChanges: [] });
    }
};

/**
 * Types into a document: sets its text and fires the change event with
 * the change in it, as an edit does.
 *
 * @param document The document.
 * @param text Its new text.
 *
 * @returns Nothing.
 */
export const fireDocumentEdit = (
    document: MockTextDocument,
    text: string,
): void => {
    document.setText(text);
    for (const listener of changeDocumentListeners) {
        listener({ document, contentChanges: [{ text }] });
    }
};

/**
 * Opens a document: adds it to `workspace.textDocuments` and fires the
 * open event.
 *
 * @param document The document that was opened.
 *
 * @returns Nothing.
 */
export const fireDocumentOpen = (document: MockTextDocument): void => {
    textDocuments.push(document);
    for (const listener of openDocumentListeners) {
        listener(document);
    }
};

/**
 * Fires the document close event.
 *
 * @param document The document that was closed.
 *
 * @returns Nothing.
 */
export const fireDocumentClose = (document: MockTextDocument): void => {
    const index = textDocuments.indexOf(document);
    if (index >= 0) {
        textDocuments.splice(index, 1);
    }
    for (const listener of closeDocumentListeners) {
        listener(document);
    }
};

/**
 * Fires the active editor change event.
 *
 * @param editor The editor that became active.
 *
 * @returns Nothing.
 */
export const fireActiveEditorChange = (editor: unknown): void => {
    setActiveTextEditor(editor);
    for (const listener of activeEditorListeners) {
        listener(editor);
    }
};

/** What the save and open dialogs answer, and what they were asked. */
export const fileDialogs = {
    saveAnswer: undefined as Uri | undefined,
    openAnswer: undefined as Uri[] | undefined,
    saveCalls: [] as unknown[],
    openCalls: [] as unknown[],
};

/** The files `workspace.fs` holds, by path: written, or put there. */
export const files = new Map<string, Uint8Array>();

export const window = {
    showSaveDialog: (options: unknown): Promise<Uri | undefined> => {
        fileDialogs.saveCalls.push(options);

        return Promise.resolve(fileDialogs.saveAnswer);
    },

    showOpenDialog: (options: unknown): Promise<Uri[] | undefined> => {
        fileDialogs.openCalls.push(options);

        return Promise.resolve(fileDialogs.openAnswer);
    },

    activeTextEditor: undefined as unknown,
    visibleTextEditors: [] as MockTextEditor[],

    createTextEditorDecorationType: (
        options: unknown,
    ): MockDecorationType => {
        const type = new MockDecorationType(options);
        decorationTypes.push(type);

        return type;
    },

    onDidChangeVisibleTextEditors: (
        listener: (editors: MockTextEditor[]) => void,
    ): Disposable => {
        visibleEditorListeners.add(listener);

        return {
            dispose: () => {
                visibleEditorListeners.delete(listener);
            },
        };
    },

    registerFileDecorationProvider: (provider: unknown): Disposable => {
        fileDecorationProviders.push(provider);

        return { dispose: () => { /* nothing to undo in a test */ } };
    },

    createOutputChannel: (name: string): MockOutputChannel => {
        const channel = new MockOutputChannel(name);
        outputChannels.push(channel);

        return channel;
    },

    createStatusBarItem: (
        alignment: StatusBarAlignment,
        priority?: number,
    ): MockStatusBarItem => {
        const item = new MockStatusBarItem(alignment, priority);
        statusBarItems.push(item);

        return item;
    },

    createTreeView: (id: string, options: unknown) => {
        const expanded = new EventEmitter<{ element: unknown }>();
        const collapsed = new EventEmitter<{ element: unknown }>();
        const visibility = new EventEmitter<{ visible: boolean }>();
        const view = {
            // What the user has selected; set through `select` below.
            selection: [] as unknown[],
            // Shown or hidden through `setVisible` below.
            visible: treeViewsShown,
            onDidExpandElement: expanded.event,
            onDidCollapseElement: collapsed.event,
            onDidChangeVisibility: visibility.event,
            dispose: () => {
                expanded.dispose();
                collapsed.dispose();
                visibility.dispose();
            },
        };
        treeViews.push({
            id,
            options,
            expand: (element: unknown) => {
                expanded.fire({ element });
            },
            collapse: (element: unknown) => {
                collapsed.fire({ element });
            },
            select: (rows: unknown[]) => {
                view.selection = rows;
            },
            setVisible: (visible: boolean) => {
                view.visible = visible;
                visibility.fire({ visible });
            },
        });

        return view;
    },

    registerWebviewViewProvider: (
        viewType: string,
        provider: { resolveWebviewView(view: MockWebviewView): void },
        options?: unknown,
    ): Disposable => {
        webviewViewProviders.set(viewType, { provider, options });

        return {
            dispose: () => {
                webviewViewProviders.delete(viewType);
            },
        };
    },

    createWebviewPanel: (
        viewType: string,
        title: string,
        showOptions: { viewColumn: ViewColumn } | ViewColumn,
        options: unknown,
    ): MockWebviewPanel => {
        const column = typeof showOptions === "object"
            ? showOptions.viewColumn
            : showOptions;
        const panel = new MockWebviewPanel(viewType, title, column, options);
        webviewPanels.push(panel);

        return panel;
    },

    showInformationMessage: (
        message: string,
        ...items: unknown[]
    ): Promise<string | undefined> => {
        informationMessages.push(message);
        informationMessageCalls.push({ message, items });
        const answer = informationMessageAnswer;
        informationMessageAnswer = undefined;

        return Promise.resolve(answer);
    },

    showWarningMessage: (
        message: string,
        ...rest: unknown[]
    ): Promise<string | undefined> => {
        warningMessages.push(message);
        warningMessageCalls.push({ message, items: rest });

        // A modal warning is a question with buttons, and the caller branches
        // on which was pressed. Tests set the answer with
        // `setWarningMessageAnswer`; the default is a dismissal, which keeps
        // a destructive action from running in a test that never opted in.
        const answer = warningMessageAnswer;
        warningMessageAnswer = undefined;
        void rest;

        return Promise.resolve(answer);
    },

    showErrorMessage: (message: string): Promise<string | undefined> => {
        errorMessages.push(message);
        const answer = errorMessageAnswer;
        errorMessageAnswer = undefined;

        return Promise.resolve(answer);
    },

    setStatusBarMessage: (
        message: string,
        _hideAfterTimeout?: number,
    ): Disposable => {
        statusBarMessages.push(message);

        return { dispose: () => { /* nothing to undo */ } };
    },

    showInputBox: (options: {
        prompt?: string;
        validateInput?: (value: string) => string | undefined;
    }): Promise<string | undefined> => {
        inputBoxCalls.push(options);

        return Promise.resolve(inputBoxAnswers.shift());
    },

    showQuickPick: <T extends { label: string } | string>(
        items: T[],
        options?: unknown,
    ): Promise<T | undefined> => {
        quickPickCalls.push(items.map((item): { label: string } => {
            return typeof item === "string"
                ? { label: item } : item as { label: string };
        }));
        quickPickOptions.push(options);
        const wanted = quickPickAnswers.shift();

        return Promise.resolve(items.find((item) => {
            return (typeof item === "string" ? item : item.label) === wanted;
        }));
    },

    showTextDocument: (
        document: MockTextDocument,
        options?: { selection?: Range },
    ): Promise<{ document: MockTextDocument; selection: Range }> => {
        shownDocuments.push(document);
        const selection = options?.selection
            ?? new Range(0, 0, 0, 0);
        const editor = { document, selection };
        shownEditors.push(editor);
        setActiveTextEditor(editor);

        return Promise.resolve(editor);
    },

    onDidChangeActiveTextEditor: (
        listener: (editor: unknown) => void,
    ): Disposable => {
        activeEditorListeners.add(listener);

        return {
            dispose: () => {
                activeEditorListeners.delete(listener);
            },
        };
    },

    withProgress: async <T>(
        options: ProgressOptions,
        task: (
            progress: Progress<{ message?: string; increment?: number }>,
            token: CancellationToken,
        ) => Thenable<T>,
    ): Promise<T> => {
        const listeners = new Set<() => void>();
        const token: CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: (listener) => {
                listeners.add(listener);

                return { dispose: () => { listeners.delete(listener); } };
            },
        };
        const call: WithProgressCall = {
            options,
            reported: [],
            cancel: () => {
                token.isCancellationRequested = true;
                for (const listener of [...listeners]) {
                    listener();
                }
            },
        };
        withProgressCalls.push(call);

        return await task(
            {
                report: (value) => {
                    if (value.message !== undefined) {
                        call.reported.push(value.message);
                    }
                },
            },
            token,
        );
    },
};

export const workspace = {
    workspaceFolders: undefined as IMockWorkspaceFolder[] | undefined,

    /** The folder holding a path: one whose `uri` it is, or is below. */
    getWorkspaceFolder: (uri: Uri): IMockWorkspaceFolder | undefined => {
        return workspaceFolders?.find((folder) => {
            const root = folder.uri?.fsPath;

            return root !== undefined && (uri.fsPath === root
                || uri.fsPath.startsWith(`${root}/`));
        });
    },

    textDocuments,

    fs: {
        writeFile: (uri: Uri, content: Uint8Array): Promise<void> => {
            files.set(uri.fsPath, content);

            return Promise.resolve();
        },

        readFile: (uri: Uri): Promise<Uint8Array> => {
            const content = files.get(uri.fsPath);

            return content === undefined
                ? Promise.reject(new Error(`No such file: ${uri.fsPath}`))
                : Promise.resolve(content);
        },
    },

    openTextDocument: (
        target: Uri | { language?: string; content?: string },
    ): Promise<MockTextDocument> => {
        const document = target instanceof Uri
            ? new MockTextDocument(target, "sql", "")
            : new MockTextDocument(
                Uri.parse(
                    `untitled://Untitled-${openedDocuments.length + 1}`),
                target.language ?? "plaintext",
                target.content ?? "",
            );
        openedDocuments.push(document);

        return Promise.resolve(document);
    },

    getConfiguration: (section: string) => {
        return {
            // A default stands in for an unset key, as VS Code's does.
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                const full = `${section}.${key}`;

                return configuration.has(full)
                    ? configuration.get(full) as T
                    : defaultValue;
            },

            update: (
                key: string,
                value: unknown,
                target: ConfigurationTarget,
            ): Promise<void> => {
                const full = `${section}.${key}`;
                configurationUpdates.push({ key: full, value, target });
                if (value === undefined) {
                    configuration.delete(full);
                } else {
                    configuration.set(full, value);
                }

                return Promise.resolve();
            },
        };
    },

    registerFileSystemProvider: (
        scheme: string,
        provider: unknown,
    ): Disposable => {
        fileSystemProviders.set(scheme, provider);

        return {
            dispose: () => {
                fileSystemProviders.delete(scheme);
            },
        };
    },

    onDidOpenTextDocument: (
        listener: (document: unknown) => void,
    ): Disposable => {
        openDocumentListeners.add(listener);

        return {
            dispose: () => {
                openDocumentListeners.delete(listener);
            },
        };
    },

    onDidCloseTextDocument: (
        listener: (document: unknown) => void,
    ): Disposable => {
        closeDocumentListeners.add(listener);

        return {
            dispose: () => {
                closeDocumentListeners.delete(listener);
            },
        };
    },

    onDidChangeTextDocument: (
        listener: (event: unknown) => void,
    ): Disposable => {
        changeDocumentListeners.add(listener);

        return {
            dispose: () => {
                changeDocumentListeners.delete(listener);
            },
        };
    },

    onDidChangeConfiguration: (
        listener: (event: unknown) => void,
    ): Disposable => {
        configurationListeners.add(listener);

        return {
            dispose: () => {
                configurationListeners.delete(listener);
            },
        };
    },
};

/** The languages documents were switched to, in order. */
export const languageSwitches: Array<{ uri: string; language: string }> = [];

export const languages = {
    // As VS Code does: the document is closed and opened again in its new
    // language.
    setTextDocumentLanguage: (
        document: MockTextDocument,
        language: string,
    ): Promise<MockTextDocument> => {
        languageSwitches.push({ uri: document.uri.toString(), language });
        document.languageId = language;
        for (const listener of closeDocumentListeners) {
            listener(document);
        }
        for (const listener of openDocumentListeners) {
            listener(document);
        }

        return Promise.resolve(document);
    },

    registerDocumentSemanticTokensProvider: (
        selector: unknown,
        provider: SemanticTokensRegistration["provider"],
        legend: SemanticTokensLegend,
    ): Disposable => {
        const registration = { selector, provider, legend };
        semanticTokensProviders.push(registration);

        return {
            dispose: () => {
                const index = semanticTokensProviders.indexOf(registration);
                if (index >= 0) {
                    semanticTokensProviders.splice(index, 1);
                }
            },
        };
    },
};

export const commands = {
    registerCommand: (
        command: string,
        callback: (...args: unknown[]) => unknown,
    ): Disposable => {
        registeredCommands.set(command, callback);

        return {
            dispose: () => {
                registeredCommands.delete(command);
            },
        };
    },

    executeCommand: async (
        command: string,
        ...args: unknown[]
    ): Promise<unknown> => {
        // A built-in, not something an extension registers.
        if (command === "setContext") {
            contextKeys.set(args[0] as string, args[1]);

            return undefined;
        }

        if (command === "vscode.open") {
            openedWith.push({ uri: args[0] as Uri, options: args[1] });

            return undefined;
        }

        // VS Code registers a `<viewId>.focus` command for every view it
        // knows about, which is how a webview view gets resolved.
        const focus = /^(.+)\.focus$/.exec(command);
        if (focus && webviewViewProviders.has(focus[1])) {
            resolveWebviewView(focus[1]);

            return undefined;
        }

        const callback = registeredCommands.get(command);
        if (!callback) {
            throw new Error(`Command not registered: ${command}`);
        }

        return await callback(...args);
    },
};

/** An MCP server run as a local process, as `vscode.lm` takes it. */
export class McpStdioServerDefinition {
    public constructor(
        public readonly label: string,
        public command: string,
        public args: string[] = [],
        public env: Record<string, string | number | null> = {},
        public version?: string,
    ) { }
}

/** The MCP server definition providers registered, by id. */
export const mcpServerDefinitionProviders = new Map<string, unknown>();

export const lm = {
    registerMcpServerDefinitionProvider: (
        id: string,
        provider: unknown,
    ): Disposable => {
        mcpServerDefinitionProviders.set(id, provider);

        return {
            dispose: () => {
                mcpServerDefinitionProviders.delete(id);
            },
        };
    },
};

export const env = {
    openExternal: (uri: Uri): Promise<boolean> => {
        openedExternally.push(uri);

        return Promise.resolve(true);
    },

    clipboard: {
        text: "",
        writeText: (value: string): Promise<void> => {
            env.clipboard.text = value;

            return Promise.resolve();
        },
        readText: (): Promise<string> => {
            return Promise.resolve(env.clipboard.text);
        },
    },
};

/**
 * Hands a view to a registered provider, the way VS Code does when the
 * view first becomes visible.
 *
 * @param viewType The view to resolve.
 *
 * @returns The view that was created.
 */
export const resolveWebviewView = (viewType: string): MockWebviewView => {
    const entry = webviewViewProviders.get(viewType);
    if (!entry) {
        throw new Error(`No webview view provider for ${viewType}`);
    }

    const view = new MockWebviewView(viewType);
    webviewViews.push(view);
    entry.provider.resolveWebviewView(view);

    return view;
};

/**
 * Clears everything the mock recorded. Call it from `beforeEach`.
 *
 * @returns Nothing.
 */
/* ------------------------------------------------------------------ *
 * Notebooks: the data classes, a document with cells, the controller and
 * its cell executions, and the edits that change a notebook's metadata.
 * ------------------------------------------------------------------ */

export enum NotebookCellKind {
    Markup = 1,
    Code = 2,
}

export class NotebookCellOutputItem {
    public constructor(
        public readonly data: Uint8Array,
        public readonly mime: string,
    ) { }
}

export class NotebookCellOutput {
    public constructor(public readonly items: NotebookCellOutputItem[]) { }
}

export class NotebookCellData {
    public outputs?: NotebookCellOutput[];
    public metadata?: Record<string, unknown>;

    public constructor(
        public readonly kind: NotebookCellKind,
        public readonly value: string,
        public readonly languageId: string,
    ) { }
}

export class NotebookData {
    public metadata?: Record<string, unknown>;

    public constructor(public readonly cells: NotebookCellData[]) { }
}

/** A cell of a `MockNotebookDocument`. */
export interface IMockNotebookCell {
    index: number;
    kind: NotebookCellKind;
    document: MockTextDocument;
    notebook: MockNotebookDocument;
    metadata: Record<string, unknown>;
}

/** A notebook, its cells' documents under the notebook cell scheme. */
export class MockNotebookDocument {
    public metadata: Record<string, unknown>;
    readonly #cells: IMockNotebookCell[];

    public constructor(
        public readonly uri: Uri,
        public readonly notebookType: string,
        data: NotebookData,
    ) {
        this.metadata = { ...data.metadata };
        this.#cells = data.cells.map((cell, index) => {
            return {
                index,
                kind: cell.kind,
                document: new MockTextDocument(
                    Uri.from({
                        scheme: "vscode-notebook-cell",
                        path: `${uri.path}#cell${index}`,
                    }),
                    cell.languageId, cell.value),
                notebook: this,
                metadata: { ...cell.metadata },
            };
        });
    }

    public getCells(): IMockNotebookCell[] {
        return this.#cells;
    }
}

/** What one cell execution was told, in order. */
export class MockCellExecution {
    public executionOrder?: number;
    public started = false;
    public success?: boolean;
    public outputs: NotebookCellOutput[] = [];

    public constructor(public readonly cell: IMockNotebookCell) { }

    public start(): void {
        this.started = true;
    }

    public clearOutput(): Promise<void> {
        this.outputs = [];

        return Promise.resolve();
    }

    public replaceOutput(
        outputs: NotebookCellOutput | NotebookCellOutput[],
    ): Promise<void> {
        this.outputs = Array.isArray(outputs) ? outputs : [outputs];

        return Promise.resolve();
    }

    public appendOutput(
        outputs: NotebookCellOutput | NotebookCellOutput[],
    ): Promise<void> {
        this.outputs.push(...Array.isArray(outputs) ? outputs : [outputs]);

        return Promise.resolve();
    }

    public appendOutputItems(
        items: NotebookCellOutputItem | NotebookCellOutputItem[],
        output: NotebookCellOutput,
    ): Promise<void> {
        (output.items as NotebookCellOutputItem[]).push(
            ...Array.isArray(items) ? items : [items]);

        return Promise.resolve();
    }

    public end(success: boolean): void {
        this.success = success;
    }
}

export class MockNotebookController {
    public supportedLanguages: string[] = [];
    public supportsExecutionOrder = false;
    public description?: string;
    public executeHandler?: (
        cells: IMockNotebookCell[],
        notebook: MockNotebookDocument,
    ) => Promise<void>;
    public interruptHandler?: (notebook: MockNotebookDocument) => void;
    public readonly executions: MockCellExecution[] = [];
    public disposed = false;

    public constructor(
        public readonly id: string,
        public readonly notebookType: string,
        public readonly label: string,
    ) { }

    public createNotebookCellExecution(
        cell: IMockNotebookCell,
    ): MockCellExecution {
        const execution = new MockCellExecution(cell);
        this.executions.push(execution);

        return execution;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

export const notebookControllers: MockNotebookController[] = [];
export const notebookSerializers = new Map<string, unknown>();
export const notebookDocuments: MockNotebookDocument[] = [];
export const shownNotebooks: MockNotebookDocument[] = [];
const activeNotebookListeners = new Set<(editor: unknown) => void>();
const notebookChangeListeners = new Set<(event: unknown) => void>();
let untitledNotebooks = 0;

/** A notebook renderer's messaging, recording what the extension sent. */
export class MockRendererMessaging {
    public readonly sent: Array<{ message: unknown; editor: unknown }> = [];
    readonly #listeners = new Set<(event: {
        editor: unknown;
        message: unknown;
    }) => unknown>();

    public constructor(public readonly rendererId: string) { }

    public onDidReceiveMessage(
        listener: (event: { editor: unknown; message: unknown }) => unknown,
    ): Disposable {
        this.#listeners.add(listener);

        return { dispose: () => { this.#listeners.delete(listener); } };
    }

    public postMessage(message: unknown, editor?: unknown): Promise<boolean> {
        this.sent.push({ message, editor });

        return Promise.resolve(true);
    }

    /**
     * Delivers a message from a renderer, as from the editor given.
     *
     * @param editor The notebook editor it comes from.
     * @param message What the renderer sent.
     *
     * @returns Once every listener has handled it.
     */
    public async receive(editor: unknown, message: unknown): Promise<void> {
        for (const listener of this.#listeners) {
            await listener({ editor, message });
        }
    }
}

export const rendererMessagings: MockRendererMessaging[] = [];
const closeNotebookListeners = new Set<(notebook: unknown) => void>();

/**
 * Closes a notebook, as VS Code would, telling the listeners.
 *
 * @param notebook The notebook.
 *
 * @returns Nothing.
 */
export const fireNotebookClose = (notebook: MockNotebookDocument): void => {
    const index = notebookDocuments.indexOf(notebook);
    if (index >= 0) {
        notebookDocuments.splice(index, 1);
    }
    for (const listener of closeNotebookListeners) {
        listener(notebook);
    }
};

export const notebooks = {
    createRendererMessaging: (rendererId: string): MockRendererMessaging => {
        const messaging = new MockRendererMessaging(rendererId);
        rendererMessagings.push(messaging);

        return messaging;
    },

    createNotebookController: (
        id: string,
        notebookType: string,
        label: string,
    ): MockNotebookController => {
        const controller = new MockNotebookController(id, notebookType, label);
        notebookControllers.push(controller);

        return controller;
    },
};

/** One notebook edit: only metadata is edited so far. */
export class NotebookEdit {
    public constructor(
        public readonly newNotebookMetadata?: Record<string, unknown>,
        public readonly cellIndex?: number,
        public readonly newCellMetadata?: Record<string, unknown>,
    ) { }

    public static updateNotebookMetadata(
        metadata: Record<string, unknown>,
    ): NotebookEdit {
        return new NotebookEdit(metadata);
    }

    public static updateCellMetadata(
        index: number,
        metadata: Record<string, unknown>,
    ): NotebookEdit {
        return new NotebookEdit(undefined, index, metadata);
    }
}

export class WorkspaceEdit {
    public readonly entries: Array<[Uri, NotebookEdit[]]> = [];

    public set(uri: Uri, edits: NotebookEdit[]): void {
        this.entries.push([uri, edits]);
    }
}

/**
 * Makes a notebook the active editor, as focusing it would, and tells the
 * listeners.
 *
 * @param notebook The notebook, or undefined for none.
 *
 * @returns Nothing.
 */
export const fireActiveNotebookChange = (
    notebook: MockNotebookDocument | undefined,
): void => {
    const editor = notebook === undefined ? undefined : { notebook };
    (window as Record<string, unknown>).activeNotebookEditor = editor;
    for (const listener of activeNotebookListeners) {
        listener(editor);
    }
};

/**
 * Opens a notebook, as the serializer would hand it over.
 *
 * @param notebookType The notebook's type.
 * @param data Its cells and metadata.
 * @param uri Where it is; an untitled one where left out.
 *
 * @returns The notebook.
 */
export const openMockNotebook = (
    notebookType: string,
    data: NotebookData,
    uri?: Uri,
): MockNotebookDocument => {
    untitledNotebooks += 1;
    const notebook = new MockNotebookDocument(
        uri ?? Uri.from({
            scheme: "untitled",
            path: `Untitled-${untitledNotebooks}`,
        }),
        notebookType, data);
    notebookDocuments.push(notebook);

    return notebook;
};

Object.assign(window, {
    activeNotebookEditor: undefined,
    onDidChangeActiveNotebookEditor: (
        listener: (editor: unknown) => void,
    ): Disposable => {
        activeNotebookListeners.add(listener);

        return { dispose: () => { activeNotebookListeners.delete(listener); } };
    },
    showNotebookDocument: (notebook: MockNotebookDocument): Promise<unknown> => {
        shownNotebooks.push(notebook);
        fireActiveNotebookChange(notebook);

        return Promise.resolve({ notebook });
    },
});

Object.assign(workspace, {
    notebookDocuments,
    registerNotebookSerializer: (
        notebookType: string,
        serializer: unknown,
    ): Disposable => {
        notebookSerializers.set(notebookType, serializer);

        return { dispose: () => { notebookSerializers.delete(notebookType); } };
    },
    openNotebookDocument: (
        notebookType: string,
        data: NotebookData,
    ): Promise<MockNotebookDocument> => {
        return Promise.resolve(openMockNotebook(notebookType, data));
    },
    onDidCloseNotebookDocument: (
        listener: (notebook: unknown) => void,
    ): Disposable => {
        closeNotebookListeners.add(listener);

        return { dispose: () => { closeNotebookListeners.delete(listener); } };
    },
    onDidChangeNotebookDocument: (
        listener: (event: unknown) => void,
    ): Disposable => {
        notebookChangeListeners.add(listener);

        return { dispose: () => { notebookChangeListeners.delete(listener); } };
    },
    // Applies the metadata edits of a notebook that is open, and tells
    // the listeners, as VS Code does.
    applyEdit: (edit: WorkspaceEdit): Promise<boolean> => {
        for (const [uri, edits] of edit.entries) {
            const notebook = notebookDocuments.find((candidate) => {
                return candidate.uri.toString() === uri.toString();
            });
            if (notebook === undefined) {
                return Promise.resolve(false);
            }
            for (const each of edits) {
                const cell = each.cellIndex === undefined
                    ? undefined
                    : notebook.getCells()[each.cellIndex];
                if (cell !== undefined) {
                    cell.metadata = { ...each.newCellMetadata };
                    continue;
                }
                notebook.metadata = { ...each.newNotebookMetadata };
                for (const listener of notebookChangeListeners) {
                    listener({ notebook, metadata: notebook.metadata,
                        cellChanges: [], contentChanges: [] });
                }
            }
        }

        return Promise.resolve(true);
    },
});

export const resetVscodeMock = (): void => {
    openedWith.length = 0;
    semanticTokensProviders.length = 0;
    fileSystemProviders.clear();
    fileDialogs.saveAnswer = undefined;
    fileDialogs.openAnswer = undefined;
    fileDialogs.saveCalls.length = 0;
    fileDialogs.openCalls.length = 0;
    files.clear();
    withProgressCalls.length = 0;
    informationMessages.length = 0;
    warningMessages.length = 0;
    warningMessageCalls.length = 0;
    warningMessageAnswer = undefined;
    informationMessageCalls.length = 0;
    informationMessageAnswer = undefined;
    openedExternally.length = 0;
    quickPickOptions.length = 0;
    errorMessageAnswer = undefined;
    errorMessages.length = 0;
    outputChannels.length = 0;
    statusBarItems.length = 0;
    treeViews.length = 0;
    // Disposed, not just forgotten: a panel is owned by whatever created it,
    // and code that keeps one - the connection editor holds a single panel
    // and reuses it - only lets go when told it closed. Dropping the array
    // alone would leave the next test reusing a panel it cannot see.
    for (const panel of webviewPanels) {
        panel.dispose();
    }
    webviewPanels.length = 0;
    webviewViewProviders.clear();
    webviewViews.length = 0;
    openedDocuments.length = 0;
    shownDocuments.length = 0;
    shownEditors.length = 0;
    decorationTypes.length = 0;
    fileDecorationProviders.length = 0;
    visibleEditorListeners.clear();
    changeDocumentListeners.clear();
    setVisibleTextEditors([]);
    quickPickAnswers.length = 0;
    inputBoxAnswers.length = 0;
    inputBoxCalls.length = 0;
    quickPickCalls.length = 0;
    configurationUpdates.length = 0;
    registeredCommands.clear();
    contextKeys.clear();
    statusBarMessages.length = 0;
    configuration.clear();
    activeEditorListeners.clear();
    closeDocumentListeners.clear();
    openDocumentListeners.clear();
    textDocuments.length = 0;
    configurationListeners.clear();
    setActiveTextEditor(undefined);
    setWorkspaceFolders(undefined);
    env.clipboard.text = "";
    mcpServerDefinitionProviders.clear();
    treeViewsShown = true;
    notebookControllers.length = 0;
    notebookSerializers.clear();
    notebookDocuments.length = 0;
    shownNotebooks.length = 0;
    activeNotebookListeners.clear();
    notebookChangeListeners.clear();
    closeNotebookListeners.clear();
    rendererMessagings.length = 0;
    languageSwitches.length = 0;
    untitledNotebooks = 0;
    (window as Record<string, unknown>).activeNotebookEditor = undefined;
};
