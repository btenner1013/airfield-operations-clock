import { createPhotographicSkyPlateCache } from "./photographicSkyPlate.ts";

/** Cloud artwork moves independently of the fixed airport photograph.
 * Loading, scheduling, visibility and reduced motion belong to PrecipCanvas. */
type SkyImage = CanvasImageSource & { width: number; height: number; src?: string; currentSrc?: string; id?: string };
type Rect = { left: number; top: number; right: number; bottom: number };
type Geometry = { x: number; y: number; width: number; height: number };
const MAX_WIDTH = 960, MAX_HEIGHT = 540;
const PAN = 0.044, MAX_ZOOM = 1.168;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const movingScenes = new Set(["clear-day", "partly-cloudy-day", "partly-cloudy-night", "overcast-day", "overcast-night", "rain-day", "rain-night", "thunderstorm-day", "thunderstorm-night", "snow-day", "snow-night", "fog-day", "fog-night", "sunrise", "sunset"]);

export function photoSkyScene(image: { src?: string; currentSrc?: string; id?: string }): string {
  return (image.currentSrc || image.src || image.id || "").split(/[?#]/)[0].split("/").pop()?.replace(/\.(?:png|jpe?g|webp)$/i, "") || "";
}
/** Artwork content, not METAR coverage or a newly requested phase, owns photo motion. */
export function photoSkyHasMotion(image: { src?: string; currentSrc?: string; id?: string }): boolean {
  return movingScenes.has(photoSkyScene(image));
}
/** Match the effective .sky-base cascade: layout-tuning.css overrides weather.css
 * with inset:0, background-size:cover and background-position:center. */
export function photoSkyGeometry(w: number, h: number, iw: number, ih: number): Geometry {
  const scale = Math.max(w / iw, h / ih);
  return { x: (w - iw * scale) / 2, y: (h - ih * scale) / 2, width: iw * scale, height: ih * scale };
}
/** Continuous same-direction advection; recycle an invisible crop with a soft overlap.
 * Unlike sine panning, every sample keeps moving through the wrap, with no turns.
 * No mirrored/tiled edges are introduced. The extra crop remains inside overscan. */
export function photoSkySamples(travel: number): { offset: number; mix: number } {
  const q = ((.5 + travel / (PAN * 2)) % 1 + 1) % 1;
  return { offset: (q * 2 - 1) * PAN, mix: smooth((q - .75) / .25) };
}

function eraseRect(ctx: CanvasRenderingContext2D, r: Rect, feather: number): void {
  const {left: x, top: y, right, bottom} = r, w = right - x, h = bottom - y;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(x, y, w, h);
  for (const [x1,y1,x2,y2,rx,ry,rw,rh] of [
    [x,y,x-feather,y,x-feather,y,feather,h], [right,y,right+feather,y,right,y,feather,h],
    [x,y,x,y-feather,x-feather,y-feather,w+feather*2,feather], [x,bottom,x,bottom+feather,x-feather,bottom,w+feather*2,feather],
  ]) {
    const g = ctx.createLinearGradient(x1,y1,x2,y2);
    g.addColorStop(0,"rgba(0,0,0,1)"); g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g; ctx.fillRect(rx,ry,rw,rh);
  }
}

export const photoTowerMasks: Record<string,{polygon:number[][];rects:number[][];ellipses:number[][]}> = {"common":{"polygon":[[0.111244,0.325186],[0.134569,0.325186],[0.143541,0.332625],[0.145335,0.339001],[0.142943,0.35813],[0.151316,0.363443],[0.150718,0.369819],[0.149522,0.381509],[0.145933,0.387885],[0.145335,0.582359],[0.108254,0.582359],[0.107656,0.390011],[0.103469,0.378321],[0.102273,0.376196],[0.101675,0.366631],[0.100478,0.363443],[0.101077,0.359192],[0.110646,0.356004],[0.108852,0.347503],[0.107057,0.337938],[0.107057,0.332625]],"rects":[[0.110646,0.298618,0.113636,0.328374],[0.119019,0.299681,0.121411,0.326249],[0.132177,0.298618,0.135167,0.330499],[0.139952,0.301807,0.142943,0.339001],[0.124402,0.311371,0.128589,0.328374],[0.111244,0.31881,0.142344,0.328374],[0.106459,0.351753,0.111244,0.361318],[0.102871,0.354942,0.107057,0.363443]],"ellipses":[[0.111842,0.317747,0.002392,0.004251],[0.119617,0.316684,0.001794,0.003188],[0.126196,0.316684,0.002392,0.004251],[0.133373,0.302869,0.001794,0.003188],[0.142344,0.319872,0.002392,0.004251]]},"fog-night":{"polygon":[[0.089713,0.390011],[0.113636,0.390011],[0.123804,0.39745],[0.125598,0.403826],[0.122608,0.421892],[0.128589,0.427205],[0.130383,0.433581],[0.127392,0.443146],[0.125,0.455898],[0.125,0.63762],[0.087919,0.63762],[0.087321,0.453773],[0.083134,0.444208],[0.08134,0.434644],[0.078947,0.432519],[0.080144,0.424017],[0.086722,0.420829],[0.083732,0.408077],[0.082536,0.4017]],"rects":[[0.089115,0.365569,0.091507,0.396387],[0.098684,0.378321,0.101077,0.39745],[0.102871,0.377258,0.108254,0.396387],[0.110646,0.365569,0.113038,0.396387],[0.119617,0.369819,0.12201,0.403826]],"ellipses":[[0.090311,0.383634,0.00299,0.005313],[0.090311,0.367694,0.001794,0.003188],[0.09988,0.382572,0.001794,0.003188],[0.104665,0.380446,0.001794,0.003188],[0.107057,0.380446,0.001794,0.003188],[0.111842,0.367694,0.001794,0.003188],[0.120813,0.371945,0.001794,0.003188],[0.120813,0.386823,0.00299,0.005313],[0.123804,0.39745,0.00299,0.005313]]},"snow-night":{"polygon":[[0.103469,0.300744],[0.125,0.300744],[0.134569,0.308183],[0.136962,0.314559],[0.134569,0.33475],[0.141746,0.341126],[0.141746,0.34644],[0.14055,0.352816],[0.14055,0.35813],[0.136962,0.367694],[0.136364,0.562168],[0.099282,0.562168],[0.099282,0.369819],[0.095096,0.357067],[0.092703,0.351753],[0.092703,0.341126],[0.0939,0.336876],[0.101675,0.333688],[0.09988,0.327311],[0.098086,0.315622],[0.09689,0.309245]],"rects":[[0.102273,0.274176,0.105263,0.306057],[0.110048,0.285866,0.11244,0.303932],[0.115431,0.283741,0.120813,0.303932],[0.123804,0.274176,0.126196,0.306057],[0.132177,0.278427,0.135167,0.311371],[0.103469,0.298618,0.126196,0.303932]],"ellipses":[[0.103469,0.292242,0.00299,0.005313],[0.104665,0.299681,0.001794,0.003188],[0.111244,0.29118,0.001794,0.003188],[0.116627,0.29118,0.002392,0.004251],[0.119019,0.289054,0.00299,0.005313],[0.125,0.276302,0.001794,0.003188],[0.133373,0.280553,0.001794,0.003188],[0.133971,0.29543,0.00299,0.005313]]}};
function eraseTowerSilhouette(ctx: CanvasRenderingContext2D,g:Geometry,scene:string,resolution:number):void {
  const mask=photoTowerMasks[scene]||photoTowerMasks.common;
  ctx.globalCompositeOperation="destination-out";ctx.fillStyle="black";ctx.strokeStyle="black";
  ctx.lineWidth=Math.max(.8,g.width/1672*resolution*2);ctx.lineJoin="round";
  const polygon=(points:number[][],outline=true)=>{ctx.beginPath();for(let i=0;i<points.length;i++){const [px,py]=points[i],x=(g.x+g.width*px)*resolution,y=(g.y+g.height*py)*resolution;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fill();if(outline)ctx.stroke();};
  polygon(mask.polygon);
  for(const [left,top,right,bottom] of mask.rects) {
    const vertical=bottom-top>(right-left)*1.5;
    const inset=vertical?Math.max(0,(right-left-.0015)/2):0;
    polygon([[left+inset,top],[right-inset,top],[right-inset,bottom],[left+inset,bottom]],false);
  }
  if(scene.endsWith("night")||scene==="sunset"||scene==="sunrise") for(const [x,y,rx,ry] of mask.ellipses) polygon(Array.from({length:12},(_,i)=>[x+Math.cos(i*Math.PI/6)*rx*.65,y+Math.sin(i*Math.PI/6)*ry*.65]),false);
}

function landmarks(scene: string): number[][] {
  const tower = scene === "fog-night" ? [.079,.36,.135,.65] : scene === "snow-night" ? [.092,.26,.146,.59] : [.100,.285,.155,.61];
  const poleTops = scene === "snow-night" ? [.47,.45,.47,.46,.45,.47,.47] : [.493,.466,.493,.475,.470,.486,.484];
  return [tower, ...[.165,.190,.231,.255,.837,.929,.960].map((x,i) => [x-.006,poleTops[i],x+.006,.65])];
}

export function createPhotographicSky(): {
  draw: (ctx: CanvasRenderingContext2D,w:number,h:number,dt:number,image:SkyImage,coverage:number,storm:number,windX:number,reduced:boolean,reveal?:number) => boolean;
  dispose: () => void;
} {
  let canvas: HTMLCanvasElement | null = null, buffer: CanvasRenderingContext2D | null = null;
  let architecture: HTMLCanvasElement | null = null, architectureCtx: CanvasRenderingContext2D | null = null, architectureKey="";
  let travel = 0, evolution = 0, opacity = 0, started = false, disposed = false;
  let currentImage: SkyImage | null = null, previousImage: SkyImage | null = null, imageBlend = 1;
  const plates = createPhotographicSkyPlateCache();
  return {
    draw(ctx,w,h,dt,image,coverage,storm,windX,reduced,reveal=1) {
      if(disposed || w<=0 || h<=0 || image.width<=0 || image.height<=0) return false;
      if(image!==currentImage) {
        previousImage=imageBlend<.5&&previousImage?previousImage:currentImage;
        currentImage=image; imageBlend=previousImage?0:1;
      }
      if(reduced) { previousImage=null; imageBlend=1; return false; }
      const step=clamp(dt,0,.1);
      imageBlend=Math.min(1,imageBlend+step/3.6);
      if(imageBlend===1) previousImage=null;
      if(!photoSkyHasMotion(image) && (!previousImage || !photoSkyHasMotion(previousImage))) return false;
      const target=clamp(reveal);
      opacity=started?opacity+(target-opacity)*(1-Math.exp(-step/2.2)):target; started=true;
      if(opacity<.002) return true;
      const previousPlate=previousImage&&photoSkyHasMotion(previousImage)?plates.get(previousImage):null;
      const currentPlate=photoSkyHasMotion(image)?plates.get(image):null;
      // A failed readback must never move source architecture. Leave the safe
      // static background visible; procedural clouds/fog continue independently.
      if(photoSkyHasMotion(image)&&!currentPlate) return false;
      if(!canvas) { if(typeof document==="undefined") return false; canvas=document.createElement("canvas"); buffer=canvas.getContext("2d"); }
      if(!buffer) return false;
      const resolution=Math.min(1,MAX_WIDTH/w,MAX_HEIGHT/h), bw=Math.max(1,Math.round(w*resolution)), bh=Math.max(1,Math.round(h*resolution));
      if(canvas.width!==bw || canvas.height!==bh) { canvas.width=bw; canvas.height=bh; }
      const original=photoSkyGeometry(w,h,image.width,image.height);
      const direction=Math.abs(windX)>=1?Math.sign(windX):1;
      const speed=Math.max(Math.min(Math.abs(windX),40)*.9,14+clamp(storm)*12);
      travel+=direction*speed/Math.max(1,original.width)*step; evolution+=step;
      const {offset,mix}=photoSkySamples(travel), zoom=1.16+Math.sin(evolution/23)*.008;
      const drawSource=(source: SkyImage, plate: typeof currentPlate, pan: number, alpha: number) => {
        if(alpha<=0) return;
        const g=photoSkyGeometry(w,h,source.width,source.height), moving=!!plate;
        const z=moving?zoom:1;
        const x=g.x+g.width*(1-z)/2+(moving?pan*g.width:0), y=g.y+g.height*(1-z)/2;
        buffer!.globalAlpha=alpha;
        buffer!.drawImage(plate?.image || source,x*resolution,y*resolution,g.width*z*resolution,g.height*z*resolution);
      };
      buffer.globalAlpha=1; buffer.globalCompositeOperation="source-over"; buffer.clearRect(0,0,bw,bh); buffer.imageSmoothingEnabled=true;
      // Exact four-weight crossfade, using source-over without allocating a
      // second per-frame surface. Both source and recycle transitions stay opaque.
      const blend=previousImage?imageBlend:1;
      if(previousImage) drawSource(previousImage,previousPlate,offset,1);
      drawSource(image,currentPlate,offset,blend);
      if(previousImage && mix>0) drawSource(previousImage,previousPlate,offset-PAN*2,((1-blend)*mix)/Math.max(1e-9,1-blend*mix));
      if(mix>0) drawSource(image,currentPlate,offset-PAN*2,blend*mix);
      buffer.globalAlpha=1;
      // Keep star points fixed while the cloud plate travels beneath them.
      for(const [source,plate,alpha] of [[previousImage,previousPlate,1-blend],[image,currentPlate,blend]] as const) {
        if(!source || !plate?.stars || alpha<=0) continue;
        const g=photoSkyGeometry(w,h,source.width,source.height);
        buffer.globalCompositeOperation="screen"; buffer.globalAlpha=alpha; buffer.drawImage(plate.stars,g.x*resolution,g.y*resolution,g.width*resolution,g.height*resolution);
      }
      buffer.globalAlpha=1; buffer.globalCompositeOperation="source-over";
      const closedDeck=clamp((coverage-.8)/.2);
      if(closedDeck>0) { buffer.globalCompositeOperation="saturation"; buffer.globalAlpha=closedDeck; buffer.fillStyle="rgb(160,160,160)"; buffer.fillRect(0,0,bw,bh); buffer.globalAlpha=1; }
      // Source-space skyline follows every viewport crop. Cleaning the sky plate
      // lets this mask protect just the fixed tower, not its entire swept path.
      let solid=Infinity, clear=Infinity;
      for(const source of [image,previousImage]) {
        if(!source) continue;
        const g=photoSkyGeometry(w,h,source.width,source.height), scene=photoSkyScene(source);
        const bottom=scene==="snow-night"?.49:scene==="fog-night"?.54:.505;
        solid=Math.min(solid,g.y+g.height*(bottom-.08),g.y+g.height*((1-MAX_ZOOM)/2+MAX_ZOOM*(bottom-.08)));
        clear=Math.min(clear,g.y+g.height*bottom,g.y+g.height*((1-MAX_ZOOM)/2+MAX_ZOOM*bottom));
      }
      buffer.globalCompositeOperation="destination-in";
      const mask=buffer.createLinearGradient(0,solid*resolution,0,Math.max(solid+1,clear)*resolution);
      mask.addColorStop(0,"rgba(0,0,0,1)");mask.addColorStop(.42,"rgba(0,0,0,.86)");mask.addColorStop(1,"rgba(0,0,0,0)");
      buffer.fillStyle=mask; buffer.fillRect(0,0,bw,bh);
      const maskKey=[w,h,image.width,image.height,photoSkyScene(image),previousImage?.width,previousImage?.height,previousImage?photoSkyScene(previousImage):""].join(":");
      if(!architecture){architecture=document.createElement("canvas");architectureCtx=architecture.getContext("2d");}
      if(architectureCtx&&maskKey!==architectureKey){
        architecture.width=bw;architecture.height=bh;architectureCtx.clearRect(0,0,bw,bh);architectureCtx.globalCompositeOperation="source-over";architectureCtx.fillStyle="white";architectureCtx.fillRect(0,0,bw,bh);
        for(const source of [image,previousImage]) {
          if(!source) continue;
          const g=photoSkyGeometry(w,h,source.width,source.height),scene=photoSkyScene(source);
          eraseTowerSilhouette(architectureCtx,g,scene,resolution);
          for(const [left,top,right,bottom] of landmarks(scene).slice(1)) {
            const r={left:(g.x+g.width*left)*resolution,top:(g.y+g.height*top)*resolution,right:(g.x+g.width*right)*resolution,bottom:(g.y+g.height*bottom)*resolution};
            if(r.right>0&&r.left<bw&&r.top<bh) eraseRect(architectureCtx,r,Math.max(1,g.width*resolution*.0015));
          }
        }
        architectureKey=maskKey;
      }
      // If a second context cannot be acquired, keep the original photo safe.
      if(!architectureCtx) return false;
      buffer.globalCompositeOperation="destination-in";buffer.drawImage(architecture,0,0,bw,bh);
      ctx.save(); ctx.globalCompositeOperation="source-over";ctx.globalAlpha=opacity;ctx.drawImage(canvas,0,0,w,h);ctx.restore();return true;
    },
    dispose() { disposed=true; if(canvas) {canvas.width=1;canvas.height=1;}canvas=null;buffer=null;if(architecture){architecture.width=1;architecture.height=1;}architecture=null;architectureCtx=null;currentImage=null;previousImage=null;plates.dispose(); },
  };
}
