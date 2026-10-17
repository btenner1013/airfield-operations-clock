import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhotographicSkyPlateCache,
  photographicSkyRepairRegions,
  photographicSkyScene,
  repairPhotographicSkyPixels,
} from "../app/photographicSkyPlate.ts";

function pixels(width = 240, height = 135, color = [42, 67, 91, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return data;
}
function paint(data, width, x, y, color) { data.set(color, (y * width + x) * 4); }
function bounds(region, width, height) {
  return { left: Math.floor(region.left * width), right: Math.ceil(region.right * width), top: Math.floor(region.top * height), bottom: Math.ceil(region.bottom * height) };
}
function fixture(scene, width = 960, height = 540) {
  const data = pixels(width, height);
  const regions = photographicSkyRepairRegions(scene).map(region => bounds(region, width, height));
  for (const r of regions) for (let y = r.top; y <= r.bottom; y++) for (let x = r.left; x <= r.right; x++) paint(data, width, x, y, [255, 0, 255, 255]);
  return { data, regions, width, height };
}

for (const scene of ["sunset", "fog-night", "snow-night", "partly-cloudy-day", "thunderstorm-night"]) {
  test(`${scene}: opaque tower/pole repair removes every core pixel without tint or transparency`, () => {
    const { data, regions, width, height } = fixture(scene);
    repairPhotographicSkyPixels(data, width, height, scene);
    for (const r of regions) for (let y = r.top; y <= r.bottom; y++) for (let x = r.left; x <= r.right; x++) {
      assert.deepEqual(Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)), [42, 67, 91, 255], `No residual object at ${x},${y}`);
    }
    assert.deepEqual(Array.from(data.subarray(0, 4)), [42, 67, 91, 255]);
    assert.deepEqual(Array.from(data.subarray((height - 1) * width * 4, (height - 1) * width * 4 + 4)), [42, 67, 91, 255], "Ground pixels remain unchanged");
  });
}

test("a smooth sky color ramp remains smooth across the filled tower without a repeated color seam", () => {
  const width = 960, height = 540, data = pixels(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(data, width, x, y, [30 + x / 8 + y / 8, 50 + x / 16, 80 + y / 8, 255]);
  const original = data.slice();
  const r = bounds(photographicSkyRepairRegions("sunset")[0], width, height);
  for (let y = r.top; y <= r.bottom; y++) for (let x = r.left; x <= r.right; x++) paint(data, width, x, y, [0, 0, 0, 255]);
  repairPhotographicSkyPixels(data, width, height, "sunset");
  for (let y = r.top; y < height * .45; y++) for (let x = r.left - 8; x <= r.right + 8; x++) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(data[offset + c] - original[offset + c]) <= 2, "Repair follows the local color ramp");
    assert.equal(data[offset + 3], 255);
  }
});

test("neighboring sky detail survives the repair rather than becoming a flat stripe", () => {
  const width = 960, height = 540, data = pixels(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wave = 12 * Math.sin(x / 8) * Math.cos(y / 7);
    paint(data, width, x, y, [60 + wave, 70 + wave, 90 + wave, 255]);
  }
  const r = bounds(photographicSkyRepairRegions("sunset")[0], width, height);
  for (let y = r.top; y <= r.bottom; y++) for (let x = r.left; x <= r.right; x++) paint(data, width, x, y, [255, 0, 255, 255]);
  repairPhotographicSkyPixels(data, width, height, "sunset");
  let curvature = 0;
  for (let x = r.left + 2; x < r.right - 2; x++) {
    const i = (200 * width + x) * 4;
    curvature += Math.abs(data[i - 4] - 2 * data[i] + data[i + 4]);
    assert.equal(data[i + 1] - data[i], 10);
    assert.equal(data[i + 2] - data[i], 30);
  }
  assert.ok(curvature >= 8, "Neighbor detail is present inside the reconstructed strip");
});

test("clear-night is unchanged and never separates its genuine star field", () => {
  const data = pixels(), original = data.slice();
  assert.deepEqual(repairPhotographicSkyPixels(data, 240, 135, "clear-night"), { stars: null, removedStars: 0 });
  assert.deepEqual(data, original);
});

test("only partly-cloudy-night separates compact star points, reconstructable by screen blending", () => {
  const width = 240, height = 135, data = pixels(width, height, [8, 10, 13, 255]);
  paint(data, width, 100, 30, [90, 95, 100, 255]);
  // An extended cloud rim must not be mistaken for a star.
  for (let x = 160; x <= 180; x++) paint(data, width, x, 40, [35, 40, 45, 255]);
  const original = data.slice();
  const result = repairPhotographicSkyPixels(data, width, height, "partly-cloudy-night");
  assert.equal(result.removedStars, 1);
  assert.ok(result.stars);
  const i = (30 * width + 100) * 4;
  assert.deepEqual(Array.from(data.subarray(i, i + 4)), [8, 10, 13, 255]);
  for (let c = 0; c < 3; c++) {
    const screened = 255 - (255 - data[i + c]) * (255 - result.stars[i + c]) / 255;
    assert.ok(Math.abs(screened - original[i + c]) <= 1);
  }
  for (let x = 160; x <= 180; x++) {
    const cloud = (40 * width + x) * 4;
    assert.deepEqual(data.subarray(cloud, cloud + 4), original.subarray(cloud, cloud + 4));
    assert.equal(result.stars[cloud + 3], 0);
  }
  assert.equal(repairPhotographicSkyPixels(original, width, height, "overcast-night").removedStars, 0);
});

test("scene inference recognizes decoded URLs and fixture IDs", () => {
  assert.equal(photographicSkyScene({ currentSrc: "https://example.test/assets/partly-cloudy-night.png?v=2#sky" }), "partly-cloudy-night");
  assert.equal(photographicSkyScene({ src: "/assets/fog-night.png" }), "fog-night");
  assert.equal(photographicSkyScene({ id: "snow-night" }), "snow-night");
});

function harness({ readFails = false, withStar = false } = {}) {
  const originalDocument = globalThis.document, canvases = [], calls = [];
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      drawImage() { calls.push("draw"); },
      getImageData() {
        calls.push("read");
        if (readFails) throw new Error("Tainted canvas");
        const data = pixels(canvas.width, canvas.height, [8, 10, 13, 255]);
        if (withStar) paint(data, canvas.width, Math.floor(canvas.width * .6), 30, [90, 95, 100, 255]);
        return { data, width: canvas.width, height: canvas.height };
      },
      putImageData() { calls.push("write"); },
    });
    canvases.push(canvas);
    return canvas;
  } };
  return { canvases, calls, restore() { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; } };
}

test("cache performs one bounded preparation per source and zero pixel work on frame hits", () => {
  const h = harness(), cache = createPhotographicSkyPlateCache();
  try {
    const first = { width: 1672, height: 941, id: "sunset" };
    const second = { width: 6000, height: 4000, id: "overcast-day" };
    const a = cache.get(first), b = cache.get(second);
    assert.ok(a && b);
    assert.ok(a.width <= 960 && a.height <= 540 && b.width <= 960 && b.height <= 540);
    assert.equal(h.canvases.length, 2);
    assert.equal(h.calls.filter(call => call === "read").length, 2);
    const count = h.calls.length;
    for (let i = 0; i < 300; i++) { assert.equal(cache.get(first), a); assert.equal(cache.get(second), b); }
    assert.equal(h.calls.length, count);
    assert.equal(h.canvases.length, 2);
    const third = cache.get({ width: 100, height: 80, id: "rain-day" });
    assert.ok(third);
    assert.equal(a.image.width, 1, "The least-recently-used canvas backing store is released");
    assert.ok(b.image.width > 1);
    cache.dispose();
    assert.equal(b.image.width, 1); assert.equal(third.image.width, 1);
    assert.equal(cache.get(first), null);
  } finally { cache.dispose(); h.restore(); }
});

test("clear-night and unready images allocate no canvas; failed readback is cached safely", () => {
  const h = harness({ readFails: true }), cache = createPhotographicSkyPlateCache();
  try {
    assert.equal(cache.get({ width: 1672, height: 941, id: "clear-night" }), null);
    assert.equal(cache.get({ width: 0, height: 0, id: "sunset" }), null);
    assert.equal(h.canvases.length, 0);
    const broken = { width: 1672, height: 941, id: "sunset" };
    for (let i = 0; i < 100; i++) assert.equal(cache.get(broken), null);
    assert.equal(h.canvases.length, 1); assert.equal(h.calls.filter(call => call === "read").length, 1);
    assert.equal(h.canvases[0].width, 1);
  } finally { cache.dispose(); h.restore(); }
});

test("star bitmap is optional, bounded, cached and released with its source", () => {
  const h = harness({ withStar: true }), cache = createPhotographicSkyPlateCache();
  try {
    const source = { width: 1672, height: 941, id: "partly-cloudy-night" }, plate = cache.get(source);
    assert.ok(plate.stars);
    assert.equal(h.canvases.length, 2);
    assert.equal(h.calls.filter(call => call === "read").length, 1, "One source readback supplies both layers");
    assert.equal(plate.stars.width, plate.width); assert.equal(plate.stars.height, plate.height);
    assert.equal(cache.get(source), plate);
    cache.dispose();
    assert.equal(plate.stars.width, 1); assert.equal(plate.image.width, 1);
  } finally { cache.dispose(); h.restore(); }
});

test("dimension validation rejects invalid pixel buffers before mutation", () => {
  assert.throws(() => repairPhotographicSkyPixels(new Uint8ClampedArray(3), 1, 1, "sunset"), RangeError);
  assert.throws(() => repairPhotographicSkyPixels(new Uint8ClampedArray(4), 0, 1, "sunset"), RangeError);
});

test("changed decoded URLs and dimensions invalidate a reused image object", () => {
  const h = harness(), cache = createPhotographicSkyPlateCache();
  try {
    const source = { width: 240, height: 135, src: "/assets/sunset.png" };
    const first = cache.get(source);
    source.src = "/assets/sunrise.png";
    const second = cache.get(source);
    assert.notEqual(second, first);
    source.width = 200;
    const resized = cache.get(source);
    assert.notEqual(resized, second);
    assert.equal(resized.width, 200);
    assert.equal(first.image.width, 1);
    assert.equal(h.calls.filter(call => call === "read").length, 3);
    assert.equal(cache.get({ width: NaN, height: 20, id: "sunset" }), null);
    assert.equal(cache.get({ width: Infinity, height: 20, id: "sunset" }), null);
  } finally { cache.dispose(); h.restore(); }
});

test("evicting a starry plate releases both backing stores while retaining the active source", () => {
  const h = harness({ withStar: true }), cache = createPhotographicSkyPlateCache();
  try {
    const first = cache.get({ width: 240, height: 135, id: "partly-cloudy-night" });
    const second = cache.get({ width: 240, height: 135, id: "sunset" });
    cache.get({ width: 240, height: 135, id: "rain-day" });
    assert.equal(first.image.width, 1); assert.equal(first.stars.width, 1);
    assert.equal(second.image.width, 240);
    assert.equal(h.canvases.filter(canvas => canvas.width > 1).length, 2);
  } finally { cache.dispose(); h.restore(); }
});
