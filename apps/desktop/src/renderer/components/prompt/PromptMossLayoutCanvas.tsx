import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxIcon,
  Grid2X2Icon,
  ImageDownIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import type {
  PromptMossLayoutBox,
  PromptMossNormalizedBBox,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import type { useMossLayoutEditor } from "./useMossLayoutEditor";
import { MOSS_ASPECT_RATIOS, MOSS_MEGAPIXEL_OPTIONS, MOSS_RECOMMENDED_MEGAPIXELS, mossResolution } from "./prompt-orchestrator-catalog";

type Editor = ReturnType<typeof useMossLayoutEditor>;
type Point = { x: number; y: number };
type Interaction =
  | { kind: "draw"; id: string; start: Point }
  | { kind: "move" | "resize"; id: string; start: Point; bbox: PromptMossNormalizedBBox };

const MIN_BOX_SIZE = 10;

function clamp(value: number, min = 0, max = 1000): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedBBox(start: Point, end: Point): PromptMossNormalizedBBox {
  return [
    Math.round(Math.min(start.y, end.y)),
    Math.round(Math.min(start.x, end.x)),
    Math.round(Math.max(start.y, end.y)),
    Math.round(Math.max(start.x, end.x)),
  ];
}

function boxStyle(box: PromptMossLayoutBox) {
  return {
    left: `${box.bbox[1] / 10}%`,
    top: `${box.bbox[0] / 10}%`,
    width: `${(box.bbox[3] - box.bbox[1]) / 10}%`,
    height: `${(box.bbox[2] - box.bbox[0]) / 10}%`,
  };
}

function ratioShapeStyle(width: string, height: string) {
  const ratio = Number(width) / Number(height);
  return {
    aspectRatio: `${width} / ${height}`,
    width: ratio >= 1 ? "24px" : `${24 * ratio}px`,
    height: ratio >= 1 ? `${24 / ratio}px` : "24px",
  };
}

export function PromptMossLayoutCanvas({
  editor,
  onRefineCaptions,
  onReverseFromImage,
  isAssisting = false,
  assistNote = "",
  assistDisabled = false,
}: {
  editor: Editor;
  onRefineCaptions?: () => void;
  onReverseFromImage?: (file: File) => void;
  isAssisting?: boolean;
  assistNote?: string;
  assistDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const reverseInputRef = useRef<HTMLInputElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const numericWidth = Number(editor.width) || 1024;
  const numericHeight = Number(editor.height) || 1024;

  function point(event: ReactPointerEvent): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 1000),
      y: clamp(((event.clientY - rect.top) / rect.height) * 1000),
    };
  }

  function capture(event: ReactPointerEvent): void {
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || editor.boxes.length >= 32) return;
    if ((event.target as HTMLElement).closest("[data-layout-box]")) return;
    const start = point(event);
    const id = crypto.randomUUID();
    const box: PromptMossLayoutBox = {
      id,
      label: "object",
      caption: "",
      bbox: [start.y, start.x, start.y, start.x],
    };
    editor.setBoxes((current) => [...current, box]);
    editor.setSelectedBoxId(id);
    interaction.current = { kind: "draw", id, start };
    capture(event);
    event.preventDefault();
  }

  function beginMove(event: ReactPointerEvent, box: PromptMossLayoutBox): void {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-layout-resize]")) return;
    event.stopPropagation();
    editor.setSelectedBoxId(box.id);
    interaction.current = { kind: "move", id: box.id, start: point(event), bbox: box.bbox };
    capture(event);
    event.preventDefault();
  }

  function beginResize(event: ReactPointerEvent, box: PromptMossLayoutBox): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    editor.setSelectedBoxId(box.id);
    interaction.current = { kind: "resize", id: box.id, start: point(event), bbox: box.bbox };
    capture(event);
    event.preventDefault();
  }

  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = interaction.current;
    if (!active) return;
    const current = point(event);
    if (active.kind === "draw") {
      editor.updateBox(active.id, { bbox: normalizedBBox(active.start, current) });
      return;
    }
    const [top, left, bottom, right] = active.bbox;
    if (active.kind === "resize") {
      editor.updateBox(active.id, {
        bbox: [
          top,
          left,
          Math.round(clamp(current.y, top + MIN_BOX_SIZE)),
          Math.round(clamp(current.x, left + MIN_BOX_SIZE)),
        ],
      });
      return;
    }
    const dx = current.x - active.start.x;
    const dy = current.y - active.start.y;
    const boxWidth = right - left;
    const boxHeight = bottom - top;
    const nextLeft = clamp(left + dx, 0, 1000 - boxWidth);
    const nextTop = clamp(top + dy, 0, 1000 - boxHeight);
    editor.updateBox(active.id, {
      bbox: [
        Math.round(nextTop),
        Math.round(nextLeft),
        Math.round(nextTop + boxHeight),
        Math.round(nextLeft + boxWidth),
      ],
    });
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = interaction.current;
    if (!active) return;
    if (active.kind === "draw") {
      const box = editor.boxes.find((item) => item.id === active.id);
      if (!box || box.bbox[2] - box.bbox[0] < MIN_BOX_SIZE || box.bbox[3] - box.bbox[1] < MIN_BOX_SIZE) {
        editor.removeBox(active.id);
      }
    }
    interaction.current = null;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function updateCoordinate(box: PromptMossLayoutBox, index: 0 | 1 | 2 | 3, raw: string): void {
    const value = clamp(Math.round(Number(raw) || 0));
    const next = [...box.bbox] as PromptMossNormalizedBBox;
    next[index] = value;
    if (next[0] >= next[2] || next[1] >= next[3]) return;
    editor.updateBox(box.id, { bbox: next });
  }

  const selectedIndex = editor.selectedBox
    ? editor.boxes.findIndex((box) => box.id === editor.selectedBox?.id)
    : -1;

  const canvasWidth = Number(editor.width);
  const canvasHeight = Number(editor.height);
  // USERGUIDE: manual width/height must be positive multiples of 16 or the model errors out.
  const dimensionInvalid =
    !Number.isInteger(canvasWidth) ||
    !Number.isInteger(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    canvasWidth % 16 !== 0 ||
    canvasHeight % 16 !== 0;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card/20 p-4" data-testid="moss-layout-editor">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Grid2X2Icon className="h-4 w-4" aria-hidden="true" />
          {t("orchestrator.layout.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("orchestrator.layout.description")}</p>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="layout-preset-grid">
          {MOSS_ASPECT_RATIOS.map((entry) => {
            const size = mossResolution(entry.label, Number(editor.megapixels));
            if (!size) return null;
            const active = editor.ratio === entry.label;
            return (
              <Button
                key={entry.label}
                size="sm"
                variant={active ? "primary" : "secondary"}
                className="h-auto min-w-0 flex-col gap-1 px-2 py-2"
                onClick={() => editor.setRatio(entry.label)}
                data-testid={`layout-preset-${entry.label.replace(":", "-")}`}
              >
                <span className="flex h-7 w-7 items-center justify-center" aria-hidden="true">
                  <span className="block border-2 border-current" style={ratioShapeStyle(String(size.width), String(size.height))} />
                </span>
                <span>{entry.label}</span>
                <span className="text-[10px] font-normal opacity-70">
                  {size.width}×{size.height}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
            {t("orchestrator.layout.megapixels")}
          </span>
          <div className="w-36" data-testid="layout-megapixels">
            <Select
              value={editor.megapixels}
              onChange={editor.setMegapixels}
              ariaLabel={t("orchestrator.layout.megapixels")}
              options={MOSS_MEGAPIXEL_OPTIONS.map((option) => ({
                value: option,
                label: `${option} MP`,
                labelText: `${option} MP`,
              }))}
            />
          </div>
        </div>
        {(Number(editor.megapixels) < MOSS_RECOMMENDED_MEGAPIXELS.min ||
          Number(editor.megapixels) > MOSS_RECOMMENDED_MEGAPIXELS.max) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="layout-megapixel-warning">
              {t("orchestrator.layout.megapixelWarning")}
            </p>
          )}
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("orchestrator.width")} type="number" min={16} step={16} value={editor.width} onChange={(event) => editor.setWidth(event.target.value)} variant="outlined" />
          <Input label={t("orchestrator.height")} type="number" min={16} step={16} value={editor.height} onChange={(event) => editor.setHeight(event.target.value)} variant="outlined" />
        </div>
        {dimensionInvalid && (
          <p className="text-[11px] text-destructive" data-testid="layout-dimension-invalid">
            {t("orchestrator.layout.dimensionInvalid")}
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("orchestrator.layout.dimensionHint")}</p>

      {(onRefineCaptions || onReverseFromImage) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
          {onRefineCaptions && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRefineCaptions}
              disabled={assistDisabled || isAssisting || editor.boxes.length === 0}
              data-testid="layout-refine-captions"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              {isAssisting
                ? t("orchestrator.layout.assisting")
                : t("orchestrator.layout.refineCaptions")}
            </Button>
          )}
          {onReverseFromImage && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => reverseInputRef.current?.click()}
                disabled={assistDisabled || isAssisting}
                data-testid="layout-reverse-image"
              >
                <ImageDownIcon className="h-3.5 w-3.5" />
                {t("orchestrator.layout.reverseFromImage")}
              </Button>
              <input
                ref={reverseInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-testid="layout-reverse-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onReverseFromImage(file);
                }}
              />
            </>
          )}
          <span className="text-[11px] text-muted-foreground">
            {t("orchestrator.layout.assistHint")}
          </span>
          {assistNote && (
            <p className="basis-full text-[11px] text-amber-600 dark:text-amber-400" data-testid="layout-assist-note">
              {assistNote}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => editor.addBox("background")} data-testid="layout-add-background">
              <PlusIcon className="h-3.5 w-3.5" />{t("orchestrator.layout.addBackground")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => editor.addBox("object")} data-testid="layout-add-object">
              <BoxIcon className="h-3.5 w-3.5" />{t("orchestrator.layout.addObject")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => editor.addBox("text")} data-testid="layout-add-text">
              <TypeIcon className="h-3.5 w-3.5" />{t("orchestrator.layout.addText")}
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
              {t("orchestrator.layout.grid")}
            </label>
          </div>

          <div className={`mx-auto w-full ${numericHeight > numericWidth ? "max-w-[440px]" : "max-w-[780px]"}`}>
            <div
              ref={canvasRef}
              className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-border bg-muted/20"
              style={{
                aspectRatio: `${numericWidth} / ${numericHeight}`,
                backgroundImage: showGrid
                  ? "linear-gradient(to right, color-mix(in srgb, var(--border) 65%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 65%, transparent) 1px, transparent 1px)"
                  : undefined,
                backgroundSize: showGrid ? "10% 10%" : undefined,
              }}
              onPointerDown={beginDraw}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
              data-testid="moss-layout-canvas"
            >
              {editor.boxes.map((box, index) => {
                const selected = box.id === editor.selectedBoxId;
                const missingCaption = !box.caption.trim();
                const missingText = box.label === "text" && !box.text?.trim();
                const incomplete = missingCaption || missingText;
                return (
                  <div
                    key={box.id}
                    role="button"
                    tabIndex={0}
                    aria-label={t("orchestrator.layout.boxLabel", { index: index + 1, label: box.label })}
                    className={`absolute cursor-move overflow-hidden border-2 text-[10px] ${
                      box.label === "text" ? "border-violet-500 bg-violet-500/10" : "border-sky-500 bg-sky-500/10"
                    } ${incomplete ? "border-dashed ring-1 ring-amber-400" : ""} ${selected ? "z-10 ring-2 ring-primary ring-offset-1" : ""}`}
                    style={boxStyle(box)}
                    onPointerDown={(event) => beginMove(event, box)}
                    onClick={() => editor.setSelectedBoxId(box.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") editor.setSelectedBoxId(box.id);
                    }}
                    data-layout-box={box.id}
                    data-layout-incomplete={incomplete ? "1" : undefined}
                    data-testid={`layout-box-${index + 1}`}
                  >
                    <span className="pointer-events-none absolute left-0 top-0 max-w-full truncate bg-background/85 px-1.5 py-0.5 font-medium">
                      {index + 1} · {box.label === "text" ? t("orchestrator.layout.textBox") : t("orchestrator.layout.objectBox")}
                      {box.character ? ` · ${t("orchestrator.layout.characterBadge")}` : ""}
                    </span>
                    {incomplete && (
                      <span className="pointer-events-none absolute right-0 top-0 bg-amber-400 px-1 py-0.5 text-[9px] font-semibold text-black">
                        {missingCaption
                          ? t("orchestrator.layout.missingCaption")
                          : t("orchestrator.layout.missingText")}
                      </span>
                    )}
                    {box.needsReview && (
                      <span className="pointer-events-none absolute bottom-0 left-0 bg-violet-600 px-1 py-0.5 text-[9px] font-semibold text-white">
                        {t("orchestrator.layout.needsReview")}
                      </span>
                    )}
                    {box.label === "object" && box.caption.trim() && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-1 top-5 flex items-center justify-center overflow-hidden whitespace-pre-wrap break-words px-1 text-center text-[10px] leading-tight text-foreground/80">
                        {box.caption}
                      </span>
                    )}
                    {box.label === "text" && box.text && (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-pre-wrap break-words px-1 text-center font-semibold">
                        {box.text}
                      </span>
                    )}
                    <span
                      className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-l border-t border-current bg-background/80"
                      onPointerDown={(event) => beginResize(event, box)}
                      data-layout-resize
                      data-testid={`layout-resize-${index + 1}`}
                    />
                  </div>
                );
              })}
              {editor.boxes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
                  {t("orchestrator.layout.emptyCanvas")}
                </div>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("orchestrator.layout.orderHint")}</p>
        </div>

        <div className="min-w-0 space-y-3 rounded-lg border border-border/70 bg-background/70 p-3">
          {editor.selectedBox ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {t("orchestrator.layout.boxNumber", { index: selectedIndex + 1 })}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={t("orchestrator.layout.moveUp")} disabled={selectedIndex <= 0} onClick={() => editor.moveBox(editor.selectedBox!.id, -1)}>
                    <ArrowUpIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={t("orchestrator.layout.moveDown")} disabled={selectedIndex === editor.boxes.length - 1} onClick={() => editor.moveBox(editor.selectedBox!.id, 1)}>
                    <ArrowDownIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={t("orchestrator.layout.deleteBox")} onClick={() => editor.removeBox(editor.selectedBox!.id)} data-testid="layout-delete-box">
                    <Trash2Icon className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <Select
                value={editor.selectedBox.label}
                options={[
                  { value: "object", label: t("orchestrator.layout.objectBox") },
                  { value: "text", label: t("orchestrator.layout.textBox") },
                ]}
                onChange={(value) => editor.updateBox(editor.selectedBox!.id, {
                  label: value as PromptMossLayoutBox["label"],
                  ...(value === "text" ? { text: editor.selectedBox!.text ?? "" } : { character: false }),
                })}
                presentation="form"
                ariaLabel={t("orchestrator.layout.boxType")}
              />
              <Textarea
                label={t("orchestrator.layout.boxCaption")}
                value={editor.selectedBox.caption}
                onChange={(event) => editor.updateBox(editor.selectedBox!.id, { caption: event.target.value })}
                placeholder={t("orchestrator.layout.boxCaptionPlaceholder")}
                rows={4}
                data-testid="layout-box-caption"
              />
              {editor.selectedBox.label === "text" && (
                <Textarea
                  label={t("orchestrator.layout.exactText")}
                  value={editor.selectedBox.text ?? ""}
                  onChange={(event) => editor.updateBox(editor.selectedBox!.id, { text: event.target.value })}
                  placeholder={t("orchestrator.layout.exactTextPlaceholder")}
                  rows={3}
                  data-testid="layout-box-text"
                />
              )}
              {editor.selectedBox.label === "object" && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={editor.selectedBox.character === true}
                    onChange={(event) => editor.updateBox(editor.selectedBox!.id, { character: event.target.checked })}
                  />
                  <span>{t("orchestrator.layout.characterBox")}</span>
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                {(["top", "left", "bottom", "right"] as const).map((name, index) => (
                  <Input
                    key={name}
                    label={t(`orchestrator.layout.coordinates.${name}`)}
                    type="number"
                    min={0}
                    max={1000}
                    value={editor.selectedBox!.bbox[index]}
                    onChange={(event) => updateCoordinate(editor.selectedBox!, index as 0 | 1 | 2 | 3, event.target.value)}
                    variant="outlined"
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("orchestrator.layout.selectBox")}</p>
          )}
        </div>
      </div>

      {editor.boxes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("orchestrator.layout.drawOrder")}>
          {editor.boxes.map((box, index) => (
            <button
              key={box.id}
              type="button"
              className={`rounded-md border px-2 py-1 text-[11px] ${box.id === editor.selectedBoxId ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              onClick={() => editor.setSelectedBoxId(box.id)}
            >
              {index + 1} · {box.label === "text" ? t("orchestrator.layout.textShort") : t("orchestrator.layout.objectShort")}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("orchestrator.layout.compileHint")}</p>
    </section>
  );
}
