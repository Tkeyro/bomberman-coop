import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,isCampaign,enemies,DEATH_FRAMES,campaignSpawnCells,stageID} from '../dist/campaign.js';
import {createWorldStart} from '../dist/world-start.js';
import {createIntroSkip} from '../dist/intro.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {colorizePlayer} from '../dist/session.js';
import {createSpectator} from '../dist/spectator.js';

const rom=process.env.BOMBERMAN_TEST_ROM;let bytes,baseline,baselineTracker;
function game(){
 bytes??=fs.readFileSync(rom);const p=createMachine(bytes),crew=createCompanions(p,{colorize:colorizePlayer}),start=createWorldStart(p),intro=createIntroSkip(p);
 if(!baseline){
  start.configure(7,7);intro.configure(true);intro.request();
  for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);
  let frame=0;for(;frame<1400&&(start.state.pending||intro.state.pending);frame++){intro.update();p.Run();}
  assert.ok(frame<1400);assert.equal(isCampaign(p),true);assert.equal(stageID(p),'7:7');assert.deepEqual(enemies(p).map(e=>e.type),[34,37,38,39,40]);
  baseline=captureState(p);baselineTracker={...p._campaignTracker};
 }else{restoreState(p,baseline);Object.assign(p._campaignTracker,baselineTracker);}
 // Keep the independent native human away from this collision/death experiment.
 p.RAM[0x43d]=p.RAM[0x43f]=p.RAM[0x43e]=p.RAM[0x440]=0;
 p.RAM[0x43a]|=128;p.RAM[0x446]=255;p.RAM[0x447]=127;
 const cell=campaignSpawnCells(p,1)[0],bot=crew.add(cell.x,cell.y);bot.cooldown=10000;
 const step=()=>{crew.update();p.Run();};return {p,crew,bot,step};
}
function bossHit(g){const boss=enemies(g.p).find(e=>e.type===34);assert.ok(boss);g.bot.x=boss.x;g.bot.y=boss.y;g.crew.update();assert.equal(g.bot.alive,false);assert.equal(g.bot.deathFrame,0);assert.equal(g.bot.action,'Defeated');}

test('native final boss contact plays all AI death poses and never grants a free revival',{skip:!rom},()=>{
 const g=game();bossHit(g);const position={x:g.bot.x,y:g.bot.y},phases=new Set();let collect=false,visible=0;
 const sprites=g.p.MakeSpriteLine;g.p.MakeSpriteLine=function(n){sprites.call(this,n);if(n===0&&collect)visible+=this.VDC[0].SPLine.filter(dot=>dot.data&&dot.no===64).length;};
 for(let frame=0;frame<DEATH_FRAMES;frame++){
  if(frame)g.crew.update();visible=0;collect=frame%8===2;g.p.Run();collect=false;
  assert.equal(g.bot.alive,false);assert.equal(g.bot.deathFrame,frame);assert.deepEqual({x:g.bot.x,y:g.bot.y},position);
  if(frame%8===2){assert.ok(visible>20,`final-arena death pose ${Math.floor(frame/8)} renders`);phases.add(Math.floor(frame/8));}
 }
 assert.equal(phases.size,13);g.crew.update();assert.equal(g.bot.deathFrame,DEATH_FRAMES);assert.equal(g.bot.extraLives,0);assert.equal(g.bot.alive,false);
 collect=true;visible=0;g.p.Run();collect=false;assert.equal(visible,0,'finished death has no lingering walking model');
 for(let i=0;i<200;i++)g.step();assert.equal(g.bot.alive,false);assert.equal(g.bot.deathFrame,DEATH_FRAMES);assert.equal(g.bot.extraLives,0);assert.equal(stageID(g.p),'7:7');assert.equal(g.crew.state.bots.length,1,'the defeated actor is not replaced by a new AI');
});

test('a final-boss AI revival waits for the full death animation, spends one extra life and replays a mid-death save',{skip:!rom},()=>{
 const g=game();g.bot.extraLives=1;bossHit(g);g.p.Run();for(let i=0;i<51;i++)g.step();assert.equal(g.bot.deathFrame,51);
 const saved=captureState(g.p),state=structuredClone(g.crew.state),tracker={...g.p._campaignTracker};
 const run=()=>{for(let i=52;i<DEATH_FRAMES;i++){g.step();const bot=g.crew.state.bots[0];assert.equal(bot.alive,false);assert.equal(bot.deathFrame,i);assert.equal(bot.extraLives,1);}g.step();const bot=g.crew.state.bots[0];assert.equal(bot.alive,true);assert.equal(bot.deathFrame,null);assert.equal(bot.extraLives,0);return {ram:[...g.p.RAM],pc:g.p.PC,pixels:Uint8ClampedArray.from(g.p.ImageData.data),crew:structuredClone(g.crew.state)};};
 const expected=run();restoreState(g.p,saved);g.crew.restore(state);Object.assign(g.p._campaignTracker,tracker);assert.deepEqual(run(),expected,'native boss and revival timing replay exactly');
 g.bot=g.crew.state.bots[0];bossHit(g);g.p.Run();for(let i=0;i<DEATH_FRAMES+8;i++)g.step();assert.equal(g.bot.alive,false);assert.equal(g.bot.extraLives,0);assert.equal(g.crew.state.events.filter(e=>e.text==='Used an extra life').length,1,'the spent life is never refunded');
});

test('an all-dead final-arena AI team finishes its death animation before the native round retry begins',{skip:!rom},()=>{
 const g=game();let retries=0;const watch=createSpectator(g.p,{getBots:()=>g.crew.state.bots,finiteLives:()=>true,onRetry:()=>{retries++;g.crew.reset();}});watch.configure(true);g.p.RAM[0x438]=1;
 bossHit(g);assert.equal(watch.retry(),false,'final boss defeat must not interrupt death frame zero');g.p.Run();
 for(let frame=1;frame<DEATH_FRAMES;frame++){g.crew.update();assert.equal(g.bot.deathFrame,frame);assert.equal(g.bot.alive,false);assert.equal(watch.retry(),false,`death frame ${frame} has not finished`);assert.equal(watch.state.transition,null);assert.equal(g.p.RAM[0x438],1);g.p.Run();}
 g.crew.update();assert.equal(g.bot.deathFrame,DEATH_FRAMES);assert.equal(watch.retry(),true);assert.equal(watch.state.transition.phase,'dying');assert.equal(g.p.RAM[0x438],1);
 let elapsed=0;for(;elapsed<1400&&watch.state.transition;elapsed++){g.crew.update();g.p.Run();}
 assert.ok(elapsed<1400);assert.ok(elapsed>400,'native death music, fade and stage card run');assert.equal(retries,1);assert.equal(watch.state.transition,null);assert.equal(g.p.RAM[0x438],0,'retry spends one real spare round');assert.equal(stageID(g.p),'7:7');assert.equal(g.crew.state.bots.length,0,'new round team is recreated only by the retry callback');
});
