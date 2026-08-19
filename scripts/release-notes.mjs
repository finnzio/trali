import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function extractReleaseNotes(markdown, version) {
  const ver = String(version).replace(/^v/i, "").trim();
  if (!ver) {
    throw new Error("version is required");
  }
  const escaped = ver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?\\b.*$`);
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (heading.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`No CHANGELOG.md section for ${ver}`);
  }
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end).join("\n").trim();
  if (!body) {
    throw new Error(`CHANGELOG.md section for ${ver} is empty`);
  }
  return body;
}

function appendGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set");
  }
  fs.appendFileSync(outputPath, `${name}<<EOF\n${value}\nEOF\n`);
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const githubOutput = args.includes("--github-output");
  const version = args.find((arg) => !arg.startsWith("--"));
  if (!version) {
    console.error("usage: node scripts/release-notes.mjs <version> [--github-output]");
    process.exit(1);
  }
  const markdown = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const body = extractReleaseNotes(markdown, version);
  if (githubOutput) {
    appendGithubOutput("body", body);
  } else {
    process.stdout.write(`${body}\n`);
  }
}
