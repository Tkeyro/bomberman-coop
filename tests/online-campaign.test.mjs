import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMachine,frames} from '../scripts/headless.mjs';
import {createCompanions,companionBombSlots,spawnItem,DEATH_FRAMES,tileKind} from '../dist/campaign.js';
import {createSpectator} from '../dist/spectator.js';
import {createOnlineCampaign,validateOnlineCampaign,ONLINE_INPUT as I} from '../dist/online-campaign.js';
import {createSharedPowerups} from '../dist/shared-powerups.js';
import {launchSequence} from '../dist/battle-ai.js';
const rom=process.env.BOMBERMAN_TEST_ROM;
function arena(){
 const p=createMachine(fs.readFileSync(rom)),crew=createCompanions(p,{getHuman:()=>null}),watch=createSpectator(p,{getBots:()=>crew.state.bots}),online=createOnlineCampaign(p,{getActors:()=>crew.state.bots,getLocalID:()=>1});
 for(const a of launchSequence('solo'))frames(p,a.frames,a.button?[[0,a.button]]:[]);frames(p,2520);
 for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;
 watch.configure(true);const a=crew.add(3,3),b=crew.add(8,3);a.color='black';b.color='orange';online.configure(true,[{id:a.id,color:a.color,name:'One'},{id:b.id,color:b.color,name:'Two'}]);
 return {p,crew,watch,online,a,b};
}
test('online campaign validates ordered bounded input and restores only gameplay state',()=>{
 const p={RAM:Array(8192).fill(0),MakeSpriteLine(){},MakeBGLine(){}},online=createOnlineCampaign(p);online.configure(true,[{id:1,color:'black'},{id:2,color:'red'}]);online.setInputs(0,[I.RIGHT,I.LEFT]);online.setInputs(1,[I.BOMB,0]);assert.deepEqual(online.state.previous,[I.RIGHT,I.LEFT]);
 assert.throws(()=>online.setInputs(0,[0,0]),/ordered/);assert.throws(()=>online.setInputs(1,[0,0]),/cannot change/);assert.throws(()=>online.setInputs(2,[64,0]),/Invalid/);
 const saved=structuredClone(online.state);online.reset();online.restore(saved);assert.deepEqual(online.state,saved);assert.throws(()=>validateOnlineCampaign({...saved,roster:[saved.roster[0],saved.roster[0]]}),/roster/);assert.throws(()=>validateOnlineCampaign({...saved,released:Array(400).fill(false)}),/bomb/);
});
test('local camera changes only rendered coordinates and preserves native collision flags',()=>{
 const actors=[{id:1,x:40,y:24,alive:true},{id:2,x:392,y:280,alive:true}],ram=Array(8192).fill(0),satb=Array(256).fill(0),views=[];ram[0x25]=8;ram[0x434]=31;ram[0x435]=25;ram[0x44a+34]=10;satb[2]=640;
 const v={SATB:satb,VDCStatus:0,VDCRegister:Array(32).fill(0),DrawBGYLine:120,VDS:0,VSW:0,DrawBGLine:120,VScreenHeightMask:511};v.VDCRegister[7]=8;
 const p={RAM:ram,VDC:[v],_campaignTracker:{frame:0,last:0},MakeSpriteLine(){v.VDCStatus=1+(this.RAM[0x25]|this.RAM[0x26]<<8);views.push(['sprite',this.RAM.slice(0x25,0x29),satb[0],satb[1]]);},MakeBGLine(){views.push(['background',this.RAM.slice(0x25,0x29),v.VDCRegister[7],v.DrawBGLine]);}};
 const online=createOnlineCampaign(p,{getActors:()=>actors,getLocalID:()=>2});online.configure(true,[{id:1,color:'black'},{id:2,color:'red'}]);const before={ram:[...ram],satb:[...satb],bx:v.VDCRegister[7],by:v.DrawBGLine};p.MakeSpriteLine(0);p.MakeBGLine(0);
 assert.equal(views.length,3);assert.equal(v.VDCStatus,9,'hardware flags come from canonical sprite positions');assert.deepEqual(views[0][1],[8,0,0,0]);assert.notDeepEqual(views[1][1],views[0][1]);assert.deepEqual(views[2][1],views[1][1],'background overlays receive the same local scroll');assert.deepEqual(ram,before.ram);assert.deepEqual(satb,before.satb);assert.equal(v.VDCRegister[7],before.bx);assert.equal(v.DrawBGLine,before.by);
});
test('shared remote pickup detonates every owner bomb through native flames and cleanup',{skip:!rom},()=>{
 const {p,crew,online,a,b}=arena(),shared=createSharedPowerups(p,{getActors:()=>crew.state.bots,getHuman:()=>null});shared.configure(true);let frame=0;
 const step=(masks,n=1)=>{for(let j=0;j<n;j++){online.setInputs(frame++,masks);shared.update();online.update();crew.update();p.Run();}};
 const active=actor=>companionBombSlots(actor).filter(slot=>p.RAM[0x84f+slot]&128);
 const finishes=(masks,slots,cells)=>{
  const flames=new Set();
  for(let j=0;j<120;j++){
   step(j===0?masks:[0,0]);
   cells.forEach(([x,y],i)=>{if([6,11,12].includes(tileKind(p,x,y)))flames.add(i);});
  }
  assert.equal(flames.size,cells.length,'every released bomb creates native flame tiles');
  for(const slot of slots)assert.equal(p.RAM[0x84f+slot],0,'native explosion completes and frees the bomb slot');
  for(const [x,y]of cells)assert.equal(tileKind(p,x,y),10,'native flame cleanup restores bomb centers to floor');
 };
 spawnItem(p,2,3,3);step([0,0]);assert.equal(a.remote,true);assert.equal(b.remote,true,'one remote pickup benefits both online humans');assert.equal(shared.state.counts[2],1);
 a.bombCapacity=2;b.x=168;step([I.BOMB,I.BOMB]);const bSlots=active(b);
 a.x=88;a.y=88;b.x=168;b.y=152;step([0,0]);step([I.BOMB,0]);const aSlots=active(a);
 assert.equal(aSlots.length,2);assert.equal(bSlots.length,1);assert.ok(aSlots.every(slot=>!bSlots.includes(slot)),'players retain independent bomb banks');
 a.x=56;a.y=152;step([0,0],180);
 for(const slot of [...aSlots,...bSlots]){assert.equal(p.RAM[0x917+slot],255);assert.ok(p.RAM[0x8ef+slot]>100,'remote bombs wait beyond their ordinary fuse');}
 finishes([I.REMOTE,0],aSlots,[[3,3],[5,5]]);
 assert.deepEqual(active(b),bSlots,'the first player does not release the second player bombs');assert.equal(p.RAM[0x917+bSlots[0]],255);assert.ok(p.RAM[0x8ef+bSlots[0]]>100);
 finishes([0,I.REMOTE],bSlots,[[10,3]]);
 a.x=56;a.y=56;step([I.BOMB,0]);const reused=active(a);assert.equal(reused[0],aSlots[0],'a finished slot can be reused');assert.equal(online.state.released[reused[0]],false,'a new remote bomb starts held');a.y=152;step([0,0],180);assert.equal(p.RAM[0x917+reused[0]],255);assert.ok(p.RAM[0x8ef+reused[0]]>100);
 finishes([I.REMOTE,0],reused,[[3,3]]);
});
test('remote humans pass teammates, respect terrain, collect, bomb, die and clear through native transitions',{skip:!rom},()=>{
 const {p,crew,watch,online,a,b}=arena();const extras=[[2,9],[4,9],[6,9]].map(([x,y])=>crew.add(x,y));const fifth=extras.at(-1);online.configure(true,crew.state.bots.map(actor=>({id:actor.id,color:actor.color})));assert.deepEqual(companionBombSlots(fifth),[0,1,2,3,4]);online.setInputs(0,[0,0,0,0,I.BOMB]);online.control(fifth);assert.equal(p.RAM[0x84f],128,'fifth remote human uses ordinary native bomb slots');assert.equal(crew.state.bombRanges[0],1);p.Run();assert.ok(p.PaletteData[624],'fifth actor has an isolated palette');crew.state.bots=[a,b];for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;p.RAM[0x44a+9*32+6]=0xca;online.configure(true,[{id:a.id,color:a.color},{id:b.id,color:b.color}]);let frame=0;
 const step=(masks,n=1)=>{for(let j=0;j<n;j++){online.setInputs(frame++,masks);online.update();crew.update();p.Run();}};
 step([I.RIGHT,I.DOWN],12);assert.equal(a.x,65);assert.equal(a.y,56);assert.equal(b.x,136);assert.equal(b.y,65);assert.ok(a.animation&&b.animation,'online humans use native walking poses');
 a.x=56;a.y=56;b.x=72;b.y=56;let shared=false;for(let i=0;i<48;i++){step([I.RIGHT,0]);if(Math.abs(a.x-b.x)<10)shared=true;}assert.ok(shared,'a moving human may overlap a stationary teammate');assert.ok(a.x>b.x+10,'the actor passes fully through the stationary teammate');assert.equal(b.x,72,'standing players are not pushed');
 a.x=56;b.x=104;shared=false;for(let i=0;i<40;i++){step([I.RIGHT,I.LEFT]);if(Math.abs(a.x-b.x)<10)shared=true;}assert.ok(shared,'opposing human movement may share the same floor');assert.ok(a.x>b.x,'both players cross rather than blocking one another');
 p.RAM[0x44a+3*32+5]=0xc2;a.x=72;a.y=56;b.x=136;b.y=56;step([I.RIGHT,0],12);assert.ok(a.x<=75,'solid blocks stop the player before entering');a.wallPass=true;step([I.RIGHT,0],22);assert.ok(a.x>80,'wall pass applies to the remote actor');a.wallPass=false;p.RAM[0x44a+3*32+5]=0xca;
 a.x=56;a.y=56;b.x=136;b.y=56;a.bombCapacity=2;b.bombCapacity=1;a.fireRange=3;b.fireRange=1;step([0,0]);step([I.BOMB,I.BOMB]);
 const aSlot=companionBombSlots(a).find(s=>p.RAM[0x84f+s]&128),bSlot=companionBombSlots(b).find(s=>p.RAM[0x84f+s]&128);assert.notEqual(aSlot,bSlot);assert.equal(crew.state.bombRanges[aSlot],3);assert.equal(crew.state.bombRanges[bSlot],1);assert.equal(a.bombsPlaced,1);assert.equal(b.bombsPlaced,1);
 step([I.RIGHT,0],22);assert.ok(a.x>69,'actor can fully step off its own newly solid bomb tile');step([0,0]);step([I.BOMB,I.BOMB]);assert.equal(a.bombsPlaced,2,'owner can place its second bomb');assert.equal(b.bombsPlaced,1,'other owner retains its own one-bomb cap');
 a.x=120;a.y=56;b.x=160;b.y=56;step([I.RIGHT,0],12);assert.ok(a.x<=123,'teammate bodies are passable but their live bomb still blocks entry');a.bombPass=true;step([I.RIGHT,0],30);assert.ok(a.x>140,'bomb pass still permits entering the bomb tile');a.bombPass=false;
 for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;
 a.x=56;a.y=56;b.x=136;b.y=56;a.remote=true;step([0,0]);step([I.BOMB,0]);const held=companionBombSlots(a).find(s=>p.RAM[0x84f+s]&128);a.x=56;a.y=104;step([0,0],180);assert.equal(p.RAM[0x917+held],255);assert.ok(p.RAM[0x8ef+held]>100,'remote bomb remains held');step([I.REMOTE,0]);assert.ok(p.RAM[0x917+held]!==255||p.RAM[0x8ef+held]<2,'remote command starts only this actor bomb');
 for(let i=0;i<40;i++)p.RAM[0x84f+i]=0;for(let y=1;y<12;y++)for(let x=2;x<15;x++)p.RAM[0x44a+y*32+x]=0xca;a.remote=false;a.x=56;a.y=56;b.x=136;b.y=56;const item=spawnItem(p,1,3,3);step([0,0]);assert.equal(p.RAM[0xf9b+item],0);assert.equal(a.bombCapacity,3);assert.equal(tileKind(p,3,3),10,'pickup restores an ordinary floor for native flames');
 a.x=56;a.y=56;b.x=136;b.y=56;p.RAM[0x44a+3*32+3]=11;step([0,I.DOWN]);assert.equal(a.alive,false);assert.equal(a.deathFrame,0);assert.equal(b.alive,true);assert.equal(watch.retry(),false,'one death does not end the team round');assert.equal(p.RAM[0x43a]&7,0);step([0,I.DOWN],8);assert.equal(a.deathFrame,8,'dead human keeps native death animation');
 p.RAM[0x44a+3*32+3]=0xca;a.alive=true;a.deathFrame=null;a.x=56;a.y=56;b.x=136;b.y=56;for(let i=0;i<32;i++)p.RAM[0xd98+i]=0;p.RAM[0xd96]=1;p.RAM[0x44a+3*32+3]=8;let allow=false;p._levelObjective={state:{phase:'item',slot:0},canExit:()=>allow};step([0,0]);assert.equal(p.RAM[0x437],0,'required item blocks early exit');allow=true;step([0,0]);assert.equal(p.RAM[0x437],1,'any living remote human can request the native clear');
 p.RAM[0x437]=0;p.RAM[0x44a+3*32+3]=0xca;a.alive=b.alive=false;a.deathFrame=b.deathFrame=DEATH_FRAMES;a.extraLives=b.extraLives=0;assert.equal(watch.retry(),true,'only a total team defeat begins native death music/retry');assert.equal(watch.state.transition.phase,'dying');
});
