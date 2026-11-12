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

import type { IObjectPlace } from "./dataMapping.js";
import type { IMrsScope, MrsApi } from "./mrsApi.js";
import { samePath } from "./restSql.js";
import type { IDbObject } from "./mrsDialogs.js";
import type {
    IMrsColumns,
    IMrsObject,
    IMrsSchema,
    IMrsService,
} from "./mrsTypes.js";

/**
 * Where the REST dialogs read what they offer and put what they save: a
 * server's REST metadata, or an MSM project, whose REST statements are
 * kept in its development script and whose database objects are those the
 * script defines. The dialogs and the commands opening them are the same
 * for both.
 */
export interface IRestSource {
    /**
     * Whether what is saved is kept in a script that is run again and
     * again, instead of being run now: the statements are then the forms a
     * second run takes.
     */
    readonly forScript: boolean;
    /**
     * @param servicePath A service; left out for every auth app.
     *
     * @returns The names of the auth apps, or of those linked to the
     *          service.
     */
    authApps(servicePath?: string): Promise<string[]>;
    services(): Promise<IMrsService[]>;
    schemas(servicePath: string): Promise<IMrsSchema[]>;
    /** @returns A service as it is stored, for its dialog to edit. */
    service(servicePath: string): Promise<IMrsService>;
    /** @returns A REST schema as it is stored, for its dialog to edit. */
    schema(servicePath: string, schemaPath: string): Promise<IMrsSchema>;
    /**
     * @returns A REST object as it is stored, its data mappings with it.
     */
    object(objectType: string, servicePath: string, schemaPath: string,
        requestPath: string): Promise<IMrsObject>;
    /** @returns A REST schema's objects, as a list reports them. */
    objects(servicePath: string, schemaPath: string): Promise<IMrsObject[]>;
    /**
     * @returns A database schema's tables, views, procedures and
     *          functions.
     */
    dbObjects(dbSchema: string): Promise<IDbObject[]>;
    /**
     * @returns A database object's columns and references, or a routine's
     *          parameters.
     */
    columns(objectType: string, schema: string,
        name: string): Promise<IMrsColumns>;
    /** @returns {@link columns} of each object, in their order. */
    columnsOfEach(objects: ReadonlyArray<{
        objectType: string;
        schema: string;
        name: string;
    }>): Promise<IMrsColumns[]>;
    /**
     * Runs the statements, or keeps them in the script.
     *
     * @param statements The statements.
     * @param replaces The REST object an edit saves, where it was: in a
     *        script, its statement is where the new one goes, though the
     *        new one names another path (a server's ALTER says it).
     */
    run(statements: string[], replaces?: IObjectPlace): Promise<void>;
    /** Shows what a save changed: the tree is drawn again. */
    saved(): void;
    /** Brings up where a failed save is shown. */
    failed(): void;
}

/**
 * @param items What a server or a project has.
 * @param matches Which one is wanted.
 * @param what What it is, to say it is gone.
 *
 * @returns The one wanted.
 *
 * @throws Error where there is none.
 */
export const found = <T>(
    items: T[],
    matches: (item: T) => boolean,
    what: string,
): T => {
    const item = items.find(matches);
    if (item === undefined) {
        throw new Error(`There is no ${what} any more.`);
    }

    return item;
};

/**
 * @param api The REST SQL calls.
 * @param scope An open connection, and the REST metadata schema on it.
 * @param shows What shows a save and a failure.
 * @param shows.saved Draws the tree again.
 * @param shows.failed Brings up the connection's Actions.
 *
 * @returns The REST metadata of a server as a source.
 */
export const liveRestSource = (
    api: MrsApi,
    scope: IMrsScope,
    shows: Pick<IRestSource, "saved" | "failed">,
): IRestSource => {
    return {
        forScript: false,
        authApps: async (servicePath) => {
            return (await api.authApps(scope, servicePath)).map((app) => {
                return app.name;
            });
        },
        services: () => { return api.services(scope); },
        schemas: (servicePath) => { return api.schemas(scope, servicePath); },
        service: async (servicePath) => {
            return found(await api.services(scope), (service) => {
                return samePath(service.full_service_path, servicePath);
            }, `REST service ${servicePath}`);
        },
        schema: async (servicePath, schemaPath) => {
            return found(await api.schemas(scope, servicePath), (schema) => {
                return samePath(schema.request_path, schemaPath);
            }, `REST schema ${servicePath}${schemaPath}`);
        },
        object: (objectType, servicePath, schemaPath, requestPath) => {
            return api.object(scope, objectType, servicePath, schemaPath,
                requestPath);
        },
        objects: (servicePath, schemaPath) => {
            return api.objects(scope, servicePath, schemaPath);
        },
        dbObjects: (dbSchema) => { return api.dbObjects(scope, dbSchema); },
        columns: (objectType, schema, name) => {
            return api.columns(scope, objectType, schema, name);
        },
        columnsOfEach: (objects) => {
            return api.columnsOfEach(scope, objects);
        },
        run: async (statements) => { await api.run(scope, statements); },
        ...shows,
    };
};
