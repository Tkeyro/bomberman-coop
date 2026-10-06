import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {COLORS,colorizePlayer,installColorSelector} from '../dist/session.js';
import {createCompanions,isCampaign,tileKind,enemies,spawnItem,spawnEnemy,validateCompanionState,ITEM_CATALOG,DEATH_FRAMES} from '../dist/campaign.js';
import {createBattleAI,launchSequence,battlePosition,activeBattle,validateBattleState} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM,bytes=()=>fs.readFileSync(rom);
function campaign(p){for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);}
function advance(p,crew,n){for(let i=0;i<n;i++){crew.update();p.Run();}}
test('colored helmets and bodies match, limbs use face skin, and pink ends/white stay native',()=>{
 const rgb={r:252,g:252,b:252},pink={r:252,g:72,b:252},skin={r:252,g:144,b:0};
 for(const color of Object.keys(COLORS)){if(color==='original')continue;
  assert.deepEqual(colorizePlayer(rgb,3,color),colorizePlayer(rgb,15,color));assert.deepEqual(colorizePlayer(rgb,4,color),colorizePlayer(rgb,8,color));assert.deepEqual(colorizePlayer(rgb,2,color),colorizePlayer(rgb,9,color));
  assert.deepEqual(colorizePlayer(rgb,14,color),skin);assert.deepEqual(colorizePlayer(rgb,11,color),{r:217,g:124,b:0});assert.deepEqual(colorizePlayer(rgb,13,color),{r:144,g:82,b:0});
  assert.deepEqual(colorizePlayer(pink,5,color),pink);assert.deepEqual(colorizePlayer(rgb,6,color),rgb);
  assert.deepEqual(colorizePlayer(skin,7,color),skin);
 }
 for(let index=0;index<16;index++)assert.deepEqual(colorizePlayer(pink,index,'original'),pink);
});
test('intro rear pose 792 is recolored without altering game palette or RAM',{skip:!rom},()=>{
 const p=createMachine(bytes());const selector=installColorSelector(p);selector.select('orange');for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,720);
 assert.equal(p.VDC[0].SATB[2],792);const ram=[...p.RAM],palette=[...p.Palette];selector.refresh();assert.deepEqual(p.RAM,ram);assert.deepEqual(p.Palette,palette);
 assert.ok(p.PaletteData[0x1cf].r>p.PaletteData[0x1cf].g);
 for(const color of Object.keys(COLORS)){selector.select(color);for(const index of [5,6,7]){const raw=p.Palette[0x1c0+index];assert.deepEqual(p.PaletteData[0x1c0+index],{r:((raw>>3)&7)*36,g:((raw>>6)&7)*36,b:(raw&7)*36});}if(color!=='original')assert.deepEqual(p.PaletteData[0x1ce],p.PaletteData[0x1c7]);}
});
test('defeated AI plays every native death pose, stays still, then disappears; saves replay mid-animation',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});campaign(p);const bot=crew.add(4,1);bot.color='original';
 const human=playerPositionForTest(p),beforeBombs=bot.bombsPlaced;
 // Native damaging tile kills the extension actor without harming the human.
 p.RAM[0x44a+32+4]=(p.RAM[0x44a+32+4]&224)|11;crew.update();assert.equal(bot.alive,false);assert.equal(bot.deathFrame,0);assert.equal(bot.target,null);assert.deepEqual(bot.route,[]);
 let collect=false,nativePixels=0,matches=0,different=0;const sprite=p.MakeSpriteLine;
 p.MakeSpriteLine=function(n){sprite.call(this,n);if(n!==0||!collect)return;const sp=this.VDC[0].SPLine;for(let x=0;x<48;x++){const a=sp[x],b=sp[x+32];if(a.no<2&&a.data){nativePixels++;if(b.no===64&&a.data===b.data)matches++;else different++;}}};
 // Trigger the native human's death as a pixel/timing reference.
 p.RAM[0x44a+32+2]=(p.RAM[0x44a+32+2]&224)|11;
 const position={x:bot.x,y:bot.y};
 for(let frame=0;frame<DEATH_FRAMES;frame++){
  if(frame)crew.update();nativePixels=matches=different=0;collect=frame%8===2;p.Run();collect=false;
  // Native SATB DMA takes a frame to display a newly selected pose.
  if(frame%8===2){assert.ok(nativePixels>20,`native phase ${Math.floor(frame/8)}`);assert.equal(matches,nativePixels,`matched phase ${Math.floor(frame/8)}`);assert.equal(different,0,`death pose ${Math.floor(frame/8)}`);}
  const current=crew.state.bots[0];assert.deepEqual({x:current.x,y:current.y},position);assert.equal(current.bombsPlaced,beforeBombs);
  if(frame===59){
   const state=structuredClone(crew.state),tracker={...p._campaignTracker},save=captureState(p);advance(p,crew,12);const expectedPixels=Uint8ClampedArray.from(p.ImageData.data),expectedBots=structuredClone(crew.state);restoreState(p,save);crew.restore(state);Object.assign(p._campaignTracker,tracker);advance(p,crew,12);assert.deepEqual(p.ImageData.data,expectedPixels);assert.deepEqual(crew.state,expectedBots);restoreState(p,save);crew.restore(state);Object.assign(p._campaignTracker,tracker);
  }
 }
 crew.update();assert.equal(crew.state.bots[0].deathFrame,DEATH_FRAMES);let visible=0;
 p.MakeSpriteLine=function(n){sprite.call(this,n);if(n===0)visible+=this.VDC[0].SPLine.filter(dot=>dot.data&&dot.no===64).length;};p.Run();assert.equal(visible,0);assert.deepEqual(playerPositionForTest(p),human);
 const broken=structuredClone(crew.state);broken.bots[0].deathFrame=-1;assert.throws(()=>validateCompanionState(broken),/death animation/);
 const legacy=structuredClone(crew.state);delete legacy.bots[0].deathFrame;crew.restore(legacy);assert.equal(crew.state.bots[0].deathFrame,DEATH_FRAMES,'older saves do not revive defeated actors');
});
function playerPositionForTest(p){return {x:p.RAM[0x43d]|p.RAM[0x43e]<<8,y:p.RAM[0x43f]|p.RAM[0x440]<<8};}
test('native items and living monster templates spawn, move and pick up',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});assert.throws(()=>crew.add(3,1),/active campaign/);campaign(p);assert.equal(isCampaign(p),true);assert.equal(enemies(p).length,3);
 const template=enemies(p)[0],slot=spawnEnemy(p,template.slot,3,1),x=p.RAM[0xdd8+slot];frames(p,30);assert.notEqual(p.RAM[0xdd8+slot],x);assert.equal(p.RAM[0xeb8+slot],2);
 // Separate fixture: fire-up picked up by the original player routine.
 const q=createMachine(bytes());createCompanions(q,{colorize:colorizePlayer});campaign(q);const item=spawnItem(q,0,3,1);frames(q,24,[[0,'RIGHT']]);assert.equal(q.RAM[0xf9b+item],0);assert.equal(q.RAM[0x84d]&127,2);
 const r=createMachine(bytes());createCompanions(r,{colorize:colorizePlayer});campaign(r);const floor=[];for(let y=1;y<12;y++)for(let x=2;x<15;x++)if(tileKind(r,x,y)===10&&(x!==2||y!==1))floor.push({x,y});
 const existing=r.RAM.slice(0xf9b,0xfb4).filter(v=>v&128).length;assert.ok(floor.length>=ITEM_CATALOG.length);for(const [i,item]of ITEM_CATALOG.entries())spawnItem(r,item.type,floor[i].x,floor[i].y);frames(r,8);assert.equal(r.RAM.slice(0xf9b,0xfb4).filter(v=>v&128).length,existing+15);
});
test('campaign AI clears blocks, kills native enemies and replays exactly after saving',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});campaign(p);const human=[p.RAM[0x43d],p.RAM[0x43f]],bot=crew.add(4,1);bot.color='red';advance(p,crew,1500);
 assert.ok(bot.bombsPlaced>=5);assert.equal(tileKind(p,5,1),10);assert.ok(enemies(p).length<3);assert.equal(bot.alive,true);assert.deepEqual([p.RAM[0x43d],p.RAM[0x43f]],human);assert.ok(bot.x!==72||bot.y!==24);
 const extension=structuredClone(crew.state),tracker={...p._campaignTracker},save=captureState(p,{frame:4336,color:'original'});advance(p,crew,300);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),bots:structuredClone(crew.state)};
 restoreState(p,save);crew.restore(extension);Object.assign(p._campaignTracker,tracker);advance(p,crew,300);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.bots);
 const broken=structuredClone(extension);broken.bots[0].direction=99;assert.throws(()=>validateCompanionState(broken),/Invalid/);
});
test('AI reaches an exposed blue exit and requests original shared stage clear',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});campaign(p);const bot=crew.add(3,1);
 // Fixture representing a cleared stage: no living enemies and visible exit.
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;p.RAM[0x44a+32+4]=(p.RAM[0x44a+32+4]&224)|8;
 for(let n=0;n<100&&!p.RAM[0x437];n++){crew.update();p.Run();}assert.equal(p.RAM[0x437],1);assert.ok(crew.state.events.some(e=>e.text.includes('exit')));assert.equal(bot.x,72);
});
test('original Battle boots 2–5 actors; AI independently moves and places native bombs',{skip:!rom},()=>{
 for(const count of [2,5]){
  const p=createMachine(bytes()),ai=createBattleAI(p),colors=installColorSelector(p),variants=['black','original','orange','yellow','red'];colors.select('black');colors.setBattleColors(variants.slice(0,count));ai.configure(count,true);for(const a of launchSequence('battle-ai',count))frames(p,a.frames,a.button?[[0,a.button]]:[]);assert.equal(activeBattle(p),true);assert.equal(p.RAM[0x4a],count);colors.refresh();
  for(let port=0;port<count;port++){const base=0x100+port*16;if(variants[port]==='original'){assert.deepEqual(p.PaletteData[base+14],{r:252,g:252,b:252});}else{assert.deepEqual(p.PaletteData[base+14],p.PaletteData[0x107]);assert.deepEqual(p.PaletteData[base+3],p.PaletteData[base+15]);}assert.deepEqual(p.PaletteData[base+5],p.PaletteData[0x105]);}
  const human=battlePosition(p,0),before=Array.from({length:count-1},(_,i)=>battlePosition(p,i+1));let bombSeen=false;
  for(let n=0;n<400;n++){ai.update();p.Run();if(p.RAM.slice(0x84f,0x877).some(v=>v&128))bombSeen=true;}
  assert.deepEqual(battlePosition(p,0),human);assert.ok(before.some((pos,i)=>JSON.stringify(pos)!==JSON.stringify(battlePosition(p,i+1))));assert.ok(ai.state.bombsPlaced>0);assert.equal(bombSeen,true);
  const data=structuredClone(ai.state);data.plans[1].route=[{x:-10,y:1}];assert.throws(()=>validateBattleState(data),/Invalid/);
 }
});

test('spawned AI remains solid while the native player blinks and cannot cross blocked feet tiles',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});campaign(p);const bot=crew.add(4,1);bot.color='original';
 // Collect the original vest at the human's feet to exercise native blinking.
 spawnItem(p,6,2,1);let hiddenHuman=0,solidBot=0;const draw=p.MakeSpriteLine;
 p.MakeSpriteLine=function(n){draw.call(this,n);if(n!==0)return;const sp=this.VDC[0].SPLine;if(sp.some(dot=>dot.data&&dot.no<2&&dot.palette!==448)){if(sp.some(dot=>dot.data&&dot.no===64))hiddenHuman++;}if(sp.some(dot=>dot.data&&dot.no===64))solidBot++;};
 frames(p,45);assert.ok(hiddenHuman>0,'AI must render during native player blinking');assert.ok(solidBot>100);assert.equal(isCampaign(p),true);assert.ok(p.ImageData.data.every((v,i)=>i%4!==3||v===255),'rendered sprites remain opaque');
 bot.color='black';frames(p,1);assert.deepEqual(p.PaletteData[515],{r:56,g:56,b:64});assert.deepEqual(p.PaletteData[527],p.PaletteData[515]);assert.deepEqual(p.PaletteData[526],{r:252,g:144,b:0});assert.deepEqual(p.PaletteData[517],{r:252,g:0,b:180});bot.color='original';
 // Reuse this actor with a stale diagonal destination across a solid block.
 bot.x=56;bot.y=24;bot.target={x:4,y:2};bot.cooldown=1000;const solid=0x44a+32+4,goal=0x44a+64+4;p.RAM[solid]=(p.RAM[solid]&224)|2;p.RAM[goal]=(p.RAM[goal]&224)|10;
 for(let n=0;n<20;n++){crew.update();p.Run();assert.ok(bot.x+5<64,'feet must stop before the block');assert.equal(tileKind(p,4,1),2);}
});
test('spawned vest activates on pickup, blocks flame damage and retains native enemy damage',{skip:!rom},()=>{
 const p=createMachine(bytes());createCompanions(p,{colorize:colorizePlayer});campaign(p);const baseline=captureState(p);const slot=spawnItem(p,6,2,1);frames(p,4);
 assert.equal(p.RAM[0xf9b+slot],0);assert.ok(p.RAM[0x43a]&128);assert.ok((p.RAM[0x446]|p.RAM[0x447]<<8)>3500);
 const protectedState=captureState(p),tracker={...p._campaignTracker};
 // Native damaging flame tile under the stationary primary character.
 p.RAM[0x44a+32+2]=(p.RAM[0x44a+32+2]&224)|11;frames(p,2);assert.equal(p.RAM[0x43a]&7,0);
 restoreState(p,baseline);Object.assign(p._campaignTracker,tracker);p.RAM[0x44a+32+2]=(p.RAM[0x44a+32+2]&224)|11;frames(p,2);assert.notEqual(p.RAM[0x43a]&7,0,'unprotected player takes flame damage');
 restoreState(p,protectedState);Object.assign(p._campaignTracker,tracker);const enemy=enemies(p)[0];spawnEnemy(p,enemy.slot,2,1);frames(p,2);assert.notEqual(p.RAM[0x43a]&7,0,'original vest does not grant enemy immunity');
});
test('all AI animation poses match the native sprite pixels at their world positions',{skip:!rom},()=>{
 const p=createMachine(bytes()),crew=createCompanions(p,{colorize:colorizePlayer});campaign(p);const bot=crew.add(4,1);bot.color='original';bot.target={x:5,y:1};
 const cpu=p.CPURun,sprite=p.MakeSpriteLine;let direction=0,phase=0,collect=false,matched=0,different=0;
 p.CPURun=function(){if(this.PC===0x8c53&&this.MPR[4]===9*8192){this.RAM[0x43b]=direction;this.RAM[0x43c]=phase;}return cpu.call(this);};
 p.MakeSpriteLine=function(n){sprite.call(this,n);if(n!==0||!collect)return;const sp=this.VDC[0].SPLine;for(let x=0;x<48;x++){const native=sp[x],ai=sp[x+32];if(native.data&&native.no<2){if(ai.no===64&&native.data===ai.data)matched++;else different++;}}};
 for(direction=0;direction<4;direction++)for(phase=0;phase<4;phase++){bot.direction=direction;bot.animation=phase*8;frames(p,2);matched=0;different=0;collect=true;frames(p,1);collect=false;assert.ok(matched>200);assert.equal(different,0,`direction ${direction}, phase ${phase}`);}
});
