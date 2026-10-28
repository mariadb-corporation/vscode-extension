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

import { beforeEach, describe, expect, it } from "vitest";

import {
    DEPLOYMENT_STARTS,
    DEPLOYMENT_TYPES,
    isAvailable,
} from "../../deployments/deploymentChoices.js";
import type { DeploymentWebviewMessage }
    from "../../deployments/deploymentProtocol.js";
import {
    DeploymentWizardPanel,
    DEPLOYMENT_WIZARD_VIEW_TYPE,
    type IDeploymentWizardHost,
} from "../../deployments/deploymentWizardPanel.js";
import {
    resetVscodeMock,
    Uri,
    webviewPanels,
    type MockWebviewPanel,
} from "../mocks/vscode.js";

const extensionUri = Uri.file("/ext");

const currentPanel = (): MockWebviewPanel => {
    return webviewPanels[webviewPanels.length - 1]!;
};

const receive = async (message: DeploymentWebviewMessage): Promise<void> => {
    currentPanel().webview.receive(message);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
};

describe("deploymentChoices", () => {
    it("offers creating a sandbox, and the rest as not available yet", () => {
        expect(isAvailable(DEPLOYMENT_STARTS, "new")).toBe(true);
        expect(isAvailable(DEPLOYMENT_STARTS, "import")).toBe(false);
        expect(DEPLOYMENT_TYPES.map((choice) => {
            return [choice.value, choice.available];
        })).toEqual([
            ["sandbox", true], ["standalone", false], ["cluster", false],
        ]);
    });
});

describe("DeploymentWizardPanel", () => {
    let host: IDeploymentWizardHost & { sandboxes: number; logs: string[] };

    beforeEach(() => {
        DeploymentWizardPanel.disposeCurrent();
        resetVscodeMock();
        host = {
            sandboxes: 0,
            logs: [],
            newSandbox: () => { host.sandboxes += 1; },
            log: (message) => { host.logs.push(message); },
        };
    });

    it("loads its own bundle, one wizard at a time", () => {
        DeploymentWizardPanel.show(extensionUri as never, host);
        DeploymentWizardPanel.show(extensionUri as never, host);

        expect(webviewPanels).toHaveLength(1);
        expect(currentPanel().viewType).toBe(DEPLOYMENT_WIZARD_VIEW_TYPE);
        expect(currentPanel().title).toBe("New Deployment");
        expect(currentPanel().revealed).toBe(1);
        expect(currentPanel().webview.html)
            .toContain("/ext/dist/webview/deployment.js");
    });

    it("hands a new sandbox on to New Sandbox, closing itself", async () => {
        DeploymentWizardPanel.show(extensionUri as never, host);

        await receive({ type: "new", deploymentType: "sandbox" });

        expect(currentPanel().disposed).toBe(true);
        expect(host.sandboxes).toBe(1);
    });

    it("refuses a deployment type that is not available yet", async () => {
        DeploymentWizardPanel.show(extensionUri as never, host);

        await receive({ type: "new", deploymentType: "cluster" });

        expect(currentPanel().disposed).toBe(false);
        expect(host.sandboxes).toBe(0);
        expect(host.logs).toEqual(
            ["A new deployment of type 'cluster' is not available yet."]);
    });

    it("closes on Cancel", async () => {
        DeploymentWizardPanel.show(extensionUri as never, host);

        await receive({ type: "cancel" });

        expect(currentPanel().disposed).toBe(true);
        expect(host.sandboxes).toBe(0);
    });
});
