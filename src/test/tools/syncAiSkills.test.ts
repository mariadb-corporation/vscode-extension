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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    chatSkillsFor,
    newestReleaseTag,
    pinnedRelease,
    readSkills,
    skillName,
    syncSkills,
    withChatSkills,
    withPinnedRelease,
    type SyncEnvironment,
} from "../../../tools/syncAiSkills.mjs";

const extensionRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const skillMd = (name: string): string => {
    return `---\nname: ${name}\ndescription: About ${name}.\n---\n\n# ${name}\n`;
};

describe("newestReleaseTag", () => {
    it("takes the highest vX.Y.Z, prereleases included, drafts not", () => {
        expect(newestReleaseTag([
            { tag_name: "v26.9.5", draft: false },
            { tag_name: "v26.10.2", draft: false },
            { tag_name: "v26.10.10", draft: true },
            { tag_name: "v26.10.1", draft: false },
            { tag_name: "nightly", draft: false },
        ])).toBe("v26.10.2");
    });

    it("compares numerically, not as text", () => {
        expect(newestReleaseTag([
            { tag_name: "v26.10.9", draft: false },
            { tag_name: "v26.10.10", draft: false },
        ])).toBe("v26.10.10");
    });

    it("finds none among none", () => {
        expect(newestReleaseTag([])).toBeUndefined();
    });
});

describe("skillName", () => {
    it("reads the frontmatter's name, quoted or not", () => {
        expect(skillName(skillMd("mariadb-call"))).toBe("mariadb-call");
        expect(skillName("---\r\nname: \"x-y\"\r\n---\r\n")).toBe("x-y");
    });

    it("finds none outside a frontmatter", () => {
        expect(skillName("# name: nope\n")).toBeUndefined();
    });
});

describe("chatSkillsFor and withChatSkills", () => {
    it("lists the skills sorted, under the setting", () => {
        expect(chatSkillsFor(["b", "a"])).toEqual([
            { path: "skills/a/SKILL.md", when: "config.mariadb.copilot.enabled" },
            { path: "skills/b/SKILL.md", when: "config.mariadb.copilot.enabled" },
        ]);
    });

    it("replaces chatSkills and leaves every other key where it was", () => {
        const manifest = {
            name: "x",
            contributes: { commands: [], chatSkills: [{ path: "old" }] },
            scripts: {},
        };
        const next = withChatSkills(manifest, chatSkillsFor(["a"]));

        expect(Object.keys(next)).toEqual(["name", "contributes", "scripts"]);
        expect(next.contributes).toEqual({
            commands: [],
            chatSkills: chatSkillsFor(["a"]),
        });
    });
});

describe("pinnedRelease and withPinnedRelease", () => {
    it("reads the pinned vX.Y.Z", () => {
        expect(pinnedRelease({ aiPlugins: { release: "v26.10.2" } }))
            .toBe("v26.10.2");
    });

    it("refuses a manifest without one, or with something else", () => {
        expect(() => { pinnedRelease({}); }).toThrow("aiPlugins.release");
        expect(() => { pinnedRelease({ aiPlugins: { release: "main" } }); })
            .toThrow("aiPlugins.release");
    });

    it("replaces the pin and leaves every other key where it was", () => {
        const next = withPinnedRelease(
            { name: "x", aiPlugins: { release: "v1.0.0" }, scripts: {} },
            "v2.0.0");

        expect(Object.keys(next)).toEqual(["name", "aiPlugins", "scripts"]);
        expect(next.aiPlugins).toEqual({ release: "v2.0.0" });
    });
});

describe("the extension's own manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(extensionRoot, "package.json"), "utf8")) as {
        contributes: { chatSkills: unknown };
    } & Record<string, unknown>;
    const skillsDir = path.join(extensionRoot, "skills");

    it("pins an ai-plugins release", () => {
        expect(pinnedRelease(manifest)).toMatch(/^v\d+\.\d+\.\d+$/);
    });

    // skills/ is a cache that `npm run sync:skills` fills; CI fills it
    // before the tests, so there the check always runs.
    it.skipIf(!fs.existsSync(skillsDir))(
        "contributes the skills of the pinned release, no more, no less",
        () => {
            const stamp = JSON.parse(fs.readFileSync(
                path.join(skillsDir, "skills-source.json"), "utf8")) as {
                tag: string;
            };

            expect(stamp.tag).toBe(pinnedRelease(manifest));
            expect(manifest.contributes.chatSkills)
                .toEqual(chatSkillsFor(readSkills(skillsDir)));
        });
});

describe("syncSkills", () => {
    let root: string;
    let logged: string[];

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-skills-test-"));
        logged = [];
        pin("v2.0.0");
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Writes a `package.json` that pins `release`. */
    const pin = (release: string): void => {
        fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(
            { name: "x", aiPlugins: { release }, contributes: {} },
            null, 2)}\n`);
    };

    /**
     * A world whose newest release is `tag`, its archive holding `skills`
     * (folder name to SKILL.md text).
     */
    const world = (
        tag: string,
        skills: Record<string, string>,
        failing = false,
    ): SyncEnvironment & { downloads: string[] } => {
        const downloads: string[] = [];

        return {
            root,
            downloads,
            log: (message) => { logged.push(message); },
            fetchJson: () => {
                return failing
                    ? Promise.reject(new Error("offline"))
                    : Promise.resolve([
                        { tag_name: "v1.0.0", draft: false },
                        { tag_name: tag, draft: false },
                    ]);
            },
            download: (url) => {
                downloads.push(url);

                return Promise.resolve();
            },
            untar: (_archive, into) => {
                const plugin = path.join(into, `ai-plugins-${tag.slice(1)}`,
                    "claude", "dev-plugin");
                for (const [name, text] of Object.entries(skills)) {
                    fs.mkdirSync(path.join(plugin, "skills", name),
                        { recursive: true });
                    fs.writeFileSync(path.join(plugin, "skills", name,
                        "SKILL.md"), text);
                }
                fs.writeFileSync(path.join(plugin, "skills", ".gitkeep"), "");
                fs.writeFileSync(path.join(plugin, "skills-source.json"),
                    JSON.stringify({ source_repo: "upstream" }));
            },
            now: () => { return new Date("2026-10-12T10:00:00Z"); },
        };
    };

    interface Manifest {
        aiPlugins: { release: string };
        contributes: { chatSkills: unknown };
    }

    const manifest = (): Manifest => {
        return JSON.parse(fs.readFileSync(path.join(root, "package.json"),
            "utf8")) as Manifest;
    };

    it("fetches the pinned release and contributes its skills", async () => {
        const environment = world("v2.0.0",
            { b: skillMd("b"), a: skillMd("a") });

        expect(await syncSkills(environment, false)).toBe("updated");

        expect(environment.downloads).toEqual([
            "https://codeload.github.com/mariadb-corporation/ai-plugins/"
                + "tar.gz/refs/tags/v2.0.0",
        ]);
        expect(fs.readdirSync(path.join(root, "skills")).sort())
            .toEqual(["a", "b", "skills-source.json"]);
        expect(JSON.parse(fs.readFileSync(
            path.join(root, "skills", "skills-source.json"), "utf8")))
            .toEqual({
                tag: "v2.0.0",
                synced_at: "2026-10-12",
                upstream: { source_repo: "upstream" },
            });
        expect(manifest().contributes.chatSkills)
            .toEqual(chatSkillsFor(["a", "b"]));
    });

    it("asks GitHub nothing when skills/ holds the pinned release",
        async () => {
            await syncSkills(world("v2.0.0", { a: skillMd("a") }), false);
            const again = world("v2.0.0", { a: skillMd("a") }, true);

            expect(await syncSkills(again, false)).toBe("current");
            expect(again.downloads).toEqual([]);
        });

    it("fetches again when the pin moves, dropping what is gone",
        async () => {
            await syncSkills(world("v2.0.0",
                { a: skillMd("a"), gone: skillMd("gone") }), false);
            pin("v2.1.0");
            await syncSkills(world("v2.1.0", { a: skillMd("a") }), false);

            expect(fs.existsSync(path.join(root, "skills", "gone")))
                .toBe(false);
            expect(manifest().contributes.chatSkills)
                .toEqual(chatSkillsFor(["a"]));
        });

    it("moves the pin to the newest release with --latest", async () => {
        await syncSkills(world("v2.0.0", { a: skillMd("a") }), false);

        expect(await syncSkills(world("v2.1.0", { a: skillMd("a") }), true))
            .toBe("updated");
        expect(manifest().aiPlugins.release).toBe("v2.1.0");
    });

    it("fails when the pinned release cannot be fetched", async () => {
        const offline = world("v2.0.0", {});
        offline.download = () => { return Promise.reject(new Error("offline")); };

        await expect(syncSkills(offline, false)).rejects.toThrow("offline");
        expect(fs.existsSync(path.join(root, "skills"))).toBe(false);
    });

    it("fails, leaving skills/ alone, when a skill is misnamed", async () => {
        await syncSkills(world("v2.0.0", { a: skillMd("a") }), false);
        pin("v2.1.0");

        await expect(syncSkills(
            world("v2.1.0", { a: skillMd("a"), b: skillMd("not-b") }), false))
            .rejects.toThrow("match its folder");
        expect(readSkills(path.join(root, "skills"))).toEqual(["a"]);
    });
});
