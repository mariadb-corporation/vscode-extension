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
    fieldLinesOf,
    parseRestScript,
    restObjectDefinitions,
    restSectionOf,
    objectEntries,
    objectOf,
    schemaEntries,
    schemaOf,
    serviceEntries,
    serviceOf,
    sectionSpan,
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
        expect(serviceEntries(entries).map(serviceOf)).toMatchObject([{
            full_service_path: "/myService/v1",
            url_context_root: "/myService/v1",
            enabled: 1, published: true, comments: "it's; here",
        }]);
        expect(schemaEntries(entries, "/myService/v1").map(schemaOf)).toMatchObject([{
            request_path: "/shop", name: "shop", enabled: 2,
            requires_auth: false,
        }]);
        expect(objectEntries(entries, "/myService/v1", "/shop").map(objectOf))
            .toMatchObject([{
                request_path: "/item", name: "item", schema_name: "shop",
                object_type: "VIEW", enabled: 1, requires_auth: true,
            }]);
    });

    it("starts a statement after the comments before it, on its line", () => {
        const entries = parseRestScript(BODY);

        expect(BODY.slice(entries[1]!.start, entries[1]!.end)).toBe(SCHEMA);
        expect(entries.map((entry) => { return entry.line; }))
            .toEqual([3, 13, 17]);
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

        expect(serviceEntries(entries).map(serviceOf)).toMatchObject([{
            full_service_path: "mike@/my-service",
            url_context_root: "/my-service", enabled: 0,
        }]);
        expect(schemaEntries(entries, "mike@/my-service").map(schemaOf)).toMatchObject([
            { request_path: "/1st", name: "my shop" }]);
        expect(objectEntries(entries, "mike@/my-service", "/1st").map(objectOf).map(
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

    it("reads a service of several developers as one path", () => {
        const entries = parseRestScript([
            "CREATE REST SERVICE mike,anna@/svc;",
            "CREATE REST SCHEMA /s ON SERVICE `mike`,`anna`@/svc FROM `s`;",
        ].join("\n"));

        expect(serviceEntries(entries).map((entry) => {
            return entry.servicePath;
        })).toEqual(["mike,anna@/svc"]);
        expect(schemaEntries(entries, "mike,anna@/svc")).toHaveLength(1);
    });

    it("takes no name in backticks for a flag", () => {
        const [entry] = parseRestScript("CREATE REST VIEW /v ON SERVICE /s "
            + "SCHEMA /x AS `x`.`v` CLASS `Disabled` {};");

        expect(entry).toMatchObject({ kind: "object", enabled: 1 });
    });

    it("lists a thing created twice once, by its last statement", () => {
        const entries = parseRestScript([
            "CREATE OR REPLACE REST SERVICE /svc;",
            "CREATE OR REPLACE REST SERVICE /SVC DISABLED;",
        ].join("\n"));

        expect(serviceEntries(entries)).toMatchObject([
            { servicePath: "/SVC", line: 1 },
        ]);
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
});

describe("a REST object's fields", () => {
    it("reads a view's field block as written, but for the shared indent, "
        + "and leaves its OPTIONS out", () => {
        const sql = `CREATE OR REPLACE REST VIEW /actor
    ON SERVICE mike@/myService SCHEMA /sakila
    AS sakila.actor CLASS Actor @INSERT {
        actorId: actor_id @SORTABLE @KEY,
        # a comment { not a block
        films: sakila.film_actor @UNNEST {
            title: title
        }
    }
    OPTIONS {
        "note": "{ not fields }"
    };`;

        expect(fieldLinesOf(sql)).toEqual([
            "{",
            "    actorId: actor_id @SORTABLE @KEY,",
            "    # a comment { not a block",
            "    films: sakila.film_actor @UNNEST {",
            "        title: title",
            "    }",
            "}",
        ]);
    });

    it("names a routine's PARAMETERS and RESULT blocks, a path reading like "
        + "one no matter", () => {
        const sql = `CREATE REST PROCEDURE /result
    ON SERVICE /svc SCHEMA /db
    AS db.tidy
    PARAMETERS Tidy {
        days: days @IN
    }
    RESULT TidyResult {
        count: count @DATATYPE("int")
    };`;

        expect(fieldLinesOf(sql)).toEqual([
            "PARAMETERS Tidy {", "    days: days @IN", "}",
            "RESULT TidyResult {", "    count: count @DATATYPE(\"int\")", "}",
        ]);
    });

    it("names no clause for a view whose path, object or class reads like "
        + "one", () => {
        const sql = `CREATE REST VIEW /result
    ON SERVICE /svc SCHEMA /db
    AS db.result CLASS Result {
        a: a
    };`;

        expect(fieldLinesOf(sql)).toEqual(["{", "    a: a", "}"]);
        expect(fieldLinesOf(`CREATE REST PROCEDURE /p ON SERVICE /svc
    SCHEMA /db AS result RESULT Result {
        a: a
    };`)).toEqual(["RESULT Result {", "    a: a", "}"]);
    });

    it("lists each REST object of a section once, by its last statement",
        () => {
        const sql = `CREATE OR REPLACE REST SERVICE /svc;
CREATE OR REPLACE REST SCHEMA /db ON SERVICE /svc FROM db;
CREATE OR REPLACE REST VIEW /t ON SERVICE /svc SCHEMA /db AS db.t CLASS T {
    a: a
};
CREATE OR REPLACE REST VIEW /T ON SERVICE /svc SCHEMA /db AS db.t CLASS T;`;

        expect(restObjectDefinitions(sql)).toEqual([{
            servicePath: "/svc", schemaPath: "/db", requestPath: "/T",
            objectType: "VIEW", dbSchema: "db", dbObject: "t", lines: [],
        }]);
    });
});
