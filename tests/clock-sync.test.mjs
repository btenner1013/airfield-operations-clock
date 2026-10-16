import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as sync from '../app/clockSync.ts';
const { CLOCK_LIMITS, validateHttpSample, chooseTimeEstimate, ClockDiscipline, sampleHttpTime, boundaryDelay, formatClockStatus, waitForSample } = sync;
const epoch = Date.parse('2026-10-16T16:00:00Z');
const reading = (wallMs = epoch, monoMs = 1000) => ({ wallMs, monoMs });
const response = (headers = {}, status = 200) => new Response(null, { status, headers: { Date: new Date(epoch).toUTCString(), ...headers } });
const sample = (offsetMs = 28000, delta = 0) => ({ offsetMs, roundTripMs: 100, uncertaintyMs: 550, serverDateMs: epoch + delta + 28000, received: reading(epoch + delta, 1000 + delta) });
const estimate = (offsetMs = 28000) => ({ ...sample(offsetMs), samples: 3 });

// Network validation executes the production code with deterministic wall/monotonic times.
test('whole-second Date bucket and request midpoint are both included in correction', () => {
  const result = validateHttpSample(response(), reading(epoch - 28000, 100), reading(epoch - 27900, 200));
  assert.equal(result.sample.offsetMs, 28450);
  assert.equal(result.sample.uncertaintyMs, 550);
  assert.equal(result.sample.roundTripMs, 100);
});
test('object Age is never added to a regenerated edge Date; malformed Age is rejected', () => {
  for (const headers of [{ Age: '-1' }, { Age: 'NaN' }, { Age: '1.5' }, { Age: '9007199254740993' }]) {
    assert.equal(validateHttpSample(response(headers), reading(), reading(epoch + 100, 1100)).error, 'INVALID CACHE METADATA', JSON.stringify(headers));
  }
  for (const headers of [{ Age: '0', 'X-Cache': 'MISS' }, { Age: '28', 'X-Cache': 'HIT' }, { Age: '400', 'X-Cache': 'MISS, HIT' }]) {
    const result = validateHttpSample(response(headers), reading(), reading(epoch + 100, 1100));
    assert.equal(result.sample.offsetMs, 450, 'cache age must not become clock skew');
  }
});
test('frozen cached Date is rejected while a regenerated Date can produce a fresh estimate', () => {
  const frozen = [], advancing = [];
  for (const delta of [0, 1100, 2200]) {
    const start = reading(epoch + delta, 1000 + delta), end = reading(epoch + delta + 100, 1100 + delta);
    frozen.push(validateHttpSample(response({ Age: String(28 + Math.floor(delta / 1000)), 'X-Cache': 'HIT' }), start, end).sample);
    advancing.push(validateHttpSample(response({ Date: new Date(epoch + Math.floor(delta / 1000) * 1000).toUTCString(), Age: String(28 + Math.floor(delta / 1000)), 'X-Cache': 'HIT' }), start, end).sample);
  }
  assert.equal(chooseTimeEstimate(frozen), null);
  assert.equal(chooseTimeEstimate(advancing).samples, 3);
  assert.ok(Math.abs(chooseTimeEstimate(advancing).offsetMs) < 1000);
});
test('HTTP errors, redirected responses, and missing or malformed dates are rejected', () => {
  assert.equal(validateHttpSample(response({}, 503), reading(), reading(epoch + 100, 1100)).error, 'HTTP ERROR');
  assert.equal(validateHttpSample({ ok: true, redirected: true, headers: response().headers }, reading(), reading()).error, 'HTTP ERROR');
  for (const value of ['', '2026-10-16', 'Fri, 32 Oct 2026 16:00:00 GMT', 'nonsense']) assert.equal(validateHttpSample(response({ Date: value }), reading(), reading()).error, 'INVALID DATE');
  assert.equal(validateHttpSample(new Response(null), reading(), reading()).error, 'INVALID DATE');
});
test('latency is monotonic and in-request wall-clock jumps cannot produce an offset', () => {
  for (const elapsed of [-1, 1501, Infinity, NaN]) assert.equal(validateHttpSample(response(), reading(), reading(epoch + elapsed, 1000 + elapsed)).error, 'SLOW RESPONSE');
  assert.equal(validateHttpSample(response(), reading(), reading(epoch + 28100, 1100)).error, 'SYSTEM TIME CHANGED');
  assert.equal(validateHttpSample(response(), reading(), reading(epoch - 28000, 1100)).error, 'SYSTEM TIME CHANGED');
});
test('request is same-origin HEAD with no cache, credentials, or redirected time source', async () => {
  let count = 0, request;
  const result = await sampleHttpTime({ read: () => count++ ? reading(epoch + 100, 1100) : reading(), fetcher: async (url, init) => { request = { url, ...init }; return response(); } });
  assert.ok(result.sample); assert.match(request.url, /^\.\/\?clockcheck=/);
  assert.equal(request.method, 'HEAD'); assert.equal(request.cache, 'no-store'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
  assert.match(request.headers['Cache-Control'], /no-cache/);
});
test('hung requests time out even if a fetch implementation ignores abort', async () => {
  let signal;
  const result = await sampleHttpTime({ timeoutMs: 5, fetcher: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  assert.equal(result.error, 'SLOW RESPONSE'); assert.equal(signal.aborted, true);
});
test('network failure and abort have bounded explicit results', async () => {
  assert.equal((await sampleHttpTime({ fetcher: async () => { throw Error('offline'); } })).error, 'NETWORK UNAVAILABLE');
  const parent = new AbortController(); parent.abort();
  let called = false;
  assert.equal((await sampleHttpTime({ signal: parent.signal, fetcher: async () => { called = true; return response(); } })).error, 'CANCELLED');
  assert.equal(called, false);
  const live = new AbortController();
  const pending = sampleHttpTime({ signal: live.signal, fetcher: () => new Promise(() => {}) });
  live.abort(); assert.equal((await pending).error, 'CANCELLED');
  const delay = waitForSample(10000, live.signal); await delay;
});
test('two advancing consistent dates confirm correction; one or frozen dates cannot', () => {
  assert.equal(chooseTimeEstimate([]), null); assert.equal(chooseTimeEstimate([sample()]), null);
  assert.equal(chooseTimeEstimate([sample(), { ...sample(28010, 100), serverDateMs: sample().serverDateMs }]), null);
  const result = chooseTimeEstimate([sample(28000), sample(28100, 1100)]);
  assert.equal(result.samples, 2); assert.equal(result.offsetMs, 28050);
});
test('one outlier is rejected and no coherent pair means no correction', () => {
  assert.equal(chooseTimeEstimate([sample(28000), sample(28100, 1100), sample(-15000, 2200)]).offsetMs, 28050);
  assert.equal(chooseTimeEstimate([sample(28000), sample(-15000, 1100), sample(100000, 2200)]), null);
  assert.equal(chooseTimeEstimate([sample(400000), sample(400010, 1100)]), null);
  assert.equal(chooseTimeEstimate([sample(NaN), sample(Infinity, 1100)]), null);
});
test('system fallback works immediately without any network time', () => {
  const clock = new ClockDiscipline(); const first = clock.read(reading());
  assert.equal(first.nowMs, epoch); assert.equal(first.status.source, 'SYSTEM CLOCK');
  clock.failed(false, 'NETWORK UNAVAILABLE');
  assert.equal(clock.read(reading(epoch + 1000, 2000)).status.state, 'OFFLINE');
});
test('positive and negative correction both apply to an absolute anchor without cumulative tick drift', () => {
  for (const offset of [28000, -28000, 0]) {
    const clock = new ClockDiscipline(); assert.equal(clock.accept(estimate(offset), reading()), true);
    const current = clock.read(reading(epoch + 13786, 14786));
    assert.equal(current.nowMs, epoch + 13786 + offset);
    assert.equal(current.status.source, 'GITHUB HTTP'); assert.equal(current.status.state, 'OK');
    assert.equal(current.status.estimatedOffsetMs, offset); assert.equal(current.recheck, true);
  }
});
test('offline checks retain a labeled bounded holdover and then expire to system time', () => {
  const clock = new ClockDiscipline(); clock.accept(estimate(), reading()); clock.failed(false, 'NETWORK UNAVAILABLE');
  const held = clock.read(reading(epoch + 60_000, 61_000));
  assert.equal(held.nowMs, epoch + 88_000); assert.equal(held.status.source, 'HTTP HOLDOVER'); assert.equal(held.status.state, 'OFFLINE');
  assert.ok(held.status.uncertaintyMs > 550);
  const expired = clock.read(reading(epoch + CLOCK_LIMITS.holdoverMs, 1000 + CLOCK_LIMITS.holdoverMs));
  assert.equal(expired.nowMs, epoch + CLOCK_LIMITS.holdoverMs); assert.equal(expired.status.source, 'SYSTEM CLOCK'); assert.equal(expired.status.estimatedOffsetMs, null);
  assert.equal(expired.status.state, 'OFFLINE'); assert.equal(expired.status.detail, 'CORRECTION EXPIRED');
});
test('online failed checks preserve useful correction with warning and expiry remains visible', () => {
  const clock = new ClockDiscipline(); clock.accept(estimate(), reading()); clock.failed(true, 'NO CONSISTENT FRESH SAMPLES');
  const held = clock.read(reading(epoch + 1000, 2000)); assert.equal(held.status.source, 'HTTP HOLDOVER'); assert.equal(held.status.state, 'WARNING');
  const expired = clock.read(reading(epoch + CLOCK_LIMITS.holdoverMs, 1000 + CLOCK_LIMITS.holdoverMs)); assert.equal(expired.status.state, 'STALE');
  assert.match(formatClockStatus(expired.status), /CORRECTION EXPIRED/);
});
test('Windows correcting its own clock does not double-apply the prior network offset', () => {
  const clock = new ClockDiscipline(); clock.accept(estimate(), reading());
  const correctedSystem = clock.read(reading(epoch + 29000, 2000));
  assert.equal(correctedSystem.nowMs, epoch + 29000); assert.equal(correctedSystem.status.source, 'SYSTEM CLOCK'); assert.equal(correctedSystem.recheck, true);
  const later = { ...estimate(0), received: reading(epoch + 30000, 3000) };
  clock.accept(later, later.received); assert.equal(clock.read(reading(epoch + 31000, 4000)).nowMs, epoch + 31000);
});
test('sleep where performance clock pauses drops correction; sleep where it ticks catches up', () => {
  const paused = new ClockDiscipline(); paused.accept(estimate(), reading());
  const p = paused.read(reading(epoch + 60_000, 1001)); assert.equal(p.nowMs, epoch + 60_000); assert.equal(p.status.source, 'SYSTEM CLOCK'); assert.equal(p.recheck, true);
  const ticking = new ClockDiscipline(); ticking.accept(estimate(), reading());
  const t = ticking.read(reading(epoch + 60_000, 61_000)); assert.equal(t.nowMs, epoch + 88_000); assert.equal(t.recheck, true);
});
test('jump between response and applying result rejects that batch; reload has no inherited correction', () => {
  const clock = new ClockDiscipline(); assert.equal(clock.accept(estimate(), reading(epoch + 30000, 1100)), false);
  assert.equal(clock.read(reading()).status.source, 'SYSTEM CLOCK');
  assert.equal(new ClockDiscipline().read(reading()).nowMs, epoch);
});
test('tick boundary follows corrected time, including negative epoch values', () => {
  assert.equal(boundaryDelay(epoch + 28050), 975);
  assert.equal(boundaryDelay(epoch + 28000), 1025);
  assert.equal(boundaryDelay(-50), 75);
});
test('footer states correction and uncertainty without calling HTTP a precise or verified source', () => {
  const clock = new ClockDiscipline(); clock.accept(estimate(), reading());
  assert.equal(formatClockStatus(clock.read(reading()).status), 'SRC GITHUB HTTP · CORR +28.0S · EST ±0.6S · 1600Z');
  clock.failed(false, 'NETWORK UNAVAILABLE'); assert.match(formatClockStatus(clock.read(reading()).status), /SRC HTTP HOLDOVER · OFFLINE/);
  assert.doesNotMatch(formatClockStatus(clock.read(reading()).status), /WINDOWS SYSTEM|VERIFIED|NTP/);
});

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const functions = page.slice(page.indexOf('function parts('), page.indexOf('function getMoonPhase('));
const compiled = ts.transpileModule(functions + '\nmodule.exports={parts,dateLine,julian4};', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} }; new Function('module', 'CONFIG', compiled)(mod, { timeZone: 'America/Chicago' });
const { parts, dateLine, julian4 } = mod.exports;
function correctedDate(iso, correction = 28000) {
  const system = Date.parse(iso), clock = new ClockDiscipline();
  clock.accept({ ...estimate(correction), received: reading(system, 0) }, reading(system, 0));
  return new Date(clock.read(reading(system, 0)).nowMs);
}
test('corrected UTC New Year and local date remain independent', () => {
  const now = correctedDate('2026-12-31T23:59:40Z');
  assert.equal(parts(now, 'UTC').hour, '00'); assert.match(dateLine(parts(now, 'UTC')), /01 JAN 2027/);
  assert.equal(parts(now, 'America/Chicago').hour, '18'); assert.match(dateLine(parts(now, 'America/Chicago')), /31 DEC 2026/); assert.equal(julian4(now), '6365');
});
test('corrected local New Year updates the clock, date, and Julian day together', () => {
  const now = correctedDate('2027-01-01T05:59:40Z');
  assert.equal(parts(now, 'America/Chicago').hour, '00'); assert.equal(parts(now, 'America/Chicago').second, '08');
  assert.match(dateLine(parts(now, 'America/Chicago')), /01 JAN 2027/); assert.equal(julian4(now), '7001');
});
test('corrected clock retains Memphis DST changes and leap-year Julian dates', () => {
  assert.equal(parts(correctedDate('2026-03-08T07:59:40Z'), 'America/Chicago').hour, '03');
  assert.equal(parts(correctedDate('2026-11-01T06:59:40Z'), 'America/Chicago').hour, '01');
  assert.equal(julian4(new Date('2028-02-29T18:00:00Z')), '8060');
  assert.equal(julian4(new Date('2028-12-31T18:00:00Z')), '8366');
});

// Exercise the actual hook lifecycle in a deterministic host, without a browser or network.
function hookHarness(debug, overrideSample) {
  const effects = [], states = [], timeouts = new Map(), intervals = new Map(), events = new Map();
  let stateIndex = 0, id = 0, current = reading(), calls = 0, signal;
  const react = {
    useState(initial) { const index = stateIndex++; states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect(fn) { effects.push(fn); }, useMemo(fn) { return fn(); },
  };
  const host = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), setTimeout: fn => { timeouts.set(++id, fn); return id; }, setInterval: fn => { intervals.set(++id, fn); return id; } };
  const nav = { onLine: true };
  const dependencies = { ...sync, readClock: () => current, waitForSample: async () => {}, sampleHttpTime: async opts => {
    calls++; signal = opts.signal;
    if (overrideSample) return overrideSample(opts, { call: calls, current, setReading: value => { current = value; } });
    current = reading(epoch + calls * 1100, 1000 + calls * 1100);
    return { sample: { ...sample(28000, calls * 1100), received: current } };
  } };
  const source = readFileSync(new URL('../app/useClock.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', 'navigator', 'clearTimeout', 'clearInterval', code)(name => name === 'react' ? react : dependencies, module, module.exports, host, { ...host, visibilityState: 'visible' }, nav, key => timeouts.delete(key), key => intervals.delete(key));
  module.exports.useSystemClock(debug);
  const stop = effects[0]();
  return { states, events, timeouts, intervals, nav, stop, get calls() { return calls; }, get signal() { return signal; }, setReading(value) { current = value; }, tick() { const [key, fn] = [...timeouts][0]; timeouts.delete(key); fn(); } };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test('hook synchronizes startup, realigns seconds, handles offline/wake, and cleans up', async () => {
  const h = hookHarness(); await settle();
  assert.equal(h.calls, 3); assert.equal(h.states[0], epoch + 31300); assert.equal(h.states[1].source, 'GITHUB HTTP'); assert.equal(h.timeouts.size, 1);
  h.nav.onLine = false; h.events.get('offline')(); assert.equal(h.states[1].source, 'HTTP HOLDOVER'); assert.equal(h.states[1].state, 'OFFLINE');
  h.setReading(reading(epoch + 63300, 64300)); h.tick(); assert.equal(h.states[0], epoch + 91300);
  h.nav.onLine = true; h.events.get('online')(); await settle(); assert.equal(h.calls, 6);
  h.stop(); assert.equal(h.signal.aborted, true); assert.equal(h.timeouts.size, 0); assert.equal(h.intervals.size, 0); assert.equal(h.events.size, 0);
});
test('hook ignores late result after unmount and coalesces simultaneous wake checks', async () => {
  let resolve;
  const h = hookHarness(undefined, () => new Promise(r => { resolve = r; }));
  h.events.get('focus')(); h.events.get('pageshow')(); assert.equal(h.calls, 1);
  h.stop(); const before = [...h.states]; resolve({ sample: sample() }); await settle(); assert.deepEqual(h.states, before); assert.equal(h.timeouts.size, 0);
});
test('fixed preview stays fixed through ticks and never fetches; malformed debug values do not break live time', async () => {
  const h = hookHarness({ exact: epoch }); h.setReading(reading(epoch + 10000, 11000)); h.tick(); assert.equal(h.states[0], epoch); assert.equal(h.states[1].source, 'PREVIEW'); assert.equal(h.calls, 0); h.stop();
  for (const debug of [{ exact: NaN, offsetMs: NaN }, { offsetMs: 1e308 }, { exact: 1e308 }]) {
    const invalid = hookHarness(debug); await settle(); assert.equal(invalid.calls, 3); assert.equal(invalid.states[1].source, 'GITHUB HTTP'); invalid.stop();
  }
});

test('a between-request wall jump invalidates the whole batch even when offsets could agree', () => {
  const one = sample(28000), two = sample(28050, 1100), three = sample(28100, 2200);
  two.received.wallMs += 500; three.received.wallMs += 500;
  assert.equal(chooseTimeEstimate([one, two, three]), null);
});
test('offline event during synchronization cannot finish with an online source/status', async () => {
  let resolveThird;
  const live = hookHarness(undefined, (_opts, { call, setReading }) => {
    if (call === 3) return new Promise(resolve => { resolveThird = resolve; });
    const result = sample(28000, call * 1100); setReading(result.received);
    return { sample: result };
  });
  await settle(); live.nav.onLine = false; live.events.get('offline')();
  resolveThird({ error: 'NETWORK UNAVAILABLE' }); await settle();
  assert.equal(live.states[1].source, 'HTTP HOLDOVER'); assert.equal(live.states[1].state, 'OFFLINE'); live.stop();
});
test('wake or OS jump during an in-flight batch queues a fresh check immediately afterward', async () => {
  let resolveThird;
  const h = hookHarness(undefined, (_opts, { call, current }) => {
    if (call === 3) return new Promise(resolve => { resolveThird = resolve; });
    return { sample: { ...sample(call <= 2 ? 28000 : 0), serverDateMs: epoch + call * 1000, received: current } };
  });
  await settle(); assert.equal(h.calls, 3);
  h.setReading(reading(epoch + 29000, 2000)); h.tick();
  resolveThird({ error: 'SYSTEM TIME CHANGED' }); await settle();
  assert.equal(h.calls, 6, 'queued recheck must not wait for the five-minute interval');
  h.stop();
});

test('an extreme preview offset cannot become Invalid Date after a later tick', () => {
  const wall = Date.now(), h = hookHarness({ offsetMs: 8.64e15 - wall - 60000 });
  h.setReading(reading(wall + 120000, 121000)); h.tick();
  assert.equal(h.states[0], wall + 120000); assert.match(h.states[1].detail, /INVALID OFFSET/);
  assert.ok(Number.isFinite(new Date(h.states[0]).getTime())); h.stop();
});
