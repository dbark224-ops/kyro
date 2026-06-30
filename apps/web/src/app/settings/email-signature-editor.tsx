"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
} from "react";
import type { EmailSignatureSettings } from "../../lib/communication/settings";
import { InfoBubble } from "./info-bubble";

type EmailSignatureEditorProps = Readonly<{
  autosave?: boolean;
  description: string;
  namePrefix: "manualSignature" | "aiGeneratedSignature";
  signature: EmailSignatureSettings;
  title: string;
}>;

type SignatureDraft = {
  logoContentBase64: string;
  logoContentType: string;
  logoFilename: string;
  logoSizeBytes: number;
  logoUrl: string;
  logoWidthPx: number;
  text: string;
};

function SettingCardHeading({
  children,
  info,
}: Readonly<{
  children: React.ReactNode;
  info: React.ReactNode;
}>) {
  return (
    <div className="setting-card-heading">
      <strong>{children}</strong>
      <InfoBubble>{info}</InfoBubble>
    </div>
  );
}

function logoSrc(draft: SignatureDraft) {
  return draft.logoContentBase64
    ? `data:${draft.logoContentType};base64,${draft.logoContentBase64}`
    : draft.logoUrl;
}

function clampLogoWidth(value: number) {
  return Math.max(32, Math.min(240, Math.round(value)));
}

function formatLogoSize(sizeBytes: number) {
  if (!sizeBytes) {
    return "";
  }

  return sizeBytes >= 1024
    ? `${Math.round(sizeBytes / 1024)} KB`
    : `${sizeBytes} B`;
}

export function EmailSignatureEditor({
  autosave = false,
  description,
  namePrefix,
  signature,
  title,
}: EmailSignatureEditorProps) {
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localLogoPreviewUrl, setLocalLogoPreviewUrl] = useState("");
  const [logoWidthInput, setLogoWidthInput] = useState(() =>
    String(signature.logoWidthPx),
  );
  const [draft, setDraft] = useState<SignatureDraft>(() => ({
    logoContentBase64: signature.logoContentBase64,
    logoContentType: signature.logoContentType,
    logoFilename: signature.logoFilename,
    logoSizeBytes: signature.logoSizeBytes,
    logoUrl: signature.logoUrl,
    logoWidthPx: signature.logoWidthPx,
    text: signature.text,
  }));
  const previewLogoSrc = useMemo(
    () => localLogoPreviewUrl || logoSrc(draft),
    [draft, localLogoPreviewUrl],
  );
  const logoStatusLabel = localLogoPreviewUrl
    ? "Selected logo"
    : previewLogoSrc
      ? "Current logo"
      : "No logo uploaded";
  const logoMeta = [
    draft.logoFilename || (draft.logoUrl ? "Logo URL fallback" : ""),
    formatLogoSize(draft.logoSizeBytes),
  ]
    .filter(Boolean)
    .join(" - ");

  const save = useCallback(
    (target: HTMLInputElement | HTMLTextAreaElement) => {
      if (!autosave) {
        return;
      }

      const form = target.form;

      if (!form) {
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch("/api/settings/email-signatures", {
        body: new FormData(form),
        method: "POST",
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error(
          error instanceof Error
            ? error.message
            : "Unable to autosave email signatures.",
        );
      });
    },
    [autosave],
  );

  const scheduleSave = useCallback(
    (target: HTMLInputElement | HTMLTextAreaElement, delayMs = 0) => {
      if (!autosave) {
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => save(target), delayMs);
    },
    [autosave, save],
  );

  const handleTextBlur = useCallback(
    (event: FocusEvent<HTMLTextAreaElement>) => {
      scheduleSave(event.currentTarget);
    },
    [scheduleSave],
  );

  const handleLogoUrlBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      scheduleSave(event.currentTarget);
    },
    [scheduleSave],
  );

  const handleLogoFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;

      if (file) {
        const objectUrl = URL.createObjectURL(file);

        setLocalLogoPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }

          return objectUrl;
        });
        setDraft((current) => ({
          ...current,
          logoContentBase64: current.logoContentBase64,
          logoContentType: file.type,
          logoFilename: file.name,
          logoSizeBytes: file.size,
        }));
      }

      scheduleSave(event.currentTarget);
    },
    [scheduleSave],
  );

  const handleLogoWidthChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const target = event.currentTarget;
      const rawWidth = target.value;
      const width = Number(rawWidth);

      setLogoWidthInput(rawWidth);

      if (Number.isFinite(width) && width >= 32 && width <= 240) {
        setDraft((current) => ({
          ...current,
          logoWidthPx: Math.round(width),
        }));
        scheduleSave(target, 450);
      }
    },
    [scheduleSave],
  );

  const handleLogoWidthBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      const target = event.currentTarget;
      const parsedWidth = Number(target.value);
      const width = Number.isFinite(parsedWidth)
        ? clampLogoWidth(parsedWidth)
        : draft.logoWidthPx;

      setLogoWidthInput(String(width));
      setDraft((current) => ({
        ...current,
        logoWidthPx: width,
      }));
      scheduleSave(target);
    },
    [draft.logoWidthPx, scheduleSave],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      abortRef.current?.abort();
    };
  }, []);

  useEffect(
    () => () => {
      if (localLogoPreviewUrl) {
        URL.revokeObjectURL(localLogoPreviewUrl);
      }
    },
    [localLogoPreviewUrl],
  );

  return (
    <section className="signature-editor">
      <input
        name={`${namePrefix}LogoContentBase64`}
        type="hidden"
        value={draft.logoContentBase64}
      />
      <input
        name={`${namePrefix}LogoContentType`}
        type="hidden"
        value={draft.logoContentType}
      />
      <input
        name={`${namePrefix}LogoFilename`}
        type="hidden"
        value={draft.logoFilename}
      />
      <input
        name={`${namePrefix}LogoSizeBytes`}
        type="hidden"
        value={draft.logoSizeBytes}
      />
      <input
        name={`${namePrefix}LogoWidthPx`}
        type="hidden"
        value={draft.logoWidthPx}
      />
      <div>
        <p className="eyebrow">{title}</p>
        <p>{description}</p>
      </div>

      <label className="settings-textarea">
        Signature text
        <textarea
          name={`${namePrefix}Text`}
          onBlur={handleTextBlur}
          onChange={(event) => {
            const text = event.currentTarget.value;

            setDraft((current) => ({
              ...current,
              text,
            }));
          }}
          placeholder={"Cheers, Dave\nKyro Plumbing\n0400 000 000"}
          value={draft.text}
        />
      </label>

      <div className="settings-grid">
        <label className="setting-card">
          <SettingCardHeading
            info={
              <>
                Upload a small logo, up to 512 KB. This is sent inline with
                email signatures.
              </>
            }
          >
            Logo file
          </SettingCardHeading>
          <div className="signature-logo-file-preview">
            {previewLogoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={previewLogoSrc}
                style={{ width: Math.min(draft.logoWidthPx, 96) }}
              />
            ) : null}
            <span>
              <strong>{logoStatusLabel}</strong>
              {logoMeta ? <small>{logoMeta}</small> : null}
            </span>
          </div>
          <input
            accept="image/*"
            name={`${namePrefix}LogoFile`}
            onChange={handleLogoFileChange}
            type="file"
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Optional fallback if no logo file is uploaded.">
            Logo URL fallback
          </SettingCardHeading>
          <input
            name={`${namePrefix}LogoUrl`}
            onBlur={handleLogoUrlBlur}
            onChange={(event) => {
              const logoUrl = event.currentTarget.value;

              setLocalLogoPreviewUrl((current) => {
                if (current) {
                  URL.revokeObjectURL(current);
                }

                return "";
              });
              setDraft((current) => ({
                ...current,
                logoContentBase64: "",
                logoContentType: "",
                logoFilename: "",
                logoSizeBytes: 0,
                logoUrl,
              }));
            }}
            placeholder="https://example.com/logo.png"
            type="url"
            value={draft.logoUrl}
          />
        </label>

        <label className="setting-card">
          <SettingCardHeading info="Width in pixels. Kyro keeps it between 32 and 240.">
            Logo size
          </SettingCardHeading>
          <input
            max={240}
            min={32}
            onBlur={handleLogoWidthBlur}
            onChange={handleLogoWidthChange}
            step={4}
            type="number"
            value={logoWidthInput}
          />
        </label>
      </div>

      <div className="signature-preview-card email-signature-preview-card">
        <strong>Preview</strong>
        <div className="signature-preview email-signature-preview">
          {draft.text ? (
            <p>
              {draft.text.split(/\r?\n/).map((line, index) => (
                <span key={`${line}-${index}`}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          ) : (
            <p className="muted-copy">No signature text yet.</p>
          )}
          {previewLogoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Signature logo preview"
              src={previewLogoSrc}
              style={{ width: draft.logoWidthPx }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
