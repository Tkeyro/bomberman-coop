import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {launchSequence} from '../dist/battle-ai.js';
import {enemies,spawnEnemyType,spawnBomb} from '../dist/campaign.js';
import {createEnemySpawns} from '../dist/enemy-spawns.js';
import {enemyCatalog} from '../dist/enemy-icons.js';
import {createBossSpawns,spawnBossType,validateBossSpawns} from '../dist/boss-spawns.js';
import {createNewCampaign} from '../dist/new-campaign.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;let fixture;
function arena(){
 if(!fixture){
  const p=createMachine(fs.readFileSync(rom)),sprites=createEnemySpawns(p),bosses=createBossSpawns(p);
  for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);frames(p,2520);
  fixture={p,sprites,bosses,save:captureState(p),tracker:{...p._campaignTracker}};
 }
 const {p,sprites,bosses,save,tracker}=fixture;restoreState(p,save);Object.assign(p._campaignTracker,tracker);sprites.reset();bosses.reset();
 for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 return fixture;
}
function chamber(p){
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xc1;
 for(const [x,y]of [[2,1],[5,5],[6,5]])p.RAM[0x44a+y*32+x]=0xca;
 p.RAM[0x84d]=3;
}
test('every boss model can spawn, move, render and take three native explosions in an ordinary map',{skip:!rom},()=>{
 for(let type=23;type<45;type++){
  let {p,sprites,bosses}=arena();p.RAM[0xd96]=1;
  const originalWorld=[p.RAM[0x84a],p.RAM[0x84b]],slot=spawnBossType(p,type,6,5),positions=new Set();
  assert.equal(p.RAM[0xd96],0,'a boss re-locks an already unlocked exit');
  for(let frame=0;frame<24;frame++){p.Run();positions.add(`${p.RAM[0xdd8+slot]},${p.RAM[0xe18+slot]}`);}
  assert.ok(positions.size>3,`boss ${type} moves rather than invoking an arena-only script`);
  assert.ok(sprites.state.owners.some(owner=>owner?.type===type),`boss ${type} uses its native original model`);
  assert.deepEqual([p.RAM[0x84a],p.RAM[0x84b]],originalWorld);assert.equal(p.RAM[0x43a]&7,0);
  ({p,bosses}=arena());chamber(p);const target=spawnBossType(p,type,6,5);
  for(let hit=1;hit<=3;hit++){
   assert.equal(spawnBomb(p,5,5),0);
   p.RAM[0x8ef]=1;
   const actor=bosses.state.actors.find(a=>a.slot===target);
   for(let frame=0;frame<190&&actor.hp===4-hit;frame++)p.Run();
   assert.equal(actor.hp,3-hit,`boss ${type} health after native explosion ${hit}`);
   if(hit<3){assert.ok(p.RAM[0xd98+target]&128,'a surviving boss stays alive');frames(p,100);assert.equal(actor.hp,3-hit,'one continuous explosion cannot consume a second hit');}
  }
  assert.equal(p.RAM[0xd98+target],1,`boss ${type} begins the native defeat animation`);
  for(let frame=0;frame<600&&p.RAM[0xd98+target];frame++)p.Run();
  assert.equal(p.RAM[0xd98+target],0,`boss ${type} finishes the native defeat animation`);assert.equal(bosses.state.actors.length,0,'native removal retires the boss');
 }
});

test('multiple portable bosses share a map with ordinary monsters and retain independent health',{skip:!rom},()=>{
 const {p,bosses,sprites}=arena();const slots=[spawnBossType(p,23,6,5),spawnBossType(p,27,10,5),spawnEnemyType(p,4,8,7)];
 const alive=enemies(p);assert.deepEqual(alive.map(a=>a.type),[23,27,4]);assert.equal(new Set(slots).size,3);frames(p,10);
 assert.equal(bosses.state.actors.length,2);assert.deepEqual(bosses.state.actors.map(a=>a.hp),[3,3]);assert.equal(p.RAM[0xd96],0);
 for(const type of [23,27,4])assert.ok(sprites.state.owners.some(owner=>owner?.type===type));
 assert.equal(enemyCatalog(p).filter(e=>e.available).length,45);
 const first=bosses.state.actors[0],second=bosses.state.actors[1],cpu=p.CPURun;
 // Enter the precise original flame-hit instruction, keeping the native
 // opcode's write and CPU flags in the actual emulator.
 p.PC=0x9cd6;p.MPR[4]=9*8192;p.X=first.slot;cpu.call(p);
 assert.equal(first.hp,2);assert.equal(second.hp,3);assert.equal(p.RAM[0xd98+first.slot],128);
});

test('portable boss saves replay on a fresh machine and reject malformed state before applying it',{skip:!rom},()=>{
 const {p,bosses,sprites}=arena();spawnBossType(p,31,6,5);spawnBossType(p,44,10,7);frames(p,11);
 bosses.state.actors[0].hp=2;bosses.state.actors[0].cooldown=49;
 const save=captureState(p),bossState=structuredClone(bosses.state),spriteState=structuredClone(sprites.state),tracker={...p._campaignTracker};
 frames(p,20);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),bosses:structuredClone(bosses.state),sprites:structuredClone(sprites.state),pc:p.PC};
 const fresh=createMachine(fs.readFileSync(rom)),freshSprites=createEnemySpawns(fresh),freshBosses=createBossSpawns(fresh);restoreState(fresh,save);freshSprites.restore(spriteState);freshBosses.restore(bossState);Object.assign(fresh._campaignTracker,tracker);frames(fresh,20);
 assert.deepEqual(fresh.RAM,expected.ram);assert.deepEqual(fresh.ImageData.data,expected.pixels);assert.deepEqual(freshBosses.state,expected.bosses);assert.deepEqual(freshSprites.state,expected.sprites);assert.equal(fresh.PC,expected.pc);
 const malformed=structuredClone(bossState);malformed.actors[0].slot=32;const before=structuredClone(freshBosses.state);assert.throws(()=>freshBosses.restore(malformed),/Invalid spawned boss/);assert.deepEqual(freshBosses.state,before);
 for(const corrupt of [{...bossState,unexpected:1},{...bossState,actors:[...bossState.actors,bossState.actors[0]]},{...bossState,actors:[{...bossState.actors[0],hp:4}]}])assert.throws(()=>validateBossSpawns(corrupt),/Invalid spawned boss/);
});

test('boss placement uses existing floor and slot checks without damaging a rejected game',{skip:!rom},()=>{
 const {p,bosses}=arena(),before=[...p.RAM];
 for(const type of [-1,22,45,2.5,NaN]){assert.throws(()=>spawnBossType(p,type,6,5),/boss model/);assert.deepEqual(p.RAM,before);}
 p.RAM[0x44a+5*32+6]=0xc1;let snapshot=[...p.RAM];assert.throws(()=>spawnBossType(p,23,6,5),/empty floor/);assert.deepEqual(p.RAM,snapshot);
 p.RAM[0x44a+5*32+6]=0xca;for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=128;snapshot=[...p.RAM];assert.throws(()=>spawnBossType(p,23,6,5),/slots are full/);assert.deepEqual(p.RAM,snapshot);assert.deepEqual(bosses.state.actors,[]);
});

test('direct map rebuilds retire boss registrations and natural boss actors keep their original scripts',{skip:!rom},()=>{
 const {p,bosses}=arena();const slot=spawnBossType(p,23,6,5);p.RAM[0xd98+slot]=0;p.Run();assert.equal(bosses.state.actors.length,0,'direct DLC floor/actor rebuilds are pruned before native execution');
 p.RAM[0xeb8+slot]=27;p.PC=0xa49c;p.MPR[5]=10*8192;
 assert.equal(p.Get(0x2eb8+slot),27,'an unregistered original boss keeps its original species/script lookup');
 const replacement=spawnEnemyType(p,2,6,5);assert.equal(replacement,slot);assert.equal(p.Get(0x2eb8+slot),2);
 spawnBossType(p,31,10,5);p.RAM[0x84b]=1;p.PC=0x83b0;p.MPR[4]=9*8192;p.CPURun();assert.equal(bosses.state.actors.length,0,'a native stage switch clears registrations');
});

test('bosses can be placed beyond the original bounds on a generated DLC map',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),sprites=createEnemySpawns(p),bosses=createBossSpawns(p),mode=createNewCampaign(p);
 for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);frames(p,2520);mode.configure(true,2,12345);mode.update();
 assert.ok(p.RAM[0x434]>=27&&p.RAM[0x435]>=21);const floors=[];
 for(let y=16;y<p.RAM[0x435];y++)for(let x=19;x<p.RAM[0x434];x++)if((p.RAM[0x44a+y*32+x]&31)===10)floors.push({x,y});assert.ok(floors.length>=3);
 const models=[23,30,44],slots=models.map((type,index)=>spawnBossType(p,type,floors[index].x,floors[index].y));
 assert.ok(slots.every(slot=>p.RAM[0xdb8+slot]>0&&p.RAM[0xdf8+slot]>0),'native coordinate high bytes handle both map axes');
 frames(p,20);assert.equal(bosses.state.actors.length,3);assert.equal(p.RAM[0x43a]&7,0);assert.equal(p.RAM[0xd96],0);
 for(const type of models)assert.ok(sprites.state.owners.some(owner=>owner?.type===type),`DLC native model ${type} is registered`);
});
