"use client";

/**
 * 브라우저에서 고른 이미지 파일 → 서버에 보낼 { type, base64 }.
 * 큰 사진은 canvas 로 줄여서 보낸다 (사진 최대 512px, 로고 최대 800px, 각 600KB 이하).
 * 작은 PNG/JPEG/WebP/GIF 는 원본 그대로 (투명도·애니메이션 유지). SVG 는 200KB 까지 원본.
 */
import { BRAND_IMAGE_MAX_BYTES, type BrandImageKind, type BrandImagePayload, base64Bytes } from "./brand";

const RASTER_KEEP = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SVG_MAX = 200 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("파일을 읽지 못했습니다."));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 해석하지 못했습니다."));
    img.src = src;
  });
}

function splitDataUrl(dataUrl: string): BrandImagePayload {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const type = head.slice(5, head.indexOf(";"));
  return { type, base64: dataUrl.slice(comma + 1) };
}

function draw(img: HTMLImageElement, scale: number, type: "image/png" | "image/jpeg"): BrandImagePayload {
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들지 못했습니다.");
  ctx.drawImage(img, 0, 0, w, h);
  return splitDataUrl(canvas.toDataURL(type, 0.85));
}

export async function fileToBrandImage(file: File, kind: BrandImageKind): Promise<BrandImagePayload> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (isSvg) {
    if (file.size > SVG_MAX) throw new Error(`SVG 는 ${SVG_MAX / 1024}KB 이하만 가능합니다.`);
    return { type: "image/svg+xml", base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
  }
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택하세요 (PNG·JPEG·WebP·GIF·SVG).");

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const maxSide = kind === "photo" ? 512 : 800;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  let scale = Math.min(1, maxSide / longest);

  // 충분히 작고 형식도 괜찮으면 원본 그대로
  if (scale === 1 && file.size <= BRAND_IMAGE_MAX_BYTES && RASTER_KEEP.has(file.type)) {
    return splitDataUrl(dataUrl);
  }

  // 로고는 투명 배경을 살리려고 PNG 유지, 사진은 JPEG
  const keepPng = kind === "logo" && file.type !== "image/jpeg";
  for (let attempt = 0; attempt < 4; attempt++) {
    const out = draw(img, scale, keepPng ? "image/png" : "image/jpeg");
    if (base64Bytes(out.base64) <= BRAND_IMAGE_MAX_BYTES) return out;
    scale *= 0.7;
  }
  const out = draw(img, scale, "image/jpeg");
  if (base64Bytes(out.base64) <= BRAND_IMAGE_MAX_BYTES) return out;
  throw new Error("이미지를 충분히 줄이지 못했습니다. 더 작은 파일을 쓰세요.");
}

export function payloadToDataUrl(p: BrandImagePayload): string {
  return `data:${p.type};base64,${p.base64}`;
}
