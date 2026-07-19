const CACHE="airfield-clock-v9";
// Shell cached immediately on install so the display boots offline without waiting on wallpapers.
const SHELL=["./","./manifest.json","./airfield-lightning-overlay.png","./assets/backgrounds/clear-day.png","./assets/backgrounds/clear-night.png"];
// Full wallpaper set; populated in the background (or on demand) rather than blocking the page.
const WALLPAPERS=["partly-cloudy-day","partly-cloudy-night","overcast-day","overcast-night","rain-day","rain-night","thunderstorm-day","thunderstorm-night","fog-day","fog-night","snow-day","snow-night","sunrise","sunset"].map(n=>"./assets/backgrounds/"+n+".png");
const CORE=[...SHELL,...WALLPAPERS];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)))});
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  const others=(await caches.keys()).filter(k=>k!==CACHE);
  // Reuse still-valid responses from prior cache versions instead of re-downloading ~26 MB.
  for(const url of CORE){
    if(await cache.match(url)) continue;
    for(const k of others){ const r=await (await caches.open(k)).match(url); if(r){ await cache.put(url,r.clone()); break; } }
  }
  await Promise.all(others.map(k=>caches.delete(k)));
  await self.clients.claim();
  // Fill any still-missing wallpapers in the background; failures are non-fatal.
  for(const url of CORE){ if(!(await cache.match(url))) cache.add(url).catch(()=>{}); }
})()));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./"))));
});
