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
 * The Object Details view: the table, view or routine last selected - on
 * a diagram, in the MSM Projects view or in the Connections view - in
 * full. The view is there twice, below MSM Projects and below
 * Connections, both drawn by this one provider from the one selection.
 *
 * A project's table is changed here: the change goes to the project's
 * open diagram, where it joins the history (and is taken back where msm
 * refuses it), else straight to msm. A live schema's objects are shown
 * only.
 */

import * as vscode from "vscode";

import { errorText } from "../text.js";
import { buildWebviewHtml } from "../webview/html.js";
import type { IObjectDetails } from "../mcp/types.js";
import type {
    ISchemaObjectRef,
    SchemaObjectPlace,
} from "../modeler/modelerProtocol.js";
import type { ISchemaDefinition } from "../modeler/modelFormat.js";
import {
    tableDetailEdits,
    type IDetailEdits,
    type TableDetailChange,
} from "./detailEdits.js";
import {
    liveDetails,
    outlineDetails,
    type DetailsHostMessage,
    type DetailsWebviewMessage,
} from "./objectDetails.js";

/** The two views: below Connections, and below MSM Projects. */
export const OBJECT_DETAILS_VIEWS = [
    "mariadb.objectDetails",
    "mariadb.msmObjectDetails",
] as const;

/** What the view needs from the extension. */
export interface IObjectDetailsHost {
    extensionUri: vscode.Uri;
    log(message: string): void;
    /** msm's snapshot of a project's development script. */
    snapshot(projectPath: string): Promise<ISchemaDefinition | undefined>;
    /** What a live schema's server says of an object. */
    liveDetails(connection: string, schema: string,
        ref: ISchemaObjectRef): Promise<IObjectDetails>;
    /** What a connection is called. */
    connectionLabel(connection: string): string;
    /**
     * Makes a change to a project's schema.
     *
     * @returns "viewer" where the project's open diagram took it (it says
     *          how it went through `refreshed` / `failed`), "made" where
     *          msm made it.
     */
    change(projectPath: string, change: IDetailEdits,
        baseHash: string | undefined): Promise<"viewer" | "made">;
}

/** The object shown, and where it is. */
interface ISubject {
    place: SchemaObjectPlace;
    ref: ISchemaObjectRef;
}

export class ObjectDetailsProvider
    implements vscode.WebviewViewProvider, vscode.Disposable {

    readonly #views = new Set<vscode.WebviewView>();
    #subject?: ISubject;
    /** What the views were last sent, for one that opens later. */
    #shown: DetailsHostMessage = { type: "show",
        message: "Select a table, view or routine on a diagram or in a tree." };
    /** Counts the reads, so an older one does not overwrite a newer. */
    #reads = 0;
    /** A table renamed here, until msm made the change or refused it. */
    #renamed?: { from: string; to: string };

    public constructor(private readonly host: IObjectDetailsHost) { }

    public resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.host.extensionUri,
                "dist", "webview")],
        };
        view.webview.html = buildWebviewHtml(view.webview,
            this.host.extensionUri, "details", "Object Details");
        this.#views.add(view);
        view.onDidDispose(() => { this.#views.delete(view); });
        view.webview.onDidReceiveMessage((message: DetailsWebviewMessage) => {
            if (message.type === "ready") {
                void view.webview.postMessage(this.#shown);
            } else if (message.type === "change") {
                void this.#change(message.change);
            }
        });
    }

    /**
     * Shows an object.
     *
     * @param place Where it is.
     * @param ref The object.
     *
     * @returns Nothing.
     */
    public show(place: SchemaObjectPlace, ref: ISchemaObjectRef): void {
        const same = this.#subject !== undefined
            && JSON.stringify(this.#subject) === JSON.stringify({ place, ref });
        if (!same) {
            this.#subject = { place, ref };
            void this.#read();
        }
    }

    /**
     * Reads the object shown again: after msm changed the schema.
     *
     * @returns Nothing.
     */
    public refreshed(): void {
        this.#renamed = undefined;
        if (this.#subject !== undefined) {
            void this.#read();
        }
    }

    /**
     * Says a change was refused, and shows the object as it is.
     *
     * @param message Why.
     *
     * @returns Nothing.
     */
    public failed(message: string): void {
        if (this.#renamed !== undefined && this.#subject !== undefined) {
            // The table keeps its name.
            this.#subject.ref = { ...this.#subject.ref,
                name: this.#renamed.from };
            this.#renamed = undefined;
        }
        this.#post({ type: "status", error: message });
        if (this.#subject !== undefined) {
            void this.#read();
        }
    }

    public dispose(): void {
        this.#views.clear();
    }

    #post(message: DetailsHostMessage): void {
        if (message.type === "show") {
            this.#shown = message;
        }
        for (const view of this.#views) {
            void view.webview.postMessage(message);
        }
    }

    /** Reads the object shown and sends it to the views. */
    async #read(): Promise<void> {
        const subject = this.#subject;
        if (subject === undefined) {
            return;
        }
        this.#reads += 1;
        const read = this.#reads;
        let message: DetailsHostMessage;
        try {
            message = await this.#detailsOf(subject);
        } catch (error) {
            message = { type: "show", message: `The details of `
                + `${subject.ref.name} could not be read: ${errorText(error)}` };
        }
        if (read === this.#reads) {
            this.#post(message);
        }
    }

    async #detailsOf(subject: ISubject): Promise<DetailsHostMessage> {
        const { place, ref } = subject;
        if ("projectPath" in place) {
            const definition = await this.host.snapshot(place.projectPath);
            const object = definition === undefined
                ? undefined : outlineDetails(definition, ref);
            if (definition === undefined || object === undefined) {
                return { type: "show", message: `${ref.name} is not in the `
                    + "project's schema snapshot." };
            }

            return { type: "show", details: {
                schema: definition.schema,
                where: "Project",
                editable: object.type === "table",
                object,
            } };
        }
        const details = await this.host.liveDetails(place.connection,
            place.schema, ref);

        return { type: "show", details: {
            schema: place.schema,
            where: this.host.connectionLabel(place.connection),
            editable: false,
            partial: ref.type === "table"
                ? "Indexes and foreign keys are shown for a project's tables."
                : undefined,
            object: liveDetails(details, ref),
        } };
    }

    /** Makes a change asked for in the view, to the table shown. */
    async #change(change: TableDetailChange): Promise<void> {
        const subject = this.#subject;
        if (subject === undefined || !("projectPath" in subject.place)
            || subject.ref.type !== "table") {
            return;
        }
        const projectPath = subject.place.projectPath;
        try {
            const definition = await this.host.snapshot(projectPath);
            const table = definition?.tables.find((entry) => {
                return entry.name === subject.ref.name;
            });
            if (definition === undefined || table === undefined) {
                this.#post({ type: "status", error: `${subject.ref.name} is `
                    + "not in the project's schema snapshot." });

                return;
            }
            const edits = tableDetailEdits(table, change);
            if ("error" in edits) {
                this.#post({ type: "status", error: edits.error });

                return;
            }
            if (change.kind === "renameTable") {
                this.#renamed = { from: table.name, to: change.name };
                subject.ref = { ...subject.ref, name: change.name };
            }
            this.#post({ type: "status", busy: true });
            const how = await this.host.change(projectPath, edits,
                definition.source_hash);
            if (how === "made") {
                this.refreshed();
            }
        } catch (error) {
            const text = errorText(error);
            this.host.log(`Could not change ${subject.ref.name}: ${text}`);
            this.failed(text);
        }
    }
}
