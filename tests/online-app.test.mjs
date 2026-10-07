import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Two isolated JavaScript/DOM realms run the unchanged app against a real
// SQLite lobby and a mocked ordered RTC transport. This is not browser QA.
test('two complete apps create a lobby, synchronize controls, share upgrades and restart a saved level',{skip:!process.env.BOMBERMAN_TEST_ROM,timeout:180000},async()=>{
 const fixture=fileURLToPath(new URL('./fixtures/online-app-probe.mjs',import.meta.url));
 const child=spawn(process.execPath,['--experimental-vm-modules',fixture],{env:process.env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
 const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(status,0,stdout+'\n'+stderr);const result=JSON.parse(stdout.trim());
 assert.equal(result.players,2);assert.equal(result.sharedUpgrades,true);assert.equal(result.cameraViews,true);assert.equal(result.restartLevel,'4-4');assert.equal(result.remoteReleased,true);assert.equal(result.battleControllers,true);assert.ok(result.frames>=120);
});
