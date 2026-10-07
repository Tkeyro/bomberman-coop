// Only the game canvas and the emulator's audio enter this stream.
export function createHostStream({canvas,video,getMachine=()=>null,onStatus=()=>{},onError=()=>{},MediaStream:Stream=globalThis.MediaStream}={}){
 let stream=null,capture=null,audio=null,guestVisible=false,muted=false,unlocked=false,playback=0;
 const state={get stream(){return stream;},get guestVisible(){return guestVisible;}};
 function setGuestVisible(visible){
  guestVisible=!!visible;if(video)video.hidden=!guestVisible;if(canvas)canvas.hidden=guestVisible;
 }
 function setMuted(value){muted=!!value;if(video)video.muted=muted||!unlocked;}
 function disconnectAudio(){
  if(!audio)return;
  if(audio.gain){
   try{audio.source.disconnect(audio.gain);}catch{}
   try{audio.gain.disconnect(audio.destination);}catch{}
  }
  for(const track of audio.destination.stream.getTracks())track.stop();
  audio=null;
 }
 function stop(){
  playback++;
  if(video){video.pause?.();video.srcObject=null;}
  // Receiving tracks belong to the peer connection, not to this controller.
  if(capture)for(const track of capture.getTracks())track.stop();
  disconnectAudio();stream=null;capture=null;setGuestVisible(false);
 }
 function startHost(){
  stop();
  try{
   if(typeof canvas?.captureStream!=='function'||typeof Stream!=='function')throw new Error('Host streaming is not supported in this browser. Try a current Chrome, Edge or Firefox browser.');
   capture=canvas.captureStream(60);
   const tracks=capture.getVideoTracks().filter(track=>track.readyState!=='ended');
   if(!tracks.length)throw new Error('The game canvas did not provide a video stream.');
   for(const track of tracks)try{track.contentHint='motion';}catch{}
   stream=new Stream(tracks);
   const machine=getMachine(),context=machine?.WebAudioCtx,source=machine?.WebAudioJsNode;
   let hasAudio=false;
   if(context&&source&&typeof context.createMediaStreamDestination==='function'&&typeof context.createGain==='function'){
    try{
     const destination=context.createMediaStreamDestination();audio={source,gain:null,destination};
     const gain=context.createGain();audio.gain=gain;gain.gain.value=.6;
     // Branch before the emulator's local mute/volume gain.
     source.connect(gain);gain.connect(destination);
     for(const track of destination.stream.getAudioTracks()){stream.addTrack(track);hasAudio=true;}
    }catch{disconnectAudio();}
   }
   onStatus(hasAudio?'Host streaming is ready.':'Host streaming is ready without game audio.');
   return stream;
  }catch(error){stop();onError(error);throw error;}
 }
 async function play(){
  if(!video?.srcObject)return false;
  const request=++playback;
  try{await video.play();return request===playback&&!!video.srcObject;}
  catch(error){
   if(request===playback&&video.srcObject)onStatus(error?.name==='NotAllowedError'?'Click the game screen to start the stream and enable audio.':'The game stream could not play. Click the game screen to try again.');
   return false;
  }
 }
 function receive(incoming){
  if(!video)throw new Error('The streamed game video element is missing.');
  video.autoplay=true;video.playsInline=true;
  // Audio and video track callbacks reuse one aggregate stream. Keep that
  // stream attached instead of restarting playback when its audio arrives.
  const changed=video.srcObject!==incoming;
  if(changed){playback++;video.srcObject=incoming;}setMuted(muted);
  if(!unlocked&&!muted&&incoming?.getAudioTracks().length)onStatus('Click the game screen to enable streamed audio.');
  if(changed)void play();
 }
 async function unlock(){
  unlocked=true;setMuted(muted);
  if(video?.srcObject)return play();
  const context=getMachine()?.WebAudioCtx;
  try{if(context?.state==='suspended')await context.resume();return true;}
  catch{onStatus('Click the game screen to enable game audio.');return false;}
 }
 setGuestVisible(false);setMuted(false);
 return {startHost,receive,setGuestVisible,unlock,play,setMuted,stop,state};
}
