export type RunwayPoint = {x:number;y:number};
export type RunwayGeometry = {id:string;ends:readonly [string,string];points:readonly [RunwayPoint,RunwayPoint];lengthFt:number};
// Common scale and traced relative threshold positions from FAA airport diagram
// AL-253 (cycle 2610). North-up schematic, not a navigation chart. Keep the close
// eastern pair and staggered north thresholds rather than spreading for labels.
const referenceLength=Math.hypot(201,3),feetScale=referenceLength/11120;
const map=(x:number,y:number):RunwayPoint=>({x:90+(x-21)*.9,y:30+(y-68)*.9});
function parallel(id:string,ends:readonly [string,string],x:number,lengthFt:number):RunwayGeometry {
  return {id,ends,lengthFt,points:[map(x-3/referenceLength*lengthFt*feetScale,296-201/referenceLength*lengthFt*feetScale),map(x,296)]};
}
const crossAngle=Math.atan2(5,162),crossLength=8946*feetScale;
export const RUNWAY_GEOMETRY:readonly RunwayGeometry[]=[
  parallel('18R/36L',['18R','36L'],25,9320),
  parallel('18C/36C',['18C','36C'],86,11120),
  parallel('18L/36R',['18L','36R'],103,9000),
  {id:'09/27',ends:['09','27'],lengthFt:8946,points:[map(31,68),map(31+Math.cos(crossAngle)*crossLength,68+Math.sin(crossAngle)*crossLength)]},
];
/** Landing arrows approach the named threshold; departures exit the opposite end. */
export function runwayArrow(runway:RunwayGeometry,end:string,operation:'arrival'|'departure') {
  const index=runway.ends.indexOf(end);if(index<0)return null;
  const threshold=runway.points[index],opposite=runway.points[1-index];
  const distance=Math.hypot(opposite.x-threshold.x,opposite.y-threshold.y);
  const ux=(opposite.x-threshold.x)/distance,uy=(opposite.y-threshold.y)/distance;
  const anchor=operation==='arrival'?threshold:opposite;
  // The center north threshold is close to 09/27. Keep its outbound arrow in
  // the gap rather than crossing the perpendicular runway or its label.
  const near=operation==='arrival'?-9:5;
  const far=operation==='arrival'?-35:end==='36C'?16:33;
  const start=operation==='arrival'?far:near,finish=operation==='arrival'?near:far;
  return {start:{x:anchor.x+ux*start,y:anchor.y+uy*start},end:{x:anchor.x+ux*finish,y:anchor.y+uy*finish},ux,uy};
}

/** Fit top-right between the brand and the clock labels, not below the clocks. */
export function runwayPlacementHeight(headerTop:number,clockTop:number,headerRight:number,brandRight:number):number {
  if(![headerTop,clockTop,headerRight,brandRight].every(Number.isFinite))return 0;
  return Math.max(0,Math.min(300,clockTop-headerTop-12,(headerRight-brandRight-24)*280/300));
}
