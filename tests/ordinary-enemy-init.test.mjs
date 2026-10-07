import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {launchSequence} from '../dist/battle-ai.js';
import {installCampaignTracker,enemies,spawnEnemyType,spawnBomb} from '../dist/campaign.js';
import {captureState,restoreState} from '../dist/save-state.js';

const rom=process.env.BOMBERMAN_TEST_ROM;
const fields=[0xd98,0xdb8,0xdd8,0xdf8,0xe18,0xe38,0xe58,0xe78,0xe98,0xeb8,0xed8,0xef8,0xf18,0xf38,0xf58,0xf78,0x11e6,0x1206,0x1226,0x1246,0x1266,0x1333,0x1353];
let fixture;
function reset(){
 if(!fixture){
  const p=createMachine(fs.readFileSync(rom));installCampaignTracker(p);
  for(const action of launchSequence('solo'))frames(p,action.frames,action.button?[[0,action.button]]:[]);
  frames(p,2520);fixture={p,save:captureState(p),tracker:{...p._campaignTracker}};
 }
 const {p,save,tracker}=fixture;restoreState(p,save);Object.assign(p._campaignTracker,tracker);delete p._enemySpawns;
 for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=0;
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 return p;
}
function nativeInitializer(p,type){
 for(const base of fields)p.RAM[base]=0;
 // Execute the original ordinary-enemy initializer itself. Its caller supplies
 // position, animation phase and direction; no recovered speed constants are
 // copied into this reference implementation.
 p.RAM[0x213]=104;p.RAM[0x214]=0;p.RAM[0x215]=88;p.RAM[0x216]=0;
 p.RAM[0xd94]=0;p.RAM[0xd93]=0x42;p.A=type;p.X=p.Y=0;p.PC=0xa3cc;
 let instructions=0;while(p.PC!==0xa415&&instructions++<100)p.OpExec();
 assert.equal(p.PC,0xa415,'the original initializer reaches its return');
 return fields.map(base=>p.RAM[base]);
}

test('ordinary species initialize exactly like the original ROM without a living template',{skip:!rom},()=>{
 for(let type=0;type<23;type++){
  const native=nativeInitializer(reset(),type),p=reset();p.RAM[0xd96]=1;
  const registered=[];p._enemySpawns={register:(slot,species)=>registered.push([slot,species])};
  const slot=spawnEnemyType(p,type,6,5);
  assert.equal(slot,0);assert.deepEqual(fields.map(base=>p.RAM[base+slot]),native,`native initializer for species ${type}`);
  assert.deepEqual(enemies(p),[{slot:0,type,x:104,y:88}]);assert.equal(p.RAM[0xd96],0,'adding a creature relocks the exit');
  assert.deepEqual(registered,[[slot,type]],'the renderer receives this species independently of its native stage');
 }
});

test('every ordinary species moves through native AI and dies to one real native bomb',{skip:!rom},()=>{
 for(let type=0;type<23;type++){
  let p=reset(),slot=spawnEnemyType(p,type,6,5);const positions=new Set();
  for(let frame=0;frame<240;frame++){
   p.Run();const enemy=enemies(p).find(actor=>actor.slot===slot);if(enemy)positions.add(`${enemy.x},${enemy.y}`);
   if(p.RAM[0x43a]&7)break;
  }
  assert.ok(positions.size>3,`species ${type} moves with its original native behavior`);
  assert.ok(p.RAM[0xd98+slot]&128);assert.equal(p.RAM[0xeb8+slot],type);
  // A two-cell chamber keeps the creature within the actual bomb's blast.
  // Hard walls also contain the native wall-pass species.
  p=reset();for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xc1;
  p.RAM[0x44a+32+2]=p.RAM[0x44a+5*32+5]=p.RAM[0x44a+5*32+6]=0xca;
  slot=spawnEnemyType(p,type,6,5);p.RAM[0x84d]=3;spawnBomb(p,5,5);
  let defeated=false;
  for(let frame=0;frame<200;frame++){p.Run();if(!(p.RAM[0xd98+slot]&128)){defeated=true;break;}}
  assert.equal(defeated,true,`species ${type} is defeated by the original explosion routine`);
  assert.equal(p.RAM[0xd98+slot],1,'native defeat animation starts rather than deleting the actor');
 }
});

test('ordinary spawning safely reuses slots and rejects invalid or full requests without changes',{skip:!rom},()=>{
 let p=reset();const registered=[];p._enemySpawns={register:(slot,type)=>registered.push([slot,type])};
 for(let slot=0;slot<32;slot++)p.RAM[0xd98+slot]=128;
 p.RAM[0xd98]=1; // Native death animation still owns this slot.
 let before=[...p.RAM];assert.throws(()=>spawnEnemyType(p,8,6,5),/slots are full/);assert.deepEqual(p.RAM,before);assert.deepEqual(registered,[]);
 p.RAM[0xd98+7]=0;for(const base of fields)if(base!==0xd98)p.RAM[base+7]=255;
 assert.equal(spawnEnemyType(p,22,6,5),7);assert.deepEqual(registered,[[7,22]]);
 for(const base of [0xe38,0xe78,0xed8,0xef8,0xf18,0xf38,0x11e6,0x1206,0x1226,0x1246,0x1266,0x1353])assert.equal(p.RAM[base+7],0,'old actor state is cleared');
 assert.equal(p.RAM[0xf58+7],64);assert.equal(p.RAM[0xf78+7],0);assert.equal(p.RAM[0x1333+7],255);
 p=reset();before=[...p.RAM];
 for(const type of [-1,23,44,1.5,NaN]){assert.throws(()=>spawnEnemyType(p,type,6,5),/regular enemy/);assert.deepEqual(p.RAM,before);}
 p.RAM[0x44a+5*32+6]=0xc2;before=[...p.RAM];assert.throws(()=>spawnEnemyType(p,2,6,5),/empty floor/);assert.deepEqual(p.RAM,before);
 p.RAM[0x43a]|=1;before=[...p.RAM];assert.throws(()=>spawnEnemyType(p,2,5,5),/active campaign/);assert.deepEqual(p.RAM,before);
});
