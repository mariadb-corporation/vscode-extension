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
 * The Object Details view: the object last selected - on a diagram, in the
 * MSM Projects view or in the Connections view - read only and compressed
 * for a side bar. The view is there twice, below MSM Projects and below
 * Connections, both drawn by this one provider, each with its own side's
 * selection: a project's objects below MSM Projects, a live schema's
 * below Connections; empty until one is selected there. Changing an
 * object is the object editor's.
 */

import * as vscode from "vscode";

import { errorText } from "../text.js";
import { buildWebviewHtml, webviewOptions } from "../webview/html.js";
import type { IObjectDetails } from "../mcp/types.js";
import type {
    ISchemaObjectRef,
    SchemaObjectPlace,
} from "../modeler/modelerProtocol.js";
import type { ISchemaDefinition } from "../modeler/modelFormat.js";
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
}

/** The object shown, and where it is. */
interface ISubject {
    place: SchemaObjectPlace;
    ref: ISchemaObjectRef;
}

/** Whose objects a view shows: the Connections side bar's, or msm's. */
type DetailsSide = "connections" | "msm";

/** What one side bar's view shows, kept apart from the other's. */
interface ISideState {
    subject?: ISubject;
    /** What its views were last sent, for one that opens later. */
    shown: DetailsHostMessage;
    /** Counts the reads, so an older one does not overwrite a newer. */
    reads: number;
    /** Whether the subject is to be read once a view of the side shows. */
    stale: boolean;
}

/**
 * @param place Where an object is.
 *
 * @returns The side bar whose view shows it.
 */
const sideOf = (place: SchemaObjectPlace): DetailsSide => {
    return "projectPath" in place ? "msm" : "connections";
};

/**
 * @param subject What a view shows.
 * @param place Where an object is.
 * @param ref The object.
 *
 * @returns Whether it is that object.
 */
const shows = (subject: ISubject | undefined, place: SchemaObjectPlace,
    ref: ISchemaObjectRef): boolean => {
    return subject !== undefined
        && JSON.stringify(subject.place) === JSON.stringify(place)
        && subject.ref.type === ref.type && subject.ref.name === ref.name;
};

/**
 * @param viewType One of `OBJECT_DETAILS_VIEWS`.
 *
 * @returns The side bar it is in.
 */
const sideOfView = (viewType: string): DetailsSide => {
    return viewType === "mariadb.msmObjectDetails" ? "msm" : "connections";
};

export class ObjectDetailsProvider
    implements vscode.WebviewViewProvider, vscode.Disposable {

    readonly #views = new Set<vscode.WebviewView>();
    /** Each side bar's object: nothing until one is selected there. */
    readonly #sides: Record<DetailsSide, ISideState> = {
        connections: { shown: { type: "show" }, reads: 0, stale: false },
        msm: { shown: { type: "show" }, reads: 0, stale: false },
    };

    public constructor(private readonly host: IObjectDetailsHost) { }

    public resolveWebviewView(view: vscode.WebviewView): void {
        const side = sideOfView(view.viewType);
        const state = this.#sides[side];
        view.webview.options = webviewOptions(this.host.extensionUri);
        view.webview.html = buildWebviewHtml(view.webview,
            this.host.extensionUri, "details", "Object Details");
        this.#views.add(view);
        view.onDidDispose(() => { this.#views.delete(view); });
        view.onDidChangeVisibility(() => {
            if (view.visible && state.stale) {
                void this.#read(side);
            }
        });
        if (state.stale) {
            void this.#read(side);
        }
        view.webview.onDidReceiveMessage((message: DetailsWebviewMessage) => {
            if (message.type === "ready") {
                void view.webview.postMessage(state.shown);
            }
        });
    }

    /**
     * Shows an object, in the view of the side bar whose objects it is:
     * a project's below MSM Projects, a live schema's below Connections.
     *
     * @param place Where it is.
     * @param ref The object.
     *
     * @returns Nothing.
     */
    public show(place: SchemaObjectPlace, ref: ISchemaObjectRef): void {
        const side = sideOf(place);
        const state = this.#sides[side];
        if (!shows(state.subject, place, ref)) {
            state.subject = { place, ref };
            void this.#read(side);
        }
    }

    /**
     * Follows a rename: where a side bar's view shows the object, it shows
     * it under its new name from the next read on.
     *
     * @param place Where the object is.
     * @param ref The object, under its old name.
     * @param name Its new name.
     *
     * @returns Nothing.
     */
    public renamed(place: SchemaObjectPlace, ref: ISchemaObjectRef,
        name: string): void {
        const state = this.#sides[sideOf(place)];
        if (shows(state.subject, place, ref)) {
            state.subject = { place, ref: { ...ref, name } };
        }
    }

    /**
     * Reads the objects shown again: after msm changed the schema.
     *
     * @returns Nothing.
     */
    public refreshed(): void {
        for (const side of ["connections", "msm"] as const) {
            if (this.#sides[side].subject !== undefined) {
                void this.#read(side);
            }
        }
    }

    public dispose(): void {
        this.#views.clear();
    }

    /** @returns The views of a side bar. */
    #viewsOf(side: DetailsSide): vscode.WebviewView[] {
        return [...this.#views].filter((view) => {
            return sideOfView(view.viewType) === side;
        });
    }

    #post(side: DetailsSide, message: DetailsHostMessage): void {
        this.#sides[side].shown = message;
        for (const view of this.#viewsOf(side)) {
            void view.webview.postMessage(message);
        }
    }

    /**
     * Reads a side bar's object and sends it to its view; where that does
     * not show, it is read once it does, not on every selection.
     */
    async #read(side: DetailsSide): Promise<void> {
        const state = this.#sides[side];
        const subject = state.subject;
        if (subject === undefined) {
            return;
        }
        // A read still going is of an older subject, or older state: its
        // answer is not shown, whether this one reads or waits.
        state.reads += 1;
        const read = state.reads;
        state.stale = !this.#viewsOf(side).some((view) => {
            return view.visible;
        });
        if (state.stale) {
            return;
        }
        let message: DetailsHostMessage;
        try {
            message = await this.#detailsOf(subject);
        } catch (error) {
            message = { type: "show", message: `The details of `
                + `${subject.ref.name} could not be read: ${errorText(error)}` };
        }
        if (read === state.reads) {
            this.#post(side, message);
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
                object,
            } };
        }
        const details = await this.host.liveDetails(place.connection,
            place.schema, ref);

        return { type: "show", details: {
            schema: place.schema,
            where: this.host.connectionLabel(place.connection),
            object: liveDetails(details, ref),
        } };
    }
}
