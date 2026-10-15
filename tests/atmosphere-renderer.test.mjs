import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAtmosphereRenderer } from "../app/atmosphereRenderer.ts";

const BASE = {
  coverage: 0, ceiling: null, storm: 0,
  obscuration: "none", density: 0, horizon: 0, veil: 0,
  windX: 0, windY: 0, gust: 0, night: false, reduced: false,
  quality: "full", lightningLevel: "none",
};
const QUIET = { pulse: 0, bolt: false, cluster: 0 };

/** Canvas protocol recorder. Pixel rasterization and performance still require browser QA. */
function canvasHarness() {
  const originalDocument = globalThis.document;
  const canvases = [], commands = [];
  let imageDataCount = 0;
  const styleValue = style => typeof style === "object" && style
    ? { kind: style.kind, coordinates: style.coordinates, stops: style.stops.map(stop => [...stop]) }
    : style;

  function context(id) {
    const ctx = { globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "#000", strokeStyle: "#000" };
    const record = (name, args = []) => {
      for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg), `${name} received a non-finite parameter`);
      assert.ok(ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1, `${name} alpha is bounded`);
      commands.push({ id, name, args, alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation,
        fill: name === "fillRect" ? styleValue(ctx.fillStyle) : undefined,
        stroke: name === "stroke" ? ctx.strokeStyle : undefined,
        lineWidth: name === "stroke" ? ctx.lineWidth : undefined });
    };
    for (const method of ["clearRect", "fillRect", "save", "restore", "beginPath", "moveTo", "lineTo", "stroke"]) {
      ctx[method] = (...args) => record(method, args);
    }
    ctx.drawImage = (image, ...args) => record("drawImage", [image.id, ...args]);
    for (const method of ["createLinearGradient", "createRadialGradient"]) {
      ctx[method] = (...coordinates) => {
        for (const value of coordinates) assert.ok(Number.isFinite(value), "Gradient coordinates are finite");
        return { kind: method, coordinates, stops: [], addColorStop(position, color) {
          assert.ok(position >= 0 && position <= 1, "Gradient stop is in range");
          assert.ok(!/NaN|Infinity/.test(color), "Gradient color is finite");
          this.stops.push([position, color]);
        } };
      };
    }
    ctx.createImageData = (w, h) => { imageDataCount++; return { data: new Uint8ClampedArray(w * h * 4) }; };
    ctx.putImageData = () => {};
    return ctx;
  }
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { id: `offscreen-${canvases.length}`, width: 0, height: 0 };
    const ctx = context(canvas.id);
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  } };
  return {
    ctx: context("output"), canvases, commands,
    get imageDataCount() { return imageDataCount; },
    reset() { commands.length = 0; },
    snapshot() { return structuredClone(commands); },
    restore() {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

function withRenderer(run) {
  const harness = canvasHarness(), renderer = createAtmosphereRenderer();
  try { run(renderer, harness); }
  finally { renderer.dispose(); harness.restore(); }
}

test("atmosphere caches three bounded canvases and never allocates frame pixel buffers", () => {
  withRenderer((renderer, h) => {
    const spec = { ...BASE, coverage: 1, storm: 1, obscuration: "fog", density: 0.7, horizon: 0.8 };
    renderer.draw(h.ctx, 1920, 1080, 0, 1 / 60, spec, QUIET);
    assert.equal(h.canvases.length, 3);
    assert.equal(h.imageDataCount, 2);
    for (const canvas of h.canvases) assert.ok(canvas.width * canvas.height <= 576 * 324);
    for (let frame = 1; frame <= 180; frame++) {
      h.reset();
      renderer.draw(h.ctx, 1920, 1080, frame * 16, 1 / 60, spec, QUIET);
    }
    assert.equal(h.canvases.length, 3, "No canvases allocated after initialization");
    assert.equal(h.imageDataCount, 2, "No per-frame ImageData");
  });
});

test("dispose releases all backing stores and subsequent draws are inert", () => {
  withRenderer((renderer, h) => {
    renderer.draw(h.ctx, 1024, 768, 0, 0.016, { ...BASE, coverage: 0.8 }, QUIET);
    renderer.dispose();
    assert.ok(h.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    h.reset();
    renderer.draw(h.ctx, 1920, 1080, 1000, 0.1, { ...BASE, storm: 1 }, { pulse: 1, bolt: true, cluster: 1 });
    assert.deepEqual(h.commands, []);
    assert.equal(h.canvases.length, 3);
  });
});

test("reduced-motion dt=0 observations update their static clouds and fog without lightning", () => {
  withRenderer((renderer, h) => {
    renderer.draw(h.ctx, 1920, 1080, 0, 0, { ...BASE, reduced: true }, QUIET);
    h.reset();
    const storm = { ...BASE, reduced: true, coverage: 1, storm: 1, windX: 50, windY: 20, gust: 1,
      obscuration: "fog", density: 0.9, horizon: 0.95, lightningLevel: "severe" };
    renderer.draw(h.ctx, 1920, 1080, 1000, 0, storm, { pulse: 1, bolt: true, cluster: 1 });
    assert.ok(h.commands.some(command => command.id === "output" && command.name === "fillRect"), "Storm shadow replaces initial clear state");
    assert.ok(h.commands.some(command => command.fill === "rgb(209,220,223)"), "Fog target appears despite zero dt");
    assert.ok(!h.commands.some(command => command.name === "stroke"), "No reduced-motion bolt");
    assert.ok(!h.commands.some(command => command.fill?.kind === "createRadialGradient"), "No reduced-motion cloud flash");
    const first = h.snapshot();
    h.reset();
    renderer.draw(h.ctx, 1920, 1080, 50000, 0, storm, { pulse: 2, bolt: true, cluster: 2 });
    assert.deepEqual(h.snapshot(), first, "Cloud/fog coordinates stay exactly static as time and clusters change");
    h.reset();
    renderer.draw(h.ctx, 1920, 1080, 50001, 0, { ...storm, obscuration: "haze" }, QUIET);
    assert.ok(h.commands.some(command => command.fill === "rgb(196,184,156)"), "Fog color updates to haze on the next static draw");
  });
});

test("weather appearance eases over several seconds while signed wind moves cached layers", () => {
  withRenderer((renderer, h) => {
    renderer.draw(h.ctx, 1920, 1080, 0, 0, BASE, QUIET);
    const storm = { ...BASE, coverage: 1, storm: 1, windX: -35, windY: 4, gust: 0.5 };
    const firstShadowAlpha = () => {
      const fill = h.commands.find(command => command.id === "output" && command.name === "fillRect");
      return fill ? Number(fill.fill.stops[0][1].match(/,([^,]+)\)$/)[1]) : 0;
    };
    h.reset();
    renderer.draw(h.ctx, 1920, 1080, 100, 0.1, storm, QUIET);
    const early = firstShadowAlpha();
    assert.ok(early > 0 && early < 0.03, "First frame does not jump to full storm darkness");
    for (let frame = 0; frame < 100; frame++) {
      h.reset();
      renderer.draw(h.ctx, 1920, 1080, 100 + frame * 100, 0.1, storm, QUIET);
    }
    const settled = firstShadowAlpha();
    assert.ok(settled > early && settled < 0.31);
    const samples = h.commands.filter(command => command.name === "drawImage" && command.id !== "output").map(command => command.args);
    h.reset();
    renderer.draw(h.ctx, 1920, 1080, 10200, 0.1, storm, QUIET);
    const next = h.commands.filter(command => command.name === "drawImage" && command.id !== "output").map(command => command.args);
    assert.notDeepEqual(next, samples, "Cloud samples move without reseeding textures");
  });
});

test("cloud movement follows the signed wind and storms move even with calm surface wind", () => {
  const movement = windX => {
    let delta = 0;
    withRenderer((renderer, h) => {
      const spec = { ...BASE, coverage: 1, storm: 1, windX };
      const mainX = () => h.commands.find(command => command.name === "drawImage" && command.id === "offscreen-2" && command.args[0] === "offscreen-0").args[1];
      renderer.draw(h.ctx, 1920, 1080, 0, 0, spec, QUIET);
      const start = mainX();
      for (let frame = 1; frame <= 30; frame++) {
        h.reset();
        renderer.draw(h.ctx, 1920, 1080, frame * 100, 0.1, spec, QUIET);
      }
      delta = (mainX() - start) * 1920 / 576;
    });
    return delta;
  };
  assert.ok(movement(40) > 25, "Positive wind moves the visible deck right");
  assert.ok(movement(-40) < -25, "Negative wind moves the visible deck left");
  assert.ok(movement(0) > 25, "A storm has visible aloft motion within three seconds even with calm surface wind");
});

test("full and low quality, dimensions, visibility families, and lightning stay bounded", () => {
  withRenderer((renderer, h) => {
    const families = ["none", "mist", "fog", "freezing-fog", "shallow-fog", "patchy-fog", "partial-fog", "haze", "smoke", "dust", "blowing-dust", "drifting-dust", "sand", "sandstorm", "volcanic-ash"];
    for (const quality of ["full", "low"]) {
      for (let i = 0; i < families.length; i++) {
        h.reset();
        const spec = { ...BASE, quality, coverage: i / families.length, storm: 0.7, ceiling: i * 800,
          obscuration: families[i], density: 0.8, horizon: 0.9, veil: 0.4,
          windX: i % 2 ? -90 : 90, windY: -50, night: i % 2 === 1, lightningLevel: "severe" };
        renderer.draw(h.ctx, i % 2 ? 3840 : 768, i % 2 ? 2160 : 1024, i * 1000, 0.1, spec, { pulse: 1, bolt: true, cluster: i + 1 });
        if (quality === "low") {
          const strokes = h.commands.filter(command => command.name === "stroke");
          assert.ok(strokes.length > 0 && strokes.length <= 4, "Low mode retains the trunk and at most two branches");
        }
        assert.ok(h.commands.length < 220, "Each pass has bounded drawing work");
      }
    }
  });
});

test("smoke has elevated charcoal billows instead of the fog, mist, haze or dust bank", () => {
  for (const quality of ["full", "low"]) {
    for (const night of [false, true]) {
      const profiles = {};
      for (const obscuration of ["smoke", "fog", "mist", "haze", "dust"]) {
        withRenderer((renderer, h) => {
          renderer.draw(h.ctx, 1920, 1080, 0, 0,
            { ...BASE, quality, night, obscuration, density: 0.8, horizon: 0.6, veil: 0.12 }, QUIET);
          const samples = h.commands.filter(command => command.id === "offscreen-2" && command.name === "drawImage");
          const depth = h.commands.find(command => command.id === "offscreen-2" && command.blend === "destination-in" && command.fill?.kind === "createLinearGradient");
          const tint = h.commands.find(command => command.id === "offscreen-2" && command.blend === "source-in" && command.name === "fillRect");
          profiles[obscuration] = { samples, depth: depth.fill, tint: tint.fill };
          assert.equal(h.imageDataCount, 2, `${obscuration} needs no additional pixel texture`);
          assert.equal(h.canvases.length, 3, `${obscuration} uses the same bounded buffers`);
        });
      }
      const smoke = profiles.smoke;
      assert.equal(smoke.tint.kind, "createLinearGradient", "Smoke has height-dependent charcoal shading");
      assert.ok(smoke.depth.stops.find(([, color]) => color === "rgba(0,0,0,1)")[0] < 0.45, "Smoke is suspended above the horizon");
      const smokeHeight = smoke.samples[0].args[4];
      assert.ok(smokeHeight >= 324 * 0.9, "Smoke curls retain vertical depth");
      for (const name of ["fog", "mist", "haze", "dust"]) {
        assert.ok(profiles[name].depth.stops.find(([, color]) => color === "rgba(0,0,0,1)")[0] >= 0.5, `${name} stays horizon-oriented`);
        assert.ok(profiles[name].samples[0].args[4] < smokeHeight * 0.6, `${name} is flatter than smoke`);
        assert.equal(typeof profiles[name].tint, "string", `${name} retains its established color profile`);
      }
      assert.equal(profiles.fog.tint, night ? "rgb(84,88,109)" : "rgb(209,220,223)");
      assert.equal(profiles.mist.tint, night ? "rgb(74,82,103)" : "rgb(185,204,211)");
      assert.equal(profiles.haze.tint, night ? "rgb(78,74,76)" : "rgb(196,184,156)");
      assert.equal(profiles.dust.tint, night ? "rgb(68,56,50)" : "rgb(169,139,103)");
    }
  }
});

test("smoke rises in calm conditions, follows signed wind, and stays static in reduced motion", () => {
  for (const quality of ["full", "low"]) {
    for (const windX of [-35, 0, 35]) {
      withRenderer((renderer, h) => {
        const spec = { ...BASE, quality, obscuration: "smoke", density: 0.8, horizon: 0.6, veil: 0.12, windX };
        const sample = () => h.commands.find(command => command.id === "offscreen-2" && command.name === "drawImage").args;
        renderer.draw(h.ctx, 1920, 1080, 0, 0, spec, QUIET);
        const first = [...sample()];
        for (let frame = 1; frame <= 30; frame++) {
          h.reset();
          renderer.draw(h.ctx, 1920, 1080, frame * 100, 0.1, spec, QUIET);
        }
        const next = sample();
        assert.ok(next[2] < first[2] - 5, "Suspended smoke rises even when surface wind is calm");
        if (windX === 0) assert.equal(next[1], first[1], "No invented horizontal wind");
        else assert.equal(Math.sign(next[1] - first[1]), Math.sign(windX), "Smoke follows signed wind");
        h.reset();
        renderer.draw(h.ctx, 1920, 1080, 4000, 0, { ...spec, reduced: true }, QUIET);
        const staticSmoke = h.snapshot();
        h.reset();
        renderer.draw(h.ctx, 1920, 1080, 60000, 0, { ...spec, reduced: true }, QUIET);
        assert.deepEqual(h.snapshot(), staticSmoke, "Reduced motion freezes smoke rise and drift");
        h.reset();
        renderer.draw(h.ctx, 1920, 1080, 60001, 0, { ...spec, obscuration: "fog", reduced: true }, QUIET);
        assert.ok(h.commands.some(command => command.fill === "rgb(209,220,223)"), "A static weather change clears the smoke shading immediately");
      });
    }
  }
});

test("the renderer owns no animation loop, timers, or event listeners", () => {
  const source = readFileSync(new URL("../app/atmosphereRenderer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|addEventListener)\s*\(/);
  assert.equal((source.match(/createImageData\(/g) || []).length, 1);
  assert.equal((source.match(/putImageData\(/g) || []).length, 1);
});
