// Presentation-only impact motion. Falling particles recycle independently, so
// a rebound never removes a particle from the incoming precipitation stream.
export const MAX_FROZEN_IMPACTS = 64;
export type FrozenImpact = {
  x: number; y: number; ground: number; vx: number; vy: number; gravity: number;
  size: number; phase: number; alpha: number; age: number; lifetime: number;
  restitution: number; bounces: number; hail: boolean; color: string;
};
const clamp = (n:number, lo:number, hi:number) => Math.max(lo, Math.min(hi, n));

export function frozenContactHeight(height:number, depth:number, seed:number):number {
  // Small/distant pieces land farther away; a little spread avoids a drawn-on
  // horizontal floor. The deepest contacts can lie just outside the picture.
  return height * (.85 + clamp(depth,0,1)*.145 + (clamp(seed,0,1)-.5)*.035);
}

export function createFrozenImpact(input:{x:number;ground:number;size:number;depth:number;incoming:number;wind:number;alpha:number;hail:boolean;color:string}, random:()=>number=Math.random):FrozenImpact {
  const depth=clamp(input.depth,0,1), gravity=1050+random()*450;
  const hop=(input.hail?5:2)+depth*(input.hail?9:5)+random()*3;
  // Cap the rebound by both a small visual height and actual incoming energy.
  const up=Math.min(Math.sqrt(2*gravity*hop), Math.abs(input.incoming)*(.16+random()*.08));
  return {x:input.x,y:input.ground,ground:input.ground,
    vx:input.wind*.18+(random()-.5)*(input.hail?100:65),vy:-up,gravity,
    size:input.size*(.58+random()*.16),phase:random()*Math.PI*2,alpha:input.alpha*.76,
    age:0,lifetime:.24+random()*.14,restitution:.2+random()*.12,bounces:1,
    hail:input.hail,color:input.color};
}

export function advanceFrozenImpact(p:FrozenImpact,dt:number):boolean {
  if(dt<=0) return p.age<p.lifetime;
  p.age+=dt;
  if(p.age>=p.lifetime) return false;
  p.x+=p.vx*dt;p.vx*=Math.exp(-dt*3.6);
  p.y+=p.vy*dt+.5*p.gravity*dt*dt;p.vy+=p.gravity*dt;
  p.phase+=dt*(p.vx*.025);
  if(p.y>=p.ground&&p.vy>0){
    p.y=p.ground;
    if(p.bounces>=2||p.vy*p.restitution<18) return false;
    p.vy=-p.vy*p.restitution;p.vx*=.48;p.bounces++;
  }
  return true;
}

export function frozenImpactOpacity(p:FrozenImpact):number {
  return p.alpha*Math.pow(Math.max(0,1-p.age/p.lifetime),.72);
}

// Frozen showers retain gentle local variation, without hiding a whole cohort
// behind one global threshold. Every arrival remains visible.
export function frozenShowerOpacity(nowMs:number,phase:number,seed:number):number {
  return .94+.06*Math.sin(nowMs/3900+phase+seed*Math.PI*2);
}
