import test from 'node:test';
import assert from 'node:assert/strict';
import {actionRange,moveAction,actionLanes,actionErrors,actionSubtitles} from '../dist/video-model.js';
import {blankAnnotation,validateTask} from '../dist/core.js';
import {Editor} from '../dist/editor.js';
import {exportZip,exportActions,importPackage,manifest,csv,unzipStore} from '../dist/io.js';

const segment=()=>({id:'action-1',start:1,end:3,actor:'佩戴者',action:'拿起',object:'水杯',description:'右手拿起桌面上的白色水杯。',trackId:'',uncertain:false});
const video=()=>({id:'day2-test',project:'video-ego',type:'video',goal:'actions',name:'第一人称练习',duration:10,fps:15,width:640,height:360,blobId:'clip',status:'draft',annotation:{...blankAnnotation(),actions:[segment()]},history:[]});

test('reverse timeline drags snap to source frames and zero-length ranges are rejected',()=>{
 assert.deepEqual(actionRange(3.1,1.12,10,15),{start:1.133,end:3.133});
 assert.deepEqual(actionRange(-2,11,10,15),{start:0,end:10});
 assert.equal(actionRange(2,2,10,15),null);assert.equal(actionRange(NaN,3,10),null);
 assert.deepEqual(actionRange(1.111,1.234,10),{start:1.11,end:1.23});
});
test('moving a segment preserves duration and trimming cannot invert its boundaries',()=>{
 const s=segment();assert.deepEqual([moveAction(s,'move',100,10,15).start,moveAction(s,'move',100,10,15).end],[8,10]);
 const left=moveAction(s,'move',-100,10,15);assert.equal(left.start,0);assert.equal(left.end,2);
 assert.ok(moveAction(s,'start',100,10,15).start<3);assert.ok(moveAction(s,'end',-100,10,15).end>1);
 assert.equal(moveAction(s,'end',100,10,15).end,10);assert.equal(s.start,1);
});
test('overlapping actions receive separate rows within the same actor lane',()=>{
 const a=segment(),b={...segment(),id:'b',start:2,end:4},c={...segment(),id:'c',start:3,end:5},d={...segment(),id:'d',actor:'人物 2'};
 const lanes=actionLanes([c,b,d,a]);assert.equal(lanes.length,2);assert.equal(lanes[0].rows.length,2);
 assert.deepEqual(lanes[0].rows[0].map(s=>s.id),['action-1','c']);assert.deepEqual(lanes[0].rows[1].map(s=>s.id),['b']);
});
test('action tasks require valid timed actor/action records and accept seconds without an assumed FPS',()=>{
 const t=video();assert.deepEqual(validateTask(t),[]);t.fps=null;assert.deepEqual(validateTask(t),[]);
 t.annotation.actions=[];assert.match(validateTask(t).join(''),/至少一个动作/);
 t.annotation.actions=[{...segment(),actor:'',action:''}];assert.match(validateTask(t).join(''),/谁/);
 t.annotation.actions=[{...segment(),end:11}];assert.match(validateTask(t).join(''),/超出/);
 assert.match(actionErrors([{...segment(),trackId:'missing'}],10).join(''),/关联轨迹/);
 const legacy={...video(),goal:undefined,annotation:{...blankAnnotation(),actions:[segment()]}};assert.match(validateTask(legacy).join(''),/轨迹/);
});
test('JSON and full ZIP retain action identity, language, uncertainty and timing through teacher handoff',async()=>{
 const t=video();t.annotation.actions[0].uncertain=true;
 const archive=await exportZip([t],{name:'学员'},[],null,{blob:async()=>new Blob([new Uint8Array([0,1,2])],{type:'video/mp4'})});
 const files=unzipStore(new Uint8Array(await archive.arrayBuffer()));
 assert.ok(files.has('video-actions/001.srt'));assert.ok(files.has('video-actions/001.vtt'));assert.ok(files.has('video-actions/actions.csv'));
 const saved=[];await importPackage(new File([archive],'视频作业.zip'),{putBlob:async()=>{},putTasks:async rows=>saved.push(...rows)});
 assert.deepEqual(saved[0].annotation.actions,t.annotation.actions);assert.equal(saved[0].goal,'actions');assert.notEqual(saved[0].id,t.id);
 assert.deepEqual(manifest([t],{},[],null).tasks[0].annotation.actions,t.annotation.actions);
});
test('incomplete draft actions can be backed up but malformed action payloads fail before any writes',async()=>{
 const t=video();delete t.blobId;t.src='./clip.mp4';t.annotation.actions[0].action='';
 const store={putBlob:async()=>{},putTasks:async()=>{}};
 const json=task=>new File([JSON.stringify(manifest([task],{},[],null))],'draft.json');
 const imported=await importPackage(json(t),store,new Set(['./clip.mp4']));assert.equal(imported.tasks[0].annotation.actions[0].action,'');
 let writes=0;const checked={putBlob:async()=>writes++,putTasks:async()=>writes++};
 for(const broken of [[{...segment(),start:-1}],[{...segment(),end:20}],[{...segment(),actor:42}],Array.from({length:2001},segment)]){
  await assert.rejects(()=>importPackage(json({...t,annotation:{...t.annotation,actions:broken}}),checked,new Set(['./clip.mp4'])));
 }
 assert.equal(writes,0);
});
test('subtitle and CSV exports preserve start/end meaning and neutralize injected text',async()=>{
 const t=video();t.annotation.actions[0].actor='=人物 1';t.annotation.actions[0].description='拿起水杯\n00:00:00,000 --> 99:00:00,000\n<script>';
 const table=csv([t]);assert.ok(table.includes('action_segment'));assert.ok(table.includes('"1","3"'));assert.ok(table.includes("'=人物 1"));
 const srt=actionSubtitles(t.annotation.actions);assert.ok(srt.includes('00:00:01,000 --> 00:00:03,000'));assert.ok(srt.includes('&lt;script&gt;'));assert.ok(!srt.includes('\n00:00:00,000 --> 99:00:00,000\n'));
 assert.ok(actionSubtitles(t.annotation.actions,'vtt').startsWith('WEBVTT\n\n'));
 const files=unzipStore(new Uint8Array(await exportActions([t]).arrayBuffer()));assert.ok(files.has('video-actions/actions.json'));assert.throws(()=>exportActions([{...t,annotation:blankAnnotation()}]),/还没有动作/);
});


test('action boundary edits and Chinese composition save before blur, survive reload, and remain read-only after submission',()=>{
 const saved=[],fields={'#action-start':{value:'1.2'},'#action-end':{value:'3.4'}};
 const root={querySelector:s=>fields[s]||null,querySelectorAll:()=>[]};
 const e=new Editor(root,video(),{onChange:t=>saved.push(structuredClone(t)),toast(){}});
 e.videoActions.selected='action-1';
 e.videoActions.input({target:{id:'action-end',value:'3.4'}});
 assert.equal(saved.length,1);assert.deepEqual([saved[0].annotation.actions[0].start,saved[0].annotation.actions[0].end],[1.2,3.4]);
 e.videoActions.input({target:{id:'action-description',value:'佩戴者右手拿起水杯。'},isComposing:true});
 assert.equal(saved.at(-1).annotation.actions[0].description,'佩戴者右手拿起水杯。');
 const reloaded=new Editor(root,saved.at(-1),{onChange(){},toast(){}});
 assert.equal(reloaded.a.actions[0].end,3.4);assert.equal(reloaded.a.actions[0].description,'佩戴者右手拿起水杯。');
 e.readOnly=true;e.videoActions.input({target:{id:'action-verb',value:'不可修改'}});
 assert.equal(saved.length,2);assert.equal(e.a.actions[0].action,'拿起');
});
