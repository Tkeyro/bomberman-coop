import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,isCampaign,enemies,tileKind,campaignSpawnCells} from '../dist/campaign.js';
import {createWorldStart} from '../dist/world-start.js';
import {createNewCampaign,generateChallengeMap} from '../dist/new-campaign.js';
import {createLevelObjective} from '../dist/level-objective.js';
import {createIntroSkip} from '../dist/intro.js';
import {createOnlineCampaign} from '../dist/online-campaign.js';
import {createSpectator} from '../dist/spectator.js';
import {createAdminLevels,validateAdminLevels} from '../dist/admin-levels.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {nativeEnemyAtlas,nativeEnemyPose} from '../dist/enemy-icons.js';

const rom=process.env.BOMBERMAN_TEST_ROM;let bytes,baseline,baselineTracker;
function game({dlc=false,online=false}={}){
 bytes??=fs.readFileSync(rom);const p=createMachine(bytes),crew=createCompanions(p),generated=createNewCampaign(p,{onRound:()=>crew.respawnForStage()}),watch=createSpectator(p,{getBots:()=>crew.state.bots,finiteLives:()=>true,onRetry:()=>{throw new Error('Admin travel must not reset the existing team.');}}),goal=createLevelObjective(p),world=createWorldStart(p),intro=createIntroSkip(p),net=createOnlineCampaign(p,{getActors:()=>crew.state.bots});
 let arrivals=0;const levels=createAdminLevels(p,{worldStart:world,newCampaign:generated,levelObjective:goal,onArrive:()=>{arrivals++;crew.respawnForStage();}});
 if(!baseline){world.configure(0);intro.configure(true);intro.request();for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);for(let i=0;i<900&&(intro.state.pending||world.state.pending);i++){intro.update();p.Run();}assert.equal(isCampaign(p),true);baseline=captureState(p);baselineTracker={...p._campaignTracker};}
 else{restoreState(p,baseline);Object.assign(p._campaignTracker,baselineTracker);}
 goal.configure(true);watch.configure(online);generated.configure(dlc,3,12345);if(dlc)generated.update();
 if(online)net.configure(true,[{id:1,color:'black',name:'Host'},{id:2,color:'orange',name:'Guest'}]);
 const step=()=>{generated.update();net.update();crew.update();p.Run();};
 return {p,crew,generated,watch,goal,world,net,levels,step,get arrivals(){return arrivals;}};
}
function arrive(g,limit=2000){let count=0;for(;count<limit&&g.levels.state.pending;count++)g.step();assert.ok(count<limit,'native fade and loader complete');assert.ok(count>200,'native music/fade/card run');assert.equal(g.levels.state.pending,false);assert.equal(g.world.state.pending,false);assert.equal(isCampaign(g.p),true);assert.equal(g.goal.state.enabled,true);assert.equal(g.p.RAM[0x437],0);return count;}
const snapshot=g=>{const machine=captureState(g.p);machine.createdAt='2000-01-01T00:00:00.000Z';return {machine,tracker:{...g.p._campaignTracker},crew:structuredClone(g.crew.state),generated:structuredClone(g.generated.state),watch:structuredClone(g.watch.state),goal:structuredClone(g.goal.state),world:structuredClone(g.world.state),net:structuredClone(g.net.state),levels:structuredClone(g.levels.state)};};
function restore(g,s){restoreState(g.p,s.machine);g.crew.restore(s.crew);g.generated.restore(s.generated);g.watch.restore(s.watch);g.goal.restore(s.goal);g.world.restore(s.world);g.net.restore(s.net);g.levels.restore(s.levels);Object.assign(g.p._campaignTracker,s.tracker);}
function addCrew(g){for(const cell of campaignSpawnCells(g.p,2,{blocked:new Set(['2,1'])})){const actor=g.crew.add(cell.x,cell.y);Object.assign(actor,{color:actor.id===1?'black':'orange',fireRange:3,bombCapacity:4,speedUp:true,remote:true,bombPass:true,wallPass:true,extraLives:2,fireproof:3600});}return g.crew.state.bots.map(({id,color,bombBank,fireRange,bombCapacity,speedUp,remote,bombPass,wallPass,extraLives})=>({id,color,bombBank,fireRange,bombCapacity,speedUp,remote,bombPass,wallPass,extraLives}));}
function identities(g){return g.crew.state.bots.map(({id,color,bombBank,fireRange,bombCapacity,speedUp,remote,bombPass,wallPass,extraLives})=>({id,color,bombBank,fireRange,bombCapacity,speedUp,remote,bombPass,wallPass,extraLives}));}
function finalArenaAssets(p){
 assert.deepEqual(enemies(p).map(e=>e.type),[34,37,38,39,40],'all original final-arena boss parts are initialized');
 const atlas=nativeEnemyAtlas(p,34);for(const sprite of nativeEnemyPose(p,34)){const width=sprite.attribute&256?32:16,height=sprite.attribute&8192?64:sprite.attribute&4096?32:16,base=(sprite.pattern&p.SPAddressMask[width][height])<<5;for(let y=0;y<height;y++)for(let x=0;x<width;x+=16)for(let plane=0;plane<4;plane++){const index=(base|((y&48)<<3)|(y&15)|((x&16)<<2))+plane*16;assert.equal(p.VDC[0].VRAM[index],atlas.vram[index],'native final boss graphics have loaded before travel completes');}}
}

test('original admin travel reaches every world and boss arena through native load with upgrades and living roster retained',{skip:!rom},()=>{
 const g=game({online:true}),expected=addCrew(g),p=g.p;p.RAM[0x438]=5;p.RAM[0x84c]=132;p.RAM[0x84d]=131;p.RAM[0x84e]=1;p.RAM[0x43a]=240;p.RAM[0x446]=16;p.RAM[0x447]=14;
 const before=snapshot(g);
 for(let world=0;world<8;world++)for(let area=0;area<8;area++){
  restore(g,before);assert.ok(enemies(p).length,'the jump bypasses living enemies');g.levels.jumpOriginal(world,area);assert.equal(g.goal.state.enabled,false);const elapsed=arrive(g);
  assert.deepEqual(p.RAM.slice(0x84a,0x84c),[world,area]);assert.ok(enemies(p).length,'native target monsters are initialized');assert.equal(p.RAM[0x438],5,'admin travel spends no life');assert.equal(p.RAM[0x84c],132);assert.equal(p.RAM[0x84d],131);assert.equal(p.RAM[0x84e],1);assert.equal(p.RAM[0x43a]&112,112);assert.deepEqual(identities(g),expected);
  if(world===7&&area===7)finalArenaAssets(p);
  for(const actor of g.crew.state.bots){assert.equal(actor.alive,true);assert.equal(tileKind(p,Math.floor(actor.x/16),Math.floor(actor.y/16)),10,'actors return to fresh safe floor');assert.equal(actor.target,null);}
  assert.ok(elapsed<2000);assert.equal(g.watch.state.enabled,true);assert.equal(g.watch.state.transition,null);assert.equal(g.goal.state.phase,'waiting');assert.equal(g.goal.state.stage,`${world}:${area}`,'the old goal is replaced by the target stage');
 }
 // A same-stage travel must rebuild positions, not retain an admin bot in a
 // corridor that becomes a newly randomized soft wall.
 restore(g,before);const actor=g.crew.state.bots[0];actor.x=200;actor.y=152;g.levels.jumpOriginal(0,0);arrive(g);assert.ok(g.crew.state.bots.every(a=>tileKind(p,Math.floor(a.x/16),Math.floor(a.y/16))===10));assert.deepEqual(identities(g),expected);
});

test('admin travel can leave the final boss arena without committing the ending',{skip:!rom},()=>{
 const g=game();g.p.RAM[0x43a]=128;g.p.RAM[0x446]=255;g.p.RAM[0x447]=127;g.levels.jumpOriginal(7,7);arrive(g);finalArenaAssets(g.p);const startX=g.p.RAM[0x43d];frames(g.p,20,[[0,'RIGHT']]);assert.ok(g.p.RAM[0x43d]>startX,'native human can walk immediately in the final arena');assert.equal(isCampaign(g.p),true);assert.equal(g.p.RAM[0x43a]&7,0);g.levels.jumpOriginal(2,6);arrive(g);assert.deepEqual(g.p.RAM.slice(0x84a,0x84c),[2,6]);assert.ok(enemies(g.p).length);
});

test('DLC admin travel regenerates the selected round, preserves seed/players/AI upgrades, then advances normally',{skip:!rom},()=>{
 const g=game({dlc:true}),expected=addCrew(g);g.p.RAM[0x438]=4;const old=snapshot(g);
 for(const round of [1,9,1000000]){
  restore(g,old);g.levels.jumpDLC(round);arrive(g);const map=generateChallengeMap(12345,round,3);
  assert.equal(g.generated.state.enabled,true);assert.equal(g.generated.state.ready,true);assert.equal(g.generated.state.round,round);assert.equal(g.generated.state.seed,12345);assert.equal(g.generated.state.players,3);assert.equal(g.p.RAM[0x434],map.width);assert.equal(g.p.RAM[0x435],map.height);assert.equal(tileKind(g.p,map.exit.x,map.exit.y),4);assert.equal(enemies(g.p).length,map.monsters.length);assert.equal(g.p.RAM[0x438],4);assert.deepEqual(identities(g),expected);
  assert.ok(g.crew.state.bots.every(a=>tileKind(g.p,Math.floor(a.x/16),Math.floor(a.y/16))===10));
 }
 restore(g,old);g.levels.jumpDLC(17);arrive(g);for(let i=0;i<32;i++)g.p.RAM[0xd98+i]=0;g.p.RAM[0xd96]=1;g.goal.state.phase='collected';g.goal.state.x=4;g.goal.state.y=1;g.goal.state.slot=null;g.p.RAM[0x437]=1;g.step();assert.ok(g.generated.state.transition);for(let i=0;i<900&&g.generated.state.transition;i++)g.step();assert.equal(g.generated.state.round,18);assert.equal(g.generated.state.transition,null);assert.equal(g.generated.state.enabled,true);
});

test('pending and loading admin jumps replay exactly in a new native machine including disabled clear gates',{skip:!rom},()=>{
 for(const dlc of [false,true]){
  const source=game({dlc,online:!dlc});addCrew(source);dlc?source.levels.jumpDLC(12):source.levels.jumpOriginal(5,4);
  for(const phase of ['dying','loading']){
   if(phase==='loading'){let i=0;for(;i<900&&source.levels.state.phase!=='loading';i++)source.step();assert.ok(i<900);}
   assert.equal(source.levels.state.phase,phase);const saved=snapshot(source),peer=game({dlc,online:!dlc});restore(peer,saved);
   for(let i=0;i<1000;i++){source.step();peer.step();assert.deepEqual(peer.levels.state,source.levels.state);}
   assert.deepEqual(peer.p.RAM,source.p.RAM);assert.equal(peer.p.PC,source.p.PC);assert.deepEqual(peer.p.MPR,source.p.MPR);assert.deepEqual(peer.p.ImageData.data,source.p.ImageData.data);assert.deepEqual(peer.crew.state,source.crew.state);assert.deepEqual(peer.generated.state,source.generated.state);assert.deepEqual(peer.goal.state,source.goal.state);assert.deepEqual(peer.world.state,source.world.state);assert.deepEqual(peer.net.state,source.net.state);assert.equal(source.levels.state.pending,false);
   restore(source,saved);
  }
 }
});

test('invalid destinations and family switches do not mutate paused game state',{skip:!rom},()=>{
 const g=game(),saved=snapshot(g);
 for(const [world,area]of [[-1,0],[8,0],[1,8],[0,-1],[1.5,0],[0,'1']])assert.throws(()=>g.levels.jumpOriginal(world,area),/stage/);
 for(const round of [0,-1,1000001,1.5,'2'])assert.throws(()=>g.levels.jumpDLC(round),/round/);
 assert.throws(()=>g.levels.jumpDLC(4),/family/);assert.deepEqual(snapshot(g),saved);
 g.levels.jumpOriginal(2,4);const queued=snapshot(g);assert.throws(()=>g.levels.jumpOriginal(3,0),/active campaign/);assert.deepEqual(snapshot(g),queued);
 const malformed=structuredClone(g.levels.state);malformed.human.flags=17;assert.throws(()=>g.levels.restore(malformed),/upgrades/);assert.deepEqual(snapshot(g),queued);
 assert.throws(()=>validateAdminLevels({pending:false,phase:null,target:null,objectiveEnabled:true,human:null}),/idle/);
});
