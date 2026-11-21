#!/usr/bin/env node
/**
 * Builds a blinded A/B/C image-comparison manifest and score sheet.
 *
 * This step needs no image backend. Fill a cases JSON with three prompt
 * variants per case, run this script, then generate the images with the same
 * model/seed/steps and score them blind.
 *
 * Usage:
 *   node scripts/build-abc-blind-sheet.mjs --cases cases.json --out <dir>
 *
 * Cases schema:
 * {
 *   "model": "flux-dev",
 *   "size": "1024x1024",
 *   "steps": 28,
 *   "seedBase": 1000,
 *   "cases": [
 *     { "id": "portrait-rain", "label": "雨夜人像", "A": "...", "B": "...", "C": "..." }
 *   ]
 * }
 *
 * Outputs: manifest.json, score-sheet.csv, answer-key.json.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CRITERIA = [
  ["intent", "意图一致"],
  ["structure", "结构正确"],
  ["detail", "细节有效"],
  ["style", "风格达成"],
  ["conflict", "无冲突/无伪影"],
];

function parse(argv) {
  const read = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : "";
  };
  return {
    cases: read("cases"),
    out: read("out"),
    secret: read("secret") || "abc-blind",
  };
}

function code(secret, caseId, variant) {
  const digest = createHash("sha256").update(`${secret}:${caseId}:${variant}`).digest("hex");
  return digest.slice(0, 4).toUpperCase();
}

function shuffle(values, seed) {
  const copy = [...values];
  let state = Number.parseInt(seed.slice(0, 8), 16) || 1;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const target = state % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!args.cases || !args.out) {
    throw new Error("--cases and --out are required");
  }
  const raw = JSON.parse(await fs.readFile(args.cases, "utf8"));
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  if (cases.length === 0) throw new Error("cases array is empty");
  const seen = new Set();
  for (const item of cases) {
    if (!item.id || seen.has(item.id)) throw new Error(`case id missing or duplicated: ${item.id}`);
    seen.add(item.id);
    for (const variant of ["A", "B", "C"]) {
      const prompt = String(item[variant] ?? "").trim();
      if (!prompt) throw new Error(`case ${item.id} variant ${variant} is empty`);
    }
    if (new Set(["A", "B", "C"].map((v) => item[v].trim())).size !== 3) {
      throw new Error(`case ${item.id} variants must differ`);
    }
  }

  const seedBase = Number(raw.seedBase ?? 1000);
  const model = String(raw.model ?? "");
  const size = String(raw.size ?? "");
  const steps = Number(raw.steps ?? 0);
  const manifest = [];
  const key = {};
  const scoreRows = [["case_id", "label", "blind_code", ...CRITERIA.map(([, label]) => label), "total", "notes"]];

  cases.forEach((item, index) => {
    const codes = ["A", "B", "C"].map((variant) => ({ variant, blind: code(args.secret, item.id, variant) }));
    if (new Set(codes.map((entry) => entry.blind)).size !== 3) {
      throw new Error(`blind code collision in case ${item.id}; change --secret`);
    }
    key[item.id] = Object.fromEntries(codes.map((entry) => [entry.blind, entry.variant]));
    for (const entry of shuffle(codes, createHash("sha256").update(`${args.secret}:${item.id}`).digest("hex"))) {
      manifest.push({
        caseId: item.id,
        label: item.label ?? item.id,
        blindCode: entry.blind,
        variant: entry.variant,
        prompt: item[entry.variant].trim(),
        model,
        size,
        steps,
        seed: seedBase + index,
      });
      scoreRows.push([item.id, item.label ?? item.id, entry.blind, "", "", "", "", "", "", "", ""]);
    }
  });

  await fs.mkdir(args.out, { recursive: true });
  await fs.writeFile(
    path.join(args.out, "manifest.json"),
    JSON.stringify({ model, size, steps, seedBase, cases, requests: manifest }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(args.out, "score-sheet.csv"),
    [`\ufeff${scoreRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`],
    "utf8",
  );
  await fs.writeFile(
    path.join(args.out, "answer-key.json"),
    JSON.stringify(key, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({
    out: args.out,
    cases: cases.length,
    requests: manifest.length,
    note: "score-sheet.csv is blinded; answer-key.json must stay hidden until scoring ends",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
