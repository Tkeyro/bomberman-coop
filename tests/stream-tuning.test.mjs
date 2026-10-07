import test from 'node:test';
import assert from 'node:assert/strict';
import {tuneStreamReceiver,tuneStreamSender,createStreamStats} from '../dist/stream-tuning.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const report=(...entries)=>new Map(entries.map(entry=>[entry.id,entry]));
const inbound=(id,kind,timestamp,values={})=>({id,type:'inbound-rtp',kind,timestamp,ssrc:id,...values});
const outbound=(id,timestamp,values={})=>({id,type:'outbound-rtp',kind:'video',timestamp,ssrc:id,...values});

test('receiver requests the allowed minimum on both media kinds without fabricating support',()=>{
 for(const kind of ['audio','video']){
  const receiver=Object.create({jitterBufferTarget:null,playoutDelayHint:null});receiver.track={kind};
  assert.deepEqual(tuneStreamReceiver(receiver),{jitterBufferTarget:true,playoutDelayHint:true});
  assert.equal(receiver.jitterBufferTarget,0);assert.equal(receiver.playoutDelayHint,0);
 }
 const receiver={track:{kind:'video'}};
 assert.deepEqual(tuneStreamReceiver(receiver),{jitterBufferTarget:false,playoutDelayHint:false});
 assert.deepEqual(Object.keys(receiver),['track']);
 assert.deepEqual(tuneStreamReceiver(null),{jitterBufferTarget:false,playoutDelayHint:false});
 const nonMedia={track:{kind:'data'},jitterBufferTarget:null};tuneStreamReceiver(nonMedia);assert.equal(nonMedia.jitterBufferTarget,null);
});

test('a rejected receiver preference does not stop the legacy preference or playback',()=>{
 const receiver={track:{kind:'video'},set jitterBufferTarget(value){throw new Error('Not available.');},playoutDelayHint:null};
 assert.deepEqual(tuneStreamReceiver(receiver),{jitterBufferTarget:false,playoutDelayHint:true});
 assert.equal(receiver.playoutDelayHint,0);
 const locked={track:{kind:'audio'},get jitterBufferTarget(){return null;},get playoutDelayHint(){return null;}};
 assert.deepEqual(tuneStreamReceiver(locked),{jitterBufferTarget:false,playoutDelayHint:false});
});

test('video limits and frame-rate preference are independent calls using fresh parameters',async()=>{
 let parameters={transactionId:'first',encodings:[{rid:'one',active:true},{rid:'two',active:false}]};const writes=[];
 const sender={track:{kind:'video'},getParameters(){return structuredClone(parameters);},async setParameters(value){writes.push(value);parameters={...structuredClone(value),transactionId:'fresh'};}};
 assert.deepEqual(await tuneStreamSender(sender),{encodingLimits:true,maintainFramerate:true});
 assert.equal(writes.length,2);assert.equal(writes[0].degradationPreference,undefined);
 assert.equal(writes[1].transactionId,'fresh');assert.equal(writes[1].degradationPreference,'maintain-framerate');
 assert.deepEqual(writes[1].encodings,[{rid:'one',active:true,maxBitrate:2500000,maxFramerate:60},{rid:'two',active:false,maxBitrate:2500000,maxFramerate:60}]);
 const audio={track:{kind:'audio'},getParameters(){assert.fail('Audio should keep its native settings.');}};
 assert.deepEqual(await tuneStreamSender(audio),{encodingLimits:false,maintainFramerate:false});
 assert.deepEqual(await tuneStreamSender({track:{kind:'video'}}),{encodingLimits:false,maintainFramerate:false});
});

test('unsupported sender tuning never rejects and an optional preference cannot discard limits',async()=>{
 let parameters={encodings:[{}]},reads=0;
 const sender={track:{kind:'video'},getParameters(){reads++;return structuredClone(parameters);},async setParameters(value){if(value.degradationPreference)throw new Error('Unsupported preference.');parameters=value;}};
 assert.deepEqual(await tuneStreamSender(sender),{encodingLimits:true,maintainFramerate:false});
 assert.equal(reads,2);assert.deepEqual(parameters.encodings,[{maxBitrate:2500000,maxFramerate:60}]);
 const opposite={track:{kind:'video'},getParameters(){return {encodings:[{}]};},async setParameters(value){if(!value.degradationPreference)throw new Error('Unsupported limits.');}};
 assert.deepEqual(await tuneStreamSender(opposite),{encodingLimits:false,maintainFramerate:true});
 const broken={track:{kind:'video'},getParameters(){throw new Error('Closed sender.');},setParameters(){assert.fail('No valid parameters.');}};
 assert.deepEqual(await tuneStreamSender(broken),{encodingLimits:false,maintainFramerate:false});
});

test('stream diagnostics use interval counters weighted by samples or frames, never lifetime averages',()=>{
 const stats=createStreamStats();
 const initial=stats.sample(report(
  inbound('a','video',1000,{jitterBufferDelay:1,jitterBufferEmittedCount:10,totalDecodeTime:0.1,framesDecoded:10}),
  inbound('b','video',1000,{jitterBufferDelay:2,jitterBufferEmittedCount:20,totalDecodeTime:0.4,framesDecoded:20}),
  inbound('audio','audio',1000,{jitterBufferDelay:400,jitterBufferEmittedCount:10000}),
  outbound('out-a',1000,{totalEncodeTime:0.1,framesEncoded:10,qualityLimitationReason:'none'}),
  outbound('out-b',1000,{totalEncodeTime:1,framesEncoded:20,qualityLimitationReason:'cpu'})
 ),'guest');
 assert.equal(initial.videoBufferMs,null);assert.equal(initial.audioBufferMs,null);assert.equal(initial.decodeMs,null);assert.equal(initial.encodeMs,null);assert.equal(initial.receiveFps,null);assert.equal(initial.sendFps,null);
 assert.equal(initial.qualityLimitationReason,'cpu');
 const current=stats.sample(report(
  inbound('a','video',2000,{jitterBufferDelay:1.2,jitterBufferEmittedCount:12,totalDecodeTime:0.11,framesDecoded:12}),
  inbound('b','video',2000,{jitterBufferDelay:2.9,jitterBufferEmittedCount:38,totalDecodeTime:0.49,framesDecoded:38}),
  inbound('audio','audio',2000,{jitterBufferDelay:1360,jitterBufferEmittedCount:58000}),
  outbound('out-a',2000,{totalEncodeTime:0.12,framesEncoded:12,qualityLimitationReason:'none'}),
  outbound('out-b',2000,{totalEncodeTime:1.54,framesEncoded:38,qualityLimitationReason:'bandwidth'})
 ),'guest');
 close(current.videoBufferMs,55);close(current.audioBufferMs,20);close(current.decodeMs,5);close(current.encodeMs,28);
 assert.equal(current.receiveFps,20);assert.equal(current.sendFps,20);assert.equal(current.qualityLimitationReason,'bandwidth');
 assert.equal(current.rttMs,null);
});

test('counter, timestamp and stream changes start fresh intervals rather than returning negative or old costs',()=>{
 const stats=createStreamStats(),read=(timestamp,delay,count,decode,ssrc='a')=>report(inbound('a','video',timestamp,{ssrc,jitterBufferDelay:delay,jitterBufferEmittedCount:count,totalDecodeTime:decode,framesDecoded:count}));
 stats.sample(read(1000,1,100,0.2),'peer');
 const reset=stats.sample(read(2000,0.05,5,0.01),'peer');
 assert.equal(reset.videoBufferMs,null);assert.equal(reset.decodeMs,null);assert.equal(reset.receiveFps,null);
 const recovered=stats.sample(read(3000,0.2,15,0.03),'peer');close(recovered.videoBufferMs,15);close(recovered.decodeMs,2);assert.equal(recovered.receiveFps,10);
 const cached=stats.sample(read(3000,0.2,15,0.03),'peer');assert.equal(cached.videoBufferMs,null);assert.equal(cached.receiveFps,null);
 const switched=stats.sample(read(4000,0.4,30,0.09,'replacement'),'peer');assert.equal(switched.videoBufferMs,null);assert.equal(switched.decodeMs,null);
 const restarted=stats.sample(read(500,0.5,35,0.1,'replacement'),'peer');assert.equal(restarted.videoBufferMs,null);assert.equal(restarted.receiveFps,null);
 const continuing=stats.sample(read(1500,0.6,40,0.11,'replacement'),'peer');close(continuing.videoBufferMs,20);close(continuing.decodeMs,2);
 stats.sample(report(),'peer');assert.equal(stats.sample(read(2500,0.7,45,0.12,'replacement'),'peer').videoBufferMs,null);
});

test('peer identity isolates equal stats IDs, and forgetting or resetting removes only intended history',()=>{
 const stats=createStreamStats(),read=(timestamp,count,delay)=>report(inbound('same','video',timestamp,{jitterBufferDelay:delay,jitterBufferEmittedCount:count,framesDecoded:count}));
 stats.sample(read(1000,10,1),'first');stats.sample(read(1000,100,10),'second');
 close(stats.sample(read(2000,20,1.1),'first').videoBufferMs,10);
 close(stats.sample(read(2000,110,10.5),'second').videoBufferMs,50);
 stats.forget('first');assert.equal(stats.sample(read(3000,30,1.2),'first').videoBufferMs,null);
 close(stats.sample(read(3000,120,11),'second').videoBufferMs,50);
 stats.reset();assert.equal(stats.sample(read(4000,130,11.5),'second').videoBufferMs,null);
});

test('missing or invalid media counters are unsupported rather than zero, while a stopped frame rate is zero',()=>{
 const stats=createStreamStats();assert.ok(Object.values(stats.sample(null,'peer')).every(value=>value===null));
 const values={jitterBufferDelay:0,jitterBufferEmittedCount:0,framesDecoded:0};
 stats.sample(report(inbound('video','video',1000,values)),'peer');
 const paused=stats.sample(report(inbound('video','video',2000,values)),'peer');
 assert.equal(paused.videoBufferMs,null);assert.equal(paused.decodeMs,null);assert.equal(paused.receiveFps,0);
 const invalid=stats.sample(report(inbound('video','video',3000,{jitterBufferDelay:Infinity,jitterBufferEmittedCount:NaN,totalDecodeTime:-1,framesDecoded:'60'})),'peer');
 assert.equal(invalid.videoBufferMs,null);assert.equal(invalid.decodeMs,null);assert.equal(invalid.receiveFps,null);
 const empty=stats.sample(report({id:'out',type:'outbound-rtp',kind:'video',timestamp:1000,qualityLimitationReason:'invalid'}),'peer');assert.equal(empty.qualityLimitationReason,null);
});

test('only selected ICE pairs contribute instantaneous path diagnostics without exposing addresses',()=>{
 const stats=createStreamStats();
 const selected=stats.sample(report(
  {id:'transport',type:'transport',selectedCandidatePairId:'selected'},
  {id:'selected',type:'candidate-pair',currentRoundTripTime:0.024,availableOutgoingBitrate:900000,localCandidateId:'local',remoteCandidateId:'remote'},
  {id:'unused',type:'candidate-pair',nominated:true,currentRoundTripTime:9,availableOutgoingBitrate:1},
  {id:'local',type:'local-candidate',candidateType:'host',protocol:'udp',address:'secret'},
  {id:'remote',type:'remote-candidate',candidateType:'srflx',address:'also-secret'}
 ),'peer');
 assert.equal(selected.rttMs,24);assert.equal(selected.availableOutgoingBitrate,900000);assert.equal(selected.localCandidateType,'host');assert.equal(selected.remoteCandidateType,'srflx');assert.equal(selected.protocol,'udp');
 assert.ok(!JSON.stringify(selected).includes('secret'));
 const bad=stats.sample(report({id:'transport',type:'transport',selectedCandidatePairId:'bad'},{id:'bad',type:'candidate-pair',currentRoundTripTime:-1,availableOutgoingBitrate:'1'}),'peer');
 assert.equal(bad.rttMs,null);assert.equal(bad.availableOutgoingBitrate,null);
});


test('mutable browser reports cannot overwrite interval baselines and measured zero costs remain zero',()=>{
 const stats=createStreamStats();
 const frame=inbound('video','video',1000,{jitterBufferDelay:0,jitterBufferEmittedCount:10,totalDecodeTime:0,framesDecoded:10});
 const mutable=report(frame);stats.sample(mutable,'peer');
 frame.timestamp=2000;frame.jitterBufferEmittedCount=20;frame.framesDecoded=20;
 const measured=stats.sample(mutable,'peer');assert.equal(measured.videoBufferMs,0);assert.equal(measured.decodeMs,0);assert.equal(measured.receiveFps,10);
 const throwing={values(){throw new Error('Unavailable report.');},get(){}};
 assert.ok(Object.values(stats.sample(throwing,'peer')).every(value=>value===null));
});
