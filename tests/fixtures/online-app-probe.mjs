import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {createLobbyHandler} from '../../server/lobby.js';

const root=new URL('../../',import.meta.url),html=fs.readFileSync(new URL('dist/index.html',root),'utf8');
const bytes=fs.readFileSync(process.env.BOMBERMAN_TEST_ROM),flush=()=>new Promise(resolve=>setImmediate(resolve));
const scenario=process.env.BOMBERMAN_ONLINE_APP_SCENARIO??'';
assert.ok(['','audio-hang','pause-delay','ack-timeout'].includes(scenario),'known online app scenario');
const same=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
function colorButton(app,color,group='room-color-options'){
 const buttons=app.e.get(group).children;assert.equal(buttons.length,8,`${group} offers all eight colors`);
 const button=buttons.find(button=>button.dataset.color===color);assert.ok(button,`${group} offers ${color}`);return button;
}
function assertColorUI(app,color,{disabled=false}={}){
 assert.equal(app.e.get('color-select').value,color);
 for(const group of ['color-options','room-color-options'])for(const button of app.e.get(group).children){
  assert.equal(button.attributes['aria-pressed'],String(button.dataset.color===color),`${group} ${button.dataset.color} selected state`);
  assert.equal(button.disabled,disabled,`${group} ${button.dataset.color} availability`);
 }
}
class D1SQLite{
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');this.sqlite.exec(fs.readFileSync(new URL('drizzle/0000_lobbies.sql',root),'utf8'));}
 withSession(){return this;}
 prepare(sql){const db=this;return {bind(...values){return {sql,values,async first(){return db.sqlite.prepare(sql).get(...values)??null;},async all(){return {results:db.sqlite.prepare(sql).all(...values)};},async run(){const r=db.sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>{const r=this.sqlite.prepare(s.sql).run(...s.values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};});this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const db=new D1SQLite(),handler=createLobbyHandler();const requests=[];
async function fetchLobby(path,options){requests.push({path,method:options.method,body:options.body});return handler(new Request(new URL(path,'https://game.test/'),options),{DB:db});}
const peers=new Map(),channels=[];let peerSerial=0,delayPauseRequest=false,droppedLoaded=0;
const pendingPauseRequests=[];
class Channel extends EventTarget{
 constructor(label){super();this.label=label;this.readyState='connecting';this.bufferedAmount=0;this.sent=[];channels.push(this);}
 send(data){assert.equal(this.readyState,'open');this.sent.push(data);this.bufferedAmount+=Buffer.byteLength(data);const packet=JSON.parse(data);if(scenario==='ack-timeout'&&packet.type==='loaded'){droppedLoaded++;this.bufferedAmount=0;return;}const deliver=()=>{if(this.remote.readyState==='open')this.remote.onmessage?.({data});this.bufferedAmount=0;this.dispatchEvent(new Event('bufferedamountlow'));};if(delayPauseRequest&&packet.type==='pause-request')pendingPauseRequests.push(deliver);else queueMicrotask(deliver);}
 close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();this.remote?.close();}
}
class Peer{
 constructor(){this.id='peer-'+(++peerSerial);this.connectionState='new';this.localDescription=null;this.remoteDescription=null;this.candidates=[];peers.set(this.id,this);}
 createDataChannel(label,options){assert.equal(options.ordered,true);return this.channel=new Channel(label);}
 async createOffer(){return {type:'offer',sdp:this.id};}
 async createAnswer(){return {type:'answer',sdp:this.id};}
 async setLocalDescription(description){this.localDescription=description;queueMicrotask(()=>this.connectionState!=='closed'&&this.onicecandidate?.({candidate:{candidate:'ice:'+this.id,toJSON(){return {candidate:this.candidate};}}}));this.connect();}
 async setRemoteDescription(description){assert.ok(peers.has(description.sdp));this.remoteDescription=description;this.connect();}
 async addIceCandidate(candidate){this.candidates.push(candidate);this.connect();}
 connect(){const other=peers.get(this.remoteDescription?.sdp);if(!other||!this.localDescription||!other.localDescription||!this.candidates.length||!other.candidates.length)return;const host=this.channel?this:other,guest=host===this?other:this;if(host.channel.remote)return;const channel=new Channel(host.channel.label);host.channel.remote=channel;channel.remote=host.channel;guest.channel=channel;guest.ondatachannel?.({channel});for(const p of [host,guest])p.connectionState='connected';for(const c of [host.channel,channel]){c.readyState='open';queueMicrotask(()=>c.onopen?.());}}
 close(){this.connectionState='closed';this.channel?.close();}
}
async function app(name,id,color,gameMode='campaign'){
 const elements=new Map(),timers=new Map(),modules=new Map();let timerID=0,nextFrame,clock=1000,machine,exported;
 const document={getElementById:id=>elements.get(id),activeElement:null,hidden:false,addEventListener(){},createElement:element};
 function element(){return {value:'',textContent:'',disabled:true,hidden:false,open:false,listeners:{},children:[],style:{},attributes:{},dataset:{},width:684,height:262,addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];this.textContent='';},focus(){document.activeElement=this;},click(){return this.listeners.click?.();},showModal(){this.open=true;},close(){this.open=false;},getContext(){return {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};}};}
 for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,element());
 elements.get('color-select').value=color;elements.get('player-count-select').value='2';elements.get('room-name').value=name;
 const window={listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
 class AudioContext{
  constructor(){this.sampleRate=name==='Guest'?48000:44100;this.state='suspended';this.destination={};this.suspendCalls=0;this.unsettledCalls=0;}
  createScriptProcessor(){return {connect(){}};}
  createGain(){return {gain:{value:1},connect(){}};}
  suspend(){this.state='suspended';this.suspendCalls++;if((name==='Tkeyro'&&this.suspendCalls===3)||(name==='Guest'&&this.suspendCalls===2)){this.unsettledCalls++;return new Promise(()=>{});}return Promise.resolve();}
  resume(){this.state='running';return Promise.resolve();}
 }
 if(scenario==='audio-hang')window.AudioContext=AudioContext;
 class LocalURL extends URL{static createObjectURL(blob){exported=blob;return 'blob:test';}static revokeObjectURL(){}}
 const storage=new Map([['bomberman-player-id',id]]);
 const context=vm.createContext({console,document,window,...(scenario==='audio-hang'?{AudioContext}:{}),Blob,Response,Request,Headers,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,structuredClone,crypto:webcrypto,fetch:fetchLobby,RTCPeerConnection:Peer,URL:LocalURL,location:{href:'https://game.test/'},navigator:{},Event,EventTarget,atob,btoa,queueMicrotask,indexedDB:undefined,performance:{now:()=>clock},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:fn=>{nextFrame=fn;},setTimeout:(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 async function module(url){const key=url.href;if(modules.has(key))return modules.get(key);const result=new vm.SourceTextModule(fs.readFileSync(url,'utf8'),{context,identifier:key,initializeImportMeta:meta=>{meta.url=key;}});modules.set(key,result);return result;}
 async function load(path){const result=await module(new URL(path,root));if(result.status==='unlinked')await result.link((specifier,parent)=>module(new URL(specifier,parent.identifier)));if(result.status==='linked')await result.evaluate();return result.namespace;}
 const vendor=await load('dist/vendor/pce.js'),setCanvas=vendor.PCE.prototype.SetCanvas;vendor.PCE.prototype.SetCanvas=function(id){machine=this;return setCanvas.call(this,id);};
 await load('dist/app.js');
 const result={name,id,e:elements,window,load,timers,context,get machine(){return machine;},get exported(){return exported;},
  async key(code,up=false){window.listeners[up?'keyup':'keydown']({code,preventDefault(){}});await flush();},
  tick(){clock+=50;nextFrame(clock);},
  async poll(){const pending=[...timers].filter(([,t])=>t.ms===1000);for(const [id,t]of pending){timers.delete(id);await t.fn();}await flush();},
  async export(){await elements.get('export-save-btn').click();assert.match(elements.get('save-status').textContent,/exported/);return (await load('dist/save-state.js')).decodeSave(exported);},
 status(){return [elements.get('load-status').textContent,elements.get('room-status').textContent,elements.get('save-status').textContent].join(' | ');}
 };
 // Color choice works before ROM loading, and both visible groups agree.
 assert.equal(colorButton(result,'original','color-options').disabled,false);
 await colorButton(result,'original','color-options').click();assertColorUI(result,'original');
 await colorButton(result,color,'color-options').click();assertColorUI(result,color);
 await elements.get('rom-input').listeners.change({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});assert.match(elements.get('load-status').textContent,/verified/,result.status());
 assertColorUI(result,color);
 for(let i=0;i<110;i++)result.tick();
 await result.key('ArrowDown');await result.key('ArrowDown');if(gameMode==='battle')await result.key('ArrowDown');await result.key('Enter');await result.key('ArrowDown');await result.key('Enter');assert.equal(elements.get('online-room-dialog').open,true,result.status());
 return result;
}
const host=await app('Tkeyro','host-player-00001','black'),guest=await app('Guest','guest-player-0001','orange');
async function negotiate(){for(let i=0;i<12;i++){await host.poll();await guest.poll();if(!host.e.get('room-start').disabled)return;}assert.fail(host.status()+' / '+guest.status());}
async function join(){await host.e.get('create-room').click();const code=host.e.get('room-code').value;assert.match(code,/^[A-Z2-9]{10}$/);guest.e.get('room-code').value=code;await guest.e.get('join-room').click();await guest.e.get('room-ready').click();await negotiate();assert.equal(host.e.get('room-list').children.length,2);assert.equal(guest.e.get('room-list').children.length,2);assert.match(host.e.get('room-list').children[1].children[0].title,/orange/);return code;}
async function synchronize(){await host.e.get('room-start').click();for(let n=0;n<700;n++){host.tick();await flush();if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));if(guest.e.get('online-room-dialog').open===false&&guest.e.get('pause-btn').textContent==='Pause')return;}assert.fail(host.status()+' / '+guest.status()+JSON.stringify({frame:host.e.get('frame-count').textContent,campaign:host.machine._onlineCampaign.state,stage:host.machine.RAM.slice(0x84a,0x84c),packets:channels.map(c=>c.sent.slice(-3).map(s=>JSON.parse(s).type))}));}
async function advance(count){for(let i=0;i<count;i++){host.tick();await flush();guest.tick();await flush();assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|out of sync|frame order|different roster/);}}
await join();
// The picker is inside the modal. Changing a ready player's color updates the
// confirmed roster, clears readiness and keeps both UI groups synchronized.
const changingColor=colorButton(guest,'yellow').click();assertColorUI(guest,'orange',{disabled:true});
await changingColor;await flush();await host.poll();await guest.poll();
assertColorUI(guest,'yellow');assert.equal(guest.e.get('room-ready').textContent,'Ready');assert.equal(host.e.get('room-start').disabled,true);
for(const a of [host,guest]){assert.equal(a.e.get('room-list').children[1].children[0].title,'yellow');assert.equal(a.e.get('room-list').children[1].children[2].textContent,'Choosing');}
await colorButton(guest,'orange').click();await flush();await guest.e.get('room-ready').click();await negotiate();assertColorUI(guest,'orange');
if(scenario==='ack-timeout'){
 await host.e.get('room-start').click();for(let n=0;n<700&&guest.e.get('online-room-dialog').open;n++){host.tick();await flush();if(host.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(guest.e.get('online-room-dialog').open,false,'guest received and applied the host snapshot');assert.equal(droppedLoaded,1,'guest acknowledgement is lost');
 const watchdog=[...host.timers].find(([,t])=>t.ms===45000);assert.ok(watchdog,'startup waiting has a bounded watchdog');host.timers.delete(watchdog[0]);await watchdog[1].fn();await flush();
 assert.match(host.status(),/Online startup timed out/);assert.match(guest.status(),/Online startup timed out/);
 const frames=[host,guest].map(a=>a.e.get('frame-count').textContent);
 await host.e.get('pause-btn').click();await guest.e.get('pause-btn').click();await flush();
 for(let n=0;n<3;n++){host.tick();guest.tick();await flush();}
 assert.deepEqual([host,guest].map(a=>a.e.get('frame-count').textContent),frames,'Resume cannot run a game whose startup handshake failed');
 assert.match(host.status(),/synchronization did not complete/);assert.match(guest.status(),/synchronization did not complete/);
 assert.equal(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='frames')),false,'no authority frames are emitted before everyone has loaded');
 await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,startupTimeout:true,blockedResume:true,droppedLoaded}));
}else{
await synchronize();await advance(5);assertColorUI(host,'black',{disabled:true});assertColorUI(guest,'orange',{disabled:true});
if(scenario){
 let delayedFrames=0;
 if(scenario==='pause-delay'){
  delayPauseRequest=true;await guest.e.get('pause-btn').click();await flush();
  assert.equal(pendingPauseRequests.length,1,'guest pause request is delayed in transit');
  const before=host.machine._onlineCampaign.state.frame;
  for(let n=0;n<3;n++){host.tick();await flush();guest.tick();await flush();}
  delayedFrames=host.machine._onlineCampaign.state.frame-before;assert.ok(delayedFrames>=3,'host emits authoritative frames before receiving the pause request');
  delayPauseRequest=false;for(const deliver of pendingPauseRequests.splice(0))deliver();await flush();
  assert.equal(host.e.get('pause-btn').textContent,'Resume');assert.equal(guest.e.get('pause-btn').textContent,'Resume');
  await host.e.get('pause-btn').click();await flush();
 }
 // Survive the first periodic checksum after startup/resume. The guest may
 // consume buffered frames faster than the host to recover the delayed pause.
 for(let n=0;n<145;n++){host.tick();await flush();guest.tick();await flush();if(scenario==='pause-delay'){guest.tick();await flush();}assert.doesNotMatch(host.status()+guest.status(),/Emulation stopped|states differ|frame order|desynchronization/);}
 same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);
 if(scenario==='audio-hang')for(const a of [host,guest]){assert.equal(a.machine.WebAudioCtx.unsettledCalls,1,'an unresolved audio suspend request does not hold the gameplay handshake');assert.ok(a.machine.WebAudioCtx.suspendCalls>=2);}
 assert.ok(host.machine._onlineCampaign.state.frame>=120,'authoritative gameplay progresses past its first checksum');
 await host.e.get('room-leave').click();await guest.e.get('room-leave').click();db.sqlite.close();
 process.stdout.write(JSON.stringify({scenario,frames:host.machine._onlineCampaign.state.frame,delayedFrames,unsettledAudio:scenario==='audio-hang'}));
}else{
assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='transfer-chunk')),'host serialized snapshot travels over chunked RTC');assert.ok(channels.some(c=>c.sent.some(s=>JSON.parse(s).type==='loaded')),'guest acknowledges applied snapshot');
assert.equal(host.machine._onlineCampaign.state.enabled,true);assert.equal(guest.machine._onlineCampaign.state.enabled,true);same(host.machine.RAM,guest.machine.RAM);
const initial=await host.export();await flush();assert.equal(initial.session.mode,'online-campaign');assert.deepEqual(Array.from(initial.session.onlineRoom.players,p=>p.color),['black','orange']);assert.equal(initial.session.companions.bots.length,2);
// A controlled open arena removes random enemies from the movement assertion,
// while all movement, collection, sounds, CPU and rendering still run natively.
for(const a of [host,guest]){a.machine.RAM.fill(0,0xd98,0xdb8);a.machine.RAM.fill(0,0xf9b,0xfb4);a.machine._levelObjective.state.enabled=false;a.machine.RAM[0x434]=31;a.machine.RAM[0x435]=21;for(let y=1;y<21;y++)for(let x=2;x<31;x++)a.machine.RAM[0x44a+y*32+x]=0xca;}
const location=initial.session.companions.bots[1];for(const a of [host,guest]){const campaign=await a.load('dist/campaign.js');campaign.spawnItem(a.machine,1,Math.floor(location.x/16),Math.floor(location.y/16));}
await advance(3);assert.equal(host.machine._sharedPowerups.state.counts[1],1);same(host.machine._sharedPowerups.state,guest.machine._sharedPowerups.state);
await host.key('ArrowDown');await guest.key('ArrowRight');await advance(20);assert.equal(host.machine._onlineCampaign.state.inputs[1],2,JSON.stringify({status:host.status()+' / '+guest.status(),inputs:channels.flatMap(c=>c.sent.map(s=>JSON.parse(s)).filter(p=>p.type==='input')),boot:initial.session.boot}));await host.key('ArrowDown',true);await advance(190);await guest.key('ArrowRight',true);await advance(2);
same(host.machine.RAM,guest.machine.RAM);assert.equal(host.machine.PC,guest.machine.PC);assert.equal(host.machine.A,guest.machine.A);assert.equal(host.machine.X,guest.machine.X);assert.equal(host.machine.S,guest.machine.S);assert.notDeepEqual(host.machine.ImageData.data.slice(684*64*4),guest.machine.ImageData.data.slice(684*64*4),'local arena cameras follow separate players without diverging CPU or RAM');
const saved=await host.export();await flush();assert.ok(saved.session.companions.bots[0].y>initial.session.companions.bots[0].y+20,'host controls the first actor');assert.ok(saved.session.companions.bots[1].x>initial.session.companions.bots[1].x+200,'guest independently controls the second actor '+JSON.stringify({initial:initial.session.companions.bots.map(b=>({id:b.id,x:b.x,y:b.y})),later:saved.session.companions.bots.map(b=>({id:b.id,x:b.x,y:b.y,alive:b.alive,action:b.action})),inputs:host.machine._onlineCampaign.state.inputs}));assert.ok(saved.session.companions.bots.every(b=>b.bombCapacity===2),'a collected bomb upgrade reaches all humans');assert.equal(saved.session.sharedPowerups.counts[1],1);
await guest.key('ArrowRight');await advance(2);guest.e.get('game-canvas').listeners.blur();await flush();const before=host.machine._onlineCampaign.state.frame;await advance(2);assert.equal(host.machine._onlineCampaign.state.inputs[1],0,'blur releases remote input through the host');assert.ok(host.machine._onlineCampaign.state.frame>before);
await host.e.get('pause-btn').click();await flush();const paused=host.e.get('frame-count').textContent;await advance(3);assert.equal(host.e.get('frame-count').textContent,paused);assert.equal(guest.e.get('pause-btn').textContent,'Resume','host pause stops the guest');
await host.e.get('room-leave').click();await guest.e.get('room-leave').click();await flush();
// Import the exported checkpoint, retaining original player IDs/upgrades but
// requesting world4 stage4, then exercise the actual fresh-level boot path.
saved.state.RAM[0x84a]=3;saved.state.RAM[0x84b]=3;const saveModule=await host.load('dist/save-state.js'),checkpoint=await saveModule.encodeSave(saved);
await host.e.get('save-input').listeners.change({target:{files:[checkpoint],value:'x'}});assert.match(host.e.get('save-status').textContent,/Online save selected/);assert.match(host.e.get('room-checkpoint').textContent,/level 4-4/);
assertColorUI(host,'black');
await guest.e.get('open-menu-btn').click();for(let i=0;i<110;i++)guest.tick();await guest.key('ArrowDown');await guest.key('ArrowDown');await guest.key('Enter');await guest.key('ArrowDown');await guest.key('Enter');await join();await synchronize();await advance(3);
assert.equal(host.machine.RAM[0x84a],3);assert.equal(host.machine.RAM[0x84b],3);same(host.machine.RAM,guest.machine.RAM);const resumed=await host.export();assert.deepEqual(resumed.session.onlineRoom.players.map(p=>p.id),saved.session.onlineRoom.players.map(p=>p.id));assert.ok(resumed.session.companions.bots.every(b=>b.bombCapacity===2));assert.ok(resumed.session.companions.bots.every(b=>b.x<100&&b.y<100),'saved remote positions restart from the level entrance');
assertColorUI(host,'black',{disabled:true});assertColorUI(guest,'orange',{disabled:true});
await host.e.get('room-leave').click();await guest.e.get('room-leave').click();
// Original Battle must also use only synchronized native controller inputs.
// A guest's physical controller is assigned to their network slot, and cannot
// leak into native port0 or recolor the host in the guest's display.
const bh=await app('Battle host','battle-host-0001','black','battle'),bg=await app('Battle guest','battle-guest-001','orange','battle');
await bh.e.get('create-room').click();bg.e.get('room-code').value=bh.e.get('room-code').value;await bg.e.get('join-room').click();await bg.e.get('room-ready').click();
for(let n=0;n<12&&bh.e.get('room-start').disabled;n++){await bh.poll();await bg.poll();}assert.equal(bh.e.get('room-start').disabled,false,bh.status()+bg.status());
await bh.e.get('room-start').click();for(let n=0;n<700&&bg.e.get('online-room-dialog').open;n++){bh.tick();await flush();if(bh.e.get('pause-btn').textContent==='Resume')await new Promise(resolve=>setTimeout(resolve,5));}
assert.equal(bg.e.get('online-room-dialog').open,false,bh.status()+bg.status());
assertColorUI(bh,'black',{disabled:true});assertColorUI(bg,'orange',{disabled:true});
const pad={connected:true,id:'Fixture standard',mapping:'standard',index:0,axes:[-1,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};bg.context.navigator.getGamepads=()=>[pad];
for(let n=0;n<45;n++){bh.tick();await flush();bg.tick();await flush();assert.doesNotMatch(bh.status()+bg.status(),/Emulation stopped|states differ|frame order/);}
same(bh.machine.RAM,bg.machine.RAM);assert.equal(bh.machine.PC,bg.machine.PC);const battleSave=await bh.export();await flush();const guestBattle=await bg.export();await flush();assert.equal(battleSave.session.mode,'online-battle');assert.deepEqual(Array.from(battleSave.session.battleColors),['black','orange']);assert.deepEqual(Array.from(guestBattle.session.battleColors),['black','orange']);
assert.ok(channels.some(c=>c.sent.some(s=>{const p=JSON.parse(s);return p.type==='input'&&p.mask===8;})),'physical guest controller is sent through the network mask');
await bh.e.get('room-leave').click();await bg.e.get('room-leave').click();db.sqlite.close();
process.stdout.write(JSON.stringify({players:2,sharedUpgrades:true,cameraViews:true,restartLevel:'4-4',remoteReleased:true,battleControllers:true,frames:saved.session.onlineCampaign.frame,httpRequests:requests.length}));
}
}
