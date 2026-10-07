import {isCampaign,stageID,installCampaignTracker} from './campaign.js';
import {validateWorldStart} from './world-start.js';

const idle=()=>({pending:false,phase:null,target:null,objectiveEnabled:false,human:null});
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
export function validateAdminLevels(s){
 if(!s||Object.keys(s).some(k=>!['pending','phase','target','objectiveEnabled','human'].includes(k))||typeof s.pending!=='boolean'||typeof s.objectiveEnabled!=='boolean')throw new Error('Invalid admin level jump in save.');
 if(!s.pending){if(s.phase!==null||s.target!==null||s.human!==null||s.objectiveEnabled)throw new Error('Invalid idle admin level jump in save.');return s;}
 if(!['dying','loading'].includes(s.phase)||!s.target||!s.human)throw new Error('Incomplete admin level jump in save.');
 const t=s.target;
 if(t.kind==='original'){
  if(Object.keys(t).some(k=>!['kind','world','area'].includes(k)))throw new Error('Invalid admin campaign level in save.');
  validateWorldStart({pending:true,world:t.world,area:t.area,loading:false});
 }else if(t.kind==='dlc'){
  if(Object.keys(t).some(k=>!['kind','round'].includes(k))||!integer(t.round,1000000)||t.round<1)throw new Error('Invalid admin DLC round in save.');
 }else throw new Error('Unknown admin level family in save.');
 const h=s.human;
 if(Object.keys(h).some(k=>!['lives','bombs','fire','speed','flags','shield'].includes(k))||!['lives','bombs','fire','speed','flags'].every(k=>integer(h[k],255))||h.flags&15||!integer(h.shield,65535))throw new Error('Invalid admin player upgrades in save.');
 return s;
}

// Queue the native retry loader, retaining its fade/music/card without CPU
// redirection. Clearing the final arena commits the native ending, so use
// the retry loader for travel between every level. Restore lives and powers.
// All pending data is serializable, including a save made before Resume.
export function createAdminLevels(p,{worldStart,newCampaign,levelObjective,onArrive=()=>{}}={}){
 if(!worldStart||!newCampaign||!levelObjective)throw new Error('Admin level controls require the campaign controllers.');
 const state=idle(),tracker=installCampaignTracker(p),cpu=p.CPURun;
 const human=()=>({lives:p.RAM[0x438],bombs:p.RAM[0x84c],fire:p.RAM[0x84d],speed:p.RAM[0x84e],flags:p.RAM[0x43a]&240,shield:p.RAM[0x446]|p.RAM[0x447]<<8});
 function jump(target){
  const planned={pending:true,phase:'dying',target,objectiveEnabled:levelObjective.state.enabled,human:human()};validateAdminLevels(planned);
  if(state.pending||!isCampaign(p)||(p.RAM[0x43a]&7)||p.RAM[0x437]||newCampaign.state.transition||p._spectator?.transition)throw new Error('Choose a level during an active campaign stage.');
  if((target.kind==='dlc')!==newCampaign.state.enabled)throw new Error('Choose a level from the current campaign family.');
  Object.assign(state,structuredClone(planned));
  // The host intentionally bypasses living-monster and required-item checks.
  // Disable only their clear gates until the ROM reaches the selected loader.
  levelObjective.configure(false);newCampaign.state.enabled=false;
  // Keep the watch/online mode enabled and serializable. Owning its temporary
  // death transition suppresses the ordinary team-defeat callback/roster reset.
  if(p._spectator?.enabled)p._spectator.transition={phase:'dying',stage:stageID(p)};
  p.RAM[0x438]=Math.max(1,p.RAM[0x438]);p.RAM[0x43a]|=1;p.RAM[0x43c]=0;
  return {notice:target.kind==='original'?`Loading campaign ${target.world+1}-${target.area+1}…`:`Loading DLC round ${target.round}…`};
 }
 p.CPURun=function(){
  const bank=this.MPR[this.PC>>13]>>13;
  if(state.pending&&state.phase==='dying'&&bank===8&&this.PC===0x7cae){
   state.phase='loading';
   // Clear before the inner spectator CPU hook sees its loading/play return;
   // normal onRetry deliberately replaces the team and must not run for travel.
   if(this._spectator?.enabled)this._spectator.transition=null;
   worldStart.configure(state.target.kind==='original'?state.target.world:0,state.target.kind==='original'?state.target.area:0);
   if(state.target.kind==='dlc')Object.assign(newCampaign.state,{enabled:true,round:state.target.round,ready:false,pending:false,transition:null});
  }
  // The final boss's special initializer can retain the previous clear bit.
  // Fresh native startup reaches this same fully loaded play entry with bit 2
  // clear; scope the correction to admin travel so natural encounters stay native.
  if(state.pending&&state.phase==='loading'&&state.target.kind==='original'&&state.target.world===7&&state.target.area===7&&bank===9&&this.PC===0x83b0&&worldStart.state.loading&&this.RAM[0x84a]===7&&this.RAM[0x84b]===7&&!(this.RAM[0x43a]&5))this.RAM[0x43a]&=~2;
  const arrived=state.pending&&state.phase==='loading'&&bank===9&&this.PC===0x83b0&&!(this.RAM[0x43a]&7);
  const result=cpu.call(this);
  if(arrived){
   const h=state.human,goal=state.objectiveEnabled,target=structuredClone(state.target);
   this.RAM[0x438]=h.lives;this.RAM[0x84c]=h.bombs;this.RAM[0x84d]=h.fire;this.RAM[0x84e]=h.speed;
   this.RAM[0x43a]=(this.RAM[0x43a]&15)|h.flags;this.RAM[0x446]=h.shield&255;this.RAM[0x447]=h.shield>>8;
   // Reset even when revisiting the same stage/round; stale actor coordinates
   // and required-item state cannot carry into its freshly generated terrain.
   levelObjective.configure(goal);tracker.last=tracker.frame;Object.assign(state,idle());onArrive(target);
  }
  return result;
 };
 return {state,jumpOriginal(world,area=0){return jump({kind:'original',world,area});},jumpDLC(round){return jump({kind:'dlc',round});},reset(){Object.assign(state,idle());},restore(saved){validateAdminLevels(saved);Object.assign(state,structuredClone(saved));}};
}
