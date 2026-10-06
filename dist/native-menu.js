// Render through the emulator using font tiles and the cursor loaded by the ROM.
// No game artwork or glyph bitmaps are included in this module.
export const MENU_OPTIONS = [
 {label:'1P - SOLO',mode:'solo'},
 {label:'2-5P - CAMPAIGN',mode:'campaign'},
 {label:'2-5P - BATTLE (ONLINE)',mode:'online'},
 {label:'2-5P - BATTLE (A.I)',mode:'battle-ai'},
 {label:'LOAD SAVE',mode:'load'}
];
export const TITLE_SEQUENCE = [{frames:180},{frames:8,button:'RUN'},{frames:120}];
const FIRST_Y=138,ROW_HEIGHT=16;
// Copyright glyphs are already embedded in the title's background tiles.
function copyrightInk(v,x,y){
 const left=((v.HDS+v.HSW)<<3)+v.DrawBGIndex,worldX=x-left+v.VDCRegister[7];
 if(worldX<0||worldX>=v.ScreenWidth+v.VDCRegister[7]||y<216||y>=224)return false;
 function pixel(px,py){
  const tile=v.VRAM[((py>>3)&(v.VScreenHeight-1))*v.VScreenWidth+((px>>3)&(v.VScreenWidth-1))],address=((tile&4095)<<4)+(py&7),bit=7-(px&7),a=v.VRAM[address],b=v.VRAM[address+8];
  const dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
  return dot?((tile&0xf000)>>8)|dot:0;
 }
 const color=pixel(worldX,y);
 return color===0x4f||(color===0x49&&[0,1].some(dy=>[0,1,2].some(dx=>y-dy>=216&&pixel(worldX-dx,y-dy)===0x4f)));
}
export function installNativeMenu(p,{onSelect=()=>{},onChange=()=>{},blockPads=()=>false}={}) {
 let active=false,rendering=false,departing=false,selected=0,count=2,hasSave=false,padHeld='',padFrames=0;
 const bg=p.MakeBGLine,sprites=p.MakeSpriteLine,pads=p.CheckGamePad;
 function announce(){onChange({selected,count,label:MENU_OPTIONS[selected].label,mode:MENU_OPTIONS[selected].mode,hasSave});}
 function choose(){if(active)onSelect(MENU_OPTIONS[selected].mode,count);}
 function input(button){
  if(!active)return false;
  if(button==='UP'||button==='DOWN'){selected=(selected+(button==='UP'?4:1))%5;announce();}
  else if(button==='LEFT'||button==='RIGHT'){count=Math.min(5,Math.max(2,count+(button==='LEFT'?-1:1)));announce();}
  else if(button==='RUN'||button==='SHOT1')choose();
  return true;
 }
 p.MakeSpriteLine=function(n){
  if(n===0&&departing&&this.VDC[0].SATB[2]!==918){rendering=false;departing=false;}
  if(!rendering||n!==0||this.VDC[0].SATB[2]!==918)return sprites.call(this,n);
  const satb=this.VDC[0].SATB,saved=satb.slice(0,48);
  // Entries 1–11 draw the old menu and C-Link devices. Keep the title artwork.
  for(let i=1;i<12;i++)satb[i*4]=0;
  satb[0]=FIRST_Y+45+selected*ROW_HEIGHT;satb[1]=48;
  try{return sprites.call(this,n);}finally{for(let i=0;i<48;i++)satb[i]=saved[i];}
 };
 p.MakeBGLine=function(n){
  bg.call(this,n);
  const v=this.VDC[n],y=v.DrawBGYLine;
  if(!rendering||n!==0||v.SATB[2]!==918)return;
  if(y>=226&&y<242){
   const original=v.BGLine.slice(),sourceY=v.DrawBGLine,removing=y<234;
   try{v.DrawBGLine=sourceY+(removing?8:-8);bg.call(this,n);
    const left=((v.HDS+v.HSW)<<3)+v.DrawBGIndex;
    for(let x=0;x<v.BGLine.length;x++)if(removing?(x<left+16||x>=left+240):!copyrightInk(v,x,sourceY-8))v.BGLine[x]=original[x];
   }finally{v.DrawBGLine=sourceY;}
   return;
  }
  const row=Math.floor((y-FIRST_Y)/ROW_HEIGHT),glyphLine=(y-FIRST_Y)%ROW_HEIGHT;
  let text,palette=0xc000;
  if(row>=0&&row<5&&glyphLine>=0&&glyphLine<8){text=MENU_OPTIONS[row].label;if(row===2||(row===4&&!hasSave))palette=0;}
  else if(y>=218&&y<226){text=`PLAYERS: ${count}  LEFT/RIGHT`;palette=0;}
  else return;
  const originalLine=v.BGLine.slice(),originalY=v.DrawBGLine;
  const start=(originalY>>3)*v.VScreenWidth,tiles=v.VRAM.slice(start,start+32);
  try{
   for(let x=0;x<32;x++)v.VRAM[start+x]=0x220;
   for(let x=0;x<text.length;x++)v.VRAM[start+4+x]=palette+0x200+text.charCodeAt(x);
   v.DrawBGLine=(originalY&~7)|((y-(row<5?FIRST_Y+row*ROW_HEIGHT:218))&7);
   bg.call(this,n);
   // Native font's ink is index 1; its transparent pixels retain the landscape.
   const ink=(palette>>8)|1;
   for(let x=0;x<v.BGLine.length;x++)if(v.BGLine[x]!==ink)v.BGLine[x]=originalLine[x];
  }finally{v.DrawBGLine=originalY;for(let x=0;x<32;x++)v.VRAM[start+x]=tiles[x];}
 };
 p.CheckGamePad=function(){
  pads.call(this);
  if(active){
   const a=this.GamePad[0],button=!(a[0]&8)?'RUN':!(a[0]&1)?'SHOT1':!(a[1]&1)?'UP':!(a[1]&4)?'DOWN':!(a[1]&8)?'LEFT':!(a[1]&2)?'RIGHT':'';
   if(button!==padHeld){padHeld=button;padFrames=0;if(button)input(button);}
   else if(button&&++padFrames>=24&&padFrames%6===0&&!['RUN','SHOT1'].includes(button))input(button);
  }else{padHeld='';padFrames=0;}
  if(active||blockPads())for(const pad of this.GamePad){pad[0]=pad[1]=pad[2]=0xbf;pad[3]=0xb0;}
 };
 return {
  prepare(players=2){count=Math.min(5,Math.max(2,players));selected=0;active=false;rendering=true;departing=false;padHeld='';padFrames=0;},
  open(players=2){count=Math.min(5,Math.max(2,players));selected=0;active=true;rendering=true;departing=false;padHeld='';padFrames=0;announce();},
  leave(){active=false;departing=true;},
  close(){active=false;rendering=false;departing=false;},input,choose,
  setCount(players){count=Math.min(5,Math.max(2,players));if(active)announce();},
  setSave(available){hasSave=Boolean(available);if(active)announce();},
  pointer(y){if(!active||y<FIRST_Y||y>=FIRST_Y+5*ROW_HEIGHT)return;selected=Math.floor((y-FIRST_Y)/ROW_HEIGHT);announce();choose();},
  get active(){return active;},get selected(){return selected;},get count(){return count;}
 };
}
