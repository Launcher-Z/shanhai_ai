// 原文方位保留为文字资料；九宫格和内部紧凑排布服务于探索与课时解锁。
const vectors = {东:[1,0],西:[-1,0],南:[0,1],北:[0,-1],东南:[.707,.707],东北:[.707,-.707],西南:[-.707,.707],西北:[-.707,-.707]};
export const HALF = 29;
export function hash(x,z=0,salt=0){ const n=Math.sin(x*127.1+z*311.7+salt*74.7)*43758.5453;return n-Math.floor(n); }
const mix=(a,b,t)=>a+(b-a)*t;
export function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v)*2-1;}
export function layoutRange(range){
  let x=0,z=0;
  return range.mountains.map((record,index)=>{
    if(index){const vector=vectors[record.direction]||[1,0];const distance=24+Math.sqrt(record.li||250)*.45;x+=vector[0]*distance;z+=vector[1]*distance;}
    const flow=record.text.match(/([东西南北]{1,2})流(?:注|入)/);
    return {...record,index,x,z,seed:hash(index,range.id.length,record.name.codePointAt(0)),bare:/无草木|无草、多水/.test(record.text),flow:flow?vectors[flow[1]]:null,terrace:/四方而三坛/.test(record.text)};
  });
}
export const PALETTES={
  south:{name:'苔青',accent:'#64815f',low:[.68,.75,.59],high:[.29,.40,.29]},
  west:{name:'淡赭',accent:'#9c7652',low:[.78,.70,.56],high:[.45,.36,.28]},
  north:{name:'青黛',accent:'#5f7c87',low:[.60,.69,.72],high:[.26,.33,.40]},
  east:{name:'水碧',accent:'#4e8b83',low:[.61,.76,.72],high:[.25,.44,.43]},
  central:{name:'苍石',accent:'#858069',low:[.73,.72,.63],high:[.39,.41,.34]}
};

export const ZONE_SIZE=160;
// 九域是教学交互分区，编号预留给课时；原文山系不拆开，也不重复山名。
const ZONES=[
  {id:'south',name:'南境',row:2,col:1,lesson:1,book:'south',ranges:[0,1,2]},
  {id:'central-middle',name:'中山·西南',row:2,col:0,lesson:2,book:'central',ranges:[6,7,8]},
  {id:'west-later',name:'西山·后段',row:1,col:0,lesson:3,book:'west',ranges:[2,3]},
  {id:'west-first',name:'西山·前段',row:0,col:0,lesson:4,book:'west',ranges:[0,1]},
  {id:'north-first',name:'北山·前段',row:0,col:1,lesson:5,book:'north',ranges:[0,1]},
  {id:'north-later',name:'北山·后段',row:0,col:2,lesson:6,book:'north',ranges:[2]},
  {id:'east',name:'东境',row:1,col:2,lesson:7,book:'east',ranges:[0,1,2,3]},
  {id:'central-later',name:'中山·东南',row:2,col:2,lesson:8,book:'central',ranges:[9,10,11]},
  {id:'central-first',name:'中山·中境',row:1,col:1,lesson:9,book:'central',ranges:[0,1,2,3,4,5]}
];
export function layoutWorld(books){
  const nodes=[],zones=[];
  for(const zone of ZONES){
    const book=books.find(b=>b.id===zone.book),records=[];
    for(const rangeIndex of zone.ranges){const range=book.ranges[rangeIndex];for(const node of layoutRange(range))records.push({...node,rangeIndex:node.index,rangeId:range.id,rangeName:range.name,rangeLength:range.mountains.length,bookId:book.id,bookName:book.name,source:book.source});}
    const columns=Math.ceil(Math.sqrt(records.length)),rows=Math.ceil(records.length/columns);
    const centerX=(zone.col-1)*ZONE_SIZE,centerZ=(zone.row-1)*ZONE_SIZE;
    const width=138,height=138;
    records.forEach((record,i)=>{
      const row=Math.floor(i/columns),column=row%2?columns-1-i%columns:i%columns;
      const x=centerX-width/2+column*width/Math.max(1,columns-1),z=centerZ-height/2+row*height/Math.max(1,rows-1);
      nodes.push({...record,x,z,index:nodes.length,zoneId:zone.id,zoneName:zone.name,zoneLesson:zone.lesson});
    });
    zones.push({...zone,x:centerX,z:centerZ,first:records[0].id,count:records.length});
  }
  return {nodes,start:nodes[0],zones,books:books.map(book=>{const subset=nodes.filter(n=>n.bookId===book.id);return {id:book.id,name:book.name,first:subset[0].id,center:[subset.reduce((s,n)=>s+n.x,0)/subset.length,subset.reduce((s,n)=>s+n.z,0)/subset.length]};}),bounds:{minX:-240,maxX:240,minZ:-240,maxZ:240}};
}

export function unlockedLimit(nodes,lesson){let last=-1;for(const node of nodes)if(node.zoneLesson<=lesson)last=node.index;return last;}
export function zoneAt(x,z){const col=Math.floor((x+240)/ZONE_SIZE),row=Math.floor((z+240)/ZONE_SIZE);return ZONES.find(zone=>zone.col===col&&zone.row===row);}

export function paletteInfluences(nodes,center){
  const candidates=new Map();
  for(const node of nodes){const key=node.zoneId||node.bookId;const d=(node.x-center.x)**2+(node.z-center.z)**2;if(!candidates.has(key)||d<candidates.get(key).distance)candidates.set(key,{...node,distance:d});}
  return [...candidates.values()];
}
export function regionColor(x,z,influences,shade){
  const distances=influences.map(n=>Math.hypot(x-n.x,z-n.z)),min=Math.min(...distances),color=[0,0,0];let total=0;
  for(let i=0;i<influences.length;i++){
    const palette=PALETTES[influences[i].bookId]||PALETTES.south,weight=Math.exp(-(distances[i]-min)/14);
    const variation=influences[i].zoneLesson?((influences[i].zoneLesson%3)-1)*.018:0;
    total+=weight;for(let c=0;c<3;c++)color[c]+=(mix(palette.low[c],palette.high[c],shade)+variation)*weight;
  }
  return color.map(c=>c/total);
}
export function nearest(nodes,x,z){let best=nodes[0],distance=Infinity;for(const node of nodes){const d=(node.x-x)**2+(node.z-z)**2;if(d<distance){best=node;distance=d;}}return best;}
export function localNodes(nodes,center){return nodes.filter(n=>Math.abs(n.x-center.x)<HALF+35&&Math.abs(n.z-center.z)<HALF+35);}
export function terrainHeight(x,z,nodes){
  const rough=noise(x*.085,z*.085),fine=noise(x*.31,z*.31);
  let h=1.15+rough*.75+fine*.16;
  // 山系间以低矮山脊衔接，允许在写意大陆上连续游览。
  h+=Math.max(0,noise(x*.035,z*.035)-.12)*3.3;
  for(const node of nodes){
    const dx=(x-node.x),dz=(z-node.z),rotation=node.seed*2.4;
    const distance=Math.hypot(dx,dz);
    if(distance>=36)continue;
    const u=dx*Math.cos(rotation)-dz*Math.sin(rotation),v=dx*Math.sin(rotation)+dz*Math.cos(rotation);
    const r=(u/10.5)**2+(v/8.2)**2;
    const peak=Math.exp(-r*.58)*(10+node.seed*8);
    const ridges=(1-Math.abs(noise(x*.18+node.seed*30,z*.18)))*2.6;
    let mountain=peak*(.69+ridges*.13)+Math.exp(-(((u-8)/6)**2+(v/13)**2))*3;
    if(node.terrace)mountain=Math.round(mountain/3)*3;
    h+=mountain*Math.min(1,(36-distance)/6);
  }
  // 水道仅在原文明确记有水流的山域附近出现，弯曲形状为美术演绎。
  for(const node of nodes){
    if(!node.flow)continue;
    const dx=x-node.x,dz=z-node.z,[vx,vz]=node.flow;
    const along=dx*vx+dz*vz;
    if(along<2||along>40)continue;
    const across=-dx*vz+dz*vx-Math.sin(along*.17+node.seed*7)*2.1;
    const channel=Math.exp(-(across*across)/3.8)*Math.min(1,(along-2)/6);
    h=mix(h,-.45,channel*.98);
  }
  return Math.max(-.6,h);
}

// 只生成当前切块；场景大小不随全书条目数量增长。
export function sampleTerrain(center,nodes,resolution){
  const positions=new Float32Array((resolution+1)**2*3),colors=new Float32Array(positions.length),heights=new Float32Array((resolution+1)**2);
  const local=localNodes(nodes,center),step=HALF*2/resolution,influences=paletteInfluences(nodes,center);
  for(let z=0;z<=resolution;z++)for(let x=0;x<=resolution;x++){
    const i=z*(resolution+1)+x,wx=center.x+x*step-HALF,wz=center.z+z*step-HALF,h=terrainHeight(wx,wz,local);
    heights[i]=h;positions.set([x*step-HALF,h,z*step-HALF],i*3);
    const shade=Math.min(1,h/18),grain=noise(wx*.67,wz*.67)*.035;
    const tint=regionColor(wx,wz,influences,shade);colors.set(tint.map(c=>c+grain),i*3);
    if(h<.55)colors.set(tint.map((c,index)=>mix(c,[.73,.80,.76][index],.65)+grain),i*3);
  }
  const sides=[];
  for(let edge=0;edge<4;edge++)for(let i=0;i<resolution;i++){
    const point=j=>edge===0?[j*step-HALF,-HALF,j]:edge===1?[HALF,j*step-HALF,j*(resolution+1)+resolution]:edge===2?[j*step-HALF,HALF,resolution*(resolution+1)+j]:[-HALF,j*step-HALF,j*(resolution+1)];
    const [x1,z1,a]=point(i),[x2,z2,b]=point(i+1),h1=heights[a],h2=heights[b];
    sides.push(x1,h1,z1,x1,-5,z1,x2,h2,z2,x2,h2,z2,x1,-5,z1,x2,-5,z2);
  }
  return {positions,colors,heights,sides:new Float32Array(sides),local,step,influences};
}

// 等高线以少量线段模拟皴线，免去全屏后期处理。
export function contourLines(sample,resolution){
  const out=[],{heights,step}=sample;
  for(const level of [1.8,3.6,5.8,8.5,11.5,15])for(let z=0;z<resolution;z+=2)for(let x=0;x<resolution;x+=2){
    const corners=[[x,z],[x+2,z],[x+2,z+2],[x,z+2]],points=[];
    for(let e=0;e<4;e++){
      const [ax,az]=corners[e],[bx,bz]=corners[(e+1)%4];
      const a=heights[az*(resolution+1)+ax],b=heights[bz*(resolution+1)+bx];
      if((a<level)===(b<level))continue;
      const t=(level-a)/(b-a);points.push([mix(ax,bx,t)*step-HALF,level+.035,mix(az,bz,t)*step-HALF]);
    }
    for(let i=0;i+1<points.length;i+=2)out.push(...points[i],...points[i+1]);
  }
  return new Float32Array(out);
}
