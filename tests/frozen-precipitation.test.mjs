import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrozenImpact, advanceFrozenImpact, frozenImpactOpacity, frozenContactHeight, frozenShowerOpacity, MAX_FROZEN_IMPACTS } from '../app/frozenPrecipitation.ts';
const input={x:300,ground:700,size:7,depth:.6,incoming:1420,wind:180,alpha:.9,hail:true,color:'#fff'};
const seeded=seed=>()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);

test('frozen contacts are depth-distributed instead of one common bounce floor',()=>{
  const heights=[];
  for(let i=0;i<=100;i++)heights.push(frozenContactHeight(720,i/100,(i*17%101)/100));
  assert.ok(Math.max(...heights)-Math.min(...heights)>90);
  assert.ok(heights.every(v=>v>=720*.8325&&v<=720*1.0125));
  assert.ok(frozenContactHeight(720,0,.5)<frozenContactHeight(720,1,.5));
  assert.equal(frozenContactHeight(720,-5,-10),frozenContactHeight(720,0,0));
});

test('hail and pellets keep short randomized rebounds capped by actual impact energy',()=>{
  const random=seeded(37),lifetimes=new Set(),heights=new Set();
  for(const hail of [false,true])for(let i=0;i<150;i++){
    const p=createFrozenImpact({...input,hail,depth:i/149},random);
    const height=p.vy*p.vy/(2*p.gravity);
    assert.ok(p.vy<0);
    assert.ok(height<=17.0001&&height>0);
    assert.ok(Math.abs(p.vy)<=input.incoming*.24);
    assert.ok(p.size>=input.size*.58&&p.size<=input.size*.74);
    assert.ok(p.lifetime>=.24&&p.lifetime<=.38);
    lifetimes.add(p.lifetime.toFixed(3));heights.add(height.toFixed(1));
  }
  assert.ok(lifetimes.size>30&&heights.size>30,'Impacts are not synchronized identical hops');
  const slow=createFrozenImpact({...input,incoming:100},seeded(8));
  assert.ok(Math.abs(slow.vy)<=24,'Do not turn a slow impact into a high-energy rebound');
});

test('impact energy decays, alpha fades monotonically, and no bottom accumulation survives',()=>{
  const random=seeded(62);
  for(let i=0;i<250;i++){
    const p=createFrozenImpact({...input,depth:i/249},random);
    let alive=true,previousAlpha=frozenImpactOpacity(p),hops=1,firstEnergy=p.vy*p.vy,steps=0;
    while(alive&&steps++<300){
      const oldBounce=p.bounces;
      alive=advanceFrozenImpact(p,1/120);
      const alpha=frozenImpactOpacity(p);
      assert.ok(alpha<=previousAlpha+1e-12&&alpha>=0);
      previousAlpha=alpha;
      if(p.bounces!==oldBounce){hops++;assert.ok(p.vy*p.vy<firstEnergy*.16,'Second rebound loses most energy');}
    }
    assert.equal(alive,false);
    assert.ok(steps/120<=.39);
    assert.ok(hops<=2);
  }
});

test('motion pause is exact and the impact population has a fixed resource bound',()=>{
  const p=createFrozenImpact(input,seeded(2)),before=structuredClone(p);
  assert.equal(advanceFrozenImpact(p,0),true);
  assert.deepEqual(p,before);
  assert.equal(MAX_FROZEN_IMPACTS,64);
  for(const dt of [1/120,1/30,.1]){
    const q=createFrozenImpact(input,seeded(4));let time=0;
    while(advanceFrozenImpact(q,dt)&&time<2)time+=dt;
    assert.ok(time<.6);
    assert.ok(Object.values(q).filter(v=>typeof v==='number').every(Number.isFinite));
  }
});


test('frozen showers vary gently per particle without globally hidden arrival cohorts',()=>{
  const means=[];
  for(let time=0;time<=120000;time+=100){
    let total=0;
    for(let i=0;i<80;i++){
      const value=frozenShowerOpacity(time,i*Math.PI*2/80,0);
      assert.ok(value>=.88-1e-12&&value<=1);
      total+=value;
    }
    means.push(total/80);
  }
  assert.ok(Math.max(...means)-Math.min(...means)<1e-12);
  assert.notEqual(frozenShowerOpacity(3000,0,0),frozenShowerOpacity(3000,Math.PI,0));
});
