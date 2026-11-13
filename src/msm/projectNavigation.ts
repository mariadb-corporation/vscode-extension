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
 * Going from a row of the MSM Projects view to what it stands for: a
 * schema, schema object or REST item to its statement in the project's
 * SQL (Open Definition), a layer or figure of a diagram to the diagram,
 * scrolled to it and selected (Show in Diagram). Each has a button on its
 * rows, and a double-click on the row does it.
 */

import * as vscode from "vscode";

import { reportError } from "../errorMessages.js";
import type { DiagramRowNode } from "../tree/diagramRows.js";
import { DoubleClick } from "../tree/doubleClick.js";
import {
    MSM_ROW_CLICK_COMMAND,
    rowIdOf,
    type MsmProjectsNode,
} from "../tree/msmProjectsTreeProvider.js";
import { definitionOf, type IOutlineRange } from "./definitions.js";

/** The commands, on the MSM Projects view's rows only. */
export const MSM_NAVIGATION_COMMANDS = {
    /** A schema, object or REST row's statement, opened in its file. */
    openDefinition: "mariadb.msm.openDefinition",
    /** A layer's or figure's diagram, opened on it, selected. */
    showInDiagram: "mariadb.msm.showInDiagram",
} as const;

/** What going to definitions and figures needs from the extension. */
export interface IProjectNavigationHost {
    /** mariadb-lsp's outline of a file. */
    outline(file: string): Promise<unknown>;
    /** A project's development script, if it has one. */
    developmentScript(projectPath: string): Promise<string | undefined>;
    /** Opens a project's diagram, scrolled to an item, which it selects. */
    showInDiagram(projectPath: string, diagram: string, itemId: string): void;
    log(message: string): void;
}

/** @returns Whether a row is a diagram's layer, figure or group member. */
const isDiagramRow = (node: MsmProjectsNode): node is DiagramRowNode => {
    return node.kind === "diagramLayer" || node.kind === "diagramFigure"
        || node.kind === "diagramMember";
};

/**
 * @param node A layer, figure or group member row.
 *
 * @returns The diagram item it shows: a member's group figure.
 */
export const diagramItemIdOf = (node: DiagramRowNode): string => {
    switch (node.kind) {
        case "diagramLayer": { return node.layer.id; }
        case "diagramFigure": { return node.figure.id; }
        default: { return node.figureId; }
    }
};

/**
 * @param range A range of the outline.
 *
 * @returns It as VS Code has it: the outline's positions are 0-based lines
 *          and UTF-16 characters, as VS Code's.
 */
const vscodeRange = (range: IOutlineRange): vscode.Range => {
    return new vscode.Range(range.start.line, range.start.character,
        range.end.line, range.end.character);
};

/** The commands, registered by {@link ProjectNavigation.register}. */
export class ProjectNavigation {
    readonly #clicks: DoubleClick;

    public constructor(private readonly host: IProjectNavigationHost,
        clicks = new DoubleClick()) {
        this.#clicks = clicks;
    }

    /**
     * @returns The registrations, for the extension to dispose.
     */
    public register(): vscode.Disposable[] {
        const command = (id: string, run: (node: MsmProjectsNode) =>
            Promise<void>, what: string): vscode.Disposable => {
            return vscode.commands.registerCommand(id, async (row?: unknown) => {
                const node = row as MsmProjectsNode | undefined;
                if (node?.kind === undefined) {
                    return;
                }
                try {
                    await run(node);
                } catch (error) {
                    reportError(this.host.log, error, what);
                }
            });
        };

        return [
            command(MSM_NAVIGATION_COMMANDS.openDefinition, (node) => {
                return this.openDefinition(node);
            }, "open the definition"),
            command(MSM_NAVIGATION_COMMANDS.showInDiagram, (node) => {
                this.showInDiagram(node);

                return Promise.resolve();
            }, "show it in the diagram"),
            // Every click on those rows: a double-click does one of the two.
            command(MSM_ROW_CLICK_COMMAND, (node) => {
                return this.clicked(node);
            }, "open the row"),
        ];
    }

    /**
     * Takes a click on a row: a double-click opens its definition, or its
     * diagram on it.
     *
     * @param node The row.
     */
    public async clicked(node: MsmProjectsNode): Promise<void> {
        if (node.kind === "folder" || !this.#clicks.click(rowIdOf(node))) {
            return;
        }
        if (isDiagramRow(node)) {
            this.showInDiagram(node);
        } else {
            await this.openDefinition(node);
        }
    }

    /**
     * Opens a row's statement in its file, its name selected.
     *
     * @param node A schema, object or REST row; others are skipped.
     */
    public async openDefinition(node: MsmProjectsNode): Promise<void> {
        // A REST row knows its statement already.
        if (node.kind === "restService" || node.kind === "restSchema"
            || node.kind === "restObject") {
            const at = new vscode.Position(node.line, 0);
            await vscode.window.showTextDocument(vscode.Uri.file(node.file),
                { preview: false, selection: new vscode.Range(at, at) });

            return;
        }
        if (node.kind !== "schema" && node.kind !== "object") {
            return;
        }
        const script = await this.host.developmentScript(node.projectPath);
        if (script === undefined) {
            throw new Error(`The MSM project ${node.projectPath} has no `
                + "development script.");
        }
        const target = node.kind === "schema"
            ? { kind: "schema" as const, schema: node.schema }
            : { kind: "object" as const, schema: node.schema,
                type: node.objectType, name: node.name };
        const place = definitionOf(await this.host.outline(script), target,
            script);
        if (place === undefined) {
            // A schema the script does not declare: the script itself.
            if (node.kind === "schema") {
                await vscode.window.showTextDocument(vscode.Uri.file(script),
                    { preview: false });

                return;
            }
            throw new Error(`The development script does not create the `
                + `${node.objectType} ${node.name}.`);
        }
        await vscode.window.showTextDocument(vscode.Uri.file(place.file),
            { preview: false, selection: vscodeRange(place.selection) });
    }

    /**
     * Opens a layer's or figure's diagram on it.
     *
     * @param node A diagram row; others are skipped.
     */
    public showInDiagram(node: MsmProjectsNode): void {
        if (isDiagramRow(node)) {
            this.host.showInDiagram(node.projectPath, node.diagram,
                diagramItemIdOf(node));
        }
    }
}
