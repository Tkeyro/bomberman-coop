import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineRoom,stablePlayerID,ONLINE_REVISION} from '../dist/online-room.js';
import {ROM_SHA256} from '../dist/session.js';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function clock(){
 const pending=new Map();let serial=0;
 return {pending,timer(fn,ms){const id=++serial;pending.set(id,{fn,ms});return id;},cancel(id){pending.delete(id);},
  async fire(ms){const entry=[...pending].find(([,v])=>v.ms===ms);assert.ok(entry,`a ${ms}ms timer is scheduled`);pending.delete(entry[0]);await entry[1].fn();}};
}
function lobby(){
 let room=null,serial=0;const tokens=new Map(),signals=[],calls=[];let holdNextGet=null,holdNextJoin=null;
 const response=(status,data)=>({ok:status<400,status,json:async()=>structuredClone(data)});
 async function fetch(url,options){
  await Promise.resolve();const method=options.method,body=options.body===undefined?undefined:JSON.parse(options.body),auth=options.headers.Authorization;
  calls.push({url,method,headers:{...options.headers},body});const path=new URL(url,'https://test.invalid').pathname;
  if(path==='/api/rooms'&&method==='POST'){
   const id=body.playerId,token=`token-${id}`;tokens.set(token,id);room={code:'ABC123',hostId:id,players:[{id,name:body.name,color:body.color,connected:true}],phase:'lobby'};return response(201,{room,token});
  }
  if(path==='/api/rooms/ABC123/join'&&method==='POST'){
   if(!room)return response(404,{error:'Room not found.'});const id=body.playerId,token=`token-${id}`;tokens.set(token,id);
   if(!room.players.some(p=>p.id===id))room.players.push({id,name:body.name,color:body.color,connected:true});const data={room:structuredClone(room),token};if(holdNextJoin){const hold=holdNextJoin;holdNextJoin=null;hold.captured=data;await hold.promise;}return response(200,data);
  }
  const id=tokens.get(auth?.replace(/^Bearer /,''));if(!id||!room?.players.some(p=>p.id===id))return response(403,{error:'Room membership is required.'});
  if(method==='GET'){
   const after=Number(new URL(url,'https://test.invalid').searchParams.get('after'));
   const data={room:structuredClone(room),signals:signals.filter(s=>s.id>after&&s.to===id),lastId:serial};
   if(holdNextGet){const hold=holdNextGet;holdNextGet=null;hold.captured=data;await hold.promise;}return response(200,data);
  }
  if(path.endsWith('/signals')){signals.push({id:++serial,from:id,...body});return response(200,{ok:true});}
  if(path.endsWith('/leave')){room.players=room.players.filter(p=>p.id!==id);for(let i=signals.length-1;i>=0;i--)if(signals[i].from===id||signals[i].to===id)signals.splice(i,1);tokens.delete(auth.replace(/^Bearer /,''));return response(200,{ok:true});}
  if(path.endsWith('/member')){Object.assign(room.players.find(p=>p.id===id),body);return response(200,{room});}
  if(path.endsWith('/checkpoint')){if(id!==room.hostId)return response(403,{error:'Only the host may save a checkpoint.'});room.checkpoint=body.checkpoint;return response(200,{room});}
  if(path.endsWith('/start')){if(id!==room.hostId)return response(403,{error:'Only the host may start.'});room.phase='playing';return response(200,{room});}
  if(path.endsWith('/heartbeat'))return response(200,{ok:true});
  return response(404,{error:'Unknown lobby endpoint.'});
 }
 return {fetch,calls,signals,get room(){return room;},inject(from,to,type,data){signals.push({id:++serial,from,to,type,data});},holdGet(){const hold=deferred();holdNextGet=hold;return hold;},holdJoin(){const hold=deferred();holdNextJoin=hold;return hold;}};
}
function peerNetwork(){
 const peers=new Map(),channels=[];let serial=0;
 class Channel extends EventTarget{
  constructor(label){super();this.label=label;this.readyState='connecting';this.bufferedAmount=0;this.sent=[];this.hold=false;channels.push(this);}
  send(data){assert.equal(this.readyState,'open','data travels only over an established channel');this.sent.push(data);this.bufferedAmount+=typeof data==='string'?Buffer.byteLength(data):data.byteLength;
   queueMicrotask(()=>{if(this.remote.readyState==='open')this.remote.onmessage?.({data});if(!this.hold)this.drain();});
  }
  drain(){this.bufferedAmount=0;this.dispatchEvent(new Event('bufferedamountlow'));}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();if(this.remote?.readyState!=='closed')this.remote?.close();}
 }
 class Peer{
  constructor(config){this.id=`peer-${++serial}`;this.config=config;this.localDescription=null;this.remoteDescription=null;this.candidates=[];this.connectionState='new';peers.set(this.id,this);}
  createDataChannel(label,options){assert.equal(options.ordered,true);return this.channel=new Channel(label);}
  async createOffer(){await Promise.resolve();return {type:'offer',sdp:this.id};}
  async createAnswer(){await Promise.resolve();return {type:'answer',sdp:this.id};}
  async setLocalDescription(description){await Promise.resolve();this.localDescription=description;
   queueMicrotask(()=>{if(this.connectionState!=='closed')this.onicecandidate?.({candidate:{candidate:`ice:${this.id}`,toJSON(){return {candidate:this.candidate};}}});});this.connect();
  }
  async setRemoteDescription(description){await Promise.resolve();assert.ok(peers.has(description.sdp),'SDP identifies a real remote peer');this.remoteDescription=description;this.connect();}
  async addIceCandidate(candidate){await Promise.resolve();assert.ok(this.remoteDescription,'ICE is applied after a remote description');this.candidates.push(candidate);this.connect();}
  connect(){const remote=peers.get(this.remoteDescription?.sdp);if(!remote||!this.localDescription||!remote.localDescription||!this.candidates.length||!remote.candidates.length)return;
   const host=this.channel?this:remote,guest=host===this?remote:this;if(host.channel.remote)return;
   const receive=new Channel(host.channel.label);host.channel.remote=receive;receive.remote=host.channel;guest.channel=receive;guest.ondatachannel?.({channel:receive});
   for(const p of [host,guest])p.connectionState='connected';for(const c of [host.channel,receive]){c.readyState='open';queueMicrotask(()=>c.onopen?.());}
  }
  close(){this.connectionState='closed';this.channel?.close();}
 }
 return {Peer,peers,channels};
}
function entryServer({holdEntries=true,holdLeaves=false}={}){
 const rooms=new Map(),tokens=new Map(),entries=[],leaves=[],calls=[];let serial=0;
 const response=(status,data)=>({ok:status<400,json:async()=>structuredClone(data)});
 async function fetch(url,options){
  await Promise.resolve();const body=options.body===undefined?undefined:JSON.parse(options.body),method=options.method;calls.push({url,method,body,headers:{...options.headers}});
  const path=new URL(url,'https://test.invalid').pathname,code=path.split('/')[3],token=options.headers.Authorization?.slice(7);
  if(method==='POST'&&(path==='/api/rooms'||path.endsWith('/join'))){
   const created=path==='/api/rooms',roomCode=created?`CREATED${++serial}`:code,id=body.playerId;
   const room={code:roomCode,hostId:created?id:'other-player-0001',players:[...(created?[]:[{id:'other-player-0001',connected:true}]),{id,name:body.name,color:body.color,connected:true}]};
   const token=`token-${roomCode}-${id}`;rooms.set(roomCode,room);tokens.set(token,{code:roomCode,id});const data={room:structuredClone(room),token};
   const wait=deferred();entries.push({code:roomCode,data,resolve:wait.resolve});if(holdEntries)await wait.promise;return response(201,data);
  }
  const membership=tokens.get(token);if(!membership||membership.code!==code)return response(403,{error:'Wrong room token.'});
  if(path.endsWith('/leave')){
   const wait=deferred();leaves.push({code,token,resolve:wait.resolve});if(holdLeaves)await wait.promise;
   tokens.delete(token);const room=rooms.get(code);room.players=room.players.filter(p=>p.id!==membership.id);if(!room.players.length)rooms.delete(code);return response(200,{ok:true});
  }
  const room=rooms.get(code);if(method==='GET')return response(200,{room,signals:[],lastId:0});
  if(path.endsWith('/member')){Object.assign(room.players.find(p=>p.id===membership.id),body);return response(200,{room});}
  return response(404,{error:'Unknown endpoint.'});
 }
 return {fetch,rooms,tokens,entries,leaves,calls};
}
function fixture(t){
 const service=lobby(),network=peerNetwork(),members=[];
 function member(id){const events={rooms:[],ready:[],data:[],errors:[],disconnected:[]},time=clock();
  const client=createOnlineRoom({playerId:id,fetch:service.fetch,Peer:network.Peer,timer:time.timer,cancel:time.cancel,
   onRoom:(room,status)=>events.rooms.push({room:structuredClone(room),status}),onReady:room=>events.ready.push(structuredClone(room)),
   onData:(packet,from)=>events.data.push({packet,from}),onError:error=>events.errors.push(error),onDisconnected:id=>events.disconnected.push(id)});
  const result={id,client,events,time};members.push(result);return result;
 }
 t.after(async()=>{for(const m of members)await m.client.leave();await flush();});
 async function settle(){for(let i=0;i<5;i++){for(const m of members)if(m.client.room)await m.client.poll();await flush();}}
 async function pair(){const host=member('host-player-00001'),guest=member('guest-player-0001');await host.client.create({name:'Tkeyro',color:'black'});await guest.client.join(' abc123 ',{name:'Guest',color:'orange'});await settle();return {host,guest};}
 return {...service,service,network,members,member,settle,pair};
}

test('stable player IDs survive reload, replace malformed storage and tolerate unavailable storage',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const id=stablePlayerID(storage);assert.match(id,/^[a-zA-Z0-9_-]{16,64}$/);assert.equal(stablePlayerID(storage),id);assert.equal(values.get('bomberman-player-id'),id);
 values.set('bomberman-player-id','invalid/id');assert.notEqual(stablePlayerID(storage),'invalid/id');
 const unavailable={getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');}};assert.match(stablePlayerID(unavailable),/^[a-zA-Z0-9_-]{16,64}$/);
});
test('two peers negotiate asynchronous offer, answer and early ICE with authenticated cursors and packet provenance',async t=>{
 const f=fixture(t),{host,guest}=await f.pair();assert.equal(host.client.connected(),true);assert.equal(guest.client.connected(),true);assert.equal(host.client.host,true);assert.equal(guest.client.host,false);
 assert.equal(f.network.peers.size,2);assert.ok([...f.network.peers.values()].every(p=>p.candidates.length&&p.localDescription&&p.remoteDescription));assert.ok(host.events.ready.length&&guest.events.ready.length);
 const entering=f.calls.filter(c=>c.method==='POST'&&(c.url==='/api/rooms'||c.url.endsWith('/join')));assert.equal(entering[1].url,'/api/rooms/ABC123/join');
 for(const call of entering){assert.equal(call.body.revision,ONLINE_REVISION);assert.equal(call.body.romHash,ROM_SHA256);assert.equal(call.headers.Authorization,undefined);}
 for(const call of f.calls.filter(c=>!entering.includes(c))){assert.match(call.headers.Authorization,/^Bearer token-/);assert.equal(call.headers['Content-Type'],'application/json');}
 assert.deepEqual(new Set(f.signals.map(s=>s.type)),new Set(['offer','answer','ice']));
 for(const id of [host.id,guest.id]){const cursors=f.calls.filter(c=>c.method==='GET'&&c.headers.Authorization===`Bearer token-${id}`).map(c=>Number(new URL(c.url,'https://test.invalid').searchParams.get('after')));assert.equal(cursors[0],0);assert.ok(cursors.some(n=>n>0));assert.ok(cursors.every((n,i)=>!i||n>=cursors[i-1]));}
 const input={type:'input',frame:12,mask:5,playerId:'spoofed-host'};assert.equal(guest.client.toHost(input),true);const frame={type:'frame',frame:12,inputs:[0,5]};assert.equal(host.client.broadcast(frame),true);await flush();
 assert.deepEqual(host.events.data.at(-1),{packet:input,from:guest.id});assert.deepEqual(guest.events.data.at(-1),{packet:frame,from:host.id});assert.equal(host.events.errors.length+guest.events.errors.length,0);
 await guest.client.update({color:'yellow',name:'Changed'});assert.equal(guest.client.room.players.find(p=>p.id===guest.id).color,'yellow');const count=f.calls.length;await assert.rejects(guest.client.update({color:'invisible'}),/valid.*color/i);assert.equal(f.calls.length,count);
 await assert.rejects(guest.client.start(),/every player|connect/i);await assert.rejects(guest.client.checkpoint('private'),/Only the host/);await host.client.checkpoint('saved-state');await host.client.start();assert.equal(host.client.room.phase,'playing');
 for(let i=0;i<10;i++)await host.client.poll();assert.ok(f.calls.some(c=>c.url.endsWith('/heartbeat')));
 await guest.client.leave();assert.equal(guest.client.room,null);assert.ok(f.calls.some(c=>c.url.endsWith('/leave')&&c.headers.Authorization===`Bearer token-${guest.id}`));assert.equal(guest.time.pending.size,0);
 await host.client.poll();assert.equal(host.client.connected(),false);assert.ok(host.events.disconnected.includes(guest.id));
});
test('host readiness waits for all room members rather than one connected guest',async t=>{
 const f=fixture(t),{host}=await f.pair(),third=f.member('third-player-0001');await third.client.join('ABC123',{name:'Third',color:'red'});await host.client.poll();assert.equal(host.client.connected(),false);
 const before=f.calls.length;await assert.rejects(host.client.start(),/every player.*connect/i);assert.equal(f.calls.length,before,'incomplete rooms cannot request a start');await f.settle();assert.equal(host.client.connected(),true);assert.equal(third.client.connected(),true);await host.client.start();
});
test('signal provenance rejects strangers and guest offers while the same player can leave and rejoin',async t=>{
 const f=fixture(t),{host,guest}=await f.pair(),third=f.member('third-player-0001');await third.client.join('ABC123',{name:'Third',color:'red'});await f.settle();
 const peers=f.network.peers.size;f.service.inject('unknown-player-01',guest.id,'offer',{type:'offer',sdp:'invalid-peer'});f.service.inject(third.id,guest.id,'offer',{type:'offer',sdp:'invalid-peer'});await guest.client.poll();assert.equal(f.network.peers.size,peers);assert.equal(guest.events.errors.length,0);
 await guest.client.leave();await host.client.poll();const callCount=f.calls.length;await guest.client.join('abc123',{name:'Returned',color:'yellow'});await f.settle();
 assert.equal(guest.client.playerId,guest.id);assert.equal(host.client.room.players.filter(p=>p.id===guest.id).length,1);assert.equal(guest.client.connected(),true);assert.equal(host.client.connected(),true);
 const returning=f.calls.slice(callCount).find(c=>c.url.endsWith('/join'));assert.equal(returning.body.playerId,guest.id);assert.equal(returning.headers.Authorization,undefined);const firstPoll=f.calls.slice(callCount).find(c=>c.method==='GET'&&c.headers.Authorization===`Bearer token-${guest.id}`);assert.equal(new URL(firstPoll.url,'https://test.invalid').searchParams.get('after'),'0');
});
test('host snapshots preserve bytes, chunk ordering and channel backpressure across multiple chunks',async t=>{
 const f=fixture(t),{host,guest}=await f.pair(),send=[...f.network.peers.values()].find(p=>p.localDescription.type==='offer').channel;
 const bytes=Uint8Array.from({length:8192*12+317},(_,i)=>(i*71+9)&255),httpCalls=f.calls.length;send.hold=true;send.bufferedAmount=70000;let finished=false;
 const transfer=host.client.sendSnapshot(new Blob([bytes])).then(()=>{finished=true;});await flush();assert.equal(send.sent.length,0,'backpressure delays even the transfer header');
 for(let i=0;i<30&&!finished;i++){send.drain();await flush();}await transfer;await flush();
 const packets=send.sent.map(s=>JSON.parse(s));assert.equal(packets[0].type,'transfer-start');assert.equal(packets.at(-1).type,'transfer-end');const chunks=packets.filter(p=>p.type==='transfer-chunk');assert.equal(chunks.length,13);assert.deepEqual(chunks.map(p=>p.index),Array.from({length:13},(_,i)=>i));assert.ok(chunks.every(p=>Buffer.from(p.data,'base64').length<=8192));
 const snapshots=guest.events.data.filter(e=>e.packet.type==='snapshot');assert.equal(snapshots.length,1);const snapshot=snapshots[0];assert.equal(snapshot.from,host.id);assert.deepEqual(new Uint8Array(await snapshot.packet.blob.arrayBuffer()),bytes);assert.equal(f.calls.length,httpCalls,'game state never travels over the HTTP lobby');assert.ok([...host.time.pending.values()].every(t=>t.ms!==10000),'successful waits remove their transfer timeout');
 assert.equal(host.events.errors.length+guest.events.errors.length,0);await assert.rejects(guest.client.sendSnapshot(new Blob([bytes])),/host.*snapshot/i);await assert.rejects(host.client.sendSnapshot(new Blob()),/snapshot/i);await assert.rejects(host.client.sendSnapshot(new Blob([new Uint8Array(16*1024*1024+1)])),/snapshot/i);
});
test('invalid packets, guest transfers and out-of-order chunks are bounded without losing ordinary messages',async t=>{
 const f=fixture(t),{host,guest}=await f.pair(),hostChannel=[...f.network.peers.values()].find(p=>p.localDescription.type==='offer').channel,guestChannel=hostChannel.remote;
 for(const data of [new Uint8Array([1]),'not-json','x'.repeat(20001),'null'])guestChannel.send(data);
 guestChannel.send(JSON.stringify({type:'transfer-start',id:'forged',size:1}));await flush();assert.equal(host.events.data.length,0,'binary and malformed packets never reach game handlers');assert.ok(host.events.errors.length>=5);
 hostChannel.send(JSON.stringify({type:'transfer-start',id:'bad-order',size:2}));hostChannel.send(JSON.stringify({type:'transfer-chunk',id:'bad-order',index:1,data:'AA=='}));hostChannel.send(JSON.stringify({type:'transfer-end',id:'bad-order'}));
 hostChannel.send(JSON.stringify({type:'transfer-start',id:'huge',size:16*1024*1024+1}));hostChannel.send(JSON.stringify({type:'transfer-chunk',id:'absent',index:0,data:'AA=='}));await flush();assert.ok(guest.events.errors.length>=4);assert.equal(guest.events.data.length,0);
 host.client.broadcast({type:'frame',frame:22,inputs:[0,0]});await flush();assert.equal(guest.events.data.at(-1).packet.frame,22);
});
test('malformed transfers release their bounded slots so a later host snapshot can recover',async t=>{
 const f=fixture(t),{host,guest}=await f.pair(),channel=[...f.network.peers.values()].find(p=>p.localDescription.type==='offer').channel;
 for(const id of ['broken-one','broken-two']){channel.send(JSON.stringify({type:'transfer-start',id,size:2}));channel.send(JSON.stringify({type:'transfer-chunk',id,index:1,data:'AA=='}));channel.send(JSON.stringify({type:'transfer-end',id}));}await flush();
 await host.client.sendSnapshot(new Blob(['recovered checkpoint']));await flush();const snapshots=guest.events.data.filter(e=>e.packet.type==='snapshot');assert.equal(snapshots.length,1,'a malformed transfer cannot permanently consume a receiver slot');assert.equal(await snapshots[0].packet.blob.text(),'recovered checkpoint');
});
test('a transfer times out under sustained backpressure and reports a bounded send failure',async t=>{
 const f=fixture(t),{host}=await f.pair(),channel=[...f.network.peers.values()].find(p=>p.localDescription.type==='offer').channel;
 channel.hold=true;channel.bufferedAmount=70000;const sending=host.client.sendSnapshot(new Blob(['checkpoint']));const rejected=assert.rejects(sending,/timed out/i);await flush();await host.time.fire(10000);await rejected;
 assert.equal(channel.sent.length,0);channel.bufferedAmount=1024*1024+1;assert.equal(host.client.broadcast({type:'frame',frame:1,inputs:[0,0]}),false);assert.ok(host.events.disconnected.length);
});
test('leaving during an in-flight poll keeps the room closed and does not revive stale peers',async t=>{
 const f=fixture(t),{host,guest}=await f.pair(),hold=f.service.holdGet();const pending=guest.client.poll();await flush();assert.ok(hold.captured);await guest.client.leave();const callbacks=guest.events.rooms.length;hold.resolve();await pending;await flush();
 assert.equal(guest.client.room,null,'a stale HTTP response cannot restore a departed room');assert.equal(guest.events.rooms.length,callbacks,'leave is the final room callback');assert.equal(guest.time.pending.size,0);assert.equal(host.client.host,true);
});
test('leaving while a join is awaiting HTTP keeps the client closed and removes pending server membership',async t=>{
 const f=fixture(t),host=f.member('host-player-00001'),guest=f.member('guest-player-0001');await host.client.create({name:'Host',color:'black'});const hold=f.service.holdJoin();
 const joining=guest.client.join('ABC123',{name:'Guest',color:'orange'}).catch(error=>{assert.match(error.message,/cancel|left|closed/i);});await flush();assert.ok(hold.captured);await guest.client.leave();const callbacks=guest.events.rooms.length;hold.resolve();await joining;await flush();
 assert.equal(guest.client.room,null,'a cancelled join cannot restore a room after leave');assert.equal(guest.events.rooms.length,callbacks,'the cancelled join never announces a room');assert.equal(guest.time.pending.size,0);assert.equal(f.service.room.players.some(p=>p.id===guest.id),false,'the late-issued token cleans up the unused membership');
});
test('concurrent create and join honor the newest entry and clean up a late creation token',async t=>{
 for(const staggered of [false,true]){
  const service=entryServer(),time=clock(),announced=[],errors=[],id='host-player-00001',client=createOnlineRoom({playerId:id,fetch:service.fetch,timer:time.timer,cancel:time.cancel,onRoom:room=>announced.push(room?.code??null),onError:error=>errors.push(error)});
  t.after(()=>client.leave());const creating=client.create({name:'Old',color:'black'});if(staggered)await flush();const joining=client.join(' joined ',{name:'Latest',color:'orange'});await flush();
  const latest=service.entries.find(e=>e.code==='JOINED');assert.ok(latest);latest.resolve();assert.equal((await joining).code,'JOINED');const old=service.entries.find(e=>e.code!=='JOINED');old?.resolve();assert.equal(await creating,null,'the superseded create cannot select a room');
  assert.equal(client.room.code,'JOINED');assert.ok(!announced.some(code=>code?.startsWith('CREATED')),'a stale room is never announced');assert.equal(service.rooms.size,1,'late host creation leaves its orphaned room');
  if(staggered){assert.equal(service.entries.length,2);assert.equal(service.leaves.length,1);assert.equal(service.leaves[0].token,old.data.token);}else assert.equal(service.entries.length,1,'an entry superseded before HTTP is never sent');
  await client.update({color:'yellow'});assert.equal(client.room.players.find(p=>p.id===id).color,'yellow');assert.equal(service.calls.at(-1).headers.Authorization,'Bearer '+latest.data.token,'stale cleanup preserves the newest token');assert.equal(errors.length,0);assert.equal(time.pending.size,1);
 }
});
test('a slow authenticated leave cannot erase a newer room or let the superseded join proceed',async t=>{
 const service=entryServer({holdEntries:false,holdLeaves:true}),time=clock(),id='host-player-00001',client=createOnlineRoom({playerId:id,fetch:service.fetch,timer:time.timer,cancel:time.cancel});t.after(async()=>{const leaving=client.leave();await flush();service.leaves.forEach(leave=>leave.resolve());await leaving;});
 await client.create({name:'Original',color:'black'});const original=service.entries[0];const joining=client.join('JOINED',{name:'Superseded',color:'orange'});await flush();assert.equal(service.leaves.length,1);assert.equal(client.room,null,'leave clears local state before HTTP completes');
 const creating=client.create({name:'Newest',color:'red'});assert.equal((await creating).code,'CREATED2');service.leaves[0].resolve();assert.equal(await joining,null);assert.equal(client.room.code,'CREATED2');assert.equal(service.entries.some(entry=>entry.code==='JOINED'),false,'the cancelled join does not run after the delayed leave');
 await client.update({color:'yellow'});assert.equal(service.calls.at(-1).headers.Authorization,'Bearer '+service.entries[1].data.token);assert.equal(service.tokens.has(original.data.token),false);assert.equal(client.room.players[0].color,'yellow');
 const leaving=client.leave();await flush();service.leaves.at(-1).resolve();await leaving;assert.equal(time.pending.size,0);assert.equal(service.tokens.size,0);
});
