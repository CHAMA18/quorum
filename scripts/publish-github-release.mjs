import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const owner = "CHAMA18";
const repo = "quorum";
const tag = process.env.CM_TAG;
const token = process.env.GITHUB_TOKEN;

if (!tag) {
  console.log("Not a version tag; skipping GitHub release.");
  process.exit(0);
}
if (!token) {
  console.log("GITHUB_TOKEN is not configured. Installers remain available as Codemagic build artifacts.");
  process.exit(0);
}

const api = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

let release;
try {
  release = await request(`${api}/releases/tags/${encodeURIComponent(tag)}`);
} catch (error) {
  if (!String(error).includes("GitHub API 404")) throw error;
  try {
    release = await request(`${api}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: `Quorum ${tag}`, generate_release_notes: true }),
    });
  } catch (createError) {
    // The macOS and Windows workflows run together; the other runner may have
    // created this tag's release in the small interval between GET and POST.
    if (!String(createError).includes("GitHub API 422")) throw createError;
    release = await request(`${api}/releases/tags/${encodeURIComponent(tag)}`);
  }
}

const artifacts = await readdir("release");
const platform = /windows/i.test(process.env.CM_WORKFLOW_NAME ?? "") || process.platform === "win32"
  ? "windows"
  : "macos";
const files = artifacts.filter((name) =>
  platform === "windows"
    ? name === "Quorum-Windows-Portable.zip"
    : name.endsWith(".dmg") || name === "Quorum-macOS.zip",
);
if (!files.length) throw new Error(`No ${platform} release assets found in ./release`);

for (const name of files) {
  const existing = release.assets.find((asset) => asset.name === name);
  if (existing) await request(existing.url, { method: "DELETE" });
  const filePath = path.join("release", name);
  const fileSize = (await stat(filePath)).size;
  const uploadUrl = `${release.upload_url.split("{")[0]}?name=${encodeURIComponent(name)}`;
  await request(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(fileSize),
    },
    body: createReadStream(filePath),
    duplex: "half",
  });
  console.log(`Published ${name} to ${tag}`);
}
