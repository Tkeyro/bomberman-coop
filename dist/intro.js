import {isCampaign} from './campaign.js';

// The native opening polls pressed Run at bank 1, PC 0xb269. Supply one press
// at that poll, accepting an early request without leaking Run/Space into
// gameplay. The launch gate closes as soon as the first campaign stage runs.
export function createIntroSkip(p) {
 const state={pending:false,requested:false},get=p.Get;
 p.Get=function(address){
  const value=get.call(this,address);
  if(state.pending&&state.requested&&address===0x220a&&this.PC===0xb269&&this.MPR[5]===8192){state.requested=false;return value|8;}
  return value;
 };
 function configure(enabled){Object.assign(state,{pending:enabled,requested:false});}
 return {state,configure,
  request(){if(!state.pending)return false;state.requested=true;return true;},
  update(){if(state.pending&&isCampaign(p))configure(false);},
  restore(data){validateIntroSkip(data);Object.assign(state,structuredClone(data));}
 };
}
export function validateIntroSkip(data){
 if(!data||Object.keys(data).some(k=>!['pending','requested'].includes(k))||typeof data.pending!=='boolean'||typeof data.requested!=='boolean'||(!data.pending&&data.requested))throw new Error('Invalid opening intro state in save.');
 return data;
}
