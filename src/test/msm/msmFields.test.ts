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
    createDefaults,
    createProblem,
    deployDefaults,
    deploymentScriptDefaults,
    deploymentScriptProblem,
    deployProblem,
    isProjectFolder,
    msmProblem,
    nextPatchVersion,
    parseVersion,
    projectFolderName,
    releaseDefaults,
    releaseProblem,
    type IMsmCreateValues,
    type IMsmProjectContext,
} from "../../msm/msmFields.js";

const PROJECT: IMsmProjectContext = {
    projectPath: "/work/sakila.msm.project",
    schemaName: "sakila",
    license: "MIT",
    copyrightHolders: ["Ada"],
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
            license: "None", allowSpecialChars: false,
            overwriteExisting: false, createTargetPath: false,
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
