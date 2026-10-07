import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,isCampaign,spawnItem,spawnBomb,bombs,tileKind} from '../dist/campaign.js';
import {launchSequence} from '../dist/battle-ai.js';
import {createIntroSkip} from '../dist/intro.js';
import {KEY_BINDINGS} from '../dist/session.js';
import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function opening(){
 const p=createMachine(fs.readFileSync(rom));createCompanions(p);const intro=createIntroSkip(p);
 for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);
 intro.configure(true);frames(p,8,[[0,'RUN']]);return {p,intro};
}
function advanceToStage(p,intro,limit=1100){let n=0;for(;n<limit&&intro.state.pending;n++){intro.update();p.Run();}assert.equal(intro.state.pending,false,'queued skip must reach gameplay');assert.equal(isCampaign(p),true);return n;}
function press(p,key){frames(p,1,[KEY_BINDINGS[key]]);frames(p,2);}
test('an early opening skip waits for its native poll, saves/replays and never holds a gameplay button',{skip:!rom},()=>{
 const {p,intro}=opening();assert.equal(isCampaign(p),false);intro.request();
 const save=captureState(p,{openingIntro:intro.state}),tracker={...p._campaignTracker},elapsed=advanceToStage(p,intro);
 assert.ok(elapsed<1000,'skip bypasses the roughly 2400-frame story');assert.equal(p.RAM[0x43a]&7,0);assert.equal(bombs(p).length,0);assert.ok(p.Keybord[0][0]&8);
 const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data)};
 restoreState(p,save);Object.assign(p._campaignTracker,tracker);intro.restore(save.session.openingIntro);
 assert.equal(advanceToStage(p,intro),elapsed);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.equal(intro.request(),false);
 frames(p,12,[[0,'RIGHT']]);assert.ok(p.RAM[0x43d]>40,'the first stage remains playable');
 assert.throws(()=>intro.restore({pending:false,requested:true}),/intro/);assert.equal(intro.state.pending,false);
 // A later request still skips; without a request the original story runs.
 restoreState(p,save);Object.assign(p._campaignTracker,tracker);intro.configure(true);
 for(let i=0;i<600;i++){intro.update();p.Run();}assert.equal(isCampaign(p),false);assert.equal(intro.state.requested,false);
 intro.request();advanceToStage(p,intro);assert.equal(bombs(p).length,0);
});
test('B/X detonate collected Remote Control bombs in order and preserve independent native timers',{skip:!rom},()=>{
 const {p,intro}=opening();intro.request();advanceToStage(p,intro);
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 const unpowered=captureState(p),unpoweredTracker={...p._campaignTracker};
 spawnItem(p,2,2,1);frames(p,2);assert.ok(p.RAM[0x43a]&16,'collect the native Remote Control pickup');p.RAM[0x84c]=3;
 p.RAM[0x44a+32+3]=0xc2;press(p,'Space');p.RAM[0x43d]=104;p.RAM[0x43f]=88;press(p,'Space');p.RAM[0x43d]=72;p.RAM[0x43f]=56;
 frames(p,180);const waiting=bombs(p).filter(b=>b.slot<10);assert.equal(waiting.length,2);assert.ok(waiting.every(b=>b.fuse===150),'remote bombs wait beyond the normal timer');
 const ai=spawnBomb(p,12,9,{slots:[20],automatic:true}),enemy=spawnBomb(p,14,11,{slots:[10],automatic:true});
 const save=captureState(p),tracker={...p._campaignTracker};
 press(p,'KeyB');assert.equal(p.RAM[0x84f+waiting[0].slot],0);assert.ok(p.RAM[0x84f+waiting[1].slot]&128);assert.equal(p.RAM[0x8ef+waiting[1].slot],150);assert.equal(p.RAM[0x8ef+ai],147);assert.equal(p.RAM[0x8ef+enemy],147);assert.notEqual(tileKind(p,3,1),2,'the detonated blast reaches its block');
 press(p,'KeyX');assert.equal(p.RAM[0x84f+waiting[1].slot],0);assert.ok(p.RAM[0x84f+ai]&128);assert.equal(p.RAM[0x8ef+ai],144);assert.equal(p.RAM[0x8ef+enemy],144);
 restoreState(p,save);Object.assign(p._campaignTracker,tracker);frames(p,20);assert.ok(waiting.every(b=>p.RAM[0x8ef+b.slot]===150),'saved remote bombs still wait');press(p,'KeyB');assert.equal(p.RAM[0x84f+waiting[0].slot],0);assert.ok(p.RAM[0x84f+waiting[1].slot]&128);
 restoreState(p,unpowered);Object.assign(p._campaignTracker,unpoweredTracker);press(p,'Space');p.RAM[0x43d]=104;p.RAM[0x43f]=88;frames(p,40);const normal=bombs(p)[0];assert.ok(normal);const fuse=normal.fuse;press(p,'KeyB');assert.equal(p.RAM[0x8ef+normal.slot],fuse-3,'B does not grant a missing power-up');frames(p,160);assert.equal(p.RAM[0x84f+normal.slot],0,'ordinary bombs retain their automatic fuse');
});
