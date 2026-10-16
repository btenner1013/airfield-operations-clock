/** Moves cloud detail already present in the airfield photograph, never its architecture.
 * The precipitation canvas owns loading, frame timing, visibility and reduced motion.
 */
type SkyImage = CanvasImageSource & { width: number; height: number };
type Rect = { left: number; top: number; right: number; bottom: number };

const MAX_WIDTH = 960;
const MAX_HEIGHT = 540;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** An oval exclusion whose fully opaque center contains the complete tower envelope.
 * The curved, broad falloff avoids a rectangular stationary-cloud patch above it.
 */
function eraseTower(ctx: CanvasRenderingContext2D, rect: Rect, feather: number): void {
  const { left, top, right, bottom } = rect;
  const radiusX = (right - left) * 0.76;
  const radiusY = (bottom - top) * 0.76;
  const outer = 1 + feather / Math.max(1, Math.min(radiusX, radiusY));
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.translate((left + right) / 2, (top + bottom) / 2);
  ctx.scale(radiusX, radiusY);
  const mask = ctx.createRadialGradient(0, 0, 1, 0, 0, outer);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.45, "rgba(0,0,0,.58)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
  ctx.restore();
}

export function createPhotographicSky(): {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, image: SkyImage, coverage: number, storm: number, windX: number, reduced: boolean) => void;
  dispose: () => void;
} {
  let canvas: HTMLCanvasElement | null = null;
  let buffer: CanvasRenderingContext2D | null = null;
  let phase = 0, evolution = 0;
  let opacity = 0, started = false, disposed = false;
  let currentImage: SkyImage | null = null, previousImage: SkyImage | null = null;
  let imageBlend = 1;

  return {
    draw(ctx, w, h, dt, image, coverage, storm, windX, reduced) {
      if (disposed || w <= 0 || h <= 0 || image.width <= 0 || image.height <= 0) return;
      if (image !== currentImage) {
        // On rapid changes, retain the dominant source rather than flashing an
        // intermediate photograph that had barely started to fade in.
        previousImage = imageBlend < 0.5 && previousImage ? previousImage : currentImage;
        currentImage = image;
        imageBlend = previousImage ? 0 : 1;
      }
      // The unmodified photograph is already the reduced-motion background. Do not
      // repaint it with a different crop or let the stopped moving sky obscure it.
      if (reduced) { previousImage = null; imageBlend = 1; return; }
      const strength = clamp(storm);
      const targetOpacity = clamp(Math.max(coverage * 3, strength * 1.6));
      const step = clamp(dt, 0, 0.1);
      imageBlend = Math.min(1, imageBlend + step / 3.6);
      if (imageBlend === 1) previousImage = null;
      opacity = started ? opacity + (targetOpacity - opacity) * (1 - Math.exp(-step / 2.2)) : targetOpacity;
      started = true;
      if (opacity < 0.002) return;
      if (!canvas) {
        if (typeof document === "undefined") return;
        canvas = document.createElement("canvas");
        buffer = canvas.getContext("2d");
      }
      if (!buffer) return;
      const resolution = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
      const bw = Math.max(1, Math.round(w * resolution));
      const bh = Math.max(1, Math.round(h * resolution));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }

      // Match the stable CSS background-position:center/background-size:cover.
      // All masking landmarks are expressed in ORIGINAL image coordinates, so
      // narrow, portrait, 4:3 and ultrawide crops preserve their own horizon.
      const iw = image.width, ih = image.height;
      const cover = Math.max(w / iw, h / ih);
      const originalWidth = iw * cover, originalHeight = ih * cover;
      const originalX = (w - originalWidth) / 2, originalY = (h - originalHeight) / 2;
      const amplitude = originalWidth * 0.058;
      const direction = Math.abs(windX) >= 1 ? Math.sign(windX) : 1;
      // Illustrative cloud-level motion remains visible during calm surface wind.
      const speed = Math.max(Math.min(Math.abs(windX), 40) * 0.9, 13 + strength * 12);
      phase += direction * speed / Math.max(1, amplitude) * step;
      evolution += step;
      const zoom = 1.16 + Math.sin(evolution / 23) * 0.008;
      const movingWidth = originalWidth * zoom, movingHeight = originalHeight * zoom;
      const movingX = (w - movingWidth) / 2 + Math.sin(phase) * amplitude;
      const movingY = (h - movingHeight) / 2;

      buffer.globalAlpha = 1;
      buffer.globalCompositeOperation = "source-over";
      buffer.clearRect(0, 0, bw, bh);
      buffer.imageSmoothingEnabled = true;
      const previousCover = previousImage ? Math.max(w / previousImage.width, h / previousImage.height) : cover;
      const previousWidth = previousImage ? previousImage.width * previousCover : originalWidth;
      const previousHeight = previousImage ? previousImage.height * previousCover : originalHeight;
      const previousMovingX = (w - previousWidth * zoom) / 2 + Math.sin(phase) * previousWidth * 0.058;
      const previousMovingY = (h - previousHeight * zoom) / 2;
      if (previousImage) {
        buffer.drawImage(previousImage, previousMovingX * resolution, previousMovingY * resolution,
          previousWidth * zoom * resolution, previousHeight * zoom * resolution);
        buffer.globalAlpha = imageBlend;
      }
      buffer.drawImage(image, movingX * resolution, movingY * resolution, movingWidth * resolution, movingHeight * resolution);
      buffer.globalAlpha = 1;

      // The bundled daytime OVC photograph contains blue breaks. Neutralize
      // their chroma only in this moving sky buffer; the architectural exclusion
      // and horizon fade below keep every foreground pixel on the original photo.
      // Ease in above BKN coverage so scattered-cloud identity stays unchanged.
      const closedDeck = clamp((coverage - 0.8) / 0.2);
      if (closedDeck > 0) {
        buffer.globalCompositeOperation = "saturation";
        buffer.globalAlpha = closedDeck;
        buffer.fillStyle = "rgb(160,160,160)";
        buffer.fillRect(0, 0, bw, bh);
        buffer.globalAlpha = 1;
      }

      // Use the earlier of the source and destination skyline. This guarantees
      // the scaled/panned photograph cannot introduce moving hangars or terrain.
      const solidUntil = Math.min(originalY + originalHeight * 0.38, movingY + movingHeight * 0.38,
        previousMovingY + previousHeight * zoom * 0.38) * resolution;
      const clearBy = Math.min(originalY + originalHeight * 0.46, movingY + movingHeight * 0.46,
        previousMovingY + previousHeight * zoom * 0.46) * resolution;
      buffer.globalCompositeOperation = "destination-in";
      const skyMask = buffer.createLinearGradient(0, solidUntil, 0, Math.max(solidUntil + 1, clearBy));
      skyMask.addColorStop(0, "rgba(0,0,0,1)");
      skyMask.addColorStop(0.42, "rgba(0,0,0,.86)");
      skyMask.addColorStop(1, "rgba(0,0,0,0)");
      buffer.fillStyle = skyMask;
      buffer.fillRect(0, 0, bw, bh);

      // Exclude BOTH the fixed tower and the complete possible moving source
      // tower envelope, including antennas. A fixed mask avoids a breathing
      // architectural cutout as the pan reaches either end of its range.
      const maximumZoom = 1.168;
      const maximumWidth = originalWidth * maximumZoom;
      const maximumHeight = originalHeight * maximumZoom;
      const exclusion: Rect = {
        left: Math.min(originalX + originalWidth * 0.088, w / 2 + maximumWidth * (0.088 - 0.5) - amplitude) * resolution,
        right: Math.max(originalX + originalWidth * 0.17, w / 2 + maximumWidth * (0.17 - 0.5) + amplitude) * resolution,
        top: Math.min(originalY + originalHeight * 0.245, h / 2 + maximumHeight * (0.245 - 0.5)) * resolution,
        bottom: Math.max(originalY + originalHeight * 0.6, h / 2 + maximumHeight * (0.6 - 0.5)) * resolution,
      };
      if (previousImage) {
        const previousMaxWidth = previousWidth * maximumZoom;
        const previousMaxHeight = previousHeight * maximumZoom;
        exclusion.left = Math.min(exclusion.left, (w / 2 + previousMaxWidth * (0.088 - 0.5) - previousWidth * 0.058) * resolution);
        exclusion.right = Math.max(exclusion.right, (w / 2 + previousMaxWidth * (0.17 - 0.5) + previousWidth * 0.058) * resolution);
        exclusion.top = Math.min(exclusion.top, (h / 2 + previousMaxHeight * (0.245 - 0.5)) * resolution);
        exclusion.bottom = Math.max(exclusion.bottom, (h / 2 + previousMaxHeight * (0.6 - 0.5)) * resolution);
      }
      if (exclusion.right > -bw * 0.06 && exclusion.left < bw) eraseTower(buffer, exclusion, Math.max(3, originalWidth * resolution * 0.045));
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = opacity;
      ctx.drawImage(canvas, 0, 0, w, h);
      ctx.restore();
    },
    dispose() {
      disposed = true;
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      canvas = null;
      buffer = null;
      currentImage = null;
      previousImage = null;
    },
  };
}
