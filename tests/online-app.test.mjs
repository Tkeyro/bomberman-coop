import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Two isolated JavaScript/DOM realms run the unchanged app against a real
// SQLite lobby and a mocked ordered RTC transport. This is not browser QA.
async function probe(scenario=''){
 const fixture=fileURLToPath(new URL('./fixtures/online-app-probe.mjs',import.meta.url));
 const child=spawn(process.execPath,['--experimental-vm-modules',fixture],{env:{...process.env,BOMBERMAN_ONLINE_APP_SCENARIO:scenario},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
 const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(status,0,stdout+'\n'+stderr);return JSON.parse(stdout.trim());
}
test('two complete apps create a lobby, synchronize controls, share upgrades and restart a saved level',{skip:!process.env.BOMBERMAN_TEST_ROM,timeout:180000},async()=>{
 const result=await probe();
 assert.equal(result.players,2);assert.equal(result.sharedUpgrades,true);assert.equal(result.cameraViews,true);assert.equal(result.restartLevel,'4-4');assert.equal(result.remoteReleased,true);assert.equal(result.battleControllers,true);assert.ok(result.frames>=120);
});
test('online startup keeps running when browser audio suspension never settles',{skip:!process.env.BOMBERMAN_TEST_ROM,timeout:90000},async()=>{
 const result=await probe('audio-hang');assert.equal(result.scenario,'audio-hang');assert.equal(result.unsettledAudio,true);assert.ok(result.frames>=120);
});
test('guest pause preserves authoritative frames arriving before the host receives its request',{skip:!process.env.BOMBERMAN_TEST_ROM,timeout:90000},async()=>{
 const result=await probe('pause-delay');assert.equal(result.scenario,'pause-delay');assert.ok(result.delayedFrames>=3);assert.ok(result.frames>=120);
});
test('online startup timeout reports a missing snapshot acknowledgement and blocks premature Resume',{skip:!process.env.BOMBERMAN_TEST_ROM,timeout:90000},async()=>{
 const result=await probe('ack-timeout');assert.equal(result.scenario,'ack-timeout');assert.equal(result.startupTimeout,true);assert.equal(result.blockedResume,true);assert.equal(result.droppedLoaded,1);
});
