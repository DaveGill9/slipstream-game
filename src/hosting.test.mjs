import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../scripts/serve.mjs';
test('PC hosting serves the build and rejects access outside it', async () => {
  const temp=await mkdtemp(join(tmpdir(),'slipstream-server-'));
  const root=join(temp,'dist'); await mkdir(root); await mkdir(join(root,'assets'));
  await writeFile(join(root,'index.html'),'<title>Slipstream</title>');
  await writeFile(join(root,'assets','game.js'),'console.log("game")');
  await writeFile(join(temp,'private.txt'),'private');
  const server=makeServer(root);
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const base=`http://127.0.0.1:${server.address().port}`;
    const home=await fetch(base); assert.equal(home.status,200); assert.match(await home.text(),/Slipstream/);
    const asset=await fetch(base+'/assets/game.js'); assert.match(asset.headers.get('content-type'),/javascript/); assert.match(asset.headers.get('cache-control'),/immutable/);
    assert.equal((await fetch(base,{method:'HEAD'})).status,200);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/missing')).status,404);
    assert.equal((await fetch(base+'/%2e%2e%2fprivate.txt')).status,403);
    assert.equal((await fetch(base+'/%zz')).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); await rm(temp,{recursive:true,force:true}); }
});
