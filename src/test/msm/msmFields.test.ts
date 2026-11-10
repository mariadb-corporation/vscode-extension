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
    copyrightsProblem,
    copyrightYears,
    createDefaults,
    createProblem,
    CUSTOM_LICENSE_START,
    customLicenseProblem,
    deployDefaults,
    deploymentScriptDefaults,
    deploymentScriptProblem,
    deployProblem,
    importDefaults,
    importedObjects,
    importProblem,
    isProjectFolder,
    msmProblem,
    nextPatchVersion,
    parseVersion,
    projectFolderName,
    releaseDefaults,
    releaseProblem,
    storedCopyrights,
    readsNote,
    tickedObjects,
    tickedSets,
    unticked,
    type IMsmCopyrightValues,
    type IMsmCreateValues,
    type IMsmProjectContext,
} from "../../msm/msmFields.js";

const PROJECT: IMsmProjectContext = {
    projectPath: "/work/sakila.msm.project",
    schemaName: "sakila",
    license: "MIT",
    customLicense: "",
    copyrights: [{ holder: "Ada", yearOfCreation: "2024",
        yearOfLastUpdate: "", tracksUpdates: true }],
    currentDevelopmentVersion: "1.0.1",
    lastReleasedVersion: "1.0.0",
    releasedVersions: ["0.9.0", "1.0.0"],
    deploymentScriptVersions: ["0.9.0"],
    schemaDevelopmentFilePath:
        "/work/sakila.msm.project/development/sakila_next.sql",
};

const NEW: IMsmProjectContext = {
    ...PROJECT,
    currentDevelopmentVersion: "0.0.1",
    lastReleasedVersion: undefined,
    releasedVersions: [],
    deploymentScriptVersions: [],
};

const create = (changes: Partial<IMsmCreateValues>): IMsmCreateValues => {
    return {
        ...createDefaults("/work"), schemaName: "sakila",
        copyrightHolder: "Ada", ...changes,
    };
};

describe("versions", () => {
    it("parses major.minor.patch and nothing else", () => {
        expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
        expect(parseVersion(" 10.0.12 ")).toEqual([10, 0, 12]);
        for (const bad of ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "", "1..3",
            "01.0.0", "1.0.00"]) {
            expect(parseVersion(bad)).toBeUndefined();
        }
    });

    it("counts the patch up for the next version", () => {
        expect(nextPatchVersion("1.0.0")).toBe("1.0.1");
        expect(nextPatchVersion("1.2.9")).toBe("1.2.10");
        expect(nextPatchVersion("oops")).toBe("oops");
    });
});

describe("project folders", () => {
    it("names the folder as the plugin does", () => {
        expect(projectFolderName("sakila")).toBe("sakila.msm.project");
        expect(projectFolderName(" my  schema ")).toBe("my_schema.msm.project");
        expect(projectFolderName("a/b:c*?")).toBe("abc.msm.project");
    });

    it("knows a project folder by its name", () => {
        expect(isProjectFolder("/w/sakila.msm.project")).toBe(true);
        expect(isProjectFolder("/w/sakila.msm.project/")).toBe(true);
        expect(isProjectFolder("C:\\w\\sakila.msm.project")).toBe(true);
        expect(isProjectFolder("/w/sakila")).toBe(false);
        expect(isProjectFolder("/w/sakila.msm.project.bak")).toBe(false);
    });
});

describe("New MSM Project", () => {
    it("starts in the folder it was opened on, with no license", () => {
        expect(createDefaults("/work")).toEqual({
            schemaName: "", targetPath: "/work", copyrightHolder: "",
            yearOfCreation: String(new Date().getFullYear()),
            customLicense: CUSTOM_LICENSE_START,
            license: "None", allowSpecialChars: false,
            overwriteExisting: false, createTargetPath: false,
            // At the top of the MSM Projects view, kept from LLMs.
            folder: "/", caption: "", color: "", mcpAccess: false,
        });
    });

    it("accepts a plain schema name", () => {
        for (const name of ["sakila", "Shop_2", "_x", "a$b", "9lives"]) {
            expect(createProblem(create({ schemaName: name }))).toBeUndefined();
        }
    });

    it("asks for a name", () => {
        expect(createProblem(create({ schemaName: "  " }))?.field)
            .toBe("schemaName");
    });

    it("refuses a name that needs quotes, unless special characters are allowed",
        () => {
            for (const name of ["my schema", "shop-db", "$x", "über"]) {
                expect(createProblem(create({ schemaName: name }))?.message)
                    .toMatch(/Allow Special Characters/u);
                expect(createProblem(create({
                    schemaName: name, allowSpecialChars: true,
                }))).toBeUndefined();
            }
        });

    // A plugin older than mariadb-shell-plugins #67 lets this through.
    it("refuses a name of digits only", () => {
        expect(createProblem(create({ schemaName: "123" }))?.message)
            .toMatch(/digits only/u);
        expect(createProblem(create({
            schemaName: "123", allowSpecialChars: true,
        }))).toBeUndefined();
    });

    it("refuses a name longer than a schema name can be", () => {
        expect(createProblem(create({ schemaName: "a".repeat(64) })))
            .toBeUndefined();
        expect(createProblem(create({ schemaName: "a".repeat(65) }))?.field)
            .toBe("schemaName");
    });

    it("refuses a name that leaves nothing to name the folder by", () => {
        expect(createProblem(create({
            schemaName: "/:*", allowSpecialChars: true,
        }))?.message).toMatch(/nothing to name/u);
    });

    it("asks for the folder and the copyright holder", () => {
        expect(createProblem(create({ targetPath: " " }))?.field)
            .toBe("targetPath");
        expect(createProblem(create({ copyrightHolder: "" }))?.field)
            .toBe("copyrightHolder");
    });

    it("takes an earlier year of creation, but none to come", () => {
        expect(createProblem(create({ yearOfCreation: "2019" })))
            .toBeUndefined();
        for (const year of ["19", "twenty", "2999"]) {
            expect(createProblem(create({ yearOfCreation: year }))?.field)
                .toBe("yearOfCreation");
        }
    });
});

describe("custom licenses", () => {
    it("starts with a text msm takes", () => {
        expect(customLicenseProblem(CUSTOM_LICENSE_START)).toBeUndefined();
    });

    it("takes msm's placeholders, $$ and line comments", () => {
        expect(customLicenseProblem("-- (c) $year ${copyright_holder}, $$5\n"
            + "# ${copyright_notices}")).toBeUndefined();
    });

    it("refuses what msm, or a script, would not take", () => {
        expect(customLicenseProblem(" ")).toMatch(/Enter the license's text/u);
        expect(customLicenseProblem("/* ${author} */"))
            .toMatch(/does not fill \$\{author\}/u);
        expect(customLicenseProblem("/* costs $ 5 */"))
            .toMatch(/write \$\$ for a \$/u);
        expect(customLicenseProblem("MIT License"))
            .toMatch(/has to be an SQL comment/u);
    });

    it("checks the text only for a custom license", () => {
        expect(createProblem(create({ license: "MIT", customLicense: "" })))
            .toBeUndefined();
        expect(createProblem(create({ license: "CUSTOM",
            customLicense: "" }))?.field).toBe("customLicense");
    });
});

describe("copyrights", () => {
    const ADA: IMsmCopyrightValues = { holder: "Ada", yearOfCreation: "2024",
        yearOfLastUpdate: "", tracksUpdates: true };

    it("names the years as the notice does", () => {
        expect(copyrightYears(ADA)).toBe("2024");
        expect(copyrightYears({ ...ADA, yearOfLastUpdate: "2024" }))
            .toBe("2024");
        expect(copyrightYears({ ...ADA, yearOfLastUpdate: "2026" }))
            .toBe("2024, 2026");
    });

    it("refuses what msm would, by its field", () => {
        expect(copyrightsProblem([ADA])).toBeUndefined();
        expect(copyrightsProblem([])?.field).toBe("copyrights");
        expect(copyrightsProblem([ADA, { ...ADA, holder: " " }])?.field)
            .toBe("copyrights.1.holder");
        expect(copyrightsProblem([{ ...ADA, yearOfCreation: "24" }])?.field)
            .toBe("copyrights.0.yearOfCreation");
        expect(copyrightsProblem([{ ...ADA, yearOfLastUpdate: "2999" }])
            ?.message).toMatch(/2999 lies in the future/u);
        expect(copyrightsProblem([{ ...ADA, yearOfLastUpdate: "2023" }])
            ?.message).toMatch(/cannot be before the first, 2024/u);
    });

    it("stores them trimmed, without an empty last year", () => {
        expect(storedCopyrights([{ ...ADA, holder: " Ada " },
            { ...ADA, yearOfLastUpdate: " 2025 ", tracksUpdates: false }]))
            .toEqual([
                { holder: "Ada", yearOfCreation: "2024", tracksUpdates: true },
                { holder: "Ada", yearOfCreation: "2024",
                    yearOfLastUpdate: "2025", tracksUpdates: false },
            ]);
    });
});

describe("Prepare Release", () => {
    it("releases the development version and goes on with the next", () => {
        expect(releaseDefaults(PROJECT)).toEqual({
            version: "1.0.1", nextVersion: "1.0.2",
            allowToStayOnSameVersion: false, overwriteExisting: false,
        });
        expect(releaseProblem(PROJECT, releaseDefaults(PROJECT)))
            .toBeUndefined();
    });

    it("asks for versions in the plugin's format", () => {
        const values = releaseDefaults(PROJECT);

        expect(releaseProblem(PROJECT, { ...values, version: "" })?.field)
            .toBe("version");
        expect(releaseProblem(PROJECT, { ...values, version: "1.1" })?.message)
            .toMatch(/major\.minor\.patch/u);
        expect(releaseProblem(PROJECT, { ...values, nextVersion: "next" })
            ?.field).toBe("nextVersion");
    });

    it("refuses a version below the last release", () => {
        expect(releaseProblem(PROJECT, {
            ...releaseDefaults(PROJECT), version: "0.9.5", nextVersion: "1.0.0",
        })?.message).toMatch(/lower than the last released one, 1\.0\.0/u);
    });

    it("lets a project's first release be any version", () => {
        expect(releaseProblem(NEW, {
            ...releaseDefaults(NEW), version: "0.0.0", nextVersion: "0.0.1",
        })).toBeUndefined();
    });

    it("wants development to move on, unless told to stay", () => {
        const values = { ...releaseDefaults(PROJECT), nextVersion: "1.0.1" };

        expect(releaseProblem(PROJECT, values)?.message)
            .toMatch(/Stay on the Same Version/u);
        expect(releaseProblem(PROJECT, {
            ...values, allowToStayOnSameVersion: true,
        })).toBeUndefined();
    });

    it("never lets development go back below the release", () => {
        expect(releaseProblem(PROJECT, {
            ...releaseDefaults(PROJECT), nextVersion: "1.0.0",
            allowToStayOnSameVersion: true,
        })?.field).toBe("nextVersion");
    });

    it("asks before releasing a version again", () => {
        const again = {
            ...releaseDefaults(PROJECT), version: "1.0.0", nextVersion: "1.0.1",
        };

        const problem = releaseProblem(PROJECT, again);

        expect(problem?.field).toBe("overwriteExisting");
        expect(problem?.message).toMatch(/1\.0\.0 has been released already/u);
        expect(releaseProblem(PROJECT, { ...again, overwriteExisting: true }))
            .toBeUndefined();
    });
});

describe("Generate Deployment Script", () => {
    it("starts on the newest release", () => {
        expect(deploymentScriptDefaults(PROJECT)).toEqual({
            version: "1.0.0", overwriteExisting: false,
        });
        expect(deploymentScriptProblem(PROJECT,
            deploymentScriptDefaults(PROJECT))).toBeUndefined();
    });

    it("has nothing to generate before the first release", () => {
        expect(deploymentScriptDefaults(NEW).version).toBe("");
        const problem = deploymentScriptProblem(NEW,
            deploymentScriptDefaults(NEW));

        expect(problem?.field).toBeUndefined();
        expect(problem?.message).toMatch(/Prepare a release first/u);
    });

    it("takes released versions only", () => {
        expect(deploymentScriptProblem(PROJECT, {
            version: "1.0.1", overwriteExisting: false,
        })?.field).toBe("version");
    });

    it("asks before generating a script again", () => {
        expect(deploymentScriptProblem(PROJECT, {
            version: "0.9.0", overwriteExisting: false,
        })?.field).toBe("overwriteExisting");
        expect(deploymentScriptProblem(PROJECT, {
            version: "0.9.0", overwriteExisting: true,
        })).toBeUndefined();
    });
});

describe("Deploy Schema", () => {
    const connections = [
        { uri: "mariadb://root@a:3306", label: "root@a:3306" },
        { uri: "mariadb://root@b:3306", label: "root@b:3306" },
    ];

    it("starts on the default connection and the newest script, backing up",
        () => {
            expect(deployDefaults(PROJECT, connections, "mariadb://root@b:3306"))
                .toEqual({
                    connection: "mariadb://root@b:3306", version: "0.9.0",
                    backup: true, backupDirectory: "",
                });
        });

    it("picks the one connection there is, and none of several", () => {
        expect(deployDefaults(PROJECT, connections.slice(0, 1)).connection)
            .toBe("mariadb://root@a:3306");
        expect(deployDefaults(PROJECT, connections).connection).toBe("");
        // A default connection that is not listed is not picked.
        expect(deployDefaults(PROJECT, connections, "mariadb://x@y").connection)
            .toBe("");
    });

    it("asks for a connection", () => {
        expect(deployProblem(PROJECT, deployDefaults(PROJECT, connections))
            ?.field).toBe("connection");
    });

    it("has nothing to deploy before a deployment script exists", () => {
        expect(deployProblem(NEW, {
            ...deployDefaults(NEW, connections), connection: "mariadb://root@a",
        })?.message).toMatch(/no deployment script/u);
    });

    it("takes versions with a deployment script only", () => {
        const values = {
            ...deployDefaults(PROJECT, connections), connection: "c",
        };

        expect(deployProblem(PROJECT, values)).toBeUndefined();
        expect(deployProblem(PROJECT, { ...values, version: "1.0.0" })?.field)
            .toBe("version");
        expect(deployProblem(PROJECT, { ...values, version: "" })?.field)
            .toBe("version");
    });
});

describe("msmProblem", () => {
    it("checks each dialog by its own rules", () => {
        expect(msmProblem("create", undefined, create({ schemaName: "" }))
            ?.field).toBe("schemaName");
        expect(msmProblem("info", PROJECT, {})).toBeUndefined();
        expect(msmProblem("release", PROJECT, releaseDefaults(PROJECT)))
            .toBeUndefined();
        expect(msmProblem("deploymentScript", NEW,
            deploymentScriptDefaults(NEW))).toBeDefined();
        expect(msmProblem("deploy", PROJECT, deployDefaults(PROJECT, [])))
            .toBeDefined();
    });

    it("refuses a project dialog without its project", () => {
        expect(msmProblem("release", undefined, releaseDefaults(PROJECT))
            ?.message).toMatch(/could not be read/u);
    });
});

describe("New MSM Project from Schema's fields", () => {
    const LIVE = {
        schema: "shop",
        tables: [{ name: "b", comment: "", triggers: ["b_ai"] },
            { name: "a", comment: "", triggers: [] }],
        views: [{ name: "v", comment: "" }],
        procedures: [{ name: "p" }], functions: [], events: [],
        triggers: [{ name: "b_ai", table: "b" }],
        sequences: [{ name: "s" }],
        schema_version: null, left_out: [],
    };

    it("starts with every object ticked, under the schema's own name", () => {
        const values = importDefaults("mariadb://x", LIVE, "/work");

        expect(values).toMatchObject({ schemaName: "shop", targetPath: "/work",
            connection: "mariadb://x", allowSpecialChars: true });
        expect(values.objects).toEqual({ tables: ["b", "a"], sequences: ["s"],
            views: ["v"], procedures: ["p"], functions: [], events: [] });
        expect(importedObjects(LIVE, values.objects)).toBeUndefined();
    });

    it("ticks in the listing's order, and sends every kind once one is not "
        + "all ticked", () => {
        const { objects } = importDefaults("mariadb://x", LIVE, "/work");
        const none = tickedObjects(LIVE, objects, "tables", ["a", "b"], false);
        const again = tickedObjects(LIVE, none, "tables", ["a", "b"], true);

        expect(none.tables).toEqual([]);
        expect(again.tables).toEqual(["b", "a"]);
        expect(importedObjects(LIVE, none)).toEqual({ tables: [],
            sequences: ["s"], views: ["v"], procedures: ["p"], functions: [],
            events: [] });
    });

    it("refuses an import of nothing, then checks as New MSM Project does",
        () => {
            const values = importDefaults("mariadb://x", LIVE, "/work");
            const empty = Object.fromEntries(Object.keys(values.objects).map(
                (kind) => { return [kind, []]; })) as unknown as typeof values.objects;

            expect(importProblem({ ...values, objects: empty })?.field)
                .toBe("objects");
            expect(importProblem(values)?.field).toBe("copyrightHolder");
            expect(msmProblem("import", undefined, { ...values,
                copyrightHolder: "Ada" })).toBeUndefined();
        });

    it("names what a ticked view reads that is not ticked", () => {
        const { objects } = importDefaults("mariadb://x", LIVE, "/work");
        const view = { name: "v", comment: "", reads: [
            { kind: "functions" as const, name: "f" },
            { kind: "tables" as const, name: "a" },
            { kind: "tables" as const, name: "b" }] };
        const some = tickedObjects(LIVE, objects, "tables", ["a"], false);
        const missing = (ticked: typeof objects, object: typeof view
            | { name: string; reads?: null }) => {
            return unticked(tickedSets(ticked), "views", object);
        };

        expect(missing(objects, view)).toEqual([
            { kind: "functions", name: "f" }]);
        expect(missing(some, view)).toEqual([
            { kind: "functions", name: "f" }, { kind: "tables", name: "a" }]);
        // Not ticked itself, or reads not known: nothing to say.
        expect(missing(tickedObjects(LIVE, some, "views", ["v"], false),
            view)).toEqual([]);
        expect(missing(some, { ...view, reads: null })).toEqual([]);
        expect(missing(some, { name: "v" })).toEqual([]);
    });

    it("says what is missing in a note", () => {
        expect(readsNote([{ kind: "tables", name: "film" }])).toBe("Reads the "
            + "table film, not ticked: the project will not deploy the view "
            + "without it.");
        expect(readsNote([{ kind: "functions", name: "f" },
            { kind: "sequences", name: "s" }, { kind: "views", name: "v" }]))
            .toBe("Reads the function f, the sequence s and the view v, not "
            + "ticked: the project will not deploy the view without them.");
    });

});
