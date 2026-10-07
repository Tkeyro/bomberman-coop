import test from 'node:test';
import assert from 'node:assert/strict';
import {createMachine} from '../scripts/headless.mjs';
import {COLORS} from '../dist/session.js';
import {AI_COLOR_CYCLE,DEATH_FRAMES,companionBombSlots,createCompanions,spawnBomb,validateCompanionState} from '../dist/campaign.js';

const expectedCycle=['original','black','blue','green','red','violet','orange','yellow'];
function setup({online=false}={}){
 const p=createMachine(new Uint8Array(262144));
 const crew=createCompanions(p,{getHuman:()=>null});
 p.RAM.fill(0);p.RAM[0x434]=15;p.RAM[0x435]=12;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 p._campaignTracker.frame=0;p._campaignTracker.last=0;
 if(online)p._onlineCampaign={state:{enabled:true}};
 return {p,crew};
}
function remove(bot){bot.alive=false;bot.deathFrame=DEATH_FRAMES;}

test('successful AI additions cycle all eight colors in order, then wrap even after old actors are removed',()=>{
 assert.deepEqual(AI_COLOR_CYCLE,expectedCycle);
 assert.deepEqual([...AI_COLOR_CYCLE].sort(),Object.keys(COLORS).sort());
 const {crew}=setup();
 for(let i=0;i<17;i++){
  const bot=crew.add(3,1);
  assert.equal(bot.color,expectedCycle[i%8],`AI addition ${i+1}`);
  assert.equal(bot.id,i+1);assert.equal(crew.state.colorCursor,(i+1)%8);
  assert.equal(crew.state.bots.length,1,'completed death animations do not keep previous actors in the roster');
  remove(bot);
 }
});

test('failed additions do not consume colors, IDs, or reserved bomb banks',()=>{
 for(const online of [false,true]){
  const {p,crew}=setup({online});
  const capacity=online?5:4;
  for(let i=0;i<capacity;i++)crew.add(i+3,1);
  const saved=structuredClone(crew.state),ram=[...p.RAM];
  assert.throws(()=>crew.add(9,1),/Maximum teammates/);
  assert.deepEqual(crew.state,saved);assert.deepEqual(p.RAM,ram);
  const dying=crew.state.bots[0];dying.alive=false;dying.deathFrame=DEATH_FRAMES-1;
  assert.throws(()=>crew.add(9,1),/Maximum teammates/,'a visible death animation still occupies its bank');
  assert.equal(crew.state.colorCursor,capacity);remove(dying);
  assert.equal(crew.add(9,1).color,expectedCycle[capacity],'the next successful addition keeps the unconsumed color');
 }
 const {p,crew}=setup();
 for(const kind of [0,1,2,7,8,11]){
  p.RAM[0x44a+32+3]=0xc0|kind;
  const saved=structuredClone(crew.state),ram=[...p.RAM];
  assert.throws(()=>crew.add(3,1),/empty floor/);
  assert.deepEqual(crew.state,saved);assert.deepEqual(p.RAM,ram);
 }
 p.RAM[0x44a+32+3]=0xca;
 for(const bank of [0,1,2,3])for(const slot of companionBombSlots({bombBank:bank}))p.RAM[0x84f+slot]=128;
 const saved=structuredClone(crew.state),ram=[...p.RAM];
 assert.throws(()=>crew.add(3,1),/previous teammate bombs/);
 assert.deepEqual(crew.state,saved);assert.deepEqual(p.RAM,ram);
 for(const slot of companionBombSlots({bombBank:2}))p.RAM[0x84f+slot]=0;
 const bot=crew.add(3,1);assert.equal(bot.color,'original');assert.equal(bot.bombBank,2);assert.equal(crew.state.colorCursor,1);
});

test('explicit online human colors do not advance the AI color cycle and each actor retains its bomb ownership',()=>{
 const {p,crew}=setup({online:true});
 for(const color of ['pink',null,3]){
  const before=structuredClone(crew.state);
  assert.throws(()=>crew.add(3,1,{color}),/Unknown Bomberman color/);
  assert.deepEqual(crew.state,before,'invalid explicit colors do not alter the next AI color or its ID');
 }
 const human=crew.add(3,1,{color:'violet'});
 assert.equal(human.color,'violet');assert.equal(crew.state.colorCursor,0);
 const white=crew.add(4,1),otherHuman=crew.add(5,1,{color:'red'}),black=crew.add(6,1);
 assert.equal(white.color,'original');assert.equal(otherHuman.color,'red');assert.equal(black.color,'black');assert.equal(crew.state.colorCursor,2);
 for(const actor of [human,white,otherHuman,black]){
  const slot=spawnBomb(p,Math.floor(actor.x/16),Math.floor(actor.y/16),{slots:companionBombSlots(actor),automatic:true});
  assert.equal(crew.state.bombColors[slot],actor.color);
 }
 assert.equal(new Set(crew.state.bots.map(bot=>bot.bombBank)).size,4,'actors keep independent bomb banks');
 assert.equal(crew.state.colorCursor,2,'bomb placements do not affect future AI colors');
});

test('saves preserve the next color, legacy saves derive it, and invalid cursor restoration is atomic',()=>{
 const {crew}=setup();
 for(let i=0;i<11;i++)remove(crew.add(3,1));
 const saved=structuredClone(crew.state);assert.equal(saved.colorCursor,3);assert.equal(saved.nextID,12);
 validateCompanionState(saved);
 const {crew:fresh}=setup();fresh.restore(saved);
 assert.deepEqual(fresh.state,saved);assert.equal(fresh.add(4,1).color,'green');assert.equal(saved.colorCursor,3,'restore does not mutate the supplied save');
 const legacy=structuredClone(saved);delete legacy.colorCursor;
 fresh.restore(legacy);assert.equal(fresh.state.colorCursor,(legacy.nextID-1)%8);assert.equal(fresh.add(5,1).color,'green');
 for(const cursor of [-1,8,1.5,null,'1',NaN,Infinity,true]){
  const invalid={...saved,colorCursor:cursor},before=structuredClone(fresh.state);
  assert.throws(()=>validateCompanionState(invalid),/color|teammate/);
  assert.throws(()=>fresh.restore(invalid),/color|teammate/);
  assert.deepEqual(fresh.state,before);
 }
});

test('round retry reset preserves the cycle when requested, while a new game resets it to white',()=>{
 const {crew}=setup();
 for(let i=0;i<5;i++)remove(crew.add(3,1));
 crew.reset({preserveColorCycle:true});
 assert.equal(crew.state.colorCursor,5);assert.equal(crew.state.bots.length,0);assert.equal(crew.state.nextID,1);assert.equal(crew.state.stage,null);
 assert.equal(crew.add(3,1).color,'violet');assert.equal(crew.state.colorCursor,6);
 crew.reset();assert.equal(crew.state.colorCursor,0);assert.equal(crew.add(3,1).color,'original');
});

test('moving the roster to a new stage preserves assigned colors, the next color, and independent inventories',()=>{
 const {p,crew}=setup();
 for(const x of [3,4,5])crew.add(x,1);
 crew.state.bots.forEach((bot,i)=>{bot.x=200+i*16;bot.y=120;bot.bombCapacity=2+i;bot.fireRange=3;});
 const identities=crew.state.bots.map(({id,color,bombBank,bombCapacity,fireRange})=>({id,color,bombBank,bombCapacity,fireRange}));
 p.RAM[0x84b]=1;
 assert.equal(crew.respawnForStage(),true);assert.equal(crew.state.stage,'0:1');assert.equal(crew.state.colorCursor,3);
 assert.deepEqual(crew.state.bots.map(({id,color,bombBank,bombCapacity,fireRange})=>({id,color,bombBank,bombCapacity,fireRange})),identities);
 assert.ok(crew.state.bots.every(bot=>bot.alive&&bot.x<120&&bot.y<90));
 assert.equal(crew.add(7,1).color,'green');
});
