// FAA-informed illustrative cloth geometry. Coordinates are north-up; airflow is FROM + 180°.
// Fixed cloth length bends down at low pressure rather than shrinking the fabric.
export function sockMesh(fromDegrees, speedKt, phase = 0) {
  const speed = Math.max(0, speedKt);
  const pressure = Math.min(1, speed / 15);
  const lift = Math.sin(pressure * Math.PI / 2);
  const length = 33;
  const heading = (fromDegrees + 180) * Math.PI / 180;
  const dx = Math.sin(heading), dy = -Math.cos(heading);
  const energy = Math.min(1, speed / 30), frequency = 2.5 + energy * 7;
  const rings = Array.from({length: 9}, (_, j) => {
    const t = j / 8;
    const free = Math.max(0, (t - .375) / .625);
    // The mouth hoop stays open; the downstream fabric collapses in light wind.
    const inflation = 1 - (1 - pressure) * .35 * free;
    const radius = 5.2 * (1 - .69 * t) * inflation;
    // Extra visible cloth flick is zero at phase 0: reduced-motion geometry stays identical.
    // Only unsupported cloth moves; the opening, basket and pole remain rigid.
    const flutter = Math.sqrt(pressure) * Math.pow(free, 1.5);
    const flick = (Math.sin(phase * 5.1) + .3 * Math.sin(phase * 11.7)) * 6 * flutter;
    const heave = Math.sin(phase * 6.7) * 3.2 * flutter;
    const sway = (Math.sin(phase * frequency - t * 8) + .3 * Math.sin(phase * frequency * 1.7 - t * 13)) * (2.35 * energy) * free * free + flick;
    const ripple = Math.sin(phase * frequency * 1.3 - t * 10) * .65 * energy * free * free + heave;
    const reach = length * (Math.min(t,.375) + .625 * free * lift);
    const droop = length * .625 * (1 - lift) * Math.pow(free, .85);
    return Array.from({length: 16}, (_, k) => {
      const angle = k / 16 * Math.PI * 2;
      const fold = 1 + (1-pressure) * free * .22 * Math.cos(angle*3 + free*8);
      const across = Math.cos(angle) * radius * fold + sway;
      return { x:52 + dx * reach - dy * across + Math.sin(angle) * radius * (1-pressure) * free * dx * 1.5,
        y:143 + dy * reach * .45 + dx * across * .45 + Math.sin(angle) * radius * (1 - (1-pressure)*free*.75) + droop + ripple,
        depth:dy * reach + dx * across };
    });
  });
  const points = ring => ring.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  const faces=[];
  for(let j=0;j<8;j++) for(let k=0;k<16;k++) {
    const vertices=[rings[j][k],rings[j+1][k],rings[j+1][(k+1)%16],rings[j][(k+1)%16]];
    const shade=Math.round(51-18*Math.sin((k+.5)/16*Math.PI*2));
    faces.push({points:points(vertices),depth:vertices.reduce((a,p)=>a+p.depth,0)/4,
      fill:Math.floor(j*5/8)%2?`hsl(35 18% ${Math.min(96,shade+35)}%)`:`hsl(19 92% ${shade}%)`});
  }
  return {faces:faces.sort((a,b)=>a.depth-b.depth),mouth:points(rings[0]),tailRing:points(rings[8]),tail:rings[8][0],basket:points(rings[3]),dx,dy,pressure,lift};
}
