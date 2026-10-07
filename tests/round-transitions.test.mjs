import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';import {createCompanions,enemies,spawnEnemy,playerPosition} from '../dist/campaign.js';import {createNewCampaign,validateNewCampaign} from '../dist/new-campaign.js';import {createSpectator} from '../dist/spectator.js';import {createIntroSkip} from '../dist/intro.js';import {launchSequence} from '../dist/battle-ai.js';import {captureState,restoreState} from '../dist/save-state.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function setup(watching=false){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>watching?null:playerPosition(p)});let watch;
 const mode=createNewCampaign(p,{getFocus:()=>watching?watch.focus():playerPosition(p),onRound:()=>{crew.reset();watch?.configure(watching);}});watch=createSpectator(p,{getBots:()=>crew.state.bots});const intro=createIntroSkip(p);
 for(const a of launchSequence('solo').slice(0,3))frames(p,a.frames,a.button?[[0,a.button]]:[]);intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 mode.configure(true,watching?1:2,12345);mode.update();watch.configure(watching);
 const step=()=>{mode.update();watch.update();crew.update();p.Run();};return {p,crew,mode,watch,step};
}
function observe(p){
 const events={music:[],digits:[],banners:0,black:0},cpu=p.CPURun,get=p.Get;
 p.CPURun=function(){if(this.PC===0xea57)events.music.push(this.A);if(this.MPR[4]===9*8192&&this.PC===0x802a)events.banners++;return cpu.call(this);};
 p.Get=function(address){const value=get.call(this,address);if(this.MPR[4]===9*8192&&this.PC===0x816c&&(address===0x284a||address===0x284b))events.digits.push([address,value]);return value;};
 return {events,tick(){if(p.Palette.every(n=>n===0))events.black++;}};
}
function complete(mode,step,observer){let elapsed=0;for(;elapsed<700&&mode.state.transition;elapsed++){step();observer?.tick();}assert.equal(mode.state.transition,null,'native sequence returns to a generated play frame');assert.ok(elapsed>400,'music, fades and the stage card run before the map reloads');return elapsed;}
test('NEW clears through native music, black fades and 1-2/1-3 stage cards, with replay during loading',{skip:!rom},()=>{
 const {p,crew,mode,watch,step}=setup(),observer=observe(p);
 for(const round of [2,3,9]){
  if(round===9)mode.state.round=8;
  for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;p.RAM[0x437]=1;step();assert.equal(mode.state.transition.kind,'advance');assert.equal(mode.state.round,round-1);
  for(let i=0;i<250;i++){step();observer.tick();}assert.equal(mode.state.transition.phase,'loading');validateNewCampaign(mode.state);
  const save=captureState(p),generator=structuredClone(mode.state),bots=structuredClone(crew.state),spectator=structuredClone(watch.state),tracker={...p._campaignTracker};
  for(let i=0;i<80;i++)step();const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),mode:structuredClone(mode.state)};
  restoreState(p,save);mode.restore(generator);crew.restore(bots);watch.restore(spectator);Object.assign(p._campaignTracker,tracker);for(let i=0;i<80;i++)step();assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(mode.state,expected.mode);
  let remaining=0;for(;remaining<700&&mode.state.transition;remaining++){step();observer.tick();}assert.equal(mode.state.transition,null);assert.equal(mode.state.round,round);assert.ok(enemies(p).length>0);assert.deepEqual(p.RAM.slice(0x84a,0x84c),[0,0],'native assets always reload the opening region');
  assert.ok(observer.events.digits.some(([address,value])=>address===0x284a&&value===Math.floor((round-1)/8)));assert.ok(observer.events.digits.some(([address,value])=>address===0x284b&&value===(round-1)%8));
 }
 assert.equal(observer.events.banners,3);assert.ok(observer.events.music.includes(0x2c),'native clear music');assert.ok(observer.events.music.includes(0x24),'native stage music');
 assert.ok(observer.events.black>=24,'each native clear sequence fades fully to black');
 // An older queued-clear save resumes through the same native sequence.
 const old=structuredClone(mode.state);delete old.transition;old.pending=true;for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;mode.restore(old);mode.update();assert.equal(mode.state.transition.kind,'advance');
 const invalid=structuredClone(mode.state);invalid.transition.phase='teleport';assert.throws(()=>validateNewCampaign(invalid),/transition/);
});
test('native monster damage plays death music and fades, then retries the same NEW round',{skip:!rom},()=>{
 const {p,mode,step}=setup(),observer=observe(p),lives=p.RAM[0x438],template=enemies(p)[0].slot;
 spawnEnemy(p,template,2,1);step();assert.ok(p.RAM[0x43a]&7,'the native monster starts the human defeat animation');for(let i=0;i<180&&!mode.state.transition;i++)step();assert.equal(mode.state.transition.kind,'retry');
 complete(mode,step,observer);assert.equal(mode.state.round,1);assert.equal(p.RAM[0x438],lives-1);assert.deepEqual(playerPosition(p),{x:40,y:24});assert.ok(enemies(p).length>0);assert.ok(observer.events.music.includes(0x2a));assert.equal(observer.events.banners,1);assert.ok(observer.events.black>=8,'the native palette reaches full black during both fades');
});
test('a defeated watched team animates during native death music, then reloads without exposing the hidden human',{skip:!rom},()=>{
 const {p,crew,mode,watch,step}=setup(true),observer=observe(p),bot=crew.add(4,1);let botPixels=0,nativePixels=0;const sprites=p.MakeSpriteLine;
 p.MakeSpriteLine=function(n){sprites.call(this,n);if(n===0&&mode.state.transition?.phase==='dying')for(const dot of this.VDC[0].SPLine)if(dot.data){if(dot.no===64)botPixels++;if(dot.no<2)nativePixels++;}};
 bot.alive=false;bot.deathFrame=0;bot.extraLives=0;p.RAM[0x438]=0;assert.equal(mode.retry(),true);assert.equal(mode.retry(),false,'one defeat starts only one native transition');
 const save=captureState(p),generator=structuredClone(mode.state),bots=structuredClone(crew.state),spectator=structuredClone(watch.state),tracker={...p._campaignTracker};
 for(let i=0;i<70;i++)step();const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),bots:structuredClone(crew.state)};restoreState(p,save);mode.restore(generator);crew.restore(bots);watch.restore(spectator);Object.assign(p._campaignTracker,tracker);for(let i=0;i<70;i++)step();assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.bots);
 let elapsed=0;for(;elapsed<700&&mode.state.transition;elapsed++){step();observer.tick();}assert.equal(mode.state.transition,null);assert.equal(mode.state.round,1);assert.equal(watch.state.finished,false);assert.equal(crew.state.bots.length,0,'onRound resets the team for the configured spawn count');assert.ok(enemies(p).length>0);assert.ok(botPixels>100);assert.equal(nativePixels,0);assert.ok(observer.events.music.includes(0x2a));assert.equal(observer.events.banners,1);assert.ok(observer.events.black>=8);
});
