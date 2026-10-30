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

import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

/**
 * Builds the notebook renderer for result sets.
 *
 * Not a dialog build: VS Code imports the module and calls its `activate`
 * export, and an app build drops an entry's exports unless told to keep
 * them. Its stylesheet is a file beside it, which the renderer links from
 * its own URL, so the icons and the codicon font the stylesheet points at
 * resolve beside it too.
 */
export default defineConfig({
    root: "webview",
    base: "./",
    plugins: [preact()],
    build: {
        outDir: "../dist/webview",
        // The result panel's build runs first and clears the directory.
        emptyOutDir: false,
        sourcemap: true,
        target: "es2022",
        assetsInlineLimit: 0,
        rollupOptions: {
            input: "webview/src/notebookRenderer.tsx",
            preserveEntrySignatures: "exports-only",
            output: {
                entryFileNames: "notebookRenderer.js",
                assetFileNames: (asset) => {
                    return asset.names?.[0]?.endsWith(".css") ?? false
                        ? "notebookRenderer.css"
                        : "notebook/[name][extname]";
                },
                format: "es",
            },
        },
    },
});
