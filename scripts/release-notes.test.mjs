import assert from "node:assert/strict";
import test from "node:test";
import { extractReleaseNotes } from "./release-notes.mjs";

const SAMPLE = `# Changelog

## Unreleased

- upcoming

## 0.1.14

- glossary surface form
- grok bot icon

## 0.1.13

- previous
`;

test("extracts the matching version section", () => {
  assert.equal(
    extractReleaseNotes(SAMPLE, "v0.1.14"),
    "- glossary surface form\n- grok bot icon",
  );
});

test("rejects a missing version", () => {
  assert.throws(() => extractReleaseNotes(SAMPLE, "0.9.9"), /No CHANGELOG.md section/);
});

test("rejects an empty version section", () => {
  assert.throws(
    () => extractReleaseNotes("# Changelog\n\n## 0.1.15\n\n## 0.1.14\n- x\n", "0.1.15"),
    /empty/,
  );
});
