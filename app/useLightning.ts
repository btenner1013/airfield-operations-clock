"use client";
import { useEffect, type RefObject } from "react";
import { createLightningScheduler, type LightningReport, type LightningVisualState } from "./lightning";

export function useLightningScheduler(ref:RefObject<HTMLElement|null>,report:LightningReport,reduced:boolean,flashTest:boolean) {
  const signature=[report.level,report.source,report.frequency||"",report.types.join(","),report.directions.join(",")].join("|");
  useEffect(()=>{
    const target=ref.current;if(!target)return;
    const paint=(state:LightningVisualState)=>{target.dataset.lightningActive=state.active?"1":"0";target.dataset.lightningPulse=String(state.pulse);target.dataset.lightningBolt=state.bolt?"1":"0";target.dataset.lightningCluster=String(state.cluster);};
    const scheduler=createLightningScheduler(report,{reduced,flashTest,visibilityTarget:document,onState:paint});
    scheduler.start();return()=>scheduler.stop();
  },[ref,signature,reduced,flashTest]);
}
