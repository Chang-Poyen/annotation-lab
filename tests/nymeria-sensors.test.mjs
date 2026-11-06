import test from 'node:test';
import assert from 'node:assert/strict';
import {IMU_SCHEMA,isNymeriaSensorTask,validateSensorData,sampleIndex,sensorPiece,sensorTimeAt,visibleSensorRange} from '../dist/imu-model.js';
import {blankAnnotation,refreshBuiltinMetadata} from '../dist/core.js';
import {Editor} from '../dist/editor.js';
import {NymeriaSensors} from '../dist/nymeria-sensors.js';
import {exportZip,importPackage,unzipStore,zipStore,manifest} from '../dist/io.js';

const sensor=()=>({schema:IMU_SCHEMA,version:1,duration:8,pieces:[{clipId:'0003',start:0,end:3},{clipId:'0004',start:3,end:8}],raw:{sensorNames:['左手','右手','左小腿','右小腿','头部','骨盆'],times:[0,1,2,3,4,5,6,7],values:Array.from({length:8},(_,i)=>Array.from({length:18},(_,j)=>i+j))},encoded:{times:[0,2,3,5,7],values:Array.from({length:5},(_,i)=>[i,.5,1,2])},encoder:{name:'Trained TCN fixture',trained:true,checkpointSha256:'a'.repeat(64)}});
const task=()=>({id:'day2-nymeria-test',type:'video',dataset:'Nymeria',project:'video-nymeria',name:'感测器测试',duration:8,fps:10,width:720,height:720,status:'draft',annotation:blankAnnotation(),history:[],blobId:'video',sensorBlobId:'sensor'});

test('sensor UI is restricted to Nymeria tasks and leaves other image/video editors unchanged',()=>{
 const root={querySelector(){return null},querySelectorAll(){return []}},ctx={onChange(){},toast(){}};
 const ny=task();assert.equal(isNymeriaSensorTask(ny),true);assert.ok(new Editor(root,ny,ctx).stage().includes('nymeria-sensors'));
 for(const t of [{...ny,project:'video',dataset:'Original'},{...ny,project:'video-ego',dataset:'CaptainCook4D'},{...ny,type:'image'},{...ny,sensorBlobId:undefined}]){
  assert.equal(isNymeriaSensorTask(t),false);const e=new Editor(root,t,ctx);assert.equal(e.nymeriaSensors,undefined);assert.ok(!e.stage().includes('nymeria-sensors'));
 }
});
test('sensor metadata upgrades append references without modifying learner work, categories or review history',()=>{
 const old={...task(),blobId:undefined,sensorBlobId:undefined,status:'submitted',customLabels:[{id:'custom-a',name:'自定类别',color:'#123456'}],history:[{action:'submit'}],review:{comment:'保留意见'}};
 old.annotation.notes='原有备注';old.annotation.actions=[{id:'a',start:1,end:2,actor:'人物',action:'转身'}];
 const seed={...old,sensorSrc:'./nymeria-sensors/one.json',sensorSummary:{dimensions:16}};
 const updated=refreshBuiltinMetadata(old,seed);assert.equal(updated.sensorSrc,seed.sensorSrc);assert.deepEqual(updated.annotation,old.annotation);assert.deepEqual(updated.customLabels,old.customLabels);assert.deepEqual(updated.review,old.review);assert.deepEqual(updated.history,old.history);assert.equal(updated.status,'submitted');
 assert.equal(refreshBuiltinMetadata({...old,blobId:'private'},seed).sensorSrc,undefined);
});
test('sensor payload validation rejects non-finite data, malformed dimensions, overlaps and untrained feature provenance',()=>{
 assert.equal(validateSensorData(sensor(),8).duration,8);
 for(const mutate of [d=>d.raw.values[0].pop(),d=>d.raw.values[0][0]=Infinity,d=>d.raw.times[2]=-1,d=>d.pieces[1].start=2,d=>d.encoded.values[0].push(2),d=>d.encoder.trained=false,d=>d.encoder.checkpointSha256='fake']){
  const d=sensor();mutate(d);assert.throws(()=>validateSensorData(d,8),/感测器资料无效/);
 }
 assert.throws(()=>validateSensorData(sensor(),20),/时长/);
});
test('piecewise timing does not stretch shorter source clips over the whole concatenated video',()=>{
 const d=sensor();assert.equal(sensorPiece(d,2.999).clipId,'0003');assert.equal(sensorPiece(d,3).clipId,'0004');assert.equal(sensorPiece(d,8),null);
 assert.equal(sampleIndex(d.raw.times,3),3);assert.equal(sampleIndex(d.raw.times,2.8),2);
 assert.deepEqual(visibleSensorRange(20,2,5),{start:0,end:5});assert.deepEqual(visibleSensorRange(20,19,5),{start:15,end:20});
 assert.equal(sensorTimeAt(150,{left:100,width:100},{start:3,end:8}),5.5);
});
test('full ZIP keeps paired IMU and encoded features through offline handoff and rejects malformed sensors before writes',async()=>{
 const t=task(),data=sensor(),blobs={video:new Blob(['fixture-video'],{type:'video/mp4'}),sensor:new Blob([JSON.stringify(data)],{type:'application/json'})};
 const zip=await exportZip([t],{},[],null,{blob:async id=>blobs[id]});const files=unzipStore(new Uint8Array(await zip.arrayBuffer()));
 assert.ok(files.has('sensors/001.json'));const packaged=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));assert.equal(packaged.tasks[0].packageSensor,'sensors/001.json');assert.equal(packaged.tasks[0].sensorBlobId,undefined);
 const saved=[],savedBlobs=[];await importPackage(new File([zip],'handoff.zip'),{putBlob:async(id,blob)=>savedBlobs.push({id,blob}),putTasks:async ts=>saved.push(...ts)});
 assert.ok(saved[0].sensorBlobId);assert.equal(isNymeriaSensorTask(saved[0]),true);assert.deepEqual(JSON.parse(await savedBlobs.find(b=>b.id===saved[0].sensorBlobId).blob.text()),data);
 let writes=0;const broken=sensor();broken.encoder.trained=false;const modified=[...files].map(([name,data])=>({name,data:name==='sensors/001.json'?JSON.stringify(broken):data}));await assert.rejects(()=>importPackage(new File([zipStore(modified)],'bad-sensors.zip'),{putBlob:async()=>writes++,putTasks:async()=>writes++}),/已训练编码器/);assert.equal(writes,0);const forged=manifest([t],{},[],null);forged.tasks[0].src='./video.mp4';delete forged.tasks[0].blobId;
 await assert.rejects(()=>importPackage(new File([JSON.stringify(forged)],'unsafe.json'),{putBlob:async()=>writes++,putTasks:async()=>writes++},new Set(['./video.mp4'])),/缺少配套感测器/);assert.equal(writes,0);
});

test('sensor graph follows playback, switches raw axes, seeks video in read-only mode and shades the selected action',()=>{
 const attributes={},rects=[],context={scale(){},fillRect(...v){rects.push(v)},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){}};
 const elements={canvas:{style:{},getContext:()=>context},'.ns-chart':{clientWidth:600,setAttribute:(k,v)=>attributes[k]=v},'.ns-cursor':{style:{}},'.ns-ruler':{innerHTML:''},'.ns-action-shading':{innerHTML:''},'.ns-readout':{textContent:''}};
 const e={task:task(),duration:8,dead:false,readOnly:true,mediaReady:true,media:{currentTime:4,pause(){this.paused=true}},videoActions:{current:{start:3,end:5},replayId:'x'},a:blankAnnotation()};
 const component=new NymeriaSensors(e);component.data=sensor();component.panel={querySelector:s=>elements[s]};component.computeBounds();e.updatePlayback=()=>component.update();
 component.draw();assert.ok(rects.length>10);assert.ok(rects.flat().every(Number.isFinite));assert.equal(elements['.ns-cursor'].style.left,'50%');assert.match(elements['.ns-readout'].textContent,/切片 0004/);assert.match(elements['.ns-action-shading'].innerHTML,/37.5%/);
 component.mode='raw';component.sensor=1;component.axes=new Set([0,2]);component.draw();assert.match(elements['.ns-readout'].textContent,/右手.*X 7.000.*Z 9.000/);
 const prior=structuredClone(e.a);component.seekTo(6);assert.equal(e.media.currentTime,6);assert.equal(e.media.paused,true);assert.equal(e.videoActions.replayId,null);assert.deepEqual(e.a,prior);assert.equal(attributes['aria-valuenow'],'6.000');
 component.windowSeconds=5;component.update();assert.ok(component.lastWindow);component.abort.abort();
});
