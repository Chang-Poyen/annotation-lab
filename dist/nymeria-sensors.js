import {esc,clamp,time} from './core.js';
import {isNymeriaSensorTask,validateSensorData,sampleIndex,sensorPiece,visibleSensorRange,robustBounds,sensorTimeAt} from './imu-model.js';

const COLORS=['#5b8db3','#7c9b5a','#c78c58'];
export class NymeriaSensors{
 constructor(editor){this.e=editor;this.mode='encoded';this.sensor=0;this.axes=new Set([0,1,2]);this.windowSeconds=editor.task.duration>90?10:0;this.collapsed=false;this.lastWindow='';this.abort=new AbortController()}
 static supported(task){return isNymeriaSensorTask(task)}
 html(){return '<section class="nymeria-sensors" aria-label="Nymeria 感测器与 TCN 特征"><div class="ns-header"><div><span class="ns-kicker">NYMERIA · INERTIAL</span><strong>感测器与 TCN 特征</strong></div><button type="button" class="btn ghost small" data-ns="collapse" aria-expanded="true">收起</button></div><div class="ns-body"><p class="ns-loading" role="status">正在读取本片配套感测器资料…</p></div></section>'}
 async mount(){
  const root=this.e.root;this.panel=root.querySelector('.nymeria-sensors');if(!this.panel)return;
  this.clickHandler=e=>this.click(e);this.changeHandler=e=>this.change(e);this.panel.addEventListener('click',this.clickHandler);this.panel.addEventListener('change',this.changeHandler);
  try{
   let data;if(this.e.task.sensorBlobId){const blob=await this.e.ctx.store.blob(this.e.task.sensorBlobId);if(!blob)throw new Error('作业包中的感测器文件缺失');data=JSON.parse(await blob.text())}
   else{const r=await fetch(this.e.task.sensorSrc,{signal:this.abort.signal});if(!r.ok)throw new Error('配套资料读取失败（'+r.status+'）');data=await r.json()}
   if(this.e.dead)return;this.data=validateSensorData(data,this.e.duration);if(data.videoSha256&&this.e.task.sha256&&data.videoSha256!==this.e.task.sha256)throw new Error('感测器与视频来源不匹配');if(!data.encoded)this.mode='raw';this.computeBounds();this.render();
  }catch(error){if(error.name==='AbortError'||this.e.dead)return;this.panel.querySelector('.ns-body').innerHTML=`<p class="ns-error" role="status">${esc(error.message)}。视频仍可正常标注。</p>`}
 }
 computeBounds(){const d=this.data;this.rawBounds=Array.from({length:18},(_,i)=>robustBounds(d.raw.values.map(row=>row[i])));this.featureBounds=d.encoded?Array.from({length:d.encoded.values[0].length},(_,i)=>robustBounds(d.encoded.values.map(row=>row[i]))):[]}
 render(){const d=this.data;if(!d)return;
  this.panel.querySelector('.ns-body').innerHTML=`<div class="ns-controls"><div class="ns-tabs" role="group" aria-label="感测器显示方式"><button type="button" data-ns="encoded" class="${this.mode==='encoded'?'active':''}" ${d.encoded?'':'disabled'}>TCN 特征</button><button type="button" data-ns="raw" class="${this.mode==='raw'?'active':''}">IMU 波形</button></div><label>时间范围<select data-ns-window aria-label="感测器时间范围"><option value="0" ${!this.windowSeconds?'selected':''}>完整片段</option><option value="5" ${this.windowSeconds===5?'selected':''}>跟随播放 · 5 秒</option><option value="10" ${this.windowSeconds===10?'selected':''}>跟随播放 · 10 秒</option></select></label></div><div class="ns-raw-controls" ${this.mode==='raw'?'':'hidden'}><label>部位<select data-ns-sensor aria-label="感测器部位">${d.raw.sensorNames.map((name,i)=>`<option value="${i}" ${i===this.sensor?'selected':''}>${esc(name)}</option>`).join('')}</select></label><div class="ns-axes">${['X','Y','Z'].map((name,i)=>`<label style="--axis:${COLORS[i]}"><input type="checkbox" data-ns-axis="${i}" ${this.axes.has(i)?'checked':''}>${name}</label>`).join('')}</div><span>各轴独立缩放 · 原值见下方</span></div><div class="ns-chart" role="slider" tabindex="0" aria-label="感测器时间定位，点击图表或按左右键定位视频" aria-valuemin="0" aria-valuemax="${d.duration}" aria-valuenow="0"><canvas aria-label="${this.mode==='encoded'?'TCN 编码特征热图':'三轴加速度波形'}"></canvas><div class="ns-action-shading"></div><i class="ns-cursor"><b></b></i></div><div class="ns-ruler"></div><div class="ns-readout" aria-live="off"></div><p class="ns-caption">${this.mode==='encoded'?`${d.encoded.values[0].length} 维 TCN 编码特征（双手输入）· 各维按 2–98 百分位缩放；颜色表示相对激活强度，不代表动作类别。`:'六部位加速度 · X/Y/Z 为来源坐标轴；曲线按各轴 2–98 百分位缩放。'} 点击图表定位视频。</p><details class="ns-provenance"><summary>资料来源、编码器与时间对齐</summary><p>${esc(d.alignment?.description||'按配套切片的相对时间对齐，绝对时钟未校准。')}</p>${d.encoder?`<p>${esc(d.encoder.name)} · ${esc(d.encoder.outputStage||'TCN features')}<br>输入：左右手自由加速度幅值；每条原序列独立编码，特征维度不用于跨序列比较。<br>权重 SHA-256：<code>${esc(d.encoder.checkpointSha256)}</code></p>`:''}<p>原始切片：${d.pieces.map(p=>esc(p.clipId)).join('、')}。虚线表示切片接点；接点两侧不假定动作连续。IMU 与编码特征作为观察参考，动作边界由学员回看视频判断。</p></details>`;
  const chart=this.panel.querySelector('.ns-chart');this.seekHandler=event=>{if(event.target.closest('.ns-chart'))this.seek(event)};chart.addEventListener('pointerdown',this.seekHandler);
  chart.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const now=this.e.media?.currentTime||0,step=1/(this.e.task.fps||30),t=event.key==='Home'?0:event.key==='End'?d.duration:now+(event.key==='ArrowLeft'?-step:step);this.seekTo(t)}});
  chart.addEventListener('pointermove',event=>{const range=this.range(),t=sensorTimeAt(event.clientX,chart.getBoundingClientRect(),range),p=sensorPiece(d,t);chart.title=p?`${time(t)} · 源切片 ${p.clipId}`:`${time(t)} · 无感测器覆盖`;if(this.mode==='encoded'&&d.encoded&&p){const rect=chart.getBoundingClientRect(),dimension=Math.min(d.encoded.values[0].length-1,Math.floor(clamp((event.clientY-rect.top)/rect.height)*d.encoded.values[0].length)),index=sampleIndex(d.encoded.times,t);chart.title+=` · 特征 ${dimension+1}: ${d.encoded.values[index][dimension].toFixed(4)}`}});
  this.resize?.disconnect();this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(chart);this.draw();this.e.fit();
 }
 range(){return visibleSensorRange(this.data.duration,Math.floor((this.e.media?.currentTime||0)*4)/4,this.windowSeconds)}
 click(event){const b=event.target.closest('[data-ns]');if(!b)return;
  if(b.dataset.ns==='collapse'){this.collapsed=!this.collapsed;this.panel.classList.toggle('ns-collapsed',this.collapsed);this.panel.querySelector('.ns-body').hidden=this.collapsed;b.textContent=this.collapsed?'展开':'收起';b.setAttribute('aria-expanded',String(!this.collapsed));this.e.fit();if(!this.collapsed)this.draw();return}
  if(['encoded','raw'].includes(b.dataset.ns)){this.mode=b.dataset.ns;this.render()}
 }
 change(event){const t=event.target;if(t.matches('[data-ns-window]')){this.windowSeconds=Number(t.value);this.draw()}
  if(t.matches('[data-ns-sensor]')){this.sensor=Number(t.value);this.draw()}
  if(t.matches('[data-ns-axis]')){const i=Number(t.dataset.nsAxis);if(t.checked)this.axes.add(i);else this.axes.delete(i);this.draw()}
 }
 seek(event){if(event.button!==0)return;event.preventDefault();this.seekTo(sensorTimeAt(event.clientX,this.panel.querySelector('.ns-chart').getBoundingClientRect(),this.range()))}
 seekTo(t){const media=this.e.media;if(!media||!this.e.mediaReady)return;media.pause();this.e.videoActions&&(this.e.videoActions.replayId=null);media.currentTime=clamp(t,0,Math.max(0,this.data.duration-1/(this.e.task.fps||30)));this.e.updatePlayback()}
 draw(){
  if(!this.data||this.collapsed||this.e.dead)return;const canvas=this.panel.querySelector('canvas'),chart=this.panel.querySelector('.ns-chart');if(!canvas||!chart.clientWidth)return;
  const W=chart.clientWidth,H=112,ratio=globalThis.devicePixelRatio||1;canvas.width=Math.round(W*ratio);canvas.height=H*ratio;canvas.style.height=H+'px';const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#f6f8f2';ctx.fillRect(0,0,W,H);
  const range=this.range(),span=range.end-range.start,d=this.data;this.lastWindow=[range.start.toFixed(2),range.end.toFixed(2)].join(':');
  const x=t=>(t-range.start)/span*W;
  if(this.mode==='encoded'&&d.encoded){const v=d.encoded,dims=v.values[0].length;let first=sampleIndex(v.times,range.start);
   for(let i=first;i<v.times.length&&v.times[i]<range.end;i++){const p=sensorPiece(d,v.times[i]);if(!p)continue;const right=Math.min(p.end,v.times[i+1]??p.end),left=Math.max(0,x(v.times[i])),width=Math.max(.6,x(right)-left);for(let k=0;k<dims;k++){const [lo,hi]=this.featureBounds[k],z=clamp((v.values[i][k]-lo)/(hi-lo));ctx.fillStyle=`rgb(${Math.round(239-z*190)},${Math.round(245-z*112)},${Math.round(233-z*98)})`;ctx.fillRect(left,k/dims*H,width,H/dims+.5)}}
  }else{ctx.strokeStyle='#dfe7d6';ctx.lineWidth=1;for(let y=0;y<3;y++){ctx.beginPath();ctx.moveTo(0,(y+.5)/3*H);ctx.lineTo(W,(y+.5)/3*H);ctx.stroke()}
   for(const axis of this.axes){ctx.strokeStyle=COLORS[axis];ctx.lineWidth=1.2;ctx.beginPath();let priorPiece=null,started=false;const column=this.sensor*3+axis,[lo,hi]=this.rawBounds[column];for(let i=sampleIndex(d.raw.times,range.start);i<d.raw.times.length&&d.raw.times[i]<range.end;i++){const t=d.raw.times[i],p=sensorPiece(d,t);if(!p){started=false;continue}const yy=H-8-clamp((d.raw.values[i][column]-lo)/(hi-lo))*(H-16);if(started&&p===priorPiece)ctx.lineTo(x(t),yy);else ctx.moveTo(x(t),yy);started=true;priorPiece=p}ctx.stroke()}
  }
  ctx.setLineDash([3,3]);ctx.strokeStyle='#76866b';ctx.lineWidth=1;for(const p of d.pieces.slice(1)){if(p.start<=range.start||p.start>=range.end)continue;ctx.beginPath();ctx.moveTo(x(p.start),0);ctx.lineTo(x(p.start),H);ctx.stroke()}ctx.setLineDash([]);
  this.panel.querySelector('.ns-ruler').innerHTML=Array.from({length:5},(_,i)=>`<span>${time(range.start+span*i/4)}</span>`).join('');this.renderActions(range);this.update();
 }
 renderActions(range=this.range()){const layer=this.panel.querySelector('.ns-action-shading');if(!layer)return;const s=this.e.videoActions?.current;layer.innerHTML=s&&s.start<range.end&&s.end>range.start?`<span style="left:${clamp((s.start-range.start)/(range.end-range.start))*100}%;width:${(clamp((s.end-range.start)/(range.end-range.start))-clamp((s.start-range.start)/(range.end-range.start)))*100}%"></span>`:''}
 update(){
  if(!this.data||this.collapsed||this.e.dead)return;const now=this.e.media?.currentTime||0,range=this.range(),key=[range.start.toFixed(2),range.end.toFixed(2)].join(':');if(this.windowSeconds&&this.lastWindow!==key){this.draw();return}
  const cursor=this.panel.querySelector('.ns-cursor');if(!cursor)return;cursor.style.left=clamp((now-range.start)/(range.end-range.start))*100+'%';this.panel.querySelector('.ns-chart').setAttribute('aria-valuenow',now.toFixed(3));
  const piece=sensorPiece(this.data,now),readout=this.panel.querySelector('.ns-readout'),label=`${time(now)} · ${piece?'切片 '+piece.clipId:'无感测器覆盖'}`;
  if(this.mode==='raw'&&piece){const index=sampleIndex(this.data.raw.times,now),row=this.data.raw.values[index];readout.textContent=label+' · '+this.data.raw.sensorNames[this.sensor]+' · '+[...this.axes].map(k=>['X','Y','Z'][k]+' '+row[this.sensor*3+k].toFixed(3)).join('  ')}else readout.textContent=label+(this.data.encoded?' · TCN '+this.data.encoded.values[0].length+' 维':'');this.renderActions(range)
 }
 destroy(){this.abort.abort();this.resize?.disconnect();this.panel?.removeEventListener('click',this.clickHandler);this.panel?.removeEventListener('change',this.changeHandler)}
}
