"use client";
// The one and only precipitation canvas. Primary and optional secondary precipitation plus pane
// droplets share one particle array and one rAF loop; clock rendering remains completely isolated.
import { useEffect, useRef } from "react";
import type { FxSpec, ParticleClassSpec } from "./weatherFx";

type Particle={x:number;y:number;v:number;vx:number;len:number;size:number;phase:number;depth:number;seed:number;group:0|1;bounces:number};
type Drop={x:number;y:number;r:number;rMax:number;vy:number;vx:number;trailY:number;rolling:boolean;wob:number};
const DPR_CAP=2;

export default function PrecipCanvas({spec,paused,night}:{spec:FxSpec|null;paused?:boolean;night?:boolean}) {
  const ref=useRef<HTMLCanvasElement|null>(null),specRef=useRef<FxSpec|null>(spec),pausedRef=useRef(!!paused),nightRef=useRef(!!night);
  specRef.current=spec;pausedRef.current=!!paused;nightRef.current=!!night;
  const particles=useRef<Particle[]>([]),drops=useRef<Drop[]>([]),raf=useRef(0),dims=useRef({w:0,h:0});
  const api=useRef<{sync:()=>void;start:()=>void}>({sync:()=>{},start:()=>{}});

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx){canvas.dataset.active="0";return;}
    const host=(canvas.parentElement as HTMLElement|null)||canvas,rnd=(a:number,b:number)=>a+Math.random()*(b-a);
    const bandRange=(kind:ParticleClassSpec["band"],h:number):[number,number]=>kind==="surface"?[h*.76,h*.93]:kind==="lower"?[h*.48,h*.9]:[-h,h];
    const place=(p:Particle,cls:ParticleClassSpec,initial=false)=>{const {w,h}=dims.current,[top,bottom]=bandRange(cls.band,h||800);p.x=rnd(0,w||1200);p.y=initial?rnd(top,bottom):cls.band==="full"?rnd(-45,-5):rnd(top,bottom);};
    const configure=(p:Particle,cls:ParticleClassSpec)=>{p.depth=cls.near?rnd(.65,1.55):rnd(.78,1.08);p.v=cls.speed*rnd(.78,1.22)*p.depth;p.vx=cls.vx*rnd(.76,1.12);p.len=cls.len*p.depth;p.size=cls.size*p.depth;p.bounces=0;};
    const classFor=(s:FxSpec,p:Particle)=>p.group===1&&s.secondary?s.secondary:s;

    const measure=()=>{const rect=host.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height)),dpr=Math.min(window.devicePixelRatio||1,DPR_CAP),changed=Math.abs(w-dims.current.w)>2||Math.abs(h-dims.current.h)>2;dims.current={w,h};canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);canvas.dataset.canvasCssWidth=String(w);canvas.dataset.canvasCssHeight=String(h);canvas.dataset.canvasBufferWidth=String(canvas.width);canvas.dataset.canvasBufferHeight=String(canvas.height);canvas.dataset.canvasDpr=String(dpr);if(changed){const s=specRef.current;if(s)for(const p of particles.current)place(p,classFor(s,p),true);for(const d of drops.current){d.x=rnd(0,w);d.y=Math.min(d.y,h);}}};
    measure();const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;if(ro)ro.observe(host);window.addEventListener("resize",measure);

    const sync=()=>{const s=specRef.current,arr=particles.current,primary=s?.count||0,secondary=s?.secondary?.count||0,target=primary+secondary;while(arr.length<target)arr.push({x:0,y:0,v:0,vx:0,len:0,size:0,phase:rnd(0,Math.PI*2),depth:1,seed:rnd(0,1),group:0,bounces:0});if(arr.length>target)arr.length=target;if(s)for(let i=0;i<arr.length;i++){const p=arr[i];p.group=i<primary?0:1;const cls=classFor(s,p);configure(p,cls);place(p,cls,true);}canvas.dataset.count=String(target);canvas.dataset.primaryCount=String(primary);canvas.dataset.secondaryCount=String(secondary);canvas.dataset.secondaryType=s?.secondary?.type||"none";canvas.dataset.pane=s?.pane?"1":"0";canvas.dataset.trails=s?.pane?.trails?"1":"0";};

    const drawDrop=(d:Drop,freezing:boolean,nightNow:boolean,trails:boolean)=>{const r=d.r;if(trails&&d.rolling){ctx.globalAlpha=.05;ctx.fillStyle=freezing?"#a9c4d6":"#bcd2e0";ctx.fillRect(d.x-.6,d.trailY,1.2,d.y-d.trailY);}const gradient=ctx.createRadialGradient(d.x-r*.35,d.y-r*.5,r*.1,d.x,d.y+r*.2,r*1.1);gradient.addColorStop(0,freezing?"rgba(212,230,242,.82)":"rgba(220,235,245,.78)");gradient.addColorStop(.5,freezing?"rgba(150,178,196,.26)":"rgba(168,196,214,.24)");gradient.addColorStop(1,freezing?"rgba(38,58,72,.5)":"rgba(28,46,58,.44)");ctx.globalAlpha=nightNow ? .78 : 1;ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(d.x,d.y,r*.82,r,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=nightNow ? .45 : .62;ctx.fillStyle="rgba(255,255,255,.75)";ctx.beginPath();ctx.ellipse(d.x-r*.32,d.y-r*.42,r*.16,r*.22,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;};
    const drawFlake=(p:Particle)=>{ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();if(p.size>2.25){ctx.lineWidth=Math.max(.45,p.size*.18);ctx.strokeStyle=ctx.fillStyle;for(let arm=0;arm<3;arm++){const a=arm*Math.PI/3,dx=Math.cos(a)*p.size*1.8,dy=Math.sin(a)*p.size*1.8;ctx.beginPath();ctx.moveTo(p.x-dx,p.y-dy);ctx.lineTo(p.x+dx,p.y+dy);ctx.stroke();}}};
    const drawClass=(s:FxSpec,cls:ParticleClassSpec,group:0|1,now:number,dt:number)=>{const {w,h}=dims.current,arr=particles.current,burst=cls.burst?(.32+.68*(.5+.5*Math.sin(now/1450))):1,[bandTop,bandBottom]=bandRange(cls.band,h);ctx.fillStyle=cls.color;ctx.strokeStyle=cls.color;ctx.globalAlpha=cls.alpha;ctx.lineWidth=cls.thick;ctx.lineCap="round";for(let i=0;i<arr.length;i++){const p=arr[i];if(p.group!==group||p.seed>burst)continue;if(cls.band==="full"){p.y+=p.v*dt;p.x+=p.vx*dt+(cls.shape==="flake"?Math.sin(p.phase+=dt*1.25)*cls.sway*dt:0);if(p.y>h+45){place(p,cls);configure(p,cls);}if(p.x< -65)p.x+=w+120;else if(p.x>w+65)p.x-=w+120;}else{p.y+=p.v*dt*.12+Math.sin(p.phase+=dt*1.6)*cls.sway*dt;p.x+=p.vx*dt;if(p.y>bandBottom)p.y=bandTop+rnd(0,8);if(p.x< -45)p.x=w+35;else if(p.x>w+45)p.x=-35;}
        if(cls.shape==="streak"){const dx=p.v?p.vx*(p.len/p.v):0;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-dx,p.y-p.len);ctx.stroke();}
        else if(cls.shape==="flake")drawFlake(p);
        else{if(cls.bounce){p.v=Math.min(p.v+1400*dt,cls.speed*1.2);const ground=h*.87;if(p.y>=ground&&p.v>0&&p.bounces<1){p.y=ground;p.v=-cls.speed*.24;p.bounces++;}else if(p.y>h+12){place(p,cls);configure(p,cls);}}ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
      }ctx.globalAlpha=1;};

    let last=performance.now(),frames=0,fpsTime=0;
    const frame=(now:number)=>{const s=specRef.current,{w,h}=dims.current,dropList=drops.current,dt=Math.min((now-last)/1000,.05);last=now;if(pausedRef.current||(!s&&!dropList.length)){ctx.clearRect(0,0,w,h);raf.current=0;canvas.dataset.active=s?"1":"0";return;}canvas.dataset.active="1";frames++;fpsTime+=dt;if(fpsTime>=.5){canvas.dataset.fps=String(Math.round(frames/fpsTime));frames=0;fpsTime=0;}ctx.clearRect(0,0,w,h);if(s){if(s.veil>0){const veil=ctx.createLinearGradient(0,0,0,h);veil.addColorStop(0,`rgba(210,222,232,${s.veil})`);veil.addColorStop(.58,`rgba(210,222,232,${s.veil*.42})`);veil.addColorStop(1,"rgba(210,222,232,0)");ctx.fillStyle=veil;ctx.fillRect(0,0,w,h);}drawClass(s,s,0,now,dt);if(s.secondary)drawClass(s,s.secondary,1,now,dt);}
      const pane=s?.pane||null;if(pane&&dropList.length<pane.count&&Math.random()<.05){let x=rnd(0,w);if(Math.random()<.3&&dropList.length)x=dropList[(Math.random()*dropList.length)|0].x+rnd(-6,6);dropList.push({x,y:rnd(h*.08,h*.85),r:rnd(1.2,2.6),rMax:rnd(3.4,7),vy:0,vx:(pane.freezing ? .02 : .04)*(s?.vx||0),trailY:0,rolling:false,wob:rnd(0,6)});}const roll=pane?.roll||.7,freezing=pane?.freezing||false,trails=pane?.trails||false;let rolling=0;for(let i=dropList.length-1;i>=0;i--){const d=dropList[i];if(!d.rolling){d.r+=2*dt*(.6+Math.random()*.4);if(d.r>d.rMax||Math.random()<.004){d.rolling=true;d.trailY=d.y;}}else{d.vy=Math.min(d.vy+d.r*roll*14*dt,d.r*roll*30);d.y+=d.vy*dt;d.wob+=dt*2;d.x+=(d.vx+Math.sin(d.wob)*4)*dt;rolling++;}if(d.y-d.r>h){dropList.splice(i,1);continue;}drawDrop(d,freezing,nightRef.current,trails);}canvas.dataset.dropCount=String(dropList.length);canvas.dataset.dropRolling=String(rolling);raf.current=requestAnimationFrame(frame);};
    const start=()=>{if((specRef.current||drops.current.length)&&!pausedRef.current&&!raf.current){last=performance.now();raf.current=requestAnimationFrame(frame);}};api.current={sync,start};sync();start();return()=>{window.removeEventListener("resize",measure);ro?.disconnect();if(raf.current)cancelAnimationFrame(raf.current);raf.current=0;};
  },[]);

  useEffect(()=>{api.current.sync();api.current.start();},[spec,paused]);
  return <canvas ref={ref} className="precip-canvas" aria-hidden="true" data-active="0"/>;
}
