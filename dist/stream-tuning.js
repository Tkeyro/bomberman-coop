// Optional WebRTC preferences. A zero target requests the browser's allowed
// minimum; it does not promise zero buffering or measure input-to-display time.
// https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-jitterbuffertarget
export function tuneStreamReceiver(receiver){
 const applied={jitterBufferTarget:false,playoutDelayHint:false};
 if(!receiver||!['audio','video'].includes(receiver.track?.kind))return applied;
 for(const property of Object.keys(applied))try{
  // Feature detection avoids silently adding an ineffective JS property.
  if(property in receiver){receiver[property]=0;applied[property]=true;}
 }catch{}
 return applied;
}

// Preserve the existing bitrate ceiling while preferring motion over detail.
// Each setParameters call receives fresh parameters, as required by WebRTC.
// The separate preference call cannot discard successfully applied limits.
// https://www.w3.org/TR/mst-content-hint/#degradation-preference-when-encoding
export async function tuneStreamSender(sender){
 const applied={encodingLimits:false,maintainFramerate:false};
 if(sender?.track?.kind!=='video'||typeof sender.getParameters!=='function'||typeof sender.setParameters!=='function')return applied;
 try{
  const parameters=sender.getParameters();
  if(parameters?.encodings?.length){
   for(const encoding of parameters.encodings){encoding.maxBitrate=2500000;encoding.maxFramerate=60;}
   await sender.setParameters(parameters);applied.encodingLimits=true;
  }
 }catch{}
 try{
  const parameters=sender.getParameters();
  if(parameters&&typeof parameters==='object'){
   parameters.degradationPreference='maintain-framerate';
   await sender.setParameters(parameters);applied.maintainFramerate=true;
  }
 }catch{}
 return applied;
}

const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const reasonPriority=['bandwidth','cpu','other','none'];
const emptyStats=()=>({rttMs:null,videoBufferMs:null,audioBufferMs:null,decodeMs:null,encodeMs:null,receiveFps:null,sendFps:null,qualityLimitationReason:null,availableOutgoingBitrate:null,localCandidateType:null,remoteCandidateType:null,protocol:null});
const sameStream=(current,previous)=>previous&&current.type===previous.type&&(current.kind??current.mediaType)===(previous.kind??previous.mediaType)&&current.ssrc===previous.ssrc&&finite(current.timestamp)&&finite(previous.timestamp)&&current.timestamp>previous.timestamp;
function counterDelta(current,previous,key){
 if(!finite(current[key])||!finite(previous[key])||current[key]<previous[key])return null;
 return current[key]-previous[key];
}
function addRatio(accumulator,current,previous,total,count){
 const numerator=counterDelta(current,previous,total),denominator=counterDelta(current,previous,count);
 if(numerator===null||denominator===null||denominator===0)return;
 accumulator.total+=numerator;accumulator.count+=denominator;
}
const averageMs=accumulator=>accumulator.count?accumulator.total/accumulator.count*1000:null;
const unanimous=values=>values.length&&values.every(value=>value===values[0])?values[0]:null;

// All media costs are interval averages computed from two reports, weighted by
// frames/samples. Audio samples and video frames have separate denominators.
// They are individual pipeline measurements, not end-to-end latency estimates.
// https://www.w3.org/TR/webrtc-stats/
export function createStreamStats(){
 const baselines=new Map();
 function sample(report,peerId){
  const result=emptyStats();
  if(!report||typeof report.values!=='function'||typeof report.get!=='function')return result;
  let entries;try{entries=[...report.values()];}catch{return result;}
  const previous=baselines.get(peerId)??new Map(),next=new Map();
  const videoBuffer={total:0,count:0},audioBuffer={total:0,count:0},decode={total:0,count:0},encode={total:0,count:0};
  const selected=new Set();let receiveFps=null,sendFps=null;
  for(const current of entries){
   if(!current||typeof current!=='object')continue;
   if(current.type==='transport'&&typeof current.selectedCandidatePairId==='string')selected.add(current.selectedCandidatePairId);
   const kind=current.kind??current.mediaType;
   if(!['inbound-rtp','outbound-rtp'].includes(current.type)||!['audio','video'].includes(kind)||typeof current.id!=='string')continue;
   // Snapshot primitive counters: callers or mocks may reuse/mutate objects.
   next.set(current.id,{...current});
   if(current.type==='outbound-rtp'&&kind==='video'&&current.active!==false&&reasonPriority.includes(current.qualityLimitationReason)){
    if(result.qualityLimitationReason===null||reasonPriority.indexOf(current.qualityLimitationReason)<reasonPriority.indexOf(result.qualityLimitationReason))result.qualityLimitationReason=current.qualityLimitationReason;
   }
   const before=previous.get(current.id);
   if(!sameStream(current,before))continue;
   if(current.type==='inbound-rtp'){
    addRatio(kind==='video'?videoBuffer:audioBuffer,current,before,'jitterBufferDelay','jitterBufferEmittedCount');
    if(kind==='video'){
     addRatio(decode,current,before,'totalDecodeTime','framesDecoded');
     const frames=counterDelta(current,before,'framesDecoded');
     if(frames!==null)receiveFps=(receiveFps??0)+frames*1000/(current.timestamp-before.timestamp);
    }
   }else if(kind==='video'){
    addRatio(encode,current,before,'totalEncodeTime','framesEncoded');
    const frames=counterDelta(current,before,'framesEncoded');
    if(frames!==null)sendFps=(sendFps??0)+frames*1000/(current.timestamp-before.timestamp);
   }
  }
  // An absent RTP report ends that report's interval; a replacement starts with
  // an empty baseline. A counter/timestamp reset also begins a fresh interval.
  baselines.set(peerId,next);
  result.videoBufferMs=averageMs(videoBuffer);result.audioBufferMs=averageMs(audioBuffer);
  result.decodeMs=averageMs(decode);result.encodeMs=averageMs(encode);
  result.receiveFps=receiveFps;result.sendFps=sendFps;
  const localTypes=[],remoteTypes=[],protocols=[];
  for(const id of selected){
   let pair;try{pair=report.get(id);}catch{continue;}
   if(pair?.type!=='candidate-pair')continue;
   if(finite(pair.currentRoundTripTime))result.rttMs=Math.max(result.rttMs??0,pair.currentRoundTripTime*1000);
   if(finite(pair.availableOutgoingBitrate))result.availableOutgoingBitrate=Math.min(result.availableOutgoingBitrate??Infinity,pair.availableOutgoingBitrate);
   let local,remote;try{local=report.get(pair.localCandidateId);remote=report.get(pair.remoteCandidateId);}catch{continue;}
   if(local?.type==='local-candidate'&&typeof local.candidateType==='string')localTypes.push(local.candidateType);
   if(remote?.type==='remote-candidate'&&typeof remote.candidateType==='string')remoteTypes.push(remote.candidateType);
   if(local?.type==='local-candidate'&&typeof local.protocol==='string')protocols.push(local.protocol);
  }
  result.localCandidateType=unanimous(localTypes);result.remoteCandidateType=unanimous(remoteTypes);result.protocol=unanimous(protocols);
  return result;
 }
 return {sample,forget:peerId=>baselines.delete(peerId),reset:()=>baselines.clear()};
}
