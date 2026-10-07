import {ROM_SHA256,COLORS} from './session.js';
export const STATE_VERSION = 1;
const CORE_REVISION = 'jspce-d4339bae5fb2253b8b3d110e256405d928a3afc4';
const KEYS = `A X Y PC S P ProgressClock CPUBaseClock TransferSrc TransferDist TransferLen TransferAlt LastInt MPR MPRSelect RAM RAMMask BRAM BRAMUse INTIRQ2 IntDisableRegister Palette VCEBaseClock VCEControl VCEAddress VCEData VPCRegister VDCSelect VPCWindow1 VPCWindow2 VPCPriority DrawFlag VDCPutLineProgressClock VDCPutLine VDC WaveClockCounter PSGChannel PSGBaseClock PSGProgressClock WaveVolumeLeft WaveVolumeRight WaveLfoOn WaveLfoControl WaveLfoFreqency TimerBaseClock TimerReload TimerFlag TimerCounter TimerPrescaler INTTIQ JoystickSEL JoystickCLR Keybord GamePad GamePadSelect GamePadButtonSelect GamePadBuffer`.split(' ');
export function captureState(pce,session={}) {
  const state = Object.fromEntries(KEYS.map(key=>[key,structuredClone(pce[key])]));
  return {format:'bomberman-coop-save',version:STATE_VERSION,core:CORE_REVISION,rom:ROM_SHA256,createdAt:new Date().toISOString(),session:structuredClone(session),state,screen:{width:pce.MainCanvas.width,height:pce.MainCanvas.height,pixels:Array.from(pce.ImageData.data)}};
}
function validateShape(value,template,depth=0) {
  if(depth>10) throw new Error('Save data is too deeply nested.');
  if(typeof template==='number') {if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>0xffffffff) throw new Error('Save contains invalid numbers.');return;}
  if(typeof template==='boolean') {if(typeof value!=='boolean') throw new Error('Save contains invalid flags.');return;}
  if(Array.isArray(template)) {
    if(!Array.isArray(value)||value.length!==template.length) throw new Error('Save memory size is incompatible.');
    for(let i=0;i<template.length;i++) if(template[i]!==undefined) validateShape(value[i],template[i],depth+1);
    return;
  }
  if(template&&typeof template==='object') {
    if(!value||Array.isArray(value)||typeof value!=='object') throw new Error('Save contains invalid emulator data.');
    for(const key of Object.keys(template)) validateShape(value[key],template[key],depth+1);
    for(const [key,v] of Object.entries(value)) if(!Object.hasOwn(template,key)) {
      if(key!=='palette'||typeof v!=='number'||!Number.isFinite(v)) throw new Error('Save contains unknown emulator fields.');
    }
  }
}
export function validateState(pce,save) {
  if(save?.format!=='bomberman-coop-save'||save.version!==STATE_VERSION||save.core!==CORE_REVISION||save.rom!==ROM_SHA256) throw new Error('This save is incompatible with the current game revision.');
  if(!save.state||!save.screen||!save.session) throw new Error('Save is missing required data.');
  for(const key of KEYS) validateShape(save.state[key],pce[key]);
  const s=save.state;
  if(!Number.isInteger(s.PC)||s.PC<0||s.PC>65535) throw new Error('Invalid CPU address in save.');
  // The pinned core preserves both bytes of each VCE word. Native stage-card
  // loads can set unused upper bits; retain them for exact transition replay.
  if(s.RAM.some(v=>!Number.isInteger(v)||v<0||v>255)||s.Palette.some(v=>!Number.isInteger(v)||v<0||v>65535)) throw new Error('Invalid game memory in save.');
  if(![2,3,4].includes(s.VCEBaseClock)||![3,12].includes(s.CPUBaseClock)||s.TimerBaseClock!==3||s.PSGBaseClock!==6||s.TimerPrescaler<0||s.TimerPrescaler>=3072||s.PSGProgressClock<0||s.PSGProgressClock>=6||s.RAMMask!==8191||s.MPR.some(v=>!Number.isInteger(v)||v<0||v>0x1fe000||(v&8191)!==0)) throw new Error('Invalid hardware configuration in save.');
  if(!Number.isInteger(s.VDCPutLine)||s.VDCPutLine<0||s.VDCPutLine>=262||s.VDCPutLineProgressClock<0||s.VDCPutLineProgressClock>=1368) throw new Error('Invalid video timing in save.');
  for(const v of s.VDC) if(v.VDCProgressClock<0||v.VDCProgressClock>=1368||v.DrawLineWidth<1||v.DrawLineWidth>684||v.ScreenWidth<1||v.ScreenWidth>684||v.ScreenSize<1||v.ScreenSize>684||v.VRAM.some(w=>!Number.isInteger(w)||w<0||w>65535)||v.SPLine.some(dot=>!Number.isInteger(dot.data)||dot.data<0||dot.data>15||(dot.palette!==undefined&&(!Number.isInteger(dot.palette)||dot.palette<0||dot.palette>575)))) throw new Error('Invalid video configuration in save.');
  const screen=save.screen;
  if(![320,428,640,684].includes(screen.width)||screen.height!==262||!Array.isArray(screen.pixels)||screen.pixels.length!==684*262*4||screen.pixels.some(v=>!Number.isInteger(v)||v<0||v>255)) throw new Error('Invalid saved screen.');
  if(save.session.color!==undefined&&!Object.hasOwn(COLORS,save.session.color)) throw new Error('Invalid color in save.');
  if(save.session.frame!==undefined&&(!Number.isSafeInteger(save.session.frame)||save.session.frame<0)) throw new Error('Invalid frame count in save.');
  return save;
}
export function restoreState(pce,save) {
  validateState(pce,save); // All validation precedes mutation.
  for(const key of KEYS) pce[key]=structuredClone(save.state[key]);
  // Live browser objects, ROM mapping, hooks and current audio preferences stay attached.
  pce.WaveDataArray=[[],[]];
  const address=pce.VCEAddress;
  for(let i=0;i<512;i++){pce.VCEAddress=i;pce.ToPalettes();}
  pce.VCEAddress=address;
  pce.MainCanvas.width=save.screen.width;pce.MainCanvas.height=save.screen.height;
  pce.ImageData.data.set(save.screen.pixels);
  pce.Ctx.putImageData(pce.ImageData,0,0);
  return structuredClone(save.session);
}
export async function encodeSave(save) {
  const data=new Blob([JSON.stringify(save)],{type:'application/json'});
  if(typeof CompressionStream==='undefined') return data;
  return new Response(data.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
export async function decodeSave(file) {
  if(file.size>12*1024*1024) throw new Error('Save file is too large.');
  const data=new Uint8Array(await file.arrayBuffer());
  let blob=new Blob([data]);
  if(data[0]===31&&data[1]===139) {
    if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot open compressed saves.');
    const stream=blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const reader=stream.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw new Error('Save expands beyond the supported size.');}chunks.push(value);}
    blob=new Blob(chunks);
  }
  try{return JSON.parse(await blob.text());}catch{throw new Error('Save file is damaged or is not a Bomberman save.');}
}
const SAVE_KEY='bomberman-coop-quick-save-v1';
export function storeQuickSave(blob) {
  if(typeof indexedDB==='undefined'||!indexedDB) return Promise.reject(new Error('Browser save storage is unavailable. Export a save file instead.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('bomberman-coop',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('saves');
    request.onerror=()=>reject(new Error('Browser save storage is unavailable. Export a save file instead.'));
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(blob,SAVE_KEY);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(new Error('Could not store the save. Export a save file instead.'));};};
  });
}
export function readQuickSave() {
  if(typeof indexedDB==='undefined'||!indexedDB) return Promise.reject(new Error('Browser save storage is unavailable.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('bomberman-coop',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('saves');
    request.onerror=()=>reject(new Error('Browser save storage is unavailable.'));
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('saves','readonly'),get=tx.objectStore('saves').get(SAVE_KEY);get.onsuccess=()=>{db.close();resolve(get.result??null);};get.onerror=()=>{db.close();reject(new Error('Could not read the browser save.'));};};
  });
}
