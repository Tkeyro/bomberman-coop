import { PCE } from './vendor/pce.js';
import { verifyROM, installColorSelector, KEY_BINDINGS, traceWrites } from './session.js';
const $ = id => document.getElementById(id), canvas = $('game-canvas');
let machine, rom, colors, running = false, muted = false, frame = 0;
let lastTime = 0, accumulator = 0, pendingTrace, loadGeneration = 0;
const held = new Set(), FRAME_MS = 1000 / 59.8261;
function message(text) { $('load-status').textContent = text; }
function releaseKeys() {
  if (machine) for (const [port,button] of Object.values(KEY_BINDINGS)) machine['UnsetButton' + button](port);
  held.clear();
}
function download(data,name,type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data],{type})), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function finishTrace() {
  if (!pendingTrace) return;
  const result = pendingTrace.hook.finish();
  download(JSON.stringify({rom:'Bomberman (USA)',startFrame:pendingTrace.start,endFrame:frame,...result},null,2),'campaign-trace.json','application/json');
  $('debug-output').textContent = `Captured ${result.records.length} player-region writes (${result.dropped} dropped). Each write includes its PC and MPR bank.`;
  pendingTrace = undefined; $('trace-btn').disabled = false;
}
async function pause() {
  running = false; accumulator = 0; releaseKeys();
  $('pause-btn').textContent = 'Resume';
  if (machine?.WebAudioCtx) await machine.WebAudioCtx.suspend();
}
async function resume() {
  if (!machine) return;
  try { await machine.WebAudioCtx?.resume(); } catch { message('Audio is unavailable. The game can still run.'); }
  running = true; lastTime = performance.now(); accumulator = 0;
  $('pause-btn').textContent = 'Pause'; $('start-btn').disabled = true;
  canvas.focus({preventScroll:true});
}
function initialize(bytes) {
  if (!machine) {
    machine = new PCE(); machine.CountryType = machine.CountryTypeTG16; machine.MultiTap = true;
    if (!machine.SetCanvas('game-canvas')) throw new Error('Your browser could not create the game screen.');
    colors = installColorSelector(machine);
  }
  machine.SetROM(Array.from(bytes)); machine.WaveVolume = muted ? 0 : .6;
  colors.select($('color-select').value); frame = 0; $('frame-count').textContent = '0';
  $('start-btn').disabled = false; $('pause-btn').textContent = 'Resume';
  for (const id of ['pause-btn','reset-btn','mute-btn','fullscreen-btn','color-select','dump-btn','trace-btn']) $(id).disabled = false;
  $('debug-output').textContent = 'Verified USA ROM loaded. Trace watches RAM offsets 0x430–0x47f. Downloads stay on your computer.';
}
$('rom-input').addEventListener('change',async event => {
  const file = event.target.files[0]; if (!file) return;
  const generation = ++loadGeneration;
  await pause(); finishTrace(); message('Checking game revision…');
  try {
    if (file.size !== 262144) throw new Error('Choose the 256 KiB Bomberman (USA) .pce file.');
    const bytes = new Uint8Array(await file.arrayBuffer()); await verifyROM(bytes);
    if (generation !== loadGeneration) return;
    initialize(bytes); rom = bytes;
    message('Bomberman (USA) verified. Click Start game, then Enter at the title screen.');
  } catch (error) {
    if (generation === loadGeneration) message(error.message + (rom ? ' Your previous game is paused.' : ''));
  }
});
$('start-btn').addEventListener('click',resume);
$('pause-btn').addEventListener('click',() => running ? pause() : resume());
$('reset-btn').addEventListener('click',async () => {
  await pause(); finishTrace(); initialize(rom); message('Game reset. Click Start game to return to the original title.');
});
$('color-select').addEventListener('change',event => colors.select(event.target.value));
$('color-notice').textContent = 'Choose before playing. Suit recoloring is verified in stage 1; other stages are still being tested.';
$('mute-btn').addEventListener('click',() => {
  muted = !muted; machine.WaveVolume = muted ? 0 : .6;
  if (machine.WebAudioGainNode) machine.WebAudioGainNode.gain.value = machine.WaveVolume;
  $('mute-btn').textContent = muted ? 'Unmute' : 'Mute'; $('mute-btn').setAttribute('aria-pressed',String(muted));
});
$('fullscreen-btn').addEventListener('click',async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await canvas.requestFullscreen(); }
  catch { message('Fullscreen is unavailable in this browser.'); }
});
window.addEventListener('keydown',event => {
  const binding = KEY_BINDINGS[event.code];
  if (!running || !binding || document.activeElement !== canvas) return;
  event.preventDefault(); held.add(event.code); machine['SetButton' + binding[1]](binding[0]);
});
window.addEventListener('keyup',event => {
  if (!held.delete(event.code)) return;
  const [port,button] = KEY_BINDINGS[event.code];
  if (![...held].some(code => KEY_BINDINGS[code][0] === port && KEY_BINDINGS[code][1] === button)) machine['UnsetButton' + button](port);
});
canvas.addEventListener('blur',releaseKeys);
window.addEventListener('blur',() => { if (running) pause(); });
document.addEventListener('visibilitychange',() => { if (document.hidden && running) pause(); });
function tick(now) {
  if (running) {
    accumulator += Math.min(now - lastTime,FRAME_MS * 3);
    try {
      let steps = 0;
      while (accumulator >= FRAME_MS && steps++ < 3) {
        colors.refresh(); machine.Run(); frame++; accumulator -= FRAME_MS;
        if (pendingTrace && frame >= pendingTrace.start + 120) finishTrace();
      }
      $('frame-count').textContent = String(frame);
    } catch (error) { pause(); message('Emulation stopped: ' + error.message); }
  }
  lastTime = now; requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('debug-toggle').addEventListener('click',() => {
  const panel = $('debug-panel'); panel.hidden = !panel.hidden;
  $('debug-toggle').setAttribute('aria-expanded',String(!panel.hidden));
});
$('dump-btn').addEventListener('click',() => download(Uint8Array.from(machine.RAM.slice(0,8192)),'campaign-ram.bin'));
$('trace-btn').addEventListener('click',() => {
  pendingTrace = {hook:traceWrites(machine),start:frame}; $('trace-btn').disabled = true;
  $('debug-output').textContent = 'Recording the next 120 emulated frames. Resume the game and move or place a bomb.';
});
