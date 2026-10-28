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

import {
    VendorDecorations,
    VendorsTreeProvider,
    VENDOR_SCHEME,
} from "../../tree/vendorsTreeProvider.js";
import { ThemeColor, ThemeIcon, Uri } from "../mocks/vscode.js";

describe("VendorsTreeProvider", () => {
    const provider = new VendorsTreeProvider();

    it("lists the vendors", () => {
        const vendors = provider.getChildren();

        expect(vendors.map((vendor) => { return vendor.label; })).toEqual([
            "Local Container", "Proxmox", "MariaDB Cloud", "AWS", "Hetzner",
            "Scaleway", "STACKIT", "UpCloud",
        ]);
        expect(provider.getChildren(vendors[0])).toEqual([]);
    });

    it("draws one not configured grayed out", () => {
        const item = provider.getTreeItem(provider.getChildren()[3]!);

        expect(item.label).toBe("AWS");
        expect(item.description).toBe("not configured");
        expect((item.iconPath as ThemeIcon).color)
            .toEqual(new ThemeColor("disabledForeground"));
        expect(item.resourceUri?.scheme).toBe(VENDOR_SCHEME);
        expect(new VendorDecorations().provideFileDecoration(
            item.resourceUri as never)?.color)
            .toEqual(new ThemeColor("disabledForeground"));
    });

    it("leaves other rows' decorations alone", () => {
        expect(new VendorDecorations().provideFileDecoration(
            Uri.file("/a") as never)).toBeUndefined();
    });
});
