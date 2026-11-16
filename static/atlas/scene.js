import * as THREE from './vendor/three.module.js';
import {HALF,hash,nearest,localNodes,terrainHeight,sampleTerrain,contourLines,regionColor,zoneAt} from './terrain.js';

// 地形使用“世界坐标减视野中心”定位，因此视野中心沿拖动的反方向移动。
// 相机上方向投影到地面会缩短，除以投影长度平方，才能让上下拖动跟手。
export function panDelta(dx,dy,matrix,unit){
  const m=matrix.elements;
  const vertical=m[4]*m[4]+m[6]*m[6];
  return [(-dx*m[0]+dy*m[4]/vertical)*unit,(-dx*m[2]+dy*m[6]/vertical)*unit];
}

// 窗口内地形与树石共享几何体；交互时合并更新，静止时不持续绘制。
export class MountainScene {
  constructor(mount,labels,onMove,onBoundary){
    this.mount=mount;this.labels=labels;this.onMove=onMove;this.onBoundary=onBoundary;
    this.center={x:0,z:0};this.nodes=[];this.maxIndex=0;this.zoom=1;this.angle=.76;this.elevation=.69;this.mode='pan';this.resolution=48;this.pointers=new Map();this.abort=new AbortController();
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setClearColor(0,0);this.renderer.setPixelRatio(Math.min(devicePixelRatio,1));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','三维山海图。方向键探索，加减键缩放，Home 复位。');mount.prepend(canvas);
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,300);
    this.scene.add(new THREE.HemisphereLight(0xfff9e8,0x485a4b,2.2));const sun=new THREE.DirectionalLight(0xfff4d8,1.15);sun.position.set(-35,60,20);this.scene.add(sun);
    this.land=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));this.scene.add(this.land);
    this.sides=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshLambertMaterial({color:0x788475,side:THREE.DoubleSide}));this.scene.add(this.sides);
    this.ink=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x3e5147,transparent:true,opacity:.24}));this.scene.add(this.ink);
    this.routeLine=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x8a6c4d,transparent:true,opacity:.4}));this.scene.add(this.routeLine);
    this.water=new THREE.Mesh(new THREE.PlaneGeometry(HALF*2,HALF*2),new THREE.MeshBasicMaterial({color:0xaec7bb,opacity:.54,transparent:true,depthWrite:false,side:THREE.DoubleSide}));this.water.rotation.x=-Math.PI/2;this.water.position.y=.14;this.scene.add(this.water);
    this.trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.06,.14,1,5),new THREE.MeshLambertMaterial({color:0x556357}),150);
    this.crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshLambertMaterial({color:0x506652,flatShading:true}),150);
    this.rocks=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshLambertMaterial({color:0x737b6a,flatShading:true}),45);
    for(const mesh of [this.trunks,this.crowns,this.rocks]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.scene.add(mesh);}
    const paper=document.createElement('canvas');paper.width=128;paper.height=128;const ctx=paper.getContext('2d');const wash=ctx.createRadialGradient(64,64,3,64,64,64);wash.addColorStop(0,'rgba(242,240,220,.72)');wash.addColorStop(.5,'rgba(237,238,217,.3)');wash.addColorStop(1,'rgba(239,239,220,0)');ctx.fillStyle=wash;ctx.fillRect(0,0,128,128);
    this.mistTexture=new THREE.CanvasTexture(paper);this.mists=[];
    for(let i=0;i<5;i++){const mist=new THREE.Sprite(new THREE.SpriteMaterial({map:this.mistTexture,transparent:true,opacity:.5,depthWrite:false}));mist.position.set(-22+i*11,3.8+i%2*2,-8+(i%3)*9);mist.scale.set(25,9,1);this.mists.push(mist);this.scene.add(mist);}
    this.bindInput();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(mount);this.resize();
  }
  setRange(nodes,maxIndex){this.nodes=nodes;this.maxIndex=maxIndex;this.center={x:nodes[0].x,z:nodes[0].z};this.location=null;this.bounds={minX:Math.min(...nodes.map(n=>n.x))-28,maxX:Math.max(...nodes.map(n=>n.x))+28,minZ:Math.min(...nodes.map(n=>n.z))-28,maxZ:Math.max(...nodes.map(n=>n.z))+28};this.rebuild();}
  setProgress(maxIndex){this.maxIndex=maxIndex;const zone=zoneAt(this.center.x,this.center.z);if(!zone||zone.lesson>this.nodes[maxIndex].zoneLesson)this.center={x:this.nodes[maxIndex].x,z:this.nodes[maxIndex].z};this.rebuild();}
  frame(){this.camera.position.set(Math.sin(this.angle)*80*Math.cos(this.elevation),Math.sin(this.elevation)*80,Math.cos(this.angle)*80*Math.cos(this.elevation));this.camera.lookAt(0,2,0);this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();}
  resize(){const w=this.mount.clientWidth,h=this.mount.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);const aspect=w/h;this.camera.left=-32*aspect;this.camera.right=32*aspect;this.camera.top=32;this.camera.bottom=-32;this.frame();this.render();}
  render(){if(this.disposed||document.hidden)return;this.frame();this.renderer.render(this.scene,this.camera);this.updateLabels();}
  schedule(){if(this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=null;const now=performance.now();if(now-(this.lastBuild||0)<42){this.schedule();return;}this.lastBuild=now;this.rebuild(this.pointers.size>0);});}
  move(dx,dz){
    if(!this.nodes.length)return;
    const x=this.center.x+dx,z=this.center.z+dz;
    const zone=zoneAt(x,z),lesson=this.nodes[this.maxIndex].zoneLesson;
    if(!zone||zone.lesson>lesson){this.onBoundary('前方区域未开放，继续学习后可探索。');return;}
    // 整片大陆内可自由探索，不再被单条山系的游览半径截断。
    if(x<this.bounds.minX||x>this.bounds.maxX||z<this.bounds.minZ||z>this.bounds.maxZ)return;
    this.center={x,z};this.onBoundary('');this.schedule();
  }
  jump(index){if(index>this.maxIndex)return;this.center={x:this.nodes[index].x,z:this.nodes[index].z};this.location=this.nodes[index];this.onBoundary('');this.rebuild();}
  zoomBy(factor){this.zoom=THREE.MathUtils.clamp(this.zoom*factor,.7,1.65);this.render();}
  panPixels(dx,dy){this.camera.updateMatrixWorld();const unit=64/this.mount.clientHeight/this.zoom;this.move(...panDelta(dx,dy,this.camera.matrixWorld,unit));}
  home(){this.angle=.76;this.elevation=.69;this.zoom=1;this.jump(0);}
  replaceGeometry(mesh,geometry){mesh.geometry.dispose();mesh.geometry=geometry;}
  rebuild(moving=false){
    if(!this.nodes.length||this.disposed)return;
    const resolution=48;
    const sample=sampleTerrain(this.center,this.nodes.slice(0,this.maxIndex+1),resolution),geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(sample.positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(sample.colors,3));
    const indices=[];for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){const a=z*(resolution+1)+x,b=a+resolution+1;indices.push(a,b,a+1,a+1,b,b+1);}geometry.setIndex(indices);geometry.computeVertexNormals();this.replaceGeometry(this.land,geometry);
    const side=new THREE.BufferGeometry();side.setAttribute('position',new THREE.BufferAttribute(sample.sides,3));side.computeVertexNormals();this.replaceGeometry(this.sides,side);
    const contour=new THREE.BufferGeometry();contour.setAttribute('position',new THREE.BufferAttribute(contourLines(sample,resolution),3));this.replaceGeometry(this.ink,contour);
    const local=sample.local;this.updatePlants(local);this.updateRoute(local);
    const zone=zoneAt(this.center.x,this.center.z);
    const candidates=zone?this.nodes.filter(n=>n.zoneId===zone.id):this.nodes;
    const candidate=nearest(candidates,this.center.x,this.center.z),old=this.location;
    // 在交界附近保留三单位迟滞，避免山名随着微小手抖反复切换。
    if(!old||old.zoneId!==candidate.zoneId||old.index>this.maxIndex||Math.hypot(candidate.x-this.center.x,candidate.z-this.center.z)+3<Math.hypot(old.x-this.center.x,old.z-this.center.z))this.location=candidate;
    if(!this.location)this.location=candidate;
    const tint=regionColor(this.center.x,this.center.z,sample.influences,.65);
    this.crowns.material.color.setRGB(...tint);this.sides.material.color.setRGB(...tint.map(c=>c*.88));
    this.water.material.color.setRGB(...tint.map(c=>c*.3+.54));
    this.onMove(this.location,this.center);this.render();
  }
  updatePlants(local){
    const dummy=new THREE.Object3D();let treeCount=0,rockCount=0;
    for(let iz=-5;iz<=5;iz++)for(let ix=-5;ix<=5;ix++){
      const gx=Math.floor(this.center.x/5)+ix,gz=Math.floor(this.center.z/5)+iz;
      const wx=gx*5+hash(gx,gz)*3,wz=gz*5+hash(gx,gz,8)*3,x=wx-this.center.x,z=wz-this.center.z;
      if(Math.abs(x)>HALF-1||Math.abs(z)>HALF-1)continue;
      const node=nearest(local.length?local:this.nodes,wx,wz),h=terrainHeight(wx,wz,local);
      if(node.index>this.maxIndex||h<.7)continue;
      if(!node.bare&&h<12&&hash(gx,gz,3)>.28){
        const size=.8+hash(gx,gz,12)*1.1;
        dummy.position.set(x,h+size*.6,z);dummy.rotation.set(0,hash(gx,gz)*6,0);dummy.scale.set(.9,size*1.2,.9);dummy.updateMatrix();this.trunks.setMatrixAt(treeCount,dummy.matrix);
        dummy.position.y=h+size*1.6;dummy.scale.set(size*1.1,size*.47,size*.85);dummy.updateMatrix();this.crowns.setMatrixAt(treeCount++,dummy.matrix);
      }else if(rockCount<45&&hash(gx,gz,9)>.5){dummy.position.set(x,h+.25,z);dummy.rotation.set(.2,hash(gx,gz)*5,.3);dummy.scale.set(1.2,.8,1);dummy.updateMatrix();this.rocks.setMatrixAt(rockCount++,dummy.matrix);}
    }
    for(const [mesh,count]of [[this.trunks,treeCount],[this.crowns,treeCount],[this.rocks,rockCount]]){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;}
  }
  updateRoute(local){
    const points=[],ranges=new Map();
    for(const node of this.nodes){const key=node.rangeId||'single';if(!ranges.has(key))ranges.set(key,[]);ranges.get(key).push(node);}
    for(const nodes of ranges.values()){
    nodes.sort((a,b)=>(a.rangeIndex??a.index)-(b.rangeIndex??b.index));
    for(let i=0;i<nodes.length-1;i++){
      const a=nodes[i],b=nodes[i+1];if(a.index>this.maxIndex||b.index>this.maxIndex)continue;
      if(Math.min(a.x,b.x)>this.center.x+HALF||Math.max(a.x,b.x)<this.center.x-HALF||Math.min(a.z,b.z)>this.center.z+HALF||Math.max(a.z,b.z)<this.center.z-HALF)continue;
      for(let j=0;j<20;j++){
        const segment=[];
        for(const t of [j/20,(j+1)/20]){const x=THREE.MathUtils.lerp(a.x,b.x,t),z=THREE.MathUtils.lerp(a.z,b.z,t),lx=x-this.center.x,lz=z-this.center.z;if(Math.abs(lx)>HALF||Math.abs(lz)>HALF)break;segment.push(lx,terrainHeight(x,z,local)+.13,lz);}
        if(segment.length===6)points.push(...segment);
      }
    }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));this.replaceGeometry(this.routeLine,g);
  }
  updateLabels(){
    if(!this.nodes.length)return;
    const current=this.location||nearest(this.nodes,this.center.x,this.center.z),local=localNodes(this.nodes,this.center),w=this.mount.clientWidth,h=this.mount.clientHeight;
    this.labels.replaceChildren();
    for(const n of local){
      const x=n.x-this.center.x,z=n.z-this.center.z;if(Math.abs(x)>HALF-3||Math.abs(z)>HALF-3)continue;
      const v=new THREE.Vector3(x,terrainHeight(n.x,n.z,local)+1.2,z).project(this.camera);if(Math.abs(v.x)>.95||Math.abs(v.y)>.92)continue;
      const label=document.createElement('span');label.className='map-label'+(n.index===current.index?' selected':'')+(n.index>this.maxIndex?' locked':'');label.textContent=n.index>this.maxIndex?'云外未启':n.name;label.style.left=(v.x+1)*w/2+'px';label.style.top=(1-v.y)*h/2+'px';this.labels.append(label);
    }
  }
  bindInput(){
    const canvas=this.renderer.domElement,opts={signal:this.abort.signal};
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.focus();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);},opts);
    canvas.addEventListener('pointermove',e=>{
      const old=this.pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;
      if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)[1];const before=Math.hypot(old.x-other.x,old.y-other.y);const after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>4)this.zoomBy(after/before);}
      else if(this.mode==='orbit'){this.angle-=dx*.008;this.elevation=THREE.MathUtils.clamp(this.elevation+dy*.006,.42,1.12);this.render();}
      else this.panPixels(dx,dy);
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    },opts);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{this.pointers.delete(e.pointerId);if(!this.pointers.size)this.schedule();},opts);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(e.deltaY<0?1.08:1/1.08);},{...opts,passive:false});
    canvas.addEventListener('keydown',e=>{const moves={ArrowLeft:[24,0],ArrowRight:[-24,0],ArrowUp:[0,24],ArrowDown:[0,-24]};if(moves[e.key]){e.preventDefault();this.panPixels(...moves[e.key]);}else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')this.home();else this.zoomBy(e.key==='-'?1/1.12:1.12);}},opts);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.render();},opts);
  }
  dispose(){this.disposed=true;this.abort.abort();this.observer.disconnect();cancelAnimationFrame(this.pending);this.scene.traverse(object=>{if(object.isInstancedMesh)object.dispose();object.geometry?.dispose();object.material?.dispose();});this.mistTexture.dispose();this.renderer.dispose();this.renderer.domElement.remove();this.labels.replaceChildren();}
}
