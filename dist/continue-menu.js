import {decodeSpriteIcon} from './enemy-icons.js';

// This page uses the font and title cursor already loaded by the user's ROM.
// Draw only to the paused frame buffer; game memory and palettes stay intact.
const CHOICES=['continue','quit'],LABELS=['CONTINUE','QUIT'];
const FIRST_Y=134,ROW_HEIGHT=22;
export function createContinueMenu(p,{onSelect=()=>{}}={}){
 const pads=p.CheckGamePad;
 let active=false,worldIndex=0,hostInteractive=true,selected=0,waiting=false,original=null,cursor=null,padHeld='',padFrames=0,padArmed=false;
 function snapshot(){return {worldIndex,hostInteractive,selected,choice:CHOICES[selected],waiting};}
 function render(){
  if(!active)return false;
  const image=p.ImageData,data=image.data,stride=p.ScreenWidthMAX??image.width??684,width=p.MainCanvas?.width??p.VDC[0].ScreenSize??320,height=p.ScreenHeightMAX??image.height??262,vram=p.VDC[0].VRAM;
  const pixel=(x,y,color)=>{if(x<0||x>=width||y<0||y>=height)return;const i=(y*stride+x)*4;data[i]=color.r;data[i+1]=color.g;data[i+2]=color.b;data[i+3]=255;};
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=0;data[i+3]=255;}
  function text(label,y,{x=Math.floor((width-label.length*8)/2),palette=0xc0}={}){
   for(let i=0;i<label.length;i++)for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
    const address=((0x200+label.charCodeAt(i))<<4)+dy,bit=7-dx,a=vram[address],b=vram[address+8];
    const dot=((a>>bit)&1)|(((a>>(bit+8))&1)<<1)|(((b>>bit)&1)<<2)|(((b>>(bit+8))&1)<<3);
    if(dot)pixel(x+i*8+dx,y+dy,p.PaletteData[palette+dot]);
   }
  }
  text('GAME OVER',82);text(`RESTART WORLD ${worldIndex+1}-0`,108);
  const left=Math.floor((width-LABELS[0].length*8)/2);
  for(let i=0;i<LABELS.length;i++)text(LABELS[i],FIRST_Y+i*ROW_HEIGHT,{x:left});
  if(cursor){
   for(let y=0;y<cursor.height;y++)for(let x=0;x<cursor.width;x++){const i=(y*cursor.width+x)*4;if(cursor.pixels[i+3])pixel(left-24+x,FIRST_Y-4+selected*ROW_HEIGHT+y,{r:cursor.pixels[i],g:cursor.pixels[i+1],b:cursor.pixels[i+2]});}
  }else text('>',FIRST_Y+selected*ROW_HEIGHT,{x:left-16});
  text(waiting?'WAITING FOR PLAYERS':hostInteractive?'UP/DOWN  ENTER':'WAITING FOR HOST',208,{palette:0});
  p.Ctx.putImageData(image,0,0);return true;
 }
 function input(button){
  if(!active)return false;
  if(!hostInteractive||waiting)return true;
  if(button==='UP'||button==='DOWN'){selected=1-selected;render();}
  else if(button==='RUN'||button==='SHOT1'){waiting=true;render();onSelect(CHOICES[selected]);}
  return true;
 }
 function poll(){
  if(!active)return false;
  pads.call(p);
  const a=p.GamePad[0],button=!(a[0]&8)?'RUN':!(a[0]&1)?'SHOT1':!(a[1]&1)?'UP':!(a[1]&4)?'DOWN':'';
  // A Start button held during the defeat must be released before confirming.
  if(!padArmed){if(!button)padArmed=true;padHeld=button;padFrames=0;}
  else if(button!==padHeld){padHeld=button;padFrames=0;if(button)input(button);}
  else if(button&&++padFrames>=24&&padFrames%6===0&&!['RUN','SHOT1'].includes(button))input(button);
  for(const pad of p.GamePad){pad[0]=pad[1]=pad[2]=0xbf;pad[3]=0xb0;}
  return true;
 }
 function close(){
  if(active&&original){p.ImageData.data.set(original);p.Ctx.putImageData(p.ImageData,0,0);}
  active=false;waiting=false;original=null;cursor=null;padHeld='';padFrames=0;padArmed=false;
 }
 return {
  open({worldIndex:world=0,hostInteractive:interactive=true}={}){
   if(!Number.isInteger(world)||world<0||world>7)throw new Error('Unknown campaign world.');
   if(!active)original=Uint8ClampedArray.from(p.ImageData.data);
   worldIndex=world;hostInteractive=Boolean(interactive);selected=0;waiting=false;active=true;padHeld='';padFrames=0;padArmed=false;
   try{cursor=decodeSpriteIcon(p,[{x:0,y:0,pattern:918,attribute:p.VDC[0].SATB[3]}]);}catch{cursor=null;}
   render();return snapshot();
  },
  input,poll,render,close,reset:close,
  get active(){return active;},get state(){return snapshot();}
 };
}
