import test from 'node:test';
import assert from 'node:assert/strict';
import {sockMesh} from '../app/windsockMesh.mjs';
test('north strength changes elevation, pressure and inflation without turning',()=>{
 const low=sockMesh(0,2),mid=sockMesh(0,7),high=sockMesh(0,15);
 assert.ok(low.tail.y>mid.tail.y+2);assert.ok(mid.tail.y>high.tail.y+2);
 assert.ok(low.pressure<mid.pressure&&mid.pressure<high.pressure);
 for(const m of [low,mid,high]) {assert.ok(Math.abs(m.dx)<1e-10);assert.equal(m.dy,1);}
});
test('north flutter is visible and stronger wind moves faster',()=>{
 for(const speed of [2,7,15,30])assert.notEqual(sockMesh(0,speed,0).tailRing,sockMesh(0,speed,.4).tailRing);
 assert.notEqual(sockMesh(0,15,.4).tailRing,sockMesh(0,30,.4).tailRing);
});
test('still samples identical; full inflation saturates at 15 kt',()=>{
 assert.deepEqual(sockMesh(0,15,0),sockMesh(0,15,0));assert.equal(sockMesh(0,40).lift,1);
});
test('all directions/speeds fit the established viewBox',()=>{
 for(let dir=0;dir<360;dir+=10)for(const speed of [1,2,7,15,30,40])for(const phase of [0,.4,1,2]){
  const m=sockMesh(dir,speed,phase);
  for(const face of m.faces)for(const pt of face.points.split(' ')){
   const [x,y]=pt.split(',').map(Number);assert.ok(x>=17&&x<=87&&y>=120&&y<=190,`${dir} ${speed} ${x},${y}`);
  }
 }
});

test("calm retains supported basket and is stationary",()=>{assert.deepEqual(sockMesh(270,0,0),sockMesh(270,0,3)); assert.equal(sockMesh(270,0).basket,sockMesh(270,15).basket);});

test('edge placement has safe left inset at desktop and phone fit scales',()=>{
  // Full direction sweep, including maximum flutter energy; scale is uniform.
  for(let from=0;from<360;from+=5) for(const speed of [0,2,8,15,30,60]) for(const phase of [0,.3,.7,1.2,2,3]) {
    const mesh=sockMesh(from,speed,phase);
    for(const f of mesh.faces) for(const p of f.points.split(' ')) {
      const x=Number(p.split(',')[0]);
      for(const width of [320,375,430,768,1200,1920]) {
        const scale=Math.min(width/1200,1);
        assert.ok((x-15)*144/76*scale>0,`clipped at ${from}/${speed}/${width}`);
      }
    }
  }
});

import {createHash} from 'node:crypto';
test('stationary and reduced-motion geometry remains byte identical to prior live release',()=>{
 const data=JSON.stringify([0,90,140,180,270].flatMap(d=>[0,2,6,15,30].map(s=>sockMesh(d,s,0))));
 assert.equal(createHash('sha256').update(data).digest('hex'),'b3a5d151c042c309cdb479df10454190d1222ad8d71e38ba6569012006441da7');
});
test('cloth flick is obvious at office 140/6 and north/6, while rigid support does not move',()=>{
 for(const d of [0,140]) {
  const samples=Array.from({length:151},(_,i)=>sockMesh(d,6,i/25));
  const dx=Math.max(...samples.map(m=>m.tail.x))-Math.min(...samples.map(m=>m.tail.x));
  const dy=Math.max(...samples.map(m=>m.tail.y))-Math.min(...samples.map(m=>m.tail.y));
  assert.ok(dx*144/76>12,`horizontal excursion ${dx}`);
  assert.ok(dy*144/76>7,`vertical excursion ${dy}`);
  for(const m of samples){assert.equal(m.mouth,samples[0].mouth);assert.equal(m.basket,samples[0].basket);}
 }
});
