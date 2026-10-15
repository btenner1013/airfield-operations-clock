import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPhotographicSky } from "../app/photographicSky.ts";

const PHOTO = { width: 1672, height: 941, id: "storm-day" };

function harness() {
  const originalDocument = globalThis.document, canvases = [], calls = [], gradients = [];
  const context = id => {
    const ctx = { globalAlpha: 1, globalCompositeOperation: "source-over" }, stack = [];
    const record = (method, values) => {
      values.forEach(value => { if (typeof value === "number") assert.ok(Number.isFinite(value), `${method} parameter is finite`); });
      assert.ok(ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1, "Canvas alpha is bounded");
      calls.push({ id, method, values, alpha: ctx.globalAlpha });
    };
    for (const method of ["clearRect", "fillRect", "translate", "scale"]) ctx[method] = (...values) => record(method, values);
    ctx.drawImage = (image, ...values) => record("drawImage", [image.id, ...values]);
    ctx.save = () => { stack.push({ globalAlpha: ctx.globalAlpha, globalCompositeOperation: ctx.globalCompositeOperation }); };
    ctx.restore = () => Object.assign(ctx, stack.pop());
    for (const method of ["createLinearGradient", "createRadialGradient"]) {
      ctx[method] = (...values) => {
        values.forEach(value => assert.ok(Number.isFinite(value)));
        const gradient = { method, values, stops: [], addColorStop(position, color) {
          assert.ok(position >= 0 && position <= 1);
          this.stops.push([position, color]);
        } };
        gradients.push(gradient);
        return gradient;
      };
    }
    ctx.createImageData = () => { throw new Error("Photographic sky must not allocate pixel buffers"); };
    return ctx;
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { id: "photo-buffer", width: 0, height: 0 }, ctx = context(canvas.id);
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  } };
  return {
    ctx: context("output"), canvases, calls, gradients,
    reset() { calls.length = 0; gradients.length = 0; },
    sourceDraws() { return calls.filter(call => call.id === "photo-buffer" && call.method === "drawImage"); },
    restore() { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; },
  };
}

function withSky(run) {
  const h = harness(), sky = createPhotographicSky();
  try { run(sky, h); }
  finally { sky.dispose(); h.restore(); }
}

test("photographic sky reuses one bounded composite across frames and viewport sizes", () => {
  withSky((sky, h) => {
    for (const [width, height] of [[1920, 1080], [3840, 2160], [768, 1024], [1024, 768], [3440, 1440]]) {
      for (let frame = 0; frame < 60; frame++) {
        h.reset();
        sky.draw(h.ctx, width, height, 1 / 30, PHOTO, 1, 1, 20, false);
        assert.equal(h.canvases.length, 1);
        assert.ok(h.canvases[0].width <= 960 && h.canvases[0].height <= 540);
        assert.ok(h.calls.length < 20, "Bounded compositing work per frame");
      }
    }
  });
});

test("same-source motion is visible within three seconds and follows wind sign", () => {
  for (const wind of [0, 40, -40]) {
    withSky((sky, h) => {
      sky.draw(h.ctx, 1920, 1080, 0, PHOTO, 1, 1, wind, false);
      const first = h.sourceDraws()[0].values[1];
      for (let frame = 0; frame < 30; frame++) {
        h.reset();
        sky.draw(h.ctx, 1920, 1080, 0.1, PHOTO, 1, 1, wind, false);
      }
      const movement = (h.sourceDraws()[0].values[1] - first) * 2;
      if (wind < 0) assert.ok(movement < -40);
      else assert.ok(movement > 40, "Even calm surface wind permits illustrative cloud-level drift");
      assert.ok(Math.abs(movement) < 120, "Movement stays bounded by overscan");
    });
  }
});

test("new image identities crossfade in the same buffer and release the previous source", () => {
  withSky((sky, h) => {
    const next = { width: 1920, height: 1080, id: "storm-night" };
    sky.draw(h.ctx, 1920, 1080, 0, PHOTO, 1, 1, 0, false);
    h.reset();
    sky.draw(h.ctx, 1920, 1080, 0.1, next, 1, 1, 0, false);
    const start = h.sourceDraws();
    assert.equal(start.length, 2);
    assert.equal(start[0].values[0], PHOTO.id);
    assert.equal(start[0].alpha, 1);
    assert.equal(start[1].values[0], next.id);
    assert.ok(start[1].alpha > 0 && start[1].alpha < 0.04);
    for (let frame = 0; frame < 38; frame++) sky.draw(h.ctx, 1920, 1080, 0.1, next, 1, 1, 0, false);
    h.reset();
    sky.draw(h.ctx, 1920, 1080, 0.1, next, 1, 1, 0, false);
    assert.equal(h.sourceDraws().length, 1);
    assert.equal(h.sourceDraws()[0].values[0], next.id);
    assert.equal(h.sourceDraws()[0].alpha, 1);
    assert.equal(h.canvases.length, 1);
  });
});

test("reduced motion keeps the original photograph untouched, including image changes", () => {
  withSky((sky, h) => {
    sky.draw(h.ctx, 1920, 1080, 0, PHOTO, 1, 1, 40, true);
    const next = { ...PHOTO, id: "new-static-weather" };
    sky.draw(h.ctx, 1920, 1080, 0.1, next, 1, 1, -40, true);
    assert.equal(h.canvases.length, 0);
    assert.deepEqual(h.calls, []);
    sky.draw(h.ctx, 1920, 1080, 0, next, 1, 1, 0, false);
    assert.equal(h.sourceDraws().length, 1, "Resuming does not resurrect a reduced-motion transition");
    h.reset();
    sky.draw(h.ctx, 1920, 1080, 0.1, next, 1, 1, 40, true);
    assert.deepEqual(h.calls, []);
  });
});

test("source-space mask clears before light poles and its opaque oval contains tower envelope", () => {
  withSky((sky, h) => {
    const w = 1280, height = 720;
    sky.draw(h.ctx, w, height, 0, PHOTO, 1, 1, 0, false);
    const cover = Math.max(w / PHOTO.width, height / PHOTO.height), resolution = 0.75;
    const iw = PHOTO.width * cover, ih = PHOTO.height * cover;
    const linear = h.gradients.find(gradient => gradient.method === "createLinearGradient");
    assert.ok(linear.values[3] <= ((height - ih) / 2 + ih * 0.46) * resolution);
    assert.deepEqual(linear.stops.at(-1), [1, "rgba(0,0,0,0)"]);
    const center = h.calls.find(call => call.method === "translate").values;
    const radii = h.calls.find(call => call.method === "scale").values;
    const radial = h.gradients.find(gradient => gradient.method === "createRadialGradient");
    assert.equal(radial.values[2], 1, "The inner oval is completely opaque");
    assert.ok(radial.values[5] > 1, "Feather lies outside the protected oval");
    const left = Math.min((w - iw) / 2 + iw * 0.088, w / 2 + iw * 1.168 * (0.088 - 0.5) - iw * 0.058) * resolution;
    const right = Math.max((w - iw) / 2 + iw * 0.17, w / 2 + iw * 1.168 * (0.17 - 0.5) + iw * 0.058) * resolution;
    const top = Math.min((height - ih) / 2 + ih * 0.245, height / 2 + ih * 1.168 * (0.245 - 0.5)) * resolution;
    const bottom = Math.max((height - ih) / 2 + ih * 0.6, height / 2 + ih * 1.168 * (0.6 - 0.5)) * resolution;
    for (const x of [left, right]) for (const y of [top, bottom]) {
      assert.ok(Math.hypot((x - center[0]) / radii[0], (y - center[1]) / radii[1]) < 1, "Every tower envelope corner is fully masked");
    }
  });
});

test("dispose clears the photographic buffer and the renderer owns no scheduling", () => {
  withSky((sky, h) => {
    sky.draw(h.ctx, 1920, 1080, 0, PHOTO, 1, 1, 0, false);
    sky.dispose();
    assert.equal(h.canvases[0].width, 1);
    assert.equal(h.canvases[0].height, 1);
    h.reset();
    sky.draw(h.ctx, 1920, 1080, 0.1, PHOTO, 1, 1, 0, false);
    assert.deepEqual(h.calls, []);
  });
  const source = readFileSync(new URL("../app/photographicSky.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:requestAnimationFrame|setTimeout|setInterval|addEventListener|createImageData|putImageData)\s*\(/);
});


test("photographic sky uses cross-browser CSS grading and the active decoded wallpaper", () => {
  const source = readFileSync(new URL("../app/PrecipCanvas.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /skyCanvas\.style\.filter=photoFilter/);
  assert.doesNotMatch(source, /skyCtx\.filter=/);
  assert.match(page, /backgroundSrc=\{`\$\{imageBase\}\/assets\/backgrounds\/\$\{activeWallpaper\}\.png`\}/);
});
