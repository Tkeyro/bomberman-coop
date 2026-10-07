import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {launchSequence} from '../dist/battle-ai.js';
import {bombs,createCompanions,companionBombSlots,spawnBomb,spawnItem,tileKind} from '../dist/campaign.js';
import {createOnlineCampaign,ONLINE_INPUT as I} from '../dist/online-campaign.js';
import {captureState,restoreState} from '../dist/save-state.js';
import {createAdminBombs,validateAdminBombs} from '../dist/admin-bombs.js';
const rom=process.env.BOMBERMAN_TEST_ROM;

function fake(){
 const p={RAM:Array(8192).fill(0),VDC:[{SATB:Array(256).fill(0)}],_campaignTracker:{frame:0,last:0}};
 p.RAM[0x434]=32;p.RAM[0x435]=32;
 for(let y=1;y<32;y++)for(let x=2;x<32;x++)p.RAM[0x44a+y*32+x]=0xca;
 return {p,admin:createAdminBombs(p)};
}
function native({reserveCompanions=false}={}){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p),admin=createAdminBombs(p,{getReservedSlots:()=>reserveCompanions?crew.state.bots.flatMap(companionBombSlots):[]});
 for(const step of launchSequence('solo'))frames(p,step.frames,step.button?[[0,step.button]]:[]);frames(p,2520);
 for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=0;
 for(let slot=0;slot<40;slot++)p.RAM[0x84f+slot]=0;
 for(let slot=0;slot<25;slot++)p.RAM[0xf9b+slot]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 return {p,crew,admin};
}
const nativePool=p=>bombs(p).filter(bomb=>bomb.slot<10);
const reserve=(p,cells)=>cells.forEach(([x,y],slot)=>spawnBomb(p,x,y,{slots:[slot]}));

test('admin queue accepts every empty map tile, has no count cap, and rejects invalid or duplicate placements atomically',()=>{
 const {p,admin}=fake(),reserved=p.RAM.slice(0x859,0x877),beforeMap=p.RAM.slice(0x44a,0x84a);
 for(let y=1;y<32;y++)for(let x=2;x<32;x++)admin.add(x,y);
 assert.equal(nativePool(p).length,10);assert.equal(admin.state.pending.length,920,'all other floor tiles are accepted, rather than an arbitrary admin limit');
 assert.deepEqual(p.RAM.slice(0x859,0x877),reserved,'no enemy or companion bomb flag is allocated');assert.deepEqual(p.RAM.slice(0x44a,0x84a),beforeMap,'queued placements never write native map tiles');
 const untouched={ram:[...p.RAM],state:structuredClone(admin.state)};
 for(const cell of [[2,1],[12,1],[1,1],[32,1],[2,0],[2,32],[2.5,2]])assert.throws(()=>admin.add(...cell),/bomb|floor/);
 assert.deepEqual(p.RAM,untouched.ram);assert.deepEqual(admin.state,untouched.state);
 const saved=structuredClone(admin.state);validateAdminBombs(saved);admin.reset();admin.restore(saved);saved.pending[0].x=99;assert.notEqual(admin.state.pending[0].x,99,'restoration copies the queue');
 const state=structuredClone(admin.state),bad=[null,{...state,extra:1},{...state,stage:'8:0'},{...state,stage:null},{...state,pending:[{x:2,y:1},{x:2,y:1}]},{...state,pending:[{x:2,y:1,slot:40}]},{...state,pending:[{x:32,y:1}]},{...state,pending:[{x:2,y:1.5}]}];
 for(const data of bad){assert.throws(()=>admin.restore(data),/admin bomb queue/);assert.deepEqual(admin.state,state);assert.deepEqual(p.RAM,untouched.ram);}
});

test('blocked queue entries do not delay free cells, and stage, clear and same-stage death transitions discard pending placements',()=>{
 const {p,admin}=fake();reserve(p,Array.from({length:10},(_,i)=>[i+2,1]));admin.add(2,3);admin.add(4,3);
 p.RAM[0x44a+3*32+2]=0xc7;p.RAM[0x84f]=0;assert.equal(admin.update(),1);assert.deepEqual(admin.state.pending,[{x:2,y:3}]);assert.equal(p.RAM[0x877],4);assert.equal(p.RAM[0x89f],3);
 p.RAM[0x44a+3*32+2]=0xca;p.RAM[0x84f+1]=0;assert.equal(admin.update(),1);assert.equal(admin.state.pending.length,0);assert.equal(p.RAM[0x877+1],2);assert.equal(p.RAM[0x89f+1],3);
 for(const signal of ['death','clear','stage']){
  admin.add(6,3);assert.equal(admin.state.pending.length,1);
  const ram=[...p.RAM];if(signal==='death')p.RAM[0x43a]|=1;else if(signal==='clear')p.RAM[0x437]=1;else p.RAM[0x84b]++;
  const changed=[...p.RAM];assert.equal(admin.update(),0);assert.deepEqual(admin.state,{stage:null,pending:[]});assert.deepEqual(p.RAM,changed,'discarding stale pending placements does not clear existing native bombs');
  p.RAM=[...ram];
 }
 const before=[...p.RAM];p._campaignTracker.last=-100;assert.throws(()=>admin.add(7,3),/active campaign/);assert.deepEqual(p.RAM,before);assert.deepEqual(admin.state,{stage:null,pending:[]});
});

test('free native slots reserved for an online actor are excluded from the admin pool',()=>{
 const {p}=fake();delete p._adminBombs;let reserved=[0,1,2,3,4];const admin=createAdminBombs(p,{getReservedSlots:()=>reserved});
 for(let x=2;x<9;x++)admin.add(x,3);
 assert.deepEqual(nativePool(p).map(bomb=>bomb.slot),[5,6,7,8,9]);assert.deepEqual(p.RAM.slice(0x84f,0x854),Array(5).fill(0));assert.equal(admin.state.pending.length,2,'reserved free slots do not count as admin capacity');
 reserved=[];assert.equal(admin.update(),2,'a released actor reservation allows later native promotion');assert.equal(admin.state.pending.length,0);
});

test('native slots drain overflow through actual flames, block destruction and floor cleanup',{skip:!rom},()=>{
 const {p,admin}=native(),cells=[];
 // Isolated native chambers avoid unrelated chain reactions and leave the
 // human at the safe opening tile. There are sixteen separate placements.
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xc1;
 p.RAM[0x44a+32+2]=0xca;
 for(const y of [3,5,7,9])for(const x of [3,6,9,12]){cells.push([x,y]);p.RAM[0x44a+y*32+x]=0xca;}
 p.RAM[0x44a+3*32+13]=0xc2;p.RAM[0x84d]=1;
 for(const cell of cells)admin.add(...cell);
 assert.equal(nativePool(p).length,10);assert.equal(admin.state.pending.length,6);const pendingCells=structuredClone(admin.state.pending);
 assert.ok(pendingCells.every(cell=>tileKind(p,cell.x,cell.y)===10),'overflow has no collision before its native promotion');
 const flameCells=new Set();let promotionObserved=false;
 for(let frame=0;frame<650;frame++){
  const previous=admin.state.pending.length;admin.update();if(admin.state.pending.length<previous)promotionObserved=true;
  // Native bonus logic can reveal an item on an otherwise empty queued tile.
  // Have the native human collect it, then return him to his safe chamber.
  const pickup=admin.state.pending.find(cell=>tileKind(p,cell.x,cell.y)===7);
  if(pickup){p.RAM[0x43d]=pickup.x*16+8;p.RAM[0x43e]=0;p.RAM[0x43f]=pickup.y*16+8;p.RAM[0x440]=0;}
  p.Run();for(const [x,y]of cells)if([6,11,12].includes(tileKind(p,x,y)))flameCells.add(`${x},${y}`);
  if(pickup){p.RAM[0x43d]=40;p.RAM[0x43f]=24;}
  assert.ok(p.RAM.slice(0x859,0x877).every(flag=>flag===0),'admin allocation leaves all enemy and AI flags untouched');
 }
 assert.equal(promotionObserved,true);assert.equal(flameCells.size,cells.length,`every queued placement produces original native flames; missing ${cells.filter(([x,y])=>!flameCells.has(`${x},${y}`)).map(([x,y])=>`${x},${y} kind ${tileKind(p,x,y)}`).join('; ')}`);assert.equal(admin.state.pending.length,0);assert.equal(nativePool(p).length,0);
 for(const [x,y]of cells)assert.equal(tileKind(p,x,y),10,'all bomb centers return to ordinary floor');assert.equal(tileKind(p,13,3),10,'the promoted bomb still uses original block destruction');assert.equal(p.RAM[0x43a]&7,0,'the protected human remains alive');
});

test('native queue skips a spawned pickup and preserves player, enemy and companion fuses and saved replay',{skip:!rom},()=>{
 const {p,crew,admin}=native(),cells=Array.from({length:10},(_,i)=>[i+3,3]);reserve(p,cells);
 const enemy=spawnBomb(p,13,9,{slots:[10],automatic:true}),companion=spawnBomb(p,10,9,{slots:[20]});p.RAM[0x43a]|=16;
 const reserved=p.RAM.slice(0x859,0x877),ownedBefore=[...p.RAM];admin.add(3,7);admin.add(6,7);assert.deepEqual(p.RAM,ownedBefore,'overflow does not touch existing native records');assert.deepEqual(p.RAM.slice(0x859,0x877),reserved);
 const item=spawnItem(p,0,3,7);p.RAM[0x84f]=0;assert.equal(admin.update(),1);assert.deepEqual(admin.state.pending,[{x:3,y:7}]);assert.equal(p.RAM[0x877],6);assert.equal(p.RAM[0x89f],7);assert.ok(p.RAM[0xf9b+item]&128,'queued placements cannot erase an item');
 const fuses=[p.RAM[0x8ef+1],p.RAM[0x8ef+enemy],p.RAM[0x8ef+companion]];admin.update();assert.deepEqual([p.RAM[0x8ef+1],p.RAM[0x8ef+enemy],p.RAM[0x8ef+companion]],fuses);p.Run();assert.equal(p.RAM[0x8ef+1],fuses[0],'existing native human Remote Control remains held');assert.equal(p.RAM[0x8ef+enemy],fuses[1]-1);assert.equal(p.RAM[0x8ef+companion],fuses[2]-1);
 const checkpoint={save:captureState(p),queue:structuredClone(admin.state),crew:structuredClone(crew.state),tracker:{...p._campaignTracker}},advance=(machine,controller,count)=>{for(let frame=0;frame<count;frame++){controller.update();machine.Run();}};
 advance(p,admin,12);const expected={ram:[...p.RAM],pixels:Uint8ClampedArray.from(p.ImageData.data),pc:p.PC,queue:structuredClone(admin.state),crew:structuredClone(crew.state)};
 const fresh=createMachine(fs.readFileSync(rom)),freshCrew=createCompanions(fresh),freshAdmin=createAdminBombs(fresh);restoreState(fresh,checkpoint.save);freshCrew.restore(checkpoint.crew);freshAdmin.restore(checkpoint.queue);Object.assign(fresh._campaignTracker,checkpoint.tracker);advance(fresh,freshAdmin,12);
 assert.deepEqual(fresh.RAM,expected.ram);assert.deepEqual(fresh.ImageData.data,expected.pixels);assert.equal(fresh.PC,expected.pc);assert.deepEqual(freshAdmin.state,expected.queue);assert.deepEqual(freshCrew.state,expected.crew);
 // Continue both restored timelines through an actual item pickup, original
 // native detonation and later promotion, rather than only a waiting queue.
 for(const [machine,controller]of [[p,admin],[fresh,freshAdmin]]){
  machine.RAM[0x43d]=56;machine.RAM[0x43e]=0;machine.RAM[0x43f]=120;machine.RAM[0x440]=0;machine.Run();assert.equal(machine.RAM[0xf9b+item],0);machine.RAM[0x43d]=40;machine.RAM[0x43f]=24;
  machine.RAM[0x8ef+1]=0;advance(machine,controller,8);assert.equal(controller.state.pending.length,0,'a restored waiting bomb promotes after the item is collected and a native slot frees');
 }
 assert.deepEqual(fresh.RAM,p.RAM);assert.deepEqual(fresh.ImageData.data,p.ImageData.data);assert.equal(fresh.PC,p.PC);assert.deepEqual(freshAdmin.state,admin.state);assert.deepEqual(freshCrew.state,crew.state);
});

test('admin queue leaves the fifth online actor native bank free and preserves its independent remote bomb',{skip:!rom},()=>{
 const {p,crew,admin}=native({reserveCompanions:true}),actor=crew.add(9,7);actor.bombBank=4;actor.color='black';actor.remote=true;const other=crew.add(12,9);
 const online=createOnlineCampaign(p,{getActors:()=>crew.state.bots,getLocalID:()=>actor.id});online.configure(true,[{id:actor.id,color:actor.color,name:'Five'},{id:other.id,color:other.color,name:'Other'}]);
 for(const cell of [[3,3],[5,3],[7,3],[9,3],[11,3],[3,5]])admin.add(...cell);
 assert.deepEqual(nativePool(p).map(bomb=>bomb.slot),[5,6,7,8,9]);assert.ok(companionBombSlots(actor).every(slot=>p.RAM[0x84f+slot]===0),'admin placement leaves the complete fifth actor bank free');assert.equal(admin.state.pending.length,1);
 online.setInputs(0,[I.BOMB,0]);online.control(actor);assert.equal(p.RAM[0x84f],128);assert.equal(crew.state.bombColors[0],'black');const before=[...p.RAM];admin.update();assert.deepEqual(p.RAM,before,'a pending admin bomb does not overwrite a player bomb or its remote timer');
 online.setInputs(1,[0,0]);online.control(actor);p.Run();assert.ok(p.RAM[0x8ef]>100,'the fifth actor retains its held Remote Control bomb');
});
