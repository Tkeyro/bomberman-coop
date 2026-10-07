import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,spawnBomb,spawnEnemy,tileKind,enemies,monsterBombingCells,blastCells} from '../dist/campaign.js';import {createNewCampaign} from '../dist/new-campaign.js';import {createIntroSkip} from '../dist/intro.js';import {launchSequence} from '../dist/battle-ai.js';import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function setup(){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null}),mode=createNewCampaign(p),intro=createIntroSkip(p);
 for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 mode.configure(true,1,12345);mode.update();for(let i=0;i<25;i++)p.RAM[0xf9b+i]=0;p.RAM[0x43d]=p.RAM[0x43e]=p.RAM[0x43f]=p.RAM[0x440]=0;return {p,crew,mode};
}
test('bombing positions respect range, pillars and the observed patrol corridor',()=>{
 const p={RAM:Array(8192).fill(1)};p.RAM[0x434]=15;p.RAM[0x435]=12;for(let x=2;x<=8;x++){p.RAM[0x44a+3*32+x]=10;p.RAM[0x44a+5*32+x]=10;}p.RAM[0x44a+4*32+8]=10;
 const foe={slot:0,x:104,y:88},direct=monsterBombingCells(p,[foe],1),patrol=monsterBombingCells(p,[foe],1,[{slot:0,vx:.5,vy:0}]);
 assert.equal(direct.has('6,3'),false,'a nearby position above the pillar cannot hit the monster');assert.equal(direct.has('8,4'),false,'range one cannot hit a monster two columns away');assert.equal(patrol.has('8,4'),true,'the corridor opening can intercept the pacing monster');assert.equal(patrol.has('6,3'),false,'patrol prediction also respects the pillar');
 for(const cell of direct){const [x,y]=cell.split(',').map(Number);assert.ok(blastCells(p,x,y,1).has('6,5'));}
});
test('every AI bomb bank explodes in all four directions, including old saves and fading flame centers',{skip:!rom},()=>{
 const {p,crew,mode}=setup();for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;for(let y=1;y<21;y++)for(let x=2;x<27;x++)p.RAM[0x44a+y*32+x]=0xca;
 p.RAM[0x43a]|=16;const baseline=captureState(p),tracker={...p._campaignTracker},generator=structuredClone(mode.state);
 for(const slot of [20,25,30,35])for(const legacy of [false,true]){
  restoreState(p,baseline);Object.assign(p._campaignTracker,tracker);mode.restore(generator);
  const bomb=spawnBomb(p,10,10,{slots:[slot],automatic:true});if(legacy)p.RAM[0x84f+bomb]|=64;crew.state.bombRanges[bomb]=3;frames(p,3);assert.equal(p.RAM[0x8ef+bomb],147,'the human remote power does not hold an AI fuse');p.RAM[0x8ef+bomb]=1;frames(p,8);
  for(const [dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]])for(let d=1;d<=3;d++)assert.equal(tileKind(p,10+dx*d,10+dy*d),11,`bank ${slot}, legacy ${legacy}, direction ${dx}/${dy}, distance ${d}`);
 }
 restoreState(p,baseline);Object.assign(p._campaignTracker,tracker);mode.restore(generator);
 const first=spawnBomb(p,10,9,{slots:[20],automatic:true});crew.state.bombRanges[first]=1;p.RAM[0x8ef+first]=1;frames(p,8);assert.equal(tileKind(p,10,9),12);
 const second=spawnBomb(p,10,11,{slots:[25],automatic:true});crew.state.bombRanges[second]=5;p.RAM[0x84f+second]|=64;p.RAM[0x8ef+second]=1;frames(p,8);assert.equal(tileKind(p,10,7),11,'the upward blast crosses the earlier fading center');
});
test('a range-one bot approaches the opening and kills a monster pacing behind a pillar',{skip:!rom},()=>{
 const {p,crew}=setup(),template=enemies(p)[0].slot;for(let y=1;y<21;y++)for(let x=2;x<27;x++)p.RAM[0x44a+y*32+x]=1;
 for(let x=2;x<=8;x++){p.RAM[0x44a+3*32+x]=0xca;p.RAM[0x44a+5*32+x]=0xca;}p.RAM[0x44a+4*32+8]=0xca;p.RAM[0x44a+2*32+8]=0xca;
 const slot=spawnEnemy(p,template,6,5);for(let i=0;i<32;i++)if(i!==slot)p.RAM[0xd98+i]=0;const bot=crew.add(6,3);let placedAt=null;
 for(let frame=0;frame<900&&enemies(p).length&&bot.alive;frame++){
  // Keep this native monster pacing horizontally, as in the reported corridor.
  const phase=frame%384,x=phase<192?40+phase*.5:136-(phase-192)*.5;p.RAM[0xdd8+slot]=Math.round(x);p.RAM[0xdb8+slot]=0;p.RAM[0xe18+slot]=88;p.RAM[0xdf8+slot]=0;
  crew.update();if(!placedAt&&bot.bombsPlaced){const active=Array.from({length:5},(_,i)=>20+i).find(i=>p.RAM[0x84f+i]&128);placedAt={x:p.RAM[0x877+active],y:p.RAM[0x89f+active]};}p.Run();
 }
 assert.ok(placedAt,'the bot finds a bombing position');assert.equal(placedAt.x,8);assert.ok(placedAt.y>=4,'the bot approaches the opening instead of bombing above the pillar');assert.equal(enemies(p).length,0,'the native explosion kills the corridor monster');assert.equal(bot.alive,true,'the bot escapes its own bomb and the monster');
});
