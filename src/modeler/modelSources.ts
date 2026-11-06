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

import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
    IMsmApi,
    IMsmSchemaEdit,
} from "../mcp/msmApi.js";
import {
    callArguments,
    GENERAL_ACTIONS,
} from "../connections/connectionActivity.js";
import { schemaNameOfFolder } from "../msm/msmFields.js";
import { ActionGroup, type ActionPutter } from "../restd/actionGroup.js";
import { counted, errorText } from "../text.js";
import type { DiagramDrafts } from "./diagramDrafts.js";
import {
    assembleSchemaModel,
    DIAGRAM_FORMAT,
    documentOf,
    type IDiagramDocument,
    type IDiagramRow,
    type IModelDiagram,
    type ISchemaModel,
    withoutPictures,
} from "./modelFormat.js";
import type { ModelerTarget, SaveState } from "./modelerProtocol.js";

/**
 * Where a viewer's model comes from, and where its changes go: a live
 * schema's `msm_schema_diagrams` view (read only: msm writes it), or an
 * MSM project through the msm tools, which saves the diagrams and makes
 * schema edits in the project's SQL.
 */

/** What a schema edit came to. */
export interface ISchemaEditOutcome {
    /** The model afterwards: its snapshot is the one to draw. */
    model: ISchemaModel;
    /** What the edits could not change themselves, for the user. */
    notes: string[];
}

/** A viewer's model: where it is read, and where changes go. */
export interface IModelSource {
    /** Tells the panels apart: one per schema of a connection or project. */
    readonly key: string;
    /** What a panel is restored from after a restart. */
    target(diagram: string): ModelerTarget;
    /** The schema's name for the tab's title, before the model is read. */
    readonly schemaTitle: string;
    /** Reads the model, with what it was read from. */
    read(): Promise<{ model: ISchemaModel; source: string }>;
    /** Whether diagrams are saved (the auto-store) and schemas edited. */
    readonly editable: boolean;
    /** The picture msm left out of an image figure. */
    image?(diagram: string, figureId: string): Promise<string>;
    /** A diagram changed in the viewer: kept, then saved. */
    changed?(document: IDiagramDocument): void;
    /**
     * Makes schema edits in the project's SQL.
     *
     * @param edits The edits.
     * @param baseHash The snapshot they are made against.
     * @param documents Diagrams the change changed too: saved once the
     *                  edit is made, dropped where it fails.
     */
    edit?(edits: IMsmSchemaEdit[], baseHash: string,
        documents?: IDiagramDocument[]): Promise<ISchemaEditOutcome>;
    /** Saves what is waiting to be saved, now. */
    flush?(): Promise<void>;
    /** Where the saves stand, for the viewer to show. */
    onSaveState?: (state: SaveState) => void;
}

/**
 * @param value A JSON value.
 *
 * @returns It as JSON with every object's keys sorted, so two documents
 *          alike but for the order of their keys read alike.
 */
const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        return `{${Object.keys(value).sort().map((key) => {
            return `${JSON.stringify(key)}:${canonicalJson(
                (value as Record<string, unknown>)[key])}`;
        }).join(",")}}`;
    }

    return JSON.stringify(value) ?? "null";
};

/**
 * @param document A diagram's document, as msm has it or the viewer sends
 *                 it.
 *
 * @returns What tells its versions apart: the pictures and the
 *          notations are left out, as the viewer sends neither.
 */
export const diagramHash = (document: IModelDiagram): string => {
    const {
        figureNotation: _figure,
        connectionNotation: _connection,
        format: _format,
        ...rest
    } = document as IDiagramDocument;
    const figures = withoutPictures(document.figures);

    return createHash("sha256").update(canonicalJson({ ...rest, figures }))
        .digest("hex");
};

/**
 * @param rows The rows of a diagrams view.
 *
 * @returns Each diagram's hash, by its name.
 */
const hashesOf = (rows: readonly IDiagramRow[]): Map<string, string> => {
    return new Map(rows.filter((row) => {
        return row.format === DIAGRAM_FORMAT;
    }).map((row) => {
        return [row.name,
            diagramHash(documentOf(row) as unknown as IModelDiagram)];
    }));
};

/** The schema of a connection, read from its diagrams view. */
export class ConnectionModelSource implements IModelSource {
    public readonly editable = false;

    /**
     * @param connection The connection's URI.
     * @param schema The schema.
     * @param readRows Reads the view's rows.
     */
    public constructor(
        private readonly connection: string,
        private readonly schema: string,
        private readonly readRows: () => Promise<IDiagramRow[]>,
    ) { }

    public get key(): string {
        return JSON.stringify(["connection", this.connection, this.schema]);
    }

    public get schemaTitle(): string {
        return this.schema;
    }

    public target(diagram: string): ModelerTarget {
        return {
            kind: "connection",
            connection: this.connection,
            schema: this.schema,
            diagram,
        };
    }

    public async read(): Promise<{ model: ISchemaModel; source: string }> {
        return {
            model: assembleSchemaModel(await this.readRows()),
            source: `${this.schema}.msm_schema_diagrams`,
        };
    }
}

/** What a project's source needs from the extension. */
export interface IProjectSourceHost {
    msmApi(): Promise<IMsmApi>;
    /** Where the Actions rows go. */
    put: ActionPutter;
    /** Where changes wait until msm has them. */
    drafts: DiagramDrafts;
    /**
     * Asks whether to keep changes the viewer kept of a diagram the
     * project changed since.
     *
     * @param diagram The diagram.
     * @param when When the changes were kept.
     *
     * @returns Whether to keep them over the project's diagram.
     */
    keepDraft(diagram: string, when: Date): Promise<boolean>;
    log(message: string): void;
}

/** How long changes settle before they are saved, in ms. */
export const SAVE_DELAY_MS = 1000;

/** A diagram's changes, waiting to be saved. */
interface IPending {
    document: IDiagramDocument;
    /** Counts changes, so a save knows whether a newer one came. */
    version: number;
    timer?: ReturnType<typeof setTimeout>;
}

/**
 * @param projectPath A project folder.
 *
 * @returns Its name without `.msm.project`, until the model says the
 *          schema.
 */
const folderSchema = (projectPath: string): string => {
    return schemaNameOfFolder(basename(projectPath));
};

/**
 * An MSM project's diagrams, through the msm tools. Every call is an
 * action of the Actions tab, and they run one at a time: msm reads and
 * writes the project's files, and the MCP connector does not serialize
 * calls.
 *
 * A changed diagram is kept in the extension's storage at once (a draft,
 * which outlives a VS Code that is closed), then saved to the project once
 * the changes settle; the draft goes once msm has it. Reading the project
 * again picks drafts up: kept where the project's diagram is still the one
 * they were made from, else as the user decides.
 */
export class ProjectModelSource implements IModelSource {
    public readonly editable = true;
    public onSaveState?: (state: SaveState) => void;

    #queue: Promise<unknown> = Promise.resolve();
    #version = 0;
    readonly #pending = new Map<string, IPending>();
    /** Each diagram's hash as the project has it. */
    #bases = new Map<string, string>();
    #schema: string;

    /**
     * @param projectPath The project folder.
     * @param host What the source needs from the extension.
     * @param delayMs How long changes settle before they are saved.
     */
    public constructor(
        private readonly projectPath: string,
        private readonly host: IProjectSourceHost,
        private readonly delayMs = SAVE_DELAY_MS,
    ) {
        this.#schema = folderSchema(projectPath);
    }

    public get key(): string {
        return JSON.stringify(["project", this.projectPath]);
    }

    public get schemaTitle(): string {
        return this.#schema;
    }

    public target(diagram: string): ModelerTarget {
        return { kind: "project", projectPath: this.projectPath, diagram };
    }

    public async read(): Promise<{ model: ISchemaModel; source: string }> {
        const rows = await this.#enqueuedAction({
            doing: `Reading the diagrams of ${this.#schema}`,
            done: `Read the diagrams of ${this.#schema}`,
        }, "msm.get_schema_diagrams", {}, (api) => {
            return api.getSchemaDiagrams(this.projectPath);
        }, (read) => { return counted(read.length, "document"); });
        this.#bases = hashesOf(rows);
        const model = assembleSchemaModel(rows);
        this.#schema = model.schema;
        await this.#takeDrafts(model);

        return { model, source: this.projectPath };
    }

    /**
     * Puts the drafts the extension kept of the project's diagrams into a
     * model just read, and saves them.
     */
    async #takeDrafts(model: ISchemaModel): Promise<void> {
        const drafts = await this.host.drafts.list(this.projectPath);
        for (const draft of drafts) {
            const index = model.diagrams.findIndex((diagram) => {
                return diagram.name === draft.name;
            });
            const base = this.#bases.get(draft.name);
            const keep = index >= 0 && (draft.base === base
                || await this.host.keepDraft(draft.name, draft.savedAt));
            if (!keep) {
                this.host.log(index < 0
                    ? `Dropped the unsaved changes of the diagram ${draft.name} `
                        + `of ${this.projectPath}: the project no longer has it.`
                    : `Dropped the unsaved changes of the diagram ${draft.name} `
                        + `of ${this.projectPath} for the project's.`);
                this.host.drafts.remove(this.projectPath, draft.name);
                continue;
            }
            // The draft has no pictures: the project's figures carry
            // what stands for them.
            const read = model.diagrams[index];
            const pictures = new Map(read.figures.map((figure) => {
                return [figure.id, figure];
            }));
            model.diagrams[index] = {
                ...draft.document,
                name: draft.name,
                figures: draft.document.figures.map((figure) => {
                    const stored = pictures.get(figure.id);

                    return stored?.image_size === undefined
                        ? figure
                        : { ...figure, image_size: stored.image_size };
                }),
            };
            this.host.log(`Restored the unsaved changes of the diagram `
                + `${draft.name} of ${this.projectPath}.`);
            this.#schedule(draft.document, false);
        }
    }

    public image(diagram: string, figureId: string): Promise<string> {
        return this.#enqueuedAction({
            doing: `Reading a picture of ${diagram}`,
            done: `Read a picture of ${diagram}`,
        }, "msm.get_schema_diagram_image", { diagram, figure_id: figureId },
        (api) => {
            return api.getSchemaDiagramImage(this.projectPath, diagram,
                figureId);
        }, (image) => { return `${String(image.length)} characters`; });
    }

    public changed(document: IDiagramDocument): void {
        this.#schedule(document, true);
    }

    /**
     * Keeps a diagram's changes, and saves them once they settle.
     *
     * @param document The diagram.
     * @param draft Whether to keep it as a draft first.
     */
    #schedule(document: IDiagramDocument, draft: boolean): void {
        const previous = this.#pending.get(document.name);
        if (previous?.timer !== undefined) {
            clearTimeout(previous.timer);
        }
        this.#version += 1;
        const pending: IPending = { document, version: this.#version };
        this.#pending.set(document.name, pending);
        if (draft) {
            try {
                this.host.drafts.put(this.projectPath, document,
                    this.#bases.get(document.name) ?? "");
            } catch (error) {
                this.host.log(`Could not keep the changes of the diagram `
                    + `${document.name}: ${errorText(error)}`);
            }
        }
        this.onSaveState?.({ state: "pending" });
        pending.timer = setTimeout(() => {
            pending.timer = undefined;
            void this.#enqueue(() => { return this.#save(document.name); })
                .catch(() => { /* reported by the save */ });
        }, this.delayMs);
    }

    /** Saves a diagram's changes to the project. */
    async #save(name: string): Promise<void> {
        const pending = this.#pending.get(name);
        if (pending === undefined) {
            return;
        }
        this.onSaveState?.({ state: "saving" });
        try {
            await this.#action({
                doing: `Saving the diagram ${name} of ${this.#schema}`,
                done: `Saved the diagram ${name} of ${this.#schema}`,
            }, "msm.set_schema_diagram", { document: name }, (api) => {
                return api.setSchemaDiagram(this.projectPath,
                    pending.document);
            }, (files) => {
                return files.length === 0
                    ? "Nothing changed" : counted(files.length, "file");
            });
        } catch (error) {
            // The draft stays, for the next change or the next start.
            this.onSaveState?.({ state: "failed", message: errorText(error) });
            throw error;
        }
        const base = diagramHash(pending.document);
        this.#bases.set(name, base);
        const newer = this.#pending.get(name);
        if (newer === pending) {
            this.#pending.delete(name);
            this.host.drafts.remove(this.projectPath, name);
        } else if (newer !== undefined) {
            // Changes made while this save ran build on what it saved: their
            // draft says so, or the next start would take the save for a
            // change the project made.
            try {
                this.host.drafts.put(this.projectPath, newer.document, base);
            } catch (error) {
                this.host.log(`Could not keep the changes of the diagram `
                    + `${name}: ${errorText(error)}`);
            }
        }
        if (this.#pending.size === 0) {
            this.onSaveState?.({ state: "saved" });
        }
    }

    public async flush(): Promise<void> {
        const saves = [...this.#pending.values()].map((pending) => {
            if (pending.timer !== undefined) {
                clearTimeout(pending.timer);
                pending.timer = undefined;
            }

            return this.#enqueue(() => {
                return this.#save(pending.document.name);
            });
        });
        await Promise.all(saves);
    }

    public async edit(
        edits: IMsmSchemaEdit[],
        baseHash: string,
        documents: IDiagramDocument[] = [],
    ): Promise<ISchemaEditOutcome> {
        // msm makes the diagrams follow a rename from what it has stored:
        // the viewer's changes go first.
        await this.flush();
        let result: Awaited<ReturnType<IMsmApi["editSchema"]>>;
        try {
            result = await this.#editAction(edits, baseHash);
        } catch (error) {
            // A figure of an object that was not made goes with it.
            for (const document of documents) {
                this.#pending.delete(document.name);
                this.host.drafts.remove(this.projectPath, document.name);
            }
            throw error;
        }
        this.#bases = hashesOf(result.rows);
        for (const document of documents) {
            // Changes made since are newer, and saved in their turn.
            if (!this.#pending.has(document.name)) {
                this.#version += 1;
                this.#pending.set(document.name,
                    { document, version: this.#version });
                await this.#enqueue(() => { return this.#save(document.name); });
            }
        }

        return {
            model: assembleSchemaModel(result.rows),
            notes: result.notes.map((note) => { return note.message; }),
        };
    }

    /** Makes schema edits through msm, as an action of the queue. */
    #editAction(
        edits: IMsmSchemaEdit[],
        baseHash: string,
    ): ReturnType<IMsmApi["editSchema"]> {
        return this.#enqueuedAction({
            doing: `Editing the schema of ${this.#schema}`,
            done: `Edited the schema of ${this.#schema}`,
        }, "msm.edit_schema", { edits: edits.map(describeEdit).join("; ") },
        (api) => {
            return api.editSchema(this.projectPath, edits, baseHash);
        }, (edited) => {
            return counted(edited.files.length, "file");
        });
    }

    /** Runs work after everything queued before it. */
    #enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.#queue.then(work, work);
        this.#queue = run.catch(() => { /* the caller's to report */ });

        return run;
    }

    /**
     * Makes one msm call as an action of its own, after the calls queued
     * before it.
     */
    #enqueuedAction<T>(
        words: { doing: string; done: string },
        tool: string,
        args: Record<string, unknown>,
        call: (api: IMsmApi) => Promise<T>,
        detail: (value: T) => string,
    ): Promise<T> {
        return this.#enqueue(() => {
            return this.#action(words, tool, args, call, detail);
        });
    }

    /**
     * Makes one msm call as an action of its own, now: for work already
     * running in the queue.
     */
    #action<T>(
        words: { doing: string; done: string },
        tool: string,
        args: Record<string, unknown>,
        call: (api: IMsmApi) => Promise<T>,
        detail: (value: T) => string,
    ): Promise<T> {
        const group = new ActionGroup(this.host.put, GENERAL_ACTIONS, words);

        return group.run(() => {
            return group.step(words, `${tool}(${callArguments({
                ...args,
                schema_project_path: this.projectPath,
            })})`, async () => {
                return call(await this.host.msmApi());
            }, { detail });
        }, detail);
    }
}

/**
 * @param message Why msm refused a schema edit.
 *
 * @returns Whether the project changed since the snapshot the viewer
 *          shows (msm's `StaleSchemaError`): then the viewer's copy is out
 *          of date, and only reading the project again helps.
 */
export const isStaleSnapshot = (message: string): boolean => {
    return /changed since the snapshot the edits were made against|has no schema snapshot yet/
        .test(message);
};

/**
 * @param edit A schema edit.
 *
 * @returns It in a few words, for its Actions row.
 */
export const describeEdit = (edit: IMsmSchemaEdit): string => {
    // A name, or an object named: `add_table`'s table.
    const names = ["table", "view", "routine", "column", "foreign_key",
        "index", "name"].map((key) => {
        const value = edit[key];

        return typeof value === "object" && value !== null
            ? (value as { name?: unknown }).name
            : value;
    }).filter((value): value is string => { return typeof value === "string"; });
    const renamed = typeof edit.new_name === "string"
        ? [`-> ${edit.new_name}`] : [];

    return [edit.op, ...names, ...renamed].join(" ");
};
