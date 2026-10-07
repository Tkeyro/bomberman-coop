import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,spawnItem,playerPosition,canOccupy} from '../dist/campaign.js';import {launchSequence} from '../dist/battle-ai.js';import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
test('campaign bot Roller Shoes match native movement and remain independent and deterministic',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p);for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;for(let x=2;x<15;x++)p.RAM[0x44a+32+x]=0xca;
 p.RAM[0x43d]=40;p.RAM[0x43e]=0;p.RAM[0x43f]=24;p.RAM[0x440]=0;
 const baseline=captureState(p),tracker={...p._campaignTracker};
 frames(p,48,[[0,'RIGHT']]);const nativeNormal=playerPosition(p).x-40;assert.equal(nativeNormal,36,'native normal speed is three pixels per four frames');
 restoreState(p,baseline);Object.assign(p._campaignTracker,tracker);spawnItem(p,3,2,1);frames(p,2);assert.equal(p.RAM[0x84e],1,'the native pickup grants Roller Shoes');
 frames(p,48,[[0,'RIGHT']]);const nativeShoes=playerPosition(p).x-40;assert.equal(nativeShoes,48,'native shoes move one pixel each frame');
 restoreState(p,baseline);Object.assign(p._campaignTracker,tracker);crew.reset();let bot=crew.add(4,1);bot.cooldown=1000;bot.target={x:8,y:1};
 const advance=n=>{for(let i=0;i<n;i++){crew.update();p.Run();}};advance(48);assert.equal(bot.x-72,nativeNormal,'unpowered AI matches native base speed');
 bot.x=72;bot.target=null;bot.route=[];spawnItem(p,3,4,1);crew.update();assert.equal(bot.speedUp,true);assert.equal(p.RAM[0x84e],0,'the human does not inherit AI shoes');frames(p,2);
 // Shoes are one native upgrade rather than an accumulating speed multiplier.
 spawnItem(p,3,4,1);crew.update();frames(p,2);assert.equal(bot.pickupsCollected,2);bot.target={x:8,y:1};advance(48);assert.equal(bot.x-72,nativeShoes,'repeated shoes retain the native one-pixel speed');
 bot.x=72;bot.target={x:8,y:1};bot.route=[];advance(11);
 const save=captureState(p),team=structuredClone(crew.state),tracking={...p._campaignTracker};advance(21);const expected={ram:[...p.RAM],team:structuredClone(crew.state),pixels:Uint8ClampedArray.from(p.ImageData.data)};
 restoreState(p,save);crew.restore(team);Object.assign(p._campaignTracker,tracking);advance(21);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(crew.state,expected.team);assert.deepEqual(p.ImageData.data,expected.pixels);
 bot=crew.state.bots[0];bot.x=119.5;bot.y=24;bot.target={x:7,y:1};advance(1);assert.equal(bot.x,120,'a fractional final movement clamps to the tile center');assert.equal(bot.target,null);
 // A faster actor must still stop against solid terrain.
 p.RAM[0x44a+32+8]=0xc2;bot.target={x:8,y:1};advance(1);assert.equal(bot.x,120);assert.equal(bot.target,null);assert.equal(canOccupy(p,bot.x,bot.y,bot),true);
});
