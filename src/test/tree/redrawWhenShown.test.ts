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

import { redrawWhenShown } from "../../tree/redrawWhenShown.js";
import { EventEmitter } from "../mocks/vscode.js";

/** A view and its provider, the provider counting its redraws. */
const create = (): {
    view: { visible: boolean; show(visible: boolean): void };
    changed: EventEmitter<unknown>;
    refreshes: () => number;
    stop: () => void;
} => {
    const visibility = new EventEmitter<{ visible: boolean }>();
    const changed = new EventEmitter<unknown>();
    let refreshes = 0;
    const view = {
        visible: true,
        onDidChangeVisibility: visibility.event,
        show: (visible: boolean) => {
            view.visible = visible;
            visibility.fire({ visible });
        },
    };
    const stop = redrawWhenShown(view as never, {
        onDidChangeTreeData: changed.event,
        refresh: () => {
            refreshes += 1;
            changed.fire(undefined);
        },
    });

    return {
        view,
        changed,
        refreshes: () => { return refreshes; },
        stop: () => { stop.dispose(); },
    };
};

describe("redrawWhenShown", () => {
    it("redraws a view shown again after a change it missed, once", () => {
        const { view, changed, refreshes } = create();
        view.show(false);

        changed.fire(undefined);
        changed.fire(undefined);
        expect(refreshes()).toBe(0);

        view.show(true);
        expect(refreshes()).toBe(1);

        view.show(false);
        view.show(true);
        expect(refreshes()).toBe(1);
    });

    it("leaves a view alone that saw every change", () => {
        const { view, changed, refreshes } = create();

        changed.fire(undefined);
        view.show(false);
        view.show(true);

        expect(refreshes()).toBe(0);
    });

    it("stops when disposed", () => {
        const { view, changed, refreshes, stop } = create();
        view.show(false);
        changed.fire(undefined);

        stop();
        view.show(true);

        expect(refreshes()).toBe(0);
    });
});
