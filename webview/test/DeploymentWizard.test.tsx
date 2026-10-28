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

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { posted } from "./setup.js";
import { DeploymentWizard } from "../src/DeploymentWizard.js";

let host: HTMLDivElement;

const mount = async (): Promise<void> => {
    await act(async () => {
        render(<DeploymentWizard />, host);
        await Promise.resolve();
    });
};

const button = (label: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll("button")].find((node) => {
        return (node.textContent ?? "").trim() === label;
    });
    if (!found) {
        throw new Error(`No button '${label}'.`);
    }

    return found;
};

const click = async (label: string): Promise<void> => {
    await act(async () => {
        button(label).click();
        await Promise.resolve();
    });
};

/** @returns The page's options: value, whether picked, whether enabled. */
const options = (): Array<[string, boolean, boolean]> => {
    return [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")]
        .map((input) => {
            return [input.value, input.checked, !input.disabled];
        });
};

beforeEach(() => {
    posted.length = 0;
    host = document.createElement("div");
    document.body.append(host);
});

afterEach(() => {
    render(null, host);
    host.remove();
});

describe("DeploymentWizard", () => {
    it("starts on creating a new deployment, import not available yet",
        async () => {
            await mount();

            expect(host.querySelector("h2")?.textContent)
                .toBe("What would you like to do?");
            expect(options()).toEqual([
                ["new", true, true],
                ["import", false, false],
            ]);
            expect(button("Back").disabled).toBe(true);
            expect([...host.querySelectorAll(".wizard-steps li")]
                .map((step) => { return step.textContent?.trim(); }))
                .toEqual(["Start", "Deployment Type", "Deploy"]);
            expect(host.textContent).toContain("Not available yet");
        });

    it("goes on to the type, and hands a sandbox on to the host",
        async () => {
            await mount();

            await click("Next");

            expect(host.querySelector("h2")?.textContent)
                .toBe("Which kind of deployment?");
            expect(options()).toEqual([
                ["sandbox", true, true],
                ["standalone", false, false],
                ["cluster", false, false],
            ]);
            expect([...host.querySelectorAll(".wizard-choice > span:first-of-type")]
                .map((icon) => { return icon.className; })).toEqual([
                "codicon codicon-vm",
                "wizard-image wizard-image-standalone",
                "wizard-image wizard-image-cluster",
            ]);
            expect(posted).toEqual([]);

            await click("Next");

            expect(posted).toEqual(
                [{ type: "new", deploymentType: "sandbox" }]);
        });

    it("goes back to the first page", async () => {
        await mount();
        await click("Next");

        await click("Back");

        expect(host.querySelector("h2")?.textContent)
            .toBe("What would you like to do?");
    });

    it("asks to close on Cancel", async () => {
        await mount();

        await click("Cancel");

        expect(posted).toEqual([{ type: "cancel" }]);
    });
});
