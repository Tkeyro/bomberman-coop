import {COLORS,ROM_SHA256} from './session.js';
export const ONLINE_REVISION='0.4.0';
const MAX_TRANSFER=16*1024*1024,CHUNK=8192;
export function stablePlayerID(storage=globalThis.localStorage){
 let id;try{id=storage?.getItem('bomberman-player-id');}catch{}
 if(!/^[a-zA-Z0-9_-]{16,64}$/.test(id??'')){id=crypto.randomUUID();try{storage?.setItem('bomberman-player-id',id);}catch{}}
 return id;
}
// Lobby records/signaling travel over HTTP. Only the peers receive game state;
// the game file is never sent to the server or to another browser.
export function createOnlineRoom({playerId=stablePlayerID(),fetch:request=globalThis.fetch,Peer=globalThis.RTCPeerConnection,
 onRoom=()=>{},onData=()=>{},onReady=()=>{},onDisconnected=()=>{},onError=()=>{},timer=setTimeout,cancel=clearTimeout}={}){
 let room=null,token=null,pollTimer=null,after=0,closed=false,polling=false,heartbeat=0,generation=0;
 const peers=new Map(),transfers=new Map();
 const isHost=()=>room?.hostId===playerId;
 async function api(path='',method='GET',body){
  const response=await request('/api/rooms'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{throw new Error('The lobby service is unavailable. Refresh and try again.');}
  if(!response.ok)throw new Error(data.error??'The lobby request failed.');return data;
 }
 function connected(){return Boolean(room&&room.players.length>=2&&room.players.filter(p=>p.id!==playerId).every(p=>isHost()?peers.get(p.id)?.channel?.readyState==='open':peers.get(room.hostId)?.channel?.readyState==='open'));}
 function announce(){onRoom(room,{playerId,isHost:isHost(),connected:connected()});if(connected())onReady(room);}
 async function signal(to,type,data){await api('/'+room.code+'/signals','POST',{to,type,data});}
 function channelFor(id,channel){
  const peer=peers.get(id);peer.channel=channel;channel.bufferedAmountLowThreshold=65536;
  channel.onopen=()=>announce();channel.onclose=()=>{announce();onDisconnected(id);};channel.onerror=()=>onError(new Error('A player connection failed. The game is paused.'));
  channel.onmessage=event=>{
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
  const pc=new Peer({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}),peer={pc,channel:null,candidates:[]};peers.set(id,peer);
  pc.onicecandidate=e=>{if(e.candidate)signal(id,'ice',e.candidate.toJSON?.()??e.candidate).catch(onError);};
  pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState)){onDisconnected(id);onError(new Error('Connection lost. Gameplay is paused; return to the lobby to reconnect. Some networks require a TURN relay.'));}};
  pc.ondatachannel=e=>channelFor(id,e.channel);
  if(offer){channelFor(id,pc.createDataChannel('bomberman',{ordered:true}));await pc.setLocalDescription(await pc.createOffer());await signal(id,'offer',pc.localDescription);}
  return peer;
 }
 async function handleSignal(s){
  if(s.to!==playerId||!room.players.some(p=>p.id===s.from)||(!isHost()&&s.from!==room.hostId))return;
  const peer=await peerFor(s.from),pc=peer.pc;
  if(s.type==='offer'){
   if(isHost())return;await pc.setRemoteDescription(s.data);for(const c of peer.candidates)await pc.addIceCandidate(c);peer.candidates=[];
   await pc.setLocalDescription(await pc.createAnswer());await signal(s.from,'answer',pc.localDescription);
  }else if(s.type==='answer'){
   if(!isHost())return;await pc.setRemoteDescription(s.data);for(const c of peer.candidates)await pc.addIceCandidate(c);peer.candidates=[];
  }else if(s.type==='ice'){if(pc.remoteDescription)await pc.addIceCandidate(s.data);else peer.candidates.push(s.data);}
 }
 async function poll(){
  cancel(pollTimer);pollTimer=null;if(closed||!room||polling)return;polling=true;const current=generation;
  try{
   const data=await api('/'+room.code+'?after='+after);if(closed||current!==generation)return;room=data.room;
   for(const s of data.signals??[]){if(closed||current!==generation)return;await handleSignal(s);}after=data.lastId??after;
   for(const [id,peer]of peers)if(!room.players.some(p=>p.id===id)){peer.pc.close();peers.delete(id);onDisconnected(id);}
   if(isHost())for(const p of room.players)if(p.id!==playerId&&p.connected!==false)await peerFor(p.id,true);
   if(++heartbeat%10===0)await api('/'+room.code+'/heartbeat','POST',{});announce();
  }catch(error){if(!closed&&current===generation)onError(error);}finally{if(current===generation){polling=false;if(!closed&&room)pollTimer=timer(poll,1000);}}
 }
 async function enter(path,info){
  const leaving=leave(),current=generation;await leaving;if(current!==generation)return null;closed=false;const data=await api(path,'POST',{...info,playerId,revision:ONLINE_REVISION,romHash:ROM_SHA256});
  if(closed||current!==generation){try{await request('/api/rooms/'+data.room.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.token},body:'{}'});}catch{}return null;}
  room=data.room;token=data.token;after=0;heartbeat=0;announce();await poll();return room;
 }
 async function leave(){
  closed=true;generation++;polling=false;cancel(pollTimer);pollTimer=null;
  const previous=room,previousToken=token;room=null;token=null;onRoom(null,{playerId,isHost:false,connected:false});
  for(const peer of peers.values())peer.pc.close();peers.clear();transfers.clear();
  if(previous&&previousToken){try{await request('/api/rooms/'+previous.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+previousToken},body:'{}'});}catch{}}
 }
 function send(id,packet){const channel=peers.get(id)?.channel;if(channel?.readyState!=='open')return false;if(channel.bufferedAmount>1024*1024){onDisconnected(id);return false;}channel.send(JSON.stringify(packet));return true;}
 async function paced(id,packet){
  const channel=peers.get(id)?.channel;if(channel?.readyState!=='open')throw new Error('A player disconnected before the game could start.');
  if(channel.bufferedAmount>65536)await new Promise((resolve,reject)=>{const timeout=timer(()=>{channel.removeEventListener('bufferedamountlow',ready);reject(new Error('Game-state transfer timed out.'));},10000);const ready=()=>{cancel(timeout);channel.removeEventListener('bufferedamountlow',ready);resolve();};channel.addEventListener('bufferedamountlow',ready,{once:true});});
  channel.send(JSON.stringify(packet));
 }
 return {get room(){return room;},get playerId(){return playerId;},get host(){return isHost();},connected,
  create:info=>enter('',info),join:(code,info)=>enter('/'+String(code).trim().toUpperCase()+'/join',info),leave,poll,
  async update(info){if(info.color&&!Object.hasOwn(COLORS,info.color))throw new Error('Choose a valid Bomberman color.');const current=generation,data=await api('/'+room.code+'/member','PATCH',info);if(!closed&&current===generation){room=data.room;announce();}},
  async checkpoint(value){const current=generation,data=await api('/'+room.code+'/checkpoint','PUT',{checkpoint:value});if(!closed&&current===generation){room=data.room;announce();}},
  async start(){if(!isHost()||!connected())throw new Error('Wait for every player to connect before starting.');const current=generation,data=await api('/'+room.code+'/start','POST',{});if(closed||current!==generation)return null;room=data.room;announce();return room;},
  broadcast(packet){return room.players.filter(p=>p.id!==playerId).every(p=>send(p.id,packet));},toHost(packet){return send(room.hostId,packet);},
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
