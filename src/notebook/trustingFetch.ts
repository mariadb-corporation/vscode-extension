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
 * A `fetch` that reaches the REST Daemons on this machine: their HTTPS
 * certificates are signed by the shell's local certificate authority,
 * which Node's `fetch` does not know - it trusts its own roots, not the
 * system's store, so a certificate trusted there is still refused. HTTPS
 * to a loopback address is made with Node's `https`, that authority's
 * certificate trusted beside the usual roots; everything else is Node's
 * `fetch` as it is. Free of `vscode`: it runs in a notebook's worker.
 */

import * as https from "node:https";
import * as tls from "node:tls";

/** The hosts a REST Daemon of this machine is reached at. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The statuses a response has no body for. */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * @param certificateAuthority The local authority's certificate, PEM.
 * @param base The `fetch` for everything else.
 *
 * @returns The `fetch`.
 */
export const trustingFetch = (
    certificateAuthority: string,
    base: typeof fetch = fetch,
): typeof fetch => {
    const ca = [...tls.rootCertificates, certificateAuthority];

    return async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.protocol !== "https:" || !LOOPBACK.has(url.hostname)) {
            return base(input, init);
        }

        const body = request.method === "GET" || request.method === "HEAD"
            ? undefined
            : Buffer.from(await request.arrayBuffer());

        return new Promise<Response>((resolve, reject) => {
            const outgoing = https.request(url, {
                method: request.method,
                headers: Object.fromEntries(request.headers),
                ca,
                signal: request.signal,
            }, (incoming) => {
                const chunks: Buffer[] = [];
                incoming.on("data", (chunk: Buffer) => { chunks.push(chunk); });
                incoming.on("error", reject);
                incoming.on("end", () => {
                    const headers = new Headers();
                    for (const [name, value] of Object.entries(incoming.headers)) {
                        for (const each of [value ?? []].flat()) {
                            headers.append(name, each);
                        }
                    }
                    const status = incoming.statusCode ?? 0;
                    resolve(new Response(NO_BODY.has(status)
                        ? null
                        : Buffer.concat(chunks), {
                        status,
                        statusText: incoming.statusMessage,
                        headers,
                    }));
                });
            });
            outgoing.on("error", reject);
            outgoing.end(body);
        });
    };
};
