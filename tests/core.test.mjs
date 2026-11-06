import test from 'node:test';
import assert from 'node:assert/strict';
import {boxAt,setKeyframe,blankAnnotation,validateTask,reviewStats,mergeHistory,uid,labelsForTask} from '../dist/core.js';
import {zipStore,unzipStore,crc32,manifest,importPackage,coco,csv,exportZip} from '../dist/io.js';
const box={x:.1,y:.2,w:.2,h:.3};
test('video interpolation respects object ID, exact keyframes and outside intervals',()=>{
 const tr={id:'same',keyframes:[{frame:0,box},{frame:12,box:{x:.5,y:.4,w:.4,h:.3}}]};
 assert.ok(Math.abs(boxAt(tr,6).x-.3)<1e-10);assert.equal(boxAt(tr,12).x,.5);assert.equal(boxAt(tr,-1),null);
 setKeyframe(tr,6,{...box,x:.3},{outside:true});assert.equal(boxAt(tr,6),null);assert.equal(boxAt(tr,9),null);assert.equal(boxAt(tr,12).x,.5);
 setKeyframe(tr,6,{...box,x:.4},{outside:false});assert.equal(tr.keyframes.length,3);assert.equal(boxAt(tr,6).x,.4);
});
test('modality validation blocks empty or inconsistent submissions and accepts documented uncertainty',()=>{
 const t={type:'image',annotation:blankAnnotation()};assert.equal(validateTask(t).length,2);t.annotation.scene='桌面';t.annotation.boxes=[{...box,label:'bottle'}];assert.deepEqual(validateTask(t),[]);
 const audio={type:'audio',duration:8,annotation:{...blankAnnotation(),segments:[{start:2,end:9,text:'转写'}]}};assert.ok(validateTask(audio).length);audio.annotation.segments[0].end=5;assert.deepEqual(validateTask(audio),[]);
 const video={type:'video',fps:12,annotation:{...blankAnnotation(),tracks:[{keyframes:[{frame:0,box}]}]}};assert.ok(validateTask(video).length);video.annotation.tracks[0].keyframes.push({frame:12,box});assert.deepEqual(validateTask(video),[]);
 const text={type:'text',goal:'entities',text:'明天到上海',annotation:{...blankAnnotation(),entities:[{start:3,end:5,text:'上海',label:'location'}]}};assert.deepEqual(validateTask(text),[]);text.annotation.entities[0].start=2;assert.ok(validateTask(text).length);
 t.annotation.uncertain=true;t.annotation.issue='画面模糊，无法确认类别';assert.deepEqual(validateTask(t),[]);
});
test('ZIP round-trips Unicode file names and binary media with CRC verification',async()=>{
 const archive=zipStore([{name:'说明.txt',data:'你好，培训。'},{name:'media/a.wav',data:new Uint8Array([0,1,2,255])}]);const bytes=new Uint8Array(await archive.arrayBuffer()),files=unzipStore(bytes);
 assert.equal(new TextDecoder().decode(files.get('说明.txt')),'你好，培训。');assert.deepEqual([...files.get('media/a.wav')],[0,1,2,255]);assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 bytes[30+new TextEncoder().encode('说明.txt').length]^=1;assert.throws(()=>unzipStore(bytes));
});
test('complete package import preserves annotations/review and restores embedded media without overwriting records',async()=>{
 const task={id:'a1',project:'images',type:'image',name:'图像样本',width:100,height:80,blobId:'m1',status:'submitted',annotation:{...blankAnnotation(),scene:'桌面',boxes:[{id:'b1',...box,label:'bottle'}]},history:[{action:'submit',note:'已提交'}],truth:{privateAnswer:true}};
 const profile={name:'测试学员',group:'A组'},media=new Blob([new Uint8Array([0,1,2])],{type:'image/png'});
 const blob=await exportZip([task],profile,['lesson-1'],null,{blob:async()=>media});const saved=[],blobs=[];
 const result=await importPackage(new File([blob],'作业.zip'),{putBlob:async(id,b)=>blobs.push([id,b]),putTasks:async rows=>saved.push(...rows)});
 assert.equal(result.count,1);assert.notEqual(saved[0].id,'a1');assert.equal(saved[0].sourceId,'a1');assert.equal(saved[0].annotation.boxes[0].label,'bottle');assert.equal(saved[0].status,'submitted');assert.equal(saved[0].originLearner,'测试学员');assert.equal(saved[0].truth,undefined);assert.equal(blobs.length,1);assert.equal(await blobs[0][1].arrayBuffer().then(x=>x.byteLength),3);
});
test('COCO exports original pixel coordinates and polygon area; CSV preserves entity offsets and neutralizes formulas',()=>{
 const t={id:'=unsafe',name:'image',type:'image',width:100,height:80,status:'draft',annotation:{...blankAnnotation(),boxes:[{id:'b1',label:'cup',...box,points:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}]}};
 const out=coco([t]);assert.deepEqual(out.annotations[0].bbox,[10,16,20,24]);assert.equal(out.annotations[0].area,4000);assert.ok(csv([t]).includes("'=unsafe"));
 const tx={id:'text1',name:'文本',type:'text',text:'上海',status:'draft',annotation:{...blankAnnotation(),entities:[{start:0,end:2,text:'上海',label:'location'}]}};assert.ok(csv([tx]).includes('start_char'));assert.ok(csv([tx]).includes('"0","2"'));
});
test('review proportion uses reviewed samples, and excludes unreviewed submissions',()=>{
 const r=reviewStats([{status:'approved'},{status:'rework'},{status:'submitted'},{status:'new'}]);assert.equal(r.checked,2);assert.equal(r.rate,.5);
});
test('continued draft saves preserve existing audit records and avoid duplicate history',()=>{
 const submit={at:'2026-11-03T08:00:00Z',action:'submit',note:'提交'},review={at:'2026-11-03T08:01:00Z',action:'return',note:'边界需修正'};
 assert.deepEqual(mergeHistory([submit,review],[submit]),[submit,review]);
 const next={at:'2026-11-03T08:02:00Z',action:'submit',note:'返修后提交'};assert.deepEqual(mergeHistory([submit,review],[submit,review,next]),[submit,review,next]);
});
test('annotation IDs work on HTTP origins without crypto.randomUUID',()=>{
 const id=uid('http',{getRandomValues:bytes=>bytes.fill(7)});assert.match(id,/^http-[0-9a-f]{24}$/);assert.equal(id,'http-'+'07'.repeat(12));
});
test('satellite buildings remain correctly labeled through validation, COCO and full ZIP handoff',async()=>{
 const task={id:'satellite-001',project:'satellite',type:'image',name:'房屋练习01.png',width:650,height:650,blobId:'satellite-media',status:'submitted',labelIds:['building'],sceneOptions:['卫星图像'],license:'CC BY-SA 4.0',sourceURL:'https://spacenet.ai/spacenet-buildings-dataset-v2/',annotation:{...blankAnnotation(),scene:'卫星图像',boxes:[{id:'house-1',label:'building',...box}]},history:[]};
 assert.deepEqual(labelsForTask(task).map(l=>l.id),['building']);assert.deepEqual(validateTask(task),[]);
 const wrong=structuredClone(task);wrong.annotation.boxes[0].label='cup';assert.ok(validateTask(wrong).length);
 const output=coco([task]);assert.equal(output.annotations[0].category_id,4);assert.equal(output.categories.find(c=>c.id===4).name,'building');
 const zip=await exportZip([task],{name:'房屋练习学员'},[],null,{blob:async()=>new Blob([new Uint8Array([1,2,3])],{type:'image/png'})});
 const saved=[];await importPackage(new File([zip],'卫星作业.zip'),{putBlob:async()=>{},putTasks:async rows=>saved.push(...rows)});
 assert.equal(saved[0].annotation.boxes[0].label,'building');assert.deepEqual(labelsForTask(saved[0]).map(l=>l.id),['building']);assert.equal(saved[0].annotation.scene,'卫星图像');assert.equal(saved[0].license,'CC BY-SA 4.0');
});
