import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,enemies,tileKind,spawnBomb} from '../dist/campaign.js';import {createNewCampaign,generateChallengeMap,validateNewCampaign} from '../dist/new-campaign.js';import {captureState,restoreState} from '../dist/save-state.js';import {launchSequence} from '../dist/battle-ai.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function boot(p){for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);}
test('generated maps have reachable destructible objectives, a safe start and rising size/monster pressure',()=>{
 for(let seed=0;seed<50;seed++)for(const round of [1,6,20]){
  const map=generateChallengeMap(seed,round,5),seen=new Set([34]),queue=[34];for(let i=0;i<queue.length;i++)for(const delta of [-32,32,-1,1]){const next=queue[i]+delta;if(next>=0&&next<1024&&map.cells[next]!==1&&!seen.has(next)){seen.add(next);queue.push(next);}}
  assert.ok(seen.has(map.exit.y*32+map.exit.x));assert.equal(map.cells[map.exit.y*32+map.exit.x],4);for(const c of [...map.monsters,...map.items])assert.ok(seen.has(c.y*32+c.x));for(let x=2;x<=6;x++)assert.equal(map.cells[32+x],10);assert.ok(map.monsters.every(c=>c.x>6||c.y>3));assert.ok(map.width>=27&&map.height>=21);assert.ok(map.monsters.length>=22&&map.monsters.length<=28);
 }
 const early=generateChallengeMap(42,1),late=generateChallengeMap(42,20);assert.ok(late.width>early.width&&late.height>early.height&&late.monsters.length>early.monsters.length);assert.deepEqual(generateChallengeMap(42,1),early);assert.notDeepEqual(generateChallengeMap(43,1),early);
});
test('NEW campaign uses native monsters, pickups, collision, scrolling, bombs, locked exits and exact save replay',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p);let rounds=0;const mode=createNewCampaign(p,{onRound:()=>{rounds++;crew.reset();}});boot(p);mode.configure(true,5,12345);mode.update();assert.equal(rounds,1);assert.equal(p.RAM[0x434],27);assert.equal(p.RAM[0x435],21);assert.equal(enemies(p).length,22);assert.equal(p.RAM.slice(0xf9b,0xfb4).filter(v=>v&128).length,9);assert.ok(enemies(p).every(e=>e.type===2));
 for(const [x,y]of [[4,1],[5,1],[6,1],[2,3]])crew.add(x,y);assert.equal(crew.state.bots.length,4);
 // The guaranteed starting fire-up is processed by the original pickup routine.
 frames(p,24,[[0,'RIGHT']]);assert.equal(p.RAM[0x84d]&127,2);assert.equal(p.RAM[0xf9b],0);assert.equal(p.RAM[0x43a]&7,0);
 // Native collision must still stop the human at the center before a block.
 const live=p.RAM.slice(0xd98,0xdb8);for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0x44a+32+5]=2;frames(p,100,[[0,'RIGHT']]);assert.equal(p.RAM[0x43d],72);assert.equal(p.RAM[0x43a]&7,0);p.RAM[0x44a+32+5]=10;for(let i=0;i<32;i++)p.RAM[0xd98+i]=live[i];p.RAM[0xd96]=0;
 const setPosition=(x,y)=>{p.RAM[0x43d]=x&255;p.RAM[0x43e]=x>>8;p.RAM[0x43f]=y&255;p.RAM[0x440]=y>>8;};
 let far;for(let y=16;y<21;y++)for(let x=20;x<27;x++)if(tileKind(p,x,y)===10&&enemies(p).every(e=>Math.max(Math.abs(e.x-(x*16+8)),Math.abs(e.y-(y*16+8)))>32))far={x,y};assert.ok(far);setPosition(far.x*16+8,far.y*16+8);mode.update();frames(p,2);assert.ok((p.RAM[0x25]|p.RAM[0x26]<<8)>100);assert.ok((p.RAM[0x27]|p.RAM[0x28]<<8)>100,'native camera follows both larger map axes');assert.equal(p.RAM[0x43a]&7,0);
 // Move the human back and retain the exact generator/bot state across saves.
 setPosition(40,24);mode.update();const save=captureState(p),extension=structuredClone(crew.state),generator=structuredClone(mode.state),tracker={...p._campaignTracker};
 function advance(n){for(let i=0;i<n;i++){mode.update();crew.update();p.Run();}}
 advance(60);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),crew:structuredClone(crew.state),mode:structuredClone(mode.state)};restoreState(p,save);crew.restore(extension);mode.restore(generator);Object.assign(p._campaignTracker,tracker);advance(60);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.crew);assert.deepEqual(mode.state,expected.mode);
 restoreState(p,save);crew.restore(extension);mode.restore(generator);Object.assign(p._campaignTracker,tracker);
 const map=generateChallengeMap(mode.state.seed,1,5),exit=map.exit,flags=p.RAM.slice(0xd98,0xdb8);for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0x44a+(exit.y-1)*32+exit.x]=10;const bomb=spawnBomb(p,exit.x,exit.y-1);p.RAM[0x8ef+bomb]=1;frames(p,190);assert.equal(tileKind(p,exit.x,exit.y),8,'a native explosion uncovers the generated hidden blue pad');for(let i=0;i<32;i++)p.RAM[0xd98+i]=flags[i];for(const e of enemies(p)){p.RAM[0xdd8+e.slot]=200;p.RAM[0xdb8+e.slot]=0;p.RAM[0xe18+e.slot]=24;p.RAM[0xdf8+e.slot]=0;}setPosition(exit.x*16+8,exit.y*16+8);p.RAM[0xd96]=1;frames(p,3);assert.equal(mode.state.pending,false,'living enemies keep the exit locked even with a stale native cleared flag');assert.equal(p.RAM[0x437],0);assert.equal(p.RAM[0x43a]&7,0);
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;frames(p,3);assert.equal(mode.state.pending,true,'native exit requests the next generated map');mode.update();assert.equal(mode.state.round,2);assert.equal(rounds,2);assert.equal(enemies(p).length,24);assert.equal(p.RAM[0x43d],40);assert.equal(p.RAM[0x437],0);assert.deepEqual(p.RAM.slice(0xd8d,0xd90),[6,59,59],'each generated round receives a fresh seven-minute clock');
 // Original explosions still destroy blocks on the generated map.
 p.RAM[0x44a+32+5]=2;spawnBomb(p,4,1);p.RAM[0x8ef]=1;frames(p,190);assert.equal(tileKind(p,5,1),10);
 const broken=structuredClone(mode.state);broken.enemyTemplate[9]=99;assert.throws(()=>validateNewCampaign(broken),/monster template/);
});
