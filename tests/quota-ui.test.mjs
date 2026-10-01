import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const messages={
 browser_limit:['这个浏览器的 10 次免费体验已用完。','This browser has used its 10 free calls.'],
 ip_limit:['当前网络今日的 30 次免费调用已用完。','This network has used its 30 free calls today.'],
 site_limit:['今日全站的 200 次免费调用已用完。','All 200 free calls for today have been used.']
};
async function page(language,quota){
 const elements=new Map();let requests=0,lastHeaders,reply;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,style:{},classList:{remove(){},add(){}},events:{},addEventListener(event,fn){this.events[event]=fn;},setAttribute(){},focus(){},blur(){}});return elements.get(id);};
 const context=vm.createContext({trackStops:0,localStorage:{getItem:()=>language,setItem(){}},NodeFilter:{SHOW_TEXT:4},Date:{now:()=>100000},document:{documentElement:{},getElementById:element,hidden:false,createTreeWalker:()=>({nextNode:()=>false}),querySelectorAll:()=>[],addEventListener(){},createElement(){return {getContext:()=>({}),toDataURL:()=> 'data:image/jpeg;base64,/9j/test'};}},window:{addEventListener(){}},navigator:{},AbortController,setTimeout,clearTimeout,clearInterval,setInterval,fetch:async(url,options)=>{
  if(url==='/api/status')return {ok:true,json:async()=>({configured:true,trial:{...quota}})};
  requests++;lastHeaders=options.headers;
  return reply||{ok:true,json:async()=>({label_visible:true,duration_ms:1,trial:quota,dry:{status:'forbidden',title:'禁止烘干',detail:'Do not tumble dry',evidence:'Do not tumble dry'},wash:{status:'conditional',title:'按条件水洗',detail:'Cold wash',evidence:'Cold wash'}})};
 }});
 vm.runInContext(readFileSync('public/i18n.js','utf8'),context);
 vm.runInContext(readFileSync('public/app.js','utf8'),context);
 await vm.runInContext('check()',context);
 const run=code=>vm.runInContext(code,context);
 return {element,run,requests:()=>requests,invalidPage(ok=false){reply={ok,json:async()=>{throw new SyntaxError('Unexpected token <');}};},headers:()=>lastHeaders,reject(reason){reply={ok:false,json:async()=>({code:reason,error:messages[reason][0],trial:{remaining:0,reason}})};},prepare(){run('running=true;locked=false;windowStart=0;lastCall=0;capture=()=>({avg:120,edges:20,contrast:40});');}};
}
for(const language of ['zh','en'])for(const reason of Object.keys(messages)){
 test(`${language}: ${reason} shows guidance; personal key bypasses and clearing restores limit`,async()=>{
  const p=await page(language,{remaining:0,reason});const expected=messages[reason][language==='en'?1:0];
  assert.equal(p.element('quotaStatus').textContent,expected);
  p.prepare();p.run('stream={getTracks:()=>[{stop(){trackStops++;}}]};video.srcObject=stream;');await p.run('tick()');assert.equal(p.run('trackStops'),1);assert.equal(p.element('video').srcObject,null);assert.equal(p.requests(),0);assert.equal(p.element('status').textContent,'');assert.equal(p.element('start').disabled,true);
  assert.equal(p.element('start').disabled,true);await p.run('begin()');assert.equal(p.run('running'),false);
  p.element('apiKey').value='test_personal_key_123456789';p.element('apiForm').events.submit({preventDefault(){}});
  assert.equal(p.element('start').disabled,false);assert.equal(p.run('running'),false);
  assert.match(p.element('quotaStatus').textContent,language==='en'?/No trial limits/:/不受体验额度限制/);
  p.prepare();await p.run('tick()');assert.equal(p.requests(),1);assert.equal(p.headers()['x-gemini-api-key'],'test_personal_key_123456789');
  p.element('apiClear').events.click();assert.equal(p.element('quotaStatus').textContent,expected);
  p.prepare();await p.run('tick()');assert.equal(p.requests(),1);
 });
 test(`${language}: ${reason} arriving from server replaces a stale positive allowance`,async()=>{
  const p=await page(language,{remaining:1,reason:null});p.reject(reason);p.prepare();await p.run('tick()');
  const expected=messages[reason][language==='en'?1:0];assert.equal(p.element('quotaStatus').textContent,expected);assert.equal(p.element('status').textContent,'');assert.equal(p.element('start').disabled,true);
  await p.run('tick()');assert.equal(p.requests(),1);
 });
}
test('last allowed scan preserves its result while showing the exhausted trial notice',async()=>{
 const quota={remaining:1,reason:null};const p=await page('zh',quota);p.prepare();quota.remaining=0;quota.reason='browser_limit';await p.run('tick()');
 assert.equal(p.element('quotaStatus').textContent,messages.browser_limit[0]);assert.equal(p.element('dryAnswer').textContent,'禁止烘干');assert.equal(p.element('rescan').textContent,'扫下一件');assert.equal(p.element('rescan').disabled,true);assert.equal(p.element('start').disabled,true);assert.equal(p.run('running'),false);
});

for(const language of ['zh','en'])test(`${language}: tunnel HTML error is not misreported as a phone network failure`,async()=>{
 const quota={remaining:2,reason:null};const p=await page(language,quota);p.invalidPage();p.prepare();quota.remaining=1;await p.run('tick()');
 assert.equal(p.element('status').textContent,language==='en'?'The temporary connection service returned an error page. Please try again later.':'临时连接服务返回了错误页面，请稍后重试。');
 assert.equal(p.element('quotaStatus').textContent,language==='en'?'Free calls available: 1':'当前可免费调用：1 次');
});
test('HTML error on the last call refreshes quota and releases the camera',async()=>{
 const quota={remaining:1,reason:null};const p=await page('zh',quota);p.invalidPage();p.prepare();p.run('stream={getTracks:()=>[{stop(){trackStops++;}}]};video.srcObject=stream;');quota.remaining=0;quota.reason='browser_limit';await p.run('tick()');
 assert.equal(p.run('trackStops'),1);assert.equal(p.element('start').disabled,true);assert.equal(p.element('quotaStatus').textContent,messages.browser_limit[0]);
});

test('pasted key normalization accepts whitespace, quotes and env assignment without exposing key',async()=>{
 const p=await page('zh',{remaining:0,reason:'browser_limit'});
 for(const raw of ['  test_personal_key_123456789  ','GEMINI_API_KEY="test_personal_key_123456789"','test_personal_\u200Bkey_123456789','test_personal_key_\n123456789']){
  p.element('apiKey').value=raw;p.element('apiForm').events.submit({preventDefault(){}});
  assert.equal(p.run('personalKey'),'test_personal_key_123456789');assert.equal(p.element('apiKey').value,'');assert.equal(p.element('start').disabled,false);assert.ok(!p.element('apiMessage').textContent.includes('test_personal_key'));
  p.element('apiClear').events.click();
 }
 for(const [raw,pattern] of [['',/请先粘贴/],['••••••••••••••••••••••••',/隐藏后的内容/],['https://example.com/api-key',/不支持的字符/],['short',/长度不正确/]]){
  p.element('apiKey').value=raw;p.element('apiForm').events.submit({preventDefault(){}});assert.equal(p.run('personalKey'),'');assert.equal(p.element('start').disabled,true);assert.match(p.element('apiMessage').textContent,pattern);
 }
});

test('keys containing a period are accepted locally and forwarded intact',async()=>{
 const p=await page('zh',{remaining:0,reason:'browser_limit'});
 p.element('apiKey').value='AQ.synthetic_test_key_123456789';p.element('apiForm').events.submit({preventDefault(){}});
 assert.equal(p.run('personalKey'),'AQ.synthetic_test_key_123456789');assert.equal(p.element('start').disabled,false);
 p.prepare();await p.run('tick()');assert.equal(p.headers()['x-gemini-api-key'],'AQ.synthetic_test_key_123456789');
});
