const $=id=>document.getElementById(id);
const video=$('video'), start=$('start'), status=$('status');
let running=false, starting=false, stream=null, timer=null, controller=null, busy=false, epoch=0;
let previous=null, anchor=null, stable=0, lastCall=0, attempts=0, locked=false, pending=null;
let best=null, windowStart=0, zoom=1;
let personalKey="", serverConfigured=false, trial=null;
const canvas=document.createElement('canvas'), small=document.createElement('canvas');small.width=96;small.height=64;
const ctx=canvas.getContext('2d'), smallCtx=small.getContext('2d',{willReadFrequently:true});
function clearResults(message=t('等待标签进入画面')){
  for(const k of ['dry','wash']){$(k+'Answer').textContent=t('尚未识别');$(k+'Detail').textContent=k==='dry'?t('看清标签后，告诉你能否放进烘干机。'):t('温度、机洗或手洗，分别判断。');$(k+'Card').className='result';}
  $('evidence').hidden=true;$('resultState').textContent=message;
}
function resetScan(){epoch++;controller?.abort();previous=null;anchor=null;stable=0;attempts=0;locked=false;pending=null;best=null;windowStart=Date.now();$('framePreview').hidden=true;$('rescan').textContent=t('重新扫描');clearResults();if(running)status.textContent=t('标签居中，拿远到文字清晰；会自动挑选画面。');}
function stop(){running=false;starting=false;clearInterval(timer);timer=null;resetScan();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;$('camera').classList.remove('active');$('placeholder').hidden=false;$('rescan').disabled=true;start.textContent=t('开启摄像头');status.textContent=t('扫描已暂停，摄像头已关闭。');$('cameraCaption').textContent=t('开启后自动扫描，无需按快门');}
function quotaEmpty(){return !personalKey&&trial?.remaining===0;}
function enforceCameraQuota(){
 if(!quotaEmpty())return false;
 running=false;starting=false;locked=true;epoch++;controller?.abort();
 clearInterval(timer);timer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
 $('camera').classList.remove('active');$('placeholder').hidden=false;
 $('cameraCaption').textContent=t('摄像头已关闭');
 start.textContent=t('先填写 API Key');start.disabled=true;$('rescan').disabled=true;
 status.textContent='';renderQuota();return true;
}
async function begin(deviceId){
  if(enforceCameraQuota()||running||starting)return;
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){status.textContent=t('请用 iPhone Safari 打开 HTTPS 测试链接，当前页面无法访问摄像头。');return;}
  starting=true;const token=++epoch;start.disabled=true;status.textContent=t('请允许摄像头访问。');
  await refreshQuota();if(enforceCameraQuota())return;if(token!==epoch){starting=false;start.disabled=quotaEmpty();return;}
  try{
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}),width:{ideal:3840},height:{ideal:2160}}});
    if(token!==epoch||document.hidden){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;video.srcObject=stream;await video.play();
    if(token!==epoch){media.getTracks().forEach(t=>t.stop());return;}
    running=true;resetScan();$('camera').classList.add('active');$('placeholder').hidden=true;start.textContent=t('暂停扫描');$('rescan').disabled=false;$('cameraCaption').textContent=t('完整标签入框 · 保持片刻');
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(running)stop();});
    const track=stream.getVideoTracks()[0];
    try{if(track.getCapabilities?.().focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}
    if(!running)return;
    try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&!/front|user|前置|前面/i.test(d.label));const select=$('lens');select.replaceChildren();for(const [i,d] of devices.entries()){const option=document.createElement('option');option.value=d.deviceId;option.textContent=d.label||(t('镜头 ')+(i+1));select.append(option);}select.value=track.getSettings().deviceId;$('lensControl').hidden=devices.length<2;}catch{}
    timer=setInterval(tick,250);
  }catch(e){stop();status.textContent=e.name==='NotAllowedError'?t('未获得摄像头权限。请在 Safari 网站设置中允许摄像头，再点开启。'):e.name==='NotFoundError'?t('没有找到可用摄像头，请在 iPhone 上打开。'):t('无法开启摄像头，请关闭其他占用相机的应用后重试。');}
  finally{starting=false;start.disabled=quotaEmpty();}
}
function capture(){
  if(video.readyState<2||!video.videoWidth)return null;
  const vr=$('camera').getBoundingClientRect(),tr=$('target').getBoundingClientRect();
  const scale=Math.max(vr.width/video.videoWidth,vr.height/video.videoHeight)*zoom;
  const ox=(video.videoWidth*scale-vr.width)/2,oy=(video.videoHeight*scale-vr.height)/2;
  const sx=(tr.left-vr.left+ox)/scale,sy=(tr.top-vr.top+oy)/scale,sw=tr.width/scale,sh=tr.height/scale;
  const ratio=Math.min(1,1600/Math.max(sw,sh));canvas.width=Math.round(sw*ratio);canvas.height=Math.round(sh*ratio);
  ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);smallCtx.drawImage(canvas,0,0,96,64);
  const pixels=smallCtx.getImageData(0,0,96,64).data;const gray=new Float32Array(96*64);let avg=0,edges=0;
  for(let i=0;i<gray.length;i++){gray[i]=pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114;avg+=gray[i];}
  avg/=gray.length;let variance=0;
  for(let y=1;y<63;y++)for(let x=1;x<95;x++){const i=y*96+x;variance+=(gray[i]-avg)**2;edges+=Math.abs(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-96]-gray[i+96]);}
  return {gray,avg,contrast:Math.sqrt(variance/(94*62)),edges:edges/(94*62)};
}
function difference(a,b){if(!a||!b)return 999;let n=0;for(let i=0;i<a.length;i++)n+=Math.abs(a[i]-b[i]);return n/a.length;}
async function tick(){
  if(!running||document.hidden||locked||busy)return;
  if(enforceCameraQuota())return;
  const f=capture();if(!f)return;
  // Rank a bounded window; ordinary hand motion must not reset the request.
  const score=f.edges*Math.min(f.contrast/25,1);
  if(f.avg>25&&(!best||score>best.score)){
    let image=canvas.toDataURL('image/jpeg',.88);
    if(image.length>1600000)image=canvas.toDataURL('image/jpeg',.65);
    best={score,image,contrast:f.contrast,avg:f.avg};
  }
  // Heuristic early submission, not a guarantee that text is in focus.
  const selectionWindow=best&&best.score>=12&&best.contrast>=18&&best.avg>=45?750:2000;
  if(Date.now()-windowStart<selectionWindow||Date.now()-lastCall<2000){status.textContent=t('正在自动挑选较清晰的画面，轻微手抖没关系。');return;}
  if(!best){status.textContent=t('光线太暗，请移到亮一些的地方。');return;}
  if(attempts>=3){locked=true;$('resultState').textContent=t('需要重扫');status.textContent=t('还没看清。请拿远一点或换镜头，然后点“重新扫描”。');return;}
  busy=true;lastCall=Date.now();attempts++;
  const selectionMs=Date.now()-windowStart;
  const token=epoch;const selected=best.image;best=null;
  const image=selected.split(',')[1];controller=new AbortController();const ownController=controller;
  $('frameImage').src=selected;$('framePreview').hidden=false;
  const timeout=setTimeout(()=>ownController.abort(),16000);
  status.textContent=pending?t('正在用下一帧核对允许条件…'):t('正在读取标签文字和符号…');$('resultState').textContent=t('识别中');
  const slowNotice=setTimeout(()=>{if(token===epoch&&running&&busy)status.textContent=t('识别服务响应较慢，仍在等待…');},5000);
  const requestStarted=Date.now();
  try{
    const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json',...(personalKey?{'x-gemini-api-key':personalKey}:{})},body:JSON.stringify({image,language}),signal:ownController.signal});
    let data;
    try{data=await response.json();if(!data||typeof data!=='object')throw new Error('Invalid response');}
    catch{
      if(token!==epoch||!running)return;
      locked=true;clearResults(t('未获得结果'));
      status.textContent=response.ok?t('识别服务返回了无法读取的结果，请重试。'):t('临时连接服务返回了错误页面，请稍后重试。');
      await refreshQuota();return;
    }
    if(data.trial){trial=data.trial;renderQuota();}if(token!==epoch||!running)return;
    if(!response.ok){locked=true;clearResults(t('未获得结果'));status.textContent=t(data.error)||t('识别失败，请重新扫描。');if(data.code==='not_configured')$('configuration').hidden=false;return;}
    if(!data.label_visible){clearResults(t('未看清标签'));status.textContent=t(data.guidance)||t('标签没有看清，请拿远一点，让文字对上焦。');windowStart=Date.now();return;}
    // A result belongs to the captured thumbnail, not the moving live view.
    // Keep it readable until the user explicitly starts the next garment.
    data.selection_ms=selectionMs;data.request_ms=Date.now()-requestStarted;
    show(data,false);locked=true;$('resultState').textContent=t('已保留 · 对应下方画面');$('rescan').textContent=t('扫下一件');
    status.textContent=t('识别结束，结果已保留。查看下方对应画面；换衣服请点“扫下一件”。');
  }catch(e){if(token===epoch&&running){locked=true;clearResults(t('未获得结果'));status.textContent=e.name==='AbortError'?t('识别超时，请重新扫描。'):t('网络连接中断，请检查网络后重新扫描。');}}
  finally{clearTimeout(timeout);clearTimeout(slowNotice);busy=false;if(controller===ownController)controller=null;enforceCameraQuota();}
}
function show(data,checking){
  for(const k of ['dry','wash']){const r=data[k],hold=checking&&['allowed','conditional'].includes(r.status);$(k+'Answer').textContent=hold?t('正在核对'):t(r.title);$(k+'Detail').textContent=hold?t('已读到允许条件，等待下一帧确认。'):t(r.detail);$(k+'Card').className='result '+(!hold&&r.status==='forbidden'?'blocked':!hold&&r.status!=='unknown'?'confirmed':'');}
  $('resultState').textContent=checking?t('核对中'):t('当前标签');$('evidence').hidden=false;$('evidenceText').textContent=[t('烘干：')+(data.dry.evidence||t('没有清晰依据')),t('水洗：')+(data.wash.evidence||t('没有清晰依据'))].join('\n\n');$('timing').textContent=Number.isFinite(data.request_ms)?t('本轮用时 ')+((data.selection_ms+data.request_ms)/1000).toFixed(1)+t(' 秒 · 挑图 ')+(data.selection_ms/1000).toFixed(1)+t(' 秒 · 请求 ')+(data.request_ms/1000).toFixed(1)+t(' 秒（含模型 ')+(data.duration_ms/1000).toFixed(1)+t(' 秒）'):t('本次模型响应 ')+(data.duration_ms/1000).toFixed(1)+t(' 秒');
}
start.addEventListener('click',()=>running?stop():begin());
$('zoom').addEventListener('input',()=>{zoom=Number($('zoom').value);video.style.transform='scale('+zoom+')';if(running)resetScan();});
$('lens').addEventListener('change',async()=>{const id=$('lens').value;stop();await begin(id);});$('rescan').addEventListener('click',async()=>{await refreshQuota();resetScan();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop();});window.addEventListener('pagehide',()=>{if(running||starting)stop();});
async function check(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();const d=await r.json();serverConfigured=d.configured;trial=d.trial||null;updateKeyState();if(!enforceCameraQuota()){start.disabled=false;start.textContent=t('开启摄像头');status.textContent='';}}catch{start.disabled=true;start.textContent=t('重新检查连接');status.textContent=t('暂时无法连接服务，请刷新页面重试。');}}
async function refreshQuota(){try{const r=await fetch('/api/status');if(r.ok){const d=await r.json();trial=d.trial||null;renderQuota();}}catch{}}
function quotaMessage(){
 const messages={browser_limit:'这个浏览器的 10 次免费体验已用完。',ip_limit:'当前网络今日的 30 次免费调用已用完。',site_limit:'今日全站的 200 次免费调用已用完。'};
 return t(messages[trial?.reason]||'免费体验已用完，请填写自己的 API Key。');
}
function renderQuota(){
 $('quotaStatus').textContent=personalKey?t('使用自己的 Key · 不受体验额度限制'):trial?(trial.remaining===0?quotaMessage():t('当前可免费调用：')+trial.remaining+t(' 次')):'';
}
function updateKeyState(){
 renderQuota();
 if(!enforceCameraQuota()&&!running&&!starting){start.disabled=false;start.textContent=t('开启摄像头');$('cameraCaption').textContent=t('开启后自动扫描，无需按快门');status.textContent='';}
 $('configuration').hidden=!!personalKey||serverConfigured;
 $('apiMessage').textContent=personalKey?t('已使用你的 Key。点击“开启摄像头”开始扫描，扫描时验证 Key。'):serverConfigured?'':t('尚未填写 Key。');
}
$('apiToggle').addEventListener('click',()=>{const open=$('apiPanel').hidden;$('apiPanel').hidden=!open;$('apiToggle').setAttribute('aria-expanded',String(open));if(open)$('apiKey').focus();});
function readPastedKey(raw){
 let value=raw.replace(/[\s\u200B-\u200D\uFEFF]/g,'').replace(/^GEMINI_API_KEY=/,'');
 const quotes={'"':'"',"'":"'",'`':'`','“':'”','‘':'’'};
 if(quotes[value[0]]&&value.at(-1)===quotes[value[0]])value=value.slice(1,-1);
 return value;
}
$('apiForm').addEventListener('submit',event=>{
 event.preventDefault();const value=readPastedKey($('apiKey').value);
 let error='';
 if(!value)error='请先粘贴 Gemini API Key。';
 else if(/[•●*…]/.test(value))error='粘贴的是隐藏后的内容，请从密钥管理页面复制完整 Key。';
 else if(!/^[A-Za-z0-9_.-]+$/.test(value))error='Key 含有不支持的字符，请只复制密钥本身，不要复制网址或说明文字。';
 else if(value.length<20||value.length>256)error='Key 长度不正确，请重新复制完整密钥。';
 if(error){$('apiMessage').textContent=t(error);return;}
 personalKey=value;$('apiKey').value='';$('apiKey').blur();resetScan();updateKeyState();
});
$('apiClear').addEventListener('click',()=>{personalKey='';$('apiKey').value='';resetScan();updateKeyState();});
$('languageSelect').addEventListener('change',()=>{
 const next=$('languageSelect').value;if(next===language)return;language=next==='en'?'en':'zh';try{localStorage.setItem('care-language',language);}catch{}
 translatePage();resetScan();updateKeyState();
});
check();
