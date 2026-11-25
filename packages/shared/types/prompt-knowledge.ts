/**
 * Knowledge packs are read-only text modules imported from prompt/new assets.
 * They are separate from rule cards (output grammar), the vocabulary library
 * (candidate terms) and Agent Skills (executable workflows).
 */
export type PromptKnowledgePackKind = "skill" | "knowledge" | "preset" | "reference";

export type PromptKnowledgePackStatus = "ready" | "needs-review" | "disabled";

/** Writing-layer position: P = principles, S = structure, H = handoff. */
export type PromptKnowledgeModuleLayer = "P" | "S" | "H";

export type PromptKnowledgeModulePriority = "P0" | "P1" | "P2";

/**
 * How a module participates in a run:
 * - contract: always-on execution contract that ships with the skill;
 * - knowledge: selectable methodology constrained by the layer budget;
 * - reference: retrieved style material (for example director cards).
 */
export type PromptKnowledgeModuleRole = "contract" | "knowledge" | "reference";

/** Contract groups let one pack ship separate always-on sets per project type. */
export type PromptKnowledgeContractGroup = "script" | "storyboard" | "novel";

export type PromptKnowledgeLinkRelation =
  | "uses"
  | "recommends"
  | "depends_on"
  | "derivedFrom";

export interface PromptKnowledgeLink {
  relation: PromptKnowledgeLinkRelation;
  targetType: "pack" | "module";
  /** Pack name/id or module_key; resolved softly, never auto-imported. */
  targetKey: string;
}

export interface PromptKnowledgePack {
  id: string;
  name: string;
  kind: PromptKnowledgePackKind;
  sourcePath?: string;
  /** Hash of the pack source so a re-import can detect an unchanged pack. */
  sourceHash: string;
  version?: string;
  variant?: string;
  status: PromptKnowledgePackStatus;
  /** Declared soft references to other packs/modules; never auto-imported. */
  links?: PromptKnowledgeLink[];
  createdAt: number;
  updatedAt: number;
}

export interface PromptKnowledgeModule {
  id: string;
  packId: string;
  /** Stable per-pack key, unique within the pack. */
  moduleKey: string;
  title: string;
  category?: string;
  scope?: string;
  priority?: PromptKnowledgeModulePriority;
  role: PromptKnowledgeModuleRole;
  /** Contract-only: which project group(s) activate this contract. */
  contractGroups: PromptKnowledgeContractGroup[];
  layer?: PromptKnowledgeModuleLayer;
  triggers: string[];
  dependsOn: string[];
  content: string;
  contentHash: string;
  tokens: number;
  /** Draw/display order inside the pack. */
  ord: number;
}

export interface PromptKnowledgeImportSkipped {
  path: string;
  reason: string;
}

export type PromptKnowledgeConflictReason = "duplicate-content" | "module-key";

export interface PromptKnowledgeImportConflict {
  packName: string;
  moduleKey: string;
  existingHash: string;
  incomingHash: string;
  reason: PromptKnowledgeConflictReason;
}

export interface PromptKnowledgeModulePreview {
  moduleKey: string;
  title: string;
  category?: string;
  scope?: string;
  priority?: PromptKnowledgeModulePriority;
  role: PromptKnowledgeModuleRole;
  contractGroups: PromptKnowledgeContractGroup[];
  layer: PromptKnowledgeModuleLayer;
  triggers: string[];
  dependsOn: string[];
  tokens: number;
  bytes: number;
  contentHash: string;
  /** Display order after dedupe. */
  ord: number;
}

export interface PromptKnowledgePackPreview {
  name: string;
  kind: PromptKnowledgePackKind;
  sourcePath: string;
  version?: string;
  variant?: string;
  links?: PromptKnowledgeLink[];
  modules: PromptKnowledgeModulePreview[];
  skipped: PromptKnowledgeImportSkipped[];
}

export interface PromptKnowledgeImportPreview {
  packs: PromptKnowledgePackPreview[];
  moduleCount: number;
  totalBytes: number;
  totalTokens: number;
  skipped: PromptKnowledgeImportSkipped[];
  conflicts: PromptKnowledgeImportConflict[];
}

export interface PromptKnowledgeImportCommitResult {
  packIds: string[];
  moduleCount: number;
  skipped: PromptKnowledgeImportSkipped[];
  conflicts: PromptKnowledgeImportConflict[];
}

export type PromptKnowledgeIPCReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface DesktopPromptKnowledgePreviewRequest {
  rootPath: string;
}

export interface DesktopPromptKnowledgeCommitRequest {
  preview: PromptKnowledgeImportPreview;
  /** Optional display name override (for example the directory name). */
  packName?: string;
  /** Import only these module keys; defaults to the whole preview. */
  moduleKeys?: string[];
}
