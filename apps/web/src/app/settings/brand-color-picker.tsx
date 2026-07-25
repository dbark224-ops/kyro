"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { InfoBubble } from "./info-bubble";

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

type BrandColorPickerProps = Readonly<{
  autosave?: boolean;
  defaultValue: string;
  info: string;
  label: string;
  name: string;
}>;

const BRAND_SWATCHES = [
  "#36d7f4",
  "#ec3c96",
  "#2563eb",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#111827",
  "#f8fafc",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(value: string) {
  const trimmed = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;

    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return null;
}

function componentToHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function hsvToHex({ hue, saturation, value }: HsvColor) {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  return `#${componentToHex(Math.round((red + match) * 255))}${componentToHex(
    Math.round((green + match) * 255),
  )}${componentToHex(Math.round((blue + match) * 255))}`;
}

function hexToHsv(value: string): HsvColor {
  const hex = normalizeHex(value) ?? "#36d7f4";
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const hue =
    delta === 0
      ? 0
      : max === red
        ? 60 * (((green - blue) / delta) % 6)
        : max === green
          ? 60 * ((blue - red) / delta + 2)
          : 60 * ((red - green) / delta + 4);

  return {
    hue: Math.round((hue + 360) % 360),
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function BrandColorPicker({
  autosave = false,
  defaultValue,
  info,
  label,
  name,
}: BrandColorPickerProps) {
  const didMountRef = useRef(false);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const squareRef = useRef<HTMLButtonElement | null>(null);
  const [color, setColor] = useState(() => hexToHsv(defaultValue));
  const hex = useMemo(() => hsvToHex(color), [color]);
  const [hexDraft, setHexDraft] = useState(hex);
  const hueColor = useMemo(
    () => hsvToHex({ hue: color.hue, saturation: 1, value: 1 }),
    [color.hue],
  );

  function setPickedColor(nextColor: HsvColor) {
    setColor(nextColor);
    setHexDraft(hsvToHex(nextColor));
  }

  function updateShadeFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const rect = squareRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    setPickedColor({
      ...color,
      saturation: x,
      value: 1 - y,
    });
  }

  function handleShadePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateShadeFromPointer(event);
  }

  useEffect(() => {
    if (!autosave) {
      return;
    }

    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    hiddenInputRef.current?.dispatchEvent(
      new Event("input", { bubbles: true }),
    );
  }, [autosave, hex]);

  return (
    <section className="setting-card brand-color-picker">
      <input name={name} ref={hiddenInputRef} type="hidden" value={hex} />
      <div className="setting-card-heading">
        <strong>{label}</strong>
        <InfoBubble>{info}</InfoBubble>
      </div>

      <div
        aria-hidden="true"
        className="brand-color-preview-line"
        style={{ background: hex, color: hex }}
      />

      <div className="brand-color-current-row">
        <span
          aria-hidden="true"
          className="brand-color-current-swatch"
          style={{ background: hex }}
        />
        <label>
          <span>Hex</span>
          <input
            aria-label={`${label} hex value`}
            onChange={(event) => {
              const draft = event.currentTarget.value;
              const nextHex = normalizeHex(draft);

              setHexDraft(draft);

              if (nextHex) {
                setColor(hexToHsv(nextHex));
              }
            }}
            onBlur={() => {
              const nextHex = normalizeHex(hexDraft);

              if (nextHex) {
                setPickedColor(hexToHsv(nextHex));
                return;
              }

              setHexDraft(hex);
            }}
            spellCheck={false}
            type="text"
            value={hexDraft}
          />
        </label>
      </div>

      <button
        aria-label={`${label} shade selector`}
        className="brand-color-shade"
        onPointerDown={handleShadePointerDown}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            updateShadeFromPointer(event);
          }
        }}
        ref={squareRef}
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        type="button"
      >
        <span
          className="brand-color-shade-handle"
          style={{
            left: `${color.saturation * 100}%`,
            top: `${(1 - color.value) * 100}%`,
          }}
        />
      </button>

      <label className="brand-color-hue-row">
        <span>Hue</span>
        <input
          aria-label={`${label} hue`}
          max="360"
          min="0"
          onChange={(event) =>
            setPickedColor({
              ...color,
              hue: Number(event.currentTarget.value),
            })
          }
          type="range"
          value={color.hue}
        />
      </label>

      <div aria-label={`${label} quick colours`} className="brand-color-swatches">
        {BRAND_SWATCHES.map((swatch) => (
          <button
            aria-label={`Use ${swatch}`}
            aria-pressed={hex === swatch}
            className="brand-color-swatch-button"
            key={swatch}
            onClick={() => setPickedColor(hexToHsv(swatch))}
            style={{ background: swatch }}
            type="button"
          />
        ))}
      </div>
    </section>
  );
}
