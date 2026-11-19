import fs from "fs";
import path from "path";
import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationResult,
  PromptOrchestrationSkill,
} from "@prompthub/shared/types";
import { OpenAiCompatiblePromptLlm } from "../prompt-orchestrator-llm";
import {
  PromptOrchestrator,
  PromptOrchestratorError,
} from "../prompt-orchestrator";
import {
  ensureNoUnknownOptions,
  parseCsv,
  parseNumberOption,
  parsePositiveNumberOption,
  parseRepeatedOption,
  readTextOption,
  requirePositional,
  takeFlag,
  takeOption,
} from "./args";
import { emitSuccess } from "./io";
import {
  CliError,
  EXIT_CODES,
  type CliContext,
  type CliDatabaseHooks,
} from "./types";
import { ORCHESTRATE_HELP } from "./help";

const MODES: ReadonlySet<string> = new Set([
  "expand",
  "professional",
  "polish",
  "reverse",
  "edit",
  "random",
  "json",
  "lora",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function isOrchestrationMode(
  value: string,
): value is PromptOrchestrationMode {
  return MODES.has(value);
}

function parseMode(value: string | undefined): PromptOrchestrationMode {
  const mode = value ?? "expand";
  if (!isOrchestrationMode(mode)) {
    throw new CliError(
      "USAGE_ERROR",
      `Unsupported orchestration mode: ${mode}`,
      EXIT_CODES.USAGE,
    );
  }
  return mode;
}

function parseSkill(
  value: string | undefined,
): PromptOrchestrationSkill | undefined {
  if (value === undefined) return undefined;
  if (value === "moodyMoss" || value === "moss" || value === "k2") {
    return value;
  }
  throw new CliError(
    "USAGE_ERROR",
    `Unsupported prompt rule skill: ${value}`,
    EXIT_CODES.USAGE,
  );
}

function parseOutputFormat(
  value: string | undefined,
): PromptOrchestrationOutputFormat | undefined {
  if (value === undefined) return undefined;
  if (value === "caption" || value === "layout") return value;
  throw new CliError(
    "USAGE_ERROR",
    "--format must be caption or layout",
    EXIT_CODES.USAGE,
  );
}

function requiredOption(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new CliError(
      "USAGE_ERROR",
      `${label} is required`,
      EXIT_CODES.USAGE,
    );
  }
  return value.trim();
}

function imageMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  throw new CliError(
    "USAGE_ERROR",
    `Unsupported reference image type: ${extension || "(none)"}`,
    EXIT_CODES.USAGE,
  );
}

function readImage(reference: string): string {
  if (/^https?:\/\//i.test(reference) || reference.startsWith("data:image/")) {
    return reference;
  }
  const filePath = path.resolve(reference);
  const mimeType = imageMimeType(filePath);
  try {
    const content = fs.readFileSync(filePath);
    if (content.byteLength > MAX_IMAGE_BYTES) {
      throw new CliError(
        "USAGE_ERROR",
        `Reference image exceeds 20 MiB: ${reference}`,
        EXIT_CODES.USAGE,
      );
    }
    return `data:${mimeType};base64,${content.toString("base64")}`;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      "IO_ERROR",
      `Failed to read reference image: ${reference}`,
      EXIT_CODES.IO,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function optionalValues(values: string[]): string[] | undefined {
  return values.length > 0 ? values : undefined;
}

function buildInput(args: string[]): PromptOrchestrationInput {
  const mode = parseMode(takeOption(args, "--mode"));
  const prompt = readTextOption(args, "--prompt", "--prompt-file");
  const subject = takeOption(args, "--subject");
  const setting = takeOption(args, "--setting");
  const seed = takeOption(args, "--seed");
  const hasRandomOptions =
    subject !== undefined || setting !== undefined || seed !== undefined;
  const outputFormat = parseOutputFormat(takeOption(args, "--format"));
  const width = parseNumberOption(takeOption(args, "--width"), "--width");
  const height = parseNumberOption(takeOption(args, "--height"), "--height");
  return {
    mode,
    prompt,
    skill: parseSkill(takeOption(args, "--skill")),
    series: takeOption(args, "--series"),
    outputFormat,
    ...(width !== undefined || height !== undefined
      ? { canvas: { width: width ?? 0, height: height ?? 0 } }
      : {}),
    modelId: takeOption(args, "--model-id"),
    loraIds: optionalValues(parseRepeatedOption(args, "--lora")),
    categories: parseCsv(takeOption(args, "--categories")),
    selectedTermIds: optionalValues(parseRepeatedOption(args, "--term")),
    lockedTermIds: optionalValues(parseRepeatedOption(args, "--lock-term")),
    excludedTermIds: optionalValues(parseRepeatedOption(args, "--exclude-term")),
    fixedDetails: optionalValues(parseRepeatedOption(args, "--fixed")),
    constraints: optionalValues(parseRepeatedOption(args, "--constraint")),
    editInstruction: takeOption(args, "--edit-instruction"),
    ...(mode === "random" || hasRandomOptions
      ? {
          random: {
            subject: subject ?? "",
            setting: setting ?? "",
            ...(seed !== undefined ? { seed } : {}),
          },
        }
      : {}),
    imageUrls: optionalValues(parseRepeatedOption(args, "--image"))?.map(readImage),
    candidateLimitPerCategory: parseNumberOption(
      takeOption(args, "--candidate-limit"),
      "--candidate-limit",
    ),
    validatedOnly: takeFlag(args, "--validated-only"),
  };
}

function tableRows(result: PromptOrchestrationResult) {
  return [
    { field: "status", value: result.status },
    { field: "mode", value: result.mode },
    { field: "initialPrompt", value: result.initialPrompt },
    { field: "completePrompt", value: result.completePrompt },
    {
      field: "selectedTerms",
      value: result.selectedTerms
        .map((term) => term.template ?? term.en)
        .join(", "),
    },
    { field: "fields", value: JSON.stringify(result.fields) },
    { field: "warnings", value: result.warnings.join(" | ") },
  ];
}

function normalizeError(error: unknown): never {
  if (error instanceof PromptOrchestratorError) {
    const notFound = error.code === "MODEL_PROFILE_NOT_FOUND";
    throw new CliError(
      notFound ? "NOT_FOUND" : "USAGE_ERROR",
      error.message,
      notFound ? EXIT_CODES.NOT_FOUND : EXIT_CODES.USAGE,
    );
  }
  throw error;
}

export async function handleOrchestrateCommand(
  argv: string[],
  context: CliContext,
  databaseHooks: CliDatabaseHooks,
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    context.io.stdout(ORCHESTRATE_HELP);
    return;
  }
  const args = [...argv];
  const command = requirePositional(args, 0, "command");
  if (command !== "run") {
    throw new CliError(
      "USAGE_ERROR",
      `Unsupported orchestrate command: ${command}`,
      EXIT_CODES.USAGE,
    );
  }
  const remaining = args.slice(1);
  const input = buildInput(remaining);
  const endpoint = takeOption(remaining, "--endpoint");
  const llmModel = takeOption(remaining, "--llm-model");
  const apiKey = takeOption(remaining, "--api-key");
  const timeoutMs = parsePositiveNumberOption(
    takeOption(remaining, "--timeout"),
    "--timeout",
  );
  const maxTokens = parsePositiveNumberOption(
    takeOption(remaining, "--max-tokens"),
    "--max-tokens",
  );
  ensureNoUnknownOptions(remaining);
  if (remaining.length > 0) {
    throw new CliError(
      "USAGE_ERROR",
      `Unexpected arguments: ${remaining.join(" ")}`,
      EXIT_CODES.USAGE,
    );
  }
  try {
    const llm = new OpenAiCompatiblePromptLlm({
      endpoint: endpoint ?? "http://127.0.0.1:8080/v1/chat/completions",
      model: requiredOption(llmModel, "--llm-model"),
      apiKey,
      timeoutMs,
      maxTokens,
    });
    const orchestrator = new PromptOrchestrator({
      vocabulary: new PromptVocabDB(databaseHooks.initDatabase()),
      llm,
    });
    const result = await orchestrator.orchestrate(input);
    emitSuccess(context, result, tableRows(result));
  } catch (error) {
    normalizeError(error);
  }
}
