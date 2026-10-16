"use client";
// One precipitation canvas plus a separate photographic sky beneath the original scene scrim.
// Both share one rAF loop; clock rendering remains completely isolated.
import { useEffect, useRef } from "react";
import type { FxSpec, PaneSpec, ParticleClassSpec } from "./weatherFx";
import { createAtmosphereRenderer, type AtmosphereSpec } from "./atmosphereRenderer";
import { createPhotographicSky } from "./photographicSky";
import type { SkyPhase } from "./skyLighting";
import { advanceFrozenImpact, createFrozenImpact, frozenContactHeight, frozenImpactOpacity, frozenShowerOpacity, MAX_FROZEN_IMPACTS, type FrozenImpact } from "./frozenPrecipitation";

type Particle={x:number;y:number;v:number;vx:number;len:number;size:number;phase:number;depth:number;seed:number;group:0|1;age:number;kind:string};
type Drop={x:number;y:number;r:number;rMax:number;vy:number;vx:number;trailY:number;rolling:boolean;wob:number;age:number;rollAfter:number};
const DPR_CAP=1.5;

export default function PrecipCanvas({spec,atmosphere,backgroundSrc,paused,night,phase}:{spec:FxSpec|null;atmosphere:AtmosphereSpec;backgroundSrc:string;paused?:boolean;night?:boolean;phase?:SkyPhase}) {
  const ref=useRef<HTMLCanvasElement|null>(null),skyRef=useRef<HTMLCanvasElement|null>(null),specRef=useRef<FxSpec|null>(spec),pausedRef=useRef(!!paused),nightRef=useRef(!!night);
  const atmosphereRef=useRef(atmosphere);atmosphereRef.current={...atmosphere,phase};
  specRef.current=spec;pausedRef.current=!!paused;nightRef.current=!!night;
  // page.tsx renders once per clock second, so object identity is not a weather-change signal.
  // A value signature prevents those clock renders from reseeding the complete particle field.
  const specSignature=spec?JSON.stringify(spec):"none";
  const atmosphereSignature=JSON.stringify({...atmosphere,phase});
  const impacts=useRef<FrozenImpact[]>([]);
  const particles=useRef<Particle[]>([]),drops=useRef<Drop[]>([]),raf=useRef(0),dims=useRef({w:0,h:0});
  const photoRef=useRef<HTMLImageElement|null>(null),photoReadyAt=useRef<number|null>(null);
  const api=useRef<{sync:()=>void;start:()=>void}>({sync:()=>{},start:()=>{}});

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx){canvas.dataset.active="0";return;}
    const atmospherePainter=createAtmosphereRenderer(),photoPainter=createPhotographicSky();
    const skyCanvas=skyRef.current,skyCtx=skyCanvas?.getContext("2d")||null;
    const main=canvas.closest("main");
    // Quality is an explicit display choice. Slow frames are measured, never used to reduce detail.
    let renderMs=0,renderSpec:FxSpec|null=specRef.current?structuredClone(specRef.current):null,precipOpacity=renderSpec?1:0;
    let drawing=false,photoFilter="none",filterReadAt=-Infinity;
    let requestDraw=()=>{},settleUntil=performance.now()+8000,lastQuality=atmosphereRef.current.quality;
    const host=(canvas.parentElement as HTMLElement|null)||canvas,rnd=(a:number,b:number)=>a+Math.random()*(Math.max(a,b)-a),clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
    const bandRange=(kind:ParticleClassSpec["band"],h:number):[number,number]=>kind==="surface"?[h*.76,h*1.03]:kind==="lower"?[h*.43,h*1.03]:[-h,h];
    const place=(p:Particle,cls:ParticleClassSpec,initial=false)=>{const {w,h}=dims.current,[top,bottom]=bandRange(cls.band,h||800);p.x=rnd(0,w||1200);
      // Seed the active travel span, not an extra screen-height above it. Each
      // flake/pellet starts at its own cycle phase rather than a refill cohort.
      const end=cls.bounce?frozenContactHeight(h||800,p.depth,p.seed):(h||800)+55;
      p.y=cls.band==="full"?(initial?rnd(-45,end):rnd(-45,-5)):rnd(top,bottom);
    };
    const configure=(p:Particle,cls:ParticleClassSpec)=>{
      if(cls.shape==="flake"&&cls.near){const layer=Math.random();p.size=layer>.82?rnd(Math.max(4,cls.sizeMin),cls.sizeMax):layer>.42?rnd(Math.max(2.5,cls.sizeMin),Math.min(4,cls.sizeMax)):rnd(cls.sizeMin,Math.min(2.5,cls.sizeMax));}
      else if(cls.near){const layer=Math.random(),span=Math.max(.1,cls.sizeMax-cls.sizeMin),mid=cls.sizeMin+span*.48,near=cls.sizeMin+span*.74;p.size=layer>.82?rnd(near,cls.sizeMax):layer>.42?rnd(mid,near):rnd(cls.sizeMin,mid);}
      else p.size=rnd(cls.sizeMin,cls.sizeMax);
      p.depth=clamp((p.size-cls.sizeMin)/Math.max(.1,cls.sizeMax-cls.sizeMin),0,1);
      p.v=cls.speed*(.65+p.depth*.65);p.vx=cls.vx*(.48+p.depth*.52);p.len=cls.len*(.35+p.depth*1.1);p.kind=cls.type;
    };
    const classFor=(s:FxSpec,p:Particle)=>p.group===1&&s.secondary?s.secondary:s;
    const spawnDrop=(pane:PaneSpec,initial=false):Drop=>{const {w,h}=dims.current;let rLo=1.2,rHi=2.6,maxLo=3.4,maxHi=7,rollLo=2,rollHi=5;
      if(pane.profile==="drizzle"){rLo=.65;rHi=1.35;maxLo=1.5;maxHi=3.2;rollLo=2.4;rollHi=5;}
      else if(pane.profile==="freezing"){rLo=1;rHi=2.2;maxLo=2.8;maxHi=5.8;rollLo=3.4;rollHi=5.5;}
      else if(pane.profile==="vicinity"){rLo=1;rHi=2;maxLo=2.8;maxHi=5.5;rollLo=2.5;rollHi=5;}
      return {x:rnd(0,w||1200),y:rnd((h||800)*.06,(h||800)*.82),r:rnd(rLo,rHi),rMax:rnd(maxLo,maxHi),vy:0,vx:(pane.freezing ? .02 : .04)*(specRef.current?.vx||0),trailY:0,rolling:false,wob:rnd(0,6),age:initial?rnd(0,2.2):0,rollAfter:rnd(rollLo,rollHi)};
    };

    const measure=()=>{
      const rect=host.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
      const low=atmosphereRef.current.quality==="low";
      // Keep the total buffer bounded on 4K/retina displays; scene coordinates stay CSS pixels.
      const dpr=Math.min(window.devicePixelRatio||1,low?1:DPR_CAP,Math.sqrt((low?1500000:3200000)/(w*h)));
      const changed=Math.abs(w-dims.current.w)>2||Math.abs(h-dims.current.h)>2;
      dims.current={w,h};canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;
      const bw=Math.round(w*dpr),bh=Math.round(h*dpr);
      if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;ctx.setTransform(dpr,0,0,dpr,0,0);}
      if(skyCanvas&&skyCtx){const scale=Math.min(1,960/w,540/h),sw=Math.max(1,Math.round(w*scale)),sh=Math.max(1,Math.round(h*scale));skyCanvas.style.width=`${w}px`;skyCanvas.style.height=`${h}px`;if(skyCanvas.width!==sw||skyCanvas.height!==sh){skyCanvas.width=sw;skyCanvas.height=sh;skyCtx.setTransform(sw/w,0,0,sh/h,0,0);}}
      canvas.dataset.canvasCssWidth=String(w);canvas.dataset.canvasCssHeight=String(h);
      canvas.dataset.canvasBufferWidth=String(bw);canvas.dataset.canvasBufferHeight=String(bh);canvas.dataset.canvasDpr=dpr.toFixed(2);
      if(changed){impacts.current.length=0;if(renderSpec)for(const p of particles.current)place(p,classFor(renderSpec,p),true);for(const d of drops.current){d.x=rnd(0,w);d.y=Math.min(d.y,h);}}
      requestDraw();
    };
    measure();const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;if(ro)ro.observe(host);window.addEventListener("resize",measure);

    const syncPopulation=()=>{
      const s=renderSpec,arr=particles.current,dropList=drops.current;
      const primary=Math.round(s?.count||0),secondary=Math.round(s?.secondary?.count||0),target=primary+secondary;
      while(arr.length<target)arr.push({x:0,y:0,v:0,vx:0,len:0,size:0,phase:rnd(0,Math.PI*2),depth:1,seed:rnd(0,1),group:0,age:0,kind:""});
      if(arr.length>target)arr.length=target;
      if(s)for(let i=0;i<arr.length;i++){const p=arr[i];p.group=i<primary?0:1;const cls=classFor(s,p);if(p.kind!==cls.type){configure(p,cls);place(p,cls,true);p.age=0;}}
      if(!s?.pane)dropList.length=0;
      else{if(dropList.length>s.pane.count)dropList.length=s.pane.count;const seedCount=Math.min(s.pane.count,Math.max(2,Math.round(s.pane.count*.42)));while(dropList.length<seedCount)dropList.push(spawnDrop(s.pane,true));}
      const avg=arr.length?arr.reduce((sum,p)=>sum+p.size,0)/arr.length:0,near=arr.filter(p=>p.size>=4).length;
      canvas.dataset.count=String(target);canvas.dataset.primaryCount=String(primary);canvas.dataset.secondaryCount=String(secondary);canvas.dataset.secondaryType=s?.secondary?.type||"none";
      canvas.dataset.averageSize=avg.toFixed(1);canvas.dataset.nearCount=String(near);canvas.dataset.verticalBand=s?.band||"none";
      canvas.dataset.modulation=s?.burst&&!s.reduced?"irregular-shower":"steady";canvas.dataset.pane=s?.pane?"1":"0";canvas.dataset.paneProfile=s?.pane?.profile||"none";canvas.dataset.trails=s?.pane?.trails?"1":"0";
    };
    const sync=()=>{settleUntil=performance.now()+8000;if(lastQuality!==atmosphereRef.current.quality){lastQuality=atmosphereRef.current.quality;renderMs=0;}measure();if(atmosphereRef.current.reduced){renderSpec=specRef.current?structuredClone(specRef.current):null;precipOpacity=1;}syncPopulation();};
    const transitionPrecip=(dt:number)=>{
      const next=specRef.current,rate=1-Math.exp(-dt/1.4);
      const same=renderSpec?.type===next?.type&&renderSpec?.secondary?.type===next?.secondary?.type;
      if(!same&&renderSpec){precipOpacity+=(0-precipOpacity)*rate;if(precipOpacity<.025){renderSpec=next?structuredClone(next):null;particles.current.length=0;drops.current.length=0;impacts.current.length=0;}}
      else {
        if(!renderSpec&&next)renderSpec=structuredClone(next);
        if(renderSpec&&next){
          const blend=(a:ParticleClassSpec,b:ParticleClassSpec)=>{for(const key of ["count","speed","len","size","thick","vx","sway","alpha"] as const)a[key]+=(b[key]-a[key])*rate;};
          blend(renderSpec,next);if(renderSpec.secondary&&next.secondary)blend(renderSpec.secondary,next.secondary);
          renderSpec.pane=next.pane;renderSpec.burst=next.burst;renderSpec.reduced=next.reduced;
        }
        precipOpacity+=(1-precipOpacity)*rate;
      }
      syncPopulation();
    };

    const drawDrop=(d:Drop,freezing:boolean,nightNow:boolean,trails:boolean)=>{const r=d.r;if(trails&&d.rolling){ctx.globalAlpha=.08;ctx.strokeStyle=freezing?"#a9c4d6":"#bcd2e0";ctx.lineWidth=Math.max(1,r*.22);ctx.beginPath();ctx.moveTo(d.x,d.trailY);ctx.quadraticCurveTo(d.x+Math.sin(d.wob)*2,(d.trailY+d.y)*.5,d.x,d.y);ctx.stroke();}const gradient=ctx.createRadialGradient(d.x-r*.35,d.y-r*.5,r*.1,d.x,d.y+r*.2,r*1.1);gradient.addColorStop(0,freezing?"rgba(212,230,242,.82)":"rgba(220,235,245,.78)");gradient.addColorStop(.5,freezing?"rgba(150,178,196,.26)":"rgba(168,196,214,.24)");gradient.addColorStop(1,freezing?"rgba(38,58,72,.5)":"rgba(28,46,58,.44)");ctx.globalAlpha=(nightNow ? .82 : 1);ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(d.x,d.y,r*.82,r,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=(nightNow ? .5 : .66);ctx.fillStyle="rgba(255,255,255,.78)";ctx.beginPath();ctx.ellipse(d.x-r*.32,d.y-r*.42,r*.16,r*.22,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;};
    const drawFlake=(p:Particle,color:string)=>{ctx.fillStyle="rgba(37,55,66,.55)";ctx.beginPath();ctx.arc(p.x+.35,p.y+.45,p.size*1.08,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*.72,0,Math.PI*2);ctx.fill();if(p.size>3.8){ctx.lineWidth=Math.max(.65,p.size*.16);ctx.strokeStyle=color;for(let arm=0;arm<3;arm++){const a=arm*Math.PI/3,dx=Math.cos(a)*p.size*1.55,dy=Math.sin(a)*p.size*1.55;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}}};
    const drawGrain=(p:Particle,color:string)=>{ctx.fillStyle="rgba(45,61,70,.58)";ctx.beginPath();ctx.ellipse(p.x+.3,p.y+.4,p.size*.7,p.size*1.32,p.phase*.16,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x,p.y,p.size*.46,p.size, p.phase*.16,0,Math.PI*2);ctx.fill();};
    const drawCrystal=(p:Particle,color:string)=>{ctx.strokeStyle="rgba(45,67,79,.7)";ctx.lineWidth=Math.max(1,p.size*.34);for(let arm=0;arm<2;arm++){const a=Math.PI/4+arm*Math.PI/2,dx=Math.cos(a)*p.size*1.25,dy=Math.sin(a)*p.size*1.25;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}ctx.strokeStyle=color;ctx.lineWidth=Math.max(.65,p.size*.18);for(let arm=0;arm<2;arm++){const a=Math.PI/4+arm*Math.PI/2,dx=Math.cos(a)*p.size,dy=Math.sin(a)*p.size;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}};
    const drawPellet=(p:Pick<Particle,"x"|"y"|"size"|"phase">,_color:string,hail:boolean,impact=false)=>{
      // Compact ice pieces, not black-rimmed diamonds. Impact fragments are
      // already smaller and fading; the slight asymmetry belongs only to hail.
      const r=p.size*(impact?.9:hail?.72:.76),angle=p.phase;
      ctx.fillStyle=impact?"rgba(8,18,24,.2)":"rgba(15,27,36,.28)";
      ctx.beginPath();ctx.ellipse(p.x+r*.16,p.y+r*.24,r*1.05,r*.9,angle,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=hail?"rgba(219,235,245,.95)":"rgba(211,232,247,.94)";ctx.beginPath();
      if(hail){for(let i=0;i<9;i++){const a=angle+i*Math.PI*2/9,rad=r*(.9+.09*Math.sin(p.phase+i*2.3)),x=p.x+Math.cos(a)*rad,y=p.y+Math.sin(a)*rad*.9;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}
      else ctx.ellipse(p.x,p.y,r*.82,r,angle*.2,0,Math.PI*2);
      ctx.fill();ctx.fillStyle="rgba(255,255,255,.76)";ctx.beginPath();
      ctx.ellipse(p.x-r*.24,p.y-r*.26,Math.max(.32,r*.28),Math.max(.3,r*.2),-.5,0,Math.PI*2);ctx.fill();
    };
    const drawClass=(s:FxSpec,cls:ParticleClassSpec,group:0|1,now:number,dt:number)=>{
      const {w,h}=dims.current,arr=particles.current,[bandTop,bandBottom]=bandRange(cls.band,h);
      // Liquid showers keep their existing bounded envelope. Frozen showers use
      // tiny phase-offset opacity variation, never a synchronized hidden cohort.
      const showerLevel=clamp(.5+.28*Math.sin(now/4900)+.22*Math.sin(now/8100+1.7));
      const frozenShower=cls.burst&&cls.shape!=="streak";
      const visibleThreshold=cls.burst&&!frozenShower?(.62+.38*showerLevel):1;
      ctx.lineCap="round";
      for(let i=0;i<arr.length;i++){
        const p=arr[i];if(p.group!==group)continue;
        p.age+=dt;
        const ease=1-Math.exp(-dt*1.5),gust=1+atmosphereRef.current.gust*.35*Math.sin(now/1700+p.depth*2);
        p.vx+=(cls.vx*(.48+p.depth*.52)*gust-p.vx)*ease;
        p.v+=(cls.speed*(.65+p.depth*.65)-p.v)*ease;
        p.len+=(cls.len*(.35+p.depth*1.1)-p.len)*ease;
        if(cls.band==="full"){
          p.y+=p.v*dt;p.x+=p.vx*dt+(["flake","grain","crystal"].includes(cls.shape)?Math.sin(p.phase+=dt*1.25)*cls.sway*dt:0);
          if(cls.bounce&&p.y>=frozenContactHeight(h,p.depth,p.seed)){
            if(!atmosphereRef.current.reduced&&p.seed<=visibleThreshold){
              if(impacts.current.length>=MAX_FROZEN_IMPACTS)impacts.current.shift();
              impacts.current.push(createFrozenImpact({x:p.x,ground:frozenContactHeight(h,p.depth,p.seed),size:p.size,depth:p.depth,incoming:p.v,wind:p.vx,alpha:cls.alpha*(.35+p.depth*.65),hail:cls.shape==="hail",color:cls.color}));
            }
            configure(p,cls);place(p,cls);
          }else if(p.y>h+55){configure(p,cls);place(p,cls);}
          if(p.x<-65)p.x+=w+120;else if(p.x>w+65)p.x-=w+120;
        }else{
          p.y+=p.v*dt*.12+Math.sin(p.phase+=dt*1.6)*cls.sway*dt;p.x+=p.vx*dt;
          if(p.y>bandBottom)p.y=bandTop+rnd(0,12);
          if(p.x<-45)p.x=w+35;else if(p.x>w+45)p.x=-35;
        }
        if(p.seed>visibleThreshold)continue;
        const showerAlpha=frozenShower?frozenShowerOpacity(now,p.phase,p.seed):1;
        const particleAlpha=cls.alpha*(.35+p.depth*.65)*precipOpacity*showerAlpha*(atmosphereRef.current.reduced?1:Math.min(1,p.age/1.3));ctx.globalAlpha=particleAlpha;
        if(cls.shape==="streak"){
          const dx=p.v?p.vx*(p.len/p.v):0,lineWidth=cls.thick*(.82+p.depth*.35);
          ctx.strokeStyle=cls.color;
          ctx.lineWidth=Math.max(.4,lineWidth);
          ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-dx,p.y-p.len);ctx.stroke();
        }else if(cls.shape==="flake")drawFlake(p,cls.color);
        else if(cls.shape==="grain")drawGrain(p,cls.color);
        else if(cls.shape==="crystal")drawCrystal(p,cls.color);
        else drawPellet(p,cls.color,cls.shape==="hail");
      }
      ctx.globalAlpha=1;
    };

    let last=performance.now(),frames=0,fpsTime=0,drawTime=0;
    const frame=(now:number)=>{
      raf.current=0;
      if(pausedRef.current||document.visibilityState==="hidden"){canvas.dataset.running="0";return;}
      const a=atmosphereRef.current,low=a.quality==="low",reduced=a.reduced;
      const interval=1000/(low?20:30);
      if(!reduced&&now-drawTime<interval-1){raf.current=requestAnimationFrame(frame);return;}
      drawing=true;
      const started=performance.now(),elapsed=Math.min((now-last)/1000,.1),dt=reduced?0:elapsed;last=now;drawTime=now;
      transitionPrecip(dt);
      const s=renderSpec,{w,h}=dims.current,dropList=drops.current;
      ctx.clearRect(0,0,w,h);
      const lightning={pulse:Number(main?.dataset.lightningPulse||0),bolt:main?.dataset.lightningBolt==="1",cluster:Number(main?.dataset.lightningCluster||0)};
      const photo=photoRef.current;
      if(skyCtx)skyCtx.clearRect(0,0,w,h);
      if(photo&&skyCtx){
        if(now-filterReadAt>1000){const bases=Array.from(host.querySelectorAll<HTMLElement>(".sky-base"));const visible=bases.find(base=>base.style.opacity==="1")||bases[0];photoFilter=visible&&typeof getComputedStyle!=="undefined"?getComputedStyle(visible).filter||"none":"none";filterReadAt=now;}
        // CSS grading matches the wallpaper on browsers without Canvas filter support.
        if(skyCanvas)skyCanvas.style.filter=photoFilter;
        skyCtx.save();
        const photoBlend=reduced?1:Math.min(1,Math.max(0,(now-(photoReadyAt.current??now))/3500));
        photoPainter.draw(skyCtx,w,h,dt,photo,Math.max(a.coverage,a.storm*.85)*photoBlend,a.storm*photoBlend,a.windX,reduced);
        skyCtx.restore();
      }
      atmospherePainter.draw(ctx,w,h,now,dt,{...a,quality:low?"low":"full"},lightning);
      if(s){drawClass(s,s,0,now,dt);if(s.secondary)drawClass(s,s.secondary,1,now,dt);}
      if(reduced)impacts.current.length=0;
      for(let i=impacts.current.length-1;i>=0;i--){const impact=impacts.current[i];
        if(!advanceFrozenImpact(impact,dt)){impacts.current.splice(i,1);continue;}
        ctx.globalAlpha=frozenImpactOpacity(impact)*precipOpacity;
        drawPellet(impact,impact.color,impact.hail,true);
      }
      ctx.globalAlpha=1;canvas.dataset.impactCount=String(impacts.current.length);
      const pane=s?.pane||null;
      if(!reduced&&pane&&dropList.length<pane.count&&Math.random()<.12)dropList.push(spawnDrop(pane));
      const roll=pane?.roll||.7,freezing=pane?.freezing||false,trails=pane?.trails||false;let rolling=0;
      for(let i=dropList.length-1;i>=0;i--){
        const d=dropList[i];d.age+=dt;
        if(!d.rolling){d.r+=dt*(pane?.profile==="drizzle"?.16:pane?.freezing?.1:.36);if(d.age>=d.rollAfter||d.r>d.rMax){d.rolling=true;d.trailY=d.y;}}
        else{d.vy=Math.min(d.vy+d.r*roll*14*dt,d.r*roll*30);d.y+=d.vy*dt;d.wob+=dt*2;d.x+=(d.vx+Math.sin(d.wob)*4)*dt;rolling++;}
        if(d.y-d.r>h){dropList.splice(i,1);continue;}drawDrop(d,freezing,nightRef.current,trails);
      }
      renderMs=renderMs*.95+(performance.now()-started)*.05;
      frames++;fpsTime+=elapsed;
      if(fpsTime>=1){canvas.dataset.fps=String(Math.round(frames/fpsTime));frames=0;fpsTime=0;}
      canvas.dataset.renderMs=renderMs.toFixed(2);canvas.dataset.quality=low?"low":"full";canvas.dataset.adaptive="0";
      canvas.dataset.dropCount=String(dropList.length);canvas.dataset.dropRolling=String(rolling);canvas.dataset.active="1";
      const idle=!s&&!dropList.length&&a.coverage===0&&a.storm===0&&a.density===0&&a.lightningLevel==="none"&&now>settleUntil;
      canvas.dataset.running=reduced||idle?"0":"1";
      if(reduced||idle)canvas.dataset.fps="0";
      drawing=false;
      if(!reduced&&!idle)raf.current=requestAnimationFrame(frame);
    };
    const start=()=>{if(!drawing&&!pausedRef.current&&!raf.current&&document.visibilityState!=="hidden"){last=performance.now();raf.current=requestAnimationFrame(frame);}};
    const onVisibility=()=>{if(document.visibilityState==="hidden"){if(raf.current)cancelAnimationFrame(raf.current);raf.current=0;canvas.dataset.running="0";}else start();};
    requestDraw=start;api.current={sync,start};sync();start();document.addEventListener("visibilitychange",onVisibility);
    return()=>{window.removeEventListener("resize",measure);document.removeEventListener("visibilitychange",onVisibility);ro?.disconnect();if(raf.current)cancelAnimationFrame(raf.current);raf.current=0;atmospherePainter.dispose();photoPainter.dispose();if(skyCanvas){skyCanvas.width=1;skyCanvas.height=1;}particles.current.length=0;drops.current.length=0;impacts.current.length=0;};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const image=new Image();image.decoding="async";
    image.onload=()=>{if(cancelled)return;photoRef.current=image;if(photoReadyAt.current===null)photoReadyAt.current=performance.now();if(ref.current)ref.current.dataset.photoSky="ready";api.current.sync();api.current.start();};
    image.onerror=()=>{if(cancelled)return;photoRef.current=null;if(ref.current)ref.current.dataset.photoSky="unavailable";api.current.start();};
    image.src=backgroundSrc;
    return()=>{cancelled=true;image.onload=null;image.onerror=null;};
  },[backgroundSrc]);

  useEffect(()=>{api.current.sync();api.current.start();},[specSignature,atmosphereSignature,paused]);
  return <><canvas ref={skyRef} className="photographic-sky-canvas" aria-hidden="true"/><canvas ref={ref} className="precip-canvas" aria-hidden="true" data-active="0"/></>;
}
