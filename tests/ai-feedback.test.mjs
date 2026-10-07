import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,spawnItem,spawnBomb,tileKind,enemies,validateCompanionState} from '../dist/campaign.js';import {createNewCampaign} from '../dist/new-campaign.js';import {captureState,restoreState} from '../dist/save-state.js';import {launchSequence} from '../dist/battle-ai.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function boot(p){for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);}
function noMonsters(p){for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;}
function placeMonster(p,slot,x,y){p.RAM[0xd98+slot]=128;p.RAM[0xdd8+slot]=x&255;p.RAM[0xdb8+slot]=x>>8;p.RAM[0xe18+slot]=y&255;p.RAM[0xdf8+slot]=y>>8;}
test('NEW restores collected pickup terrain and stale markers for repeated native explosions',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p),mode=createNewCampaign(p);boot(p);mode.configure(true,1,12345);mode.update();noMonsters(p);
 frames(p,24,[[0,'RIGHT']]);assert.equal(p.RAM[0xf9b],0,'native human collects the starting power-up');
 const row=19;for(let x=21;x<=26;x++)p.RAM[0x44a+row*32+x]=0xca;
 p.RAM[0x43d]=p.RAM[0x43e]=p.RAM[0x43f]=p.RAM[0x440]=0;
 const slot=spawnItem(p,0,24,row),bot=crew.add(25,row);bot.x=392;bot.cooldown=1000;crew.update();frames(p,2);assert.equal(p.RAM[0xf9b+slot],0);assert.equal(bot.fireRange,2);assert.equal(p.RAM[0x44a+row*32+24],0xca);bot.x=40;bot.y=24;
 const live=spawnItem(p,6,6,1);mode.update();assert.ok(p.RAM[0xf9b+live]&128);assert.equal(tileKind(p,6,1),7,'live pickups survive terrain repair');
 const run=n=>{for(let i=0;i<n;i++){mode.update();p.Run();}},refs=(x,y)=>[0,1,2,3].map(i=>p.VDC[0].VRAM[(y*2+(i>>1))*p.VDC[0].VScreenWidth+x*2+(i&1)]);
 p.RAM[0x84d]=5;p.RAM[0x43a]=128;p.RAM[0x446]=255;p.RAM[0x447]=127;
 for(const [origin,damaged]of [[22,0x8a],[24,0x47],[22,0xca]]){
  p.RAM[0x44a+row*32+24]=damaged;p.RAM[0x44a+row*32+26]=0xc2;mode.update();assert.equal(p.RAM[0x44a+row*32+24],0xca);
  const bomb=spawnBomb(p,origin,row,{automatic:true});p.RAM[0x8ef+bomb]=1;run(8);assert.ok([11,12].includes(tileKind(p,24,row)));assert.equal(tileKind(p,25,row),11,'fire crosses the former pickup');run(182);assert.equal(tileKind(p,26,row),10,'the native blast destroys the block beyond it');assert.deepEqual(refs(24,row),mode.state.tiles[10]);assert.deepEqual(refs(26,row),mode.state.tiles[10]);
 }
 // Pending fire groups from the old attempt must not burn the retried map.
 const native=spawnBomb(p,22,row,{automatic:true});p.RAM[0x8ef+native]=1;run(8);assert.ok(p.RAM.slice(0x96d,0xa1c).some(v=>v&128));assert.equal(mode.retry(),true);assert.equal(mode.state.round,1);assert.equal(mode.state.transition.phase,'dying');for(let i=0;i<700&&mode.state.transition;i++)run(1);assert.equal(mode.state.transition,null);assert.ok(p.RAM.slice(0x96d,0xa1c).every(v=>v===0));run(8);assert.equal(tileKind(p,4,1),10);assert.ok(enemies(p).length>0);
});
test('bot steps and death use the native audible effects, with queued audio preserved in saves',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p);boot(p);noMonsters(p);p.RAM[0x43d]=p.RAM[0x43f]=0;p.RAM[0x44a+32+5]=0xca;
 const bot=crew.add(4,1);bot.target={x:5,y:1};bot.cooldown=1000;bot.animation=7;p.RAM[0x1487]=128;crew.update();assert.equal(p.RAM[0x1487],1,'walking queues the original step effect');
 const save=captureState(p),bots=structuredClone(crew.state),tracker={...p._campaignTracker};const audible=[];const psg=p.SetPSG;p.SetPSG=function(register,data){if(register===4&&(data&128)&&(data&31))audible.push(this.PSGChannel[0].R[0]);return psg.call(this,register,data);};
 frames(p,4);assert.ok(audible.includes(4),'native PSG enables the step sound channel');const expected=structuredClone(p.PSGChannel);restoreState(p,save);crew.restore(bots);Object.assign(p._campaignTracker,tracker);frames(p,4);assert.deepEqual(p.PSGChannel,expected);
 const actor=crew.state.bots[0];p.RAM[0x1487]=128;actor.target={x:5,y:2};actor.animation=7;crew.update();assert.equal(p.RAM[0x1487],128,'blocked feet do not make steps');
 placeMonster(p,0,Math.round(actor.x),Math.round(actor.y));p.RAM[0x1487]=128;crew.update();assert.equal(actor.alive,false);assert.equal(actor.deathFrame,0);assert.equal(p.RAM[0x1487],4,'monster damage queues the original death effect');audible.length=0;frames(p,4);assert.ok(audible.includes(2)||audible.includes(4),'the native death sound reaches the PSG');p.RAM[0x1487]=128;crew.update();assert.equal(p.RAM[0x1487],128,'the death effect does not restart on each animation frame');
});
test('bots foresee approaching monsters before collision range and retain motion history in saves',{skip:!rom},()=>{
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p);boot(p);noMonsters(p);p.RAM[0x43d]=p.RAM[0x43f]=0;
 for(let x=2;x<15;x++)p.RAM[0x44a+3*32+x]=0xca;
 const bot=crew.add(5,3);bot.cooldown=1000;
 for(let i=0;i<13;i++){bot.x=88;bot.y=56;bot.target={x:6,y:3};placeMonster(p,0,152-i,56);crew.update();}
 assert.ok(140-bot.x>32,'the actual monster is still outside the old reaction distance');assert.equal(bot.action,'Avoiding monsters');assert.ok(bot.x<88,'the bot backs away before the approaching monster arrives');assert.equal(bot.bombsPlaced,0);assert.ok(crew.state.foeMotion[0].vx<-.9);
 const stored=structuredClone(crew.state);validateCompanionState(stored);crew.reset();crew.restore(stored);assert.deepEqual(crew.state.foeMotion,stored.foeMotion);const invalid=structuredClone(stored);invalid.foeMotion[0].vx=Infinity;assert.throws(()=>validateCompanionState(invalid),/monster motion/);delete stored.foeMotion;crew.restore(stored);assert.deepEqual(crew.state.foeMotion,[],'older saves start a new observation history');
});
