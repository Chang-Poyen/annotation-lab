import {Editor} from './editor.js';
import {blankAnnotation, esc, validateTask} from './core.js';

const root = document.querySelector('#exam-root');
const $ = selector => root.querySelector(selector);
const pending = new Map();
const types = {image:'图像',video:'视频',audio:'听写',review:'质检'};
let state, editor, selected, toastTimer, tickTimer, saveTimer, inFlight, stopped=false;
let timeAnchor, remainingAtLoad, switching=false, saveConflict=false;

async function api(route, data) {
  const response = await fetch('/api/exam/'+route, data === undefined ? {cache:'no-store'} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data), cache:'no-store'
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('考核服务未连接，请使用讲师提供的考核网址。');
  }
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error), {status:response.status});
  return payload;
}
function toast(message,error=false) {
  const box=document.querySelector('#toast');
  box.textContent=message; box.className=error?'show error':'show';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>box.className='',4200);
}
function timeLabel(epoch) {
  return new Date(epoch*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}
function receipt(message) {
  root.innerHTML='<section class="exam-receipt">'+message+'</section>';
}
async function load() {
  const next=await api('state');
  if(next.status==='active' && pending.size) return;
  await render(next);
}
async function render(next) {
  clearInterval(tickTimer); clearTimeout(saveTimer); editor?.destroy(); editor=null;
  state=next; stopped=state.status!=='active'; saveConflict=false;
  if(stopped) pending.clear();
  if(next.status==='locked') {
    root.innerHTML=`<section class="exam-gate"><div class="exam-intro"><h1>实操考核</h1><p>独立完成图像标注、视频分段和质量复核。可以跳题，优先完成自己有把握的任务。</p><div class="exam-duration"><b>${next.minutes}</b>分钟</div></div>
      <form class="exam-form"><h2>进入考场</h2><p>输入讲师发放的考核密码。开始后按服务器时间计时，到时收取已保存的作答。</p>
      <label for="candidate">姓名</label><input id="candidate" name="name" required maxlength="40" autocomplete="name">
      <label for="student-id">学号</label><input id="student-id" name="number" required maxlength="40" autocomplete="off">
      <label for="pass">考核密码</label><input id="pass" name="password" type="password" required maxlength="256" autocomplete="off">
      <p class="exam-error" role="alert"></p><button class="btn primary">开始考核</button></form></section>`;
    $('form').onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget, button=form.querySelector('button');button.disabled=true;
      try{await render(await api('start',Object.fromEntries(new FormData(form))))}
      catch(error){$('.exam-error').textContent=error.message;button.disabled=false}
    };
    return;
  }
  if(next.status==='unavailable') {
    receipt('<h1>本机尚未配置考核</h1><p>请使用讲师提供的考核网址。</p><a class="btn secondary" href="./">返回工作台</a>');return;
  }
  if(stopped) {
    receipt(`<h1>${next.status==='expired'?'时间到，已收卷':'已交卷'}</h1><p>${esc(next.name)} · ${esc(next.number)}<br>服务器已收取 ${next.answered} / ${next.total} 题的作答（含草稿）。<br>收卷时间 ${timeLabel(next.finished??next.deadline)}</p><button class="btn secondary" id="leave">退出考场</button>`);
    $('#leave').onclick=async()=>{await api('leave',{});await load()};return;
  }
  timeAnchor=performance.now(); remainingAtLoad=next.deadline-next.now;
  selected=next.tasks.some(t=>t.id===selected)?selected:next.tasks[0].id;
  root.innerHTML=`<section class="exam-running"><header class="exam-bar"><strong>${esc(next.name)}</strong>
    <span id="exam-progress"></span><label>跳题 <select id="task-select" aria-label="选择考题"></select></label>
    <span class="exam-clock" role="timer" aria-label="剩余时间"></span><button id="hand-in" class="btn secondary small">交卷</button></header>
    <div class="exam-prompt"></div><div class="editor-root" id="exam-editor"></div>
    <footer class="exam-foot"><span class="save-state" id="save-state" role="status"></span>
    <div class="flex"><button id="previous" class="btn secondary small">上一题</button><button id="next" class="btn secondary small">下一题</button><button id="mark" class="btn primary small">标记已完成</button></div></footer></section>
    <dialog class="exam-dialog"><h2>提前交卷？</h2><p></p><div class="flex"><button id="cancel" class="btn secondary">继续作答</button><button id="confirm" class="btn primary">确认交卷</button></div></dialog>`;
  $('#task-select').onchange=e=>openTask(e.target.value);
  $('#previous').onclick=()=>move(-1); $('#next').onclick=()=>move(1);
  $('#mark').onclick=mark;
  $('#hand-in').onclick=()=>{
    const count=next.tasks.filter(t=>answer(t.id).complete).length;
    $('dialog p').textContent=`已标记完成 ${count} / ${next.tasks.length} 题。交卷会同时提交已保存的草稿，交卷后结束本次作答。`;
    $('dialog').showModal();
  };
  $('#cancel').onclick=()=>$('dialog').close();
  $('#confirm').onclick=async()=>{
    $('#confirm').disabled=true;
    try{
      await flush(); await render(await api('finish',{}));
    }catch(error){if($('#confirm'))$('#confirm').disabled=false;toast(error.message,true);if(error.status===410)await loadClosed()}
  };
  tick();tickTimer=setInterval(tick,500);
  await openTask(selected);
}
function tick() {
  const remaining=Math.max(0,Math.ceil(remainingAtLoad-(performance.now()-timeAnchor)/1000));
  const clock=$('.exam-clock');if(!clock)return;
  clock.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
  clock.classList.toggle('urgent',remaining<300);
  if(remaining===0 && !stopped) {
    stopped=true;
    editor?.destroy();editor=null;
    root.querySelector('.exam-running').inert=true;
    void loadClosed();
  }
}
async function loadClosed() {
  try {
    const result=await api('state');
    if(result.status==='active' && stopped) {
      setTimeout(loadClosed,500);return;
    }
    if(result.status!=='active')await render(result);
  }catch(error){toast('正在重连以确认收卷：'+error.message,true);setTimeout(loadClosed,3000)}
}
function answer(id) {
  return pending.get(id)??state.answers[id]?.value??{annotation:blankAnnotation(),customLabels:[],complete:false};
}
function options() {
  $('#task-select').innerHTML=state.tasks.map((t,i)=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${i+1}. ${types[t.type]} · ${esc(t.name)}${answer(t.id).complete?' ✓':''}</option>`).join('');
  const i=state.tasks.findIndex(t=>t.id===selected);
  $('#exam-progress').textContent=`第${i+1} / ${state.tasks.length}题`;
  $('#previous').disabled=i===0;$('#next').disabled=i===state.tasks.length-1;
  $('#mark').textContent=answer(selected).complete?'取消完成标记':'标记已完成';
}
async function openTask(id) {
  if(switching||stopped)return;
  switching=true;
  try{
    editor?.destroy();editor=null;selected=id;options();
    const t=state.tasks.find(t=>t.id===id),value=answer(id);
    $('.exam-prompt').innerHTML=`<strong>${esc(t.name)}</strong> · ${esc(t.prompt)}${t.credit?`<small>${esc(t.credit)}</small>`:''}`;
    const area=$('#exam-editor');
    if(t.type==='review') {
      area.innerHTML=`<div class="exam-review"><label for="review-answer">复核记录</label><textarea id="review-answer" maxlength="6000" placeholder="记录定位、修订和复查依据。">${esc(value.annotation.notes)}</textarea></div>`;
      $('#review-answer').oninput=e=>queue(id,{...value,complete:false,annotation:{...value.annotation,notes:e.target.value}});
    }else{
      editor=new Editor(area,{...t,annotation:value.annotation,customLabels:value.customLabels,status:'draft'},{
        exam:true,listHTML:'',toast,reference:()=>{},onChange:task=>{
          const previous=answer(task.id),candidate={annotation:task.annotation,customLabels:task.customLabels||[],complete:false};
          if(JSON.stringify(previous.annotation)!==JSON.stringify(candidate.annotation)||JSON.stringify(previous.customLabels)!==JSON.stringify(candidate.customLabels))queue(task.id,candidate);
        }
      });
      await editor.mount();
    }
    saveState();
  }finally{switching=false}
}
function move(step) {
  const index=state.tasks.findIndex(t=>t.id===selected);
  if(state.tasks[index+step])openTask(state.tasks[index+step].id);
}
function mark() {
  const t=state.tasks.find(t=>t.id===selected),value=answer(selected);
  if(!value.complete) {
    const errors=t.type==='review'?(value.annotation.notes.trim()?[]:['请先填写复核记录。']):validateTask({...t,...value});
    if(errors.length){toast(errors[0],true);return}
  }
  queue(selected,{...value,complete:!value.complete});
}
function saveState(message) {
  const label=$('#save-state');if(label)label.textContent=message??(pending.size?'正在保存到服务器…':'已与服务器同步');
}
function queue(id,value) {
  if(stopped||saveConflict)return;
  pending.set(id,value);
  const marked=state.answers[id]?.value.complete;
  if(value.complete || marked || $('#mark')?.textContent==='取消完成标记')options();
  saveState();clearTimeout(saveTimer);saveTimer=setTimeout(backgroundSave,180);
}
function backgroundSave(){
  flush().catch(error=>{
    if(stopped)return;
    saveState(error.message);
    if(error.status===409){saveConflict=true;toast(error.message,true);return}
    if(error.status===403||error.status===410){stopped=true;loadClosed();return}
    saveTimer=setTimeout(backgroundSave,1800);
  });
}
async function flush() {
  clearTimeout(saveTimer);
  if(saveConflict)throw new Error('版本冲突，请刷新后核对作答。');
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    while(pending.size && !stopped) {
      const [id,value]=pending.entries().next().value;
      const revision=state.answers[id]?.revision??0;
      const result=await api('save',{task:id,value,revision});
      state.answers[id]={value,revision:result.revision};
      if(pending.get(id)===value)pending.delete(id);
    }
    saveState();
  })();
  try{await inFlight}finally{inFlight=null}
}
document.addEventListener('keydown',e=>{if(!$('dialog[open]'))editor?.hotkey(e)});
window.addEventListener('beforeunload',e=>{if(!stopped && pending.size){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',()=>{if(document.hidden && !stopped)backgroundSave();else if(state?.status==='active')tick()});
load().catch(error=>receipt(`<h1>无法连接考场</h1><p>${esc(error.message)}</p><button class="btn secondary" onclick="location.reload()">重试</button>`));
