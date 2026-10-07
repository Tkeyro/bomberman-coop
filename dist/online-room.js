import {COLORS,ROM_SHA256} from './session.js';
import {tuneStreamReceiver,tuneStreamSender,createStreamStats} from './stream-tuning.js';
export const ONLINE_REVISION='0.4.7';
const MAX_TRANSFER=16*1024*1024,CHUNK=8192;
export function stablePlayerID(storage=globalThis.localStorage){
 let id;try{id=storage?.getItem('bomberman-player-id');}catch{}
 if(!/^[a-zA-Z0-9_-]{16,64}$/.test(id??'')){id=crypto.randomUUID();try{storage?.setItem('bomberman-player-id',id);}catch{}}
 return id;
}
// Lobby records/signaling travel over HTTP. Only the peers receive game state;
// the game file is never sent to the server or to another browser.
export function createOnlineRoom({playerId=stablePlayerID(),fetch:request=globalThis.fetch,Peer=globalThis.RTCPeerConnection,Stream=globalThis.MediaStream,
 getHostStream=()=>null,onMedia=()=>{},onRoom=()=>{},onData=()=>{},onReady=()=>{},onDisconnected=()=>{},onError=()=>{},onStatus=()=>{},timer=setTimeout,cancel=clearTimeout}={}){
 let room=null,token=null,pollTimer=null,after=0,closed=false,polling=false,heartbeat=0,generation=0,pollFailures=0,statsPending=null;
 const peers=new Map(),transfers=new Map(),streamStats=createStreamStats();
 const isHost=()=>room?.hostId===playerId;
 function serviceError(message,retryable=false){const error=new Error(message);error.retryable=retryable;return error;}
 async function api(path='',method='GET',body){
  let response;try{response=await request('/api/rooms'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw serviceError('The lobby service could not be reached.',true);}
  if(!response||typeof response.ok!=='boolean'||typeof response.json!=='function')throw serviceError('The lobby service returned an invalid response.');
  const retryable=response.status===408||response.status===429||response.status>=500;
  let data;try{data=await response.json();}catch{throw serviceError('The lobby service returned an invalid response.',retryable);}
  if(!response.ok)throw serviceError(typeof data?.error==='string'?data.error:'The lobby request failed.',retryable);return data;
 }
 async function backgroundApi(path,method='GET',body){try{return await api(path,method,body);}catch(error){error.pollRetryable=error.retryable;throw error;}}
 function serviceWarning(){pollFailures++;onStatus('The lobby service connection was interrupted. Retrying…',{retrying:true,attempts:pollFailures});}
 function connected(){return Boolean(room&&room.players.length>=2&&room.players.filter(p=>p.id!==playerId).every(p=>isHost()?peers.get(p.id)?.channel?.readyState==='open':peers.get(room.hostId)?.channel?.readyState==='open'));}
 function announce(){onRoom(room,{playerId,isHost:isHost(),connected:connected()});if(connected())onReady(room);}
 async function signal(to,type,data){await api('/'+room.code+'/signals','POST',{to,type,data});}
 function channelFor(id,channel){
  const peer=peers.get(id);peer.channel=channel;channel.bufferedAmountLowThreshold=65536;
  const current=()=>!closed&&peers.get(id)===peer&&peer.channel===channel;
  channel.onopen=()=>{if(current())announce();};channel.onclose=()=>{if(current()){announce();onDisconnected(id);}};channel.onerror=()=>{if(current())onError(new Error('A player connection failed. The game is paused.'));};
  channel.onmessage=event=>{
   if(!current())return;
   try{
    if(typeof event.data!=='string'||event.data.length>20000)throw new Error('Invalid multiplayer message.');
    const packet=JSON.parse(event.data);
    if(packet.type==='transfer-start'){
     if(id!==room.hostId||typeof packet.id!=='string'||!Number.isInteger(packet.size)||packet.size<1||packet.size>MAX_TRANSFER||transfers.size>=2)throw new Error('Invalid game-state transfer.');
     transfers.set(packet.id,{from:id,size:packet.size,chunks:[],bytes:0});
    }else if(packet.type==='transfer-chunk'){
     const transfer=transfers.get(packet.id);if(!transfer||transfer.from!==id||packet.index!==transfer.chunks.length||typeof packet.data!=='string'||packet.data.length>CHUNK*1.4)throw new Error('Invalid game-state chunk.');
     const bytes=Uint8Array.from(atob(packet.data),c=>c.charCodeAt(0));transfer.bytes+=bytes.length;
     if(transfer.bytes>transfer.size)throw new Error('Game-state transfer is too large.');transfer.chunks.push(bytes);
    }else if(packet.type==='transfer-end'){
     const transfer=transfers.get(packet.id);if(!transfer||transfer.from!==id||transfer.bytes!==transfer.size)throw new Error('Incomplete game-state transfer.');
     transfers.delete(packet.id);Promise.resolve(onData({type:'snapshot',blob:new Blob(transfer.chunks)},id)).catch(onError);
    }else Promise.resolve(onData(packet,id)).catch(onError);
   }catch(error){transfers.clear();onError(error);}
  };
 }
 async function peerFor(id,offer=false){
  if(peers.has(id))return peers.get(id);
  if(!Peer)throw new Error('This browser does not support WebRTC online play.');
  let stream=null,tracks=[];
  if(offer&&isHost()&&room.transport==='stream'){
   try{stream=getHostStream();tracks=stream?.getTracks?.().filter(track=>['video','audio'].includes(track.kind)&&track.readyState!=='ended')??[];}catch{throw new Error('The host game stream could not be captured. Return to the lobby and try again.');}
   if(!tracks.some(track=>track.kind==='video'))throw new Error('Host streaming needs a live game video track. Return to the lobby and try again.');
  }
  const pc=new Peer({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}),peer={pc,channel:null,candidates:[],senders:[],media:null};peers.set(id,peer);
  const current=()=>!closed&&peers.get(id)===peer;
  pc.ontrack=event=>{
   if(!current()||isHost()||room?.transport!=='stream'||id!==room.hostId)return;
   try{
    if(!event.track||!['video','audio'].includes(event.track.kind)||event.track.readyState==='ended')return;
    tuneStreamReceiver(event.receiver);
    if(!peer.media)peer.media=Stream?new Stream():event.streams?.[0];
    if(!peer.media?.getTracks||!peer.media?.addTrack)throw new Error('This browser cannot receive the host game stream.');
    const incoming=[...(event.streams??[]).flatMap(value=>value.getTracks?.()??[]),event.track];
    for(const track of incoming)if(['video','audio'].includes(track.kind)&&track.readyState!=='ended'&&!peer.media.getTracks().includes(track))peer.media.addTrack(track);
    Promise.resolve(onMedia(peer.media,id)).catch(error=>{if(current())onError(error);});
   }catch(error){if(current())onError(error);}
  };
  pc.onicecandidate=e=>{if(e.candidate&&!closed&&peers.get(id)===peer)signal(id,'ice',e.candidate.toJSON?.()??e.candidate).catch(error=>{
   if(closed||peers.get(id)!==peer)return;
   // Once the data channel works, an optional late ICE candidate cannot make
   // a temporary lobby-service outage into a gameplay disconnect.
   if(error.retryable&&peer.channel?.readyState==='open')serviceWarning();else onError(error);
  });};
  pc.onconnectionstatechange=()=>{if(!closed&&peers.get(id)===peer&&['failed','disconnected'].includes(pc.connectionState)){onDisconnected(id);onError(new Error('Connection lost. Gameplay is paused; return to the lobby to reconnect. Some networks require a TURN relay.'));}};
  pc.ondatachannel=e=>{if(!closed&&peers.get(id)===peer)channelFor(id,e.channel);};
  if(offer){
   if(stream){
    try{if(typeof pc.addTrack!=='function')throw new Error();for(const track of tracks)peer.senders.push(pc.addTrack(track,stream));}
    catch{peers.delete(id);pc.close();throw new Error('This browser cannot send the host game stream. Choose synchronized play or another browser.');}
   }
   channelFor(id,pc.createDataChannel('bomberman',{ordered:true}));const description=await pc.createOffer();if(!current())return peer;await pc.setLocalDescription(description);if(current())await signal(id,'offer',pc.localDescription);
  }
  return peer;
 }
 async function limitVideo(peer){
  for(const sender of peer.senders)await tuneStreamSender(sender);
 }
 async function handleSignal(s){
  if(s.to!==playerId||!room.players.some(p=>p.id===s.from)||(!isHost()&&s.from!==room.hostId))return;
  if(!['offer','answer','ice'].includes(s.type)||!s.data||typeof s.data!=='object')throw new Error('Invalid player connection signal.');
  const peer=await peerFor(s.from),pc=peer.pc,current=()=>!closed&&peers.get(s.from)===peer;if(!current())return;
  if(s.type==='offer'){
   if(isHost())return;await pc.setRemoteDescription(s.data);if(!current())return;
   if(room.transport==='stream')try{for(const receiver of pc.getReceivers?.()??[])tuneStreamReceiver(receiver);}catch{}
   for(const c of peer.candidates){await pc.addIceCandidate(c);if(!current())return;}peer.candidates=[];
   const description=await pc.createAnswer();if(!current())return;await pc.setLocalDescription(description);if(current())await signal(s.from,'answer',pc.localDescription);
  }else if(s.type==='answer'){
   if(!isHost())return;await pc.setRemoteDescription(s.data);if(!current())return;for(const c of peer.candidates){await pc.addIceCandidate(c);if(!current())return;}peer.candidates=[];await limitVideo(peer);
  }else if(s.type==='ice'){if(pc.remoteDescription)await pc.addIceCandidate(s.data);else peer.candidates.push(s.data);}
 }
 async function poll(){
  cancel(pollTimer);pollTimer=null;if(closed||!room||polling)return;polling=true;const current=generation;
  try{
   const data=await backgroundApi('/'+room.code+'?after='+after);if(closed||current!==generation)return;
   if(!data||typeof data!=='object'||!data.room||data.room.code!==room.code||!Array.isArray(data.room.players)||data.room.players.length<1||data.room.players.length>5||
    data.room.players.some(p=>!p||typeof p.id!=='string'||!p.id.length)||new Set(data.room.players.map(p=>p.id)).size!==data.room.players.length||!data.room.players.some(p=>p.id===playerId)||
    (data.room.hostId!==null&&typeof data.room.hostId!=='string')||!Array.isArray(data.signals)||!Number.isSafeInteger(data.lastId)||data.lastId<after||
    data.signals.some(s=>!s||!Number.isSafeInteger(s.id)||s.id<=after||s.id>data.lastId||typeof s.to!=='string'||typeof s.from!=='string'))throw new Error('The lobby service returned invalid room data.');
   room=data.room;
   for(const s of data.signals??[]){if(closed||current!==generation)return;await handleSignal(s);}if(closed||current!==generation)return;after=data.lastId??after;
   for(const [id,peer]of peers)if(!room.players.some(p=>p.id===id)){peers.delete(id);streamStats.forget(id);peer.pc.close();onDisconnected(id);}
   if(isHost())for(const p of room.players)if(p.id!==playerId&&p.connected!==false){await peerFor(p.id,true);if(closed||current!==generation)return;}
   if(++heartbeat%10===0)await backgroundApi('/'+room.code+'/heartbeat','POST',{});if(pollFailures){pollFailures=0;onStatus('',{retrying:false,attempts:0});}announce();
  }catch(error){if(!closed&&current===generation){if(error.pollRetryable)serviceWarning();else onError(error);}}finally{if(current===generation){polling=false;if(!closed&&room)pollTimer=timer(poll,Math.min(8000,1000*2**Math.min(pollFailures,3)));}}
 }
 async function enter(path,info){
  const leaving=leave(),current=generation;await leaving;if(current!==generation)return null;closed=false;const data=await api(path,'POST',{...info,playerId,revision:ONLINE_REVISION,romHash:ROM_SHA256});
  if(closed||current!==generation){try{await request('/api/rooms/'+data.room.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.token},body:'{}'});}catch{}return null;}
  room=data.room;token=data.token;after=0;heartbeat=0;pollFailures=0;announce();await poll();return room;
 }
 async function leave(){
  closed=true;generation++;polling=false;pollFailures=0;statsPending=null;cancel(pollTimer);pollTimer=null;
  const previous=room,previousToken=token;room=null;token=null;onRoom(null,{playerId,isHost:false,connected:false});
  for(const peer of peers.values())peer.pc.close();peers.clear();transfers.clear();streamStats.reset();
  if(previous&&previousToken){try{await request('/api/rooms/'+previous.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+previousToken},body:'{}'});}catch{}}
 }
 function send(id,packet){const channel=peers.get(id)?.channel;if(channel?.readyState!=='open')return false;if(channel.bufferedAmount>1024*1024){onDisconnected(id);return false;}channel.send(JSON.stringify(packet));return true;}
 async function paced(id,packet){
  const channel=peers.get(id)?.channel;if(channel?.readyState!=='open')throw new Error('A player disconnected before the game could start.');
  if(channel.bufferedAmount>65536)await new Promise((resolve,reject)=>{const timeout=timer(()=>{channel.removeEventListener('bufferedamountlow',ready);reject(new Error('Game-state transfer timed out.'));},10000);const ready=()=>{cancel(timeout);channel.removeEventListener('bufferedamountlow',ready);resolve();};channel.addEventListener('bufferedamountlow',ready,{once:true});});
  channel.send(JSON.stringify(packet));
 }
 function recipients(){return room?isHost()?room.players.filter(p=>p.id!==playerId).map(p=>p.id):[room.hostId]:[];}
 function writable(){return connected()&&recipients().every(id=>peers.get(id)?.channel?.bufferedAmount<=65536);}
 async function connectionStats(){
  // One in-flight read per room keeps older reports from replacing a newer
  // interval baseline if a browser's getStats resolves out of order.
  if(statsPending)return statsPending;
  const pending=readConnectionStats();statsPending=pending;
  try{return await pending;}finally{if(statsPending===pending)statsPending=null;}
 }
 async function readConnectionStats(){
  const current=generation,streaming=room?.transport==='stream',live=recipients().map(id=>({id,peer:peers.get(id)})).filter(({peer})=>peer?.channel?.readyState==='open');
  const readings=await Promise.all(live.map(async({id,peer})=>{
   try{
    if(typeof peer.pc.getStats!=='function')return null;const stats=await peer.pc.getStats();
    if(closed||current!==generation||peers.get(id)!==peer||peer.channel?.readyState!=='open'||!stats?.values||!stats?.get)return null;
    let rtt=null;for(const report of stats.values())if(report.type==='transport'&&report.selectedCandidatePairId){
     const pair=stats.get(report.selectedCandidatePairId),seconds=pair?.currentRoundTripTime;
     if(pair?.type==='candidate-pair'&&Number.isFinite(seconds)&&seconds>=0)rtt=Math.max(rtt??0,seconds*1000);
    }return {rtt,media:streaming?streamStats.sample(stats,id):null};
   }catch{return null;}
  }));
  if(closed||current!==generation)return {rttMs:null,sampledPeers:0,connectedPeers:0};
  const samples=readings.map(reading=>reading?.rtt).filter(Number.isFinite),result={rttMs:samples.length?Math.max(...samples):null,sampledPeers:samples.length,connectedPeers:live.filter(({id,peer})=>peers.get(id)===peer&&peer.channel?.readyState==='open').length};
  if(streaming){
   const media=readings.map(reading=>reading?.media).filter(Boolean),summary={};
   for(const key of ['videoBufferMs','audioBufferMs','decodeMs','encodeMs','receiveFps','sendFps']){
    const values=media.map(sample=>sample[key]).filter(Number.isFinite);summary[key]=values.length?(key.endsWith('Fps')?Math.min(...values):Math.max(...values)):null;
   }
   summary.qualityLimitationReason=['bandwidth','cpu','other','none'].find(reason=>media.some(sample=>sample.qualityLimitationReason===reason))??null;result.media=summary;
  }
  return result;
 }
 return {get room(){return room;},get playerId(){return playerId;},get host(){return isHost();},get sessionGeneration(){return generation;},connected,writable,connectionStats,
  create:info=>enter('',info),join:(code,info)=>enter('/'+String(code).trim().toUpperCase()+'/join',info),leave,poll,
  async update(info){if(info.color&&!Object.hasOwn(COLORS,info.color))throw new Error('Choose a valid Bomberman color.');const current=generation,data=await api('/'+room.code+'/member','PATCH',info);if(!closed&&current===generation){room=data.room;announce();}},
  async checkpoint(value){const current=generation,data=await api('/'+room.code+'/checkpoint','PUT',{checkpoint:value});if(!closed&&current===generation){room=data.room;announce();}},
  async start(){if(!isHost()||!connected())throw new Error('Wait for every player to connect before starting.');const current=generation,data=await api('/'+room.code+'/start','POST',{});if(closed||current!==generation)return null;room=data.room;announce();return room;},
  broadcast(packet){
   const ids=room.players.filter(p=>p.id!==playerId).map(p=>p.id),blocked=id=>peers.get(id)?.channel?.readyState!=='open'||peers.get(id).channel.bufferedAmount>1024*1024;
   if(packet.type==='frames'){const unavailable=ids.find(blocked);if(unavailable!==undefined){if(peers.get(unavailable)?.channel?.bufferedAmount>1024*1024)onDisconnected(unavailable);return false;}return ids.every(id=>send(id,packet));}
   // A fatal pause must still reach the healthy players when another peer has
   // gone away. Controls skip blocked channels without recursive callbacks.
   let delivered=true;for(const id of ids){if(blocked(id)){delivered=false;continue;}send(id,packet);}return delivered;
  },toHost(packet){return send(room.hostId,packet);},
  async sendSnapshot(blob){
   if(!isHost()||blob.size<1||blob.size>MAX_TRANSFER)throw new Error('Invalid host game snapshot.');const bytes=new Uint8Array(await blob.arrayBuffer());
   for(const player of room.players.filter(p=>p.id!==playerId)){
    const id=crypto.randomUUID();await paced(player.id,{type:'transfer-start',id,size:bytes.length});
    for(let offset=0,index=0;offset<bytes.length;offset+=CHUNK,index++){const chunk=bytes.subarray(offset,offset+CHUNK);await paced(player.id,{type:'transfer-chunk',id,index,data:btoa(String.fromCharCode(...chunk))});}
    await paced(player.id,{type:'transfer-end',id});
   }
  }
 };
}
