import { useTranslation } from "react-i18next";
import {
  localContextPresetOf,
  type LocalLlamaContextPreset,
  type LocalLlamaKvCacheType,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";

interface LocalContextPresetPickerProps {
  contextSize: number;
  kvCacheType: LocalLlamaKvCacheType;
  kvOffload: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect: (preset: LocalLlamaContextPreset) => void;
}

const PRESETS: LocalLlamaContextPreset[] = ["8k", "32k", "64k"];

export function LocalContextPresetPicker({
  contextSize,
  kvCacheType,
  kvOffload,
  disabled = false,
  hint,
  onSelect,
}: LocalContextPresetPickerProps) {
  const { t } = useTranslation();
  const active = localContextPresetOf({ contextSize, kvCacheType, kvOffload });
  const activeHint =
    active === "custom"
      ? t("localModel.contextPresetCustomHint")
      : t(`localModel.contextPreset${active}Hint`);

  return (
    <div className="space-y-2" data-testid="local-context-preset">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("localModel.contextPreset")}</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={active === preset ? "primary" : "secondary"}
              disabled={disabled}
              onClick={() => onSelect(preset)}
              data-testid={`context-preset-${preset}`}
            >
              {t(`localModel.contextPreset${preset}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="local-context-preset-hint">
        {activeHint}
      </p>
      {hint && (
        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="local-context-preset-recommendation">
          {hint}
        </p>
      )}
    </div>
  );
}

