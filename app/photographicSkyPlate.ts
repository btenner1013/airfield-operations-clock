/** A decoded wallpaper contains architecture as well as clouds. Prepare its moving
 * source once, so the renderer only has to protect the ORIGINAL tower/poles.
 * This never changes the wallpaper asset or the reduced-motion background.
 */
export type PhotographicSkyImage = CanvasImageSource & {
  width: number;
  height: number;
  currentSrc?: string;
  src?: string;
  id?: string;
};
export type PhotographicSkyPlate = {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  /** Positive star residual: composite with `screen` at ORIGINAL photo geometry. */
  stars: HTMLCanvasElement | null;
};
type Region = { left: number; right: number; top: number; bottom: number };
type PixelRegion = Region & { feather: number };
const MAX_WIDTH = 960;
const MAX_HEIGHT = 540;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export function photographicSkyScene(image: Pick<PhotographicSkyImage, "currentSrc" | "src" | "id">): string {
  return (image.currentSrc || image.src || image.id || "").split(/[?#]/, 1)[0].split("/").pop()!.replace(/\.png$/i, "").toLowerCase();
}

/** Opaque repair bounds contain antennas, lamp heads and their small glow.
 * Feathering is OUTSIDE these bounds, so no partially erased object can drift.
 */
export function photographicSkyRepairRegions(scene: string): Region[] {
  const tower = scene === "fog-night"
    ? { left: .079, right: .135, top: .36, bottom: .65 }
    : scene === "snow-night"
      ? { left: .092, right: .146, top: .26, bottom: .65 }
      : { left: .100, right: .155, top: .285, bottom: .65 };
  const poles = [[.165, .503], [.190, .476], [.231, .503], [.255, .485], [.837, .480], [.929, .496], [.960, .494]];
  return [tower, ...poles.map(([x, top]) => ({
    left: x - .006, right: x + .006,
    top: (scene === "snow-night" ? Math.min(top, .45) : top) - .008,
    bottom: .65,
  }))];
}

function luminance(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722;
}

/** Conservative point-source detection. A star must be a local maximum with a
 * quiet surrounding ring and a compact connected highlight, unlike a cloud rim.
 * Returning the positive screen residual keeps its original brightness fixed
 * while clouds can pass underneath; no opaque dark boxes accompany the stars.
 */
function separateStars(data: Uint8ClampedArray, width: number, height: number, regions: PixelRegion[]): {
  stars: Uint8ClampedArray | null; removedStars: number;
} {
  let stars: Uint8ClampedArray | null = null, removedStars = 0;
  const ring = [[-3, -3], [0, -3], [3, -3], [-3, 0], [3, 0], [-3, 3], [0, 3], [3, 3]];
  const colors = new Float64Array(3);
  // The source horizon is masked before this height by the renderer.
  const endY = Math.min(height - 3, Math.ceil(height * .51));
  for (let y = 3; y < endY; y++) for (let x = 3; x < width - 3; x++) {
    if (regions.some(r => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4)) continue;
    const offset = (y * width + x) * 4;
    const peak = luminance(data, offset);
    if (peak < 14) continue;
    let isPeak = true;
    for (let dy = -1; dy <= 1 && isPeak; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && luminance(data, ((y + dy) * width + x + dx) * 4) > peak) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    colors.fill(0);
    let ringMin = 255, ringMax = 0;
    for (const [dx, dy] of ring) {
      const ri = ((y + dy) * width + x + dx) * 4;
      const lum = luminance(data, ri);
      ringMin = Math.min(ringMin, lum); ringMax = Math.max(ringMax, lum);
      for (let c = 0; c < 3; c++) colors[c] += data[ri + c] / ring.length;
    }
    const background = colors[0] * .2126 + colors[1] * .7152 + colors[2] * .0722;
    const contrast = peak - background;
    if (contrast < 8 || ringMax - ringMin > 7 || peak - ringMax < 7) continue;
    const threshold = background + Math.max(3, contrast * .2);
    let count = 0, touchesEdge = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (luminance(data, ((y + dy) * width + x + dx) * 4) > threshold) {
        count++;
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) touchesEdge = true;
      }
    }
    if (!count || count > 9 || touchesEdge) continue;
    if (!stars) stars = new Uint8ClampedArray(data.length);
    removedStars++;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const pi = ((y + dy) * width + x + dx) * 4;
      if (luminance(data, pi) <= background + 1) continue;
      // Subtract only positive point-source light, preserving the local sky.
      for (let c = 0; c < 3; c++) {
        const base = Math.min(data[pi + c], colors[c]);
        stars[pi + c] = 255 * (data[pi + c] - base) / Math.max(1, 255 - base);
        data[pi + c] = base;
      }
      stars[pi + 3] = 255;
    }
  }
  return { stars, removedStars };
}

/** Pure, deterministic one-time pixel preparation. Mutates RGBA in place.
 * Reconstruct low-frequency color from both same-row edges, then mix neighboring
 * sky detail after removing its own color ramp. This avoids both a flat smeared
 * stripe and the hard seam/color halo of copying a rectangular donor patch.
 */
export function repairPhotographicSkyPixels(data: Uint8ClampedArray, width: number, height: number, scene: string): {
  stars: Uint8ClampedArray | null; removedStars: number;
} {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new RangeError("Sky plate dimensions must match its RGBA pixels");
  }
  if (scene === "clear-night") return { stars: null, removedStars: 0 };
  const regions: PixelRegion[] = photographicSkyRepairRegions(scene).map((region, index) => ({
    left: clamp(Math.floor(region.left * width), 0, width - 1),
    right: clamp(Math.ceil(region.right * width), 0, width - 1),
    top: clamp(Math.floor(region.top * height), 0, height - 1),
    bottom: clamp(Math.ceil(region.bottom * height), 0, height - 1),
    feather: Math.max(1, Math.round(width * (index === 0 ? .006 : .0025))),
  }));
  const result = scene === "partly-cloudy-night" ? separateStars(data, width, height, regions) : { stars: null, removedStars: 0 };
  const source = new Uint8ClampedArray(data);
  const lastSkyRow = Math.min(height - 1, Math.floor(height * .505));
  const safeColumn = (x: number, y: number, direction: number): number => {
    let candidate = clamp(Math.round(x), 0, width - 1);
    for (let attempts = 0; attempts < regions.length; attempts++) {
      const obstruction = regions.find(region => y >= region.top - 1 && y <= region.bottom + 1 && candidate >= region.left - 1 && candidate <= region.right + 1);
      if (!obstruction) break;
      candidate = clamp(direction < 0 ? obstruction.left - 2 : obstruction.right + 2, 0, width - 1);
    }
    return candidate;
  };
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex];
    const x0 = Math.max(0, region.left - region.feather), x1 = Math.min(width - 1, region.right + region.feather);
    const y0 = Math.max(0, region.top - region.feather), y1 = Math.min(height - 1, region.bottom + region.feather);
    const span = Math.max(1, x1 - x0);
    // A two-dimensional texture-guided solve removes the straight horizontal
    // streaks row interpolation alone would leave across high-contrast cumulus.
    const solveBottom = Math.min(y1, lastSkyRow), patchWidth = x1 - x0 + 1, patchHeight = solveBottom - y0 + 1;
    const guide = regionIndex === 0 && patchHeight > 2 ? new Float32Array(patchWidth * patchHeight * 3) : null;
    for (let y = y0; y <= y1; y++) {
      const sampleY = Math.min(y, lastSkyRow);
      const left = safeColumn(x0 - 1, sampleY, -1), right = safeColumn(x1 + 1, sampleY, 1);
      const farLeft = safeColumn(left - span, sampleY, -1), farRight = safeColumn(right + span, sampleY, 1);
      const leftI = (sampleY * width + left) * 4, rightI = (sampleY * width + right) * 4;
      const farLeftI = (sampleY * width + farLeft) * 4, farRightI = (sampleY * width + farRight) * 4;
      const vertical = smooth((y - y0) / Math.max(1, region.top - y0)) * smooth((y1 - y) / Math.max(1, y1 - region.bottom));
      for (let x = x0; x <= x1; x++) {
        const alpha = vertical * smooth((x - x0) / Math.max(1, region.left - x0)) * smooth((x1 - x) / Math.max(1, x1 - region.right));
        const t = (x - x0) / span;
        const donorL = safeColumn(farLeft + (left - farLeft) * t, sampleY, -1);
        const donorR = safeColumn(right + (farRight - right) * t, sampleY, 1);
        const donorLI = (sampleY * width + donorL) * 4, donorRI = (sampleY * width + donorR) * 4;
        const edgeT = clamp((x - left) / Math.max(1, right - left), 0, 1);
        const detailEnvelope = Math.sin(t * Math.PI) * .65;
        const index = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const leftColor = source[leftI + c], rightColor = source[rightI + c];
          const base = leftColor * (1 - edgeT) + rightColor * edgeT;
          const leftDetail = source[donorLI + c] - (source[farLeftI + c] * (1 - t) + leftColor * t);
          const rightDetail = source[donorRI + c] - (rightColor * (1 - t) + source[farRightI + c] * t);
          const reconstructed = base + detailEnvelope * (leftDetail * (1 - t) + rightDetail * t);
          data[index + c] = source[index + c] * (1 - alpha) + reconstructed * alpha;
          if (guide && y <= solveBottom) guide[((y - y0) * patchWidth + x - x0) * 3 + c] = source[donorLI + c] * (1 - t) + source[donorRI + c] * t;
        }
        // The replacement remains fully opaque. Erasing alpha exposes a second
        // stationary photograph instead of moving clouds around the tower.
      }
    }
    if (guide) {
      const solved = new Float32Array(guide.length), laplacian = new Float32Array(guide.length);
      for (let py = 0; py < patchHeight; py++) for (let px = 0; px < patchWidth; px++) {
        const from = ((y0 + py) * width + x0 + px) * 4, at = (py * patchWidth + px) * 3;
        const sourceX = x0 + px, sourceY = Math.min(y0 + py, lastSkyRow);
        const otherObject = regions.some((r, index) => index !== regionIndex && sourceX >= r.left - 1 && sourceX <= r.right + 1 && sourceY >= r.top - 1 && sourceY <= r.bottom + 1);
        const clean = (sourceY * width + safeColumn(sourceX, sourceY, px < patchWidth / 2 ? -1 : 1)) * 4;
        for (let c = 0; c < 3; c++) {
          solved[at + c] = otherObject ? source[clean + c] : data[from + c];
          if (px > 0 && px < patchWidth - 1 && py > 0 && py < patchHeight - 1) {
            laplacian[at + c] = guide[at - 3 + c] + guide[at + 3 + c] + guide[at - patchWidth * 3 + c] + guide[at + patchWidth * 3 + c] - 4 * guide[at + c];
          }
        }
      }
      for (let pass = 0; pass < 180; pass++) {
        let change = 0;
        for (let py = 1; py < patchHeight - 1; py++) for (let px = 1; px < patchWidth - 1; px++) {
          const at = (py * patchWidth + px) * 3;
          for (let c = 0; c < 3; c++) {
            const next = clamp((solved[at - 3 + c] + solved[at + 3 + c] + solved[at - patchWidth * 3 + c] + solved[at + patchWidth * 3 + c] - laplacian[at + c]) * .25, 0, 255);
            change = Math.max(change, Math.abs(next - solved[at + c]));
            solved[at + c] = next;
          }
        }
        if (change < .03) break;
      }
      for (let py = 1; py < patchHeight - 1; py++) for (let px = 1; px < patchWidth - 1; px++) {
        const to = ((y0 + py) * width + x0 + px) * 4, at = (py * patchWidth + px) * 3;
        const x = x0 + px, y = y0 + py;
        const featherAlpha = smooth((x - x0) / Math.max(1, region.left - x0)) * smooth((x1 - x) / Math.max(1, x1 - region.right)) * smooth((y - y0) / Math.max(1, region.top - y0));
        for (let c = 0; c < 3; c++) data[to + c] = source[to + c] * (1 - featherAlpha) + solved[at + c] * featherAlpha;
      }
    }
  }
  return result;
}

type CacheEntry = { source: PhotographicSkyImage; sourceKey: string; sourceWidth: number; sourceHeight: number; plate: PhotographicSkyPlate | null };
function release(entry: CacheEntry | null): void {
  if (!entry?.plate) return;
  entry.plate.image.width = 1; entry.plate.image.height = 1;
  if (entry.plate.stars) { entry.plate.stars.width = 1; entry.plate.stars.height = 1; }
}

/** Exactly two source identities are retained for crossfades. Ask for previous,
 * then current, when both are in use. Hits allocate/read back nothing per frame.
 * Failure is cached and returns null: the caller must keep that photo static.
 */
export function createPhotographicSkyPlateCache(): {
  get: (image: PhotographicSkyImage) => PhotographicSkyPlate | null;
  dispose: () => void;
} {
  let older: CacheEntry | null = null, newer: CacheEntry | null = null, disposed = false;
  return {
    get(image) {
      if (disposed || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) return null;
      const sourceKey = image.currentSrc || image.src || image.id || "";
      if (newer?.source === image && newer.sourceKey === sourceKey && newer.sourceWidth === image.width && newer.sourceHeight === image.height) return newer.plate;
      if (older?.source === image && older.sourceKey === sourceKey && older.sourceWidth === image.width && older.sourceHeight === image.height) {
        const entry = older; older = newer; newer = entry;
        return entry.plate;
      }
      const scene = photographicSkyScene(image);
      if (scene === "clear-night") return null;
      release(older); older = newer;
      newer = { source: image, sourceKey, sourceWidth: image.width, sourceHeight: image.height, plate: null };
      if (typeof document === "undefined") return null;
      let canvas: HTMLCanvasElement | null = null, stars: HTMLCanvasElement | null = null;
      try {
        const scale = Math.min(1, MAX_WIDTH / image.width, MAX_HEIGHT / image.height);
        const width = Math.max(1, Math.floor(image.width * scale)), height = Math.max(1, Math.floor(image.height * scale));
        canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Sky plate canvas is unavailable");
        ctx.drawImage(image, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        const repaired = repairPhotographicSkyPixels(pixels.data, width, height, scene);
        ctx.putImageData(pixels, 0, 0);
        if (repaired.stars) {
          stars = document.createElement("canvas"); stars.width = width; stars.height = height;
          const starContext = stars.getContext("2d");
          if (!starContext) throw new Error("Star layer canvas is unavailable");
          pixels.data.set(repaired.stars);
          starContext.putImageData(pixels, 0, 0);
        }
        newer.plate = { image: canvas, width, height, stars };
      } catch {
        // Tainted/unavailable canvas or decoded source failure cannot lead to
        // moving an unprepared photo (which would duplicate architecture).
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        if (stars) { stars.width = 1; stars.height = 1; }
      }
      return newer.plate;
    },
    dispose() {
      disposed = true; release(older); release(newer); older = null; newer = null;
    },
  };
}
