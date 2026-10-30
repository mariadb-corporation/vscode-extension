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
import type { Plugin as PostCssPlugin, Rule } from "postcss";
import { defineConfig } from "vite";

/** The element the renderer draws a cell's result view in. */
const SCOPE = ":where(.mariadbResultView)";

/** The page-level selectors that stand for the view's own element here. */
const PAGE = /^(?:html|body|#root)(?=$|[\s.:#[>+~])/;

/**
 * Scopes one selector of the result view's stylesheet to the view: a rule
 * for the page applies to the view's element, anything else only inside
 * it. `:where()` adds no specificity, so the rules weigh against each
 * other - and against Tabulator's - exactly as they do in the panel.
 *
 * @param selector A selector of styles.css.
 *
 * @returns It, scoped.
 */
export const scopeSelector = (selector: string): string => {
    const trimmed = selector.trim();
    const page = PAGE.exec(trimmed);

    return page === null
        ? `${SCOPE} ${trimmed}`
        : `${SCOPE}${trimmed.slice(page[0].length)}`;
};

/**
 * @param rule A rule.
 *
 * @returns Whether it is one of styles.css's own, rather than one it
 *          imports (Tabulator's, the codicons') or a keyframe.
 */
const isViewRule = (rule: Rule): boolean => {
    const file = rule.source?.input.file ?? "";
    const parent = rule.parent;

    return /[\\/]webview[\\/]src[\\/]styles\.css$/.test(file)
        && !(parent?.type === "atrule"
            && /keyframes$/i.test((parent as { name: string }).name));
};

/** Scopes styles.css to the view, in this build only. */
const scopeResultView: PostCssPlugin = {
    postcssPlugin: "scope-result-view",
    Rule: (rule) => {
        if (isViewRule(rule) && !rule.selector.includes(SCOPE)) {
            rule.selectors = rule.selectors.map(scopeSelector);
        }
    },
};

/**
 * Builds the notebook renderer for a cell's result sets.
 *
 * Not a dialog build: VS Code imports the module and calls its `activate`
 * export, and an app build drops an entry's exports unless told to keep
 * them. Its stylesheet is a file beside it, which the renderer links from
 * its own URL, so the icons and the codicon font the stylesheet points at
 * resolve beside it too. It is the panel's stylesheet, scoped to the
 * element the view is drawn in: the output webview is VS Code's page.
 */
export default defineConfig({
    root: "webview",
    base: "./",
    plugins: [preact()],
    css: {
        postcss: { plugins: [scopeResultView] },
    },
    build: {
        outDir: "../dist/webview",
        // The result panel's build runs first and clears the directory.
        emptyOutDir: false,
        sourcemap: true,
        target: "es2022",
        assetsInlineLimit: 0,
        // One module, as VS Code imports it: the result view and the graphs'
        // part of d3 come to some 600 kB, and a chunk split off would rely
        // on the output page loading modules beside the renderer.
        chunkSizeWarningLimit: 700,
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
