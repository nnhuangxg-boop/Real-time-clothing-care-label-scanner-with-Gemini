import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle,adminAuthorized} from '../api/index.mjs';
test('all admin routes require strong configured credentials before accessing database',async()=>{
 for(const path of ['/admin','/admin.js','/admin/usage']){
  const response=await handle(new Request('https://test.example'+path),{});
  assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const password='synthetic-admin-password-1234567890';
 const request=new Request('https://test.example/admin',{headers:{authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}});
 assert.equal(adminAuthorized(request,password),true);
 assert.equal(adminAuthorized(request,''),false);
 assert.equal(adminAuthorized(request,password+'x'),false);
});
test('cloud status awaits database and returns signed cookie without secrets',async()=>{
 const db={identity:async()=>({browser:'test',cookie:'care_browser=test; HttpOnly; Secure'}),usage:async()=>({remaining:7})};
 const r=await handle(new Request('https://test.example/api/status'),{GEMINI_API_KEY:'secret-server-key'},db);
 assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.deepEqual(await r.json(),{configured:true,trial:{remaining:7}});
});
test('database outage fails closed and cannot disclose connection credentials',async()=>{
 const db={identity:async()=>{throw new Error('postgres://private-password@host');}};
 const r=await handle(new Request('https://test.example/api/status'),{},db);
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private-password/);
});
