import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,DEATH_FRAMES,enemies,isCampaign,nearestFreeTile,spawnEnemy,stageID} from '../dist/campaign.js';
import {createSpectator,validateSpectatorState} from '../dist/spectator.js';
import {createIntroSkip} from '../dist/intro.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';

const rom=process.env.BOMBERMAN_TEST_ROM;

function setup(){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null});
 const events={retries:0,gameovers:0,music:[],banners:0,black:0};let pendingTeam=false;
 function spawnTeam(){const cell=nearestFreeTile(p,{x:2,y:1});const bot=crew.add(cell.x,cell.y);bot.cooldown=1000;}
 const watch=createSpectator(p,{getBots:()=>crew.state.bots,finiteLives:()=>true,
  onRetry:()=>{events.retries++;crew.reset();pendingTeam=true;},onGameOver:()=>{events.gameovers++;}});
 const intro=createIntroSkip(p);
 for(const action of launchSequence('solo',1).slice(0,3))frames(p,action.frames,action.button?[[0,action.button]]:[]);
 intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);
 for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 assert.equal(isCampaign(p),true);assert.equal(p.RAM[0x438],2,'the native counter starts with two spare lives');
 watch.configure(true);spawnTeam();
 const cpu=p.CPURun;
 p.CPURun=function(){if(this.PC===0xea57)events.music.push(this.A);if(this.MPR[4]===9*8192&&this.PC===0x802a)events.banners++;return cpu.call(this);};
 const step=()=>{
  watch.update();crew.update();watch.retry();p.Run();
  if(p.Palette.every(value=>(value&0x1ff)===0))events.black++;
  if(pendingTeam&&isCampaign(p)&&!(p.RAM[0x43a]&7)&&!p.RAM[0x437]){spawnTeam();pendingTeam=false;}
 };
 function completeAnimation(){for(let i=0;i<DEATH_FRAMES&&crew.state.bots.some(b=>!b.alive&&b.deathFrame<DEATH_FRAMES);i++){assert.equal(watch.retry(),false,'native retry waits for the last death pose');watch.update();crew.update();p.Run();}}
 function defeat(){
  const bot=crew.state.bots[0],template=enemies(p)[0].slot;
  spawnEnemy(p,template,Math.floor(bot.x/16),Math.floor(bot.y/16));crew.update();
  assert.equal(bot.alive,false);assert.equal(bot.deathFrame,0);
  completeAnimation();assert.equal(bot.deathFrame,DEATH_FRAMES);
 }
 return {p,crew,watch,events,step,defeat,completeAnimation};
}

test('Solo AI final native life ends after the native death sequence and cannot respawn',{skip:!rom},()=>{
 const {p,crew,watch,events,step,defeat}=setup();p.RAM[0x438]=0;defeat();
 assert.equal(watch.retry(),true);assert.equal(p.RAM[0x438],0,'final defeat must not manufacture a spare life');
 assert.equal(watch.state.transition.phase,'dying');
 let elapsed=0;for(;elapsed<300&&!watch.state.finished;elapsed++)step();
 assert.equal(watch.state.finished,true);assert.equal(watch.state.transition,null);
 assert.ok(elapsed>=150&&elapsed<300,'native death music and fade finish before the title is ready');
 assert.equal(p.VDC[0].SATB[2],918,'the callback runs only once the native title has arrived');
 assert.equal(isCampaign(p),false);assert.equal(p.RAM[0x438],255,'the native zero-life branch consumes the final counter');
 assert.equal(events.gameovers,1);assert.equal(events.retries,0);assert.equal(events.banners,0);
 assert.ok(events.music.includes(0x2a),'native defeat music plays');assert.ok(events.music.includes(0x2b),'native title music follows');assert.ok(events.black>0,'the native fade reaches black');
 assert.equal(crew.state.bots[0].alive,false);assert.equal(crew.state.bots[0].deathFrame,DEATH_FRAMES);
 for(let i=0;i<100;i++)step();
 assert.equal(events.gameovers,1,'later title frames cannot report the same defeat again');assert.equal(events.retries,0);
 assert.equal(watch.retry(),false);assert.equal(crew.state.bots[0].alive,false);assert.equal(watch.state.finished,true);
});

test('Solo AI spends its native spare life before ending on the next defeat',{skip:!rom},()=>{
 const {p,crew,watch,events,step,defeat}=setup(),stage=stageID(p);p.RAM[0x438]=1;defeat();
 assert.equal(watch.retry(),true);assert.equal(p.RAM[0x438],1);
 let elapsed=0;for(;elapsed<700&&watch.state.transition;elapsed++)step();
 assert.equal(watch.state.transition,null);assert.ok(elapsed>400,'the spare life keeps the normal native stage card');
 assert.equal(events.retries,1);assert.equal(events.gameovers,0);assert.equal(events.banners,1);
 assert.equal(p.RAM[0x438],0);assert.equal(stageID(p),stage);assert.equal(isCampaign(p),true);assert.equal(crew.state.bots[0].alive,true);
 defeat();assert.equal(watch.retry(),true);
 for(let i=0;i<300&&!watch.state.finished;i++)step();
 assert.equal(events.retries,1,'the final life must not trigger another stage restart');assert.equal(events.gameovers,1);assert.equal(events.banners,1);
 assert.equal(watch.state.finished,true);assert.equal(p.VDC[0].SATB[2],918);
});

test('Solo AI uses a collected extra life before committing to the final native defeat',{skip:!rom},()=>{
 const {p,crew,watch,events,step,completeAnimation}=setup(),bot=crew.state.bots[0];
 p.RAM[0x438]=0;p.RAM.fill(0,0xd98,0xdb8);p.RAM.fill(0,0x84f,0x877);
 bot.alive=false;bot.deathFrame=DEATH_FRAMES;bot.extraLives=1;bot.target=null;bot.route=[];
 assert.equal(watch.retry(),false,'a collected revival is resolved before the native life counter');
 crew.update();assert.equal(bot.alive,true);assert.equal(bot.extraLives,0);assert.equal(bot.deathFrame,null);
 assert.equal(watch.retry(),false);assert.equal(p.RAM[0x438],0);assert.equal(events.gameovers,0);
 bot.alive=false;bot.deathFrame=0;bot.target=null;bot.route=[];
 completeAnimation();
 assert.equal(watch.retry(),true);
 for(let i=0;i<300&&!watch.state.finished;i++)step();
 assert.equal(watch.state.finished,true);assert.equal(events.gameovers,1);assert.equal(events.retries,0);
});

test('a save inside the final native game-over transition replays the same title and callback',{skip:!rom},()=>{
 const {p,crew,watch,events,step,defeat}=setup();p.RAM[0x438]=0;defeat();watch.retry();
 for(let i=0;i<220&&watch.state.transition?.phase!=='gameover';i++)step();
 assert.equal(watch.state.transition.phase,'gameover');assert.equal(events.gameovers,0);validateSpectatorState(watch.state);
 const saved={core:captureState(p),crew:structuredClone(crew.state),watch:structuredClone(watch.state),tracker:{...p._campaignTracker},events:structuredClone(events)};
 for(let i=0;i<80;i++)step();
 const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),pc:p.PC,mpr:[...p.MPR],crew:structuredClone(crew.state),watch:structuredClone(watch.state),events:structuredClone(events)};
 assert.equal(expected.events.gameovers,1);assert.equal(expected.watch.finished,true);
 restoreState(p,saved.core);crew.restore(saved.crew);watch.restore(saved.watch);Object.assign(p._campaignTracker,saved.tracker);Object.assign(events,saved.events);
 for(let i=0;i<80;i++)step();
 assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.equal(p.PC,expected.pc);assert.deepEqual(p.MPR,expected.mpr);
 assert.deepEqual(crew.state,expected.crew);assert.deepEqual(watch.state,expected.watch);assert.deepEqual(events,expected.events);
});
