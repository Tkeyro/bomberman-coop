import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,spawnItem,spawnBomb,playerPosition,DEATH_FRAMES,isCampaign} from '../dist/campaign.js';
import {launchSequence} from '../dist/battle-ai.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {createSharedPowerups,validateSharedPowerups} from '../dist/shared-powerups.js';
import {createPowerupHUD} from '../dist/powerup-hud.js';

const rom=process.env.BOMBERMAN_TEST_ROM;
function fixture(){
 const p=createMachine(fs.readFileSync(rom));let human=true;const seen=[];
 const crew=createCompanions(p,{getHuman:()=>human?playerPosition(p):null});
 const hud=createPowerupHUD(p,{getHuman:()=>human?playerPosition(p):null});hud.configure(true);
 const shared=createSharedPowerups(p,{getActors:()=>crew.state.bots,getHuman:()=>human?playerPosition(p):null,onCollect(type,source){seen.push([type,source?.id??null]);if(source&&human)hud.state.counts[type]++;}});
 for(const step of launchSequence('solo'))frames(p,step.frames,step.button?[[0,step.button]]:[]);frames(p,2520);
 for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 for(let i=0;i<25;i++)p.RAM[0xf9b+i]=0;
 for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;
 for(let x=2;x<15;x++)p.RAM[0x44a+32+x]=0xca;
 const base=captureState(p),tracker={...p._campaignTracker};
 function reset(enabled=true){restoreState(p,base);Object.assign(p._campaignTracker,tracker);crew.reset();shared.configure(enabled);hud.configure(true);seen.length=0;human=true;}
 reset();return {p,crew,shared,hud,seen,reset,setHuman:value=>{human=value;}};
}
function native(p){return {fireRange:p.RAM[0x84d]&127,bombCapacity:p.RAM[0x84c]&127,speedUp:!!p.RAM[0x84e],remote:!!(p.RAM[0x43a]&16),bombPass:!!(p.RAM[0x43a]&32),wallPass:!!(p.RAM[0x43a]&64),fireproof:p.RAM[0x446]|p.RAM[0x447]<<8,extraLives:p.RAM[0x438]};}
const property=['fireRange','bombCapacity','remote','speedUp','bombPass','wallPass','fireproof','extraLives'];

test('shared pickup save validation rejects unknown fields and unsafe effects',()=>{
 const p=createMachine(new Uint8Array(262144)),shared=createSharedPowerups(p);shared.configure(true);
 shared.state.counts[0]=3;shared.state.powers.fireRange=4;shared.state.pending={type:1,slot:24,stack:251,returnPC:0x83c0,bank:9};
 const saved=structuredClone(shared.state);validateSharedPowerups(saved);shared.configure(false);shared.restore(saved);assert.deepEqual(shared.state,saved);
 for(const invalid of [{...saved,extra:true},{...saved,counts:Array(14).fill(0)},{...saved,counts:Array(15).fill(1000001)},{...saved,powers:{...saved.powers,fireRange:0}},{...saved,powers:{...saved.powers,bombCapacity:6}},{...saved,powers:{...saved.powers,remote:1}},{...saved,powers:{...saved.powers,fireproof:3601}},{...saved,pending:{type:8,slot:0}},{...saved,pending:{type:1,slot:25}},{...saved,enabled:false}])assert.throws(()=>validateSharedPowerups(invalid),/shared/);
 shared.restore(undefined);assert.equal(shared.state.enabled,true);assert.deepEqual(shared.state.counts,Array(15).fill(0));assert.equal(shared.state.pending,null);
});

test('native human rewards reach every campaign teammate once, preserve caps and do not share curses or burned items',{skip:!rom},()=>{
 const {p,crew,shared,hud,seen,reset}=fixture();
 for(let type=0;type<15;type++){
  reset();const first=shared.inherit(crew.add(8,1)),second=shared.inherit(crew.add(10,1));
  const slot=spawnItem(p,type,2,1);frames(p,2);assert.equal(p.RAM[0xf9b+slot],0);
  if(type===8){assert.deepEqual(shared.state.counts,Array(15).fill(0));assert.equal(seen.length,0);assert.equal(first.speedUp,false);continue;}
  assert.equal(shared.state.pending,null,`native item ${type} completes its reward tail`);assert.equal(shared.state.counts[type],1);assert.deepEqual(seen,[[type,null]]);assert.equal(hud.state.counts[type],1,'native HUD counts the human only once');
  assert.equal(first.pickupsCollected,1);assert.equal(second.pickupsCollected,1);
  if(type<8){const field=property[type],value=type<2?2:type===6?3600:type===7?1:true;assert.equal(first[field],value);assert.equal(second[field],value);if(type!==7&&type!==6)assert.equal(native(p)[field],value);}
  frames(p,3);assert.equal(shared.state.counts[type],1,'no pickup is repeated in later frames');
 }
 reset();const capped=crew.add(8,1);capped.fireRange=capped.bombCapacity=5;shared.inherit(capped);p.RAM[0x84c]=p.RAM[0x84d]=5;
 for(const type of [0,1]){spawnItem(p,type,2,1);frames(p,2);assert.equal(native(p)[property[type]],5);assert.equal(capped[property[type]],5);assert.equal(shared.state.counts[type],1);}
 p.RAM[0x438]=255;capped.extraLives=255;spawnItem(p,7,2,1);frames(p,2);assert.equal(p.RAM[0x438],255,'shared Extra Life cannot wrap native lives to zero');assert.equal(capped.extraLives,255);
 reset();const other=crew.add(8,1);spawnItem(p,0,4,1);spawnBomb(p,5,1,{automatic:true});frames(p,200);assert.equal(shared.state.counts[0],0);assert.equal(other.fireRange,1,'fire destruction never broadcasts a pickup');
});

test('bot rewards upgrade the human and other actors without doubling the collector, and solo retains independent powers',{skip:!rom},()=>{
 const {p,crew,shared,hud,seen,reset,setHuman}=fixture();
 for(let type=0;type<8;type++){
  reset();const collector=shared.inherit(crew.add(3,1)),friend=shared.inherit(crew.add(10,1));collector.cooldown=friend.cooldown=1000;
  const slot=spawnItem(p,type,3,1);crew.update();assert.equal(p.RAM[0xf9b+slot],0);assert.equal(shared.state.counts[type],1);assert.equal(hud.state.counts[type],1);assert.deepEqual(seen,[[type,collector.id]]);
  const field=property[type],value=type<2?2:type===6?3600:type===7?1:true;assert.equal(collector[field],value);assert.equal(friend[field],type===6?3599:value,'a later-updated teammate consumes one vest frame');assert.equal(collector.pickupsCollected,1);assert.equal(friend.pickupsCollected,1);
  assert.equal(native(p)[field],type===7?3:value);
  p.Run();crew.update();assert.equal(shared.state.counts[type],1);
 }
 reset(false);const alone=crew.add(3,1),separate=crew.add(10,1);spawnItem(p,0,3,1);crew.update();assert.equal(alone.fireRange,2);assert.equal(separate.fireRange,1);assert.equal(native(p).fireRange,1);assert.deepEqual(shared.state.counts,Array(15).fill(0));
 p.RAM[0x84c]=5;spawnItem(p,1,2,1);frames(p,2);assert.equal(native(p).bombCapacity,6,'original SOLO retains its native ten-bomb cap');assert.equal(alone.bombCapacity,1);
 reset();setHuman(false);const watched=crew.add(3,1),partner=crew.add(10,1);spawnItem(p,2,3,1);crew.update();assert.equal(watched.remote,true);assert.equal(partner.remote,true);assert.equal(native(p).remote,false,'a hidden primary character is not rewarded in AI-only or remote mode');
 const later=shared.inherit(crew.add(12,1));assert.equal(later.remote,true,'late actors inherit current team upgrades');
 partner.alive=false;partner.deathFrame=DEATH_FRAMES;spawnItem(p,7,3,1);crew.update();assert.equal(watched.extraLives,1);assert.equal(partner.alive,true,'a defeated teammate receives the shared extra life and can revive');assert.equal(partner.extraLives,0,'the revived teammate spends its own granted life');
 p.RAM[0x437]=1;shared.update();assert.equal(shared.state.powers.extraLives,0,'spent lives are retained even while a stage-clear transition begins');p.RAM[0x437]=0;crew.reset();const nextRound=crew.add(8,1);assert.equal(nextRound.remote,true);assert.equal(nextRound.extraLives,0,'a fresh round does not refund the life consumed in the previous round');
 reset();const legacyCollector=crew.add(3,1),legacyFriend=crew.add(10,1);legacyCollector.fireRange=1;legacyFriend.fireRange=4;p.RAM[0x84d]=4;shared.state.powers.fireRange=1;spawnItem(p,0,3,1);crew.update();assert.equal(legacyCollector.fireRange,5);assert.equal(legacyFriend.fireRange,5);assert.equal(native(p).fireRange,5,'the first shared pickup after a legacy save rewards the stronger actors and never downgrades them');
});

test('mid-handler and active-team saves replay shared rewards, native powers and pixels exactly',{skip:!rom},()=>{
 const {p,crew,shared,hud}=fixture();const bot=shared.inherit(crew.add(9,1));bot.cooldown=1000;spawnItem(p,0,2,1);
 let instructionCount=0;while(!shared.state.pending&&instructionCount++<100000)p.CPURun();assert.ok(shared.state.pending,'save taken after native clears the item, before granting its effect');
 const checkpoint={machine:captureState(p),crew:structuredClone(crew.state),shared:structuredClone(shared.state),hud:structuredClone(hud.state),tracker:{...p._campaignTracker}};
 const complete=()=>{for(let n=0;n<1000&&shared.state.pending;n++)p.CPURun();assert.equal(shared.state.pending,null);};
 complete();const reward={machine:captureState(p),crew:structuredClone(crew.state),shared:structuredClone(shared.state),hud:structuredClone(hud.state)};
 restoreState(p,checkpoint.machine);crew.restore(checkpoint.crew);shared.restore(checkpoint.shared);hud.restore(checkpoint.hud);Object.assign(p._campaignTracker,checkpoint.tracker);complete();const replay=captureState(p);assert.deepEqual(replay.state,reward.machine.state);assert.deepEqual(replay.screen,reward.machine.screen);assert.deepEqual(crew.state,reward.crew);assert.deepEqual(shared.state,reward.shared);assert.deepEqual(hud.state,reward.hud);
 spawnItem(p,6,9,1);crew.update();p.Run();const save={machine:captureState(p),crew:structuredClone(crew.state),shared:structuredClone(shared.state),hud:structuredClone(hud.state),tracker:{...p._campaignTracker}};
 const advance=count=>{for(let i=0;i<count;i++){crew.update();shared.update();hud.update();p.Run();}};
 advance(31);const expected={ram:[...p.RAM],crew:structuredClone(crew.state),shared:structuredClone(shared.state),hud:structuredClone(hud.state),pixels:Uint8ClampedArray.from(p.ImageData.data)};
 restoreState(p,save.machine);crew.restore(save.crew);shared.restore(save.shared);hud.restore(save.hud);Object.assign(p._campaignTracker,save.tracker);advance(31);assert.deepEqual(p.RAM,expected.ram);assert.deepEqual(crew.state,expected.crew);assert.deepEqual(shared.state,expected.shared);assert.deepEqual(hud.state,expected.hud);assert.deepEqual(p.ImageData.data,expected.pixels);
});

test('native campaign death and retry restore shared upgrades without refunding a native life',{skip:!rom},()=>{
 const {p,crew,shared}=fixture(),bot=crew.add(9,1);
 for(let type=0;type<7;type++){spawnItem(p,type,2,1);frames(p,2);}
 const expected=structuredClone(shared.state.powers),lives=p.RAM[0x438];assert.equal(expected.fireRange,2);assert.equal(expected.bombCapacity,2);assert.equal(bot.remote,true);
 p.RAM[0x43a]|=1;p.RAM[0x43c]=0;let loading=false,elapsed=0;
 for(;elapsed<900;elapsed++){
  const dying=p.RAM[0x43a]&7;shared.update();if(dying)assert.equal(p.RAM[0x43a]&7,dying,'shared upgrades do not overwrite native dying flags');
  p.Run();if(!isCampaign(p))loading=true;
  if(loading&&isCampaign(p)&&!(p.RAM[0x43a]&7)){shared.update();break;}
 }
 assert.ok(elapsed<900,'native death music, fades, stage card and reload complete');assert.ok(elapsed>100,'the complete native retry runs before restoring upgrades');
 const human=native(p);for(const field of ['fireRange','bombCapacity','remote','speedUp','bombPass','wallPass'])assert.equal(human[field],expected[field]);assert.ok(human.fireproof>0);assert.equal(p.RAM[0x438],lives-1,'the native retry consumes exactly one life');assert.equal(shared.state.counts[7],0,'restoring team powers does not collect a life item');
});
