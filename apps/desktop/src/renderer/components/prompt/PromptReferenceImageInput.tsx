import { useRef } from "react";
import { ClipboardIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PromptOrchestrationMode } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import type { OrchestratorReferenceImage } from "./usePromptOrchestratorWorkbench";
import { referenceImageLimit } from "./prompt-orchestrator-catalog";

interface PromptReferenceImageInputProps {
  mode: PromptOrchestrationMode;
  images: OrchestratorReferenceImage[];
  onFiles: (files: File[]) => void;
  onNativePaste: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function PromptReferenceImageInput({
  mode,
  images,
  onFiles,
  onNativePaste,
  onRemove,
  onClear,
}: PromptReferenceImageInputProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const limit = referenceImageLimit(mode);
  const browse = () => fileInput.current?.click();
  const acceptFiles = (files: File[]) => {
    const incoming = files.filter((file) => file.type.startsWith("image/"));
    // Reverse replaces the working image; other modes append up to the limit.
    const remaining = mode === "reverse" ? limit : Math.max(0, limit - images.length);
    if (incoming.length > 0) onFiles(incoming.slice(0, remaining));
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const files = itemFiles.length > 0 ? itemFiles : Array.from(event.clipboardData.files);
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      acceptFiles(files);
    } else {
      event.preventDefault();
      onNativePaste();
    }
  };
  return (
    <div className="space-y-3" onPaste={handlePaste}>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        data-testid="orchestrator-image-file-input"
        onChange={(event) => {
          acceptFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label={t("orchestrator.imageDropzone")}
        className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 text-center outline-none transition-colors focus:ring-2 focus:ring-primary/30"
        onClick={browse}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
            event.preventDefault();
            onNativePaste();
            return;
          }
          if (event.key === "Enter" || event.key === " ") browse();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          acceptFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <ClipboardIcon className="mx-auto mb-2 h-5 w-5 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">{t("orchestrator.imageDropzone")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("orchestrator.imageDropzoneHint", { count: limit })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={browse}
          disabled={images.length >= limit}
        >
          <ImagePlusIcon className="h-4 w-4" aria-hidden="true" />
          {t("orchestrator.addImages")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNativePaste}
          disabled={images.length >= limit}
        >
          <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
          {t("orchestrator.pasteImage")}
        </Button>
        {images.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-testid="orchestrator-clear-images"
          >
            <XIcon className="h-4 w-4" aria-hidden="true" />
            {t("orchestrator.clearImages")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {images.map((image, index) => (
          <div key={image.id} className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
            <img src={image.dataUrl} alt={image.fileName} className="h-28 w-full object-cover" />
            <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs">
              <span className="truncate">
                {mode === "video-frames"
                  ? index === 0
                    ? t("orchestrator.firstFrame")
                    : t("orchestrator.lastFrame")
                  : `${t("orchestrator.referenceImage")} ${index + 1}`}
              </span>
              <button
                type="button"
                aria-label={t("orchestrator.removeImage")}
                onClick={() => onRemove(image.id)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
