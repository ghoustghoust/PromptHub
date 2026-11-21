import Database from "./adapter";
import { v4 as uuidv4 } from "uuid";
import { resolveTermKey } from "@prompthub/shared/utils/prompt-term-key";
import type {
  CreatePromptModelProfileDTO,
  CreatePromptTermDTO,
  CreatePromptValidationDTO,
  PromptKbImportResult,
  PromptModelProfile,
  PromptModelProfileKind,
  PromptTerm,
  PromptTermDomain,
  PromptTermRelationType,
  PromptTermValidationStatus,
  PromptValidationOutcome,
  PromptValidationRecord,
  PromptVocabularyBrowseInput,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";

interface PromptTermRow {
  id: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  series: string | null;
  template: string | null;
  function: string | null;
  applicable_task: string | null;
  applicable_models: string | null;
  source: string | null;
  domain: PromptTermDomain;
  validation_status: PromptTermValidationStatus;
  created_at: number;
}

interface VocabularyFilter {
  conditions: string[];
  params: Array<string | number>;
}

export interface PromptTermMergeResult {
  mergedGroups: number;
  mergedRows: number;
  remappedRelations: number;
  remappedValidations: number;
  survivors: Array<{ id: string; en: string }>;
}

interface ModelProfileRow {
  id: string;
  name: string;
  kind: PromptModelProfileKind;
  trigger_words: string | null;
  weight_range: string | null;
  notes: string | null;
}

interface ValidationRecordRow {
  id: number;
  term_id: string;
  model_id: string | null;
  params: string | null;
  outcome: PromptValidationOutcome;
  notes: string | null;
  created_at: number;
}

const VALIDATION_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "unvalidated",
  "validated",
  "deprecated",
]);
const RELATION_TYPES: ReadonlySet<string> = new Set([
  "synonym",
  "combinable",
  "conflict",
  "precondition",
]);
const MODEL_KINDS: ReadonlySet<string> = new Set(["base", "lora"]);
const TERM_DOMAINS: ReadonlySet<string> = new Set(["shared", "anime", "real", "3d"]);
const VALIDATION_OUTCOMES: ReadonlySet<string> = new Set([
  "good",
  "bad",
  "neutral",
]);

const KB_CHARACTER_META_KEYS = [
  "game",
  "game_tag",
  "tag",
  "zh",
  "auto_tags",
] as const;
const KB_ASSET_META_KEYS = [
  "prompt",
  "style",
  "category",
  "rating",
  "tags_text",
  "media_kind",
  "preview_path",
  "original_path",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} contains a null byte`);
  }
  return value;
}

function optionalText(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} contains a null byte`);
  }
  return value;
}

function isImportableNullableText(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.includes("\0"))
  );
}

function nullableImportText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toTimestamp(iso: string | undefined): number {
  if (iso === undefined) return Date.now();
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid createdAt timestamp: ${iso}`);
  }
  return timestamp;
}

function parseStringArray(raw: string | null, context: string): string[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid ${context} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid ${context} JSON: expected an array of strings`);
  }
  const entries: unknown[] = parsed;
  const values: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new Error(`Invalid ${context} JSON: expected an array of strings`);
    }
    values.push(entry);
  }
  return values;
}

function containsNullByte(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(containsNullByte);
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, entry]) => key.includes("\0") || containsNullByte(entry),
    );
  }
  return false;
}

function parseJsonObject(
  raw: string | null,
  context: string,
): Record<string, unknown> | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid ${context} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${context} JSON: expected an object`);
  }
  return parsed;
}

/** Empty applicableModels means the term applies to every model. */
function normalizeDomain(value: string | null | undefined): PromptTermDomain {
  return typeof value === "string" && TERM_DOMAINS.has(value)
    ? (value as PromptTermDomain)
    : "shared";
}

function termAppliesToModel(term: PromptTerm, modelId: string): boolean {
  return (
    term.applicableModels.length === 0 || term.applicableModels.includes(modelId)
  );
}

function rowToTerm(row: PromptTermRow): PromptTerm {
  return {
    id: row.id,
    category: row.category,
    subcategory: row.subcategory,
    en: row.en,
    zh: row.zh,
    series: row.series,
    template: row.template,
    function: row.function,
    applicableTask: row.applicable_task,
    applicableModels: parseStringArray(
      row.applicable_models,
      `prompt_terms(${row.id}).applicable_models`,
    ),
    source: row.source,
    domain: normalizeDomain(row.domain),
    validationStatus: row.validation_status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToSearchItem(row: PromptTermRow): PromptVocabularySearchItem {
  return {
    id: row.id,
    category: row.category,
    subcategory: row.subcategory,
    en: row.en,
    zh: row.zh,
    series: row.series,
    template: row.template,
    domain: normalizeDomain(row.domain),
    validationStatus: row.validation_status,
  };
}

function rowToModelProfile(row: ModelProfileRow): PromptModelProfile {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    triggerWords: parseStringArray(
      row.trigger_words,
      `model_profiles(${row.id}).trigger_words`,
    ),
    weightRange: row.weight_range,
    notes: row.notes,
  };
}

function rowToValidation(row: ValidationRecordRow): PromptValidationRecord {
  return {
    id: row.id,
    termId: row.term_id,
    modelId: row.model_id,
    params: parseJsonObject(
      row.params,
      `validation_records(${row.id}).params`,
    ),
    outcome: row.outcome,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function pickMeta(
  entry: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of keys) {
    if (entry[key] !== undefined) meta[key] = entry[key];
  }
  return meta;
}

/** Normalization key for duplicate merging; mirrors the resolveTerms SQL normalization. */
function mergeNormalizationKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\\/g, "")
    .toLowerCase()
    .trim();
}

export class PromptVocabDB {
  constructor(protected readonly db: Database.Database) {}

  addTerm(input: CreatePromptTermDTO): PromptTerm {
    const category = requireText(input.category, "Term category");
    const en = requireText(input.en, "Term en");
    const id =
      input.id === undefined ? uuidv4() : requireText(input.id, "Term id");
    const validationStatus = input.validationStatus ?? "unvalidated";
    if (!VALIDATION_STATUSES.has(validationStatus)) {
      throw new Error(
        `Unsupported term validation status: ${validationStatus}`,
      );
    }
    const applicableModels = input.applicableModels ?? [];
    if (!Array.isArray(applicableModels)) {
      throw new Error("Term applicableModels must be an array of model ids");
    }
    for (const modelId of applicableModels) {
      requireText(modelId, "Term applicableModels entry");
    }
    const domain = normalizeDomain(input.domain);
    if (input.domain !== undefined && domain !== input.domain) {
      throw new Error(`Unsupported term domain: ${input.domain}`);
    }
    this.db
      .prepare(
        `INSERT INTO prompt_terms (
          id, category, subcategory, en, zh, series, template, "function",
          applicable_task, applicable_models, source, domain, validation_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        category,
        optionalText(input.subcategory, "Term subcategory"),
        en,
        optionalText(input.zh, "Term zh"),
        optionalText(input.series, "Term series")?.trim() || null,
        optionalText(input.template, "Term template"),
        optionalText(input.function, "Term function"),
        optionalText(input.applicableTask, "Term applicableTask"),
        JSON.stringify(applicableModels),
        optionalText(input.source, "Term source"),
        domain,
        validationStatus,
        toTimestamp(input.createdAt),
      );
    return this.getTerm(id)!;
  }

  getTerm(id: string): PromptTerm | null {
    const row = this.db
      .prepare("SELECT * FROM prompt_terms WHERE id = ?")
      .get(id) as PromptTermRow | undefined;
    return row ? rowToTerm(row) : null;
  }

  listTermsByCategory(
    category: string,
    modelId?: string,
    series?: string,
    domain?: PromptTermDomain,
  ): PromptTerm[] {
    const categoryKey = requireText(category, "Term category");
    if (modelId !== undefined) requireText(modelId, "Model id");
    const seriesKey =
      series === undefined ? undefined : requireText(series, "Term series");
    const conditions = ["category = ?"];
    const params: string[] = [categoryKey];
    if (seriesKey !== undefined) {
      conditions.push("(series IS NULL OR series = ? OR category = ?)");
      params.push(seriesKey, seriesKey);
    }
    if (domain !== undefined) {
      const domainKey = normalizeDomain(domain);
      conditions.push("(domain = ? OR domain = 'shared')");
      params.push(domainKey);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_terms
         WHERE ${conditions.join(" AND ")} ORDER BY en ASC`,
      )
      .all(...params) as PromptTermRow[];
    const terms = rows.map(rowToTerm);
    if (modelId === undefined) return terms;
    return terms.filter((term) => termAppliesToModel(term, modelId));
  }

  /**
   * Series values come from the imported knowledge base. When the current
   * vocabulary has no series metadata yet, fall back to categories so the
   * selector is never an empty control.
   */
  listSeries(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT series FROM prompt_terms
         WHERE series IS NOT NULL AND series <> '' ORDER BY series ASC`,
      )
      .all() as { series: string | null }[];
    const series = rows.flatMap((row) =>
      typeof row.series === "string" ? [row.series] : [],
    );
    if (series.length > 0) return series;
    const categories = this.db
      .prepare(
        `SELECT DISTINCT category FROM prompt_terms
         WHERE category <> '' ORDER BY category ASC`,
      )
      .all() as { category: string }[];
    return categories.map((row) => row.category);
  }

  browseTerms(input: PromptVocabularyBrowseInput): PromptVocabularyBrowseResult {
    const limit = input.limit ?? 60;
    const offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Vocabulary browse limit must be an integer from 1 to 200");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("Vocabulary browse offset must be a non-negative integer");
    }
    const translation = input.translation ?? "all";
    if (!new Set(["all", "missing", "translated"]).has(translation)) {
      throw new Error(`Unsupported vocabulary translation filter: ${translation}`);
    }
    if (input.subcategory !== undefined) {
      optionalText(input.subcategory, "Browse subcategory");
    }

    const base = this.buildVocabularyFilter(input);
    const filtered = this.withTranslationFilter(base, translation);
    const termsFilter: VocabularyFilter = {
      conditions: [...filtered.conditions],
      params: [...filtered.params],
    };
    if (input.subcategory !== undefined) {
      termsFilter.conditions.push("COALESCE(subcategory, '') = ?");
      termsFilter.params.push(input.subcategory);
    }
    const categoryFilter = this.withTranslationFilter(
      this.buildVocabularyFilter({ ...input, category: undefined }),
      translation,
    );
    const missingFilter = this.withTranslationFilter(base, "missing");

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM prompt_terms WHERE ${termsFilter.conditions.join(" AND ")}`,
    ).get(...termsFilter.params) as { count: number };
    const rows = this.db.prepare(
      `SELECT * FROM prompt_terms WHERE ${termsFilter.conditions.join(" AND ")}
       ORDER BY en ASC, id ASC LIMIT ? OFFSET ?`,
    ).all(...termsFilter.params, limit, offset) as PromptTermRow[];
    const categoryRows = this.db.prepare(
      `SELECT category, COUNT(*) AS count FROM prompt_terms
       WHERE ${categoryFilter.conditions.join(" AND ")}
       GROUP BY category ORDER BY category ASC`,
    ).all(...categoryFilter.params) as Array<{ category: string; count: number }>;
    const subcategoryRows = this.db.prepare(
      `SELECT subcategory, COUNT(*) AS count FROM prompt_terms
       WHERE ${filtered.conditions.join(" AND ")}
       GROUP BY subcategory ORDER BY subcategory ASC`,
    ).all(...filtered.params) as Array<{ subcategory: string | null; count: number }>;
    const missingRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM prompt_terms WHERE ${missingFilter.conditions.join(" AND ")}`,
    ).get(...missingFilter.params) as { count: number };

    return {
      items: rows.map(rowToSearchItem),
      total: totalRow.count,
      offset,
      limit,
      categories: categoryRows,
      subcategories: subcategoryRows,
      missingTranslation: missingRow.count,
    };
  }

  private buildVocabularyFilter(input: PromptVocabularySearchInput): VocabularyFilter {
    const conditions = ["validation_status <> 'deprecated'"];
    const params: Array<string | number> = [];
    if (input.category?.trim()) {
      conditions.push("category = ?");
      params.push(requireText(input.category, "Search category"));
    }
    if (input.series?.trim()) {
      conditions.push("(series IS NULL OR series = ?)");
      params.push(requireText(input.series, "Search series"));
    }
    if (input.query?.trim()) {
      const query = requireText(input.query, "Search query").replace(/[\\%_]/g, "\\$&");
      conditions.push("(en LIKE ? ESCAPE '\\' OR zh LIKE ? ESCAPE '\\' OR template LIKE ? ESCAPE '\\')");
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern);
    }
    if (input.domain) {
      const domain = normalizeDomain(input.domain);
      conditions.push("(domain = ? OR domain = 'shared')");
      params.push(domain);
    }
    return { conditions, params };
  }

  private withTranslationFilter(
    filter: VocabularyFilter,
    translation: "all" | "missing" | "translated",
  ): VocabularyFilter {
    return {
      conditions: [
        ...filter.conditions,
        ...(translation === "all" ? [] : [`zh IS ${translation === "missing" ? "NULL" : "NOT NULL"}`]),
      ],
      params: [...filter.params],
    };
  }

  searchTerms(input: PromptVocabularySearchInput): PromptVocabularySearchItem[] {
    const limit = input.limit ?? 40;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
      throw new Error("Vocabulary search limit must be an integer from 1 to 5000");
    }
    const conditions = ["validation_status <> 'deprecated'"];
    const params: Array<string | number> = [];
    if (input.category?.trim()) {
      conditions.push("category = ?");
      params.push(requireText(input.category, "Search category"));
    }
    if (input.series?.trim()) {
      conditions.push("(series IS NULL OR series = ?)");
      params.push(requireText(input.series, "Search series"));
    }
    if (input.query?.trim()) {
      const query = requireText(input.query, "Search query").replace(/[\\%_]/g, "\\$&");
      conditions.push("(en LIKE ? ESCAPE '\\' OR zh LIKE ? ESCAPE '\\' OR template LIKE ? ESCAPE '\\')");
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern);
    }
    if (input.domain) {
      const domain = normalizeDomain(input.domain);
      // A specific domain still offers the descriptors every subject can use.
      conditions.push("(domain = ? OR domain = 'shared')");
      params.push(domain);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_terms
         WHERE ${conditions.join(" AND ")}
         ORDER BY en ASC LIMIT ?`,
      )
      .all(...params) as PromptTermRow[];
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      subcategory: row.subcategory,
      en: row.en,
      zh: row.zh,
      series: row.series,
      template: row.template,
      domain: normalizeDomain(row.domain),
      validationStatus: row.validation_status,
    }));
  }

  /**
   * Resolve curated references to stored rows. Matching normalizes case,
   * underscores, escaped parentheses and spacing, so a pack definition stays
   * valid across SkyLoong and generator import spellings.
   */
  resolveTerms(terms: string[]): PromptVocabularySearchItem[] {
    if (!Array.isArray(terms)) {
      throw new Error("Vocabulary resolve input must be an array of terms");
    }
    if (terms.length < 1 || terms.length > 500) {
      throw new Error("Vocabulary resolve accepts 1 to 500 terms");
    }
    const keys = new Map<string, string>();
    for (const value of terms) {
      const term = requireText(value, "Resolve term");
      keys.set(resolveTermKey(term), term);
    }
    if (keys.size === 0) return [];
    const placeholders = Array.from(keys.keys(), () => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_terms
         WHERE validation_status <> 'deprecated'
           AND trim(lower(replace(replace(en, '_', ' '), char(92), ''))) IN (${placeholders})
         ORDER BY en ASC`,
      )
      .all(...keys.keys()) as PromptTermRow[];
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      subcategory: row.subcategory,
      en: row.en,
      zh: row.zh,
      series: row.series,
      template: row.template,
      domain: normalizeDomain(row.domain),
      validationStatus: row.validation_status,
    }));
  }

  /**
   * Merges duplicate term rows that share category and normalized en text.
   * The survivor is the best-validated row (non-null zh preferred, then lowest
   * id); relations and validation records are remapped onto it before absorbed
   * rows are deleted, so existing references never dangle. Idempotent.
   */
  mergeDuplicatePromptTerms(): PromptTermMergeResult {
    const rows = this.db
      .prepare(`SELECT * FROM prompt_terms ORDER BY id ASC`)
      .all() as PromptTermRow[];
    const groups = new Map<string, PromptTermRow[]>();
    for (const row of rows) {
      const key = `${row.category}\0${mergeNormalizationKey(row.en)}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const statusRank = (status: string): number =>
      status === "validated" ? 2 : status === "deprecated" ? 0 : 1;
    const remap = new Map<string, string>();
    const survivors: Array<{ id: string; en: string }> = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const survivor = list
        .slice()
        .sort(
          (left, right) =>
            statusRank(right.validation_status) - statusRank(left.validation_status) ||
            Number(right.zh !== null) - Number(left.zh !== null) ||
            left.id.localeCompare(right.id),
        )[0];
      survivors.push({ id: survivor.id, en: survivor.en });
      for (const row of list) {
        if (row.id !== survivor.id) remap.set(row.id, survivor.id);
      }
    }
    if (remap.size === 0) {
      return {
        mergedGroups: 0,
        mergedRows: 0,
        remappedRelations: 0,
        remappedValidations: 0,
        survivors: [],
      };
    }
    let remappedRelations = 0;
    let remappedValidations = 0;
    const merge = this.db.transaction(() => {
      for (const [absorbedId, survivorId] of remap) {
        remappedRelations += this.db
          .prepare(
            `INSERT OR IGNORE INTO term_relations (term_id, related_id, relation_type)
             SELECT ?, related_id, relation_type FROM term_relations
             WHERE term_id = ? AND related_id <> ?`,
          )
          .run(survivorId, absorbedId, survivorId).changes;
        remappedRelations += this.db
          .prepare(
            `INSERT OR IGNORE INTO term_relations (term_id, related_id, relation_type)
             SELECT term_id, ?, relation_type FROM term_relations
             WHERE related_id = ? AND term_id <> ?`,
          )
          .run(survivorId, absorbedId, survivorId).changes;
        remappedValidations += this.db
          .prepare(`UPDATE validation_records SET term_id = ? WHERE term_id = ?`)
          .run(survivorId, absorbedId).changes;
        this.db
          .prepare(`DELETE FROM term_relations WHERE term_id = ? OR related_id = ?`)
          .run(absorbedId, absorbedId);
        this.db.prepare(`DELETE FROM prompt_terms WHERE id = ?`).run(absorbedId);
      }
    });
    merge();
    return {
      mergedGroups: survivors.length,
      mergedRows: remap.size,
      remappedRelations,
      remappedValidations,
      survivors,
    };
  }

  addRelation(
    termId: string,
    relatedId: string,
    relationType: PromptTermRelationType,
  ): void {
    const from = requireText(termId, "Relation term id");
    const to = requireText(relatedId, "Relation related id");
    if (!RELATION_TYPES.has(relationType)) {
      throw new Error(`Unsupported term relation type: ${relationType}`);
    }
    if (from === to) {
      throw new Error("Term relation cannot point to itself");
    }
    this.assertTermExists(from);
    this.assertTermExists(to);
    this.db
      .prepare(
        `INSERT INTO term_relations (term_id, related_id, relation_type)
         VALUES (?, ?, ?)
         ON CONFLICT(term_id, related_id, relation_type) DO NOTHING`,
      )
      .run(from, to, relationType);
  }

  /** Conflict ids touching this term from either relation direction. */
  getConflicts(termId: string): string[] {
    const id = requireText(termId, "Term id");
    const rows = this.db
      .prepare(
        `SELECT term_id, related_id FROM term_relations
         WHERE relation_type = 'conflict' AND (term_id = ? OR related_id = ?)`,
      )
      .all(id, id) as { term_id: string; related_id: string }[];
    const conflicts = new Set<string>();
    for (const row of rows) {
      conflicts.add(row.term_id === id ? row.related_id : row.term_id);
    }
    return [...conflicts].sort();
  }

  addModelProfile(input: CreatePromptModelProfileDTO): PromptModelProfile {
    const id =
      input.id === undefined
        ? uuidv4()
        : requireText(input.id, "Model profile id");
    const name = requireText(input.name, "Model profile name");
    if (!MODEL_KINDS.has(input.kind)) {
      throw new Error(`Unsupported model profile kind: ${input.kind}`);
    }
    const triggerWords = input.triggerWords ?? [];
    if (!Array.isArray(triggerWords)) {
      throw new Error("Model triggerWords must be an array of strings");
    }
    for (const word of triggerWords) {
      requireText(word, "Model trigger word");
    }
    this.db
      .prepare(
        `INSERT INTO model_profiles (
          id, name, kind, trigger_words, weight_range, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        input.kind,
        JSON.stringify(triggerWords),
        optionalText(input.weightRange, "Model weightRange"),
        optionalText(input.notes, "Model notes"),
      );
    return this.getModelProfile(id)!;
  }

  getModelProfile(id: string): PromptModelProfile | null {
    const row = this.db
      .prepare("SELECT * FROM model_profiles WHERE id = ?")
      .get(id) as ModelProfileRow | undefined;
    return row ? rowToModelProfile(row) : null;
  }

  addValidation(input: CreatePromptValidationDTO): PromptValidationRecord {
    const termId = requireText(input.termId, "Validation term id");
    this.assertTermExists(termId);
    if (!VALIDATION_OUTCOMES.has(input.outcome)) {
      throw new Error(`Unsupported validation outcome: ${input.outcome}`);
    }
    const params = input.params ?? null;
    if (params !== null && !isRecord(params)) {
      throw new Error("Validation params must be a JSON object or null");
    }
    if (params !== null && containsNullByte(params)) {
      throw new Error("Validation params contain a null byte");
    }
    const paramsJson = params === null ? null : JSON.stringify(params);
    const result = this.db
      .prepare(
        `INSERT INTO validation_records (
          term_id, model_id, params, outcome, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        termId,
        optionalText(input.modelId, "Validation model id"),
        paramsJson,
        input.outcome,
        optionalText(input.notes, "Validation notes"),
        toTimestamp(input.createdAt),
      );
    const row = this.db
      .prepare("SELECT * FROM validation_records WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as ValidationRecordRow | undefined;
    if (!row) {
      throw new Error(`Validation record insert failed for term ${termId}`);
    }
    return rowToValidation(row);
  }

  listValidation(termId: string): PromptValidationRecord[] {
    const id = requireText(termId, "Term id");
    const rows = this.db
      .prepare(
        `SELECT * FROM validation_records
         WHERE term_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(id) as ValidationRecordRow[];
    return rows.map(rowToValidation);
  }

  /**
   * Import a prompt-forge kb.json payload. Term ids are deterministic
   * (`category:en`, or `category:series:en` for series-specific terms) and
   * inserts use OR IGNORE, so re-importing the same KB is idempotent.
   * Pool/tag series and tag template fields are optional. Malformed entries
   * are counted in `skipped`.
   */
  importFromKbJson(kb: unknown): PromptKbImportResult {
    if (!isRecord(kb)) {
      throw new Error("Invalid prompt KB JSON: expected an object");
    }
    const pools = kb.field_pools;
    if (pools !== undefined && !isRecord(pools)) {
      throw new Error("Invalid prompt KB JSON: field_pools must be an object");
    }
    const characters = kb.characters;
    if (characters !== undefined && !Array.isArray(characters)) {
      throw new Error("Invalid prompt KB JSON: characters must be an array");
    }
    const assets = kb.assets;
    if (assets !== undefined && !Array.isArray(assets)) {
      throw new Error("Invalid prompt KB JSON: assets must be an array");
    }
    const result: PromptKbImportResult = {
      terms: 0,
      characters: 0,
      assets: 0,
      skipped: 0,
    };
    const now = Date.now();
    const runImport = this.db.transaction(() => {
      if (isRecord(pools)) this.importFieldPools(pools, now, result);
      if (Array.isArray(characters)) {
        this.importCharacters(characters, now, result);
      }
      if (Array.isArray(assets)) this.importAssets(assets, now, result);
    });
    runImport();
    return result;
  }

  private importFieldPools(
    pools: Record<string, unknown>,
    now: number,
    result: PromptKbImportResult,
  ): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO prompt_terms (
        id, category, en, zh, series, template, applicable_models,
        validation_status, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 'unvalidated', 'prompt-forge-html', ?)`,
    );
    for (const [category, pool] of Object.entries(pools)) {
      if (
        category.trim().length === 0 ||
        category.includes("\0") ||
        !isRecord(pool) ||
        !Array.isArray(pool.tags) ||
        !isImportableNullableText(pool.series)
      ) {
        result.skipped += 1;
        continue;
      }
      for (const tag of pool.tags) {
        if (!this.isImportableTag(tag)) {
          result.skipped += 1;
          continue;
        }
        const zh = typeof tag.zh === "string" ? tag.zh : null;
        const series = nullableImportText(
          tag.series !== undefined ? tag.series : pool.series,
        );
        const template = nullableImportText(tag.template);
        const id = series
          ? `${category}:${series}:${tag.en}`
          : `${category}:${tag.en}`;
        const inserted = stmt.run(
          id,
          category,
          tag.en,
          zh,
          series,
          template,
          now,
        );
        if (inserted.changes > 0) result.terms += 1;
      }
    }
  }

  private isImportableTag(tag: unknown): tag is {
    en: string;
    zh?: unknown;
    series?: unknown;
    template?: unknown;
  } {
    if (!isRecord(tag)) return false;
    if (typeof tag.en !== "string" || tag.en.trim().length === 0) return false;
    if (tag.en.includes("\0")) return false;
    return (
      isImportableNullableText(tag.zh) &&
      isImportableNullableText(tag.series) &&
      isImportableNullableText(tag.template)
    );
  }

  private importCharacters(
    characters: unknown[],
    now: number,
    result: PromptKbImportResult,
  ): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO source_assets (id, kind, path, title, meta, created_at)
       VALUES (?, 'character', NULL, ?, ?, ?)`,
    );
    for (const entry of characters) {
      if (!isRecord(entry)) {
        result.skipped += 1;
        continue;
      }
      const tag =
        typeof entry.tag === "string" && entry.tag.trim() ? entry.tag : null;
      const name =
        typeof entry.name === "string" && entry.name.trim() ? entry.name : null;
      if (tag === null && name === null) {
        result.skipped += 1;
        continue;
      }
      const gameTag =
        typeof entry.game_tag === "string" && entry.game_tag.trim()
          ? entry.game_tag
          : "unknown";
      const id = `character:${gameTag}:${tag ?? name}`;
      const metaJson = JSON.stringify(pickMeta(entry, KB_CHARACTER_META_KEYS));
      if (this.hasNullByte(id, name, metaJson)) {
        result.skipped += 1;
        continue;
      }
      const inserted = stmt.run(id, name ?? tag, metaJson, now);
      if (inserted.changes > 0) result.characters += 1;
    }
  }

  private importAssets(
    assets: unknown[],
    now: number,
    result: PromptKbImportResult,
  ): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO source_assets (id, kind, path, title, meta, created_at)
       VALUES (?, 'mosa', ?, NULL, ?, ?)`,
    );
    for (const entry of assets) {
      if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) {
        result.skipped += 1;
        continue;
      }
      const path =
        typeof entry.preview_path === "string" && entry.preview_path
          ? entry.preview_path
          : typeof entry.original_path === "string" && entry.original_path
            ? entry.original_path
            : null;
      const metaJson = JSON.stringify(pickMeta(entry, KB_ASSET_META_KEYS));
      if (this.hasNullByte(entry.id, path, metaJson)) {
        result.skipped += 1;
        continue;
      }
      const inserted = stmt.run(entry.id, path, metaJson, now);
      if (inserted.changes > 0) result.assets += 1;
    }
  }

  private hasNullByte(...values: (string | null)[]): boolean {
    return values.some((value) => value !== null && value.includes("\0"));
  }

  private assertTermExists(termId: string): void {
    const exists = this.db
      .prepare("SELECT 1 FROM prompt_terms WHERE id = ?")
      .get(termId);
    if (!exists) {
      throw new Error(`Prompt term does not exist: ${termId}`);
    }
  }
}