/**
 * Structured prompt vocabulary (prompt-vocab domain).
 *
 * SQLite owns these records (packages/db prompt-vocab tables); JSON columns
 * (applicable_models, trigger_words, params, meta) are exposed as parsed
 * values on the record types.
 */

export type PromptTermValidationStatus =
  | "pending"
  | "unvalidated"
  | "validated"
  | "deprecated";

export type PromptTermRelationType =
  | "synonym"
  | "combinable"
  | "conflict"
  | "precondition";

export type PromptModelProfileKind = "base" | "lora";

/**
 * Subject domain a term belongs to.
 *
 * `shared` covers descriptors that work for any subject (hair, pose, clothing,
 * environment, lighting, camera). `anime`, `real` and `3d` mark terms that only
 * make sense inside that rendering world, such as cel shading, photorealistic
 * photography or a named anime character.
 */
export type PromptTermDomain = "shared" | "anime" | "real" | "3d";

export type PromptValidationOutcome = "good" | "bad" | "neutral";

export interface PromptTerm {
  id: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  /** Null means the term is generic across series. */
  series: string | null;
  /** Optional long-form phrase; en remains the short canonical term. */
  template: string | null;
  function: string | null;
  applicableTask: string | null;
  /** Model ids this term applies to; an empty array means all models. */
  applicableModels: string[];
  source: string | null;
  domain: PromptTermDomain;
  validationStatus: PromptTermValidationStatus;
  createdAt: string;
}

export interface CreatePromptTermDTO {
  id?: string;
  category: string;
  subcategory?: string | null;
  en: string;
  zh?: string | null;
  series?: string | null;
  template?: string | null;
  function?: string | null;
  applicableTask?: string | null;
  applicableModels?: string[];
  source?: string | null;
  domain?: PromptTermDomain;
  validationStatus?: PromptTermValidationStatus;
  createdAt?: string;
}

export interface PromptTermRelation {
  id: number;
  termId: string;
  relatedId: string;
  relationType: PromptTermRelationType;
}

export interface PromptModelProfile {
  id: string;
  name: string;
  kind: PromptModelProfileKind;
  triggerWords: string[];
  weightRange: string | null;
  notes: string | null;
}

export interface CreatePromptModelProfileDTO {
  id?: string;
  name: string;
  kind: PromptModelProfileKind;
  triggerWords?: string[];
  weightRange?: string | null;
  notes?: string | null;
}

export interface PromptValidationRecord {
  id: number;
  termId: string;
  modelId: string | null;
  params: Record<string, unknown> | null;
  outcome: PromptValidationOutcome;
  notes: string | null;
  createdAt: string;
}

export interface CreatePromptValidationDTO {
  termId: string;
  modelId?: string | null;
  params?: Record<string, unknown> | null;
  outcome: PromptValidationOutcome;
  notes?: string | null;
  createdAt?: string;
}

export interface PromptSourceAsset {
  id: string;
  kind: string | null;
  path: string | null;
  title: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** Counts of newly inserted rows; `skipped` counts malformed KB entries. */
export interface PromptKbImportResult {
  terms: number;
  characters: number;
  assets: number;
  skipped: number;
}

export type PromptTermAliasKind = "canonical" | "series_less" | "zh" | "curated";
export type PromptTermAliasOrigin = "derived" | "curated";

/** One alternative spelling that resolves to a stored term. */
export interface PromptTermAlias {
  id: number;
  termId: string;
  alias: string;
  /** Normalized lookup key (`normalizeEntityKey`). */
  aliasKey: string;
  kind: PromptTermAliasKind;
  origin: PromptTermAliasOrigin;
  createdAt: string;
}

export interface CreatePromptTermAliasDTO {
  termId: string;
  alias: string;
  kind: PromptTermAliasKind;
  origin?: PromptTermAliasOrigin;
  createdAt?: string;
}

/** Alias row joined with the term it identifies. */
export interface PromptTermAliasMatch extends PromptTermAlias {
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  series: string | null;
  domain: PromptTermDomain;
  validationStatus: PromptTermValidationStatus;
}