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

import type { IBusyMessage, ICancelMessage } from "../webview/dialogProtocol.js";
import type { DeploymentType } from "./deploymentChoices.js";

/**
 * What the New Deployment wizard's webview and its host say to each
 * other. The pages are the webview's own; the host hears only where they
 * led.
 */

export type DeploymentHostMessage = IBusyMessage;

/** Go on with a new deployment of this type, in the dialog it has. */
export interface IDeploymentNewMessage {
    type: "new";
    deploymentType: DeploymentType;
}

export type DeploymentWebviewMessage =
    | IDeploymentNewMessage
    | ICancelMessage;
