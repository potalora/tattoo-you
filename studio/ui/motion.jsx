import React, {useSyncExternalStore} from 'react';
import {MotionConfig} from 'motion/react';
import {COMPACT_LAYOUT_QUERY} from '../viewport-layout.js';

export const UI_SPRING={type:'spring',stiffness:420,damping:36,mass:.9};

/** One native listener per query, shared by all consuming controls. */
export function createMediaQueryStore(query,matchMedia=value=>globalThis.window?.matchMedia(value)){
 let media;const listeners=new Set();
 const getMedia=()=>media||(media=matchMedia(query));
 const changed=()=>{for(const listener of listeners)listener();};
 return {
  getSnapshot:()=>Boolean(getMedia()?.matches),
  subscribe(listener){
   const target=getMedia();if(!target)return ()=>{};
   if(!listeners.size)target.addEventListener('change',changed);
   listeners.add(listener);
   return ()=>{listeners.delete(listener);if(!listeners.size)target.removeEventListener('change',changed);};
  },
 };
}
const reducedMotion=createMediaQueryStore('(prefers-reduced-motion: reduce)');
const compactLayout=createMediaQueryStore(COMPACT_LAYOUT_QUERY);
export function useStudioReducedMotion(){
 return useSyncExternalStore(reducedMotion.subscribe,reducedMotion.getSnapshot,()=>true);
}
export function useStudioCompact(){
 return useSyncExternalStore(compactLayout.subscribe,compactLayout.getSnapshot,()=>false);
}
export function StudioMotionProvider({children}){
 const reduce=useStudioReducedMotion();
 return <MotionConfig reducedMotion={reduce?'always':'never'} transition={reduce?{duration:0}:UI_SPRING}>{children}</MotionConfig>;
}
