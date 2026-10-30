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
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { parseCell } from "../mrs/mrsApi.js";
import { useServiceSql } from "../mrs/restSql.js";
import type { IMrsService } from "../mrs/mrsTypes.js";
import { errorText } from "../text.js";
import type { INotebookSdk } from "./scriptProtocol.js";

/** The `rest.*` tools a notebook's SDK is built with. */
export interface ISdkTools {
    getSdkBaseClasses(): Promise<string>;
    getSdkServiceClasses(
        connectionId: string,
        serviceId?: string,
        serviceUrl?: string,
    ): Promise<string>;
    getRuntimeManagementCode(connectionId: string): Promise<string>;
}

/** What building a notebook's SDK needs from the rest of the extension. */
export interface INotebookSdkDependencies {
    /** Opens the connection, and answers its session's id. */
    connect(uri: string): Promise<string>;
    /**
     * Runs SQL on the connection's session, unseen: not an action, and no
     * run the SDK is dropped for.
     */
    query(uri: string, sql: string): Promise<Array<Record<string, unknown>>>;
    tools(): Promise<ISdkTools>;
    /** The REST Daemon serving the connection's server: its URL. */
    restdUrl(uri: string): Promise<string | undefined>;
    /** The shell's local certificate authority's certificate, PEM. */
    certificateAuthority(): Promise<string | undefined>;
    /** Hands the SDK's source to the editor, for the cells' typings. */
    publishTypings(sdk: INotebookSdk): void;
    log(message: string): void;
}

/** What a login asks for, and what the cell named of it. */
export interface ILoginRequest {
    serviceUrl?: unknown;
    app?: unknown;
    username?: unknown;
}

/** What a login is made with. */
export interface ILogin {
    app: string;
    username: string;
    password: string;
}

/**
 * Picks the service a notebook's SDK is for: the session's current one,
 * else the only one there is.
 *
 * @param services The connection's REST services.
 *
 * @returns The service, if one is picked so.
 */
export const sdkServiceOf = (
    services: readonly IMrsService[],
): IMrsService | undefined => {
    return services.find((service) => {
        return service.is_current === true;
    }) ?? (services.length === 1 ? services[0] : undefined);
};

/**
 * The REST client SDK of each connection a notebook runs TypeScript on, as
 * the MySQL Shell's notebooks had it: the SDK's base classes, and the
 * classes of the session's current REST service - or of the only one -
 * reaching it through the REST Daemon that serves the connection's server.
 * With no service at all, the REST Service management code instead. Built
 * once a TypeScript cell runs, kept until a run on the connection changes
 * the catalog or the REST metadata, or a cell asks for it again.
 */
export class NotebookSdk {
    /** Connection -> its SDK, as it is being built or was built. */
    readonly #built = new Map<string, Promise<INotebookSdk | undefined>>();
    /** Connection -> its REST services, as the last build read them. */
    readonly #services = new Map<string, IMrsService[]>();
    /** The base classes: the same for every service, asked for once. */
    #base?: Promise<string>;

    /**
     * @param deps What building it needs.
     */
    public constructor(private readonly deps: INotebookSdkDependencies) { }

    /**
     * @param uri The connection.
     *
     * @returns Its SDK; none where its server has no REST metadata, or
     *          several services and none current.
     */
    public forConnection(uri: string): Promise<INotebookSdk | undefined> {
        let built = this.#built.get(uri);
        if (built === undefined) {
            built = this.#build(uri);
            this.#built.set(uri, built);
            // A failure is not kept: the next cell tries again.
            built.catch(() => {
                if (this.#built.get(uri) === built) {
                    this.#built.delete(uri);
                }
            });
        }

        return built;
    }

    /**
     * Lets go of a connection's SDK, which the next TypeScript cell builds
     * again.
     *
     * @param uri The connection.
     *
     * @returns Nothing.
     */
    public invalidate(uri: string): void {
        this.#built.delete(uri);
    }

    /**
     * @param uri The connection.
     *
     * @returns Its SDK, built again now.
     */
    public async refresh(uri: string): Promise<INotebookSdk | undefined> {
        this.invalidate(uri);

        return this.forConnection(uri);
    }

    /**
     * Makes a REST service its session's current one, and builds the SDK
     * for it.
     *
     * @param uri The connection.
     * @param serviceId The service.
     *
     * @returns The SDK.
     *
     * @throws Where the connection has no such service.
     */
    public async setCurrentService(
        uri: string,
        serviceId: string,
    ): Promise<INotebookSdk | undefined> {
        const service = (this.#services.get(uri) ?? []).find((candidate) => {
            return candidate.id === serviceId;
        });
        if (service === undefined) {
            throw new Error(`There is no REST service ${serviceId} on ${uri}.`);
        }

        await this.deps.query(uri, useServiceSql(service.full_service_path));

        return this.refresh(uri);
    }

    /**
     * Asks the user for what a login lacks: the authentication app where
     * the cell named none and the service has several, the user, and the
     * password, always.
     *
     * @param uri The connection.
     * @param request What the cell named.
     *
     * @returns The login; none where the user cancelled.
     */
    public async askLogin(
        uri: string,
        request: ILoginRequest,
    ): Promise<ILogin | undefined> {
        const url = typeof request.serviceUrl === "string"
            ? request.serviceUrl
            : "the REST service";
        let app = typeof request.app === "string" ? request.app : undefined;
        if (app === undefined) {
            const apps = sdkServiceOf(this.#services.get(uri) ?? [])
                ?.auth_apps ?? [];
            app = apps.length === 1
                ? apps[0]
                : apps.length > 1
                    ? await vscode.window.showQuickPick(apps,
                        { title: `Log in to ${url}: the authentication app` })
                    : await vscode.window.showInputBox(
                        { title: `Log in to ${url}`, prompt: "Authentication app" });
        }
        if (app === undefined) {
            return undefined;
        }

        const username = typeof request.username === "string"
            ? request.username
            : await vscode.window.showInputBox(
                { title: `Log in to ${url} (${app})`, prompt: "User name" });
        if (username === undefined) {
            return undefined;
        }

        const password = await vscode.window.showInputBox({
            title: `Log in to ${url} as ${username}`,
            prompt: "Password",
            password: true,
        });

        return password === undefined ? undefined : { app, username, password };
    }

    /**
     * @param uri The connection.
     *
     * @returns Its SDK, as built now.
     */
    async #build(uri: string): Promise<INotebookSdk | undefined> {
        let services: IMrsService[];
        try {
            const [row] = await this.deps.query(uri,
                "SHOW REST SERVICES FORMAT=JSON");
            services = row === undefined
                ? []
                : parseCell<IMrsService[]>(Object.values(row)[0]) ?? [];
        } catch (error) {
            // No REST metadata on this server: no SDK to have.
            this.deps.log(`No REST SDK for ${uri}: ${errorText(error)}`);

            return undefined;
        }
        this.#services.set(uri, services);

        const service = sdkServiceOf(services);
        if (service === undefined && services.length > 0) {
            this.deps.log(`No REST SDK for ${uri}: ${services.length} REST `
                + "services, and none of them current.");

            return undefined;
        }

        // What does not wait on another is asked for together.
        const [connectionId, tools, daemon, certificateAuthority] =
            await Promise.all([
                this.deps.connect(uri),
                this.deps.tools(),
                service === undefined
                    ? undefined
                    : this.deps.restdUrl(uri),
                this.deps.certificateAuthority(),
            ]);
        this.#base ??= tools.getSdkBaseClasses();
        this.#base.catch(() => { this.#base = undefined; });
        const [base, code] = await Promise.all([
            this.#base,
            service === undefined
                ? tools.getRuntimeManagementCode(connectionId)
                : tools.getSdkServiceClasses(connectionId, service.id,
                    daemon === undefined
                        ? undefined
                        : `${daemon}${service.full_service_path}`),
        ]);

        const sourceCode = `${base}\n${code}`;
        const sdk: INotebookSdk = {
            version: createHash("sha256").update(sourceCode).digest("hex")
                .slice(0, 16),
            code: sourceCode,
            ...certificateAuthority === undefined
                ? {} : { certificateAuthority },
        };
        this.deps.publishTypings(sdk);

        return sdk;
    }
}

/** The TypeScript server plugin's id, as `contributes` names it. */
const TS_PLUGIN = "mariadb-notebook-ts-plugin";

/**
 * Hands an SDK's source to the TypeScript server plugin, for the cells'
 * completion and hover: written to a file of the extension's own, which
 * the plugin adds to the cells' project. The last SDK built is the one the
 * editor knows - one at a time, as the cells of a folder share a project -
 * so an SDK's file is written once, and the ones before it are deleted.
 *
 * @param folder Where the file is written.
 * @param sdk The SDK.
 * @param log Where a failure is noted.
 *
 * @returns Once the plugin is told.
 */
export const publishSdkTypings = async (
    folder: vscode.Uri,
    sdk: INotebookSdk,
    log: (message: string) => void,
): Promise<void> => {
    try {
        const name = `mrs-sdk-${sdk.version}.ts`;
        const file = path.join(folder.fsPath, name);
        await fs.promises.mkdir(folder.fsPath, { recursive: true });
        const present = await fs.promises.readdir(folder.fsPath);
        await Promise.all(present.filter((each) => {
            return /^mrs-sdk-.*\.ts$/.test(each) && each !== name;
        }).map((stale) => {
            return fs.promises.rm(path.join(folder.fsPath, stale),
                { force: true });
        }));
        if (!present.includes(name)) {
            await fs.promises.writeFile(file, sdk.code);
        }

        const typescript = vscode.extensions.getExtension<{
            getAPI(version: 0): {
                configurePlugin(id: string, configuration: unknown): void;
            } | undefined;
        }>("vscode.typescript-language-features");
        const api = (await typescript?.activate())?.getAPI(0);
        api?.configurePlugin(TS_PLUGIN, { sdkFile: file });
    } catch (error) {
        log(`Could not hand the REST SDK to the editor: ${errorText(error)}`);
    }
};
