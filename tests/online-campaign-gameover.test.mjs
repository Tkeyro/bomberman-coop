import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,campaignSpawnCells,DEATH_FRAMES,isCampaign,spawnItem,stageID} from '../dist/campaign.js';
import {createSpectator,validateSpectatorState} from '../dist/spectator.js';
import {createOnlineCampaign} from '../dist/online-campaign.js';
import {createSharedPowerups} from '../dist/shared-powerups.js';
import {createIntroSkip} from '../dist/intro.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';

const rom=process.env.BOMBERMAN_TEST_ROM;
function setup(){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null});
 const events={retries:0,gameovers:0,music:[],banners:0,black:0};let pendingTeam=false,inputFrame=0;
 const watch=createSpectator(p,{getBots:()=>crew.state.bots,finiteLives:()=>true,onRetry:()=>{events.retries++;crew.reset();pendingTeam=true;},onGameOver:()=>{events.gameovers++;}});
 const shared=createSharedPowerups(p,{getActors:()=>crew.state.bots,getHuman:()=>null});
 const online=createOnlineCampaign(p,{getActors:()=>crew.state.bots,getLocalID:()=>1}),intro=createIntroSkip(p);
 for(const action of launchSequence('solo',1).slice(0,3))frames(p,action.frames,action.button?[[0,action.button]]:[]);
 intro.configure(true);intro.request();frames(p,8,[[0,'RUN']]);for(let i=0;i<1100&&intro.state.pending;i++){intro.update();p.Run();}
 assert.equal(isCampaign(p),true);assert.equal(p.RAM[0x438],2,'native stock begins with two spare team rounds');
 function spawnTeam(){
  for(const [i,cell]of campaignSpawnCells(p,2).entries()){const actor=crew.add(cell.x,cell.y);actor.color=i?'red':'black';}
  online.configure(true,crew.state.bots.map(b=>({id:b.id,color:b.color})));p.RAM.fill(0,0xd98,0xdb8);
 }
 watch.configure(true);shared.configure(true);spawnTeam();
 const cpu=p.CPURun;p.CPURun=function(){if(this.PC===0xea57)events.music.push(this.A);if(this.MPR[4]===9*8192&&this.PC===0x802a)events.banners++;return cpu.call(this);};
 const step=()=>{
  online.setInputs(inputFrame++,[0,0]);shared.update();online.update();watch.update();crew.update();watch.retry();p.Run();
  if(p.Palette.every(value=>(value&0x1ff)===0))events.black++;
  if(pendingTeam&&isCampaign(p)&&!(p.RAM[0x43a]&7)&&!p.RAM[0x437]){spawnTeam();pendingTeam=false;}
 };
 const defeat=actor=>{actor.alive=false;actor.deathFrame=0;actor.target=null;actor.route=[];};
 const completeAnimations=()=>{for(let i=0;i<DEATH_FRAMES&&crew.state.bots.some(b=>!b.alive&&b.deathFrame<DEATH_FRAMES);i++){assert.equal(watch.retry(),false,'team retry waits for every death animation');online.setInputs(inputFrame++,[0,0]);shared.update();online.update();watch.update();crew.update();p.Run();}};
 return {p,crew,watch,online,shared,events,step,defeat,completeAnimations,inputFrame:()=>inputFrame,restoreInputFrame:value=>{inputFrame=value;}};
}

test('online campaign continues with a survivor, spends the final spare round, then ends without a free life',{skip:!rom},()=>{
 const {p,crew,watch,events,step,defeat,completeAnimations}=setup(),stage=stageID(p);p.RAM[0x438]=1;
 defeat(crew.state.bots[0]);assert.equal(watch.retry(),false);for(let i=0;i<90;i++)step();
 assert.equal(crew.state.bots[1].alive,true);assert.equal(p.RAM[0x438],1,'one death does not consume a team round');assert.equal(watch.state.transition,null);
 defeat(crew.state.bots[1]);completeAnimations();assert.equal(watch.retry(),true);assert.equal(watch.retry(),false);assert.equal(p.RAM[0x438],1);
 let elapsed=0;for(;elapsed<700&&watch.state.transition;elapsed++)step();
 assert.ok(elapsed>400,'the ordinary defeat music, fade and stage card run');assert.equal(events.retries,1);assert.equal(events.gameovers,0);assert.equal(events.banners,1);assert.equal(stageID(p),stage);assert.equal(p.RAM[0x438],0);assert.ok(crew.state.bots.every(b=>b.alive));
 for(const actor of crew.state.bots)defeat(actor);completeAnimations();assert.equal(watch.retry(),true);assert.equal(p.RAM[0x438],0,'total defeat with zero stock cannot manufacture a life');
 for(let i=0;i<300&&!watch.state.finished;i++)step();
 assert.equal(events.gameovers,1);assert.equal(events.retries,1,'no additional team respawn after the last life');assert.equal(events.banners,1);assert.equal(p.VDC[0].SATB[2],918);assert.equal(p.RAM[0x438],255);assert.ok(events.music.includes(0x2a));assert.ok(events.music.includes(0x2b));assert.ok(events.black>0);assert.ok(crew.state.bots.every(b=>!b.alive&&b.deathFrame===DEATH_FRAMES));
 for(let i=0;i<90;i++)step();assert.equal(events.gameovers,1,'the terminal callback fires once');assert.equal(watch.retry(),false);
});

test('a shared online Extra Life revives both players once before the finite team stock is used',{skip:!rom},()=>{
 const {p,crew,watch,shared,events,step,defeat,completeAnimations}=setup(),[a,b]=crew.state.bots;p.RAM[0x438]=0;
 spawnItem(p,7,Math.floor(a.x/16),Math.floor(a.y/16));step();assert.equal(a.extraLives,1);assert.equal(b.extraLives,1);assert.equal(shared.state.powers.extraLives,1);assert.equal(p.RAM[0x438],0,'remote pickup does not also grant a native team retry');
 defeat(a);defeat(b);assert.equal(watch.retry(),false,'both collected revivals take priority over an all-dead team ending');
 for(let i=0;i<DEATH_FRAMES+2;i++)step();assert.ok(a.alive&&b.alive);assert.equal(a.extraLives,0);assert.equal(b.extraLives,0);assert.equal(shared.state.powers.extraLives,0);assert.equal(watch.state.transition,null);assert.equal(events.retries,0);assert.equal(events.gameovers,0);
 for(const actor of crew.state.bots)defeat(actor);completeAnimations();assert.equal(watch.retry(),true);assert.equal(p.RAM[0x438],0);
 for(let i=0;i<300&&!watch.state.finished;i++)step();assert.equal(events.gameovers,1);assert.equal(events.retries,0);
});

test('online final game-over save replays the title, life counter and single callback exactly',{skip:!rom},()=>{
 const s=setup(),{p,crew,watch,online,shared,events,step,defeat,completeAnimations}=s;p.RAM[0x438]=0;for(const actor of crew.state.bots)defeat(actor);completeAnimations();watch.retry();
 for(let i=0;i<220&&watch.state.transition?.phase!=='gameover';i++)step();assert.equal(watch.state.transition.phase,'gameover');validateSpectatorState(watch.state);assert.equal(events.gameovers,0);
 const saved={core:captureState(p),crew:structuredClone(crew.state),watch:structuredClone(watch.state),online:structuredClone(online.state),shared:structuredClone(shared.state),tracker:{...p._campaignTracker},events:structuredClone(events),inputFrame:s.inputFrame()};
 for(let i=0;i<80;i++)step();const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),crew:structuredClone(crew.state),watch:structuredClone(watch.state),online:structuredClone(online.state),shared:structuredClone(shared.state),events:structuredClone(events)};assert.equal(events.gameovers,1);
 restoreState(p,saved.core);crew.restore(saved.crew);watch.restore(saved.watch);online.restore(saved.online);shared.restore(saved.shared);Object.assign(p._campaignTracker,saved.tracker);Object.assign(events,saved.events);s.restoreInputFrame(saved.inputFrame);
 for(let i=0;i<80;i++)step();assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(p.ImageData.data,expected.pixels);assert.deepEqual(crew.state,expected.crew);assert.deepEqual(watch.state,expected.watch);assert.deepEqual(online.state,expected.online);assert.deepEqual(shared.state,expected.shared);assert.deepEqual(events,expected.events);
});
