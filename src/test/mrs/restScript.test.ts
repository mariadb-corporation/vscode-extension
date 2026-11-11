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
    parseRestScript,
    restSectionEdit,
    restSectionOf,
    scriptObjects,
    scriptSchemas,
    scriptServices,
    sectionSpan,
    withRestStatements,
} from "../../mrs/restScript.js";

const SERVICE = `CREATE REST SERVICE IF NOT EXISTS /myService/v1
    ENABLED
    PUBLISHED
    COMMENT 'it''s; here'
    OPTIONS {
        "note": "DISABLED; PRIVATE"
    }
    ADD AUTH APP 'MRS';`;

const SCHEMA = `CREATE OR REPLACE REST SCHEMA /shop ON SERVICE /myService/v1 FROM \`shop\`
    PRIVATE
    AUTHENTICATION NOT REQUIRED;`;

const VIEW = `CREATE OR REPLACE REST VIEW /item
    ON SERVICE /myService/v1 SCHEMA /shop
    AS \`shop\`.\`item\` CLASS \`MyServiceV1ShopItem\` {
        id: id @SORTABLE @KEY,
        disabled: disabled
    }
    AUTHENTICATION REQUIRED;`;

const BODY = `
-- Create a REST service, schema and endpoints

${SERVICE}

-- The shop
${SCHEMA}

${VIEW}


`;

/** A development script with the sections around 180, as msm writes it. */
const script = (body: string): string => {
    const header = (id: string, title: string): string => {
        return `-- ${"#".repeat(77)}\n-- MSM Section ${id}: ${title}\n`
            + `-- ${"-".repeat(77)}\n-- What it is for\n`
            + `-- ${"#".repeat(77)}\n`;
    };

    return `${header("170", "Authorization")}\n-- Create ROLEs\n\n\n`
        + `${header("180", "REST Service Definition")}${body}`
        + `${header("190", "Removal of Helpers")}\n-- Drop helpers\n`;
};

describe("parseRestScript", () => {
    it("reads the services, schemas and objects a script creates", () => {
        const entries = parseRestScript(BODY);

        expect(entries.map((entry) => { return entry.kind; }))
            .toEqual(["service", "schema", "object"]);
        expect(scriptServices(entries)).toMatchObject([{
            full_service_path: "/myService/v1",
            url_context_root: "/myService/v1",
            enabled: 1, published: true, comments: "it's; here",
        }]);
        expect(scriptSchemas(entries, "/myService/v1")).toMatchObject([{
            request_path: "/shop", name: "shop", enabled: 2,
            requires_auth: false,
        }]);
        expect(scriptObjects(entries, "/myService/v1", "/shop"))
            .toMatchObject([{
                request_path: "/item", name: "item", schema_name: "shop",
                object_type: "VIEW", enabled: 1, requires_auth: true,
            }]);
    });

    it("starts a statement after the comments before it", () => {
        const [, schema] = parseRestScript(BODY);

        expect(BODY.slice(schema!.start, schema!.end)).toBe(SCHEMA);
    });

    it("reads quoted paths, developers, routines and the short forms", () => {
        const entries = parseRestScript([
            "CREATE REST SERVICE mike@`/my-service` DISABLED;",
            "create rest database `/1st` from `my shop`;",
            "CREATE REST DATA MAPPING VIEW `/it-em` AS `my shop`.`it.em`;",
            "CREATE REST PROCEDURE /tidy ON SERVICE mike@`/my-service` "
            + "SCHEMA `/1st` AS `my shop`.tidy PARAMETERS P { a: a @IN };",
            "CREATE OR REPLACE REST FUNCTION /total AS total;",
        ].join("\n"));

        expect(scriptServices(entries)).toMatchObject([{
            full_service_path: "mike@/my-service",
            url_context_root: "/my-service", enabled: 0,
        }]);
        expect(scriptSchemas(entries, "mike@/my-service")).toMatchObject([
            { request_path: "/1st", name: "my shop" }]);
        expect(scriptObjects(entries, "mike@/my-service", "/1st").map(
            (object) => {
                return [object.object_type, object.request_path,
                    object.schema_name, object.name];
            })).toEqual([
            ["VIEW", "/it-em", "my shop", "it.em"],
            ["PROCEDURE", "/tidy", "my shop", "tidy"],
            ["FUNCTION", "/total", "", "total"],
        ]);
    });

    it("leaves out what is no REST service, schema or object", () => {
        expect(parseRestScript([
            "-- CREATE REST SERVICE /commented;",
            "CREATE REST AUTH APP 'x' VENDOR MRS;",
            "CREATE TABLE t (id INT);",
            "ALTER REST SERVICE /a PUBLISHED;",
            "CREATE REST SCHEMA /orphan FROM `x`;",
        ].join("\n"))).toEqual([]);
    });
});

describe("withRestStatements", () => {
    it("puts a first statement after the section's comment, keeping the "
        + "blank lines before the next section", () => {
        expect(withRestStatements("\n-- Create a REST service\n\n\n",
            [SERVICE])).toBe(`\n-- Create a REST service\n\n${SERVICE}\n\n\n`);
        expect(withRestStatements("\n\n", [SERVICE])).toBe(`\n${SERVICE}\n\n`);
        expect(withRestStatements("", [SERVICE])).toBe(`\n${SERVICE}\n`);
    });

    it("adds what the script does not create yet last", () => {
        const procedure = "CREATE OR REPLACE REST PROCEDURE /tidy\n"
            + "    ON SERVICE /myService/v1 SCHEMA /shop\n"
            + "    AS `shop`.`tidy`;";
        const sql = withRestStatements(BODY, [procedure]);

        expect(sql).toBe(BODY.replace(`${VIEW}\n`,
            `${VIEW}\n\n${procedure}\n`));
        expect(parseRestScript(sql)).toHaveLength(4);
    });

    it("replaces a REST schema's or object's statement where it stands",
        () => {
            const changed = VIEW.replace("AUTHENTICATION REQUIRED",
                "AUTHENTICATION NOT REQUIRED").replace("/item", "/ITEM");
            const sql = withRestStatements(BODY, [changed]);

            expect(sql).toBe(BODY.replace(VIEW, changed));
            expect(parseRestScript(sql)).toHaveLength(3);
        });

    it("replaces a service's statement too, whatever its case and form",
        () => {
            const changed = "CREATE OR REPLACE REST SERVICE /MYSERVICE/v1\n"
                + "    DISABLED;";
            const sql = withRestStatements(BODY, [changed]);

            expect(sql).toBe(BODY.replace(SERVICE, changed));
            expect(parseRestScript(sql).map((entry) => {
                return entry.kind;
            })).toEqual(["service", "schema", "object"]);
        });
});

describe("a development script's sections", () => {
    it("finds a section's body between its header and the next", () => {
        const text = script(BODY);
        const span = sectionSpan(text, "180")!;

        expect(text.slice(span.start, span.end)).toBe(BODY);
        expect(sectionSpan(text, "185")).toBeUndefined();
        const last = sectionSpan(text, "190")!;
        expect(text.slice(last.start, last.end)).toBe("\n-- Drop helpers\n");
    });

    it("reads the REST SQL and the line it starts on", () => {
        const section = restSectionOf(script(BODY))!;

        expect(section.sql).toBe(BODY);
        // Two five-line headers and the four lines of Section 170's body.
        expect(section.line).toBe(14);
        expect(restSectionOf("CREATE TABLE t (id INT);")).toBeUndefined();
    });

    it("reads a script with Windows line ends", () => {
        const text = script(BODY).replaceAll("\n", "\r\n");
        const span = sectionSpan(text, "180")!;

        expect(text.slice(span.start, span.end))
            .toBe(BODY.replaceAll("\n", "\r\n"));
    });

    it("puts statements into Section 180 and nowhere else", () => {
        const text = script("\n-- Create a REST service\n\n\n");
        const { span, sql } = restSectionEdit(text, [SERVICE]);
        const changed = text.slice(0, span.start) + sql + text.slice(span.end);

        expect(changed).toBe(
            script(`\n-- Create a REST service\n\n${SERVICE}\n\n\n`));
        expect(() => { restSectionEdit("SELECT 1;", [SERVICE]); })
            .toThrow("The development script has no MSM Section 180");
    });
});
