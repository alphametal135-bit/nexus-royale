// terrain-builder.js — worldData -> scene meshes + heightFn
import { buildFromParts } from './parts.js';

const BIOMES = {
  grass:  { ground:0x4a6b3a, ground2:0x3d5a30, tree:0x1f5733, rock:0x555a5f, fog:0x8fae95 },
  desert: { ground:0xc9a25c, ground2:0xb5883f, tree:0x6b7a3a, rock:0x8a7355, fog:0xd8c090 },
  snow:   { ground:0xdfe8ee, ground2:0xc8d5df, tree:0x2f4a3a, rock:0x6f7a80, fog:0xe8eef2 },
  volcanic:{ ground:0x3a2a28, ground2:0x2a1c1a, tree:0x2a2024, rock:0x4a3436, fog:0x4a2a24 }
};
const WEATHERS = ['clear','rain','fog','snow','storm'];
const WEATHER_LABELS = {clear:'☀️ صافي', rain:'🌧️ ماطر', fog:'🌫️ ضباب', snow:'❄️ ثلج', storm:'⛈️ عاصفة'};

function defaultWorldData(){
  return { name:'خريطتي', hills:1.2, water:-0.6, biome:'grass', weather:'clear', objects:[], size:110 };
}
function terrainHeightFn(wd){
  const amp = wd.hills;
  return (x,z)=> Math.sin(x*0.045)*amp*0.9 + Math.cos(z*0.04)*amp*0.9 + Math.sin((x+z)*0.018)*amp*1.3;
}
function buildTerrainScene(wd, scene){
  const biome = BIOMES[wd.biome] || BIOMES.grass;
  const heightFn = terrainHeightFn(wd);
  const size = wd.size||110;
  const seg = 64;
  const geo = new THREE.PlaneGeometry(size,size,seg,seg);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  const colors = [];
  const c1 = new THREE.Color(biome.ground), c2 = new THREE.Color(biome.ground2);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), z=pos.getZ(i);
    const h = heightFn(x,z);
    pos.setY(i,h);
    const mix = (Math.sin(x*0.1)+Math.cos(z*0.1)+2)/4;
    const c = c1.clone().lerp(c2, mix);
    colors.push(c.r,c.g,c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({vertexColors:true, roughness:1}));
  ground.receiveShadow = true;
  scene.add(ground);

  let water = null;
  if(wd.water > -1.9){
    water = new THREE.Mesh(new THREE.PlaneGeometry(size*1.4,size*1.4), new THREE.MeshStandardMaterial({color:0x2a6a8a, transparent:true, opacity:0.75, roughness:0.15, metalness:0.3}));
    water.rotation.x = -Math.PI/2; water.position.y = wd.water;
    scene.add(water);
  }

  // sky / fog per weather
  const wcol = { clear:0x8fc7e8, rain:0x2a323a, fog:0x9aa5ab, snow:0xd8e2e8, storm:0x1c222a }[wd.weather] || 0x8fc7e8;
  scene.background = new THREE.Color(wcol);
  scene.fog = new THREE.FogExp2(biome.fog, wd.weather==='fog' ? 0.028 : (wd.weather==='storm'?0.02:0.011));

  const hemi = new THREE.HemisphereLight(wd.weather==='storm'?0x333844:0x9fb8cc, biome.ground, wd.weather==='storm'?0.35:0.65);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, wd.weather==='storm'?0.4:1.0);
  sun.position.set(40,60,20); sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-90; sun.shadow.camera.right=90; sun.shadow.camera.top=90; sun.shadow.camera.bottom=-90;
  scene.add(sun);

  return { heightFn, ground, water, biome };
}

function makeTreeMesh(biome){
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.2,1.4,6), new THREE.MeshStandardMaterial({color:0x5a3f28,roughness:1}));
  trunk.position.y=0.7; trunk.castShadow=true; g.add(trunk);
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.1,2.2,7), new THREE.MeshStandardMaterial({color:biome.tree,roughness:.9,flatShading:true}));
  top.position.y=2.1; top.castShadow=true; g.add(top);
  return g;
}
function makeRockMesh(biome){
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6+Math.random()*0.5,0), new THREE.MeshStandardMaterial({color:biome.rock,roughness:1,flatShading:true}));
  m.castShadow=true; m.receiveShadow=true;
  m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
  return m;
}
function makeBushMesh(biome){
  const g = new THREE.Group();
  for(let i=0;i<3;i++){
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.35,8,8), new THREE.MeshStandardMaterial({color:biome.tree,roughness:1}));
    s.position.set((Math.random()-.5)*0.4, 0.3+(Math.random()-.5)*0.15, (Math.random()-.5)*0.4);
    s.castShadow=true; g.add(s);
  }
  return g;
}
function makeMountainMesh(biome){
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.ConeGeometry(3.4+Math.random(),6+Math.random()*2,8), new THREE.MeshStandardMaterial({color:biome.rock,roughness:1,flatShading:true}));
  base.position.y=3; base.castShadow=true; base.receiveShadow=true; g.add(base);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1,1.6,8), new THREE.MeshStandardMaterial({color:0xf2f6fa,roughness:.9,flatShading:true}));
  cap.position.y=6.2; cap.castShadow=true; g.add(cap);
  return g;
}
function makeCrateMesh(){
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.6,0.8), new THREE.MeshStandardMaterial({color:0x2a3a4a,metalness:.4,roughness:.5,emissive:0x00d4ff,emissiveIntensity:0.15}));
  box.position.y=0.3; box.castShadow=true; g.add(box);
  const light = new THREE.PointLight(0x00d4ff, 1, 4); light.position.y=0.8; g.add(light);
  return g;
}
function makeSpawnMarker(){
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.3,0.6,4), new THREE.MeshStandardMaterial({color:0xf59e0b, emissive:0xf59e0b, emissiveIntensity:0.4}));
  m.position.y=0.3;
  return m;
}
function objectMeshFactory(o, biome, assetsMap){
  assetsMap = assetsMap || {};
  if(o.assetId && assetsMap[o.assetId]) return buildFromParts(assetsMap[o.assetId]);
  if(o.type==='tree') return makeTreeMesh(biome);
  if(o.type==='rock') return makeRockMesh(biome);
  if(o.type==='mountain') return makeMountainMesh(biome);
  if(o.type==='bush') return makeBushMesh(biome);
  if(o.type==='crate') return makeCrateMesh();
  if(o.type==='spawn') return makeSpawnMarker();
  return new THREE.Mesh(new THREE.BoxGeometry(0.4,0.4,0.4), new THREE.MeshStandardMaterial({color:0xff00ff}));
}
function placeObjectsInScene(wd, scene, heightFn, biome, editorMode, assetsMap){
  const group = new THREE.Group();
  wd.objects.forEach(o=>{
    if(o.type==='spawn' && !editorMode) return; // spawn markers hidden in real gameplay
    const m = objectMeshFactory(o, biome, assetsMap);
    const y = heightFn(o.x,o.z);
    m.position.set(o.x, y, o.z);
    m.userData.objRef = o;
    group.add(m);
  });
  scene.add(group);
  return group;
}
function weatherParticles(scene, weather, size){
  if(weather==='clear') return null;
  const count = weather==='storm' ? 900 : (weather==='snow'?500:700);
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count*3);
  for(let i=0;i<count;i++){
    positions[i*3] = (Math.random()-.5)*size;
    positions[i*3+1] = Math.random()*40;
    positions[i*3+2] = (Math.random()-.5)*size;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const isSnow = weather==='snow';
  const mat = new THREE.PointsMaterial({ color: isSnow?0xffffff:0x9fd0ff, size: isSnow?0.18:0.12, transparent:true, opacity:.75 });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return { pts, speed: isSnow?3:(weather==='storm'?22:16), size };
}
function updateWeatherParticles(wp, delta){
  if(!wp) return;
  const pos = wp.pts.geometry.attributes.position;
  for(let i=0;i<pos.count;i++){
    let y = pos.getY(i) - wp.speed*delta;
    if(y<0) y = 40;
    pos.setY(i,y);
  }
  pos.needsUpdate = true;
}

/* ---------------- global weapon presets (built-in) ---------------- */
const WEAPON_PRESETS = {
  fists:{name:'قبضتان', dmg:6, range:2.2, cooldown:500, recoil:0, auto:false, icon:'🖐️'},
  easy:{name:'مسدس', dmg:14, range:11, cooldown:420, recoil:2, auto:false, icon:'🔫'},
  medium:{name:'رشاش خفيف', dmg:18, range:16, cooldown:170, recoil:4, auto:true, icon:'⚙️'},
  hard:{name:'بندقية قنص', dmg:42, range:30, cooldown:1000, recoil:8, auto:false, icon:'🎯'},
  legendary:{name:'سلاح أسطوري', dmg:55, range:22, cooldown:220, recoil:5, auto:true, icon:'👑'}
};
function resolveWeapon(weaponId, weaponsMap){
  if(!weaponId) return WEAPON_PRESETS.fists;
  if(WEAPON_PRESETS[weaponId]) return WEAPON_PRESETS[weaponId];
  if(weaponsMap && weaponsMap[weaponId]){
    const a = weaponsMap[weaponId];
    return { name:a.name, dmg:a.dmg, range:a.range, cooldown:a.cooldown, recoil:a.recoil, auto:a.auto, icon:'🔫', parts:a.parts };
  }
  return WEAPON_PRESETS.easy;
}

export { BIOMES, WEATHERS, WEATHER_LABELS, defaultWorldData, terrainHeightFn, buildTerrainScene, makeTreeMesh, makeRockMesh, makeBushMesh, makeMountainMesh, makeCrateMesh, makeSpawnMarker, objectMeshFactory, placeObjectsInScene, weatherParticles, updateWeatherParticles, WEAPON_PRESETS, resolveWeapon };
