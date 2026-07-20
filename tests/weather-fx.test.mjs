import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildFxSpec,buildObscurationSpec,classifyEffect} from "../app/weatherFx.ts";

const fx=(tokens,options={})=>buildFxSpec(classifyEffect(tokens),options.windNx??1,options.windKt??12,options.perf??"full",options.night??false,options.reduced??false,options.pane??null,options.visibility??10);

test("METAR precipitation families classify into distinct operational effects",()=>{
  const cases=[
    [["-SN"],"snow","none","light"],[["SN"],"snow","none","moderate"],[["+SN"],"snow","none","heavy"],
    [["SHSN"],"snow-shower","none","moderate"],[["BLSN"],"blowing-snow","none","moderate"],[["DRSN"],"drifting-snow","none","moderate"],
    [["SG"],"snow-grains","none","moderate"],[["IC"],"ice-crystals","none","moderate"],[["PL"],"ice-pellets","none","moderate"],
    [["GR"],"hail","none","moderate"],[["GS"],"small-hail","none","moderate"],[["RASN"],"snow","rain","moderate"],
  ];
  for(const [tokens,primary,secondary,intensity] of cases){const result=classifyEffect(tokens);assert.equal(result.precip,primary,tokens[0]);assert.equal(result.secondaryPrecip,secondary,tokens[0]);assert.equal(result.intensity,intensity,tokens[0]);}
});

test("snow intensity, showers, blowing and drifting snow remain visibly distinct",()=>{
  const light=fx(["-SN"]),moderate=fx(["SN"]),heavy=fx(["+SN"]),shower=fx(["SHSN"]),blowing=fx(["BLSN"],{windKt:28}),drifting=fx(["DRSN"],{windKt:16});
  assert.ok(light.count<moderate.count&&moderate.count<heavy.count);
  assert.ok(light.speed===moderate.speed&&heavy.veil>moderate.veil);
  assert.equal(shower.burst,true);assert.ok(shower.speed>moderate.speed);
  assert.equal(blowing.band,"lower");assert.ok(Math.abs(blowing.vx)>=175);
  assert.equal(drifting.band,"surface");assert.ok(drifting.count<blowing.count&&drifting.speed<blowing.speed);
});

test("snow grains, ice crystals and bouncing pellets have separate signatures",()=>{
  const snow=fx(["SN"]),grains=fx(["SG"]),crystals=fx(["IC"]),pellets=fx(["PL"]),hail=fx(["GR"]),smallHail=fx(["GS"]);
  assert.ok(grains.size<snow.size&&grains.speed>snow.speed);
  assert.ok(crystals.count<grains.count&&crystals.speed<grains.speed);
  for(const spec of [pellets,hail,smallHail])assert.equal(spec.bounce,true);
  assert.ok(hail.size>smallHail.size&&smallHail.size>pellets.size);
  assert.ok(hail.speed>smallHail.speed&&smallHail.speed>pellets.speed);
});

test("mixed rain and snow shares one spec, while pane droplets follow every liquid family",()=>{
  const mixed=fx(["RASN"]),snow=fx(["SN"]),hail=fx(["GR"]),fog=fx(["FG"],{visibility:1}),dust=fx(["BLDU"],{visibility:1}),vicinity=fx(["VCSH"]);
  assert.equal(mixed.type,"snow");assert.equal(mixed.secondary?.type,"rain");assert.ok(mixed.totalCount>mixed.count);
  assert.ok(mixed.pane);assert.equal(snow.pane,null);assert.equal(hail.pane,null);assert.equal(fog,null);assert.equal(dust,null);assert.ok(vicinity.pane);assert.equal(vicinity.pane.profile,"vicinity");assert.ok(vicinity.pane.count<=4);
  assert.equal(classifyEffect(["VCSH"]).vicinity,true);assert.ok(vicinity.count<fx(["SHRA"]).count);
});

test("pane profiles distinguish drizzle, rain, freezing and vicinity liquid",()=>{
  const drizzle=fx(["-DZ"]),rain=fx(["RA"]),heavy=fx(["+RA"]),freezing=fx(["FZRA"]),vicinity=fx(["VCSH"]),mixed=fx(["RASN"]);
  assert.equal(drizzle.pane.profile,"drizzle");assert.equal(rain.pane.profile,"rain");assert.equal(freezing.pane.profile,"freezing");assert.equal(vicinity.pane.profile,"vicinity");
  assert.ok(heavy.pane.count>rain.pane.count&&rain.pane.count>vicinity.pane.count);assert.ok(freezing.pane.roll<rain.pane.roll);assert.ok(mixed.pane);
  for(const token of ["-DZ","DZ","+DZ","-RA","RA","+RA","SHRA","VCSH","FZDZ","FZRA","TSRA","-TSRA","+TSRA","RASN","SNRA"]){assert.ok(fx([token]).pane,`${token} should activate pane drops`);}
});

test("winter particle families use operationally distinct CSS-pixel scales and shapes",()=>{
  const snow=fx(["SN"]),lightSnow=fx(["-SN"]),blowing=fx(["BLSN"]),grains=fx(["SG"]),crystals=fx(["IC"]),pellets=fx(["PL"]),hail=fx(["GR"]),smallHail=fx(["GS"]);
  assert.deepEqual([snow.sizeMin,snow.sizeMax],[1.5,7]);assert.ok(lightSnow.sizeMax<snow.sizeMax);
  assert.equal(blowing.shape,"grain");assert.ok(blowing.sizeMax>=4.5&&blowing.near);assert.deepEqual([grains.sizeMin,grains.sizeMax],[2.3,4.1]);assert.equal(crystals.shape,"crystal");assert.deepEqual([crystals.sizeMin,crystals.sizeMax],[3.1,5.6]);
  assert.equal(pellets.shape,"pellet");assert.deepEqual([pellets.sizeMin,pellets.sizeMax],[2.4,4.6]);assert.equal(hail.shape,"hail");assert.deepEqual([hail.sizeMin,hail.sizeMax],[5,8]);assert.deepEqual([smallHail.sizeMin,smallHail.sizeMax],[3.5,5.9]);
});

test("visibility smoothly strengthens veil without using snow intensity as a whiteout switch",()=>{
  const clearVis=fx(["+SN"],{visibility:10}),three=fx(["+SN"],{visibility:3}),half=fx(["+SN"],{visibility:.5});
  assert.ok(clearVis.veil<three.veil&&three.veil<half.veil);assert.ok(clearVis.veil<=.1);assert.ok(half.veil<=.3);
});

test("obscuration classification covers fog, dust, sand, smoke, haze and ash variants",()=>{
  const cases=[["BR","mist"],["FG","fog"],["FZFG","freezing-fog"],["MIFG","shallow-fog"],["BCFG","patchy-fog"],["PRFG","partial-fog"],["HZ","haze"],["FU","smoke"],["DU","dust"],["BLDU","blowing-dust"],["DRDU","drifting-dust"],["SA","sand"],["BLSA","blowing-sand"],["DRSA","drifting-sand"],["DS","dust-storm"],["SS","sandstorm"],["PO","dust-whirl"],["VA","volcanic-ash"]];
  for(const [token,type] of cases)assert.equal(classifyEffect([token]).obscuration,type,token);
  const mixed=classifyEffect(["-RASN","BR"]);assert.equal(mixed.precip,"snow");assert.equal(mixed.secondaryPrecip,"rain");assert.equal(mixed.obscuration,"mist");
});

test("obscuration density follows visibility, variant and performance mode",()=>{
  const state=classifyEffect(["FG"]),five=buildObscurationSpec(state,5,1,5,"full",false),two=buildObscurationSpec(state,2,1,5,"full",false),half=buildObscurationSpec(state,.5,1,5,"full",false);
  assert.ok(five.density<two.density&&two.density<half.density);assert.ok(five.layers<=two.layers&&two.layers<=half.layers);
  const mist=buildObscurationSpec(classifyEffect(["BR"]),5,1,5,"full",false),storm=buildObscurationSpec(classifyEffect(["SS"]),.5,1,30,"full",false);
  assert.ok(mist.density<storm.density);assert.ok(storm.duration<mist.duration);
  assert.ok(mist.horizon<half.horizon);assert.ok(half.horizon>.85&&half.veil>.45);
  const low=buildObscurationSpec(state,.5,1,5,"low",false),reduced=buildObscurationSpec(state,.5,1,5,"full",true);
  assert.ok(low.density<half.density&&low.layers<=2);assert.equal(reduced.duration,0);
  assert.ok(half.density-five.density>.6,"BR/FG visibility anchors must not be visually adjacent");
  const shallow=buildObscurationSpec(classifyEffect(["MIFG"]),2,1,5,"full",false),patchy=buildObscurationSpec(classifyEffect(["BCFG"]),2,1,5,"full",false),partial=buildObscurationSpec(classifyEffect(["PRFG"]),1,1,5,"full",false);
  assert.ok(shallow.veil<.03&&patchy.veil<.03&&partial.horizon>patchy.horizon);
});

test("low-performance and reduced-motion paths reduce particle work and motion",()=>{
  const full=fx(["+SN"],{perf:"full"}),low=fx(["+SN"],{perf:"low"}),reduced=fx(["+SN"],{reduced:true});
  assert.ok(low.count<full.count&&low.count<=240);assert.ok(reduced.count<full.count&&reduced.speed<full.speed);assert.equal(reduced.near,false);assert.equal(reduced.burst,false);
});

test("weather effects keep one canvas, one animation loop and no legacy particle DOM",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"),canvas=readFileSync(new URL("../app/PrecipCanvas.tsx",import.meta.url),"utf8"),weather=readFileSync(new URL("../app/weatherFx.ts",import.meta.url),"utf8");
  assert.equal((page.match(/<PrecipCanvas\b/g)||[]).length,1);assert.equal((canvas.match(/<canvas\b/g)||[]).length,1);assert.equal((canvas.match(/const frame=/g)||[]).length,1);
  assert.doesNotMatch(page,/className="(?:rain-field|snow-field|glass-droplets|weather-fx|fog-layer)"/);
  assert.equal((page.match(/className="obscuration-field"/g)||[]).length,1);assert.equal((page.match(/className="sky-base"/g)||[]).length,2);assert.equal((page.match(/className="cloud-field"/g)||[]).length,1);
  assert.doesNotMatch(canvas,/setInterval|setTimeout|useState/);assert.doesNotMatch(weather,/setInterval|setTimeout|requestAnimationFrame|document\./);
  assert.match(canvas,/const specSignature=spec\?JSON\.stringify\(spec\):"none"/);assert.doesNotMatch(canvas,/\[spec,paused\]/);assert.match(canvas,/\.62\+\.38\*showerLevel/);
  assert.match(page,/data-wallpaper-scene=/);assert.match(page,/sceneForEffects/);
});
