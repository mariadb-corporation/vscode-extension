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

import { stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import type * as vscode from "vscode";

import { reportError } from "../errorMessages.js";

/**
 * The paths of the links this extension answers, under
 * `<scheme>://mariadb.mariadb-shell`. A coding agent that made an MSM
 * project writes one into its answer, so that a click shows its work:
 *
 * `vscode://mariadb.mariadb-shell/msm/openDiagram?project=<folder>&diagram=<name>`
 *
 * The scheme is the editor's own (`vscode.env.uriScheme`): `vscode`,
 * `vscode-insiders`, or a Theia app's `uriScheme`.
 */
export const MSM_LINK_PATHS = {
    /**
     * Adds the project to the MSM Projects view (where it is listed, it
     * keeps its place) and opens one of its diagrams: the one named by
     * `diagram`, else one picked.
     */
    openDiagram: "/msm/openDiagram",
} as const;

/** What an Open Diagram link asks for. */
export interface IMsmDiagramLink {
    /** The project folder, absolute. */
    project: string;

    /** The diagram's name; left out, one is picked. */
    diagram?: string;
}

/** The parameters of an Open Diagram link, the only ones looked for. */
const LINK_KEYS = /(?:^|&)(project|diagram)=/g;

/**
 * Reads the parameters of a link's query.
 *
 * The editor hands the query over decoded once (VS Code's and Theia's
 * `Uri.query` alike), so an `&` or `=` a folder name had encoded arrives
 * as is, and `URLSearchParams` would split the value there. Only the two
 * known keys start a parameter, so a value runs on to the next of them.
 *
 * @param query The query, decoded.
 *
 * @returns The value of each key there.
 */
export const linkParameters = (query: string): Map<string, string> => {
    const found = [...query.matchAll(LINK_KEYS)];
    const parameters = new Map<string, string>();
    found.forEach((match, index) => {
        const start = match.index + match[0].length;
        const end = found[index + 1]?.index ?? query.length;
        parameters.set(match[1], query.slice(start, end));
    });

    return parameters;
};

/**
 * @param path The link's path.
 * @param query Its query, decoded.
 *
 * @returns What it asks for, or why it cannot be followed.
 */
export const parseMsmLink = (
    path: string,
    query: string,
): { link: IMsmDiagramLink } | { error: string } => {
    if (path !== MSM_LINK_PATHS.openDiagram) {
        return { error: `This MariaDB link is not known: ${path}` };
    }
    const parameters = linkParameters(query);
    const project = parameters.get("project")?.trim() ?? "";
    if (project === "") {
        return { error: "The MariaDB link names no MSM project folder." };
    }
    if (!isAbsolute(project)) {
        return {
            error: `The MariaDB link's MSM project folder is not an `
                + `absolute path: ${project}`,
        };
    }
    const diagram = parameters.get("diagram")?.trim();

    return {
        link: diagram === undefined || diagram === ""
            ? { project } : { project, diagram },
    };
};

/**
 * @param folder A folder a link named.
 *
 * @returns Why it is no MSM project, or `undefined` where it is one.
 */
export const notAProject = async (
    folder: string,
): Promise<string | undefined> => {
    try {
        if (!(await stat(folder)).isDirectory()) {
            return `${folder} is not a folder.`;
        }
    } catch {
        return `${folder} does not exist.`;
    }
    try {
        await stat(join(folder, "msm.project.json"));
    } catch {
        return `${folder} is no MSM project: it has no msm.project.json.`;
    }

    return undefined;
};

/**
 * @param names A project's diagrams.
 * @param wanted The one a link named.
 *
 * @returns The diagram meant: the one of that name, else the one only
 *          differing in case; `undefined` where there is none, or several.
 */
export const diagramNamed = (
    names: string[],
    wanted: string,
): string | undefined => {
    if (names.includes(wanted)) {
        return wanted;
    }
    const lower = wanted.toLowerCase();
    const alike = names.filter((name) => {
        return name.toLowerCase() === lower;
    });

    return alike.length === 1 ? alike[0] : undefined;
};

/** What following a link needs of the rest of the extension. */
export interface IMsmLinkHost {
    /**
     * Adds a project to the MSM Projects view, as an action; where it is
     * listed, it keeps its place.
     */
    addToProjects(projectPath: string): Promise<void>;

    /** The names of a project's diagrams, as msm lists them. */
    diagramNames(projectPath: string): Promise<string[]>;

    /** Opens a diagram of a project. */
    openDiagram(projectPath: string, name: string): void;

    /** Opens a diagram of a project, asking which where it has several. */
    pickDiagram(projectPath: string): Promise<void>;

    /** Tells the user a link could not be followed as it asked. */
    warn(message: string): void;

    /** Writes to the MariaDB output channel. */
    log(message: string): void;
}

/**
 * Follows the links under `<scheme>://mariadb.mariadb-shell` (see
 * {@link MSM_LINK_PATHS}).
 *
 * Anyone can write such a link, a web page too, so it is followed only as
 * far as the user could go by hand: a folder that is an MSM project is
 * listed and one of its diagrams opened. Nothing runs, nothing is changed
 * in the project, and its MCP access stays off.
 */
export class MsmLinkHandler implements vscode.UriHandler {
    readonly #host: IMsmLinkHost;

    /**
     * @param host What following a link needs.
     */
    public constructor(host: IMsmLinkHost) {
        this.#host = host;
    }

    /**
     * @param uri The link clicked.
     *
     * @returns When it has been followed.
     */
    public async handleUri(uri: vscode.Uri): Promise<void> {
        this.#host.log(`Following the link ${uri.path}?${uri.query}`);
        const parsed = parseMsmLink(uri.path, uri.query);
        if ("error" in parsed) {
            this.#host.warn(parsed.error);

            return;
        }
        const { project, diagram } = parsed.link;
        const refused = await notAProject(project);
        if (refused !== undefined) {
            this.#host.warn(refused);

            return;
        }
        try {
            await this.#host.addToProjects(project);
            if (diagram === undefined) {
                await this.#host.pickDiagram(project);

                return;
            }
            const names = await this.#host.diagramNames(project);
            const name = diagramNamed(names, diagram);
            if (name !== undefined) {
                this.#host.openDiagram(project, name);

                return;
            }
            this.#host.warn(`${basename(project)} has no schema diagram `
                + `named ${diagram}.`);
            await this.#host.pickDiagram(project);
        } catch (error) {
            reportError(this.#host.log, error,
                `open the MSM project ${project}`);
        }
    }
}
