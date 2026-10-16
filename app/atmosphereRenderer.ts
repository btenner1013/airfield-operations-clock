import { cloudSunsetStrength, type SkyPhase } from "./skyLighting.ts";

/**
 * A small, clock-independent atmosphere pass for the existing precipitation canvas.
 * The caller owns time, visibility, reduced motion, and the lightning scheduler.
 * Two immutable noise textures and one reusable composite are the only canvases.
 */
export type AtmosphereSpec = {
  coverage: number;
  ceiling: number | null;
  storm: number;
  obscuration: string;
  density: number;
  horizon: number;
  veil: number;
  windX: number;
  windY: number;
  gust: number;
  night: boolean;
  phase?: SkyPhase;
  reduced: boolean;
  quality: "full" | "low";
  lightningLevel: "none" | "distant" | "vicinity" | "station" | "severe";
};

type LightningFrame = { pulse: number; bolt: boolean; cluster: number };
type Point = { x: number; y: number };
type Bolt = { trunk: Point[]; branches: Point[][]; x: number; y: number; radius: number; energy: number };
type FogProfile = {
  red: number;
  green: number;
  blue: number;
  top: number;
  peak: number;
  bottom: number;
  patch: number;
  side: number;
  texture: number;
  loft: number;
};
type AtmosphereState = {
  coverage: number;
  low: number;
  storm: number;
  density: number;
  horizon: number;
  veil: number;
  windX: number;
  windY: number;
  gust: number;
  night: number;
  sunset: number;
};

const TEXTURE_WIDTH = 384;
const TEXTURE_HEIGHT = 224;
const COMPOSITE_WIDTH = 576;
const COMPOSITE_HEIGHT = 324;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const wrap = (value: number, period: number) => ((value % period) + period) % period;
const smooth = (value: number) => value * value * (3 - 2 * value);
const ramp = (from: number, to: number, value: number) => smooth(clamp((value - from) / (to - from)));

function randomSource(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic lattice noise permits long, seamless movement with no visible tile edge. */
function noise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const hash = (px: number, py: number) => {
    let n = Math.imul(wrap(px, periodX) + seed, 374761393);
    n ^= Math.imul(wrap(py, periodY), 668265263);
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0, weight = 0, amplitude = 0.56, frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * frequency, y * frequency, 6 * frequency, 4 * frequency, seed + octave * 97) * amplitude;
    weight += amplitude;
    amplitude *= 0.51;
    frequency *= 2;
  }
  return sum / weight;
}

function createTexture(seed: number, wispy: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  // Pixel work happens once. The animation only samples/scales these cached textures.
  const pixels = ctx.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  for (let y = 0; y < TEXTURE_HEIGHT; y++) {
    for (let x = 0; x < TEXTURE_WIDTH; x++) {
      const u = x / TEXTURE_WIDTH * 6, v = y / TEXTURE_HEIGHT * 4;
      const warpX = noise(u, v, 6, 4, seed + 23) - 0.5;
      const warpY = noise(u + 2, v + 1, 6, 4, seed + 61) - 0.5;
      const field = fbm(u + warpX * (wispy ? 1 : 0.52), v + warpY * (wispy ? 1.4 : 0.65), seed);
      const detail = noise(u * 16, v * 16, 96, 64, seed + 83);
      const body = ramp(wispy ? 0.39 : 0.34, wispy ? 0.72 : 0.7, field);
      const light = fbm(u + warpX * (wispy ? 1 : 0.52) - 0.055, v + warpY * (wispy ? 1.4 : 0.65) - 0.045, seed, 3);
      const shade = clamp(0.68 + (light - field) * 2.2 + detail * 0.13);
      const offset = (y * TEXTURE_WIDTH + x) * 4;
      pixels.data[offset] = 172 + shade * 78;
      pixels.data[offset + 1] = 180 + shade * 70;
      pixels.data[offset + 2] = 190 + shade * 60;
      pixels.data[offset + 3] = Math.pow(body, wispy ? 1.65 : 1.22) * 248;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function fogProfile(type: string, night: boolean): FogProfile {
  const fog = type.includes("fog"), shallow = type === "shallow-fog";
  const patch = type === "patchy-fog", partial = type === "partial-fog";
  const dust = type.includes("dust"), sand = type.includes("sand");
  const smoke = type === "smoke", ash = type === "volcanic-ash";
  const ground = shallow || type.startsWith("drifting-");
  let color = type === "freezing-fog" ? [208, 228, 237] : fog ? [209, 220, 223] : [185, 204, 211];
  if (type === "haze") color = [196, 184, 156];
  if (smoke) color = [112, 103, 89];
  if (dust) color = [169, 139, 103];
  if (sand) color = [196, 155, 99];
  if (ash) color = [98, 100, 104];
  const light = night ? 0.4 : 1;
  return {
    red: color[0] * light,
    green: color[1] * light,
    blue: color[2] * (night ? 0.49 : 1),
    top: ground ? 0.51 : smoke ? 0.055 : ash ? 0.13 : fog ? 0.28 : 0.3,
    peak: ground ? 0.68 : smoke ? 0.38 : ash ? 0.48 : 0.56,
    bottom: ground ? 0.91 : fog ? 0.84 : 0.78,
    patch: patch ? 0.88 : smoke || ash ? 0.65 : 0,
    side: partial ? 0.85 : 0,
    texture: type === "haze" ? 0.12 : smoke || ash ? 0.95 : patch ? 0.88 : 0.48,
    // Suspended smoke occupies the sky in irregular billows rather than lying in
    // the same pale, horizontal bank as fog. Interpolate this too during changes.
    loft: smoke ? 1 : 0,
  };
}

function makeBolt(random: () => number, level: AtmosphereSpec["lightningLevel"]): Bolt {
  const near = level === "station" || level === "severe";
  const x = 0.19 + random() * 0.65, y = near ? 0.1 + random() * 0.17 : 0.27 + random() * 0.13;
  const endY = near ? 0.48 + random() * 0.075 : 0.46 + random() * 0.04;
  const points = near ? 21 : 14, trunk: Point[] = [{ x, y }], branches: Point[][] = [];
  const lean = (random() - 0.5) * 0.16;
  let currentX = x;
  for (let index = 1; index <= points; index++) {
    currentX += lean / points + (random() - 0.5) * (near ? 0.025 : 0.012);
    trunk.push({ x: currentX, y: mix(y, endY, index / points) });
  }
  for (let branch = 0; branch < (near ? 4 : 2); branch++) {
    const start = trunk[3 + Math.floor(random() * (points - 7))];
    const path: Point[] = [{ ...start }], direction = random() < 0.5 ? -1 : 1;
    let bx = start.x, by = start.y;
    const count = 4 + Math.floor(random() * 5);
    for (let step = 0; step < count; step++) {
      bx += direction * (0.005 + random() * 0.013);
      by += 0.004 + random() * 0.013;
      path.push({ x: bx, y: by });
    }
    branches.push(path);
  }
  return { trunk, branches, x, y: y + 0.07, radius: near ? 0.3 + random() * 0.12 : 0.22, energy: 0.65 + random() * 0.35 };
}

/** Draw a seamless tile larger than the viewport, never a grid of repeated cloud blobs. */
function sampleTexture(
  ctx: CanvasRenderingContext2D,
  texture: HTMLCanvasElement,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): void {
  const startX = -wrap(offsetX, width), startY = -wrap(offsetY, height);
  for (let y = startY; y < COMPOSITE_HEIGHT; y += height) {
    for (let x = startX; x < COMPOSITE_WIDTH; x += width) ctx.drawImage(texture, x, y, width, height);
  }
}

export function createAtmosphereRenderer(): {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number, spec: AtmosphereSpec, lightning: LightningFrame) => void;
  dispose: () => void;
} {
  let textures: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  let composite: HTMLCanvasElement | null = null;
  let buffer: CanvasRenderingContext2D | null = null;
  let state: AtmosphereState | null = null;
  let fog: FogProfile | null = null;
  let fogTarget: FogProfile | null = null;
  let fogSignature = "";
  let motionTime = 0, travelX = 0, travelY = 0;
  let lastCluster = -1, lightEnergy = 0, bolt: Bolt | null = null;
  let lastLightningLevel: AtmosphereSpec["lightningLevel"] = "none";
  let disposed = false;
  const random = randomSource(Math.floor(Math.random() * 0xffffffff));

  function initialize(): boolean {
    if (disposed || typeof document === "undefined") return false;
    if (!composite) {
      textures = [createTexture(431, false), createTexture(7919, true)];
      composite = document.createElement("canvas");
      composite.width = COMPOSITE_WIDTH;
      composite.height = COMPOSITE_HEIGHT;
      buffer = composite.getContext("2d");
    }
    return !!buffer && !!textures;
  }

  function clearBuffer(): void {
    if (!buffer) return;
    buffer.globalAlpha = 1;
    buffer.globalCompositeOperation = "source-over";
    buffer.clearRect(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
  }

  function drawClouds(ctx: CanvasRenderingContext2D, w: number, h: number, spec: AtmosphereSpec): void {
    if (!state || !buffer || !composite || !textures) return;
    const coverage = Math.max(state.coverage, state.storm * 0.82);
    if (coverage < 0.004 && lightEnergy < 0.005) return;
    clearBuffer();
    const cw = COMPOSITE_WIDTH, ch = COMPOSITE_HEIGHT;
    const layers = spec.quality === "low" ? 2 : 3;
    const closedDeck = ramp(0.8, 1, coverage);
    // Let the original broken-cloud gaps survive instead of veiling them in pale
    // daytime texture. A closed deck retains its full coverage at sunset.
    const sunsetOpacity = 1 - state.sunset * (1 - closedDeck) * 0.35;
    for (let layer = 0; layer < layers; layer++) {
      const high = layer === 0;
      const evolution = Math.sin(motionTime / (17 + layer * 9) + layer * 2.3);
      const scaleX = high ? 2.26 : layer === 1 ? 1.89 : 2.71;
      const scaleY = high ? 0.56 : layer === 1 ? 0.93 : 1.24;
      const parallax = high ? 0.22 : layer === 1 ? 0.62 : 1.08 + state.low * 0.28;
      const opacity = high ? coverage * (0.18 + (1 - state.storm) * 0.13) : layer === 1 ? coverage * (0.51 + state.storm * 0.28) : coverage * coverage * (0.44 + state.storm * 0.2);
      buffer.globalAlpha = opacity * sunsetOpacity;
      sampleTexture(buffer, textures[high ? 1 : 0], cw * (scaleX + evolution * 0.045), ch * scaleY,
        travelX * parallax + layer * 197 + Math.sin(motionTime / 39 + layer) * 14,
        travelY * parallax + layer * 83 + evolution * 7);
    }
    buffer.globalAlpha = 1;
    // Translucent tint preserves the light-and-shadow structure baked into each texture.
    buffer.globalCompositeOperation = "source-atop";
    const tint = buffer.createLinearGradient(0, 0, cw * 0.18, ch * 0.6);
    const darkness = clamp(state.storm * 0.88 + state.night * 0.8 + state.sunset * 0.68, 0, 0.94);
    tint.addColorStop(0, `rgba(${Math.round(mix(197, 34, darkness))},${Math.round(mix(211, 48, darkness))},${Math.round(mix(223, 67, darkness))},${0.12 + darkness * 0.84})`);
    tint.addColorStop(0.55, `rgba(${Math.round(mix(156, 22, darkness))},${Math.round(mix(178, 34, darkness))},${Math.round(mix(193, 51, darkness))},${0.15 + darkness * 0.83})`);
    tint.addColorStop(1, `rgba(35,49,65,${state.storm * 0.88 + state.night * 0.1})`);
    buffer.fillStyle = tint;
    buffer.fillRect(0, 0, cw, ch);

    // Cloud-local scattering uses the cloud alpha itself, rather than flashing the scene.
    if (lightEnergy > 0.003 && bolt && !spec.reduced) {
      for (let lobe = 0; lobe < (spec.quality === "low" ? 2 : 3); lobe++) {
        const lx = (bolt.x + Math.sin(lobe * 3.7 + lastCluster) * 0.085) * cw;
        const ly = (bolt.y + Math.cos(lobe * 2.1) * 0.046) * ch;
        const radius = cw * bolt.radius * (lobe === 0 ? 1 : 0.55);
        const glow = buffer.createRadialGradient(lx, ly, 0, lx, ly, radius);
        const strength = lightEnergy * (lobe === 0 ? 1 : 0.7);
        glow.addColorStop(0, `rgba(245,250,255,${strength})`);
        glow.addColorStop(0.25, `rgba(205,226,255,${strength * 0.93})`);
        glow.addColorStop(0.68, `rgba(122,166,236,${strength * 0.4})`);
        glow.addColorStop(1, "rgba(75,113,180,0)");
        buffer.fillStyle = glow;
        buffer.fillRect(0, 0, cw, ch);
      }
    }
    buffer.globalCompositeOperation = "destination-in";
    const skyMask = buffer.createLinearGradient(0, 0, 0, ch);
    skyMask.addColorStop(0, "rgba(0,0,0,1)");
    skyMask.addColorStop(0.22, "rgba(0,0,0,.96)");
    skyMask.addColorStop(0.39, `rgba(0,0,0,${0.5 + state.low * 0.16})`);
    skyMask.addColorStop(0.52, "rgba(0,0,0,.11)");
    skyMask.addColorStop(0.62, "rgba(0,0,0,0)");
    skyMask.addColorStop(1, "rgba(0,0,0,0)");
    buffer.fillStyle = skyMask;
    buffer.fillRect(0, 0, cw, ch);
    ctx.drawImage(composite, 0, 0, w, h);
  }

  function drawFog(ctx: CanvasRenderingContext2D, w: number, h: number, spec: AtmosphereSpec): void {
    if (!state || !fog || !buffer || !textures || !composite) return;
    const amount = Math.max(state.density, state.horizon * 0.7, state.veil);
    if (amount < 0.003) return;
    clearBuffer();
    const cw = COMPOSITE_WIDTH, ch = COMPOSITE_HEIGHT;
    const rgb = `${Math.round(fog.red)},${Math.round(fog.green)},${Math.round(fog.blue)}`;
    // Fog attenuates distant objects in a horizontal bank. Smoke has less uniform
    // coverage, taller curls and a gentle rise; neither needs particles or fire.
    buffer.fillStyle = `rgba(${rgb},${clamp(state.density * 0.4 + state.horizon * 0.42) * (1 - fog.patch * 0.72) * (1 - fog.loft * 0.58)})`;
    buffer.fillRect(0, 0, cw, ch);
    buffer.globalAlpha = clamp(amount * (0.38 + fog.texture * 0.45 + fog.loft * 0.16));
    sampleTexture(buffer, textures[1], cw * mix(1.64, 1.18, fog.loft), ch * mix(0.3 + fog.texture * 0.16, 1.05, fog.loft),
      travelX * mix(0.12, 0.56, fog.loft) + 137,
      travelY * 0.035 + 67 + Math.sin(motionTime / 89) * 3 + motionTime * fog.loft * 1.9);
    if (spec.quality === "full" && fog.texture > 0.3) {
      buffer.globalAlpha = amount * fog.texture * mix(0.25, 0.44, fog.loft);
      sampleTexture(buffer, textures[0], cw * mix(2.39, 1.67, fog.loft), ch * mix(0.42, 0.89, fog.loft),
        travelX * mix(0.21, 0.82, fog.loft) + 43,
        travelY * 0.055 + 101 + motionTime * fog.loft * 1.15);
    }
    buffer.globalAlpha = 1;
    buffer.globalCompositeOperation = "source-in";
    if (fog.loft > 0.003) {
      const smokeTint = buffer.createLinearGradient(0, 0, 0, ch * 0.8);
      const { red, green, blue } = fog;
      const shade = (factor: number) => `rgb(${Math.round(red * factor)},${Math.round(green * factor)},${Math.round(blue * factor)})`;
      smokeTint.addColorStop(0, shade(1 - fog.loft * 0.28));
      smokeTint.addColorStop(0.48, `rgb(${rgb})`);
      smokeTint.addColorStop(1, shade(1 - fog.loft * 0.12));
      buffer.fillStyle = smokeTint;
    } else buffer.fillStyle = `rgb(${rgb})`;
    buffer.fillRect(0, 0, cw, ch);
    buffer.globalCompositeOperation = "destination-in";
    const depth = buffer.createLinearGradient(0, 0, 0, ch);
    depth.addColorStop(0, `rgba(0,0,0,${state.veil * 0.14})`);
    depth.addColorStop(clamp(fog.top, 0.01, 0.48), `rgba(0,0,0,${state.veil * 0.35})`);
    // The old fixed .49/.51 lower bounds flattened smoke back onto the fog bank.
    depth.addColorStop(clamp(fog.peak - 0.055, mix(0.49, 0.25, fog.loft), 0.7), "rgba(0,0,0,.78)");
    depth.addColorStop(clamp(fog.peak, mix(0.51, 0.3, fog.loft), 0.76), "rgba(0,0,0,1)");
    depth.addColorStop(clamp(fog.bottom, 0.77, 0.94), `rgba(0,0,0,${0.05 + state.veil * 0.4})`);
    depth.addColorStop(1, `rgba(0,0,0,${state.veil * 0.12})`);
    buffer.fillStyle = depth;
    buffer.fillRect(0, 0, cw, ch);
    if (fog.side > 0.003) {
      const side = buffer.createLinearGradient(0, 0, cw, 0);
      side.addColorStop(0, "rgba(0,0,0,1)");
      side.addColorStop(0.3, "rgba(0,0,0,.95)");
      side.addColorStop(0.82, `rgba(0,0,0,${1 - fog.side})`);
      side.addColorStop(1, `rgba(0,0,0,${1 - fog.side})`);
      buffer.fillStyle = side;
      buffer.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(composite, 0, 0, w, h);
  }

  function drawBolt(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number, low: boolean): void {
    if (!bolt) return;
    const trace = (points: Point[]) => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        if (i === 0) ctx.moveTo(points[i].x * w, points[i].y * h);
        else ctx.lineTo(points[i].x * w, points[i].y * h);
      }
      ctx.stroke();
    };
    const scale = clamp(w / 1600, 0.65, 1.6);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!low) {
      ctx.globalAlpha = strength * 0.2;
      ctx.strokeStyle = "#81aafa";
      ctx.lineWidth = 15 * scale;
      trace(bolt.trunk);
    }
    ctx.globalAlpha = strength * 0.62;
    ctx.strokeStyle = "#b1ceff";
    ctx.lineWidth = 6 * scale;
    trace(bolt.trunk);
    ctx.globalAlpha = strength;
    ctx.strokeStyle = "#eef4ff";
    ctx.lineWidth = 2.05 * scale;
    trace(bolt.trunk);
    for (let i = 0; i < Math.min(bolt.branches.length, low ? 2 : 4); i++) {
      ctx.globalAlpha = strength * (0.58 - i * 0.075);
      ctx.lineWidth = (1.3 - i * 0.13) * scale;
      trace(bolt.branches[i]);
    }
  }

  return {
    draw(ctx, w, h, _now, dt, spec, lightning) {
      if (w <= 0 || h <= 0 || !initialize()) return;
      const step = clamp(dt, 0, 0.1);
      const ease = 1 - Math.exp(-step / 3.4);
      const target: AtmosphereState = {
        coverage: clamp(spec.coverage), low: spec.ceiling === null ? 0.2 : 1 - clamp(spec.ceiling / 8500),
        storm: clamp(spec.storm), density: clamp(spec.density), horizon: clamp(spec.horizon), veil: clamp(spec.veil),
        windX: clamp(spec.windX, -120, 120), windY: clamp(spec.windY, -50, 50), gust: clamp(spec.gust), night: spec.night ? 1 : 0,
        sunset: spec.obscuration === "none" ? cloudSunsetStrength(spec.phase, spec.coverage, spec.ceiling, spec.storm) : 0,
      };
      // Reduced motion is drawn on demand with dt=0, so new observations must snap
      // to their static appearance rather than leaving the previous weather frozen.
      if (!state || spec.reduced) state = target;
      else for (const key of Object.keys(target) as (keyof AtmosphereState)[]) state[key] = mix(state[key], target[key], ease);
      const nextFogSignature = `${spec.obscuration}:${spec.night}`;
      if (nextFogSignature !== fogSignature || !fogTarget) {
        fogSignature = nextFogSignature;
        fogTarget = fogProfile(spec.obscuration, spec.night);
      }
      if (!fog || spec.reduced) fog = { ...fogTarget };
      else for (const key of Object.keys(fogTarget) as (keyof FogProfile)[]) fog[key] = mix(fog[key], fogTarget[key], ease);
      if (!spec.reduced) {
        motionTime += step;
        const gust = 1 + state.gust * (Math.sin(motionTime / 4.7) * 0.15 + Math.sin(motionTime / 9.3 + 1.6) * 0.11);
        // A calm METAR surface wind does not imply stationary convective cloud aloft.
        // This illustrative storm drift floor keeps the shelf visibly moving while
        // preserving the observed wind sign. It is a visual cue, not an upper-air report.
        const cloudDrift = Math.abs(state.windX) >= 1 ? Math.sign(state.windX) : 1;
        // Closed decks need differential texture motion even with calm or
        // camera-aligned surface wind; otherwise only the photo's slow pan reads.
        // Keep SCT/FEW untouched and avoid interpreting this as measured cloud wind.
        // Broken sunset cloud banks need the same visible aloft motion when
        // surface wind is calm or nearly aligned with the camera. This changes
        // travel only, not density, color, or the observed wind instruments.
        const deckDrift = Math.max(ramp(0.8, 1, state.coverage), state.sunset * ramp(0.44, 0.76, state.coverage)) * (12 + state.low * 5);
        const driftSpeed = Math.max(Math.abs(state.windX), deckDrift, state.storm * (18 + state.storm * 20));
        // Sampling offsets run opposite to the visible movement of the texture.
        travelX -= cloudDrift * driftSpeed * step * COMPOSITE_WIDTH / w * gust;
        travelY -= state.windY * step * COMPOSITE_HEIGHT / h * gust;
      }
      const canFlash = !spec.reduced && spec.lightningLevel !== "none";
      if (spec.lightningLevel !== lastLightningLevel) {
        lastLightningLevel = spec.lightningLevel;
        lastCluster = -1;
        bolt = null;
        lightEnergy = 0;
      }
      if (canFlash && lightning.pulse > 0 && lightning.cluster !== lastCluster) {
        lastCluster = lightning.cluster;
        bolt = makeBolt(random, spec.lightningLevel);
      }
      const lightTarget = canFlash && lightning.pulse > 0 ? (lightning.pulse === 1 ? 1 : 0.62) * (bolt?.energy ?? 1) : 0;
      lightEnergy = canFlash ? (lightTarget > lightEnergy ? lightTarget : lightEnergy * Math.exp(-step / 0.065)) : 0;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      // Storm intensity is a sky shadow, fading completely before the near runway.
      if (state.storm > 0.003) {
        const shadow = ctx.createLinearGradient(0, 0, 0, h * 0.72);
        shadow.addColorStop(0, `rgba(9,19,34,${state.storm * (0.31 - state.night * 0.12)})`);
        shadow.addColorStop(0.57, `rgba(17,29,42,${state.storm * 0.16})`);
        shadow.addColorStop(1, "rgba(17,29,42,0)");
        ctx.fillStyle = shadow;
        ctx.fillRect(0, 0, w, h * 0.72);
      }
      if (canFlash && lightEnergy > 0.003 && bolt) {
        // Limited light scattering around the strike bridges gaps between cloud
        // alpha without a whole-screen exposure change. The runway stays untouched.
        const x = bolt.x * w, y = Math.min(bolt.y, 0.27) * h;
        const radius = Math.min(w * 0.23, h * 0.31);
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
        halo.addColorStop(0, `rgba(216,234,255,${lightEnergy * 0.33})`);
        halo.addColorStop(0.36, `rgba(142,180,241,${lightEnergy * 0.16})`);
        halo.addColorStop(1, "rgba(97,142,212,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      drawClouds(ctx, w, h, spec);
      if (canFlash && lightning.bolt && lightning.pulse > 0) drawBolt(ctx, w, h, lightEnergy, spec.quality === "low");
      ctx.globalAlpha = 1;
      drawFog(ctx, w, h, spec);
      ctx.restore();
    },
    dispose() {
      disposed = true;
      if (textures) for (const texture of textures) { texture.width = 1; texture.height = 1; }
      if (composite) { composite.width = 1; composite.height = 1; }
      textures = null;
      composite = null;
      buffer = null;
      state = null;
      fog = null;
      fogTarget = null;
      bolt = null;
    },
  };
}
