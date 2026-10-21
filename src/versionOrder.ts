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
 * Ordering of `major.minor.patch` versions as numbers, so that `11.10` is
 * newer than `11.9`, which a comparison of the text would get backwards.
 * Free of `vscode`, so the webviews share it.
 */

/**
 * @param version `major.minor.patch`, a leading `v` allowed.
 *
 * @returns Its numbers; a part that is not one counts as 0.
 */
const versionNumbers = (version: string): number[] => {
    return version.trim().replace(/^v/, "").split(".").map((part) => {
        return Number(part) || 0;
    });
};

/**
 * @param a A version.
 * @param b Another.
 *
 * @returns Below zero where `a` is older, zero where they are the same,
 *          above zero where `a` is newer; a missing part counts as 0.
 */
export const compareVersions = (a: string, b: string): number => {
    const left = versionNumbers(a);
    const right = versionNumbers(b);
    for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
        const difference = (left[at] ?? 0) - (right[at] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
};

/**
 * Orders versions newest first.
 *
 * @param versions The versions, in any order.
 *
 * @returns A sorted copy.
 */
export const newestFirst = (versions: readonly string[]): string[] => {
    return [...versions].sort((a, b) => { return compareVersions(b, a); });
};
