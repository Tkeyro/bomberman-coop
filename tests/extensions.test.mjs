import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {COLORS,colorizePlayer,installColorSelector} from '../dist/session.js';
import {createCompanions,isCampaign,tileKind,enemies,spawnItem,spawnEnemy,validateCompanionState,ITEM_CATALOG} from '../dist/campaign.js';
import {createBattleAI,launchSequence,battlePosition,activeBattle,validateBattleState} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM,bytes=()=>fs.readFileSync(rom);
function campaign(p){for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);}
function advance(p,crew,n){for(let i=0;i<n;i++){crew.update();p.Run();}}
test('all nonwhite variants recolor arms, legs and helmet; only red gets green ends',()=>{
 const rgb={r:252,g:252,b:252};
 for(const color of Object.keys(COLORS)){if(color==='original')continue;
  assert.deepEqual(colorizePlayer(rgb,14,color),colorizePlayer(rgb,15,color));assert.deepEqual(colorizePlayer(rgb,11,color),colorizePlayer(rgb,8,color));assert.deepEqual(colorizePlayer(rgb,13,color),colorizePlayer(rgb,10,color));
  assert.deepEqual(colorizePlayer(rgb,5,color),color==='red'?{r:0,g:180,b:36}:colorizePlayer(rgb,15,color));assert.deepEqual(colorizePlayer(rgb,6,color),rgb);
 }
});
test('intro rear pose 792 is recolored without altering game palette or RAM',{skip:!rom},()=>{
 const p=createMachine(bytes());const selector=installColorSelector(p);selector.select('orange');for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,720);
 assert.equal(p.VDC[0].SATB[2],792);const ram=[...p.RAM],palette=[...p.Palette];selector.refresh();assert.deepEqual(p.RAM,ram);assert.deepEqual(p.Palette,palette);
 assert.ok(p.PaletteData[0x1ce].r>p.PaletteData[0x1ce].g);assert.deepEqual(p.PaletteData[0x1ce],p.PaletteData[0x1cf]);
});
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
  const p=createMachine(bytes()),ai=createBattleAI(p);ai.configure(count,true);for(const a of launchSequence('battle-ai',count))frames(p,a.frames,a.button?[[0,a.button]]:[]);assert.equal(activeBattle(p),true);assert.equal(p.RAM[0x4a],count);
  const human=battlePosition(p,0),before=Array.from({length:count-1},(_,i)=>battlePosition(p,i+1));let bombSeen=false;
  for(let n=0;n<400;n++){ai.update();p.Run();if(p.RAM.slice(0x84f,0x877).some(v=>v&128))bombSeen=true;}
  assert.deepEqual(battlePosition(p,0),human);assert.ok(before.some((pos,i)=>JSON.stringify(pos)!==JSON.stringify(battlePosition(p,i+1))));assert.ok(ai.state.bombsPlaced>0);assert.equal(bombSeen,true);
  const data=structuredClone(ai.state);data.plans[1].route=[{x:-10,y:1}];assert.throws(()=>validateBattleState(data),/Invalid/);
 }
});
