import type { PromptKnowledgeModuleSelection } from "@prompthub/shared/types";

export interface KnowledgeSkillConflict {
  group: string;
  packs: string[];
}

/**
 * Two packs that both claim one contract group are competing primary skills.
 * The run must keep one of them, never merge the two structures.
 */
export function findKnowledgeSkillConflict(
  modules: Array<Pick<PromptKnowledgeModuleSelection, "id" | "packId" | "packName" | "role" | "contractGroups">>,
): KnowledgeSkillConflict | null {
  const owners = new Map<string, Set<string>>();
  const labels = new Map<string, string>();
  for (const module of modules) {
    if (module.role !== "contract") continue;
    const groups = module.contractGroups ?? [];
    if (groups.length === 0) continue;
    const packKey = module.packId ?? module.packName ?? module.id;
    labels.set(packKey, module.packName ?? module.packId ?? module.id);
    for (const group of groups) {
      const set = owners.get(group) ?? new Set<string>();
      set.add(packKey);
      owners.set(group, set);
    }
  }
  for (const [group, packs] of owners) {
    if (packs.size > 1) {
      return { group, packs: [...packs].map((key) => labels.get(key) ?? key) };
    }
  }
  return null;
}