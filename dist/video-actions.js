import {esc,uid,copy,time,clamp,icon} from './core.js';
import {actionRange,moveAction,actionLanes,actionSentence} from './video-model.js';

const COLORS=['#5085a6','#789257','#b47d46','#9a6e9b','#427f79','#a66d68'];
export class VideoActions{
 constructor(editor){this.e=editor;this.zoom=1;this.inPoint=null;this.mode=editor.task.goal==='actions'?'actions':'tracks';this.selected=null;this.loop=false}
 get actions(){return this.e.a.actions||[]}
 get current(){return this.actions.find(s=>s.id===this.selected)}
 controls(){const e=this.e;return `<div class="video-controls video-editor-controls"><div class="video-mode-tabs" role="group" aria-label="视频标注方式"><button data-va="mode" data-mode="actions" class="${this.mode==='actions'?'active':''}">动作片段 <small>谁做了什么</small></button><button data-va="mode" data-mode="tracks" class="${this.mode==='tracks'?'active':''}">物体轨迹 <small>目标在哪里</small></button></div><div class="playback-row"><button class="icon-btn" data-ed="frame-prev" aria-label="上一帧" title="上一帧 ←">${icon('left',16)}</button><button class="icon-btn" data-ed="play" aria-label="播放视频">${icon('play',17)}</button><button class="icon-btn" data-ed="frame-next" aria-label="下一帧" title="下一帧 →">${icon('chevron',16)}</button><input id="video-seek" type="range" min="0" max="${e.duration||1}" step="0.01" value="0" aria-label="视频时间轴"><span id="video-time">00:00.00</span><span class="muted">/ ${time(e.duration)}</span><select id="play-speed" aria-label="视频播放速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div><div class="video-meta-row"><span class="frame-counter" id="frame-counter"></span><span class="tiny muted">${e.task.goal==='actions'?'本任务提交动作片段；物体轨迹可选做':'本任务提交物体轨迹；动作片段可选做'}</span></div><div class="video-timeline" id="video-timeline"></div><div class="action-timeline-panel" id="action-timeline-panel"><div class="action-timeline-toolbar"><strong>动作时间轴 <span id="action-total">${this.actions.length}</span></strong><div class="flex"><button class="btn small secondary" data-va="mark-in" title="I 标记起点">I 起点</button><button class="btn small secondary" data-va="mark-out" title="O 标记终点并创建">O 终点</button><button class="btn small primary" data-va="add">${icon('plus',12)}片段</button><select id="timeline-zoom" aria-label="时间轴缩放"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></div></div><div class="action-draft-hint" id="action-draft-hint">在空白时间轴上拖动创建片段；拖动片段移动，拖动两端调整边界。</div><div class="action-timeline-viewport" id="action-timeline-viewport"><div class="action-time-grid" id="action-time-grid" style="width:100%"></div></div></div></div>`}
 mount(){const root=this.e.root;
  root.addEventListener('click',this.clickHandler=e=>this.click(e));
  root.addEventListener('input',this.inputHandler=e=>this.input(e));
  root.addEventListener('change',this.changeHandler=e=>this.change(e));
  root.addEventListener('pointerdown',this.downHandler=e=>this.pointerDown(e));
  root.addEventListener('pointermove',this.moveHandler=e=>this.pointerMove(e));
  root.addEventListener('pointerup',this.upHandler=e=>this.pointerUp(e));
  root.addEventListener('pointercancel',this.cancelHandler=()=>{this.drag=null;this.render()});
  root.addEventListener('keydown',this.keyHandler=event=>{const bar=event.target.closest('[data-action-id]');if(bar&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();this.select(bar.dataset.actionId)}});
  this.render();this.applyMode();
 }
 applyMode(){const e=this.e,root=e.root;
  root.querySelectorAll('[data-va="mode"]').forEach(b=>b.classList.toggle('active',b.dataset.mode===this.mode));
  root.querySelector('#action-timeline-panel').hidden=this.mode!=='actions';root.querySelector('#video-timeline').hidden=this.mode==='actions';
  root.querySelectorAll('[data-ed="tool"],[data-ed="delete"]').forEach(b=>b.hidden=this.mode==='actions');
  const svg=root.querySelector('.annotation-svg');if(svg)svg.style.pointerEvents=this.mode==='actions'?'none':'';
  e.renderInspector();e.fit();const hint=root.querySelector('#canvas-hint');if(hint)hint.textContent=this.mode==='actions'?'拖动时间轴选一段，再填写“谁”“做了什么”。I 起点 · O 终点 · 片段可回放与循环':e.hint();
 }
 render(){const e=this.e,grid=e.root.querySelector('#action-time-grid');if(!grid)return;
  const duration=Math.max(.01,e.duration),tickCount=duration>90?Math.max(4,Math.min(32,Math.floor((grid.parentElement?.clientWidth||720)*this.zoom/85))):Math.max(4,Math.min(24,Math.ceil(duration/5))),lanes=actionLanes(this.actions),image=e.task.filmstripSrc;
  const ticks=Array.from({length:tickCount+1},(_,i)=>{const t=duration*i/tickCount;return `<button type="button" data-va="seek" data-time="${t}" style="left:${i/tickCount*100}%">${duration>90?time(t).split('.')[0]:time(t)}</button>`}).join('');
  grid.style.width=this.zoom*100+'%';
  grid.innerHTML=`<div class="action-ruler">${ticks}</div>${image?`<div class="video-filmstrip" data-va-seek="true"><img src="${esc(image)}" alt="视频时间轴缩图" draggable="false"></div>`:''}${lanes.map(l=>`<div class="action-lane-group"><div class="action-lane-label" title="${esc(l.actor)}">${esc(l.actor)}</div>${l.rows.map(row=>`<div class="action-lane" data-lane-actor="${esc(l.actor)}">${row.map(s=>this.bar(s,duration,COLORS[l.index%COLORS.length])).join('')}</div>`).join('')}</div>`).join('')}<i class="action-playhead" id="action-playhead"><b></b></i><span class="action-drag-preview" id="action-drag-preview" hidden></span>`;
  const total=e.root.querySelector('#action-total');if(total)total.textContent=this.actions.length;
  const strip=grid.querySelector('.video-filmstrip img');if(strip)strip.onerror=()=>strip.parentElement.hidden=true;
  this.updatePlayhead();this.e.nymeriaSensors?.update();
 }
 bar(s,duration,color){return `<div class="action-bar ${s.id===this.selected?'selected':''}" data-action-id="${esc(s.id)}" data-drag-kind="move" role="button" tabindex="0" aria-label="动作片段 ${esc(s.actor)} ${esc(s.action||'待填写动作')} ${time(s.start)} 至 ${time(s.end)}" style="left:${s.start/duration*100}%;width:${Math.max(.2,(s.end-s.start)/duration*100)}%;--action-color:${color}"><span class="action-handle start" data-drag-kind="start" aria-hidden="true"></span><span class="action-bar-copy">${esc(s.action||'待填写动作')} <small>${time(s.start)}–${time(s.end)}</small></span><span class="action-handle end" data-drag-kind="end" aria-hidden="true"></span></div>`}
 inspector(){const e=this.e,o=this.current;
  return `<div class="action-inspector-intro"><div class="field-title">动作片段 <span>${this.actions.length} 段</span></div><p class="helper">先定位动作开始与结束，再用一句话写清楚谁做了什么。同一人物可以有重叠动作。</p><button class="btn secondary small" data-va="add">${icon('plus',12)}从当前时间添加片段</button></div><div class="action-segment-list">${[...this.actions].sort((a,b)=>a.start-b.start).map(s=>`<button class="action-segment-card ${s.id===this.selected?'selected':''}" data-va="select" data-id="${esc(s.id)}"><span>${time(s.start)} — ${time(s.end)}</span><strong>${esc(actionSentence(s)||'待填写动作')}</strong><small>${esc(s.description||'选择后填写动作内容')}</small></button>`).join('')||'<p class="objects-empty">在下方空白时间轴拖动<br>或者点击「从当前时间添加片段」</p>'}</div>${o?`<div class="object-form action-form"><div class="field-title">编辑选中片段</div><div class="segment-time-inputs"><label for="action-start">开始（秒）<input id="action-start" type="number" min="0" max="${e.duration}" step="0.01" value="${o.start.toFixed(3)}"></label><label for="action-end">结束（秒）<input id="action-end" type="number" min="0" max="${e.duration}" step="0.01" value="${o.end.toFixed(3)}"></label></div><div class="flex action-boundary-buttons"><button class="btn small secondary" data-va="set-start">当前时间作起点</button><button class="btn small secondary" data-va="set-end">当前时间作终点</button></div><label for="action-actor">谁（必填）</label><input id="action-actor" maxlength="80" value="${esc(o.actor)}" placeholder="例：佩戴者、人物 1、红衣运动员"><label for="action-verb">做了什么（必填）</label><input id="action-verb" maxlength="80" list="action-verbs" value="${esc(o.action)}" placeholder="例：拿起、行走、投篮"><datalist id="action-verbs">${['行走','跑步','转身','拿起','放下','打开','关闭','伸手','使用工具','投篮','踢球','跳跃','传球','等待','其他'].map(v=>`<option value="${v}">`).join('')}</datalist><label for="action-object">动作对象（选填）</label><input id="action-object" maxlength="120" value="${esc(o.object)}" placeholder="例：水杯、篮球、门把手"><label for="action-description">一句话描述（选填）</label><textarea id="action-description" rows="4" maxlength="1000" placeholder="例：佩戴者伸出右手，拿起桌面上的杯子。">${esc(o.description)}</textarea><label for="action-track">关联物体轨迹（选填）</label><select id="action-track"><option value="">不关联轨迹</option>${e.a.tracks.map((t,i)=>`<option value="${esc(t.id)}" ${o.trackId===t.id?'selected':''}>轨迹 T${i+1} · ${esc(t.description||t.label)}</option>`).join('')}</select><label class="check-row"><input type="checkbox" id="action-uncertain" ${o.uncertain?'checked':''}>本段动作拿不准，需复核</label><div class="flex action-replay-buttons"><button class="btn small primary" data-va="replay">${icon('play',12)}回放选段</button><label class="check-row"><input type="checkbox" id="action-loop" ${this.loop?'checked':''}>循环</label></div><div class="flex"><button class="btn small secondary" data-va="duplicate">复制片段</button><button class="btn small ghost" data-va="delete">删除片段</button></div><p class="helper">起止范围为 [开始, 结束)。只描述可见动作，不推测身份或意图。修改自动保存。</p></div>`:''}`
 }
 add(start,end,actor='人物 1'){
  const e=this.e;if(e.readOnly)return;e.media?.pause();if(!e.mediaReady||!(e.duration>0)){e.ctx.toast('请等待视频载入。');return}
  const range=actionRange(start,end,e.duration,e.task.fps);if(!range){e.ctx.toast('片段至少需要一帧或 0.01 秒。',true);return}
  if(this.actions.length>=2000){e.ctx.toast('最多创建 2000 个动作片段。',true);return}
  const id=uid('action');this.selected=id;e.commit(a=>{a.actions||=[];a.actions.push({id,...range,actor,action:'',object:'',description:'',trackId:'',uncertain:false})});this.render();
 }
 select(id,seek=true){this.selected=id;const o=this.current;if(!o)return;if(seek){this.e.media.pause();this.e.media.currentTime=o.start}this.render();this.e.renderInspector()}
 async click(event){const b=event.target.closest('[data-va]');if(!b)return;const e=this.e,act=b.dataset.va,o=this.current;
  if(act==='mode'){this.mode=b.dataset.mode;this.drag=null;this.applyMode();this.render();return}
  if(act==='seek'){if(e.mediaReady){e.media.pause();e.media.currentTime=Math.min(e.duration,Number(b.dataset.time));e.updatePlayback()}return}
  if(act==='select'){this.select(b.dataset.id);return}
  if(act==='replay'){if(o&&e.mediaReady){e.media.currentTime=o.start;this.replayId=o.id;await e.media.play().catch(()=>e.ctx.toast('请再次点击回放。'))}return}
  if(e.readOnly)return;
  const now=e.media?.currentTime||0;
  if(act==='add'){const step=e.task.fps?1/e.task.fps:.01,start=Math.min(now,Math.max(0,e.duration-step));this.add(start,Math.min(e.duration,start+3));return}
  if(act==='mark-in'){this.inPoint=now;this.inActor=o?.actor||'人物 1';e.root.querySelector('#action-draft-hint').textContent=`起点 ${time(now)} 已记录。播放到结束位置，按 O 创建动作片段。`;return}
  if(act==='mark-out'){if(this.inPoint==null){e.ctx.toast('请先按 I 标记起点。');return}this.add(this.inPoint,now,this.inActor);this.inPoint=null;e.root.querySelector('#action-draft-hint').textContent='片段已创建，在右侧填写动作内容。';return}
  if(!o)return;
  if(act==='set-start'||act==='set-end'){const start=act==='set-start'?now:o.start,end=act==='set-end'?now:o.end;if(start>=end){e.ctx.toast('开始时间必须早于结束时间。',true);return}const range=actionRange(start,end,e.duration,e.task.fps);if(range)e.commit(()=>Object.assign(o,range));return}
  if(act==='delete'){this.remove();return}
  if(act==='duplicate'){const duplicate={...copy(o),id:uid('action')};this.selected=duplicate.id;e.commit(a=>a.actions.push(duplicate));return}
 }
 remove(){if(this.e.readOnly||!this.current)return;const id=this.selected;this.selected=null;this.replayId=null;this.e.commit(a=>a.actions=a.actions.filter(s=>s.id!==id))}
 input(event){const el=event.target,key={'action-actor':'actor','action-verb':'action','action-object':'object','action-description':'description'}[el.id],o=this.current;
  if(!o||this.e.readOnly)return;
  if(['action-start','action-end'].includes(el.id)){if(el.value==='')return;const start=Number(this.e.root.querySelector('#action-start').value),end=Number(this.e.root.querySelector('#action-end').value);if(start<0||start>=end||end>this.e.duration)return;const range=actionRange(start,end,this.e.duration,this.e.task.fps);if(range)this.e.commit(()=>Object.assign(o,range),{inspector:false,render:false})}
  else if(key){const max=key==='description'?1000:key==='object'?120:80;this.e.commit(()=>o[key]=el.value.slice(0,max),{inspector:false,render:false})}else return;
  this.render();const card=[...this.e.root.querySelectorAll('.action-segment-card')].find(el=>el.dataset.id===o.id);if(card){card.querySelector('strong').textContent=actionSentence(o)||'待填写动作';card.querySelector('small').textContent=o.description||'选择后填写动作内容';card.querySelector('span').textContent=`${time(o.start)} — ${time(o.end)}`}
  // Keep focused IME fields intact; refresh the sidebar list on blur/change.
 }
 change(event){const el=event.target,e=this.e,o=this.current;
  if(el.id==='timeline-zoom'){this.zoom=Number(el.value);this.render();return}
  if(el.id==='action-loop'){this.loop=el.checked;return}
  if(!o||e.readOnly)return;
  if(['action-start','action-end'].includes(el.id)){const start=Number(e.root.querySelector('#action-start').value),end=Number(e.root.querySelector('#action-end').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=end||end>e.duration){e.ctx.toast('请填写视频范围内的有效起止时间。',true);e.renderInspector();return}const range=actionRange(start,end,e.duration,e.task.fps);if(range)e.commit(()=>Object.assign(o,range));return}
  if(el.id==='action-track'){e.commit(()=>o.trackId=el.value);return}
  if(el.id==='action-uncertain'){e.commit(()=>o.uncertain=el.checked);return}
  if(['action-actor','action-verb','action-object','action-description'].includes(el.id))e.renderInspector();
 }
 at(event,lane){const r=lane.getBoundingClientRect();return clamp((event.clientX-r.left)/r.width)*this.e.duration}
 pointerDown(event){const e=this.e;if(this.mode!=='actions'||event.button!==0||!e.mediaReady)return;const target=event.target,lane=target.closest('.action-lane'),filmstrip=target.closest('[data-va-seek]');
  if(filmstrip){e.media.pause();e.media.currentTime=this.at(event,filmstrip);e.updatePlayback();return}
  if(!lane)return;const bar=target.closest('[data-action-id]');e.media.pause();const t=this.at(event,lane);
  if(e.readOnly){if(bar)this.select(bar.dataset.actionId);else e.media.currentTime=t;return}
  event.preventDefault();lane.setPointerCapture(event.pointerId);
  if(bar){this.selected=bar.dataset.actionId;const o=this.current;this.drag={kind:target.closest('[data-drag-kind]')?.dataset.dragKind||'move',lane,origin:t,original:copy(o),moved:false,pointerId:event.pointerId};e.renderInspector()}
  else this.drag={kind:'create',lane,origin:t,end:t,actor:lane.dataset.laneActor,moved:false,pointerId:event.pointerId};
 }
 pointerMove(event){const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;const t=this.at(event,d.lane);d.moved||=Math.abs(t-d.origin)>.02;
  if(d.kind==='create'){d.end=t;const rect=d.lane.getBoundingClientRect(),grid=this.e.root.querySelector('#action-time-grid'),preview=grid.querySelector('#action-drag-preview'),g=grid.getBoundingClientRect();preview.hidden=false;preview.style.left=Math.min(d.origin,t)/this.e.duration*100+'%';preview.style.width=Math.abs(t-d.origin)/this.e.duration*100+'%';preview.style.top=rect.top-g.top+'px';preview.style.height=rect.height+'px'}
  else{d.next=moveAction(d.original,d.kind,t-d.origin,this.e.duration,this.e.task.fps);const bar=d.lane.querySelector(`[data-action-id="${CSS.escape(d.original.id)}"]`);if(bar){bar.style.left=d.next.start/this.e.duration*100+'%';bar.style.width=(d.next.end-d.next.start)/this.e.duration*100+'%';bar.querySelector('small').textContent=`${time(d.next.start)}–${time(d.next.end)}`}}
 }
 pointerUp(event){const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;this.drag=null;
  if(d.kind==='create'){if(d.moved)this.add(d.origin,d.end,d.actor);else{this.e.media.currentTime=d.origin;this.render();this.e.updatePlayback()}}
  else if(d.moved&&d.next){const o=this.current;this.e.commit(()=>Object.assign(o,{start:d.next.start,end:d.next.end}));this.render()}
  else this.select(d.original.id);
 }
 updatePlayhead(){const e=this.e,timePoint=e.media?.currentTime||0,p=e.root.querySelector('#action-playhead');if(p)p.style.left=clamp(timePoint/Math.max(.01,e.duration))*100+'%';
  const byId=new Map(this.actions.map(s=>[s.id,s]));e.root.querySelectorAll('.action-bar').forEach(b=>{const o=byId.get(b.dataset.actionId);b.classList.toggle('playing',!!o&&timePoint>=o.start&&timePoint<o.end)});
  if(this.replayId){const o=this.actions.find(s=>s.id===this.replayId);if(!o){this.replayId=null;return}if(timePoint>=o.end){if(this.loop)e.media.currentTime=o.start;else{e.media.pause();e.media.currentTime=o.end;this.replayId=null}}}
 }
 hotkey(event){if(event.target.closest('input,textarea,select,[contenteditable]')||this.mode!=='actions')return false;
  if(['i','o'].includes(event.key.toLowerCase())){event.preventDefault();this.click({target:{closest:()=>({dataset:{va:event.key.toLowerCase()==='i'?'mark-in':'mark-out'}})}});return true}
  if(['Delete','Backspace'].includes(event.key)){event.preventDefault();this.remove();return true}
  return false;
 }
 destroy(){const root=this.e.root;for(const [name,handler] of [['click',this.clickHandler],['input',this.inputHandler],['change',this.changeHandler],['pointerdown',this.downHandler],['pointermove',this.moveHandler],['pointerup',this.upHandler],['pointercancel',this.cancelHandler],['keydown',this.keyHandler]])root.removeEventListener(name,handler)}
}
