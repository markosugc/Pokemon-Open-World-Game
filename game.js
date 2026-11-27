// FROSTBOUND — mobile-first open-world creature combat (Three.js, all-procedural art).
// File layout (search for the banner comments):
//   [CORE]    renderer, utils, shared geometry/materials, game state, hooks
//   [WORLD]   seeded terrain, water, icebergs, crystals, totems, sky/aurora, snow
//   [PLAYER]  Glacira model, movement, swimming, camera
//   [INPUT]   touch joystick, ability buttons, keyboard
//   [COMBAT]  enemies (TYPES table + AI state machine), projectiles, abilities
//   [SEA]     sea enemy types, Frost Nova, XP/leveling, saving
//   [BOSS/FX] Aurora Leviathan, particles, damage numbers, minimap, audio
// To add a zone: extend rawHeight() / zoneAt(), add entries to TYPES and call addSpawns().
import * as THREE from 'three';

// ======================= [CORE] =======================
const $ = id => document.getElementById(id);
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng = mulberry32(20261127);           // world seed: same layout every load
const rr = (a,b)=>a+rng()*(b-a);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;
function angLerp(a,b,t){const d=((b-a+Math.PI)%TAU+TAU)%TAU-Math.PI;return a+d*t}

const renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
const scene=new THREE.Scene();
const SKY=0x9fd3ee;
scene.background=new THREE.Color(SKY);
scene.fog=new THREE.Fog(SKY,45,150);
const camera=new THREE.PerspectiveCamera(60,1,0.1,420);
function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);addEventListener('orientationchange',()=>setTimeout(resize,250));resize();
scene.add(new THREE.HemisphereLight(0xffffff,0x6fa8c8,1.5));
const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(40,80,20);scene.add(sun);

// Shared geometry + material helpers (reuse everything: iPhone friendly)
const G={sph:new THREE.SphereGeometry(1,8,6),cone:new THREE.ConeGeometry(0.5,1,6),dode:new THREE.DodecahedronGeometry(1,0),
  oct:new THREE.OctahedronGeometry(1,0),ring:new THREE.RingGeometry(0.86,1,32),disc:new THREE.CircleGeometry(1,24),cyl:new THREE.CylinderGeometry(0.5,0.7,1,6)};
G.ring.rotateX(-Math.PI/2);G.disc.rotateX(-Math.PI/2);
const mat=(c,o={})=>new THREE.MeshLambertMaterial({color:c,flatShading:true,...o});
const bmat=(c,o={})=>new THREE.MeshBasicMaterial({color:c,...o});
function part(parent,geo,m,x,y,z,sx=1,sy=sx,sz=sx){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.userData.m=m;parent.add(o);return o;}

// Global state + extension hooks. Later sections push into `systems` and override `actions`/`fx`.
const game={started:false,paused:false,time:0,shake:0,hitstop:0,zone:''};
const systems=[];                      // per-frame updaters: fn(dt)
const onStart=[];                      // run inside the Play tap (audio unlock etc.)
const actions={attack(){},shard(){},dash(){},nova(){}};
const cds={atk:0,shard:0,dash:0,nova:0};
const cdMax={shard:1.2,dash:2,nova:6};
const cost={shard:15,dash:20,nova:35};
const fx={burst(){},number(){},sfx(){},shake(a){game.shake=Math.max(game.shake,a)},hitstop(t){game.hitstop=Math.max(game.hitstop,t)}};
let gainXP=()=>{};
function toast(t){const el=$('toast');el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}

// ======================= [WORLD] =======================
const WORLD=400,HALF=200,SEG=128,CELL=WORLD/SEG,BOUND=190;
const BOSS_LAIR={x:118,z:-128};
// Ice floes: flat stepping areas out in the sea (first one is the checkpoint near the boss lair)
const floes=[{x:86,z:-94,r:9}];
for(let i=0;i<16;i++){const a=rr(0,TAU),d=rr(118,168),f={x:Math.cos(a)*d,z:Math.sin(a)*d,r:rr(6,11)};
  if(Math.hypot(f.x-BOSS_LAIR.x,f.z-BOSS_LAIR.z)>40)floes.push(f);}
// Height field: wobbly island (Iceberg Fields) → shoreline → sea bed (Polar Sea, h<0)
function rawHeight(x,z){
  const d=Math.hypot(x,z),a=Math.atan2(z,x);
  const R=95+16*Math.sin(3*a+1)+9*Math.sin(5*a+2.3);
  const base=(R-d)*0.12;let h;
  if(base>0){const n=Math.sin(x*0.13+1.7)*Math.cos(z*0.11+0.4)+0.5*Math.sin(x*0.31+z*0.27);h=Math.min(base,1.4)+(n+1.5)*0.8*Math.min(base,1);}
  else h=Math.max(base*1.4,-7);
  for(const f of floes){if(Math.hypot(x-f.x,z-f.z)<f.r)h=Math.max(h,0.5);}
  return h;
}
const N1=SEG+1,heights=new Float32Array(N1*N1);
{
  const geo=new THREE.PlaneGeometry(WORLD,WORLD,SEG,SEG);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,col=new Float32Array(pos.count*3),c=new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const h=rawHeight(pos.getX(i),pos.getZ(i));heights[i]=h;pos.setY(i,h);
    if(h>0.35)c.setHSL(0.56,0.35,0.86+0.1*Math.sin(i*12.9898)%0.08);
    else if(h>-0.8)c.setHex(0xa9def5);else c.setHSL(0.57,0.5,clamp(0.42+h*0.04,0.15,0.5));
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  scene.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true})));
}
// Bilinear ground sample matching the terrain mesh
function groundAt(x,z){
  const fx=clamp((x+HALF)/CELL,0,SEG-0.001),fz=clamp((z+HALF)/CELL,0,SEG-0.001),i=fx|0,j=fz|0,u=fx-i,v=fz-j,k=j*N1+i;
  return lerp(lerp(heights[k],heights[k+1],u),lerp(heights[k+N1],heights[k+N1+1],u),v);
}
// Water: translucent animated vertex-wave plane
const waterGeo=new THREE.PlaneGeometry(WORLD+60,WORLD+60,44,44);waterGeo.rotateX(-Math.PI/2);
const water=new THREE.Mesh(waterGeo,new THREE.MeshPhongMaterial({color:0x2a90c4,transparent:true,opacity:0.74,flatShading:true,shininess:60,specular:0x99ddff}));
scene.add(water);
// Icebergs (instanced, also circle colliders) + crystals (instanced, decorative glow)
const obstacles=[];
{
  const n=46,im=new THREE.InstancedMesh(G.dode,mat(0xcdeeff),n),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),s=new THREE.Vector3(),p=new THREE.Vector3();
  let k=0,guard=0;
  while(k<n&&guard++<999){const a=rr(0,TAU),d=rr(16,182),x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)<34||floes.some(f=>Math.hypot(x-f.x,z-f.z)<f.r+5))continue;
    const r=rr(2,5),g=groundAt(x,z);p.set(x,Math.max(g,-0.6)+r*0.5,z);e.set(rr(-.3,.3),rr(0,TAU),rr(-.3,.3));q.setFromEuler(e);s.set(r,r*rr(1.2,2.4),r);
    m4.compose(p,q,s);im.setMatrixAt(k++,m4);obstacles.push({x,z,r:r*0.9});}
  im.count=k;scene.add(im);
  const cn=70,cm=new THREE.InstancedMesh(G.oct,mat(0x6ff0ff,{emissive:0x1aa0c8}),cn);
  for(let i=0;i<cn;i++){const a=rr(0,TAU),d=rr(8,100),x=Math.cos(a)*d,z=Math.sin(a)*d,g=groundAt(x,z);
    p.set(x,g>0?g+0.6:-50,z);e.set(rr(-.4,.4),rr(0,TAU),rr(-.4,.4));q.setFromEuler(e);const r=rr(.25,.5);s.set(r,r*2.6,r);m4.compose(p,q,s);cm.setMatrixAt(i,m4);}
  scene.add(cm);
}
// Checkpoint totems (glowing ice pillars). Touch one to set respawn point + heal.
const totemOff=bmat(0x58d8ff),totemOn=bmat(0xfff2a0),totems=[];
for(const [x,z] of [[0,10],[-52,24],[44,-38],[86,-94]]){
  const g=new THREE.Group(),y=groundAt(x,z);g.position.set(x,y,z);
  part(g,G.cyl,mat(0xbfe9ff),0,1.5,0,1.1,3,1.1);const top=part(g,G.oct,totemOff,0,3.7,0,0.6,0.9,0.6);
  scene.add(g);totems.push({x,z,y,top});obstacles.push({x,z,r:0.7});
}
totems[0].top.material=totemOn;
// Sky: three soft aurora ribbons (tiny shader), snowfall points that wrap around the player
const auroraMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,uniforms:{t:{value:0}},
  vertexShader:`uniform float t;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*0.03+t*0.6)*18.0;p.y+=sin(p.x*0.05+t*0.4)*7.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
  fragmentShader:`uniform float t;varying vec2 vUv;void main(){vec3 a=vec3(0.25,1.0,0.6),b=vec3(0.65,0.4,1.0);vec3 c=mix(a,b,0.5+0.5*sin(vUv.x*9.0+t*0.5));
    float al=pow(sin(vUv.y*3.1416),1.5)*(0.35+0.25*sin(vUv.x*40.0+t*1.3))*sin(vUv.x*3.1416);gl_FragColor=vec4(c,al);}`});
const aurora=new THREE.Group();
for(let i=0;i<3;i++){const a=i*2.1+0.4,m=new THREE.Mesh(new THREE.PlaneGeometry(330,46,48,1),auroraMat);m.position.set(Math.sin(a)*150,62+i*9,Math.cos(a)*150);m.rotation.y=a;aurora.add(m);}
scene.add(aurora);
const SNOW=320,snowPos=new Float32Array(SNOW*3);
for(let i=0;i<SNOW*3;i++)snowPos[i]=Math.random()*60;
const snowGeo=new THREE.BufferGeometry();snowGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SNOW*3),3));
const snow=new THREE.Points(snowGeo,new THREE.PointsMaterial({color:0xffffff,size:0.22,transparent:true,opacity:0.9,depthWrite:false}));
snow.frustumCulled=false;scene.add(snow);
function zoneAt(x,z,g){
  if(Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)<42)return 'Leviathan Deep';
  return g<-0.6?'Polar Sea':'Iceberg Fields';
}
function updateWorld(dt,t){
  const wp=waterGeo.attributes.position;
  for(let i=0;i<wp.count;i++)wp.setY(i,(Math.sin(wp.getX(i)*0.16+t*1.3)+Math.cos(wp.getZ(i)*0.14+t))*0.11);
  wp.needsUpdate=true;
  auroraMat.uniforms.t.value=t;aurora.position.set(player.pos.x,0,player.pos.z);
  const sp=snowGeo.attributes.position,px=player.pos.x,pz=player.pos.z;
  for(let i=0;i<SNOW;i++){const k=i*3;snowPos[k+1]-=dt*(3+(i%5));snowPos[k]+=dt*1.2;
    sp.setXYZ(i,px+((snowPos[k]-px)%60+60)%60-30,((snowPos[k+1]%30)+30)%30,pz+((snowPos[k+2]-pz)%60+60)%60-30);}
  sp.needsUpdate=true;
  for(const tm of totems)tm.top.rotation.y=t*1.5;
}

// ======================= [PLAYER] =======================
// Glacira: seal-penguin hybrid built from primitives, faces +Z.
const player={pos:new THREE.Vector3(0,0,4),vx:0,vz:0,kx:0,kz:0,yaw:Math.PI,hp:100,maxHp:100,en:100,maxEn:100,lvl:1,xp:0,
  swim:false,iframes:0,dead:false,deadT:0,checkpoint:0,dashT:0,dvx:0,dvz:0,atkAnim:0,combo:0,lastAtk:-9,target:null,walk:0};
const pm=new THREE.Group(),pbody=new THREE.Group();pm.add(pbody);scene.add(pm);
const M={navy:mat(0x2b4f8a),white:mat(0xf4fbff),orange:mat(0xffa23a),dark:mat(0x10203a),ice:mat(0x7ff3ff,{emissive:0x1c8fb0})};
part(pbody,G.sph,M.navy,0,0.85,0,0.72,0.78,1.1);
part(pbody,G.sph,M.white,0,0.72,0.16,0.58,0.62,0.92);
part(pbody,G.sph,M.navy,0,1.38,0.72,0.47);
part(pbody,G.sph,M.white,0,1.3,0.86,0.36,0.34,0.36);
part(pbody,G.cone,M.orange,0,1.3,1.28,0.3,0.45,0.3).rotation.x=Math.PI/2;
part(pbody,G.sph,M.dark,0.24,1.5,1.02,0.07);part(pbody,G.sph,M.dark,-0.24,1.5,1.02,0.07);
part(pbody,G.cone,M.ice,0,1.95,0.6,0.3,0.6,0.3).rotation.x=-0.4;
part(pbody,G.cone,M.ice,0,1.5,-0.5,0.3,0.5,0.3).rotation.x=-0.9;
const flipL=part(pbody,G.sph,M.navy,0.78,0.85,0.1,0.13,0.5,0.32),flipR=part(pbody,G.sph,M.navy,-0.78,0.85,0.1,0.13,0.5,0.32);
const tail=part(pbody,G.cone,M.navy,0,0.6,-1.2,0.9,0.9,0.25);tail.rotation.x=-Math.PI/2;
const blob=part(scene,G.disc,bmat(0x0a2540,{transparent:true,opacity:0.28,depthWrite:false}),0,0,0,1.1);

let camYaw=0,camPitch=0.42;const camT=new THREE.Vector3(0,2,4),tmpV=new THREE.Vector3();
const input={jx:0,jy:0},keys={},held={};

function respawn(){const p=player,t=totems[p.checkpoint];p.dead=false;p.hp=p.maxHp;p.en=p.maxEn;p.pos.set(t.x,t.y,t.z+2.5);p.kx=p.kz=p.vx=p.vz=0;p.iframes=2;pm.visible=true;toast('Revived at totem');}
function updatePlayer(dt){
  const p=player;
  if(p.dead){p.deadT-=dt;if(p.deadT<=0)respawn();return;}
  let mx=input.jx+(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),my=input.jy+(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0);
  if(keys.KeyQ)camYaw+=dt*2;if(keys.KeyE)camYaw-=dt*2;
  const mag=Math.min(1,Math.hypot(mx,my));
  p.swim=groundAt(p.pos.x,p.pos.z)<-0.6;
  const speed=p.swim?7.5:9.5;let tvx=0,tvz=0;
  if(mag>0.1){
    // camera-relative move direction
    const fx_=-Math.sin(camYaw),fz=-Math.cos(camYaw),rx=Math.cos(camYaw),rz=-Math.sin(camYaw);
    let dx=fx_*-my+rx*mx,dz=fz*-my+rz*mx;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
    p.yaw=angLerp(p.yaw,Math.atan2(dx,dz),Math.min(1,dt*(p.swim?4.5:14)));   // swimming turns slower
    const ax=p.swim?Math.sin(p.yaw):dx,az=p.swim?Math.cos(p.yaw):dz;          // ...and moves along its heading
    tvx=ax*speed*mag;tvz=az*speed*mag;camYaw-=mx*dt*0.8;p.walk+=dt*mag;
  }
  if(p.dashT>0){p.dashT-=dt;p.vx=p.dvx;p.vz=p.dvz;}
  else{const k=Math.min(1,dt*(p.swim?5:12));p.vx=lerp(p.vx,tvx,k);p.vz=lerp(p.vz,tvz,k);}
  let nx=p.pos.x+(p.vx+p.kx)*dt,nz=p.pos.z+(p.vz+p.kz)*dt;const kd=Math.exp(-dt*9);p.kx*=kd;p.kz*=kd;
  for(const o of obstacles){const dx=nx-o.x,dz=nz-o.z,d=Math.hypot(dx,dz),m=o.r+0.7;if(d<m&&d>1e-4){nx=o.x+dx/d*m;nz=o.z+dz/d*m;}}
  const d=Math.hypot(nx,nz);if(d>BOUND){nx*=BOUND/d;nz*=BOUND/d;}
  p.pos.x=nx;p.pos.z=nz;
  const g=groundAt(nx,nz),ty=g<-0.6?-0.55+Math.sin(game.time*3)*0.08:g;
  p.pos.y=lerp(p.pos.y,ty,Math.min(1,dt*12));
  // stats
  p.en=Math.min(p.maxEn,p.en+dt*10);p.hp=Math.min(p.maxHp,p.hp+dt*1.2);p.iframes-=dt;p.atkAnim-=dt;
  for(const k in cds)cds[k]=Math.max(0,cds[k]-dt);
  for(const k in held)if(held[k])actions[k]();
  // checkpoints
  for(let i=0;i<totems.length;i++){const t=totems[i];if(i!==p.checkpoint&&Math.hypot(nx-t.x,nz-t.z)<3.5){
    totems[p.checkpoint].top.material=totemOff;p.checkpoint=i;t.top.material=totemOn;p.hp=p.maxHp;toast('Checkpoint!');fx.sfx('level');}}
  // zone toast
  const z=zoneAt(nx,nz,g);if(z!==game.zone){game.zone=z;toast(z);}
  // model animation: waddle on ice, bob + roll in water, lunge on attack
  const moving=Math.hypot(p.vx,p.vz)/speed,t=game.time;
  pm.position.copy(p.pos);pm.rotation.y=p.yaw;
  pbody.rotation.z=p.swim?Math.sin(t*2.2)*0.12:Math.sin(p.walk*13)*0.14*moving;
  pbody.rotation.x=(p.swim?0.25:0)+(p.atkAnim>0?0.5*Math.sin(p.atkAnim/0.2*Math.PI):0)+(p.dashT>0?0.6:0);
  pbody.position.z=p.atkAnim>0?0.7*Math.sin(p.atkAnim/0.2*Math.PI):0;
  const flap=p.swim?Math.sin(t*6)*0.6*(0.3+moving):Math.sin(p.walk*13)*0.4*moving;
  flipL.rotation.z=-0.3-flap;flipR.rotation.z=0.3+flap;tail.rotation.y=Math.sin(t*(p.swim?7:3))*0.3;
  pm.visible=p.iframes<=0||p.dashT>0||((t*20)|0)%2===0;
  blob.visible=!p.swim;blob.position.set(nx,g+0.06,nz);
}
function updateCamera(dt){
  const p=player.pos;camT.lerp(tmpV.set(p.x,p.y+1.7,p.z),Math.min(1,dt*8));
  const dist=11.5,cp=Math.cos(camPitch);
  const cx=camT.x+Math.sin(camYaw)*dist*cp,cz=camT.z+Math.cos(camYaw)*dist*cp;
  const cy=Math.max(camT.y+Math.sin(camPitch)*dist,groundAt(cx,cz)+1.2,1);
  const s=game.shake;game.shake=Math.max(0,s-dt*2.5);
  camera.position.set(cx+(Math.random()-.5)*s,cy+(Math.random()-.5)*s,cz+(Math.random()-.5)*s);camera.lookAt(camT);
}

// ======================= [INPUT] =======================
// Left half: floating joystick. Right half: drag to orbit camera. Buttons sit above the right zone.
{
  const stick=$('stick'),knob=stick.firstElementChild,zl=$('zoneL'),zr=$('zoneR');let jid=null,ox=0,oy=0,cid=null,lx=0,ly=0;
  const cap=(el,e)=>{try{el.setPointerCapture(e.pointerId)}catch(_){}};
  zl.addEventListener('pointerdown',e=>{if(jid!==null)return;jid=e.pointerId;ox=e.clientX;oy=e.clientY;cap(zl,e);
    stick.classList.add('act');stick.style.left=ox+'px';stick.style.top=oy+'px';});
  zl.addEventListener('pointermove',e=>{if(e.pointerId!==jid)return;let dx=(e.clientX-ox)/48,dy=(e.clientY-oy)/48;const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l;}
    input.jx=dx;input.jy=dy;knob.style.transform=`translate(${dx*40}px,${dy*40}px)`;});
  const jend=e=>{if(e.pointerId!==jid)return;jid=null;input.jx=input.jy=0;knob.style.transform='';stick.classList.remove('act');stick.style.left=stick.style.top='';};
  zl.addEventListener('pointerup',jend);zl.addEventListener('pointercancel',jend);
  zr.addEventListener('pointerdown',e=>{if(cid!==null)return;cid=e.pointerId;lx=e.clientX;ly=e.clientY;cap(zr,e);});
  zr.addEventListener('pointermove',e=>{if(e.pointerId!==cid)return;camYaw-=(e.clientX-lx)*0.007;camPitch=clamp(camPitch+(e.clientY-ly)*0.004,0.12,1.1);lx=e.clientX;ly=e.clientY;});
  const cend=e=>{if(e.pointerId===cid)cid=null;};zr.addEventListener('pointerup',cend);zr.addEventListener('pointercancel',cend);
  for(const [id,name] of [['bAtk','attack'],['bShard','shard'],['bDash','dash'],['bNova','nova']]){
    const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();cap(b,e);b.classList.add('down');if(name==='attack')held.attack=true;if(game.started&&!game.paused)actions[name]();});
    const up=()=>{b.classList.remove('down');if(name==='attack')held.attack=false;};
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);
  }
  const keyAct={KeyJ:'attack',KeyK:'shard',KeyL:'dash',Space:'nova'};
  addEventListener('keydown',e=>{keys[e.code]=true;const a=keyAct[e.code];if(a&&game.started&&!game.paused&&!e.repeat){e.preventDefault();if(a==='attack')held.attack=true;actions[a]();}
    if(e.code==='KeyP'||e.code==='Escape')setPaused(!game.paused);if(e.code==='Enter'&&!game.started)start();});
  addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyJ')held.attack=false;});
  // Mobile Safari: kill scroll / pinch / double-tap zoom / long-press menu once playing
  const stop=e=>{if(game.started)e.preventDefault();};
  document.addEventListener('touchstart',stop,{passive:false});document.addEventListener('touchmove',stop,{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault());document.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('dblclick',e=>e.preventDefault());
}
function setPaused(v){if(!game.started)return;game.paused=v;$('paused').classList.toggle('hidden',!v);}
function start(){if(game.started)return;game.started=true;$('title').classList.add('hidden');$('hud').classList.remove('hidden');for(const f of onStart)f();resize();}
for(const ev of ['pointerup','touchend','click'])$('play').addEventListener(ev,start);
$('pause').addEventListener('pointerdown',e=>{e.stopPropagation();setPaused(true);});
$('paused').addEventListener('pointerup',()=>setPaused(false));
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPaused(true);});

// ======================= HUD + main loop =======================
const hudEl={hp:$('hp'),en:$('en'),xp:$('xp'),lvl:$('lvl'),tint:$('tint'),hurt:$('hurt')};
const abBtn={shard:$('bShard'),dash:$('bDash'),nova:$('bNova')};
let xpNeed=()=>50;
function updateHud(){
  const p=player;hudEl.hp.style.transform=`scaleX(${clamp(p.hp/p.maxHp,0,1)})`;hudEl.en.style.transform=`scaleX(${p.en/p.maxEn})`;
  hudEl.xp.style.transform=`scaleX(${clamp(p.xp/xpNeed(),0,1)})`;
  hudEl.tint.classList.toggle('on',p.swim&&game.started);
  for(const k in abBtn){abBtn[k].style.setProperty('--cd',(cds[k]/cdMax[k]).toFixed(3));abBtn[k].classList.toggle('low',p.en<cost[k]);}
}
let last=performance.now(),wt=0;
function frame(now){
  requestAnimationFrame(frame);
  let dt=Math.min(0.05,(now-last)/1000);last=now;wt+=dt;
  if(game.started&&!game.paused){
    if(game.hitstop>0){game.hitstop-=dt;}          // brief freeze on heavy hits
    else{game.time+=dt;updatePlayer(dt);for(const s of systems)s(dt);}
    updateHud();
  }else if(!game.started){camYaw+=dt*0.12;pm.position.copy(player.pos).setY(groundAt(player.pos.x,player.pos.z));pm.rotation.y=player.yaw;}
  if(!game.paused){updateWorld(dt,wt);updateCamera(dt);}
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);

// ======================= [COMBAT] =======================
// Enemy TYPES table: add a row + a build() to create a new creature. `kind` selects the attack:
//   lunge (dash at player), slam (AoE after telegraph), shoot (projectile), boss (alternates patterns).
const whiteMat=bmat(0xffffff),teleMat=bmat(0xff3b3b,{transparent:true,opacity:0.75,depthWrite:false}),teleFill=bmat(0xff5a3b,{transparent:true,opacity:0.3,depthWrite:false});
const hpMat=new THREE.SpriteMaterial({color:0xff4a5a,depthTest:false});
const EM={mite:mat(0xe9f6ff),miteS:mat(0x86c8ff),eye:mat(0x16223a),wal:mat(0x7f93a8),rock:mat(0x55677d),tusk:mat(0xfff7e0),
  eel:mat(0xf2e24a,{emissive:0x554400}),eelB:mat(0x2bb6a8),krill:mat(0xff8fb0,{emissive:0x551525})};
const TYPES={
  snowmite:{name:'Snowmite',hp:24,speed:7.5,aggro:18,range:3.2,windup:.4,recover:.9,dmg:6,xp:8,sea:false,radius:.7,tele:1.3,kind:'lunge',lungeSpeed:17,lungeTime:.25,
    build(g){part(g,G.sph,EM.mite,0,.6,0,.6,.5,.7);for(let i=0;i<4;i++)part(g,G.cone,EM.miteS,(i%2?.3:-.3),1.05,(i<2?.25:-.25),.3,.6,.3);
      part(g,G.sph,EM.eye,.22,.7,.6,.1);part(g,G.sph,EM.eye,-.22,.7,.6,.1);}},
  walrus:{name:'Crag Walrus',hp:95,speed:3.3,aggro:16,range:4.4,windup:1,recover:1.5,dmg:20,xp:30,sea:false,radius:1.8,tele:5.8,kind:'slam',
    build(g){part(g,G.sph,EM.wal,0,1.3,0,1.6,1.3,2.1);part(g,G.sph,EM.wal,0,1.7,1.9,1,.95,1);part(g,G.dode,EM.rock,0,2.5,-.3,1.1,.8,1.3);
      part(g,G.cone,EM.tusk,.4,1,2.6,.3,1.1,.3).rotation.x=Math.PI;part(g,G.cone,EM.tusk,-.4,1,2.6,.3,1.1,.3).rotation.x=Math.PI;
      part(g,G.sph,EM.eye,.45,2.1,2.6,.12);part(g,G.sph,EM.eye,-.45,2.1,2.6,.12);}},
};
const enemies=[],spawns=[];
function makeEnemy(sp){
  const T=TYPES[sp.type],mesh=new THREE.Group(),body=new THREE.Group();mesh.add(body);T.build(body);
  const ring=part(mesh,G.ring,teleMat,0,.15,0,T.tele),fill=part(mesh,G.disc,teleFill,0,.12,0,T.tele);ring.visible=fill.visible=false;
  const bar=new THREE.Sprite(hpMat);bar.position.y=T.radius*2+1.2;bar.visible=false;mesh.add(bar);
  scene.add(mesh);
  const e={type:T,sp,mesh,body,ring,fill,bar,pos:mesh.position,home:{x:sp.x,z:sp.z}};enemies.push(e);resetEnemy(e);return e;
}
function resetEnemy(e){const T=e.type;e.hp=T.hp;e.state='idle';e.t=rr(0,2);e.dead=false;e.kx=e.kz=0;e.flash=0;e.slow=0;e.lunge=0;e.circ=0;e.pat=0;e.yaw=rr(0,TAU);
  e.wx=e.home.x;e.wz=e.home.z;e.pos.set(e.home.x,T.sea?-0.4:groundAt(e.home.x,e.home.z),e.home.z);e.mesh.visible=true;e.bar.visible=false;e.ring.visible=e.fill.visible=false;e.mesh.scale.setScalar(1);}
// Deterministic spawn placement: `ok(x,z,groundHeight)` filters where a type may live.
function addSpawns(type,count,ok){let n=0,guard=0;while(n<count&&guard++<2000){const a=rr(0,TAU),d=rr(24,175),x=Math.cos(a)*d,z=Math.sin(a)*d;
  if(!ok(x,z,groundAt(x,z))||obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+3))continue;const sp={type,x,z,timer:0};spawns.push(sp);makeEnemy(sp);n++;}}
const farFromLair=(x,z)=>Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)>50;
addSpawns('snowmite',5,(x,z,g)=>g>0.8&&Math.hypot(x,z)<80);
addSpawns('walrus',3,(x,z,g)=>g>0.8&&Math.hypot(x,z)>40);

function moveEnemy(e,vx,vz,dt){const nx=e.pos.x+vx*dt,nz=e.pos.z+vz*dt,g=groundAt(nx,nz);
  if((e.type.sea?g<-1:g>-0.3)&&Math.hypot(nx,nz)<BOUND){e.pos.x=nx;e.pos.z=nz;return true;}return false;}
function setFlash(e,on){e.body.traverse(o=>{if(o.isMesh)o.material=on?whiteMat:o.userData.m;});}
function hurtPlayer(d,fx_,fz){
  const p=player;if(p.dead||p.iframes>0)return;
  p.hp-=d;p.iframes=0.5;const dx=p.pos.x-fx_,dz=p.pos.z-fz,l=Math.hypot(dx,dz)||1;p.kx+=dx/l*12;p.kz+=dz/l*12;
  fx.shake(0.5);fx.sfx('hurt');fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xff6677,8);fx.number(p.pos,'-'+Math.round(d),'#ff7080');
  hudEl.hurt.style.opacity=1;setTimeout(()=>hudEl.hurt.style.opacity=0,150);
  if(p.hp<=0){p.hp=0;p.dead=true;p.deadT=1.8;pm.visible=false;fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0x7ff3ff,30);toast('Defeated…');}
}
const dmgMul=()=>1+0.15*(player.lvl-1);
function hitEnemy(e,dmg,kx,kz,heavy){
  if(e.dead)return;dmg=Math.round(dmg);e.hp-=dmg;e.flash=0.1;setFlash(e,true);
  const kb=(heavy?16:8)/Math.max(1,e.type.radius);e.kx+=kx*kb;e.kz+=kz*kb;
  if(e.state==='idle')e.state='chase';
  e.bar.visible=!e.type.boss;e.bar.scale.set(2.2*Math.max(0,e.hp/e.type.hp),0.22,1);
  fx.number(e.pos,dmg,heavy?'#ffe066':'#fff',e.type.radius*1.5+1);fx.burst(e.pos.x,e.pos.y+e.type.radius,e.pos.z,0xbff4ff,heavy?14:7);fx.sfx(heavy?'heavy':'hit');
  if(heavy){fx.hitstop(0.07);fx.shake(0.35);}
  if(e.hp<=0){e.dead=true;e.mesh.visible=false;e.sp.timer=e.type.respawn||28;fx.burst(e.pos.x,e.pos.y+1,e.pos.z,0xffffff,e.type.boss?80:24);fx.sfx('kill');
    if(player.target===e)player.target=null;gainXP(e.type.xp);if(e.type.boss){toast('Aurora Leviathan defeated!');fx.shake(1);}}
}
// Hostile + friendly projectiles (pooled)
const shots=[],shardMat=mat(0x9ff6ff,{emissive:0x2aa7e8}),bubbleMat=mat(0xff9ad0,{emissive:0x7a1f50,transparent:true,opacity:0.85});
function spawnShot(x,y,z,vx,vz,dmg,hostile,life=1.3,target=null){
  let s=shots.find(s=>!s.active&&s.hostile===hostile);
  if(!s){const m=hostile?part(scene,G.sph,bubbleMat,0,0,0,0.55):part(scene,G.oct,shardMat,0,0,0,0.3,0.3,0.9);s={mesh:m,hostile};shots.push(s);}
  s.active=true;s.mesh.visible=true;s.mesh.position.set(x,y,z);s.vx=vx;s.vz=vz;s.dmg=dmg;s.life=life;s.target=target;return s;
}
function doAttack(e,ux,uz,dist){
  const T=e.type;
  if(T.kind==='lunge'||(T.kind==='boss'&&e.pat===1)){e.lunge=T.lungeTime;e.lvx=ux*T.lungeSpeed;e.lvz=uz*T.lungeSpeed;e.hitDone=false;fx.sfx('lunge');}
  else if(T.kind==='slam'){if(dist<T.tele)hurtPlayer(T.dmg,e.pos.x,e.pos.z);fx.burst(e.pos.x,e.pos.y+.3,e.pos.z,0xffffff,26,9);fx.shake(dist<20?0.55:0.15);fx.sfx('slam');}
  else if(T.kind==='shoot'){spawnShot(e.pos.x,0.5,e.pos.z,ux*12,uz*12,T.dmg,true,2.4);fx.sfx('shoot');}
  else if(T.kind==='boss'){const n=e.hp<T.hp*0.5?16:10,o=rr(0,TAU);for(let i=0;i<n;i++){const a=o+i/n*TAU;spawnShot(e.pos.x,0.5,e.pos.z,Math.sin(a)*11,Math.cos(a)*11,T.dmg*0.6,true,3);}fx.sfx('slam');fx.shake(0.3);}
  if(T.kind==='boss')e.pat=1-e.pat;
}
function updateEnemy(e,dt,dx,dz,dist){
  const T=e.type,sm=e.slow>0?0.35:1,ux=dx/(dist||1),uz=dz/(dist||1);e.slow-=dt;e.t-=dt;
  let fyaw=e.yaw;
  if(e.state==='idle'){
    if(e.t<=0){e.t=rr(2,5);e.wx=e.home.x+rr(-9,9);e.wz=e.home.z+rr(-9,9);}
    const wx=e.wx-e.pos.x,wz=e.wz-e.pos.z,wl=Math.hypot(wx,wz);
    if(wl>1){moveEnemy(e,wx/wl*T.speed*0.35,wz/wl*T.speed*0.35,dt);fyaw=Math.atan2(wx,wz);}
    if(dist<T.aggro&&!player.dead)e.state='chase';
  }else if(e.state==='chase'){
    fyaw=Math.atan2(ux,uz);
    if(player.dead||dist>T.aggro*2.4||Math.hypot(e.pos.x-e.home.x,e.pos.z-e.home.z)>70){e.state='idle';e.t=0;}
    else if(dist>T.range){if(!moveEnemy(e,ux*T.speed*sm,uz*T.speed*sm,dt)&&T.kind==='shoot'&&dist<T.range*1.6){e.state='windup';e.t=T.windup;}e.circ=0;}
    else if(T.circle&&e.circ<T.circle){e.circ+=dt;moveEnemy(e,(-uz+ux*0.15)*T.speed*sm,(ux+uz*0.15)*T.speed*sm,dt);}   // circle the player before striking
    else{e.state='windup';e.t=T.windup/sm;e.t0=e.t;}
  }else if(e.state==='windup'){
    fyaw=Math.atan2(ux,uz);const k=1-clamp(e.t/(e.t0||T.windup),0,1);
    e.ring.visible=e.fill.visible=true;e.fill.scale.setScalar(Math.max(0.01,T.tele*k));e.ring.position.y=e.fill.position.y=(T.sea?0.3-e.pos.y:0.15);
    e.mesh.scale.setScalar(1+0.12*Math.sin(k*20));
    if(e.t<=0){e.ring.visible=e.fill.visible=false;e.mesh.scale.setScalar(1);doAttack(e,ux,uz,dist);e.state='recover';e.t=T.recover;}
  }else{ // recover (also carries out lunges)
    if(e.lunge>0){e.lunge-=dt;moveEnemy(e,e.lvx*sm,e.lvz*sm,dt);fyaw=Math.atan2(e.lvx,e.lvz);
      if(!e.hitDone&&dist<T.radius+1.2){e.hitDone=true;hurtPlayer(T.dmg,e.pos.x,e.pos.z);}}
    else if(T.keep&&dist<T.keep)moveEnemy(e,-ux*T.speed*sm,-uz*T.speed*sm,dt);
    if(e.t<=0){e.state='chase';e.circ=0;}
  }
  if(Math.abs(e.kx)+Math.abs(e.kz)>0.1){moveEnemy(e,e.kx,e.kz,dt);const kd=Math.exp(-dt*7);e.kx*=kd;e.kz*=kd;}
  e.yaw=angLerp(e.yaw,fyaw,Math.min(1,dt*8));e.mesh.rotation.y=e.yaw;
  e.pos.y=T.sea?(T.swimY||-0.4)+Math.sin(game.time*2+e.home.x)*0.12:groundAt(e.pos.x,e.pos.z);
  if(T.anim)T.anim(e,game.time);else e.body.position.y=e.state==='idle'?0:Math.abs(Math.sin(game.time*9+e.home.z))*0.18;
  if(e.flash>0){e.flash-=dt;if(e.flash<=0)setFlash(e,false);}
}
const targetRing=part(scene,G.ring,bmat(0x7ff3ff,{transparent:true,opacity:0.9,depthWrite:false}),0,-50,0,1.5);
systems.push(dt=>{
  const p=player;let best=null,bs=1e9;const fx_=Math.sin(p.yaw),fz=Math.cos(p.yaw);
  for(const e of enemies){
    if(e.dead){e.sp.timer-=dt;if(e.sp.timer<=0&&Math.hypot(p.pos.x-e.home.x,p.pos.z-e.home.z)>35)resetEnemy(e);continue;}
    const dx=p.pos.x-e.pos.x,dz=p.pos.z-e.pos.z,dist=Math.hypot(dx,dz);
    if(dist>120){e.mesh.visible=false;continue;}e.mesh.visible=true;
    updateEnemy(e,dt,dx,dz,dist);
    // soft lock-on: nearest enemy, biased to what the player is facing
    if(dist<18+e.type.radius){const ang=Math.acos(clamp((-dx*fx_-dz*fz)/(dist||1),-1,1));if(ang<1.9||dist<5){const s=dist+ang*4;if(s<bs){bs=s;best=e;}}}
  }
  p.target=best;
  if(best){targetRing.visible=true;targetRing.position.set(best.pos.x,Math.max(best.pos.y,0)+0.2,best.pos.z);targetRing.scale.setScalar(best.type.radius+0.7+Math.sin(game.time*8)*0.1);}else targetRing.visible=false;
  // projectiles
  for(const s of shots){if(!s.active)continue;s.life-=dt;const m=s.mesh.position;
    if(!s.hostile&&s.target&&!s.target.dead){const tx=s.target.pos.x-m.x,tz=s.target.pos.z-m.z,l=Math.hypot(tx,tz)||1,sp=Math.hypot(s.vx,s.vz);s.vx=lerp(s.vx,tx/l*sp,dt*8);s.vz=lerp(s.vz,tz/l*sp,dt*8);}
    m.x+=s.vx*dt;m.z+=s.vz*dt;s.mesh.rotation.y=Math.atan2(s.vx,s.vz);
    let done=s.life<=0;
    if(s.hostile){if(Math.hypot(m.x-p.pos.x,m.z-p.pos.z)<1.2&&!p.dead&&p.iframes<=0){hurtPlayer(s.dmg,m.x-s.vx,m.z-s.vz);done=true;}}
    else for(const e of enemies){if(!e.dead&&Math.hypot(m.x-e.pos.x,m.z-e.pos.z)<e.type.radius+0.8){const l=Math.hypot(s.vx,s.vz);hitEnemy(e,s.dmg,s.vx/l,s.vz/l,false);done=true;break;}}
    if(done){s.active=false;s.mesh.visible=false;fx.burst(m.x,m.y,m.z,s.hostile?0xff9ad0:0x9ff6ff,6);}
  }
  slash.visible=p.atkAnim>0.08;if(slash.visible)slash.position.copy(p.pos).y+=0.9;
});
// --- Player abilities ---
const slash=new THREE.Mesh(new THREE.TorusGeometry(2.4,0.13,4,12,Math.PI*0.9),bmat(0xe8fbff,{transparent:true,opacity:0.85}));slash.visible=false;scene.add(slash);
const faceTarget=()=>{const p=player,t=p.target;if(t)p.yaw=Math.atan2(t.pos.x-p.pos.x,t.pos.z-p.pos.z);};
const spend=k=>{const p=player;if(p.dead||cds[k]>0||p.en<cost[k])return false;p.en-=cost[k];cds[k]=cdMax[k];return true;};
// Attack: 3-hit ice-bite combo, third bite is heavy (hit-stop + big knockback)
actions.attack=()=>{
  const p=player;if(p.dead||cds.atk>0||p.dashT>0)return;
  cds.atk=0.3;p.combo=(game.time-p.lastAtk<0.85)?(p.combo+1)%3:0;p.lastAtk=game.time;faceTarget();
  const fx_=Math.sin(p.yaw),fz=Math.cos(p.yaw),heavy=p.combo===2;p.kx+=fx_*7;p.kz+=fz*7;p.atkAnim=0.2;
  slash.rotation.set(Math.PI/2,0,0.05*Math.PI-p.yaw);slash.scale.setScalar(heavy?1.3:1);fx.sfx('swing');
  for(const e of enemies){if(e.dead)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz);
    if(d>(heavy?4.4:3.8)+e.type.radius)continue;if((dx*fx_+dz*fz)/(d||1)<0.15&&d>1.6+e.type.radius)continue;
    hitEnemy(e,(heavy?20:10)*dmgMul(),fx_,fz,heavy);}
};
// Ice Shard: homing projectile at the locked target
actions.shard=()=>{if(!spend('shard'))return;const p=player;faceTarget();const fx_=Math.sin(p.yaw),fz=Math.cos(p.yaw);
  spawnShot(p.pos.x+fx_,Math.max(p.pos.y,0)+0.9,p.pos.z+fz,fx_*32,fz*32,16*dmgMul(),false,1.2,p.target);fx.sfx('shard');};
// Tidal Dash: burst of speed with i-frames (faster in water)
actions.dash=()=>{if(!spend('dash'))return;const p=player,sp=p.swim?40:34;let dx=Math.sin(p.yaw),dz=Math.cos(p.yaw);
  p.dashT=0.26;p.dvx=dx*sp;p.dvz=dz*sp;p.iframes=0.45;fx.burst(p.pos.x,p.pos.y+.6,p.pos.z,0x66c8ff,16);fx.sfx('dash');};

// ======================= [SEA] sea creatures, Frost Nova, XP/leveling, save =======================
TYPES.eel={name:'Eelstorm',hp:40,speed:8.5,aggro:22,range:8.5,windup:.55,recover:1.1,dmg:11,xp:16,sea:true,radius:.9,tele:1.5,kind:'lunge',lungeSpeed:25,lungeTime:.42,circle:1.8,
  build(g){for(let i=0;i<6;i++)part(g,G.sph,i%2?EM.eelB:EM.eel,0,.5,-i*.7,.55-i*.06,.5-i*.05,.6);part(g,G.cone,EM.eel,0,1,0,.3,.6,.3);},
  anim(e,t){const c=e.body.children;for(let i=0;i<6;i++)c[i].position.x=Math.sin(t*7-i*.8)*0.1*i;}};
TYPES.krill={name:'Krillcloud',hp:30,speed:4.5,aggro:24,range:15,windup:.7,recover:1.7,dmg:9,xp:14,sea:true,radius:1.1,tele:1.2,kind:'shoot',keep:8,
  build(g){for(let i=0;i<8;i++)part(g,G.sph,EM.krill,0,0,0,.28,.22,.4);},
  anim(e,t){const c=e.body.children;for(let i=0;i<8;i++){const a=t*2.5+i*0.785;c[i].position.set(Math.cos(a)*(.5+.3*(i%2)),.7+Math.sin(a*1.7+i)*.4,Math.sin(a)*(.5+.3*(i%3)));}}};
addSpawns('eel',3,(x,z,g)=>g<-2.5&&farFromLair(x,z)&&Math.hypot(x,z)<165);
addSpawns('krill',3,(x,z,g)=>g<-2.5&&farFromLair(x,z)&&Math.hypot(x,z)<165);
// Frost Nova: AoE burst — heavy damage, knockback, slows enemies, pops hostile bubbles
const novaRing=part(scene,G.ring,bmat(0xbff6ff,{transparent:true,opacity:0.9,depthWrite:false}),0,-50,0,1);let novaT=0;
actions.nova=()=>{if(!spend('nova'))return;const p=player;novaT=0.45;novaRing.position.set(p.pos.x,Math.max(p.pos.y,0)+0.4,p.pos.z);
  fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xcff8ff,45,13);fx.shake(0.5);fx.sfx('nova');
  for(const e of enemies){if(e.dead)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1;
    if(d<9.5+e.type.radius){e.slow=3;hitEnemy(e,28*dmgMul(),dx/d,dz/d,true);}}
  for(const s of shots)if(s.active&&s.hostile&&Math.hypot(s.mesh.position.x-p.pos.x,s.mesh.position.z-p.pos.z)<10)s.life=0;};
systems.push(dt=>{if(novaT>0){novaT-=dt;const k=1-novaT/0.45;novaRing.visible=true;novaRing.scale.setScalar(1+k*9);novaRing.material.opacity=1-k;}else novaRing.visible=false;});
// XP → level: +20 max HP and +15% damage per level. Saved to localStorage.
xpNeed=()=>40+player.lvl*30;
function applyLevel(){player.maxHp=100+20*(player.lvl-1);hudEl.lvl.textContent='Lv '+player.lvl;}
function save(){try{localStorage.setItem('frostbound_save',JSON.stringify({lvl:player.lvl,xp:player.xp}));}catch(_){}}
try{const s=JSON.parse(localStorage.getItem('frostbound_save')||'null');if(s&&s.lvl>0){player.lvl=Math.min(99,s.lvl|0);player.xp=+s.xp||0;}}catch(_){}
applyLevel();player.hp=player.maxHp;
gainXP=n=>{const p=player;p.xp+=n;let up=false;while(p.xp>=xpNeed()){p.xp-=xpNeed();p.lvl++;up=true;}
  if(up){applyLevel();p.hp=p.maxHp;p.en=p.maxEn;toast('Level '+p.lvl+'!');fx.sfx('level');fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xfff2a0,40,10);
    const f=$('flash');f.style.opacity=0.8;setTimeout(()=>f.style.opacity=0,180);}
  save();};
