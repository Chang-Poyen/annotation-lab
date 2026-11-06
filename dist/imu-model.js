export const IMU_SCHEMA='labelcamp.nymeria-imu';
export const isNymeriaSensorTask=t=>t?.type==='video'&&t.dataset==='Nymeria'&&['video-nymeria','imports'].includes(t.project)&&!!(t.sensorSrc||t.sensorBlobId);
export function validateSensorData(data,duration){
 const fail=message=>{throw new Error('感测器资料无效：'+message)};
 if(!data||data.schema!==IMU_SCHEMA||data.version!==1||!(data.duration>0)||!Number.isFinite(data.duration))fail('格式不支持');
 if(duration&&Math.abs(duration-data.duration)>.15)fail('与视频时长不匹配');
 if(!Array.isArray(data.pieces)||!data.pieces.length||data.pieces.length>200)fail('缺少来源切片');
 let end=0;
 for(const p of data.pieces){if(!p||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<end-.001||p.end<=p.start||p.end>data.duration+.001||typeof p.clipId!=='string')fail('切片时间范围错误');end=p.end}
 const matrix=(value,maxDims)=>{
  if(!value||!Array.isArray(value.times)||!Array.isArray(value.values)||!value.times.length||value.times.length>20000||value.times.length!==value.values.length)fail('采样数错误');
  const dims=value.values[0]?.length;if(!(dims>0&&dims<=maxDims))fail('通道数错误');
  let prior=-1;
  for(let i=0;i<value.times.length;i++){const t=value.times[i],row=value.values[i];if(!Number.isFinite(t)||t<0||t>=data.duration+.001||t<prior||!Array.isArray(row)||row.length!==dims||row.some(v=>!Number.isFinite(v)))fail('采样值或时间无效');prior=t}
  return dims;
 };
 const rawDims=matrix(data.raw,18);
 if(rawDims!==18||!Array.isArray(data.raw.sensorNames)||data.raw.sensorNames.length!==6||data.raw.sensorNames.some(x=>typeof x!=='string'||x.length>60))fail('需包含六部位三轴加速度');
 if(data.encoded){matrix(data.encoded,256);if(!data.encoder||typeof data.encoder.name!=='string'||data.encoder.name.length>200||!data.encoder.checkpointSha256?.match(/^[0-9a-f]{64}$/)||data.encoder.trained!==true)fail('缺少已训练编码器的来源')}
 return data;
}
export function sampleIndex(times,t){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<=t)lo=mid+1;else hi=mid}return Math.max(0,lo-1)}
export function sensorPiece(data,t){return data.pieces.find(p=>t>=p.start&&t<p.end)||null}
export function visibleSensorRange(duration,now,windowSeconds){if(!windowSeconds||windowSeconds>=duration)return {start:0,end:duration};const width=Math.min(windowSeconds,duration),start=Math.max(0,Math.min(duration-width,now-width/2));return {start,end:start+width}}
export function robustBounds(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [-1,1];const lo=sorted[Math.floor((sorted.length-1)*.02)],hi=sorted[Math.ceil((sorted.length-1)*.98)];return hi-lo>1e-8?[lo,hi]:[lo-1,hi+1]}
export function sensorTimeAt(clientX,rect,range){return range.start+Math.max(0,Math.min(1,(clientX-rect.left)/rect.width))*(range.end-range.start)}
