import * as React from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const COLOR_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#64748b",
  "#475569",
  "#334155",
  "#1e293b",
] as const;

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

type ColorPickerProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(value: string) {
  const normalized = value.trim().replace(/^#/u, "");
  return /^[0-9a-f]{6}$/iu.test(normalized)
    ? `#${normalized.toLowerCase()}`
    : null;
}

function hexToHsv(value: string): HsvColor {
  const hex = normalizeHex(value) ?? "#3b82f6";
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function hsvToHex({ hue, saturation, value }: HsvColor) {
  const chroma = value * saturation;
  const section = hue / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] =
    section < 1
      ? [chroma, second, 0]
      : section < 2
        ? [second, chroma, 0]
        : section < 3
          ? [0, chroma, second]
          : section < 4
            ? [0, second, chroma]
            : section < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];

  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function ColorPicker({ value, label, onChange }: ColorPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [hexValue, setHexValue] = React.useState(value);
  const [hsv, setHsv] = React.useState(() => hexToHsv(value));

  React.useEffect(() => {
    setHexValue(value);
    setHsv(hexToHsv(value));
  }, [value]);

  function commitHsv(next: HsvColor) {
    setHsv(next);
    const nextHex = hsvToHex(next);
    setHexValue(nextHex);
    onChange(nextHex);
  }

  function updateSaturationValue(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const nextValue = 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    commitHsv({ ...hsv, saturation, value: nextValue });
  }

  function updateHue(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const hue =
      clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * 360;
    commitHsv({ ...hsv, hue });
  }

  function handleHexChange(nextValue: string) {
    setHexValue(nextValue);
    const normalized = normalizeHex(nextValue);
    if (normalized) {
      setHsv(hexToHsv(normalized));
      onChange(normalized);
    }
  }

  function finishHexEdit() {
    const normalized = normalizeHex(hexValue);
    if (normalized) {
      setHexValue(normalized);
      return;
    }
    setHexValue(hsvToHex(hsv));
  }

  const currentColor = hsvToHex(hsv);
  const hueColor = hsvToHex({ hue: hsv.hue, saturation: 1, value: 1 });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-32 justify-between gap-2 px-2"
            aria-label={label}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full border border-foreground/15"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase">{value}</span>
        </span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{label}</span>
          <span
            className="size-6 rounded-md border border-foreground/15"
            style={{ backgroundColor: currentColor }}
          />
        </div>

        <div
          aria-label={label}
          aria-valuemax={1}
          aria-valuemin={0}
          aria-valuenow={hsv.value}
          className="relative h-36 cursor-crosshair overflow-hidden rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          role="slider"
          tabIndex={0}
          style={{
            backgroundColor: hueColor,
            backgroundImage:
              "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              commitHsv({
                ...hsv,
                saturation: clamp(hsv.saturation + direction * 0.02, 0, 1),
              });
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const direction = event.key === "ArrowUp" ? 1 : -1;
              commitHsv({
                ...hsv,
                value: clamp(hsv.value + direction * 0.02, 0, 1),
              });
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updateSaturationValue(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) updateSaturationValue(event);
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
            style={{
              left: `${hsv.saturation * 100}%`,
              top: `${(1 - hsv.value) * 100}%`,
              backgroundColor: currentColor,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>

        <div
          aria-label={`${label} hue`}
          aria-valuemax={360}
          aria-valuemin={0}
          aria-valuenow={hsv.hue}
          className="relative mt-3 h-3 cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          role="slider"
          tabIndex={0}
          style={{
            background:
              "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              commitHsv({
                ...hsv,
                hue: (hsv.hue + direction * 5 + 360) % 360,
              });
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updateHue(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) updateHue(event);
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
            style={{
              left: `${(hsv.hue / 360) * 100}%`,
              backgroundColor: hueColor,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>

        <div className="mt-3 grid gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Hex</span>
            <span className="font-mono uppercase">{currentColor}</span>
          </div>
          <Input
            value={hexValue}
            onChange={(event) => handleHexChange(event.currentTarget.value)}
            onBlur={finishHexEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label={`${label} hex`}
            className="h-8 font-mono uppercase"
            spellCheck={false}
          />
        </div>

        <div className="mt-3 grid grid-cols-8 gap-1">
          {COLOR_PALETTE.map((color) => (
            <Button
              key={color}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={color}
              onClick={() => commitHsv(hexToHsv(color))}
              className={cn(
                "relative rounded-md p-0",
                currentColor === color && "ring-2 ring-primary/50",
              )}
            >
              <span
                aria-hidden
                className="size-4 rounded-full border border-foreground/15"
                style={{ backgroundColor: color }}
              />
              {currentColor === color && (
                <CheckIcon className="absolute size-3 text-white drop-shadow" />
              )}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { ColorPicker };
