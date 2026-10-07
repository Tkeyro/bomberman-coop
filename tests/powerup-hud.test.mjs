import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,spawnItem,spawnBomb,playerPosition} from '../dist/campaign.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {createPowerupHUD,validatePowerupHUD,powerupIcon,createPowerupBadge} from '../dist/powerup-hud.js';
import {createNewCampaign} from '../dist/new-campaign.js';
import {COLORS,installColorSelector} from '../dist/session.js';

const rom=process.env.BOMBERMAN_TEST_ROM;
function setup({keepMonsters=false}={}){
 const p=createMachine(fs.readFileSync(rom));let human=true;
 const colors=installColorSelector(p),crew=createCompanions(p),hud=createPowerupHUD(p,{getHuman:()=>human?playerPosition(p):null});hud.configure(true);
 for(const step of launchSequence('solo'))frames(p,step.frames,step.button?[[0,step.button]]:[]);frames(p,2520);
 if(!keepMonsters)for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 return {p,colors,crew,hud,setHuman:enabled=>{human=enabled;},save:captureState(p),tracker:{...p._campaignTracker}};
}
test('power-up HUD rejects invalid saves and legacy saves start with zero totals',()=>{
 const p=createMachine(new Uint8Array(262144)),hud=createPowerupHUD(p);hud.configure(true);hud.state.counts[0]=4;hud.state.tick=280;
 const saved=structuredClone(hud.state);validatePowerupHUD(saved);hud.configure(false);hud.restore(saved);assert.deepEqual(hud.state,saved);
 for(const bad of [{...saved,unknown:true},{...saved,tick:3600},{...saved,enabled:1},{...saved,counts:Array(14).fill(0)},{...saved,counts:[-1,...Array(14).fill(0)]},{...saved,counts:[1000001,...Array(14).fill(0)]}])assert.throws(()=>validatePowerupHUD(bad),/power-up HUD/);
 hud.restore(undefined);assert.equal(hud.state.enabled,true);assert.deepEqual(hud.state.counts,Array(15).fill(0));assert.equal(hud.state.tick,0);
});
test('human native pickups count each type and repeats; burned, bot and spectator items do not',{skip:!rom},()=>{
 const {p,crew,hud,setHuman,save,tracker}=setup(),reset=()=>{restoreState(p,save);Object.assign(p._campaignTracker,tracker);crew.reset();};
 for(let type=0;type<15;type++){
  reset();const item=spawnItem(p,type,3,1);frames(p,8);const before=structuredClone(hud.state.counts),icon=powerupIcon(p,type),v=p.VDC[0];
  assert.equal(icon.data.length,1024);assert.ok(icon.data.some((value,index)=>index%4!==3&&value>0));
  // The icon decoder must agree with the native redraw's four actual tiles.
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
   const ref=v.VRAM[(2+(y>>3))*v.VScreenWidth+6+(x>>3)],address=((ref&4095)<<4)+(y&7),bit=7-(x&7),a=v.VRAM[address],b=v.VRAM[address+8],dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3),rgb=p.PaletteData[((ref&0xf000)>>8)+dot],i=(y*16+x)*4;
   assert.deepEqual(Array.from(icon.data.slice(i,i+3)),[rgb.r,rgb.g,rgb.b]);
  }
  p.RAM[0x43d]=56;p.RAM[0x43f]=24;frames(p,2);assert.equal(p.RAM[0xf9b+item],0);before[type]++;assert.deepEqual(hud.state.counts,before);
 }
 reset();spawnItem(p,0,3,1);p.RAM[0x43d]=56;frames(p,2);assert.equal(hud.state.counts[0],2,'a repeated capped fire upgrade still counts as a collected item');
 reset();const burned=spawnItem(p,1,3,1);spawnBomb(p,4,1,{automatic:true});frames(p,210);assert.equal(p.RAM[0xf9b+burned],0);assert.equal(hud.state.counts[1],1,'burned items never count');
 reset();const bot=crew.add(3,1),item=spawnItem(p,1,3,1);crew.update();assert.equal(p.RAM[0xf9b+item],0);assert.equal(bot.pickupsCollected,1);assert.equal(hud.state.counts[1],1,'the bot has its own inventory');
 reset();setHuman(false);const hidden=spawnItem(p,0,3,1);p.RAM[0x43d]=56;frames(p,2);assert.equal(p.RAM[0xf9b+hidden],0);assert.equal(hud.state.counts[0],2,'a disabled primary human cannot count in a watched game');
});
test('compact HUD preserves border, SC and world item pixels, pages exact totals and replays saves',{skip:!rom},()=>{
 const {p,hud}=setup();spawnItem(p,1,3,1);frames(p,8);const save=captureState(p),tracker={...p._campaignTracker};hud.state.counts=Array.from({length:15},(_,i)=>i===0?1000000:i+1);hud.state.tick=0;
 const totals=structuredClone(hud.state);frames(p,1);const shown=Uint8ClampedArray.from(p.ImageData.data),expectedRAM=[...p.RAM],expectedVRAM=[...p.VDC[0].VRAM],expectedPalette=[...p.Palette];
 restoreState(p,save);Object.assign(p._campaignTracker,tracker);hud.configure(false);frames(p,1);
 assert.deepEqual(p.RAM,expectedRAM);assert.deepEqual(p.VDC[0].VRAM,expectedVRAM);assert.deepEqual(p.Palette,expectedPalette);
 let changes=0;for(let i=0;i<shown.length;i+=4)if([0,1,2].some(channel=>shown[i+channel]!==p.ImageData.data[i+channel])){
  const x=(i/4)%684,y=Math.floor(i/4/684);assert.ok(x>=48&&x<280&&y>=26&&y<48,`changed outside header interior: ${x},${y}`);changes++;
 }
 assert.ok(changes>100);
 assert.ok(p.RAM.slice(0xf9b,0xfb4).some(flag=>flag&128),'the unchanged arena comparison includes a live full-size item');
 restoreState(p,save);Object.assign(p._campaignTracker,tracker);hud.restore({...totals,tick:240});frames(p,1);assert.notDeepEqual(p.ImageData.data,shown,'later pages show further acquired powers');
 const machine=captureState(p),savedHUD=structuredClone(hud.state),savedTracker={...p._campaignTracker},advance=n=>{for(let i=0;i<n;i++){hud.update();p.Run();}};
 advance(30);const replay={pixels:Uint8ClampedArray.from(p.ImageData.data),ram:[...p.RAM],hud:structuredClone(hud.state)};
 restoreState(p,machine);Object.assign(p._campaignTracker,savedTracker);hud.restore(savedHUD);advance(30);assert.deepEqual(p.ImageData.data,replay.pixels);assert.deepEqual(p.RAM,replay.ram);assert.deepEqual(hud.state,replay.hud);
});
test('all fifteen one-digit collected totals fit without paging and moved lives art keeps every selected palette',{skip:!rom},()=>{
 const {p,hud,colors,save,tracker}=setup(),reset=()=>{restoreState(p,save);Object.assign(p._campaignTracker,tracker);};
 hud.state.counts.fill(1);hud.state.tick=0;frames(p,1);const first=Uint8ClampedArray.from(p.ImageData.data);reset();hud.state.tick=240;frames(p,1);assert.deepEqual(p.ImageData.data,first,'all fifteen compact icons and totals fit at once');
 for(const color of Object.keys(COLORS)){
  reset();colors.select(color);hud.configure(false);frames(p,1);const native=Uint8ClampedArray.from(p.ImageData.data);
  reset();colors.select(color);hud.configure(true);frames(p,1);
  for(let y=26;y<48;y++)for(let x=0;x<24;x++){
   const source=(y*684+168+x)*4,destination=(y*684+112+x)*4;
   assert.deepEqual(Array.from(p.ImageData.data.slice(destination,destination+4)),Array.from(native.slice(source,source+4)),`moved native lives head/count preserve ${color} at ${x},${y}`);
  }
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   const source=((33+y)*684+112+x)*4,destination=((27+y)*684+52+x)*4;
   assert.deepEqual(Array.from(p.ImageData.data.slice(destination,destination+4)),Array.from(native.slice(source,source+4)),'the visible score digit is left aligned after SC');
  }
  for(let y=0;y<8;y++)for(let x=0;x<32;x++){
   const source=((33+y)*684+136+x)*4,destination=((38+y)*684+64+x)*4;
   assert.deepEqual(Array.from(p.ImageData.data.slice(destination,destination+4)),Array.from(native.slice(source,source+4)),'moved timer keeps the exact native digit/colon art');
  }
  for(let y=0;y<12;y++)for(let x=0;x<8;x++){
   const source=((25+y*2)*684+120+x*2)*4,destination=((35+y)*684+52+x)*4;
   assert.deepEqual(Array.from(p.ImageData.data.slice(destination,destination+4)),Array.from(native.slice(source,source+4)),'small clock samples the native clock with equal scaling');
  }
 }
});
test('NEW campaign keeps the primary human pickup totals while native stage art is rebuilt',{skip:!rom},()=>{
 const {p,hud}=setup({keepMonsters:true}),mode=createNewCampaign(p);mode.configure(true,1,24681);mode.update();
 const slot=spawnItem(p,2,2,1);frames(p,2);assert.equal(p.RAM[0xf9b+slot],0);assert.equal(hud.state.counts[2],1);assert.ok(p.RAM[0x43a]&16,'the native human receives remote control');
 const before=structuredClone(hud.state.counts);mode.configure(false);assert.deepEqual(hud.state.counts,before,'native mode changes alone do not erase collection history');
});
test('power-up badge exposes the loaded native icon and exact accessible item count',()=>{
 const p=createMachine(new Uint8Array(262144));let drawn;
 const document={createElement(tag){return {tag,children:[],setAttribute(){},append(...children){this.children.push(...children);},getContext(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(image){drawn=image;}};}};}};
 const badge=createPowerupBadge(p,3,57,{document});assert.equal(badge.className,'powerup-badge');assert.equal(badge.children[0].width,16);assert.equal(badge.children[1].textContent,'Roller shoes ×57');assert.equal(drawn.data.length,1024);assert.throws(()=>powerupIcon(p,15),/Unknown/);
});
