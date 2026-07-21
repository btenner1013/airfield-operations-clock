"use client";
// The one and only precipitation canvas. Primary and optional secondary precipitation plus pane
// droplets share one particle array and one rAF loop; clock rendering remains completely isolated.
import { useEffect, useRef } from "react";
import type { FxSpec, PaneSpec, ParticleClassSpec } from "./weatherFx";

type Particle={x:number;y:number;v:number;vx:number;len:number;size:number;phase:number;depth:number;seed:number;group:0|1;bounces:number};
type Drop={x:number;y:number;r:number;rMax:number;vy:number;vx:number;trailY:number;rolling:boolean;wob:number;age:number;rollAfter:number};
const DPR_CAP=2;

export default function PrecipCanvas({spec,paused,night}:{spec:FxSpec|null;paused?:boolean;night?:boolean}) {
  const ref=useRef<HTMLCanvasElement|null>(null),specRef=useRef<FxSpec|null>(spec),pausedRef=useRef(!!paused),nightRef=useRef(!!night);
  specRef.current=spec;pausedRef.current=!!paused;nightRef.current=!!night;
  // page.tsx renders once per clock second, so object identity is not a weather-change signal.
  // A value signature prevents those clock renders from reseeding the complete particle field.
  const specSignature=spec?JSON.stringify(spec):"none";
  const particles=useRef<Particle[]>([]),drops=useRef<Drop[]>([]),raf=useRef(0),dims=useRef({w:0,h:0});
  const api=useRef<{sync:()=>void;start:()=>void}>({sync:()=>{},start:()=>{}});

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx){canvas.dataset.active="0";return;}
    const host=(canvas.parentElement as HTMLElement|null)||canvas,rnd=(a:number,b:number)=>a+Math.random()*(Math.max(a,b)-a),clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
    const bandRange=(kind:ParticleClassSpec["band"],h:number):[number,number]=>kind==="surface"?[h*.76,h*1.03]:kind==="lower"?[h*.43,h*1.03]:[-h,h];
    const place=(p:Particle,cls:ParticleClassSpec,initial=false)=>{const {w,h}=dims.current,[top,bottom]=bandRange(cls.band,h||800);p.x=rnd(0,w||1200);p.y=initial?rnd(top,bottom):cls.band==="full"?rnd(-45,-5):rnd(top,bottom);};
    const configure=(p:Particle,cls:ParticleClassSpec)=>{
      if(cls.shape==="flake"&&cls.near){const layer=Math.random();p.size=layer>.82?rnd(Math.max(4,cls.sizeMin),cls.sizeMax):layer>.42?rnd(Math.max(2.5,cls.sizeMin),Math.min(4,cls.sizeMax)):rnd(cls.sizeMin,Math.min(2.5,cls.sizeMax));}
      else if(cls.near){const layer=Math.random(),span=Math.max(.1,cls.sizeMax-cls.sizeMin),mid=cls.sizeMin+span*.48,near=cls.sizeMin+span*.74;p.size=layer>.82?rnd(near,cls.sizeMax):layer>.42?rnd(mid,near):rnd(cls.sizeMin,mid);}
      else p.size=rnd(cls.sizeMin,cls.sizeMax);
      p.depth=clamp((p.size-cls.sizeMin)/Math.max(.1,cls.sizeMax-cls.sizeMin),0,1);
      p.v=cls.speed*rnd(.78,1.22)*(.82+p.depth*.38);p.vx=cls.vx*rnd(.76,1.12);p.len=cls.len*(.82+p.depth*.42);p.bounces=0;
    };
    const classFor=(s:FxSpec,p:Particle)=>p.group===1&&s.secondary?s.secondary:s;
    const spawnDrop=(pane:PaneSpec,initial=false):Drop=>{const {w,h}=dims.current;let rLo=1.2,rHi=2.6,maxLo=3.4,maxHi=7,rollLo=2,rollHi=5;
      if(pane.profile==="drizzle"){rLo=.65;rHi=1.35;maxLo=1.5;maxHi=3.2;rollLo=2.4;rollHi=5;}
      else if(pane.profile==="freezing"){rLo=1;rHi=2.2;maxLo=2.8;maxHi=5.8;rollLo=3.4;rollHi=5.5;}
      else if(pane.profile==="vicinity"){rLo=1;rHi=2;maxLo=2.8;maxHi=5.5;rollLo=2.5;rollHi=5;}
      return {x:rnd(0,w||1200),y:rnd((h||800)*.06,(h||800)*.82),r:rnd(rLo,rHi),rMax:rnd(maxLo,maxHi),vy:0,vx:(pane.freezing ? .02 : .04)*(specRef.current?.vx||0),trailY:0,rolling:false,wob:rnd(0,6),age:initial?rnd(0,2.2):0,rollAfter:rnd(rollLo,rollHi)};
    };

    const measure=()=>{const rect=host.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height)),dpr=Math.min(window.devicePixelRatio||1,DPR_CAP),changed=Math.abs(w-dims.current.w)>2||Math.abs(h-dims.current.h)>2;dims.current={w,h};canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);canvas.dataset.canvasCssWidth=String(w);canvas.dataset.canvasCssHeight=String(h);canvas.dataset.canvasBufferWidth=String(canvas.width);canvas.dataset.canvasBufferHeight=String(canvas.height);canvas.dataset.canvasDpr=String(dpr);if(changed){const s=specRef.current;if(s)for(const p of particles.current)place(p,classFor(s,p),true);for(const d of drops.current){d.x=rnd(0,w);d.y=Math.min(d.y,h);}}};
    measure();const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;if(ro)ro.observe(host);window.addEventListener("resize",measure);

    const sync=()=>{const s=specRef.current,arr=particles.current,dropList=drops.current,primary=s?.count||0,secondary=s?.secondary?.count||0,target=primary+secondary;while(arr.length<target)arr.push({x:0,y:0,v:0,vx:0,len:0,size:0,phase:rnd(0,Math.PI*2),depth:1,seed:rnd(0,1),group:0,bounces:0});if(arr.length>target)arr.length=target;if(s)for(let i=0;i<arr.length;i++){const p=arr[i];p.group=i<primary?0:1;const cls=classFor(s,p);configure(p,cls);place(p,cls,true);}if(!s?.pane)dropList.length=0;else{if(dropList.length>s.pane.count)dropList.length=s.pane.count;const seedCount=Math.min(s.pane.count,Math.max(2,Math.round(s.pane.count*.42)));while(dropList.length<seedCount)dropList.push(spawnDrop(s.pane,true));}const avg=arr.length?arr.reduce((sum,p)=>sum+p.size,0)/arr.length:0,near=arr.filter(p=>p.size>=4).length;canvas.dataset.count=String(target);canvas.dataset.primaryCount=String(primary);canvas.dataset.secondaryCount=String(secondary);canvas.dataset.secondaryType=s?.secondary?.type||"none";canvas.dataset.averageSize=avg.toFixed(1);canvas.dataset.nearCount=String(near);canvas.dataset.verticalBand=s?.band||"none";canvas.dataset.modulation=s?.burst&&!s.reduced?"irregular-shower":"steady";canvas.dataset.pane=s?.pane?"1":"0";canvas.dataset.paneProfile=s?.pane?.profile||"none";canvas.dataset.trails=s?.pane?.trails?"1":"0";};

    const drawDrop=(d:Drop,freezing:boolean,nightNow:boolean,trails:boolean)=>{const r=d.r;if(trails&&d.rolling){ctx.globalAlpha=.08;ctx.strokeStyle=freezing?"#a9c4d6":"#bcd2e0";ctx.lineWidth=Math.max(1,r*.22);ctx.beginPath();ctx.moveTo(d.x,d.trailY);ctx.quadraticCurveTo(d.x+Math.sin(d.wob)*2,(d.trailY+d.y)*.5,d.x,d.y);ctx.stroke();}const gradient=ctx.createRadialGradient(d.x-r*.35,d.y-r*.5,r*.1,d.x,d.y+r*.2,r*1.1);gradient.addColorStop(0,freezing?"rgba(212,230,242,.82)":"rgba(220,235,245,.78)");gradient.addColorStop(.5,freezing?"rgba(150,178,196,.26)":"rgba(168,196,214,.24)");gradient.addColorStop(1,freezing?"rgba(38,58,72,.5)":"rgba(28,46,58,.44)");ctx.globalAlpha=nightNow ? .82 : 1;ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(d.x,d.y,r*.82,r,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=nightNow ? .5 : .66;ctx.fillStyle="rgba(255,255,255,.78)";ctx.beginPath();ctx.ellipse(d.x-r*.32,d.y-r*.42,r*.16,r*.22,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;};
    const drawFlake=(p:Particle,color:string)=>{ctx.fillStyle="rgba(37,55,66,.55)";ctx.beginPath();ctx.arc(p.x+.35,p.y+.45,p.size*1.08,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*.72,0,Math.PI*2);ctx.fill();if(p.size>3.8){ctx.lineWidth=Math.max(.65,p.size*.16);ctx.strokeStyle=color;for(let arm=0;arm<3;arm++){const a=arm*Math.PI/3,dx=Math.cos(a)*p.size*1.55,dy=Math.sin(a)*p.size*1.55;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}}};
    const drawGrain=(p:Particle,color:string)=>{ctx.fillStyle="rgba(45,61,70,.58)";ctx.beginPath();ctx.ellipse(p.x+.3,p.y+.4,p.size*.7,p.size*1.32,p.phase*.16,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x,p.y,p.size*.46,p.size, p.phase*.16,0,Math.PI*2);ctx.fill();};
    const drawCrystal=(p:Particle,color:string)=>{ctx.strokeStyle="rgba(45,67,79,.7)";ctx.lineWidth=Math.max(1,p.size*.34);for(let arm=0;arm<2;arm++){const a=Math.PI/4+arm*Math.PI/2,dx=Math.cos(a)*p.size*1.25,dy=Math.sin(a)*p.size*1.25;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}ctx.strokeStyle=color;ctx.lineWidth=Math.max(.65,p.size*.18);for(let arm=0;arm<2;arm++){const a=Math.PI/4+arm*Math.PI/2,dx=Math.cos(a)*p.size,dy=Math.sin(a)*p.size;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}};
    const drawPellet=(p:Particle,color:string,hail:boolean)=>{const r=p.size;ctx.fillStyle="rgba(8,18,24,0.92)";ctx.beginPath();const shadowRadius=r*1.38;if(hail){const points=8;for(let i=0;i<points;i++){const a=i*Math.PI*2/points,rad=shadowRadius*(i%2?.82:1.08),x=p.x+Math.cos(a)*rad,y=p.y+Math.sin(a)*rad;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}else ctx.arc(p.x,p.y,shadowRadius,0,Math.PI*2);ctx.fill();ctx.fillStyle=hail?"rgba(235,246,255,1)":"rgba(222,241,255,1)";ctx.beginPath();const coreRadius=r*0.95;if(hail){const points=8;for(let i=0;i<points;i++){const a=i*Math.PI*2/points,rad=coreRadius*(i%2?.82:1.08),x=p.x-r*0.05+Math.cos(a)*rad,y=p.y-r*0.05+Math.sin(a)*rad;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}else ctx.arc(p.x-r*0.05,p.y-r*0.05,coreRadius,0,Math.PI*2);ctx.fill();ctx.fillStyle="rgba(255,255,255,1)";ctx.beginPath();ctx.arc(p.x-r*0.3,p.y-r*0.3,Math.max(0.8,r*0.28),0,Math.PI*2);ctx.fill();};
    const drawClass=(s:FxSpec,cls:ParticleClassSpec,group:0|1,now:number,dt:number)=>{
      const {w,h}=dims.current,arr=particles.current,[bandTop,bandBottom]=bandRange(cls.band,h);
      // Shower-only modulation always retains a 62% baseline and combines two long, non-harmonic
      // cycles. Particles continue moving while the optional shower population is hidden.
      const showerLevel=clamp(.5+.28*Math.sin(now/4900)+.22*Math.sin(now/8100+1.7));
      const visibleThreshold=cls.burst?(.62+.38*showerLevel):1;
      ctx.lineCap="round";
      for(let i=0;i<arr.length;i++){
        const p=arr[i];if(p.group!==group)continue;
        if(cls.band==="full"){
          p.y+=p.v*dt;p.x+=p.vx*dt+(["flake","grain","crystal"].includes(cls.shape)?Math.sin(p.phase+=dt*1.25)*cls.sway*dt:0);
          if(p.y>h+55){place(p,cls);configure(p,cls);}
          if(p.x<-65)p.x+=w+120;else if(p.x>w+65)p.x-=w+120;
        }else{
          p.y+=p.v*dt*.12+Math.sin(p.phase+=dt*1.6)*cls.sway*dt;p.x+=p.vx*dt;
          if(p.y>bandBottom)p.y=bandTop+rnd(0,12);
          if(p.x<-45)p.x=w+35;else if(p.x>w+45)p.x=-35;
        }
        if(p.seed>visibleThreshold)continue;
        const particleAlpha=cls.alpha*(.68+p.depth*.32);ctx.globalAlpha=particleAlpha;
        if(cls.shape==="streak"){
          const dx=p.v?p.vx*(p.len/p.v):0,lineWidth=cls.thick*(.82+p.depth*.35);
          const isNight=nightRef.current;
          const shadowColor=isNight?"rgba(20,32,42,0.55)":"rgba(3,9,14,0.92)";
          const shadowWidth=isNight?lineWidth+1.2:lineWidth+2.0;
          const coreColor=isNight?cls.color:"rgba(245,253,255,1)";
          ctx.globalAlpha=particleAlpha*(isNight?0.65:0.95);
          ctx.strokeStyle=shadowColor;
          ctx.lineWidth=shadowWidth;
          ctx.beginPath();
          ctx.moveTo(p.x,p.y);
          ctx.lineTo(p.x-dx,p.y-p.len);
          ctx.stroke();
          ctx.globalAlpha=particleAlpha;
          ctx.strokeStyle=coreColor;
          ctx.lineWidth=lineWidth;
          ctx.beginPath();
          ctx.moveTo(p.x,p.y);
          ctx.lineTo(p.x-dx,p.y-p.len);
          ctx.stroke();
        }else if(cls.shape==="flake")drawFlake(p,cls.color);
        else if(cls.shape==="grain")drawGrain(p,cls.color);
        else if(cls.shape==="crystal")drawCrystal(p,cls.color);
        else{if(cls.bounce){const grav=1100+p.seed*600;p.v=Math.min(p.v+grav*dt,cls.speed*1.3);const ground=h*.87;if(p.y>=ground&&p.v>0&&p.bounces<3){p.y=ground;const coeff=(0.18+p.seed*0.22)*(p.bounces===0?1:p.bounces===1?0.5:0.25);p.v=-cls.speed*coeff;p.vx+=(p.seed-.5)*(cls.shape==="hail"?rnd(220,450):rnd(110,320));p.bounces++;}}drawPellet(p,cls.color,cls.shape==="hail");}
      }
      ctx.globalAlpha=1;
    };

    let last=performance.now(),frames=0,fpsTime=0;
    const frame=(now:number)=>{const s=specRef.current,{w,h}=dims.current,dropList=drops.current,dt=Math.min((now-last)/1000,.05);last=now;if(pausedRef.current||(!s&&!dropList.length)){ctx.clearRect(0,0,w,h);raf.current=0;canvas.dataset.active=s?"1":"0";return;}canvas.dataset.active="1";frames++;fpsTime+=dt;if(fpsTime>=.5){canvas.dataset.fps=String(Math.round(frames/fpsTime));frames=0;fpsTime=0;}ctx.clearRect(0,0,w,h);if(s){if(s.veil>0){const veil=ctx.createLinearGradient(0,0,0,h);veil.addColorStop(0,`rgba(210,222,232,${s.veil})`);veil.addColorStop(.58,`rgba(210,222,232,${s.veil*.42})`);veil.addColorStop(1,"rgba(210,222,232,0)");ctx.fillStyle=veil;ctx.fillRect(0,0,w,h);}drawClass(s,s,0,now,dt);if(s.secondary)drawClass(s,s.secondary,1,now,dt);}
      const pane=s?.pane||null;if(pane&&dropList.length<pane.count&&Math.random()<.12)dropList.push(spawnDrop(pane));const roll=pane?.roll||.7,freezing=pane?.freezing||false,trails=pane?.trails||false;let rolling=0;for(let i=dropList.length-1;i>=0;i--){const d=dropList[i];d.age+=dt;if(!d.rolling){d.r+=dt*(pane?.profile==="drizzle" ? .16 : pane?.freezing ? .1 : .36);if(d.age>=d.rollAfter||d.r>d.rMax){d.rolling=true;d.trailY=d.y;}}else{d.vy=Math.min(d.vy+d.r*roll*14*dt,d.r*roll*30);d.y+=d.vy*dt;d.wob+=dt*2;d.x+=(d.vx+Math.sin(d.wob)*4)*dt;rolling++;}if(d.y-d.r>h){dropList.splice(i,1);continue;}drawDrop(d,freezing,nightRef.current,trails);}canvas.dataset.dropCount=String(dropList.length);canvas.dataset.dropRolling=String(rolling);raf.current=requestAnimationFrame(frame);};
    const start=()=>{if((specRef.current||drops.current.length)&&!pausedRef.current&&!raf.current){last=performance.now();raf.current=requestAnimationFrame(frame);}};api.current={sync,start};sync();start();return()=>{window.removeEventListener("resize",measure);ro?.disconnect();if(raf.current)cancelAnimationFrame(raf.current);raf.current=0;};
  },[]);

  useEffect(()=>{api.current.sync();api.current.start();},[specSignature,paused]);
  return <canvas ref={ref} className="precip-canvas" aria-hidden="true" data-active="0"/>;
}
