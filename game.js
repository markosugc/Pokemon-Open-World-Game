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
const hemi=new THREE.HemisphereLight(0xffffff,0x6fa8c8,1.5);scene.add(hemi);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(40,80,20);scene.add(sun);

// Shared geometry + material helpers (reuse everything: iPhone friendly)
const G={sph:new THREE.SphereGeometry(1,20,14),cone:new THREE.ConeGeometry(0.5,1,14),dode:new THREE.DodecahedronGeometry(1,0),
  oct:new THREE.OctahedronGeometry(1,0),ring:new THREE.RingGeometry(0.86,1,32),disc:new THREE.CircleGeometry(1,24),cyl:new THREE.CylinderGeometry(0.5,0.7,1,10),box:new THREE.BoxGeometry(1,1,1)};
G.ring.rotateX(-Math.PI/2);G.disc.rotateX(-Math.PI/2);
// Creature/prop material: smooth-shaded with a soft icy highlight (pass flatShading:true for faceted ice)
const mat=(c,o={})=>new THREE.MeshPhongMaterial({color:c,shininess:55,specular:0x4a6a88,...o});
const bmat=(c,o={})=>new THREE.MeshBasicMaterial({color:c,...o});
// Procedural canvas textures (no image files): snow grain, cracked ice, water caustics
function makeTex(draw,rep=1,size=128){const c=document.createElement('canvas');c.width=c.height=size;draw(c.getContext('2d'),size);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep,rep);t.colorSpace=THREE.SRGBColorSpace;return t;}
const snowTex=makeTex((g,n)=>{g.fillStyle='#fff';g.fillRect(0,0,n,n);for(let i=0;i<2600;i++){g.fillStyle=i%9?'rgba(140,185,220,.22)':'rgba(90,150,200,.35)';const r=1+Math.random()*2.5;g.fillRect(Math.random()*n,Math.random()*n,r,r);}
  g.strokeStyle='rgba(120,175,215,.3)';for(let i=0;i<7;i++){g.beginPath();g.arc(Math.random()*n,Math.random()*n,10+Math.random()*24,0,2+Math.random()*2);g.stroke();}},56,256);
const iceTex=makeTex((g,n)=>{g.fillStyle='#f2fbff';g.fillRect(0,0,n,n);g.lineWidth=2;for(let i=0;i<14;i++){g.strokeStyle=i%2?'rgba(70,150,210,.55)':'rgba(255,255,255,.9)';let x=Math.random()*n,y=Math.random()*n;g.beginPath();g.moveTo(x,y);
  for(let k=0;k<5;k++){x+=(Math.random()-.5)*50;y+=(Math.random()-.5)*50;g.lineTo(x,y);}g.stroke();}},2);
const waterTex=makeTex((g,n)=>{g.fillStyle='#cfeeff';g.fillRect(0,0,n,n);g.lineWidth=3;g.strokeStyle='rgba(255,255,255,.75)';for(let i=0;i<16;i++){g.beginPath();g.ellipse(Math.random()*n,Math.random()*n,8+Math.random()*18,4+Math.random()*8,Math.random()*3,0,6.3);g.stroke();}},36);
function part(parent,geo,m,x,y,z,sx=1,sy=sx,sz=sx){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.userData.m=m;parent.add(o);return o;}

// Global state + extension hooks. Later sections push into `systems` and override `actions`/`fx`.
const game={started:false,paused:false,time:0,shake:0,hitstop:0,zone:''};
const systems=[];                      // per-frame updaters: fn(dt)
const onStart=[];                      // run inside the Play tap (audio unlock etc.)
const actions={attack(){},shard(){},dash(){},nova(){},jump(){},dive(){},almanac(){}};
const cds={atk:0,shard:0,dash:0,nova:0};
const cdMax={shard:1.2,dash:2,nova:6};
const cost={shard:15,dash:20,nova:35};
const fx={burst(){},number(){},sfx(){},shake(a){game.shake=Math.max(game.shake,a)},hitstop(t){game.hitstop=Math.max(game.hitstop,t)}};
let gainXP=()=>{},onKill=()=>{},onLand=()=>{},animForm=()=>{};
function toast(t){const el=$('toast');el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}

// ======================= [WORLD] =======================
const WORLD=400,HALF=200,SEG=192,CELL=WORLD/SEG,BOUND=190;
const BOSS_LAIR={x:118,z:-128};
const ABYSS={x:-128,z:112,r:27};      // hidden trench: only reachable by diving (Frost Hydra lair)
// Ice floes: flat stepping areas out in the sea (first one is the checkpoint near the boss lair)
const floes=[{x:86,z:-94,r:9}];
for(let i=0;i<16;i++){const a=rr(0,TAU),d=rr(118,168),f={x:Math.cos(a)*d,z:Math.sin(a)*d,r:rr(6,11)};
  if(Math.hypot(f.x-BOSS_LAIR.x,f.z-BOSS_LAIR.z)>40&&Math.hypot(f.x-ABYSS.x,f.z-ABYSS.z)>ABYSS.r+14)floes.push(f);}
// Height field: wobbly island (Iceberg Fields) → shoreline → sea bed (Polar Sea, h<0)
function rawHeight(x,z){
  const d=Math.hypot(x,z),a=Math.atan2(z,x);
  const R=95+16*Math.sin(3*a+1)+9*Math.sin(5*a+2.3);
  const base=(R-d)*0.12;let h;
  if(base>0){const n=Math.sin(x*0.13+1.7)*Math.cos(z*0.11+0.4)+0.5*Math.sin(x*0.31+z*0.27);h=Math.min(base,1.4)+(n+1.5)*0.8*Math.min(base,1);}
  else h=Math.max(base*1.4,-7);
  for(const f of floes){if(Math.hypot(x-f.x,z-f.z)<f.r)h=Math.max(h,0.5);}
  const ad=Math.hypot(x-ABYSS.x,z-ABYSS.z);if(ad<ABYSS.r){const k=1-ad/ABYSS.r;h=Math.min(h,-7-24*k*k*(3-2*k));}
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
  scene.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,map:snowTex})));
}
// Bilinear ground sample matching the terrain mesh
function groundAt(x,z){
  const fx=clamp((x+HALF)/CELL,0,SEG-0.001),fz=clamp((z+HALF)/CELL,0,SEG-0.001),i=fx|0,j=fz|0,u=fx-i,v=fz-j,k=j*N1+i;
  return lerp(lerp(heights[k],heights[k+1],u),lerp(heights[k+N1],heights[k+N1+1],u),v);
}
// Water: translucent animated vertex-wave plane
const waterGeo=new THREE.PlaneGeometry(WORLD+60,WORLD+60,64,64);waterGeo.rotateX(-Math.PI/2);
const water=new THREE.Mesh(waterGeo,new THREE.MeshPhongMaterial({color:0x2a90c4,transparent:true,opacity:0.74,flatShading:true,map:waterTex,side:THREE.DoubleSide,shininess:60,specular:0x99ddff}));
scene.add(water);
// Icebergs (instanced, also circle colliders) + crystals (instanced, decorative glow)
const obstacles=[];
{
  const n=46,im=new THREE.InstancedMesh(G.dode,mat(0xcdeeff,{map:iceTex,flatShading:true}),n),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),s=new THREE.Vector3(),p=new THREE.Vector3();
  let k=0,guard=0;
  while(k<n&&guard++<999){const a=rr(0,TAU),d=rr(16,182),x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)<34||Math.hypot(x-ABYSS.x,z-ABYSS.z)<ABYSS.r+6||floes.some(f=>Math.hypot(x-f.x,z-f.z)<f.r+5))continue;
    const r=rr(2,5),g=groundAt(x,z);p.set(x,Math.max(g,-0.6)+r*0.5,z);e.set(rr(-.3,.3),rr(0,TAU),rr(-.3,.3));q.setFromEuler(e);s.set(r,r*rr(1.2,2.4),r);
    m4.compose(p,q,s);im.setMatrixAt(k++,m4);obstacles.push({x,z,r:r*0.9});}
  im.count=k;scene.add(im);
  const cn=70,cm=new THREE.InstancedMesh(G.oct,mat(0x6ff0ff,{emissive:0x1aa0c8,flatShading:true}),cn);
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
const auroraMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,uniforms:{t:{value:0},a:{value:0.45}},
  vertexShader:`uniform float t;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*0.03+t*0.6)*18.0;p.y+=sin(p.x*0.05+t*0.4)*7.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
  fragmentShader:`uniform float t,a;varying vec2 vUv;void main(){vec3 a=vec3(0.25,1.0,0.6),b=vec3(0.65,0.4,1.0);vec3 c=mix(a,b,0.5+0.5*sin(vUv.x*9.0+t*0.5));
    float al=pow(sin(vUv.y*3.1416),1.5)*(0.35+0.25*sin(vUv.x*40.0+t*1.3))*sin(vUv.x*3.1416);gl_FragColor=vec4(c,al*a*2.0);}`});
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
  if(Math.hypot(x-ABYSS.x,z-ABYSS.z)<ABYSS.r&&player.pos.y<-6)return 'The Abyss';
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
  swim:false,iframes:0,dead:false,deadT:0,checkpoint:0,dashT:0,dvx:0,dvz:0,atkAnim:0,combo:0,lastAtk:-9,target:null,walk:0,
  vy:0,air:false,jumps:0,stam:3,dive:false,under:false,breath:40,slideT:0,slam:false,wallT:0,wnx:0,wnz:1,mdx:0,mdz:-1,moving:false,anim:'',animT:0,animD:1};
// pm = world transform, pbody = animated wrapper, glBody = Glacira parts, morphBody = current morph (see [MORPH])
const pm=new THREE.Group(),pbody=new THREE.Group(),glBody=new THREE.Group(),morphBody=new THREE.Group();pm.add(pbody);pbody.add(glBody,morphBody);scene.add(pm);
const M={navy:mat(0x2b4f8a),white:mat(0xf4fbff),orange:mat(0xffa23a),dark:mat(0x10203a),ice:mat(0x7ff3ff,{emissive:0x1c8fb0})};
part(glBody,G.sph,M.navy,0,0.85,0,0.72,0.78,1.1);
part(glBody,G.sph,M.white,0,0.72,0.16,0.58,0.62,0.92);
part(glBody,G.sph,M.navy,0,1.38,0.72,0.47);
part(glBody,G.sph,M.white,0,1.3,0.86,0.36,0.34,0.36);
part(glBody,G.cone,M.orange,0,1.3,1.28,0.3,0.45,0.3).rotation.x=Math.PI/2;
part(glBody,G.sph,M.dark,0.24,1.5,1.02,0.07);part(glBody,G.sph,M.dark,-0.24,1.5,1.02,0.07);
part(glBody,G.cone,M.ice,0,1.95,0.6,0.3,0.6,0.3).rotation.x=-0.4;
part(glBody,G.cone,M.ice,0,1.5,-0.5,0.3,0.5,0.3).rotation.x=-0.9;
const flipL=part(glBody,G.sph,M.navy,0.78,0.85,0.1,0.13,0.5,0.32),flipR=part(glBody,G.sph,M.navy,-0.78,0.85,0.1,0.13,0.5,0.32);
const tail=part(glBody,G.cone,M.navy,0,0.6,-1.2,0.9,0.9,0.25);tail.rotation.x=-Math.PI/2;
const blob=part(scene,G.disc,bmat(0x0a2540,{transparent:true,opacity:0.28,depthWrite:false}),0,0,0,1.1);

let camYaw=0,camPitch=0.42;const camT=new THREE.Vector3(0,2,4),tmpV=new THREE.Vector3();
const input={jx:0,jy:0},keys={},held={};

// Current morph modifiers (replaced by setForm in [MORPH])
let form={speed:1,swim:1,armor:1,bite:1,shardN:1,nova:1,jump:1,xp:1};
const SURF=-0.55,MAXBREATH=40;
function killPlayer(){const p=player;p.hp=0;p.dead=true;p.deadT=1.8;p.dive=false;pm.visible=false;fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0x7ff3ff,30);toast('Defeated…');}
function respawn(){const p=player,t=totems[p.checkpoint];p.dead=false;p.hp=p.maxHp;p.en=p.maxEn;p.pos.set(t.x,t.y,t.z+2.5);p.kx=p.kz=p.vx=p.vz=p.vy=0;
  p.air=p.slam=p.dive=false;p.breath=MAXBREATH;p.stam=3;p.iframes=2;pm.visible=true;toast('Revived at totem');}
function setAnim(n,d){player.anim=n;player.animT=player.animD=d;}
function land(){const p=player;p.air=false;p.vy=0;p.jumps=0;setAnim('land',0.18);
  if(groundAt(p.pos.x,p.pos.z)<-0.6){fx.burst(p.pos.x,0.1,p.pos.z,0xffffff,14,6);fx.sfx('dash');}else fx.burst(p.pos.x,p.pos.y+.1,p.pos.z,0xffffff,6,3);
  if(p.slam){p.slam=false;onLand();}}
// Movement model: momentum-based. Ground = snappy accel; air + post-dash slide keep momentum, so
// dash → jump carries speed (dash-jump), and icebergs can be wall-jumped. Stamina (3 pips) fuels dash + double jump.
function updatePlayer(dt){
  const p=player;
  if(p.dead){p.deadT-=dt;if(p.deadT<=0)respawn();return;}
  let mx=input.jx+(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),my=input.jy+(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0);
  if(keys.KeyQ)camYaw+=dt*2;if(keys.KeyE)camYaw-=dt*2;
  const mag=Math.min(1,Math.hypot(mx,my));
  const g=groundAt(p.pos.x,p.pos.z);
  p.swim=g<-0.6&&p.pos.y<0.4;p.under=p.pos.y<-1.3;
  if(p.dive&&g>-2.2)p.dive=false;
  const speed=(p.swim?7.5*form.swim:9.5)*form.speed;let tvx=0,tvz=0;p.moving=mag>0.1;
  if(p.moving){
    const fx_=-Math.sin(camYaw),fz=-Math.cos(camYaw),rx=Math.cos(camYaw),rz=-Math.sin(camYaw);   // camera-relative
    let dx=fx_*-my+rx*mx,dz=fz*-my+rz*mx;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;p.mdx=dx;p.mdz=dz;
    p.yaw=angLerp(p.yaw,Math.atan2(dx,dz),Math.min(1,dt*(p.swim?6:14)));          // swimming turns slower
    const ax=p.swim?Math.sin(p.yaw):dx,az=p.swim?Math.cos(p.yaw):dz;              // ...and moves along its heading
    tvx=ax*speed*mag;tvz=az*speed*mag;camYaw-=mx*dt*0.8;p.walk+=dt*mag;
  }
  if(p.dashT>0){p.dashT-=dt;p.vx=p.dvx;p.vz=p.dvz;if(p.dashT<=0){p.slideT=0.5;p.vx*=0.62;p.vz*=0.62;}}
  else{p.slideT-=dt;const loose=p.air||p.slideT>0;
    if(loose&&!p.moving){const dr=Math.exp(-dt*(p.air?0.3:2.2));p.vx*=dr;p.vz*=dr;}
    else{const k=Math.min(1,dt*(p.air?2.4:p.slideT>0?3:p.swim?5:13));p.vx=lerp(p.vx,tvx,k);p.vz=lerp(p.vz,tvz,k);}
    if(p.slideT>0&&!p.air&&!p.swim&&Math.hypot(p.vx,p.vz)>11)fx.burst(p.pos.x,p.pos.y+.1,p.pos.z,0xffffff,1,2);}   // slide spray
  let nx=p.pos.x+(p.vx+p.kx)*dt,nz=p.pos.z+(p.vz+p.kz)*dt;const kd=Math.exp(-dt*9);p.kx*=kd;p.kz*=kd;p.wallT-=dt;
  for(const o of obstacles){const dx=nx-o.x,dz=nz-o.z,d=Math.hypot(dx,dz),m=o.r+0.7;if(d<m&&d>1e-4){nx=o.x+dx/d*m;nz=o.z+dz/d*m;p.wallT=0.22;p.wnx=dx/d;p.wnz=dz/d;}}
  const d=Math.hypot(nx,nz);if(d>BOUND){nx*=BOUND/d;nz*=BOUND/d;}
  p.pos.x=nx;p.pos.z=nz;
  // vertical: dive / surface / airborne / grounded
  const g2=groundAt(nx,nz),w2=g2<-0.6,floor=w2?SURF+Math.sin(game.time*3)*0.08:g2;
  if(p.dive&&w2){p.pos.y=Math.max(g2+0.6,p.pos.y+clamp(g2+1.3-p.pos.y,-9*dt,9*dt));p.vy=0;p.air=false;}
  else if(w2&&!p.air&&p.pos.y<floor-0.15)p.pos.y=Math.min(floor,p.pos.y+10*dt);
  else if(p.air){p.vy=p.slam?-42:p.vy-32*dt;p.pos.y+=p.vy*dt;if(p.pos.y<=floor&&p.vy<=0){p.pos.y=floor;land();}}
  else if(p.pos.y>floor+0.7){p.air=true;p.vy=0;p.jumps=1;}
  else p.pos.y=lerp(p.pos.y,floor,Math.min(1,dt*14));
  // stats
  if(p.under){p.breath-=dt;if(p.breath<=0){p.hp-=dt*14;if(p.hp<=0){killPlayer();return;}}}else p.breath=Math.min(MAXBREATH,p.breath+dt*16);
  p.stam=Math.min(3,p.stam+dt/1.4);
  p.en=Math.min(p.maxEn,p.en+dt*10);p.hp=Math.min(p.maxHp,p.hp+dt*1.2);p.iframes-=dt;p.atkAnim-=dt;
  for(const k in cds)cds[k]=Math.max(0,cds[k]-dt);
  for(const k in held)if(held[k])actions[k]();
  for(let i=0;i<totems.length;i++){const t=totems[i];if(i!==p.checkpoint&&Math.hypot(nx-t.x,nz-t.z)<3.5){
    totems[p.checkpoint].top.material=totemOff;p.checkpoint=i;t.top.material=totemOn;p.hp=p.maxHp;toast('Checkpoint!');fx.sfx('level');}}
  const z=zoneAt(nx,nz,g2);if(z!==game.zone){game.zone=z;toast(z);}
  // --- model animation: locomotion pose + one-shot move animations (setAnim) ---
  const moving=Math.min(1,Math.hypot(p.vx,p.vz)/speed),t=game.time;
  pm.position.copy(p.pos);pm.rotation.y=p.yaw;
  let rx=p.under?0.5:p.swim?0.25:0,ry=0,rz=p.swim?Math.sin(t*2.2)*0.12:Math.sin(p.walk*13)*0.14*moving,py=0,pz=0,sx=1,sy=1,sz=1;
  if(p.air)rx+=clamp(-p.vy*0.035,-0.6,0.8);
  if(p.slideT>0&&!p.air&&!p.swim)rx-=0.32;                                      // lean back while sliding
  if(p.atkAnim>0){const s=Math.sin(p.atkAnim/0.2*Math.PI);rx+=0.5*s;pz=0.7*s;}   // bite lunge
  if(p.animT>0){p.animT-=dt;const k=1-clamp(p.animT/p.animD,0,1),s=Math.sin(k*Math.PI);
    if(p.anim==='shard'){rx-=0.5*s;pz-=0.45*s;}                                  // rear back + recoil
    else if(p.anim==='dash'){rz+=k*TAU;sz=1+0.45*s;sx=sy=1-0.15*s;}              // barrel roll
    else if(p.anim==='nova'){py=1.4*s;ry=k*TAU*2;sx=sy=sz=1+0.25*s;}             // leaping spin
    else if(p.anim==='jump'){sy=1+0.3*s;sx=sz=1-0.12*s;}
    else if(p.anim==='flip'){rx+=k*TAU;}                                         // double jump / slam flip
    else if(p.anim==='land'){sy=1-0.3*s;sx=sz=1+0.16*s;}
    else if(p.anim==='morph'){ry=k*TAU*3;sx=sy=sz=0.25+0.75*k;}}
  pbody.rotation.set(rx,ry,rz);pbody.position.set(0,py,pz);pbody.scale.set(sx,sy,sz);
  const flap=p.swim?Math.sin(t*6)*0.6*(0.3+moving):p.air?0.9:Math.sin(p.walk*13)*0.4*moving;
  flipL.rotation.z=-0.3-flap;flipR.rotation.z=0.3+flap;tail.rotation.y=Math.sin(t*(p.swim?7:3))*0.3;
  animForm(t);
  pm.visible=p.iframes<=0||p.dashT>0||((t*20)|0)%2===0;
  blob.visible=!w2;blob.position.set(nx,g2+0.06,nz);blob.scale.setScalar(1.1/(1+Math.max(0,p.pos.y-g2)*0.12));
}
function updateCamera(dt){
  const p=player.pos;camT.lerp(tmpV.set(p.x,p.y+1.7,p.z),Math.min(1,dt*9));
  const dist=11.5,cp=Math.cos(camPitch);
  const cx=camT.x+Math.sin(camYaw)*dist*cp,cz=camT.z+Math.cos(camYaw)*dist*cp;
  let cy=Math.max(camT.y+Math.sin(camPitch)*dist,groundAt(cx,cz)+1.2);if(!player.under)cy=Math.max(cy,1);
  const tf=player.dashT>0?74:60+Math.min(8,Math.hypot(player.vx,player.vz)*0.3);                // speed FOV kick
  if(Math.abs(camera.fov-tf)>0.05){camera.fov=lerp(camera.fov,tf,Math.min(1,dt*7));camera.updateProjectionMatrix();}
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
  for(const [id,name] of [['bAtk','attack'],['bShard','shard'],['bDash','dash'],['bNova','nova'],['bJump','jump'],['bDive','dive']]){
    const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();cap(b,e);b.classList.add('down');if(name==='attack')held.attack=true;if(game.started&&!game.paused)actions[name]();});
    const up=()=>{b.classList.remove('down');if(name==='attack')held.attack=false;};
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);
  }
  const keyAct={KeyJ:'attack',KeyK:'shard',KeyL:'dash',ShiftLeft:'dash',KeyI:'nova',Space:'jump',KeyF:'dive'};
  addEventListener('keydown',e=>{keys[e.code]=true;const a=keyAct[e.code];if(a&&game.started&&!game.paused&&!e.repeat){e.preventDefault();if(a==='attack')held.attack=true;actions[a]();}
    if(e.code==='KeyP'||e.code==='Escape')setPaused(!game.paused);if(e.code==='Enter'&&!game.started)start();if(e.code==='KeyM'&&game.started)actions.almanac();});
  addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyJ')held.attack=false;});
  // Mobile Safari: kill scroll / pinch / double-tap zoom / long-press menu once playing
  const stop=e=>{if(game.started&&!(e.target.closest&&e.target.closest('#almanac')))e.preventDefault();};
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
const abBtn={shard:$('bShard'),nova:$('bNova')},dashBtn=$('bDash'),diveBtn=$('bDive'),stamEl=[...$('stam').children],breathBar=$('breathBar'),breathEl=$('breath');
let xpNeed=()=>50;
function updateHud(){
  const p=player;hudEl.hp.style.transform=`scaleX(${clamp(p.hp/p.maxHp,0,1)})`;hudEl.en.style.transform=`scaleX(${p.en/p.maxEn})`;
  hudEl.xp.style.transform=`scaleX(${clamp(p.xp/xpNeed(),0,1)})`;
  hudEl.tint.classList.toggle('on',p.swim&&game.started);
  hudEl.tint.classList.toggle('deep',p.under);
  dashBtn.style.setProperty('--cd',p.stam>=1?0:(1-p.stam).toFixed(3));
  for(let i=0;i<3;i++)stamEl[i].style.transform=`scaleX(${clamp(p.stam-i,0,1)})`;
  diveBtn.classList.toggle('hidden',!(p.swim&&groundAt(p.pos.x,p.pos.z)<-2.2));diveBtn.classList.toggle('on',p.dive);
  breathBar.classList.toggle('hidden',p.breath>=MAXBREATH);breathEl.style.transform=`scaleX(${clamp(p.breath/MAXBREATH,0,1)})`;
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
  if(e.type.leash&&Math.hypot(nx-e.home.x,nz-e.home.z)>e.type.leash)return false;
  if((e.type.sea?g<-1:g>-0.3)&&Math.hypot(nx,nz)<BOUND){e.pos.x=nx;e.pos.z=nz;return true;}return false;}
function setFlash(e,on){e.body.traverse(o=>{if(o.isMesh)o.material=on?whiteMat:o.userData.m;});}
function hurtPlayer(d,fx_,fz){
  const p=player;if(p.dead||p.iframes>0)return;
  d*=form.armor;p.hp-=d;p.iframes=0.5;const dx=p.pos.x-fx_,dz=p.pos.z-fz,l=Math.hypot(dx,dz)||1;p.kx+=dx/l*12;p.kz+=dz/l*12;
  fx.shake(0.5);fx.sfx('hurt');fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xff6677,8);fx.number(p.pos,'-'+Math.round(d),'#ff7080');
  hudEl.hurt.style.opacity=1;setTimeout(()=>hudEl.hurt.style.opacity=0,150);
  if(p.hp<=0)killPlayer();
}
const dmgMul=()=>1+0.15*(player.lvl-1);
function hitEnemy(e,dmg,kx,kz,heavy){
  if(e.dead||Math.abs(e.pos.y-player.pos.y)>6)return;dmg=Math.round(dmg);   // depth-gated: surface and deep fights don't mix
  e.hp-=dmg;e.flash=0.1;setFlash(e,true);
  const kb=(heavy?16:8)/Math.max(1,e.type.radius);e.kx+=kx*kb;e.kz+=kz*kb;
  if(e.state==='idle')e.state='chase';
  e.bar.visible=!e.type.boss;e.bar.scale.set(2.2*Math.max(0,e.hp/e.type.hp),0.22,1);
  fx.number(e.pos,dmg,heavy?'#ffe066':'#fff',e.type.radius*1.5+1);fx.burst(e.pos.x,e.pos.y+e.type.radius,e.pos.z,0xbff4ff,heavy?14:7);fx.sfx(heavy?'heavy':'hit');
  if(heavy){fx.hitstop(0.07);fx.shake(0.35);}
  if(e.hp<=0){e.dead=true;e.mesh.visible=false;e.sp.timer=e.type.respawn||28;fx.burst(e.pos.x,e.pos.y+1,e.pos.z,0xffffff,e.type.boss?80:24);fx.sfx('kill');
    if(player.target===e)player.target=null;onKill(e);gainXP(e.type.xp);if(e.type.boss){toast(e.type.name+' defeated!');fx.shake(1);}}
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
  else if(T.kind==='shoot'){spawnShot(e.pos.x,T.deep?e.pos.y+0.4:0.5,e.pos.z,ux*12,uz*12,T.dmg,true,2.4);fx.sfx('shoot');}
  else if(T.kind==='boss'){const n=e.hp<T.hp*0.5?16:10,o=rr(0,TAU);for(let i=0;i<n;i++){const a=o+i/n*TAU;spawnShot(e.pos.x,T.deep?e.pos.y+0.2:0.5,e.pos.z,Math.sin(a)*11,Math.cos(a)*11,T.dmg*0.6,true,3);}fx.sfx('slam');fx.shake(0.3);}
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
    else if(T.flee){moveEnemy(e,-ux*T.speed*sm,-uz*T.speed*sm,dt)||moveEnemy(e,-uz*T.speed*sm,ux*T.speed*sm,dt);fyaw=Math.atan2(-ux,-uz);}   // rare creatures run
    else if(dist>T.range){if(!moveEnemy(e,ux*T.speed*sm,uz*T.speed*sm,dt)&&T.kind==='shoot'&&dist<T.range*1.6){e.state='windup';e.t=T.windup;}e.circ=0;}
    else if(T.circle&&e.circ<T.circle){e.circ+=dt;moveEnemy(e,(-uz+ux*0.15)*T.speed*sm,(ux+uz*0.15)*T.speed*sm,dt);}   // circle the player before striking
    else{e.state='windup';e.t=T.windup/sm;e.t0=e.t;}
  }else if(e.state==='windup'){
    fyaw=Math.atan2(ux,uz);const k=1-clamp(e.t/(e.t0||T.windup),0,1);
    e.ring.visible=e.fill.visible=true;e.fill.scale.setScalar(Math.max(0.01,T.tele*k));e.ring.position.y=e.fill.position.y=(T.deep?-1.7:T.sea?0.3-e.pos.y:0.15);
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
  e.pos.y=T.deep?groundAt(e.pos.x,e.pos.z)+2:T.sea?(T.swimY||-0.4)+Math.sin(game.time*2+e.home.x)*0.12:groundAt(e.pos.x,e.pos.z);
  if(T.anim)T.anim(e,game.time);else e.body.position.y=e.state==='idle'?0:Math.abs(Math.sin(game.time*9+e.home.z))*0.18;
  if(e.flash>0){e.flash-=dt;if(e.flash<=0)setFlash(e,false);}
}
const targetRing=part(scene,G.ring,bmat(0x7ff3ff,{transparent:true,opacity:0.9,depthWrite:false}),0,-50,0,1.5);
systems.push(dt=>{
  const p=player;let best=null,bs=1e9;const fx_=Math.sin(p.yaw),fz=Math.cos(p.yaw);
  for(const e of enemies){
    if(e.dead){e.sp.timer-=dt;if(e.sp.timer<=0&&Math.hypot(p.pos.x-e.home.x,p.pos.z-e.home.z)>35)resetEnemy(e);continue;}
    const dx=p.pos.x-e.pos.x,dz=p.pos.z-e.pos.z;let dist=Math.hypot(dx,dz);
    if(dist>120){e.mesh.visible=false;continue;}e.mesh.visible=true;
    if(Math.abs(p.pos.y-e.pos.y)>6)dist+=300;            // different depth layer: can't see or reach each other
    updateEnemy(e,dt,dx,dz,dist);
    // soft lock-on: nearest enemy, biased to what the player is facing
    if(dist<18+e.type.radius){const ang=Math.acos(clamp((-dx*fx_-dz*fz)/(dist||1),-1,1));if(ang<1.9||dist<5){const s=dist+ang*4;if(s<bs){bs=s;best=e;}}}
  }
  p.target=best;
  if(best){targetRing.visible=true;targetRing.position.set(best.pos.x,best.type.deep?best.pos.y-1.7:Math.max(best.pos.y,0)+0.2,best.pos.z);targetRing.scale.setScalar(best.type.radius+0.7+Math.sin(game.time*8)*0.1);}else targetRing.visible=false;
  // projectiles
  for(const s of shots){if(!s.active)continue;s.life-=dt;const m=s.mesh.position;
    if(!s.hostile&&s.target&&!s.target.dead){const tx=s.target.pos.x-m.x,tz=s.target.pos.z-m.z,l=Math.hypot(tx,tz)||1,sp=Math.hypot(s.vx,s.vz);s.vx=lerp(s.vx,tx/l*sp,dt*8);s.vz=lerp(s.vz,tz/l*sp,dt*8);}
    m.x+=s.vx*dt;m.z+=s.vz*dt;s.mesh.rotation.y=Math.atan2(s.vx,s.vz);
    let done=s.life<=0;
    if(s.hostile){if(Math.hypot(m.x-p.pos.x,m.z-p.pos.z)<1.2&&Math.abs(m.y-p.pos.y-0.6)<2.6&&!p.dead&&p.iframes<=0){hurtPlayer(s.dmg,m.x-s.vx,m.z-s.vz);done=true;}}
    else for(const e of enemies){if(!e.dead&&Math.hypot(m.x-e.pos.x,m.z-e.pos.z)<e.type.radius+0.8){const l=Math.hypot(s.vx,s.vz);hitEnemy(e,s.dmg,s.vx/l,s.vz/l,false);done=true;break;}}
    if(done){s.active=false;s.mesh.visible=false;fx.burst(m.x,m.y,m.z,s.hostile?0xff9ad0:0x9ff6ff,6);}
  }
  slash.visible=p.atkAnim>0.08;if(slash.visible)slash.position.copy(p.pos).y+=0.9;
});
// --- Move VFX: pooled shock rings, ice fangs (Bite), water streak (Dash), erupting ice spikes (Nova / Slam) ---
const rings=[];for(let i=0;i<5;i++){const m=part(scene,G.ring,bmat(0xffffff,{transparent:true,depthWrite:false,side:THREE.DoubleSide}),0,-99,0,1);m.visible=false;rings.push({m,t:0,d:1,r:1});}
let ringI=0;
function ringFx(x,y,z,color,r,d=0.4){const o=rings[ringI=(ringI+1)%rings.length];o.m.position.set(x,y,z);o.m.material.color.setHex(color);o.t=o.d=d;o.r=r;o.m.visible=true;}
const fangMat=mat(0xeafcff,{emissive:0x3aa8d8,transparent:true,opacity:0.95});
const fangs=new THREE.Group(),jawU=new THREE.Group(),jawL=new THREE.Group();fangs.add(jawU,jawL);fangs.visible=false;scene.add(fangs);let fangT=0;
for(let i=0;i<5;i++){const x=(i-2)*0.55,s=i===2?1.3:1-Math.abs(i-2)*0.12;part(jawU,G.cone,fangMat,x,1,1.2,0.42,1.3*s,0.42).rotation.x=Math.PI;part(jawL,G.cone,fangMat,x,-1,1.2,0.42,1.1*s,0.42);}
const streak=part(scene,G.cone,bmat(0x7fd8ff,{transparent:true,opacity:0.45,depthWrite:false}),0,-99,0,1.7,6.5,1.7);streak.rotation.order='YXZ';streak.visible=false;
const SPK=14,spikes=new THREE.InstancedMesh(G.cone,mat(0xd8f8ff,{emissive:0x2a90c8,transparent:true,opacity:0.92}),SPK);spikes.frustumCulled=false;spikes.visible=false;scene.add(spikes);
const spk={t:0,d:0.5,r:8,x:0,y:0,z:0},_m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_s=new THREE.Vector3(),_p=new THREE.Vector3();
function spikeFx(x,y,z,r,d=0.5){spk.t=spk.d=d;spk.r=r;spk.x=x;spk.y=y;spk.z=z;spikes.visible=true;}
systems.push(dt=>{
  const p=player;
  for(const o of rings){if(o.t<=0)continue;o.t-=dt;const k=1-Math.max(0,o.t)/o.d;o.m.scale.setScalar(0.5+k*o.r);o.m.material.opacity=1-k;if(o.t<=0)o.m.visible=false;}
  if(fangT>0){fangT-=dt;const a=0.7*(1-Math.min(1,(1-fangT/0.24)*2.4));jawU.rotation.x=0.3-a*1.4;jawL.rotation.x=-(0.3-a*1.4);fangMat.opacity=Math.min(1,fangT*9);if(fangT<=0)fangs.visible=false;}
  streak.visible=p.dashT>0;if(streak.visible){streak.position.set(p.pos.x-Math.sin(p.yaw)*3.2,p.pos.y+0.8,p.pos.z-Math.cos(p.yaw)*3.2);streak.rotation.set(-Math.PI/2,p.yaw,0);}
  if(spk.t>0){spk.t-=dt;const k=1-Math.max(0,spk.t)/spk.d,h=Math.sin(k*Math.PI)*3.4+0.01,r=spk.r*(0.3+0.7*k);
    for(let i=0;i<SPK;i++){const a=i/SPK*TAU+k;_p.set(spk.x+Math.cos(a)*r,spk.y+h*0.5,spk.z+Math.sin(a)*r);_s.set(0.9,h,0.9);_m.compose(_p,_q,_s);spikes.setMatrixAt(i,_m);}
    spikes.instanceMatrix.needsUpdate=true;if(spk.t<=0)spikes.visible=false;}
  for(const s of shots)if(s.active&&!s.hostile){s.mesh.rotation.z+=dt*18;if(Math.random()<0.6)fx.burst(s.mesh.position.x,s.mesh.position.y,s.mesh.position.z,0xbff6ff,1,1.5);}   // shard trail
});
// --- Player abilities ---
const slash=new THREE.Mesh(new THREE.TorusGeometry(2.4,0.13,6,20,Math.PI*0.9),bmat(0xe8fbff,{transparent:true,opacity:0.85}));slash.visible=false;scene.add(slash);
const faceTarget=()=>{const p=player,t=p.target;if(t)p.yaw=Math.atan2(t.pos.x-p.pos.x,t.pos.z-p.pos.z);};
const spend=k=>{const p=player;if(p.dead||cds[k]>0||p.en<cost[k])return false;p.en-=cost[k];cds[k]=cdMax[k];return true;};
// Attack: 3-hit ice-bite combo (3rd is heavy). In mid-air it becomes a Glacier Slam: plunge + AoE on landing.
actions.attack=()=>{
  const p=player;if(p.dead||cds.atk>0||p.dashT>0||p.slam)return;
  if(p.air&&p.pos.y>Math.max(groundAt(p.pos.x,p.pos.z),SURF)+2.2){p.slam=true;cds.atk=0.4;setAnim('flip',0.25);fx.sfx('lunge');return;}
  cds.atk=0.3;p.combo=(game.time-p.lastAtk<0.85)?(p.combo+1)%3:0;p.lastAtk=game.time;faceTarget();
  const fx_=Math.sin(p.yaw),fz=Math.cos(p.yaw),heavy=p.combo===2;p.kx+=fx_*7;p.kz+=fz*7;p.atkAnim=0.2;
  slash.rotation.set(Math.PI/2,0,0.05*Math.PI-p.yaw);slash.scale.setScalar(heavy?1.3:1);fx.sfx('swing');
  fangs.visible=true;fangT=0.24;fangs.position.set(p.pos.x+fx_*2.3,p.pos.y+1,p.pos.z+fz*2.3);fangs.rotation.y=p.yaw;fangs.scale.setScalar(heavy?1.5:1);
  for(const e of enemies){if(e.dead)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz);
    if(d>(heavy?4.4:3.8)+e.type.radius)continue;if((dx*fx_+dz*fz)/(d||1)<0.15&&d>1.6+e.type.radius)continue;
    hitEnemy(e,(heavy?20:10)*dmgMul()*form.bite,fx_,fz,heavy);}
};
onLand=()=>{const p=player;ringFx(p.pos.x,p.pos.y+0.3,p.pos.z,0xcff6ff,9,0.45);spikeFx(p.pos.x,p.pos.y,p.pos.z,5,0.4);fx.shake(0.6);fx.sfx('slam');fx.burst(p.pos.x,p.pos.y+.4,p.pos.z,0xffffff,26,9);
  for(const e of enemies){if(e.dead)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1;if(d<6+e.type.radius)hitEnemy(e,24*dmgMul()*form.bite,dx/d,dz/d,true);}};
// Ice Shard: homing projectile(s) at the locked target
actions.shard=()=>{if(!spend('shard'))return;const p=player;faceTarget();setAnim('shard',0.28);
  const y=(p.under?p.pos.y:Math.max(p.pos.y,0))+0.9,n=form.shardN;
  for(let i=0;i<n;i++){const a=p.yaw+(i-(n-1)/2)*0.24,fx_=Math.sin(a),fz=Math.cos(a);spawnShot(p.pos.x+fx_,y,p.pos.z+fz,fx_*32,fz*32,16*dmgMul(),false,1.2,p.target);}
  ringFx(p.pos.x+Math.sin(p.yaw)*1.5,y,p.pos.z+Math.cos(p.yaw)*1.5,0x9ff6ff,2.5,0.25);fx.sfx('shard');};
// Tidal Dash: costs 1 stamina. Goes where the stick points, works in the air (air dash) and underwater; i-frames.
actions.dash=()=>{const p=player;if(p.dead||p.stam<1||cds.dash>0)return;p.stam-=1;cds.dash=0.3;
  const dx=p.moving?p.mdx:Math.sin(p.yaw),dz=p.moving?p.mdz:Math.cos(p.yaw),sp=p.swim?40:34;p.yaw=Math.atan2(dx,dz);
  p.dashT=0.24;p.dvx=dx*sp;p.dvz=dz*sp;p.iframes=0.4;if(p.air)p.vy=Math.max(p.vy,3);setAnim('dash',0.26);
  fx.burst(p.pos.x,p.pos.y+.6,p.pos.z,0x66c8ff,16);ringFx(p.pos.x,p.pos.y+0.8,p.pos.z,0x8fdcff,4,0.3);fx.sfx('dash');};
// Jump: ground jump → free wall-jump off icebergs → double jump (1 stamina). In water: leap; while diving: surface.
actions.jump=()=>{const p=player;if(p.dead)return;
  if(p.dive){p.dive=false;return;}if(p.under)return;
  if(!p.air){p.air=true;p.vy=11.5*form.jump;p.jumps=1;setAnim('jump',0.25);fx.burst(p.pos.x,p.pos.y+.1,p.pos.z,0xffffff,6,3);fx.sfx('lunge');}
  else if(p.wallT>0){p.vy=12.5;p.vx=p.wnx*15;p.vz=p.wnz*15;p.yaw=Math.atan2(p.wnx,p.wnz);p.wallT=0;p.jumps=1;setAnim('flip',0.3);fx.burst(p.pos.x,p.pos.y+.5,p.pos.z,0xcdeeff,10,5);fx.sfx('swing');}
  else if(p.jumps<2&&p.stam>=1){p.stam-=1;p.jumps=2;p.vy=11*form.jump;setAnim('flip',0.35);ringFx(p.pos.x,p.pos.y,p.pos.z,0xffffff,3,0.3);fx.sfx('shard');}};
// Dive: toggle while swimming in deep water. Breath drains underwater.
actions.dive=()=>{const p=player;if(p.dead||p.air)return;if(groundAt(p.pos.x,p.pos.z)<-2.2){p.dive=!p.dive;fx.sfx('dash');if(p.dive)fx.burst(p.pos.x,0.1,p.pos.z,0xffffff,12,5);}};

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
actions.nova=()=>{if(!spend('nova'))return;const p=player,R=9.5*Math.sqrt(form.nova);setAnim('nova',0.5);
  ringFx(p.pos.x,(p.under?p.pos.y:Math.max(p.pos.y,0))+0.4,p.pos.z,0xbff6ff,R*1.1,0.5);spikeFx(p.pos.x,p.under?p.pos.y-1:Math.max(p.pos.y,0),p.pos.z,R*0.85,0.55);
  fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xcff8ff,45,13);fx.shake(0.5);fx.sfx('nova');
  for(const e of enemies){if(e.dead)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1;
    if(d<R+e.type.radius){e.slow=3;hitEnemy(e,28*dmgMul()*form.nova,dx/d,dz/d,true);}}
  for(const s of shots)if(s.active&&s.hostile&&Math.hypot(s.mesh.position.x-p.pos.x,s.mesh.position.z-p.pos.z)<R)s.life=0;};
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

// ======================= [BOSS/FX] Aurora Leviathan, particles, numbers, minimap, audio =======================
const BM={g:mat(0x49e6a5,{emissive:0x0c5a3a}),p:mat(0xa46bff,{emissive:0x3a1a7a}),h:mat(0xeafff6,{emissive:0x226655})};
TYPES.leviathan={name:'Aurora Leviathan',boss:true,hp:460,speed:6,aggro:40,range:15,windup:1.05,recover:1.5,dmg:24,xp:220,sea:true,radius:3.2,tele:7,kind:'boss',
  lungeSpeed:27,lungeTime:.7,respawn:120,swimY:-0.2,
  build(g){for(let i=0;i<9;i++){const s=2.4-i*.2;part(g,G.sph,i%2?BM.p:BM.g,0,1.2,-i*2.3,s,s*.85,s*1.2);if(i%2===0)part(g,G.cone,BM.h,0,1.2+s,-i*2.3,1,2,.4);}
    part(g,G.cone,BM.h,1,3.4,1,.7,2.4,.7).rotation.z=-.5;part(g,G.cone,BM.h,-1,3.4,1,.7,2.4,.7).rotation.z=.5;
    part(g,G.sph,EM.eye,1,1.9,2.3,.3);part(g,G.sph,EM.eye,-1,1.9,2.3,.3);},
  anim(e,t){const c=e.body.children;let k=0;for(let i=0;i<9;i++){const x=Math.sin(t*2.2-i*.6)*0.35*i;c[k++].position.x=x;if(i%2===0)c[k++].position.x=x;}}};
{const sp={type:'leviathan',x:BOSS_LAIR.x,z:BOSS_LAIR.z,timer:0};spawns.push(sp);makeEnemy(sp);}
const bossE=enemies[enemies.length-1],bossEl=$('boss'),bossHp=$('bosshp');
// Particle pool (one Points draw call)
const PN=360,pPos=new Float32Array(PN*3).fill(-999),pCol=new Float32Array(PN*3),pVel=new Float32Array(PN*3),pLife=new Float32Array(PN);let pNext=0;
const pGeo=new THREE.BufferGeometry();pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));pGeo.setAttribute('color',new THREE.BufferAttribute(pCol,3));
const pPts=new THREE.Points(pGeo,new THREE.PointsMaterial({size:0.42,vertexColors:true,transparent:true,depthWrite:false}));pPts.frustumCulled=false;scene.add(pPts);
const pc=new THREE.Color();
fx.burst=(x,y,z,color,n=10,speed=6)=>{pc.setHex(color);for(let i=0;i<n;i++){const k=pNext*3;pNext=(pNext+1)%PN;
  pPos[k]=x;pPos[k+1]=y;pPos[k+2]=z;pCol[k]=pc.r;pCol[k+1]=pc.g;pCol[k+2]=pc.b;
  const a=Math.random()*TAU,s=speed*(0.4+Math.random()*0.6);pVel[k]=Math.cos(a)*s;pVel[k+1]=2+Math.random()*speed*0.7;pVel[k+2]=Math.sin(a)*s;pLife[k/3]=0.4+Math.random()*0.4;}};
// Floating damage numbers (DOM pool, projected once at spawn)
const numPool=[];for(let i=0;i<14;i++){const d=document.createElement('div');d.className='num';d.style.display='none';$('nums').appendChild(d);numPool.push(d);}let numI=0;
fx.number=(pos,text,color='#fff',yoff=2)=>{tmpV.set(pos.x,pos.y+yoff,pos.z).project(camera);if(tmpV.z>1)return;const d=numPool[numI=(numI+1)%numPool.length];
  d.textContent=text;d.style.color=color;d.style.left=((tmpV.x*.5+.5)*innerWidth+(Math.random()-.5)*30)+'px';d.style.top=((-tmpV.y*.5+.5)*innerHeight)+'px';
  d.style.display='none';void d.offsetWidth;d.style.display='block';};
// Tiny synthesized SFX (WebAudio, unlocked by the Play tap)
let actx=null;onStart.push(()=>{try{actx=new (window.AudioContext||window.webkitAudioContext)();actx.resume();}catch(_){}});
const SFX={swing:[520,260,.08,'triangle',.08],hit:[300,120,.09,'square',.1],heavy:[180,50,.2,'sawtooth',.16],kill:[400,900,.18,'triangle',.14],hurt:[160,70,.2,'square',.14],
  shard:[900,1500,.12,'sine',.1],dash:[300,700,.16,'sine',.1],nova:[1200,200,.4,'sawtooth',.14],slam:[110,40,.3,'square',.16],lunge:[250,400,.1,'triangle',.06],shoot:[600,300,.12,'sine',.07],level:[520,1040,.35,'triangle',.16]};
fx.sfx=n=>{const s=SFX[n];if(!actx||!s||actx.state!=='running')return;try{const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime;o.type=s[3];
  o.frequency.setValueAtTime(s[0],t);o.frequency.exponentialRampToValueAtTime(s[1],t+s[2]);g.gain.setValueAtTime(s[4],t);g.gain.exponentialRampToValueAtTime(0.001,t+s[2]);
  o.connect(g).connect(actx.destination);o.start(t);o.stop(t+s[2]+0.02);}catch(_){}};
// Minimap: pre-rendered terrain + live dots (player, enemies, totems, boss lair), north-up
const mapC=$('map'),mctx=mapC.getContext('2d'),mapBase=document.createElement('canvas');mapBase.width=mapBase.height=96;
{const c=mapBase.getContext('2d'),im=c.createImageData(96,96);for(let j=0;j<96;j++)for(let i=0;i<96;i++){const h=groundAt(-HALF+(i+.5)/96*WORLD,-HALF+(j+.5)/96*WORLD),k=(j*96+i)*4;
  const v=h>0.3?[240,250,255]:h>-0.8?[150,210,240]:h<-12?[12,40,95]:[30,90,150];im.data[k]=v[0];im.data[k+1]=v[1];im.data[k+2]=v[2];im.data[k+3]=h>0.3?235:170;}c.putImageData(im,0,0);}
const mp=v=>(v+HALF)/WORLD*192;let mapT=0;
function drawMap(){
  mctx.clearRect(0,0,192,192);mctx.drawImage(mapBase,0,0,192,192);
  mctx.fillStyle='#ffe066';for(const t of totems)mctx.fillRect(mp(t.x)-3,mp(t.z)-3,6,6);
  mctx.fillStyle='#5ff';for(const k of pickups)if(!k.got){mctx.beginPath();mctx.arc(mp(k.x),mp(k.z),3,0,TAU);mctx.fill();}
  mctx.strokeStyle='#c58bff';mctx.lineWidth=3;mctx.beginPath();mctx.arc(mp(BOSS_LAIR.x),mp(BOSS_LAIR.z),9,0,TAU);mctx.stroke();
  for(const e of enemies){if(e.dead)continue;mctx.fillStyle=e.type.boss?'#c58bff':'#ff4a5a';const r=e.type.boss?6:3.5;mctx.beginPath();mctx.arc(mp(e.pos.x),mp(e.pos.z),r,0,TAU);mctx.fill();}
  const p=player;mctx.save();mctx.translate(mp(p.pos.x),mp(p.pos.z));mctx.rotate(-p.yaw);mctx.fillStyle='#fff';mctx.strokeStyle='#024';mctx.lineWidth=2;
  mctx.beginPath();mctx.moveTo(0,10);mctx.lineTo(6,-6);mctx.lineTo(-6,-6);mctx.closePath();mctx.fill();mctx.stroke();mctx.restore();
}
systems.push(dt=>{
  for(let i=0;i<PN;i++){if(pLife[i]<=0)continue;const k=i*3;pLife[i]-=dt;if(pLife[i]<=0){pPos[k+1]=-999;continue;}
    pVel[k+1]-=14*dt;pPos[k]+=pVel[k]*dt;pPos[k+1]+=pVel[k+1]*dt;pPos[k+2]+=pVel[k+2]*dt;}
  pGeo.attributes.position.needsUpdate=true;pGeo.attributes.color.needsUpdate=true;
  if((mapT-=dt)<=0){mapT=0.12;drawMap();
    let bb=null;for(const e of enemies)if(e.type.boss&&!e.dead&&Math.hypot(player.pos.x-e.pos.x,player.pos.z-e.pos.z)<60&&Math.abs(player.pos.y-e.pos.y)<8)bb=e;
    bossEl.classList.toggle('hidden',!bb);if(bb){bossEl.firstElementChild.textContent=bb.type.name;bossHp.style.transform=`scaleX(${Math.max(0,bb.hp/bb.type.hp)})`;}}
  // dash + swim trails
  const p=player;if(p.dashT>0)fx.burst(p.pos.x,p.pos.y+.6,p.pos.z,0x8fdcff,2,3);
  else if(p.swim&&Math.hypot(p.vx,p.vz)>3&&Math.random()<0.3)fx.burst(p.pos.x,0.1,p.pos.z,0xffffff,1,2);
});

// ======================= [EXPLORE] Aurora Shards (collectibles), dash strikes, kill rewards =======================
// 12 Aurora Shards hidden across both zones (cyan dots on the minimap). Each grants XP + a full heal;
// finding all of them permanently boosts energy regen. Progress is saved.
const pickups=[],shardGlow=bmat(0x7fffe0),haloMat=bmat(0x7fffe0,{transparent:true,opacity:0.35,depthWrite:false});
let gotSet=[];try{gotSet=JSON.parse(localStorage.getItem('frostbound_shards')||'[]')||[];}catch(_){}
{let guard=0;const spots=floes.slice(1,7).map(f=>[f.x,f.z]);
  while(spots.length<12&&guard++<500){const a=rr(0,TAU),d=rr(30,180),x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+2)||spots.some(s=>Math.hypot(x-s[0],z-s[1])<40))continue;spots.push([x,z]);}
  spots.forEach(([x,z],i)=>{const g=new THREE.Group(),y=Math.max(groundAt(x,z),0)+1.4;g.position.set(x,y,z);
    part(g,G.oct,shardGlow,0,0,0,.5,.9,.5);part(g,G.ring,haloMat,0,-1.2,0,1.6);scene.add(g);
    const k={x,z,y,g,got:gotSet.includes(i),i};g.visible=!k.got;pickups.push(k);});}
const shardCount=()=>pickups.filter(k=>k.got).length;
const dashHit=new Set();
systems.push(dt=>{
  const p=player,t=game.time;
  waterTex.offset.set(t*0.006,t*0.004);
  for(const k of pickups){if(k.got)continue;k.g.rotation.y=t*2;k.g.position.y=k.y+Math.sin(t*2+k.i)*0.25;
    if(Math.hypot(p.pos.x-k.x,p.pos.z-k.z)<2.4){k.got=true;k.g.visible=false;gotSet.push(k.i);try{localStorage.setItem('frostbound_shards',JSON.stringify(gotSet));}catch(_){}
      const n=shardCount();p.hp=p.maxHp;p.en=p.maxEn;fx.burst(k.x,k.y,k.z,0x7fffe0,40,10);fx.sfx('level');
      toast(n>=pickups.length?'All Aurora Shards found! Energy surges':'Aurora Shard '+n+'/'+pickups.length);gainXP(25);}}
  if(shardCount()>=pickups.length)p.en=Math.min(p.maxEn,p.en+dt*8);
  // Tidal Dash now strikes every enemy it passes through
  if(p.dashT>0){for(const e of enemies){if(e.dead||dashHit.has(e))continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1;
    if(d<e.type.radius+1.8){dashHit.add(e);hitEnemy(e,14*dmgMul(),dx/d,dz/d,false);}}}else if(dashHit.size)dashHit.clear();
});
// Kills refund a little HP + energy so aggressive play is rewarded
{const g0=gainXP;gainXP=n=>{const p=player;if(!p.dead){p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.06);p.en=Math.min(p.maxEn,p.en+12);}g0(n);};}

// ======================= [HD CREATURES] detailed builds (override the simple ones above) =======================
// Each build(g) fills a Group; anim(e,t) animates e.body.children. The same builds are reused for morph forms + almanac portraits.
const EX={eyeW:mat(0xffffff,{shininess:120}),pupil:mat(0x0c1424,{shininess:150}),glow:bmat(0xbff8ff),cheek:mat(0xff9ab8),foot:mat(0xffa23a),belly:mat(0xdfe9f2),
  gold:mat(0xffd34d,{emissive:0x7a5200,shininess:140}),goldD:mat(0xe89a1a,{emissive:0x4a2a00}),
  hy:mat(0xbfe8ff,{emissive:0x0f3560}),hyD:mat(0x3f78c0,{emissive:0x0a2248}),hyS:mat(0xeaffff,{emissive:0x3aa0d0,flatShading:true}),red:bmat(0xff5a7a)};
function eyes(g,x,y,z,r,glow){for(const s of [1,-1]){part(g,G.sph,EX.eyeW,s*x,y,z,r);part(g,G.sph,glow||EX.pupil,s*x*1.03,y,z+r*0.55,r*0.62);part(g,G.sph,EX.eyeW,s*x*1.03+r*0.22,y+r*0.28,z+r*1.02,r*0.2);}}
function buildMite(g,body,spike){
  part(g,G.sph,body,0,.64,0,.7,.58,.8);part(g,G.sph,body,0,.46,-.05,.62,.42,.7);
  for(const z of [-.38,0,.36])for(const x of [-.24,.24]){const c=part(g,G.cone,spike,x,1.14-Math.abs(z)*.25,z-.05,.26,.75,.26);c.rotation.z=-x*1.3;c.rotation.x=z*0.9;}
  eyes(g,.25,.74,.62,.13);part(g,G.sph,EX.cheek,.42,.58,.56,.09);part(g,G.sph,EX.cheek,-.42,.58,.56,.09);
  for(const s of [1,-1]){part(g,G.cone,spike,s*.16,.44,.84,.13,.32,.13).rotation.x=Math.PI/2;part(g,G.sph,spike,s*.42,.12,.32,.17,.12,.22);part(g,G.sph,spike,s*.42,.12,-.32,.17,.12,.22);}
}
TYPES.snowmite.build=g=>buildMite(g,EM.mite,EM.miteS);
TYPES.walrus.build=g=>{
  part(g,G.sph,EM.wal,0,1.3,0,1.65,1.3,2.15);part(g,G.sph,EX.belly,0,1.0,.3,1.45,1.0,1.8);part(g,G.sph,EM.wal,0,1.75,1.9,1.05,.98,1.05);
  for(const s of [1,-1]){part(g,G.sph,EX.belly,s*.36,1.42,2.72,.44,.36,.4);const t=part(g,G.cone,EM.tusk,s*.4,.85,2.75,.26,1.3,.26);t.rotation.x=Math.PI;t.rotation.z=s*0.12;
    part(g,G.sph,EM.wal,s*1.65,.45,1,.7,.24,.95).rotation.y=s*0.5;part(g,G.sph,EM.rock,s*.5,2.36,2.4,.3,.12,.2);}
  part(g,G.sph,EM.eye,0,1.62,2.95,.16,.12,.1);eyes(g,.5,2.12,2.6,.17);
  part(g,G.dode,EM.rock,0,2.55,-.2,1.15,.8,1.3);part(g,G.dode,EM.rock,.7,2.3,.8,.6,.5,.7);part(g,G.dode,EM.rock,-.6,2.25,-1.2,.7,.5,.7);part(g,G.dode,EM.miteS,0,3.2,-.2,.4,.6,.4);
  part(g,G.sph,EM.wal,0,.6,-2.2,1,.3,.85);
};
TYPES.eel.build=g=>{
  for(let i=0;i<8;i++){const s=new THREE.Group(),r=.58-i*.05;s.position.set(0,.5,-i*.62);g.add(s);part(s,G.sph,i%2?EM.eelB:EM.eel,0,0,0,r,r*.9,.62);
    part(s,G.cone,EM.eel,0,r+.12,0,.16,.5-i*.03,.3);if(i===7)part(s,G.sph,EM.eel,0,0,-.5,.05,.55,.5);
    if(i===0){eyes(s,.28,.2,.34,.13,EX.glow);part(s,G.cone,EM.eelB,0,-.1,.6,.5,.6,.3).rotation.x=Math.PI/2;for(const k of [1,-1])part(s,G.cone,EM.eel,k*.2,.75,.1,.1,.7,.1).rotation.z=-k*.5;}}
};
TYPES.eel.anim=(e,t)=>{const c=e.body.children;for(let i=0;i<8;i++){c[i].position.x=Math.sin(t*7-i*.8)*0.1*i;c[i].rotation.y=Math.cos(t*7-i*.8)*0.3;}};
TYPES.krill.build=g=>{for(let i=0;i<10;i++){const k=new THREE.Group();g.add(k);part(k,G.sph,EM.krill,0,0,0,.2,.18,.38);part(k,G.cone,EM.krill,0,0,-.42,.22,.3,.1).rotation.x=-Math.PI/2;
  part(k,G.sph,EX.pupil,.1,.06,.28,.05);part(k,G.sph,EX.pupil,-.1,.06,.28,.05);part(k,G.cone,EM.krill,0,.12,.4,.04,.4,.04).rotation.x=1;}};
TYPES.krill.anim=(e,t)=>{const c=e.body.children;for(let i=0;i<10;i++){const a=t*2.5+i*0.63,r=.5+.35*(i%3)*.6;c[i].position.set(Math.cos(a)*r,.7+Math.sin(a*1.7+i)*.4,Math.sin(a)*r);c[i].rotation.y=Math.atan2(-Math.sin(a),Math.cos(a));}};
TYPES.leviathan.build=g=>{
  for(let i=0;i<10;i++){const s=new THREE.Group(),r=2.4-i*.19;s.position.set(0,1.2,-i*2.2);g.add(s);part(s,G.sph,i%2?BM.p:BM.g,0,0,0,r,r*.85,r*1.25);part(s,G.sph,BM.h,0,-r*.35,0,r*.8,r*.55,r*1.1);
    part(s,G.cone,BM.h,0,r+.5,0,.9,2.2-i*.12,.35);
    if(i===2||i===5)for(const k of [1,-1])part(s,G.sph,BM.p,k*(r+.6),-.2,0,1.3,.12,.8).rotation.z=k*.4;
    if(i===9)for(const k of [1,-1])part(s,G.sph,BM.p,k*.9,0,-1.2,1.2,.12,.9).rotation.y=k*.6;
    if(i===0){eyes(s,1.05,.75,1.9,.36,EX.glow);part(s,G.sph,BM.p,0,-.7,1.6,1.5,.6,1.6);for(const k of [1,-1]){const h=part(s,G.cone,BM.h,k*1.1,2.3,.6,.7,2.6,.7);h.rotation.z=-k*.5;
      const w=part(s,G.cone,BM.g,k*1.6,-.4,2.6,.14,2.4,.14);w.rotation.x=Math.PI/2;w.rotation.z=-k*.5;}}}
};
TYPES.leviathan.anim=(e,t)=>{const c=e.body.children;for(let i=0;i<10;i++){c[i].position.x=Math.sin(t*2.2-i*.6)*0.35*i;c[i].rotation.y=Math.cos(t*2.2-i*.6)*0.25;}};
// Rare golden runner (surprise spawn on the island): flees, worth a lot of XP
TYPES.glimmer={name:'Glimmermite',hp:34,speed:11,aggro:15,range:0,windup:.4,recover:1,dmg:0,xp:120,sea:false,radius:.7,tele:1,kind:'lunge',lungeSpeed:0,lungeTime:0,flee:true,respawn:100,
  build:g=>buildMite(g,EX.gold,EX.goldD)};
// THE FROST HYDRA — lives at the bottom of the Abyss; only reachable by diving
TYPES.hydra={name:'Frost Hydra',boss:true,deep:true,leash:17,hp:820,speed:5,aggro:30,range:14,windup:1,recover:1.4,dmg:26,xp:420,sea:true,radius:3.6,tele:7.5,kind:'boss',
  lungeSpeed:22,lungeTime:.6,respawn:180,
  build(g){
    for(let k=0;k<3;k++){const n=new THREE.Group();n.position.set((k-1)*1.2,1.8,1.2);n.rotation.y=(k-1)*0.55;g.add(n);
      for(let j=0;j<6;j++)part(n,G.sph,j%2?EX.hyD:EX.hy,0,j*1.05,j*0.85,1.15-j*.1,1.0-j*.07,1.15-j*.1);
      const h=new THREE.Group();h.position.set(0,6.4,5.4);n.add(h);part(h,G.sph,EX.hy,0,0,0,1.05,.85,1.45);part(h,G.sph,EX.hyD,0,-.55,.25,.85,.35,1.2);eyes(h,.6,.35,.95,.24,EX.red);
      for(const s of [1,-1]){part(h,G.cone,EX.hyS,s*.55,1.1,-.3,.4,1.6,.4).rotation.z=-s*.4;part(h,G.cone,EX.eyeW,s*.4,-.45,1.25,.16,.5,.16).rotation.x=Math.PI;}
      part(h,G.cone,EX.hyS,0,.9,.4,.3,.9,.3);}
    part(g,G.sph,EX.hy,0,1.7,-1.2,3.1,2.2,3.8);part(g,G.sph,EX.belly,0,1.1,-.6,2.6,1.6,3.2);
    for(let i=0;i<6;i++)part(g,G.cone,EX.hyS,(i%2?.9:-.9)*(i<4?1:0),3.9-i*.25,-i*1.1+.6,.8,2.4-i*.2,.8).rotation.x=-.4;
    for(let i=0;i<5;i++)part(g,G.sph,i%2?EX.hy:EX.hyD,0,1.2,-4.6-i*1.5,1.7-i*.3,1.3-i*.22,1.6);
    for(const s of [1,-1]){part(g,G.sph,EX.hyD,s*3.2,.9,.4,1.6,.2,1.1).rotation.z=s*.35;part(g,G.sph,EX.hyD,s*2.8,.8,-3,1.3,.18,.9).rotation.z=s*.35;}
  },
  anim(e,t){const c=e.body.children;for(let k=0;k<3;k++){c[k].rotation.x=Math.sin(t*1.5+k*2.1)*0.2;c[k].rotation.z=Math.sin(t*1.1+k*1.7)*0.16;}}};
for(const k in TYPES)TYPES[k].key=k;
for(const e of enemies){e.body.clear();e.type.build(e.body);}                    // upgrade already-spawned creatures to HD builds
{const sp={type:'hydra',x:ABYSS.x,z:ABYSS.z,timer:0};spawns.push(sp);makeEnemy(sp);}
addSpawns('glimmer',1,(x,z,g)=>g>1&&Math.hypot(x,z)>35&&Math.hypot(x,z)<75);
// Glacira detail pass
for(const s of [1,-1]){part(glBody,G.sph,EX.eyeW,s*.23,1.5,.98,.11);part(glBody,G.sph,EX.cheek,s*.36,1.3,1.0,.08);part(glBody,G.sph,EX.foot,s*.3,.08,.4,.2,.08,.34);part(glBody,G.sph,M.ice,s*.5,1.05,-.3,.1,.1,.3);}

// ======================= [MORPH + ALMANAC] =======================
// Defeat a creature once to unlock its form. Forms change stats (FORMS) and reuse the creature's build + anim.
let S2={seen:{},kills:{},form:'glacira',relics:[],bless:false};
try{const v=JSON.parse(localStorage.getItem('frostbound_almanac')||'null');if(v&&v.kills)S2={...S2,...v};}catch(_){}
const saveS2=()=>{try{localStorage.setItem('frostbound_almanac',JSON.stringify(S2));}catch(_){}};
const BASEFORM={speed:1,swim:1,armor:1,bite:1,shardN:1,nova:1,jump:1,xp:1};
const FORMS={glacira:{},snowmite:{speed:1.3,jump:1.3},walrus:{speed:.82,armor:.5,bite:1.6},glimmer:{speed:1.25,xp:1.5},eel:{swim:1.8,speed:1.1},krill:{shardN:3},
  leviathan:{nova:1.6,swim:1.4,armor:.8},hydra:{bite:1.4,shardN:3,armor:.7}};
// [key, habitat, description, morph perk]
const ALM=[
  ['glacira','Everywhere','Seal-penguin hybrid crowned with a frost crest. Your true form.','Balanced — no bonuses, no drawbacks'],
  ['snowmite','Iceberg Fields','Ice-spined swarmer. Crouches, then lunges in a straight line.','+30% speed, +30% jump height'],
  ['walrus','Iceberg Fields','Rock-backed tank. Its ground slam covers the whole red circle.','Takes half damage, bites 60% harder, slower'],
  ['glimmer','Iceberg Fields (rare)','A golden mite that bolts on sight. Catch it for a fortune in XP.','+25% speed, +50% XP from everything'],
  ['eel','Polar Sea','Circles its prey crackling with static, then strikes like lightning.','+80% swim speed'],
  ['krill','Polar Sea','A drifting swarm that spits stinging bubbles from range.','Ice Shard fires a 3-shard fan'],
  ['leviathan','Leviathan Deep','Aurora-scaled serpent of the far north-east. Bubble rings, then a charge.','Frost Nova is 60% stronger and wider'],
  ['hydra','???','Three heads, one hunger. Rumored to lurk where the sea floor falls away…','3-shard fan, +40% bite, tougher'],
];
let formKey='glacira';const fakeE={body:morphBody,home:{x:0,z:0},state:'chase'};
const nameOf=k=>k==='glacira'?'Glacira':TYPES[k].name;
function setForm(key,silent){
  if(!FORMS[key])key='glacira';formKey=key;form={...BASEFORM,...FORMS[key]};
  glBody.visible=key==='glacira';morphBody.clear();
  if(key!=='glacira'){const T=TYPES[key];T.build(morphBody);morphBody.scale.setScalar(T.radius>1?1.15/T.radius:1.2);morphBody.position.y=T.sea?0.45:0;}
  if(!silent){const p=player;setAnim('morph',0.5);fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xc58bff,40,9);ringFx(p.pos.x,p.pos.y+.5,p.pos.z,0xc58bff,6,0.5);fx.sfx('level');toast('Morphed: '+nameOf(key));}
  S2.form=key;saveS2();
}
animForm=t=>{if(formKey!=='glacira'){const T=TYPES[formKey];if(T.anim)T.anim(fakeE,t);else morphBody.position.y=Math.abs(Math.sin(player.walk*13))*0.15;}};
onKill=e=>{const k=e.type.key;S2.kills[k]=(S2.kills[k]||0)+1;S2.seen[k]=1;saveS2();if(S2.kills[k]===1)setTimeout(()=>toast('Morph unlocked: '+e.type.name+' 📖'),1400);};
{const g1=gainXP;gainXP=n=>g1(Math.round(n*form.xp));}
if(S2.form!=='glacira'&&S2.kills[S2.form])setForm(S2.form,true);
// Portraits: rendered once with a tiny throwaway renderer, cached as data URLs
let portraits=null;
function makePortraits(){
  portraits={};let r2;try{r2=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});}catch(_){return;}
  r2.setSize(220,220,false);r2.toneMapping=THREE.ACESFilmicToneMapping;r2.toneMappingExposure=1.25;
  const sc=new THREE.Scene(),dl=new THREE.DirectionalLight(0xffffff,1.8),cam=new THREE.PerspectiveCamera(32,1,0.1,300),box=new THREE.Box3(),c=new THREE.Vector3(),sz=new THREE.Vector3();
  sc.add(new THREE.HemisphereLight(0xffffff,0x6fa8c8,1.7));dl.position.set(4,6,7);sc.add(dl);
  for(const [key] of ALM){const g=new THREE.Group();
    if(key==='glacira'){const cl=glBody.clone();cl.visible=true;g.add(cl);}else{TYPES[key].build(g);if(TYPES[key].anim)TYPES[key].anim({body:g,home:{x:0,z:0}},1.3);}
    sc.add(g);box.setFromObject(g);box.getCenter(c);box.getSize(sz);const d=(Math.max(sz.x,sz.y,sz.z)*0.5+0.1)/Math.tan(16*Math.PI/180)*0.95;
    cam.position.set(c.x+d*0.62,c.y+d*0.3,c.z+d*0.72);cam.lookAt(c);r2.render(sc,cam);portraits[key]=r2.domElement.toDataURL();sc.remove(g);}
  r2.dispose();if(r2.forceContextLoss)r2.forceContextLoss();
}
const almEl=$('almanac'),almGrid=$('almGrid');
function openAlmanac(){
  if(!game.started||game.paused)return;if(!portraits)makePortraits();game.paused=true;
  almGrid.innerHTML=ALM.map(([k,hab,desc,perk])=>{const me=k==='glacira',T=TYPES[k],seen=me||S2.seen[k],kills=S2.kills[k]||0,can=me||kills>0,cur=formKey===k;
    return `<div class="card${seen?'':' unseen'}${cur?' cur':''}"><img alt="" src="${portraits[k]||''}"><div class="ci"><h3>${seen?nameOf(k):'???'}</h3>
      <p class="hab">${seen?(k==='hydra'?'The Abyss':hab):hab}</p><p>${seen?desc:(k==='hydra'?desc:'Not yet discovered.')}</p>
      ${seen&&!me?`<p class="st">HP ${T.hp} · ATK ${T.dmg} · XP ${T.xp} · Defeated ×${kills}</p>`:''}
      <p class="perk">${can?'Morph: '+perk:(seen?'Defeat it once to unlock its form':'')}</p>
      ${can?`<button data-k="${k}"${cur?' disabled':''}>${cur?'Current form':'Morph'}</button>`:''}</div></div>`;}).join('');
  almEl.classList.remove('hidden');
}
function closeAlmanac(){almEl.classList.add('hidden');game.paused=false;}
actions.almanac=()=>almEl.classList.contains('hidden')?openAlmanac():closeAlmanac();
$('almBtn').addEventListener('pointerdown',e=>{e.stopPropagation();openAlmanac();});
$('almClose').addEventListener('click',closeAlmanac);
almGrid.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('button[data-k]');if(b&&!b.disabled){closeAlmanac();setForm(b.dataset.k);}});

// ======================= [DEPTHS + SURPRISES] =======================
// Air vents (refill breath in the Abyss), sunken relics (dive to find), geyser launch pads, a hidden shrine, day/night with stars.
const vents=[0.4,2.5,4.6].map(a=>{const x=ABYSS.x+Math.cos(a)*13,z=ABYSS.z+Math.sin(a)*13,y=groundAt(x,z);
  part(scene,G.cyl,bmat(0x9ff6ff,{transparent:true,opacity:0.16,depthWrite:false}),x,y+14,z,3.4,28,3.4);part(scene,G.ring,bmat(0x9ff6ff,{transparent:true,opacity:0.8}),x,y+0.3,z,2.2);return {x,z,y};});
const relicMat=mat(0xffd34d,{emissive:0x8a5a00,shininess:140}),relics=[];
{let guard=0;while(relics.length<4&&guard++<3000){const a=rr(0,TAU),d=rr(120,172),x=Math.cos(a)*d,z=Math.sin(a)*d,g=groundAt(x,z);
  if(g>-5||Math.hypot(x-ABYSS.x,z-ABYSS.z)<ABYSS.r+8||!farFromLair(x,z)||relics.some(r=>Math.hypot(x-r.x,z-r.z)<70))continue;
  const m=new THREE.Group();m.position.set(x,g+0.5,z);part(m,G.box,relicMat,0,0,0,1.3,.8,.9);part(m,G.cyl,relicMat,0,.5,0,.9,1.3,.9).rotation.z=Math.PI/2;part(m,G.ring,haloMat,0,-.3,0,2);
  const i=relics.length;m.visible=!S2.relics.includes(i);scene.add(m);relics.push({x,z,y:g+0.5,m,i});}}
const geyserMat=mat(0x5a7a92,{flatShading:true}),geysers=[];
{let guard=0;while(geysers.length<3&&guard++<2000){const a=rr(0,TAU),d=rr(20,70),x=Math.cos(a)*d,z=Math.sin(a)*d,g=groundAt(x,z);
  if(g<1||obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+4)||geysers.some(q=>Math.hypot(x-q.x,z-q.z)<35))continue;
  for(let i=0;i<7;i++){const b=i/7*TAU;part(scene,G.dode,geyserMat,x+Math.cos(b)*1.7,g+0.15,z+Math.sin(b)*1.7,.5,.35,.5);}
  part(scene,G.disc,bmat(0x8fdcff,{transparent:true,opacity:0.55}),x,g+0.08,z,1.4);geysers.push({x,z,y:g,cd:0});}}
const shrineF=floes[Math.min(3,floes.length-1)],shrineDisc=part(scene,G.disc,bmat(S2.bless?0xfff2a0:0xc58bff,{transparent:true,opacity:0.7}),shrineF.x,0.58,shrineF.z,2);
for(let i=0;i<6;i++){const a=i/6*TAU,r=Math.min(shrineF.r-2,5);part(scene,G.cyl,mat(0xd8f2ff,{flatShading:true}),shrineF.x+Math.cos(a)*r,2.2,shrineF.z+Math.sin(a)*r,.8,3.6+(i%2),.8);
  part(scene,G.oct,totemOff,shrineF.x+Math.cos(a)*r,4.8+(i%2)*.5,shrineF.z+Math.sin(a)*r,.4,.7,.4);}
function applyBonus(){player.maxEn=100+(S2.bless?30:0)+(S2.relics.length>=4?25:0);}applyBonus();player.en=player.maxEn;
const STARS=260,starGeo=new THREE.BufferGeometry();{const a=new Float32Array(STARS*3);for(let i=0;i<STARS;i++){const th=Math.random()*TAU,ph=Math.random()*1.2,r=380;
  a[i*3]=Math.sin(th)*Math.cos(ph)*r;a[i*3+1]=Math.sin(ph)*r+20;a[i*3+2]=Math.cos(th)*Math.cos(ph)*r;}starGeo.setAttribute('position',new THREE.BufferAttribute(a,3));}
const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:2,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}));stars.frustumCulled=false;scene.add(stars);
const skyDay=new THREE.Color(SKY),skyDusk=new THREE.Color(0xf4a488),skyNight=new THREE.Color(0x0e1c40),deepC=new THREE.Color(0x0b3a66),skyC=new THREE.Color();
const DAYLEN=200;let seenT=0,hintVent=false,hintGeyser=false;
systems.push(dt=>{
  const p=player,t=game.time;
  // day → dusk → night → dawn; the aurora and stars come out at night
  const ph=(t/DAYLEN+0.08)%1,n=clamp((ph-0.45)/0.1,0,1)-clamp((ph-0.88)/0.1,0,1),dusk=1-Math.abs(n*2-1);
  const uw=camera.position.y<-0.3;
  if(uw){skyC.copy(deepC).multiplyScalar(clamp(1+camera.position.y/40,0.3,1)*(1-0.5*n));scene.fog.near=3;scene.fog.far=58;}
  else{skyC.copy(skyDay).lerp(skyNight,n).lerp(skyDusk,dusk*0.55);scene.fog.near=45;scene.fog.far=150;}
  scene.background.copy(skyC);scene.fog.color.copy(skyC);
  hemi.intensity=1.5-0.95*n;sun.intensity=1.6-1.35*n;auroraMat.uniforms.a.value=uw?0:0.4+1.1*n;stars.material.opacity=uw?0:n;stars.position.copy(camera.position).setY(0);
  // air vents
  for(const v of vents)if(p.under&&Math.hypot(p.pos.x-v.x,p.pos.z-v.z)<2.6){p.breath=Math.min(MAXBREATH,p.breath+dt*45);if(Math.random()<0.4)fx.burst(p.pos.x,p.pos.y+1,p.pos.z,0xcff8ff,1,3);
    if(!hintVent){hintVent=true;toast('Air vent — breath restored');}}
  // sunken relics
  for(const r of relics){if(!r.m.visible)continue;r.m.rotation.y=t;if(Math.hypot(p.pos.x-r.x,p.pos.z-r.z)<2.8&&Math.abs(p.pos.y-r.y)<3){r.m.visible=false;S2.relics.push(r.i);saveS2();applyBonus();
    fx.burst(r.x,r.y+.5,r.z,0xffd34d,40,9);fx.sfx('level');toast(S2.relics.length>=4?'All relics found! +25 max energy':'Sunken Relic '+S2.relics.length+'/4');gainXP(45);}}
  // geysers: step on one to get launched (try a mid-air Bite on the way down)
  for(const q of geysers){q.cd-=dt;if(Math.random()<0.25)fx.burst(q.x,q.y+.3,q.z,0xffffff,1,5);
    if(q.cd<=0&&!p.air&&Math.hypot(p.pos.x-q.x,p.pos.z-q.z)<1.7){q.cd=1;p.air=true;p.vy=27;p.jumps=1;setAnim('jump',0.3);fx.burst(q.x,q.y+.5,q.z,0xffffff,40,12);fx.sfx('nova');fx.shake(0.3);
      if(!hintGeyser){hintGeyser=true;toast('Geyser launch!');}}}
  // hidden shrine
  if(!S2.bless&&Math.hypot(p.pos.x-shrineF.x,p.pos.z-shrineF.z)<2&&!p.air){S2.bless=true;saveS2();applyBonus();p.en=p.maxEn;shrineDisc.material.color.setHex(0xfff2a0);
    fx.burst(shrineF.x,2,shrineF.z,0xc58bff,60,14);ringFx(shrineF.x,1,shrineF.z,0xc58bff,12,0.8);fx.sfx('level');toast('Aurora Blessing: +30 max energy');const f=$('flash');f.style.opacity=0.8;setTimeout(()=>f.style.opacity=0,200);}
  // almanac discovery + golden sparkle
  if((seenT-=dt)<=0){seenT=0.4;for(const e of enemies){if(e.dead)continue;if(e.type.flee&&e.mesh.visible)fx.burst(e.pos.x,e.pos.y+1,e.pos.z,0xffd34d,2,3);
    if(e.state!=='idle'&&!S2.seen[e.type.key]){S2.seen[e.type.key]=1;saveS2();toast('Almanac: '+e.type.name+' discovered');}}}
});
window.__fb={player,game,enemies,actions,setForm,ABYSS};      // debug handle (console / automated tests)
