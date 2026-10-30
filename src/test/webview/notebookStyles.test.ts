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

import { describe, expect, it } from "vitest";

import { scopeSelector } from "../../../vite.notebook.config.js";

describe("the notebook renderer's stylesheet", () => {
    it("puts the page's rules on the view, and the rest inside it", () => {
        const scope = ":where(.mariadbResultView)";

        expect(scopeSelector("html")).toBe(scope);
        expect(scopeSelector("body")).toBe(scope);
        expect(scopeSelector(" #root")).toBe(scope);
        expect(scopeSelector("body.vscode-light .tab"))
            .toBe(`${scope}.vscode-light .tab`);
        expect(scopeSelector("*")).toBe(`${scope} *`);
        expect(scopeSelector("button:hover:not(:disabled)"))
            .toBe(`${scope} button:hover:not(:disabled)`);
        expect(scopeSelector(".panel")).toBe(`${scope} .panel`);
        // Not a page selector, only one that starts with the same letters.
        expect(scopeSelector(".bodyText")).toBe(`${scope} .bodyText`);
        expect(scopeSelector("button-like")).toBe(`${scope} button-like`);
    });
});
