import {actionErrors} from './video-model.js';
export const LABELS=[{id:'bottle',name:'瓶子',color:'#55b4e5'},{id:'cup',name:'杯子',color:'#e4b653'},{id:'box',name:'纸盒',color:'#b79af0'},{id:'building',name:'房屋',color:'#e9c96d'},{id:'person',name:'人物',color:'#ef997e'},{id:'car',name:'汽车',color:'#72b5ec'},{id:'bicycle',name:'自行车',color:'#9ac795'},{id:'bus',name:'公交车',color:'#dbb771'},{id:'chair',name:'椅子',color:'#c9a8e5'},{id:'table',name:'餐桌',color:'#d9ac86'},{id:'cat',name:'猫',color:'#d1a5c8'},{id:'dog',name:'狗',color:'#c4b181'},{id:'bird',name:'鸟',color:'#82bfb4'},{id:'boat',name:'船只',color:'#80b8c9'},{id:'hand',name:'手部',color:'#d59c79'},{id:'object',name:'物品',color:'#89b3a6'},{id:'ball',name:'球',color:'#e7b45c'}];
export function customLabelErrors(labels){if(labels==null)return [];if(!Array.isArray(labels)||labels.length>50)return ['自定义类别最多50个。'];const ids=new Set(),names=new Set();for(const l of labels){if(!l||typeof l.id!=='string'||!/^custom-[a-zA-Z0-9-]{1,80}$/.test(l.id)||typeof l.name!=='string'||!l.name.trim()||l.name!==l.name.trim()||l.name.length>40||/[\u0000-\u001f\u007f]/.test(l.name)||typeof l.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(l.color)||ids.has(l.id)||names.has(l.name.toLowerCase())||LABELS.some(p=>p.id===l.id||p.name.toLowerCase()===l.name.toLowerCase()))return ['自定义类别格式无效或重复。'];ids.add(l.id);names.add(l.name.toLowerCase())}return []}
export function labelsForTask(t){const wanted=Array.isArray(t.labelIds)&&t.labelIds.length?t.labelIds:(t.project==='imports'&&['image','video'].includes(t.type)?LABELS:LABELS.slice(0,3)).map(l=>l.id);const found=LABELS.filter(l=>wanted.includes(l.id));return [...(found.length?found:LABELS.slice(0,3)),...(customLabelErrors(t.customLabels).length?[]:t.customLabels||[])]}
export function addCustomLabel(task,rawName){const name=String(rawName??'').trim();if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))throw new Error('请输入1–40字的类别名称。');const existing=labelsForTask(task).find(l=>l.name.toLowerCase()===name.toLowerCase());if(existing)return existing;const preset=LABELS.find(l=>l.name.toLowerCase()===name.toLowerCase());if(preset)throw new Error('该名称属于预置类别，请使用其他名称。');const colors=['#55b4e5','#b79af0','#82bfb4','#ef997e','#e4b653','#72b5ec'];const custom={id:uid('custom'),name,color:colors[(task.customLabels||[]).length%colors.length]};const next=[...(task.customLabels||[]),custom],errors=customLabelErrors(next);if(errors.length)throw new Error(errors[0]);task.customLabels=next;return custom}
export const MAX_DESCRIPTION=1000;
export function validDescription(value){return value==null||(typeof value==='string'&&value.length<=MAX_DESCRIPTION)}
export const INTENTS=['查询','变更','取消','其他'];
export const ENTITY_TYPES=[{id:'date',name:'日期',color:'#dce8fb'},{id:'time',name:'时间',color:'#f9e8b7'},{id:'location',name:'地点',color:'#dcf1e5'}];
export const TYPE_NAMES={image:'图像',video:'视频',audio:'音频',text:'文字'};
export const STATUS_NAMES={new:'未开始',draft:'标注中',submitted:'待复核',rework:'待返修',approved:'已通过'};
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const uid=(prefix='a',random=globalThis.crypto)=>{const value=random.randomUUID?random.randomUUID().slice(0,12):Array.from(random.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');return prefix+'-'+value};
export const copy=x=>structuredClone(x);
export const label=(id,task)=>LABELS.find(x=>x.id===id)||task?.customLabels?.find(x=>x.id===id)||{id,name:id||'未知类别',color:'#89b3a6'};
export const time=s=>{s=Math.max(0,Number(s)||0);return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`};
export const pct=(a,b)=>b?Math.round(a/b*100):0;
export const dateTime=s=>s?new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未保存';
export const blankAnnotation=()=>({boxes:[],tracks:[],actions:[],segments:[],entities:[],intent:'',scene:'',description:'',notes:'',uncertain:false,issue:'',noObjects:false});
export function mergeHistory(previous=[],incoming=[]){const seen=new Set();return [...previous,...incoming].filter(entry=>{const key=JSON.stringify([entry.at,entry.action,entry.by,entry.note]);if(seen.has(key))return false;seen.add(key);return true}).slice(-200)}
export function normalizeBox(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}}
export function boxAt(track,frame){
  const keys=[...(track.keyframes||[])].sort((a,b)=>a.frame-b.frame);
  if(!keys.length||frame<keys[0].frame)return null;
  const left=[...keys].reverse().find(k=>k.frame<=frame);if(left.outside)return null;
  const right=keys.find(k=>k.frame>frame);
  if(!right||right.outside)return {...left.box,occluded:!!left.occluded};
  const p=(frame-left.frame)/(right.frame-left.frame);const b={};for(const k of ['x','y','w','h'])b[k]=left.box[k]+(right.box[k]-left.box[k])*p;
  return {...b,occluded:!!left.occluded};
}
export function setKeyframe(track,frame,box,flags={}){
  const previous=track.keyframes.find(k=>k.frame===frame)||{};
  track.keyframes=track.keyframes.filter(k=>k.frame!==frame);
  track.keyframes.push({...previous,frame,box:{x:box.x,y:box.y,w:box.w,h:box.h},...flags});
  track.keyframes.sort((a,b)=>a.frame-b.frame);
}
export function validateTask(t){
  const a=t.annotation||blankAnnotation(),errors=[];
  errors.push(...customLabelErrors(t.customLabels));if(errors.length)return errors;
  if(a.uncertain)return a.issue?.trim()?[]:['请说明无法判断的原因，再提交疑难样本。'];
  if(!validDescription(a.description)||[...a.boxes,...a.tracks].some(o=>!validDescription(o.description)))errors.push('描述须为文字，且不超过 1000 字。');
  if(t.type==='image'){
    if(!a.scene)errors.push('请选择图像场景分类。');
    if(t.goal!=='classification'&&!a.boxes.length&&!a.noObjects)errors.push('请至少标注一个目标，或确认“没有指定目标”。');
    if(t.sceneOptions&&!t.sceneOptions.includes(a.scene))errors.push('请选择本任务提供的场景类别。');
    if(t.goal==='classification'&&a.boxes.length)errors.push('本练习只做场景分类，请移除目标框。');
    if(a.noObjects&&a.boxes.length)errors.push('已勾选无目标，请删除目标框或取消勾选。');
    if(a.boxes.some(b=>!labelsForTask(t).some(l=>l.id===b.label)||!['x','y','w','h'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.w<=0||b.h<=0||b.x+b.w>1.00001||b.y+b.h>1.00001))errors.push('有无效目标框，请检查类别与边界。');
  }
  if(t.type==='video'){
    if(a.tracks.some(tr=>tr.label!=null&&![...LABELS,...(t.customLabels||[])].some(l=>l.id===tr.label)))errors.push('有无效轨迹类别，请检查目标类别。');
    if(t.goal!=='actions'&&!(t.fps>0&&t.fps<=120))errors.push('请先确认视频的固定帧率。');
    errors.push(...actionErrors(a.actions||[],Number(t.duration),a.tracks,t.goal==='actions'));
    if(t.goal!=='actions'&&!a.tracks.length)errors.push('请为一个移动目标创建轨迹。');
    if(a.tracks.some(x=>new Set(x.keyframes.map(k=>k.frame)).size<2))errors.push('每条轨迹至少需要两个不同帧的关键帧。');
  }
  if(t.type==='audio'){
    if(!a.segments.length)errors.push('请拖动波形创建至少一个音频片段。');
    if(a.segments.some(s=>!(s.start>=0&&s.end>s.start&&s.end<=Number(t.duration)+.05)))errors.push('片段起止时间超出音频范围或顺序不正确。');
    if(a.segments.some(s=>!s.text?.trim()&&!s.unclear))errors.push('请填写片段转写，或标记为听不清。');
  }
  if(t.type==='text'){
    if(t.goal!=='entities'&&!INTENTS.includes(a.intent))errors.push('请选择文字意图分类。');
    if(t.goal==='entities'&&!a.entities.length)errors.push('请选择原文中的日期、时间或地点实体。');
    if(a.entities.some(e=>e.start<0||e.end>t.text.length||e.start>=e.end||t.text.slice(e.start,e.end)!==e.text))errors.push('实体区段与原文不一致，请重新选择。');
  }
  return errors;
}
export function reviewStats(tasks){const submitted=tasks.filter(t=>['submitted','approved','rework'].includes(t.status));const checked=submitted.filter(t=>['approved','rework'].includes(t.status));return {submitted:submitted.length,checked:checked.length,rework:checked.filter(t=>t.status==='rework').length,rate:checked.length?checked.filter(t=>t.status==='rework').length/checked.length:null}}
export function icon(name,size=20){
 const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',book:'<path d="M3 4h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h7v16h-7a3 3 0 0 0-2 1 3 3 0 0 0-2-1H3zM12 5v16"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',video:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',audio:'<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',text:'<path d="M4 5h16M12 5v15M8 20h8"/>',check:'<path d="m5 12 4 4L19 6"/>',review:'<path d="M9 4H5v17h14V4h-4M9 2h6v5H9zM8 13l2 2 5-5"/>',export:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',left:'<path d="m15 5-7 7 7 7"/>',plus:'<path d="M12 4v16M4 12h16"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',box:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M2 4h4M4 2v4m14-2h4m-2-2v4M2 20h4m-2-2v4m14-2h4m-2-2v4"/>',cursor:'<path d="m5 3 14 10-7 1-3 7z"/>',polygon:'<path d="m5 5 15 3-4 12-13-5z"/><circle cx="5" cy="5" r="1"/><circle cx="20" cy="8" r="1"/><circle cx="16" cy="20" r="1"/>',undo:'<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',redo:'<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',save:'<path d="M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',play:'<path d="m8 4 12 8-12 8z"/>',pause:'<path d="M8 4v16M16 4v16"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3v.1"/>',flag:'<path d="M5 21V3h13l-3 5 3 5H5"/>',folder:'<path d="M3 6h7l2 3h9v12H3z"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',spark:'<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>',volume:'<path d="m3 9 5 0 5-5v16l-5-5H3zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',key:'<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.1M11 10h.1M15 10h.1M7 14h10"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'};
 return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.grid}</svg>`;
}

export function refreshBuiltinMetadata(task,seed){if(task.id===seed.id&&task.project==='video-nymeria'&&seed.project==='video-nymeria'&&!task.blobId){const next={...task};for(const key of ['sensorSrc','sensorSha256','sensorSummary'])if(seed[key]!=null)next[key]=copy(seed[key]);return next}if(task.id!==seed.id||task.project!==seed.project||!['open-scenes','landcover','satellite-world'].includes(seed.project)||task.blobId)return task;return {...task,name:seed.name,sceneOptions:copy(seed.sceneOptions),truth:copy(seed.truth)}}
