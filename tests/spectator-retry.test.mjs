import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,DEATH_FRAMES,enemies,isCampaign,nearestFreeTile,spawnEnemy,stageID} from '../dist/campaign.js';
import {createNewCampaign} from '../dist/new-campaign.js';
import {createSpectator,validateSpectatorState} from '../dist/spectator.js';
import {createIntroSkip} from '../dist/intro.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';

const rom=process.env.BOMBERMAN_TEST_ROM;

function setup(mode='solo',count=1,laterStage=false){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null});
 const generated=createNewCampaign(p);let retries=0,pendingTeam=false;
 function spawnTeam(){
  const blocked=new Set();
  for(let i=0;i<count;i++){
   const cell=nearestFreeTile(p,{x:2,y:1},blocked);
   const bot=crew.add(cell.x,cell.y);bot.cooldown=1000;
   blocked.add(`${cell.x},${cell.y}`);
  }
 }
 const watch=createSpectator(p,{getBots:()=>crew.state.bots,onRetry:()=>{retries++;crew.reset();pendingTeam=true;}}),intro=createIntroSkip(p);
 for(const action of launchSequence(mode,count).slice(0,3))frames(p,action.frames,action.button?[[0,action.button]]:[]);
 intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);
 for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 assert.equal(isCampaign(p),true,'the native campaign has reached its first play frame');
 if(laterStage){
  for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
  p.RAM[0xd96]=1;p.RAM[0x437]=1;
  for(let i=0;i<700&&(stageID(p)==='0:0'||!isCampaign(p));i++)p.Run();
  assert.equal(stageID(p),'0:1','the fixture enters the actual next native stage');
  assert.equal(isCampaign(p),true);
 }
 watch.configure(true);spawnTeam();
 // As in app.js, the native callback queues spawning until Run has returned
 // and the campaign tracker has marked a fully active play frame.
 const step=()=>{generated.update();watch.update();crew.update();watch.retry();p.Run();if(pendingTeam&&isCampaign(p)&&!(p.RAM[0x43a]&7)&&!p.RAM[0x437]){spawnTeam();pendingTeam=false;}};
 return {p,crew,generated,watch,step,retries:()=>retries};
}

function observe(p){
 const events={music:[],banners:0,black:0},cpu=p.CPURun;
 p.CPURun=function(){
  if(this.PC===0xea57)events.music.push(this.A);
  if(this.MPR[4]===9*8192&&this.PC===0x802a)events.banners++;
  return cpu.call(this);
 };
 // VCE colours use nine bits; unused saved upper bits do not light a pixel.
 return {events,tick(){if(p.Palette.every(value=>(value&0x1ff)===0))events.black++;}};
}

for(const [mode,count,laterStage]of [['solo',1,false],['campaign',4,true]]){
 test(`${mode.toUpperCase()} watch retries ${count} bots on the ${laterStage?'second':'first'} native stage after the final monster death`,{skip:!rom},()=>{
  const {p,crew,generated,watch,step,retries}=setup(mode,count,laterStage),observer=observe(p),stage=stageID(p),last=crew.state.bots.at(-1);
  // Earlier teammates are defeated; the final actor dies from a real loaded
  // native monster rather than a synthetic team-finished flag.
  for(const bot of crew.state.bots.slice(0,-1)){bot.alive=false;bot.deathFrame=DEATH_FRAMES;bot.extraLives=0;bot.target=null;bot.route=[];}
  const template=enemies(p)[0].slot;
  spawnEnemy(p,template,Math.floor(last.x/16),Math.floor(last.y/16));
  crew.update();assert.equal(last.alive,false);assert.equal(last.deathFrame,0);
  p.RAM[0x438]=0;
  for(let frame=0;frame<DEATH_FRAMES;frame++){
   assert.equal(watch.retry(),false,'the final death animation finishes before native retry');
   watch.update();crew.update();p.Run();
  }
  assert.equal(last.deathFrame,DEATH_FRAMES);
  assert.equal(watch.retry(),true,'the final defeat starts a native retry even on the last native life');
  assert.equal(watch.retry(),false,'repeated frames cannot start a second retry');
  assert.equal(watch.state.transition.phase,'dying');
  let elapsed=0;
  for(;elapsed<220&&watch.state.transition.phase!=='loading';elapsed++){step();observer.tick();}
  assert.equal(watch.state.transition.phase,'loading');validateSpectatorState(watch.state);
  assert.equal(retries(),0,'the team is not recreated during the fade or stage card');
  if(count===4){
   const core=captureState(p),bots=structuredClone(crew.state),spectator=structuredClone(watch.state),tracker={...p._campaignTracker},map=structuredClone(generated.state),events=structuredClone(observer.events);
   for(let i=0;i<70;i++){step();observer.tick();}
   const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),bots:structuredClone(crew.state),spectator:structuredClone(watch.state)};
   restoreState(p,core);crew.restore(bots);watch.restore(spectator);generated.restore(map);Object.assign(p._campaignTracker,tracker);Object.assign(observer.events,events);
   for(let i=0;i<70;i++){step();observer.tick();}
   assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.bots);assert.deepEqual(watch.state,expected.spectator);
   elapsed+=70;
  }
  for(;elapsed<700&&watch.state.transition;elapsed++){step();observer.tick();}
  assert.equal(watch.state.transition,null,'native play resumes rather than leaving an inert spectator screen');
  assert.ok(elapsed>400,'death music, fades and stage card finish before retry');
  assert.equal(stageID(p),stage,'defeat retries the same original stage');
  assert.equal(isCampaign(p),true);assert.equal(p.RAM[0x43a]&7,0);
  assert.equal(retries(),1);assert.equal(crew.state.bots.length,count);assert.ok(crew.state.bots.every(bot=>bot.alive));
  assert.equal(watch.state.finished,false);assert.ok(enemies(p).length>0);
  assert.ok(observer.events.music.includes(0x2a),'native death music runs');assert.equal(observer.events.banners,1);assert.ok(observer.events.black>=8,'native fades reach full black');
 });
}

test('spectator retry waits for survivors and extra lives, and leaves NEW retry to its map lifecycle',{skip:!rom},()=>{
 const {p,crew,generated,watch}=setup('campaign',2),[first,last]=crew.state.bots;
 first.alive=false;first.deathFrame=DEATH_FRAMES;
 assert.equal(watch.retry(),false,'a living teammate keeps the current stage running');
 last.alive=false;last.deathFrame=DEATH_FRAMES;last.extraLives=1;
 assert.equal(watch.retry(),false,'an extra life is attempted before a team retry');
 assert.equal(p.RAM[0x43a]&7,0);
 last.extraLives=0;p.RAM[0x437]=1;
 assert.equal(watch.retry(),false,'a completed round is not replaced by a defeat');p.RAM[0x437]=0;
 generated.configure(true,2,12345);generated.update();
 assert.equal(watch.retry(),false,'NEW owns generated-map death transitions');
 const legacy=structuredClone(watch.state);delete legacy.transition;watch.restore(legacy);assert.equal(watch.state.transition,null,'older spectator saves do not acquire a pending retry');
 generated.configure(false);p.RAM[0x438]=0;p.RAM[0x43a]|=1;watch.update();
 assert.equal(watch.state.transition.phase,'dying','an independently triggered native death is adopted');assert.ok(p.RAM[0x438]>=1,'the watched native controller cannot strand the session at game over');
});

test('an extra life finds safe floor outside an isolated death cell and remains available if no safe floor exists',{skip:!rom},()=>{
 const {p,crew,watch}=setup(),bot=crew.state.bots[0];
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;
 p.RAM.fill(1,0x44a,0x44a+1024);p.RAM[0x44a+32+2]=0xca;
 bot.x=40;bot.y=24;bot.alive=false;bot.deathFrame=DEATH_FRAMES;bot.extraLives=1;bot.target=null;bot.route=[];
 // A stationary native monster occupies the only connected floor cell.
 p.RAM[0xd98]=128;p.RAM[0xdd8]=40;p.RAM[0xdb8]=0;p.RAM[0xe18]=24;p.RAM[0xdf8]=0;p.RAM[0xeb8]=0;
 crew.update();watch.update();
 assert.equal(bot.alive,false);assert.equal(bot.extraLives,1,'a blocked revival does not consume the extra life');assert.equal(watch.retry(),false);
 p.RAM[0x44a+32+6]=0xca;
 crew.update();watch.update();
 assert.equal(bot.alive,true,'a safe disconnected floor prevents an endless all-dead spectator wait');
 assert.equal(bot.extraLives,0);assert.equal(bot.deathFrame,null);assert.deepEqual({x:bot.x,y:bot.y},{x:104,y:24});assert.ok(bot.fireproof>0);
 assert.equal(watch.state.finished,false);assert.equal(watch.retry(),false);assert.equal(p.RAM[0x43a]&7,0);
});
