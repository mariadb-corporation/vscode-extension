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

import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * Builds a notebook's TypeScript worker thread, `dist/notebookWorker.js`:
 * a bundle of its own, so the TypeScript transpiler (sucrase) is loaded
 * only once a TypeScript cell runs, never at activation. A Node bundle
 * like the extension's, with the Node built-ins external.
 */
export default defineConfig({
    resolve: {
        conditions: ["node"],
    },
    build: {
        target: "node20",
        outDir: "dist",
        sourcemap: true,
        minify: false,
        // The extension's build writes into dist too.
        emptyOutDir: false,
        lib: {
            entry: "src/notebook/scriptWorker.ts",
            formats: ["cjs"],
            fileName: () => "notebookWorker.js",
        },
        rollupOptions: {
            external: [
                ...builtinModules,
                ...builtinModules.map((name) => `node:${name}`),
            ],
            output: {
                interop: "auto",
            },
        },
    },
});
