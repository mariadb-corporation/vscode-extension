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

import { beforeEach, describe, expect, it } from "vitest";

import {
    type INotebookSdkDependencies,
    NotebookSdk,
    publishSdkTypings,
    sdkServiceOf,
} from "../../notebook/notebookSdk.js";
import type { INotebookSdk } from "../../notebook/scriptProtocol.js";
import type { IMrsService } from "../../mrs/mrsTypes.js";
import {
    files,
    inputBoxAnswers,
    inputBoxCalls,
    mockExtensions,
    quickPickAnswers,
    resetVscodeMock,
    Uri,
} from "../mocks/vscode.js";

const URI = "root@127.0.0.1:3311";

/**
 * @param fields What differs from a current service.
 *
 * @returns A REST service, as SHOW REST SERVICES FORMAT=JSON has it.
 */
const service = (fields: Partial<IMrsService> = {}): IMrsService => {
    return {
        id: "service-1",
        full_service_path: "/myService/v1",
        url_context_root: "/myService/v1",
        auth_apps: ["MRS"],
        is_current: true,
        ...fields,
    } as IMrsService;
};

/**
 * @param services The connection's REST services; an error where it has
 *                 no REST metadata.
 *
 * @returns Its SDK's builder, and what it was asked.
 */
const createSdk = (services: IMrsService[] | Error = [service()]) => {
    const calls: string[] = [];
    const published: INotebookSdk[] = [];
    const deps: INotebookSdkDependencies = {
        connect: () => { return Promise.resolve("uuid-1"); },
        query: (_uri, sql) => {
            calls.push(sql);
            if (services instanceof Error) {
                return Promise.reject(services);
            }

            return Promise.resolve(sql.startsWith("SHOW")
                ? [{ "REST SERVICES": JSON.stringify(services) }]
                : []);
        },
        tools: () => {
            return Promise.resolve({
                getSdkBaseClasses: () => {
                    calls.push("base");

                    return Promise.resolve("class MrsBaseService {}");
                },
                getSdkServiceClasses: (_id, serviceId, serviceUrl) => {
                    calls.push(`service ${String(serviceId)} ${String(serviceUrl)}`);

                    return Promise.resolve("const myServiceV1 = 1;");
                },
                getRuntimeManagementCode: () => {
                    calls.push("management");

                    return Promise.resolve("const mrs = 1;");
                },
            });
        },
        restdUrl: () => { return Promise.resolve("https://localhost:8443"); },
        certificateAuthority: () => { return Promise.resolve("PEM"); },
        publishTypings: (sdk) => { published.push(sdk); },
        log: () => { /* quiet */ },
    };

    return { sdk: new NotebookSdk(deps), calls, published };
};

describe("NotebookSdk", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("picks the current service, else the only one", () => {
        const current = service({ id: "b", is_current: true });
        const other = service({ id: "a", is_current: false });

        expect(sdkServiceOf([other, current])).toBe(current);
        expect(sdkServiceOf([other])).toBe(other);
        expect(sdkServiceOf([other, { ...other, id: "c" }])).toBeUndefined();
    });

    it("builds the service's SDK through its daemon, once", async () => {
        const { sdk, calls, published } = createSdk();

        const built = await sdk.forConnection(URI);
        await sdk.forConnection(URI);

        expect(built).toMatchObject({
            code: "class MrsBaseService {}\nconst myServiceV1 = 1;",
            certificateAuthority: "PEM",
        });
        expect(built?.version).toMatch(/^[0-9a-f]{16}$/);
        expect(calls).toEqual(["SHOW REST SERVICES FORMAT=JSON", "base",
            "service service-1 https://localhost:8443/myService/v1"]);
        expect(published).toEqual([built]);
    });

    it("builds it again once let go of, the base classes kept", async () => {
        const { sdk, calls } = createSdk();
        await sdk.forConnection(URI);

        sdk.invalidate(URI);
        await sdk.forConnection(URI);
        await sdk.refresh(URI);

        expect(calls.filter((call) => { return call === "base"; }))
            .toHaveLength(1);
        expect(calls.filter((call) => { return call.startsWith("service"); }))
            .toHaveLength(3);
    });

    it("has the management code with no service, nothing with several",
        async () => {
            const none = createSdk([]);
            expect((await none.sdk.forConnection(URI))?.code)
                .toBe("class MrsBaseService {}\nconst mrs = 1;");

            const several = createSdk([service({ id: "a", is_current: false }),
                service({ id: "b", is_current: false })]);
            expect(await several.sdk.forConnection(URI)).toBeUndefined();

            const noMetadata = createSdk(new Error("No REST metadata."));
            expect(await noMetadata.sdk.forConnection(URI)).toBeUndefined();
        });

    it("makes a service current, and builds its SDK", async () => {
        const other = service({ id: "other", full_service_path: "/other",
            is_current: false });
        const { sdk, calls } = createSdk([service(), other]);
        await sdk.forConnection(URI);

        await sdk.setCurrentService(URI, "other");

        expect(calls).toContain("USE REST SERVICE /other;");
        await expect(sdk.setCurrentService(URI, "nowhere"))
            .rejects.toThrow(/no REST service nowhere/);
    });

    it("asks for what a login lacks, the password always", async () => {
        const { sdk } = createSdk();
        await sdk.forConnection(URI);

        inputBoxAnswers.push("jane", "secret");
        await expect(sdk.askLogin(URI, { serviceUrl: "https://s" }))
            .resolves.toEqual({ app: "MRS", username: "jane", password: "secret" });
        expect(inputBoxCalls.map((call) => { return call.prompt; }))
            .toEqual(["User name", "Password"]);

        inputBoxAnswers.push(undefined);
        await expect(sdk.askLogin(URI, { app: "MRS", username: "jane" }))
            .resolves.toBeUndefined();
    });

    it("lets the user pick among a service's authentication apps", async () => {
        const { sdk } = createSdk([service({ auth_apps: ["MRS", "Google"] })]);
        await sdk.forConnection(URI);

        quickPickAnswers.push("Google");
        inputBoxAnswers.push("secret");
        await expect(sdk.askLogin(URI, { username: "jane" })).resolves
            .toEqual({ app: "Google", username: "jane", password: "secret" });
    });
});

describe("publishSdkTypings", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("writes the SDK, and names it to the TypeScript plugin", async () => {
        const configured: unknown[] = [];
        mockExtensions.set("vscode.typescript-language-features", {
            activate: () => {
                return Promise.resolve({
                    getAPI: () => {
                        return {
                            configurePlugin: (id: string, config: unknown) => {
                                configured.push([id, config]);
                            },
                        };
                    },
                });
            },
        });

        await publishSdkTypings(Uri.file("/storage/notebook-sdk") as never,
            { version: "abc", code: "class A {}" }, () => { /* quiet */ });

        expect(new TextDecoder().decode(
            files.get("/storage/notebook-sdk/mrs-sdk-abc.ts"))).toBe("class A {}");
        expect(configured).toEqual([["mariadb-notebook-ts-plugin",
            { sdkFile: "/storage/notebook-sdk/mrs-sdk-abc.ts" }]]);
    });

    it("logs where there is no TypeScript extension to tell", async () => {
        const logged: string[] = [];

        await publishSdkTypings(Uri.file("/storage") as never,
            { version: "abc", code: "" }, (message) => { logged.push(message); });

        expect(logged).toEqual([]);
    });
});
