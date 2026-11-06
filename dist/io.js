import {validateSensorData} from './imu-model.js';
import {actionErrors,actionSubtitles} from './video-model.js';
import {label,labelsForTask,customLabelErrors,validDescription,LABELS,blankAnnotation,copy,uid,validateTask} from './core.js';
const enc=new TextEncoder(),dec=new TextDecoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
export function zipStore(files){
 let offset=0;const parts=[],central=[];
 for(const {name,data} of files){const n=enc.encode(name),b=data instanceof Uint8Array?data:enc.encode(data),crc=crc32(b);const h=new Uint8Array(30+n.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);h.set(n,30);parts.push(h,b);
 const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,crc,true);w.setUint32(20,b.length,true);w.setUint32(24,b.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);c.set(n,46);central.push(c);offset+=h.length+b.length;
 }
 const size=central.reduce((s,a)=>s+a.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
}
export function unzipStore(bytes){
 const files=new Map();let i=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let total=0;
 while(i+4<=bytes.length&&view.getUint32(i,true)===0x04034b50){
  if(i+30>bytes.length)throw new Error('作业包头部不完整。');
  const flags=view.getUint16(i+6,true),method=view.getUint16(i+8,true),crc=view.getUint32(i+14,true),size=view.getUint32(i+18,true),length=view.getUint16(i+26,true),extra=view.getUint16(i+28,true);
  if(method!==0||(flags&8))throw new Error('请选择本平台导出的 ZIP 作业包。');
  const start=i+30+length+extra,end=start+size;if(end>bytes.length)throw new Error('作业包文件被截断。');
  const name=dec.decode(bytes.slice(i+30,i+30+length));if(name.includes('..')||name.startsWith('/')||name.includes('\\')||files.has(name))throw new Error('作业包包含不安全或重复的文件路径。');
  total+=size;if(total>250*1024*1024||files.size>1100)throw new Error('作业包超过 250 MB 或文件数量上限。');
  const data=bytes.slice(start,end);if(crc32(data)!==crc)throw new Error('作业包校验失败，请重新导出。');files.set(name,data);i=end;
 }
 if(!files.size)throw new Error('没有找到可读取的作业包文件。');return files;
}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
export function manifest(tasks,profile,lessons,quiz){return {schema:'labelcamp.training',version:1,exportedAt:new Date().toISOString(),learner:profile,...(lessons?.length||quiz?{course:{completedLessons:lessons,quiz}}:{}),coordinateSystem:{boxes:'normalized_xywh',textOffsets:'UTF-16 code units; end exclusive',audio:'seconds',video:'zero-based frame index with fixed fps',videoActions:'seconds; start inclusive, end exclusive; actor/action/object/description'},tasks:tasks.map(({truth,...t})=>copy(t))}}
export async function exportZip(tasks,profile,lessons,quiz,store){
 const m=manifest(tasks,profile,lessons,quiz),files=[],media=new Map();
 for(const t of m.tasks){if(t.type==='text')continue;const key=t.blobId||t.src;if(!key)throw new Error(`${t.name} 缺少原始素材，请先补齐。`);
  if(!media.has(key)){let b;if(t.blobId)b=await store.blob(t.blobId);else{const r=await fetch(t.src);if(!r.ok)throw new Error(`无法读取素材 ${t.name}`);b=await r.blob()}if(!b)throw new Error(`素材 ${t.name} 已丢失。`);
   const ext=({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg','video/mp4':'mp4','video/webm':'webm','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg','audio/mp4':'m4a','audio/aac':'aac'})[b.type]||t.src?.split('.').pop()?.split('?')[0]||'bin';
   const name=`media/${String(media.size+1).padStart(3,'0')}.${/^[a-z0-9]{1,5}$/.test(ext)?ext:'bin'}`;media.set(key,name);files.push({name,data:new Uint8Array(await b.arrayBuffer())});
  }
  t.packageMedia=media.get(key);delete t.blobId;delete t.src;
  if(t.type==='video'&&t.dataset==='Nymeria'&&(t.sensorSrc||t.sensorBlobId)){
   let blob;if(t.sensorBlobId)blob=await store.blob(t.sensorBlobId);else{const r=await fetch(t.sensorSrc);if(!r.ok)throw new Error(`无法读取感测器资料 ${t.name}`);blob=await r.blob()}
   if(!blob)throw new Error(`感测器资料 ${t.name} 已丢失`);if(blob.size>12*1024*1024)throw new Error('感测器文件过大。');const data=validateSensorData(JSON.parse(await blob.text()),Number(t.duration));
   const name=`sensors/${String(files.filter(f=>f.name.startsWith('sensors/')).length+1).padStart(3,'0')}.json`;files.push({name,data:new Uint8Array(await blob.arrayBuffer())});t.packageSensor=name;delete t.sensorSrc;delete t.sensorBlobId;
  }
 }
 files.unshift({name:'manifest.json',data:JSON.stringify(m,null,2)});
 files.push({name:'交付说明.txt',data:'标注工坊作业包\n在平台中选择「导入作业包」即可复核。\nmanifest.json 保存标注、学员信息和操作记录；media/ 保存对应素材；sensors/ 保存 Nymeria 配套感测器与 TCN 特征。\n作业包需要手动移交复核。\n'});
 const licensed=m.tasks.filter(t=>t.license);
 if(licensed.length){files.push({name:'素材来源与许可.txt',data:licensed.map(t=>[t.name,t.dataset||'',t.sourceAttribution||'',t.sourceURL||'',t.originalURL||'',`License: ${t.license} ${t.licenseURL||''}`,t.annotationLicense?`Source annotations: ${t.annotationLicense} ${t.annotationLicenseURL||''}`:'',t.modifications?`Changes: ${t.modifications}`:''].filter(Boolean).join('\n')).join('\n\n')+'\n\n学员描述与标注为后续创作；请保留各素材的署名、许可和适用的相同方式共享要求。\n'});}
 files.push(...videoActionFiles(m.tasks));
 return zipStore(files);
}
const mimeByExt={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac'};
export async function importPackage(file,store,allowedSources=new Set()){
 if(file.size>250*1024*1024)throw new Error('单个作业包不能超过 250 MB。');
 let m,files;
 if(file.name.toLowerCase().endsWith('.zip')){files=unzipStore(new Uint8Array(await file.arrayBuffer()));if(!files.has('manifest.json'))throw new Error('作业包缺少 manifest.json。');m=JSON.parse(dec.decode(files.get('manifest.json')))}else m=JSON.parse(await file.text());
 if(m.schema!=='labelcamp.training'||m.version!==1||!Array.isArray(m.tasks)||m.tasks.length>1000)throw new Error('不是受支持的标注工坊作业包。');
 const batch=uid('import'),tasks=[],blobs=[];
 for(const original of m.tasks){
  if(!original||!['image','video','audio','text'].includes(original.type)||!['new','draft','submitted','rework','approved'].includes(original.status))throw new Error('作业包包含不支持的素材类型或状态。');
  const t=copy(original);t.sourceId=t.sourceId||t.id;t.id=uid(batch);t.project='imports';t.importBatch=batch;t.originLearner=m.learner?.name||'导入作业';t.name=String(t.name||'导入样本').slice(0,150);t.annotation={...blankAnnotation(),...t.annotation};
  for(const key of ['boxes','tracks','segments','entities','actions'])if(!Array.isArray(t.annotation[key])||t.annotation[key].length>2000)throw new Error('标注数据格式不正确。');
  if(customLabelErrors(t.customLabels).length)throw new Error('自定义类别定义无效。');
  for(const key of ['boxes','tracks','segments','entities','actions'])if(t.annotation[key].some(o=>!o||typeof o.id!=='string'||o.id.length>180))throw new Error('标注对象缺少有效 ID。');
  if(!validDescription(t.annotation.description)||[...t.annotation.boxes,...t.annotation.tracks].some(o=>!validDescription(o.description)))throw new Error('描述须为文字，且不超过 1000 字。');
  const actionProblems=actionErrors(t.annotation.actions,Number(t.duration),t.annotation.tracks,false,false);if(actionProblems.length)throw new Error(actionProblems.join(' '));
  if(t.type==='text'&&(typeof t.text!=='string'||t.text.length>100000))throw new Error('文字素材无效或过长。');
  if(t.annotation.boxes.some(b=>![...LABELS,...(t.customLabels||[])].some(l=>l.id===b.label)||!['x','y','w','h'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)))throw new Error('图像目标框格式不正确。');
  if(t.annotation.boxes.some(b=>b.points&&(!Array.isArray(b.points)||b.points.length<3||b.points.length>3000||b.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))))throw new Error('多边形顶点格式不正确。');
  if(t.annotation.tracks.some(tr=>![...LABELS,...(t.customLabels||[])].some(l=>l.id===tr.label)||!Array.isArray(tr.keyframes)||!tr.keyframes.length||tr.keyframes.some(k=>!Number.isInteger(k.frame)||k.frame<0||!k.box||!['x','y','w','h'].every(p=>Number.isFinite(k.box[p])&&k.box[p]>=0&&k.box[p]<=1))))throw new Error('视频轨迹格式不正确。');
  if(t.annotation.segments.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start))throw new Error('音频片段时间格式不正确。');
  if(t.annotation.entities.some(e=>!Number.isInteger(e.start)||!Number.isInteger(e.end)||!['date','time','location'].includes(e.label)))throw new Error('文字实体格式不正确。');
  if(t.type!=='text'){
   if(t.packageMedia){const bytes=files?.get(t.packageMedia);if(!bytes)throw new Error('作业包缺少素材文件，请使用完整 ZIP。');const id=uid('media'),ext=t.packageMedia.split('.').pop();blobs.push({id,blob:new Blob([bytes],{type:mimeByExt[ext]||'application/octet-stream'})});t.blobId=id;delete t.src}
   else if(t.blobId||!allowedSources.has(t.src))throw new Error('此 JSON 缺少原素材，请改用包含素材的 ZIP 作业包。');
  }
  if(t.packageSensor){
   if(t.type!=='video'||t.dataset!=='Nymeria'||typeof t.packageSensor!=='string'||!/^sensors\/\d{3,4}\.json$/.test(t.packageSensor))throw new Error('感测器文件引用无效。');
   const bytes=files?.get(t.packageSensor);if(!bytes)throw new Error('作业包缺少配套感测器资料。');if(bytes.length>12*1024*1024)throw new Error('感测器文件过大。');
   validateSensorData(JSON.parse(dec.decode(bytes)),Number(t.duration));const id=uid('sensor');blobs.push({id,blob:new Blob([bytes],{type:'application/json'})});t.sensorBlobId=id;delete t.sensorSrc;
  }else if(t.sensorBlobId||t.sensorSrc&&!allowedSources.has(t.sensorSrc))throw new Error('此作业缺少配套感测器资料，请使用完整 ZIP。');
  if(!Array.isArray(t.history))t.history=[];t.history=t.history.slice(-200);t.history.push({at:new Date().toISOString(),action:'import',note:`导入自 ${m.learner?.name||'学员'} 的作业包`});tasks.push(t);
 }
 for(const b of blobs)await store.putBlob(b.id,b.blob);await store.putTasks(tasks);return{tasks,learner:m.learner,count:tasks.length};
}
export function csv(tasks){
 const rows=[['sample_id','source_id','file','type','status','scene','object_id','label','frame','start_seconds','end_seconds','start_char','end_char','x_normalized','y_normalized','width_normalized','height_normalized','text','speaker','review_comment','object_description','scene_description','annotation_kind','actor','action','target_object','linked_track_id']];
 rows[0].push('label_name');
 for(const t of tasks){const a=t.annotation;let items=[];
  if(t.type==='image')items=a.boxes.map(x=>({id:x.id,label:x.label,box:x,description:x.description}));
  if(t.type==='video')items=[...a.tracks.flatMap(x=>x.keyframes.map(k=>({id:x.id,label:x.label,frame:k.frame,box:k.box,description:x.description,kind:'track_keyframe'}))),...(a.actions||[]).map(x=>({...x,text:x.description||'',kind:'action_segment'}))];
  if(t.type==='audio')items=a.segments.map(x=>({...x,label:x.unclear?'unclear':'speech'}));
  if(t.type==='text')items=[{label:a.intent,text:t.text},...a.entities.map(e=>({label:e.label,text:e.text,start:e.start,end:e.end}))];
  if(!items.length)items=[{}];
  for(const i of items)rows.push([t.id,t.sourceId||t.id,t.name,t.type,t.status,a.scene,i.id||'',i.label||'',i.frame??'',t.type==='text'?'':i.start??'',t.type==='text'?'':i.end??'',t.type==='text'?i.start??'':'',t.type==='text'?i.end??'':'',i.box?.x??'',i.box?.y??'',i.box?.w??'',i.box?.h??'',i.text||'',i.speaker||'',t.review?.comment||'',i.description||'',a.description||'',i.kind||'',i.actor||'',i.action||'',i.object||'',i.trackId||'',i.label&&['image','video'].includes(t.type)?label(i.label,t).name:i.label||'']);
 }
 return '\uFEFF'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n');
}
export function coco(tasks){
 const images=[],annotations=[],categories=LABELS.map((l,i)=>({id:i+1,name:l.id})),categoryByTask=new Map();let id=1;
 for(const t of tasks){if(customLabelErrors(t.customLabels).length)throw new Error('自定义类别定义无效。');const map=new Map(LABELS.map((l,i)=>[l.id,i+1]));for(const l of t.customLabels||[]){let category=categories.find(c=>c.custom_label_id===l.id&&c.name===l.name);if(!category){category={id:categories.length+1,name:l.name,custom_label_id:l.id};categories.push(category)}map.set(l.id,category.id)}categoryByTask.set(t,map)}
 tasks.filter(t=>t.type==='image').forEach((t,i)=>{images.push({id:i+1,file_name:t.name,width:t.width,height:t.height,scene:t.annotation.scene||'',description:t.annotation.description||'',source_url:t.sourceURL||'',license:t.license||'',license_url:t.licenseURL||'',attribution:t.sourceAttribution||''});for(const b of t.annotation.boxes){const bb=[b.x*t.width,b.y*t.height,b.w*t.width,b.h*t.height];let area=bb[2]*bb[3];if(b.points)area=Math.abs(b.points.reduce((sum,p,j)=>{const q=b.points[(j+1)%b.points.length];return sum+p.x*q.y-q.x*p.y},0))*t.width*t.height/2;const categoryId=categoryByTask.get(t).get(b.label);if(!categoryId)throw new Error('标注引用了未定义类别。');annotations.push({id:id++,image_id:i+1,category_id:categoryId,bbox:bb,area,iscrowd:0,attributes:{description:b.description||'',occluded:!!b.occluded},...(b.points?{segmentation:[b.points.flatMap(p=>[p.x*t.width,p.y*t.height])]}:{})})}});
 return{info:{description:'标注工坊图像标注导出',version:'1.6',description_field:'annotations[].attributes.description (extension); images[].description for scene descriptions'},images,annotations,categories};
}

function videoActionFiles(tasks){const selected=tasks.filter(t=>t.type==='video'&&t.annotation.actions?.length);if(!selected.length)return [];const files=[{name:'video-actions/actions.csv',data:csv(selected)}];for(const [i,t] of selected.entries()){const prefix=`video-actions/${String(i+1).padStart(3,'0')}`;files.push({name:prefix+'.srt',data:actionSubtitles(t.annotation.actions,'srt')},{name:prefix+'.vtt',data:actionSubtitles(t.annotation.actions,'vtt')})}files.push({name:'video-actions/actions.json',data:JSON.stringify({schema:'labelcamp.video-actions',version:1,timeUnit:'seconds; start inclusive, end exclusive',videos:selected.map(t=>({id:t.id,name:t.name,duration:t.duration,fps:t.fps,sourceURL:t.sourceURL,sourceAttribution:t.sourceAttribution,license:t.license,licenseURL:t.licenseURL,actions:copy(t.annotation.actions)}))},null,2)});return files}
export function exportActions(tasks){const files=videoActionFiles(tasks);if(!files.length)throw new Error('当前范围还没有动作片段，请先标注视频。');files.push({name:'使用说明.txt',data:'动作片段包包含 JSON、CSV、SRT 与 WebVTT；不含视频。完整素材与复核请使用完整 ZIP 作业包。相同人物可有重叠动作，字幕播放器对重叠字幕的显示可能不同。\n'});return zipStore(files)}
