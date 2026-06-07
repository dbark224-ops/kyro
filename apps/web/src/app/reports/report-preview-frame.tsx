"use client";

import { useState } from "react";

type ReportPreviewFrameProps = {
  src: string;
  title: string;
};

export function ReportPreviewFrame({ src, title }: ReportPreviewFrameProps) {
  const [zoom, setZoom] = useState(1);

  const updateZoom = (nextZoom: number) => {
    setZoom(Math.max(0.7, Math.min(1.4, Math.round(nextZoom * 100) / 100)));
  };

  return (
    <>
      <div className="reports-zoom-controls" aria-label="PDF preview zoom">
        <button
          aria-label="Zoom out"
          className="secondary-button compact"
          onClick={() => updateZoom(zoom - 0.1)}
          type="button"
        >
          -
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in"
          className="secondary-button compact"
          onClick={() => updateZoom(zoom + 0.1)}
          type="button"
        >
          +
        </button>
      </div>
      <div className="reports-preview-frame-shell">
        <iframe
          className="reports-preview-frame"
          src={src}
          style={{
            height: `${100 / zoom}%`,
            transform: `scale(${zoom})`,
            width: `${100 / zoom}%`,
          }}
          title={title}
        />
      </div>
    </>
  );
}
