import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildWeatherEffects } from "../app/weatherController.ts";
import { NO_LIGHTNING } from "../app/lightning.ts";
import * as frozenPrecipitation from "../app/frozenPrecipitation.ts";
// An isolated candidate can be exercised without copying or editing production code.
// Example: PRECIP_CANVAS_SOURCE_ROOT=/absolute/checkout/app/ node --experimental-strip-types --test ...
const sourceRoot = new URL(process.env.PRECIP_CANVAS_SOURCE_ROOT || "../app/", import.meta.url);
const photographicSky = await import(new URL("photographicSky.ts", sourceRoot));

const compiled = ts.transpileModule(
  readFileSync(new URL("PrecipCanvas.tsx", sourceRoot), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const photoSource = scene => `/clock/assets/backgrounds/${scene}.png`;

// Run the real component and its effects. Only browser/React protocols and the two
// painter implementations are replaced: these tests check lifecycle, not pixels.
// Any exported photographic policy remains real, so image eligibility is not mocked.
function harness({ width = 1920, height = 1080, dpr = 2, unavailableContext = false, unavailableSkyContext = false } = {}) {
  let now = 0, nextFrame = 0, hookIndex = 0, disposed = false, maximumFrames = 0;
  let atmosphereCreated = 0, atmosphereDisposed = 0, photoCreated = 0, photoDisposed = 0;
  const hooks = [], effects = [], pendingEffects = [], images = [], observers = [];
  const failedPlates = new WeakSet();
  const frames = new Map(), canvases = new Map(), photoDraws = [], atmosphereDraws = [];
  const windowEvents = new Map(), documentEvents = new Map();
  const eventTarget = events => ({
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { const listeners = events.get(type); listeners?.delete(fn); if (!listeners?.size) events.delete(type); },
  });
  const dispatch = (events, type) => { for (const fn of [...(events.get(type) || [])]) fn(); };
  const host = { getBoundingClientRect: () => ({ width, height }), querySelectorAll: () => [] };
  const main = { dataset: {} };
  const makeCanvas = className => {
    const calls = [], state = { painted: null };
    const ctx = new Proxy({
      clearRect(...args) { calls.push({ method: "clearRect", args }); state.painted = null; },
      setTransform(...args) { calls.push({ method: "setTransform", args }); },
    }, { get(target, key) {
      if (key in target) return target[key];
      if (String(key).startsWith("create") && String(key).endsWith("Gradient")) return () => ({ addColorStop() {} });
      return () => {};
    } });
    return { className, width: 0, height: 0, style: {}, dataset: {}, parentElement: host, ctx, calls, state,
      getContext: () => unavailableContext || (unavailableSkyContext && className === "photographic-sky-canvas") ? null : ctx, closest: () => main };
  };
  const jsx = (tag, props) => {
    if (tag === "canvas") {
      if (!canvases.has(props.className)) canvases.set(props.className, makeCanvas(props.className));
      props.ref.current = canvases.get(props.className);
    }
    return null;
  };
  const document = { visibilityState: "visible", ...eventTarget(documentEvents) };
  const sandbox = {
    exports: {}, structuredClone, performance: { now: () => now }, document,
    window: { devicePixelRatio: dpr, ...eventTarget(windowEvents) },
    Image: class {
      width = 0; height = 0; naturalWidth = 0; naturalHeight = 0; complete = false;
      onload = null; onerror = null; src = "";
      constructor() { images.push(this); }
      get currentSrc() { return this.src; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.observed = []; observers.push(this); }
      observe(target) { this.observed.push(target); }
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      maximumFrames = Math.max(maximumFrames, frames.size);
      assert.ok(frames.size <= 1, "There must be only one outstanding shared animation frame");
      return id;
    },
    cancelAnimationFrame: id => frames.delete(id),
    require(name) {
      if (name === "react") return {
        useRef(value) { const index = hookIndex++; return hooks[index] ??= { current: value }; },
        useEffect(effect, deps) {
          const index = hookIndex++, previous = effects[index];
          if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
            const state = { deps: [...deps], cleanup: previous?.cleanup };
            effects[index] = state;
            pendingEffects.push(() => { state.cleanup?.(); state.cleanup = effect(); });
          }
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./frozenPrecipitation") return frozenPrecipitation;
      if (name === "./atmosphereRenderer") return { createAtmosphereRenderer() {
        atmosphereCreated++;
        return { draw(_ctx, w, h, time, dt, spec) { atmosphereDraws.push({ w, h, time, dt, spec: { ...spec } }); },
          dispose() { atmosphereDisposed++; } };
      } };
      if (name === "./photographicSky") return { ...photographicSky, createPhotographicSky() {
        photoCreated++;
        return { draw(ctx, w, h, dt, image, coverage, storm, windX, reduced, ...policy) {
          const usable = !reduced && !failedPlates.has(image) && photographicSky.photoSkyHasMotion(image);
          photoDraws.push({ w, h, dt, image, coverage, storm, windX, reduced, policy, usable });
          const canvas = [...canvases.values()].find(candidate => candidate.ctx === ctx);
          if (usable && canvas) canvas.state.painted = image;
          return usable;
        }, dispose() { photoDisposed++; } };
      } };
      throw new Error(`Unexpected component import: ${name}`);
    },
  };
  vm.runInNewContext(compiled, sandbox);
  let state = { phenomena: [], coverage: "CLR", ceiling: null, visibility: 10,
    windDirection: 250, windSpeed: 8, gust: null, lightning: NO_LIGHTNING,
    night: false, quality: "full", reduced: false, phase: "sunset", paused: false,
    backgroundSrc: photoSource("sunset") };
  const render = (changes = {}) => {
    assert.equal(disposed, false, "Cannot render an unmounted harness");
    state = { ...state, ...changes };
    const result = buildWeatherEffects(state);
    hookIndex = 0;
    sandbox.exports.default({ spec: result.spec, atmosphere: result.atmosphere,
      phase: state.phase, backgroundSrc: state.backgroundSrc, paused: state.paused, night: state.night });
    while (pendingEffects.length) pendingEffects.shift()();
    return result;
  };
  const tick = (ms = 34) => {
    const entry = frames.entries().next().value;
    assert.ok(entry, "Expected a queued animation frame");
    frames.delete(entry[0]); now += ms; entry[1](now);
  };
  return {
    render, tick, frames, images, observers, photoDraws, atmosphereDraws, documentEvents, windowEvents,
    get canvas() { return canvases.get("precip-canvas"); },
    get sky() { return canvases.get("photographic-sky-canvas"); },
    get maximumFrames() { return maximumFrames; },
    get now() { return now; },
    advance(ms) { now += ms; },
    run(ms, step = 100) { const end = now + ms; while (now < end && frames.size) tick(Math.min(step, end - now)); },
    load(image = images.at(-1)) {
      image.width = image.naturalWidth = 1672; image.height = image.naturalHeight = 941; image.complete = true;
      image.onload?.();
    },
    fail(image = images.at(-1)) { image.complete = true; image.onerror?.(); },
    failPlate(image = images.at(-1)) { failedPlates.add(image); },
    visibility(value) { document.visibilityState = value; dispatch(documentEvents, "visibilitychange"); },
    resize(w, h, devicePixelRatio = sandbox.window.devicePixelRatio) {
      width = w; height = h; sandbox.window.devicePixelRatio = devicePixelRatio;
      dispatch(windowEvents, "resize");
      for (const observer of observers) if (!observer.disconnected) observer.callback();
    },
    cleanup() {
      if (disposed) return;
      disposed = true;
      for (const effect of effects) effect?.cleanup?.();
    },
    assertDisposed() {
      assert.equal(frames.size, 0); assert.equal(windowEvents.size, 0); assert.equal(documentEvents.size, 0);
      assert.equal(atmosphereDisposed, atmosphereCreated); assert.equal(photoDisposed, photoCreated);
      assert.ok(observers.every(observer => observer.disconnected));
      assert.ok(images.every(image => image.onload === null && image.onerror === null));
    },
  };
}

function withHarness(run, options) {
  const h = harness(options);
  try { run(h); } finally { h.cleanup(); h.assertDisposed(); }
}

const clearCount = canvas => canvas.calls.filter(call => call.method === "clearRect").length;

// The decode happens after the component has stopped scheduling its startup frames.
// A sunset photograph is deliberately cloudy even when the current METAR is CLR.
test("late photographic load wakes an idle canvas after eight seconds and starts a fresh fade", () => {
  withHarness(h => {
    h.render();
    h.run(8200);
    assert.equal(h.frames.size, 0);
    assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.photoDraws.length, 0);
    h.advance(5000);
    h.load();
    assert.equal(h.canvas.dataset.photoSky, "ready");
    assert.equal(h.frames.size, 1);
    h.tick();
    const first = h.photoDraws.at(-1);
    assert.equal(first.image, h.images[0]);
    assert.ok(first.policy[0] > 0 && first.policy[0] < .02, "Fade starts at decode time, not initial mount");
    h.run(9000);
    assert.equal(h.frames.size, 1, "Cloud motion keeps running beyond the next idle deadline");
    assert.equal(h.canvas.dataset.running, "1");
    assert.equal(h.photoDraws.at(-1).policy[0], 1);
  });
});

test("rapid A to B to C loads keep the last decoded image and reject stale success/error callbacks", () => {
  withHarness(h => {
    h.render({ backgroundSrc: photoSource("sunset") });
    const a = h.images[0], staleALoad = a.onload, staleAError = a.onerror;
    h.load(a); h.tick(); h.run(4000);
    h.render({ backgroundSrc: photoSource("overcast-day") });
    const b = h.images[1], staleBLoad = b.onload, staleBError = b.onerror;
    h.render({ backgroundSrc: photoSource("partly-cloudy-day") });
    const c = h.images[2];
    assert.equal(a.onload, null); assert.equal(a.onerror, null);
    assert.equal(b.onload, null); assert.equal(b.onerror, null);
    staleBLoad(); staleBError(); h.tick();
    assert.equal(h.photoDraws.at(-1).image, a, "Pending sources cannot replace the last decoded image");
    h.load(c); h.tick();
    assert.equal(h.photoDraws.at(-1).image, c);
    const count = h.photoDraws.length;
    staleALoad(); staleAError(); staleBLoad(); staleBError(); h.tick();
    assert.equal(h.photoDraws.length, count + 1);
    assert.equal(h.photoDraws.at(-1).image, c, "Late superseded callbacks cannot restore or clear an older image");
    assert.equal(h.canvas.dataset.photoSky, "ready");
    assert.equal(h.maximumFrames, 1);
  });
});

test("failed replacement clears old photographic pixels and a later decoded source recovers", () => {
  withHarness(h => {
    h.render(); h.load(); h.tick();
    assert.equal(h.sky.state.painted, h.images[0]);
    h.render({ backgroundSrc: photoSource("missing") });
    const oldDrawCount = h.photoDraws.length, oldClearCount = clearCount(h.sky);
    h.fail(); h.tick();
    assert.equal(h.canvas.dataset.photoSky, "unavailable");
    assert.equal(h.photoDraws.length, oldDrawCount, "Failure stops drawing the old image");
    assert.equal(clearCount(h.sky), oldClearCount + 1, "The next shared frame clears the photographic canvas");
    assert.equal(h.sky.state.painted, null);
    h.run(8200);
    assert.equal(h.frames.size, 0, "A failed clear-weather photo must not keep an empty loop alive");
    h.render({ backgroundSrc: photoSource("sunset") }); h.load(); h.tick();
    assert.equal(h.canvas.dataset.photoSky, "ready");
    assert.equal(h.photoDraws.at(-1).image, h.images[2]);
  });
});

test("paused and hidden loads remain stopped, then resume once with a bounded time step", () => {
  withHarness(h => {
    h.render(); h.load(); h.tick();
    const drawCount = h.photoDraws.length;
    h.render({ paused: true }); h.tick();
    assert.equal(h.frames.size, 0); assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.photoDraws.length, drawCount);
    h.visibility("hidden");
    h.render({ backgroundSrc: photoSource("overcast-day") }); h.load();
    h.advance(120000);
    assert.equal(h.frames.size, 0);
    h.render({ paused: false });
    assert.equal(h.frames.size, 0, "Unpausing cannot schedule while the document remains hidden");
    h.visibility("visible"); h.visibility("visible");
    assert.equal(h.frames.size, 1);
    h.tick();
    assert.equal(h.photoDraws.at(-1).image, h.images[1]);
    assert.ok(h.photoDraws.at(-1).dt > 0 && h.photoDraws.at(-1).dt <= .1);
    h.visibility("hidden");
    assert.equal(h.frames.size, 0);
    h.advance(60000); h.visibility("visible"); h.tick();
    assert.ok(h.photoDraws.at(-1).dt <= .1, "A long hidden interval must never become a motion jump");
    assert.equal(h.maximumFrames, 1);
  });
});

test("reduced-motion toggles redraw statically, accept delayed images, and restart without another loop", () => {
  withHarness(h => {
    h.render({ coverage: "OVC", reduced: true }); h.tick();
    assert.equal(h.frames.size, 0); assert.equal(h.canvas.dataset.fps, "0");
    h.advance(15000); h.load();
    assert.equal(h.frames.size, 1); h.tick();
    assert.equal(h.frames.size, 0);
    assert.equal(h.photoDraws.at(-1).dt, 0); assert.equal(h.photoDraws.at(-1).reduced, true);
    assert.equal(h.sky.state.painted, null, "Reduced mode leaves no stale moving-sky overlay");
    for (let cycle = 0; cycle < 3; cycle++) {
      h.render({ reduced: false }); h.tick();
      assert.equal(h.frames.size, 1); assert.equal(h.photoDraws.at(-1).reduced, false);
      assert.ok(h.photoDraws.at(-1).dt > 0);
      h.render({ reduced: true }); h.tick();
      assert.equal(h.frames.size, 0); assert.equal(h.canvas.dataset.running, "0");
      assert.equal(h.photoDraws.at(-1).dt, 0); assert.equal(h.sky.state.painted, null);
    }
    assert.equal(h.maximumFrames, 1);
  });
});

test("resize and full/low switches preserve both buffer caps and the explicit frame-rate limits", () => {
  withHarness(h => {
    h.render({ coverage: "OVC" }); h.load(); h.tick();
    for (const [width, height, dpr] of [[3840, 2160, 3], [768, 1024, 2], [3440, 1440, 2], [1024, 768, 1]]) {
      for (const quality of ["low", "full"]) {
        h.render({ quality }); h.resize(width, height, dpr); h.tick(51);
        const cap = quality === "low" ? 1500000 : 3200000;
        assert.ok(h.canvas.width * h.canvas.height <= cap + 3000, `${quality}: precipitation pixel cap permits only rounding`);
        const expectedDpr = Math.min(dpr, quality === "low" ? 1 : 1.5, Math.sqrt(cap / (width * height)));
        assert.equal(h.canvas.width, Math.round(width * expectedDpr));
        assert.equal(h.canvas.height, Math.round(height * expectedDpr));
        assert.ok(h.sky.width <= 960 && h.sky.height <= 540);
        assert.equal(h.sky.style.width, `${width}px`); assert.equal(h.sky.style.height, `${height}px`);
        assert.equal(h.canvas.dataset.quality, quality);
        assert.equal(h.photoDraws.at(-1).w, width); assert.equal(h.photoDraws.at(-1).h, height);
        const count = h.photoDraws.length;
        h.tick(quality === "low" ? 48 : 31);
        assert.equal(h.photoDraws.length, count, "Frame throttle skips an early callback");
        h.tick(2);
        assert.equal(h.photoDraws.length, count + 1, "A due frame draws once");
        assert.equal(h.frames.size, 1);
      }
    }
    assert.equal(h.maximumFrames, 1);
  });
});

test("equal clock rerenders cannot reload the image or duplicate animation resources", () => {
  withHarness(h => {
    h.render({ coverage: "SCT" }); h.load(); h.tick();
    for (let index = 0; index < 60; index++) {
      h.render(); h.visibility("visible"); h.resize(1920, 1080); h.tick();
    }
    assert.equal(h.images.length, 1, "New object identities with equal values do not reload the photograph");
    assert.equal(h.observers.length, 1);
    assert.equal(h.windowEvents.get("resize").size, 1);
    assert.equal(h.documentEvents.get("visibilitychange").size, 1);
    assert.equal(h.maximumFrames, 1);
  });
});

test("unmount cancels work, detaches pending image callbacks, and releases canvases/listeners", () => {
  const h = harness();
  h.render(); h.load(); h.tick();
  h.render({ backgroundSrc: photoSource("overcast-day") });
  const pending = h.images[1], lateLoad = pending.onload, lateError = pending.onerror;
  const count = h.photoDraws.length;
  h.cleanup(); h.assertDisposed();
  assert.equal(h.sky.width, 1); assert.equal(h.sky.height, 1);
  lateLoad(); lateError(); h.visibility("visible"); h.resize(3840, 2160);
  assert.equal(h.frames.size, 0, "Already-queued stale callbacks cannot resurrect an unmounted component");
  assert.equal(h.photoDraws.length, count);
  h.cleanup(); h.assertDisposed();
});

test("missing Canvas context tolerates delayed image success/failure without scheduling work", () => {
  withHarness(h => {
    h.render(); h.load();
    h.render({ backgroundSrc: photoSource("missing") }); h.fail();
    assert.equal(h.canvas.dataset.active, "0");
    assert.equal(h.frames.size, 0); assert.equal(h.photoDraws.length, 0);
    assert.equal(h.observers.length, 0);
  }, { unavailableContext: true });
});


test("every cloudy artwork family keeps CLR animation alive without relying on the solar phase", () => {
  const scenes = ["clear-day", "partly-cloudy-day", "partly-cloudy-night", "overcast-day", "overcast-night",
    "rain-day", "rain-night", "thunderstorm-day", "thunderstorm-night", "snow-day", "snow-night",
    "fog-day", "fog-night", "sunrise", "sunset"];
  for (const scene of scenes) {
    withHarness(h => {
      h.render({ phase: "day", coverage: "CLR", backgroundSrc: photoSource(scene) });
      h.load(); h.tick(); h.run(9000);
      assert.equal(h.frames.size, 1, `${scene}: decoded artwork stays animated after the idle deadline`);
      assert.equal(h.canvas.dataset.running, "1", scene);
      assert.equal(h.photoDraws.at(-1).image, h.images[0], scene);
      assert.equal(h.photoDraws.at(-1).policy[0], 1, `${scene}: decode reveal completes`);
    });
  }
});

test("cloudless clear-night artwork can idle even under a sunset phase", () => {
  withHarness(h => {
    h.render({ phase: "sunset", backgroundSrc: photoSource("clear-night") });
    h.load(); h.tick(); h.run(9000);
    assert.equal(h.frames.size, 0, "An unrelated solar phase cannot animate a cloudless decoded photograph");
    assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.canvas.dataset.photoSky, "ready");
    h.render({ phase: "sunrise" }); h.run(9000);
    assert.equal(h.frames.size, 0, "A phase-only redraw settles again without reloading the same source");
    assert.equal(h.images.length, 1);
  });
});

test("idle eligibility follows the decoded photograph while newer phase and image requests are pending", () => {
  withHarness(h => {
    h.render({ phase: "night", backgroundSrc: photoSource("clear-night") });
    const clearNight = h.images[0]; h.load(clearNight); h.tick(); h.run(9000);
    assert.equal(h.frames.size, 0);

    h.render({ phase: "sunrise", backgroundSrc: photoSource("sunrise") });
    const sunrise = h.images[1]; h.run(9000);
    assert.equal(h.photoDraws.at(-1).image, clearNight, "Requested sunrise does not substitute an undecoded image");
    assert.equal(h.frames.size, 0, "Pending sunrise cannot keep cloudless artwork moving");
    h.load(sunrise); h.tick(); h.run(9000);
    assert.equal(h.photoDraws.at(-1).image, sunrise);
    assert.equal(h.frames.size, 1, "Actual sunrise decode wakes sustained cloud motion");

    h.render({ phase: "night", backgroundSrc: photoSource("clear-night") });
    const nextNight = h.images[2]; h.run(9000);
    assert.equal(h.photoDraws.at(-1).image, sunrise, "Cloudy artwork remains active while the night source loads");
    assert.equal(h.frames.size, 1, "A pending cloudless request cannot stop the still-displayed cloudy source");
    h.load(nextNight); h.tick(); h.run(9000);
    assert.equal(h.photoDraws.at(-1).image, nextNight);
    assert.equal(h.frames.size, 0, "Successful cloudless decode permits the shared loop to settle");
  });
});


test("failed photo preparation clears its overlay and idles until a usable decoded source arrives", () => {
  withHarness(h => {
    h.render({ phase: "day", backgroundSrc: photoSource("clear-day") });
    const failedImage = h.images[0];
    h.failPlate(failedImage); h.load(failedImage); h.tick();
    assert.equal(h.photoDraws.at(-1).usable, false);
    assert.equal(h.sky.state.painted, null, "A readback/context failure leaves the static photograph unobscured");
    h.run(9000);
    assert.equal(h.frames.size, 0, "Decoded cloudy artwork alone cannot keep an unusable painter alive");
    assert.equal(h.canvas.dataset.running, "0");
    assert.equal(h.canvas.dataset.photoSky, "ready", "Image decoding succeeded even though its moving layer is unavailable");

    h.render({ phase: "sunrise", backgroundSrc: photoSource("sunrise") });
    h.run(9000);
    assert.equal(h.frames.size, 0, "A newer pending request cannot revive the unusable decoded source");
    h.load(); h.tick(); h.run(9000);
    assert.equal(h.photoDraws.at(-1).usable, true);
    assert.equal(h.photoDraws.at(-1).image, h.images[1]);
    assert.equal(h.frames.size, 1, "A different successfully prepared photo restarts sustained motion");
    assert.equal(h.maximumFrames, 1);
  });
});

test("missing photographic context idles in clear weather without stopping independent weather effects", () => {
  withHarness(h => {
    h.render({ phase: "day", backgroundSrc: photoSource("clear-day") }); h.load(); h.tick(); h.run(9000);
    assert.equal(h.photoDraws.length, 0, "No photographic painter runs without its output context");
    assert.equal(h.frames.size, 0, "Missing sky context cannot leave a clear-weather RAF spinning");
    assert.equal(h.canvas.dataset.running, "0");
    assert.ok(h.atmosphereDraws.length > 0, "The independent precipitation/atmosphere context remains usable");

    h.render({ coverage: "SCT" }); h.tick(); h.run(9000);
    assert.equal(h.frames.size, 1, "Reported cloud effects can still use the separate atmosphere context");
    assert.equal(h.canvas.dataset.running, "1");
    assert.equal(h.photoDraws.length, 0);
    h.render({ coverage: "CLR", backgroundSrc: photoSource("sunrise"), phase: "sunrise" });
    h.load(); h.tick(); h.run(9000);
    assert.equal(h.frames.size, 0, "A new photo does not manufacture a missing output context");
    assert.equal(h.maximumFrames, 1);
  }, { unavailableSkyContext: true });
});
