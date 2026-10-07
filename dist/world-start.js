import {installCampaignTracker} from './campaign.js';

export function validateWorldStart(state){
 const index=n=>Number.isInteger(n)&&n>=0&&n<8;
 if(!state||Object.keys(state).some(k=>!['pending','world','area','loading'].includes(k))||typeof state.pending!=='boolean'||!index(state.world)||!index(state.area)||(state.loading!==undefined&&(typeof state.loading!=='boolean'||state.loading&&!state.pending)))throw new Error('Invalid campaign starting stage in save.');
 return state;
}

// Configure the next native load; the caller launches or retries the campaign.
// A UI selection such as 1-0 means world index0, first regular area index0.
export function createWorldStart(p){
 installCampaignTracker(p);
 const state={pending:false,world:0,area:0,loading:false},cpu=p.CPURun,get=p.Get;
 p.CPURun=function(){
  const bank=this.MPR[this.PC>>13]>>13;
  if(state.pending&&!state.loading&&bank===8&&[0x7c29,0x7ca2,0x7cae].includes(this.PC)){
   this.RAM[0x84a]=state.world;this.RAM[0x84b]=state.area;this.RAM[0x143f]=1;state.loading=true;
  }
  if(state.loading&&bank===9&&this.PC===0x83b0&&!(this.RAM[0x43a]&7)&&this.RAM[0x84a]===state.world&&this.RAM[0x84b]===state.area){state.pending=false;state.loading=false;}
  return cpu.call(this);
 };
 p.Get=function(address){
  const value=get.call(this,address);
  // Native world graphics load only on area zero. A checkpoint in another
  // area still needs its world's assets; override just this gate's area read.
  if(state.loading&&address===0x284b&&this.PC===0xb114&&this.MPR[5]===8192)return 0;
  return value;
 };
 return {state,configure(world,area=0){validateWorldStart({pending:true,world,area,loading:false});Object.assign(state,{pending:true,world,area,loading:false});},restore(saved){validateWorldStart(saved);Object.assign(state,{loading:false},structuredClone(saved));}};
}
