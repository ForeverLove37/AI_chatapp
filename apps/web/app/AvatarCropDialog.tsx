"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const PREVIEW_SIZE = 640;
const OUTPUT_SIZE = 512;

type Point = { x: number; y: number };

type CropCopy = {
  title: string;
  detail: string;
  zoom: string;
  reset: string;
  cancel: string;
  apply: string;
  processing: string;
  error: string;
};

type AvatarCropDialogProps = {
  copy: CropCopy;
  exiting?: boolean;
  file: File;
  onApply: (file: File) => void;
  onCancel: () => void;
};

function geometry(image: HTMLImageElement, size: number, zoom: number, pan: Point) {
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const shiftX = Math.max(0, (width - size) / 2);
  const shiftY = Math.max(0, (height - size) / 2);
  return {
    x: (size - width) / 2 + pan.x * shiftX,
    y: (size - height) / 2 + pan.y * shiftY,
    width,
    height,
    shiftX,
    shiftY,
  };
}

function renderCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, pan: Point) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const frame = geometry(image, canvas.width, zoom, pan);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function createCroppedAvatar(image: HTMLImageElement, zoom: number, pan: Point) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  renderCrop(canvas, image, zoom, pan);
  let blob = await canvasBlob(canvas, "image/webp", 0.86);
  if (!blob || blob.size > 2 * 1024 * 1024) blob = await canvasBlob(canvas, "image/jpeg", 0.86);
  if (!blob) blob = await canvasBlob(canvas, "image/png");
  if (!blob) throw new Error("crop_failed");
  const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
  return new File([blob], `avatar.${extension}`, { type: blob.type, lastModified: Date.now() });
}

export function AvatarCropDialog({ copy, exiting = false, file, onApply, onCancel }: AvatarCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragPoint = useRef<Point | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => setImage(source);
    source.onerror = () => setError(copy.error);
    source.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [copy.error, file]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const frame = window.requestAnimationFrame(() => renderCrop(canvasRef.current!, image, zoom, pan));
    return () => window.cancelAnimationFrame(frame);
  }, [image, pan, zoom]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !processing) onCancel(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, processing]);

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragPoint.current || !image) return;
    const canvas = event.currentTarget;
    const frame = geometry(image, PREVIEW_SIZE, zoom, pan);
    const scale = PREVIEW_SIZE / canvas.clientWidth;
    const dx = (event.clientX - dragPoint.current.x) * scale;
    const dy = (event.clientY - dragPoint.current.y) * scale;
    dragPoint.current = { x: event.clientX, y: event.clientY };
    setPan((current) => ({
      x: frame.shiftX > 0 ? Math.max(-1, Math.min(1, current.x + dx / frame.shiftX)) : 0,
      y: frame.shiftY > 0 ? Math.max(-1, Math.min(1, current.y + dy / frame.shiftY)) : 0,
    }));
  }

  function endDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    dragPoint.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function apply() {
    if (!image || processing) return;
    setProcessing(true); setError("");
    try {
      onApply(await createCroppedAvatar(image, zoom, pan));
    } catch {
      setError(copy.error);
      setProcessing(false);
    }
  }

  return <div className={`avatar-crop-backdrop ${exiting ? "is-exiting" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !processing) onCancel(); }}>
    <section className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
      <header><div><h2 id="avatar-crop-title">{copy.title}</h2><p>{copy.detail}</p></div><button className="icon-command" disabled={processing} title={copy.cancel} aria-label={copy.cancel} onClick={onCancel}><X size={19} /></button></header>
      <div className={`avatar-crop-frame ${image ? "crop-ready" : ""}`}>
        <canvas
          aria-label={copy.title}
          height={PREVIEW_SIZE}
          ref={canvasRef}
          width={PREVIEW_SIZE}
          onPointerDown={(event) => { dragPoint.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={move}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        <div className="avatar-crop-grid" aria-hidden="true" />
      </div>
      <label className="avatar-zoom-control"><span>{copy.zoom}</span><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      {error && <div className="settings-error" role="alert">{error}</div>}
      <footer>
        <button type="button" disabled={processing} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><RotateCcw size={16} />{copy.reset}</button>
        <span />
        <button type="button" disabled={processing} onClick={onCancel}>{copy.cancel}</button>
        <button className="crop-apply-command" type="button" disabled={!image || processing} onClick={() => void apply()}><Check size={16} />{processing ? copy.processing : copy.apply}</button>
      </footer>
    </section>
  </div>;
}
