import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildWeatherEffects } from "../app/weatherController.ts";
import { NO_LIGHTNING } from "../app/lightning.ts";
import * as frozenPrecipitation from "../app/frozenPrecipitation.ts";

const source = readFileSync(new URL("../app/PrecipCanvas.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const observation = { phenomena: ["+RA"], coverage: "OVC", ceiling: 1200, visibility: 1,
  windDirection: 250, windSpeed: 20, gust: 30, lightning: NO_LIGHTNING,
  night: false, quality: "full", reduced: false };

// Execute the real component with deterministic hooks, frame timing and Canvas protocols.
// This verifies lifecycle/detail selection, not rendered pixels or real-device performance.
function harness({ width = 1920, height = 1080, unavailableContext = false } = {}) {
  let now = 0, nextFrame = 0, hookIndex = 0, renderCost = 0, disconnected = false;
  const hooks = [], effects = [], pending = [], frames = new Map(), draws = [], canvases = new Map();
  const windowEvents = new Map(), documentEvents = new Map(), images = [];
  let atmosphereDisposed = 0, photoDisposed = 0, randomSeed = 47;
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => ((randomSeed = Math.imul(randomSeed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (String(key).startsWith("create") && String(key).endsWith("Gradient")) return () => ({ addColorStop() {} });
    return () => {};
  } });
  const host = { getBoundingClientRect: () => ({ width, height }), querySelectorAll: () => [] };
  const canvas = className => ({ className, width: 0, height: 0, style: {}, dataset: {}, parentElement: host,
    getContext: () => unavailableContext ? null : ctx, closest: () => ({ dataset: {} }) });
  const jsx = (tag, props) => {
    if (tag === "canvas") {
      if (!canvases.has(props.className)) canvases.set(props.className, canvas(props.className));
      props.ref.current = canvases.get(props.className);
    }
    return null;
  };
  const document = { visibilityState: "visible",
    addEventListener: (type, fn) => documentEvents.set(type, fn),
    removeEventListener: (type, fn) => { if (documentEvents.get(type) === fn) documentEvents.delete(type); } };
  const sandbox = { exports: {}, structuredClone, Math: deterministicMath, performance: { now: () => now }, document,
    window: { devicePixelRatio: 2, addEventListener: (type, fn) => windowEvents.set(type, fn),
      removeEventListener: (type, fn) => { if (windowEvents.get(type) === fn) windowEvents.delete(type); } },
    Image: class { constructor() { images.push(this); } },
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
    requestAnimationFrame: fn => { const id = ++nextFrame; frames.set(id, fn); assert.ok(frames.size <= 1, "One outstanding shared frame"); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    require(name) {
      if (name === "react") return {
        useRef(value) { const index = hookIndex++; return hooks[index] ??= { current: value }; },
        useEffect(fn, deps) {
          const index = hookIndex++, old = effects[index];
          if (!old || deps.some((value, i) => value !== old.deps[i])) {
            effects[index] = { deps, cleanup: old?.cleanup };
            pending.push(() => { effects[index].cleanup?.(); effects[index].cleanup = fn(); });
          }
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./frozenPrecipitation") return frozenPrecipitation;
      if (name === "./atmosphereRenderer") return { createAtmosphereRenderer: () => ({
        draw(_ctx, _w, _h, _time, dt, spec) { draws.push({ dt, spec }); now += renderCost; },
        dispose() { atmosphereDisposed++; },
      }) };
      if (name === "./photographicSky") return { createPhotographicSky: () => ({ draw() {}, dispose() { photoDisposed++; } }) };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, sandbox);
  let props;
  const render = (changes = {}) => {
    const result = buildWeatherEffects({ ...observation, ...changes });
    props = { spec: result.spec, atmosphere: result.atmosphere, backgroundSrc: "test-sky.webp", paused: false, ...changes.props };
    hookIndex = 0;
    sandbox.exports.default(props);
    while (pending.length) pending.shift()();
    return result;
  };
  return { render, draws, frames, images, documentEvents, windowEvents,
    get canvas() { return canvases.get("precip-canvas"); },
    get sky() { return canvases.get("photographic-sky-canvas"); },
    get particles() { return hooks.find(hook => Array.isArray(hook?.current) && hook.current[0]?.kind)?.current || []; },
    get impacts() { return hooks.find(hook => Array.isArray(hook?.current) && hook.current[0]?.ground !== undefined)?.current || []; },
    setCost(ms) { renderCost = ms; },
    tick(ms = 34) {
      const frame = frames.entries().next().value;
      assert.ok(frame, "Expected a queued animation frame");
      frames.delete(frame[0]); now += ms; frame[1](now);
    },
    visibility(value) { document.visibilityState = value; documentEvents.get("visibilitychange")?.(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
    assertDisposed() { assert.equal(atmosphereDisposed, 1); assert.equal(photoDisposed, 1); assert.equal(disconnected, true); },
  };
}

test("normal startup stays full quality on all hardware; low remains an explicit preview choice", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /hardwareConcurrency|deviceMemory|detectPerf/);
  const initial = page.match(/const pf=q\.get\("debugPerformance"\);\s*setPerf\([^;]+;/)?.[0];
  assert.ok(initial, "Inspect the actual query-driven quality initializer");
  for (const [query, expected] of [["", "full"], ["?debugPerformance=unknown", "full"], ["?debugPerformance=full", "full"], ["?debugPerformance=low", "low"]]) {
    let quality;
    vm.runInNewContext(initial, { q: new URLSearchParams(query), setPerf: value => { quality = value; } });
    assert.equal(quality, expected);
  }
});

test("sustained slow rendering cannot lower detail, population or buffer size", () => {
  const h = harness({ width: 3840, height: 2160 });
  try {
    const result = h.render();
    h.setCost(80);
    for (let i = 0; i < 180; i++) h.tick(80);
    assert.ok(h.draws.length >= 180);
    assert.ok(h.draws.every(draw => draw.spec.quality === "full"));
    assert.equal(h.canvas.dataset.quality, "full");
    assert.equal(h.canvas.dataset.adaptive, "0");
    assert.equal(Number(h.canvas.dataset.count), result.spec.count);
    assert.ok(Number(h.canvas.dataset.renderMs) > 70, "Slow-frame diagnostics still report actual cost");
    assert.ok(h.canvas.width * h.canvas.height <= 3203000, "Full-quality backing buffer stays bounded, allowing rounding");
    assert.ok(h.canvas.width * h.canvas.height > 3000000, "No low-quality backing buffer downgrade");
    assert.ok(h.sky.width <= 960 && h.sky.height <= 540);
    assert.equal(h.frames.size, 1);
  } finally { h.cleanup(); }
});

test("explicit preview quality switches remain reversible without additional animation loops", () => {
  const h = harness();
  try {
    h.render(); h.tick();
    const fullWidth = h.canvas.width;
    const low = h.render({ quality: "low" });
    for (let i = 0; i < 140; i++) h.tick(100);
    assert.equal(h.canvas.dataset.quality, "low");
    assert.equal(Number(h.canvas.dataset.count), low.spec.count);
    assert.ok(h.canvas.width < fullWidth);
    const full = h.render();
    for (let i = 0; i < 140; i++) h.tick(100);
    assert.equal(h.canvas.dataset.quality, "full");
    assert.equal(Number(h.canvas.dataset.count), full.spec.count);
    assert.equal(h.canvas.width, fullWidth);
    assert.equal(h.frames.size, 1);
  } finally { h.cleanup(); }
});

test("hidden tabs pause, resume once, and cleanup releases frames and listeners", () => {
  const h = harness();
  h.render(); h.tick();
  h.visibility("hidden");
  assert.equal(h.frames.size, 0);
  assert.equal(h.canvas.dataset.running, "0");
  h.render();
  assert.equal(h.frames.size, 0);
  h.visibility("visible"); h.visibility("visible");
  assert.equal(h.frames.size, 1);
  h.tick();
  h.cleanup();
  assert.equal(h.frames.size, 0);
  assert.equal(h.windowEvents.size, 0);
  assert.equal(h.documentEvents.size, 0);
  h.assertDisposed();
  assert.equal(h.images[0].onload, null);
  assert.equal(h.images[0].onerror, null);
});

test("reduced-motion full quality renders statically and explicit pause stops scheduling", () => {
  const h = harness();
  try {
    h.render({ reduced: true }); h.tick();
    assert.equal(h.canvas.dataset.quality, "full");
    assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.canvas.dataset.fps, "0");
    assert.equal(h.frames.size, 0);
    assert.ok(h.draws.every(draw => draw.dt === 0 && draw.spec.reduced));
    h.render(); h.tick();
    h.render({ props: { paused: true } }); h.tick();
    assert.equal(h.frames.size, 0);
    h.render();
    assert.equal(h.frames.size, 1);
  } finally { h.cleanup(); }
});

test("missing Canvas context leaves the static scene and schedules no weather loop", () => {
  const h = harness({ unavailableContext: true });
  h.render();
  assert.equal(h.canvas.dataset.active, "0");
  assert.equal(h.frames.size, 0);
  h.cleanup();
});

test("unavailable observations settle to a static full-quality scene", () => {
  const h = harness();
  try {
    h.render({ available: false });
    for (let i = 0; i < 100 && h.frames.size; i++) h.tick(100);
    assert.equal(h.canvas.dataset.count, "0");
    assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.canvas.dataset.quality, "full");
    assert.equal(h.frames.size, 0);
  } finally { h.cleanup(); }
});


test("frozen sources stay distributed and recycle independently of bounded natural impacts", () => {
  for (const phenomena of [["-SN"], ["SN"], ["+SN"], ["SHSN"], ["SHPL"], ["SHGR"], ["BLSN"], ["PL"], ["GR"], ["GS"], ["FZRA"], ["FZDZ"], ["FZRAPL"], ["RASN"]]) {
    const h = harness({ width: 1280, height: 720 });
    try {
      const expected = h.render({ phenomena }).spec;
      h.tick();
      assert.equal(h.particles.length, expected.count + (expected.secondary?.count || 0));
      assert.ok(h.particles.filter(p => p.y >= 0 && p.y <= 720).length / h.particles.length > .78,
        `${phenomena}: startup is an already-distributed field, not half a screen of incoming cohort`);
      let sawImpact = false;
      for (let frame = 0; frame < 480; frame++) {
        h.tick();
        assert.ok(h.particles.every(p => p.v >= 0), `${phenomena}: no falling source waits through a rebound`);
        assert.equal(h.particles.length, expected.count + (expected.secondary?.count || 0));
        assert.ok(h.impacts.length <= frozenPrecipitation.MAX_FROZEN_IMPACTS);
        if (h.impacts.length) sawImpact = true;
      }
      assert.equal(sawImpact, expected.bounce || !!expected.secondary?.bounce, `${phenomena}: bounce only belongs to pellets/hail`);
      h.render({ phenomena, reduced: true }); h.tick();
      assert.equal(h.impacts.length, 0);
      assert.equal(h.frames.size, 0, "Reduced motion has no animated impacts");
    } finally { h.cleanup(); }
    assert.equal(h.impacts.length, 0);
  }
});
