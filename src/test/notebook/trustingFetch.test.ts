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

import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked `https.request` was asked, and what it answers. */
const https = vi.hoisted(() => {
    return {
        requests: [] as Array<{ url: URL; options: Record<string, unknown>;
            body?: Buffer }>,
        status: 200,
        headers: {
            "content-type": "application/json",
            "set-cookie": ["a", "b"],
        } as Record<string, string | string[]>,
        body: "{\"ok\":true}",
        agent: undefined as unknown,
        agentOptions: undefined as unknown,
    };
});

vi.mock("node:https", () => {
    return {
        Agent: class {
            public constructor(public readonly options: unknown) {
                https.agent = this;
                https.agentOptions = options;
            }
        },
        request: (url: URL, options: Record<string, unknown>,
            respond: (incoming: EventEmitter) => void) => {
            const entry: { url: URL; options: Record<string, unknown>;
                body?: Buffer } = { url, options };
            https.requests.push(entry);
            const outgoing = new EventEmitter() as EventEmitter & {
                end(body?: Buffer): void;
            };
            outgoing.end = (body) => {
                entry.body = body;
                const incoming = Object.assign(new EventEmitter(), {
                    statusCode: https.status,
                    statusMessage: "OK",
                    headers: https.headers,
                });
                respond(incoming);
                incoming.emit("data", Buffer.from(https.body));
                incoming.emit("end");
            };

            return outgoing;
        },
    };
});

const { trustingFetch } = await import("../../notebook/trustingFetch.js");

describe("trustingFetch", () => {
    beforeEach(() => {
        https.requests.length = 0;
        https.status = 200;
    });

    it("reaches a daemon of this machine trusting the local authority",
        async () => {
            const fetchWith = trustingFetch("LOCAL CA", () => {
                throw new Error("not this way");
            });

            const response = await fetchWith(
                "https://localhost:8443/myService/v1/items", {
                    method: "POST",
                    headers: { Authorization: "Bearer t" },
                    body: "{\"a\":1}",
                });

            expect(await response.json()).toEqual({ ok: true });
            expect(response.headers.get("set-cookie")).toBe("a, b");
            const [request] = https.requests;
            expect(request.url.href)
                .toBe("https://localhost:8443/myService/v1/items");
            expect(request.options.method).toBe("POST");
            expect(request.options.headers).toMatchObject(
                { authorization: "Bearer t" });
            expect(request.options.agent).toBe(https.agent);
            expect(https.agentOptions).toEqual(
                { ca: "LOCAL CA", keepAlive: true });
            expect(request.body?.toString()).toBe("{\"a\":1}");
        });

    it("answers a bodiless status without a body", async () => {
        https.status = 204;
        const response = await trustingFetch("CA")(
            "https://127.0.0.1:8443/x", { method: "DELETE" });

        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
    });

    it("leaves everything else to fetch as it is", async () => {
        const seen: string[] = [];
        const fetchWith = trustingFetch("CA", (input) => {
            seen.push(String(input));

            return Promise.resolve(new Response("plain"));
        });

        await fetchWith("https://example.com/x");
        await fetchWith("http://localhost:8080/x");

        expect(seen).toEqual(["https://example.com/x", "http://localhost:8080/x"]);
        expect(https.requests).toEqual([]);
    });
});
