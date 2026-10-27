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

import * as vscode from "vscode";

import { DialogPanel } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import { DEPLOYMENT_TYPES, isAvailable } from "./deploymentChoices.js";
import type {
    DeploymentHostMessage,
    DeploymentWebviewMessage,
} from "./deploymentProtocol.js";

/** What the wizard hands on to, so a test can supply its own. */
export interface IDeploymentWizardHost {
    /** Opens the New Sandbox dialog, which deploys the sandbox. */
    newSandbox(): void;
    log(message: string): void;
}

/** The view type the panel is registered under. */
export const DEPLOYMENT_WIZARD_VIEW_TYPE = "mariadb.deploymentWizard";

/** The dialog's title, on the tab and in the document. */
const TITLE = "New Deployment";

/**
 * The New Deployment wizard: what to do, and what to deploy. Its pages
 * are the webview's; once they lead somewhere, the wizard closes and the
 * dialog for that kind of deployment takes over.
 *
 * One at a time: asking again reveals the one that is up.
 */
export class DeploymentWizardPanel
    extends DialogPanel<DeploymentHostMessage, DeploymentWebviewMessage> {
    static #current: DeploymentWizardPanel | undefined;

    private constructor(
        extensionUri: vscode.Uri,
        private readonly host: IDeploymentWizardHost,
    ) {
        super(DEPLOYMENT_WIZARD_VIEW_TYPE, TITLE, extensionUri);
        this.panel.webview.html = buildWebviewHtml(this.panel.webview,
            extensionUri, "deployment", TITLE);
    }

    /**
     * Shows the wizard.
     *
     * @param extensionUri The root of the installed extension.
     * @param host What the wizard hands on to.
     *
     * @returns Nothing.
     */
    public static show(
        extensionUri: vscode.Uri,
        host: IDeploymentWizardHost,
    ): void {
        if (DeploymentWizardPanel.#current) {
            DeploymentWizardPanel.#current.panel.reveal(
                vscode.ViewColumn.Active);

            return;
        }

        DeploymentWizardPanel.#current =
            new DeploymentWizardPanel(extensionUri, host);
    }

    /**
     * Closes the wizard, if one is open. Used when the extension shuts down.
     *
     * @returns Nothing.
     */
    public static disposeCurrent(): void {
        DeploymentWizardPanel.#current?.close();
    }

    protected onDisposed(): void {
        DeploymentWizardPanel.#current = undefined;
    }

    /**
     * Handles one message from the webview.
     *
     * @param message The message that arrived.
     *
     * @returns Nothing.
     */
    protected onMessage(message: DeploymentWebviewMessage): Promise<void> {
        switch (message.type) {
            case "new": {
                // The webview offers only what is available; checked again
                // here, as every dialog's host does.
                if (!isAvailable(DEPLOYMENT_TYPES, message.deploymentType)) {
                    this.host.log("A new deployment of type "
                        + `'${message.deploymentType}' is not available yet.`);
                    break;
                }

                // Closed first: the next dialog opens in the same column,
                // in its place.
                this.close();
                this.host.newSandbox();
                break;
            }

            default: {
                this.close();
            }
        }

        return Promise.resolve();
    }
}
