import type {
  PromptArtistInjection,
  PromptArtistPipeline,
  PromptArtistRoute,
  PromptOrchestrationInput,
  PromptSelectedTerm,
} from "@prompthub/shared/types";
import { splitEntityName } from "@prompthub/shared/utils/prompt-entity-key";

/**
 * Kaloscope Style Adapter takes the artist as node parameters, not prompt text.
 * Values mirror the verified local workflow
 * `▶◇MOSS-Image-25&50步-Kaloscope画师风格-Base.json`; the base model must be
 * MOSS-Image Base (not SFT) because the adapter is trained against it.
 */
export const KALOSCOPE_ARTIST_DEFAULTS = {
  bank: "artist-v1.safetensors",
  styleGuidance: 6,
  adapterStrength: 1,
  baseModel: "MOSS-Image Base",
} as const;

export function resolveArtistPipeline(
  input: PromptOrchestrationInput,
): PromptArtistPipeline {
  if (input.targetPipeline) return input.targetPipeline;
  if (input.skill === "k2") return "k2";
  if (input.skill === "moss" || input.skill === "moodyMoss") return "moss";
  if (input.skill === "minimaxH3") return "h3";
  return "unknown";
}

export interface ArtistRoutingResult {
  /** Terms that may enter the prompt body; artist rows are rewritten or removed. */
  terms: PromptSelectedTerm[];
  routes: PromptArtistRoute[];
  warnings: string[];
}

function artistName(term: PromptSelectedTerm): string {
  return splitEntityName(term.en).head;
}

function injectionFor(name: string): PromptArtistInjection {
  return {
    artistName: name,
    bank: KALOSCOPE_ARTIST_DEFAULTS.bank,
    styleGuidance: KALOSCOPE_ARTIST_DEFAULTS.styleGuidance,
    adapterStrength: KALOSCOPE_ARTIST_DEFAULTS.adapterStrength,
    baseModel: KALOSCOPE_ARTIST_DEFAULTS.baseModel,
  };
}

/**
 * Splits artist terms out of the prompt body by target pipeline. Anima consumes
 * `@artist`; Kaloscope consumes node parameters; MOSS/Krea2/H3 do not parse
 * `@`, so an explicit artist survives only as a plain MOSS tag and never enters
 * any other pipeline's text. Automatic artist selection is excluded upstream.
 */
export function routeArtistTerms(
  terms: PromptSelectedTerm[],
  pipeline: PromptArtistPipeline,
): ArtistRoutingResult {
  const kept: PromptSelectedTerm[] = [];
  const routes: PromptArtistRoute[] = [];
  const warnings = new Set<string>();
  for (const term of terms) {
    if (term.category !== "artist") {
      kept.push(term);
      continue;
    }
    const name = artistName(term);
    if (!name) {
      warnings.add(`Artist term ${term.id} has no usable name and was left out of the prompt.`);
      continue;
    }
    if (pipeline === "anima") {
      const token = `@${name}`;
      kept.push({ ...term, en: token });
      routes.push({
        pipeline,
        termId: term.id,
        artistName: name,
        promptToken: token,
        injection: null,
        reason: "Anima parses @artist natively.",
      });
      continue;
    }
    if (pipeline === "moss") {
      // MOSS does not parse @; an explicitly chosen artist stays a plain tag.
      kept.push({ ...term, en: name });
      routes.push({
        pipeline,
        termId: term.id,
        artistName: name,
        promptToken: name,
        injection: null,
        reason: "MOSS ignores @artist; the explicit artist is kept as a plain tag.",
      });
      warnings.add("MOSS does not parse @artist; artist names are kept as plain tags.");
      continue;
    }
    if (pipeline === "kaloscope") {
      routes.push({
        pipeline,
        termId: term.id,
        artistName: name,
        promptToken: null,
        injection: injectionFor(name),
        reason:
          "Kaloscope injects the artist through KaloscopeStyleArtist node parameters, not prompt text.",
      });
      warnings.add(
        "Kaloscope takes the artist as node parameters; the name was removed from the prompt body.",
      );
      continue;
    }
    routes.push({
      pipeline,
      termId: term.id,
      artistName: name,
      promptToken: null,
      injection: null,
      reason:
        pipeline === "k2"
          ? "Krea 2 consumes captions only and has no artist-token syntax."
          : pipeline === "h3"
            ? "MiniMax-H3 video prompts have no artist-token syntax."
            : "Target pipeline is unknown, so the artist stays out of the prompt body.",
    });
    warnings.add(
      pipeline === "unknown"
        ? "Target pipeline is unknown; artist names were kept out of the prompt body."
        : `${pipeline} has no artist-token syntax; artist names were kept out of the prompt body.`,
    );
  }
  return { terms: kept, routes, warnings: [...warnings] };
}
