import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostStream} from '../dist/host-stream.js';

class Track{
 constructor(kind){this.kind=kind;this.readyState='live';this.stops=0;}
 stop(){this.stops++;this.readyState='ended';}
}
class Stream{
 constructor(tracks=[]){this.tracks=[...tracks];}
 addTrack(track){if(!this.tracks.includes(track))this.tracks.push(track);}
 getTracks(){return [...this.tracks];}
 getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
 getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
}
function fixture({audio=true}={}){
 const videoTrack=new Track('video'),audioTrack=new Track('audio'),capture=new Stream([videoTrack]);
 const connections=new Set(),localGain={gain:{value:0}},source={connect(node){connections.add(node);},disconnect(node){assert.ok(node,'cleanup must identify only the streaming branch');connections.delete(node);}};
 source.connect(localGain);
 const destination={stream:new Stream([audioTrack])},gain={gain:{value:0},connect(node){this.destination=node;},disconnect(node){assert.equal(node,this.destination);this.destination=null;}};
 const context={state:'suspended',resumes:0,async resume(){this.resumes++;this.state='running';},createMediaStreamDestination(){return destination;},createGain(){return gain;},close(){assert.fail('the game AudioContext must remain open');},suspend(){assert.fail('the game AudioContext must remain active');}};
 const machine=audio?{WebAudioCtx:context,WebAudioJsNode:source,WebAudioGainNode:localGain,WaveVolume:0}:{};
 const canvas={hidden:false,rates:[],captureStream(rate){this.rates.push(rate);return capture;}};
 const video={hidden:true,srcObject:null,muted:false,plays:0,pauses:0,async play(){this.plays++;},pause(){this.pauses++;}};
 const status=[],errors=[],controller=createHostStream({canvas,video,getMachine:()=>machine,onStatus:s=>status.push(s),onError:e=>errors.push(e),MediaStream:Stream});
 return {controller,canvas,video,videoTrack,audioTrack,capture,source,localGain,gain,destination,context,machine,connections,status,errors};
}

test('host capture streams only the canvas and game audio before local mute, and cleanup preserves native audio',async()=>{
 const f=fixture(),stream=f.controller.startHost();
 assert.deepEqual(f.canvas.rates,[60]);assert.equal(stream,f.controller.state.stream);
 assert.deepEqual(stream.getTracks(),[f.videoTrack,f.audioTrack]);assert.equal(f.videoTrack.contentHint,'detail');
 assert.equal(f.gain.gain.value,.6);assert.equal(f.localGain.gain.value,0);assert.equal(f.machine.WaveVolume,0);
 assert.deepEqual(f.connections,new Set([f.localGain,f.gain]));assert.equal(f.gain.destination,f.destination);
 assert.equal(f.canvas.hidden,false);assert.equal(f.video.hidden,true);assert.equal(f.controller.state.guestVisible,false);
 assert.equal(await f.controller.unlock(),true);assert.equal(f.context.resumes,1);
 f.controller.stop();assert.deepEqual(f.connections,new Set([f.localGain]));assert.equal(f.gain.destination,null);
 assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);assert.equal(f.controller.state.stream,null);assert.equal(f.context.state,'running');
 f.controller.stop();assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);assert.equal(f.errors.length,0);
});

test('host permits video without audio and reports unsupported or failed canvas capture with cleanup',()=>{
 const f=fixture({audio:false}),stream=f.controller.startHost();
 assert.deepEqual(stream.getTracks(),[f.videoTrack]);assert.match(f.status.at(-1),/without game audio/);assert.equal(f.errors.length,0);f.controller.stop();
 const unsupported=fixture();unsupported.canvas.captureStream=undefined;
 assert.throws(()=>unsupported.controller.startHost(),/not supported/);assert.equal(unsupported.errors.length,1);assert.equal(unsupported.controller.state.stream,null);
 const empty=fixture();empty.canvas.captureStream=()=>new Stream([]);
 assert.throws(()=>empty.controller.startHost(),/did not provide a video stream/);assert.equal(empty.errors.length,1);assert.equal(empty.controller.state.stream,null);
});

test('failed streaming audio detaches its branch and releases its track without damaging local playback',()=>{
 const f=fixture();f.gain.connect=()=>{throw new Error('audio graph rejected');};
 const stream=f.controller.startHost();assert.deepEqual(stream.getTracks(),[f.videoTrack]);
 assert.deepEqual(f.connections,new Set([f.localGain]));assert.equal(f.audioTrack.stops,1);assert.equal(f.videoTrack.stops,0);
 assert.match(f.status.at(-1),/without game audio/);f.controller.stop();assert.equal(f.audioTrack.stops,1);assert.equal(f.videoTrack.stops,1);
});

test('received media waits for game visibility, autoplays muted, then unlocks audio on a gesture and preserves remote track ownership',async()=>{
 const f=fixture(),remoteVideo=new Track('video'),remoteAudio=new Track('audio'),remote=new Stream([remoteVideo,remoteAudio]);
 f.controller.receive(remote);assert.equal(f.video.srcObject,remote);assert.equal(f.video.autoplay,true);assert.equal(f.video.playsInline,true);
 assert.equal(f.video.muted,true);assert.equal(f.video.plays,1);assert.equal(f.canvas.hidden,false);assert.equal(f.video.hidden,true);
 assert.match(f.status.at(-1),/Click the game screen/);
 f.controller.setGuestVisible(true);assert.equal(f.canvas.hidden,true);assert.equal(f.video.hidden,false);assert.equal(f.controller.state.guestVisible,true);
 assert.equal(await f.controller.unlock(),true);assert.equal(f.video.muted,false);assert.equal(f.video.plays,2);
 f.controller.setMuted(true);assert.equal(f.video.muted,true);f.controller.setMuted(false);assert.equal(f.video.muted,false);
 f.controller.stop();assert.equal(f.video.srcObject,null);assert.equal(f.canvas.hidden,false);assert.equal(f.video.hidden,true);
 assert.equal(remoteVideo.stops,0);assert.equal(remoteAudio.stops,0);
});

test('autoplay failure prompts a gesture, allows retry, and ignores playback promises completed after stop',async()=>{
 const f=fixture(),remote=new Stream([new Track('video')]);
 f.video.play=async()=>{throw Object.assign(new Error('gesture required'),{name:'NotAllowedError'});};
 f.controller.receive(remote);await Promise.resolve();await Promise.resolve();assert.match(f.status.at(-1),/Click the game screen to start/);
 f.video.play=async()=>{};assert.equal(await f.controller.unlock(),true);
 let reject;f.video.play=()=>new Promise((_,r)=>{reject=r;});const pending=f.controller.play();
 f.controller.stop();const before=f.status.length;reject(new Error('late rejection'));assert.equal(await pending,false);assert.equal(f.status.length,before);
});
