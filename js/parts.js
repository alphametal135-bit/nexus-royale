// parts.js — generic part/asset system (primitive-based molds)
import { Store } from './store.js';

function makeCapsuleGeo(radius, length, capSeg, radSeg){
  return new THREE.CylinderGeometry(radius, radius, length + radius*2, radSeg||8, 1, false);
}
const PART_TYPES = ['box','sphere','cylinder','cone','capsule','icosahedron'];
const PART_LABELS = {box:'🧊 مكعب',sphere:'⚪ كرة',cylinder:'🛢️ أسطوانة',cone:'🔺 مخروط',capsule:'💊 كبسولة',icosahedron:'🪨 صخري'};
const PART_COLORS = ['#e8b98f','#2b3a4a','#1f5733','#5a3620','#8a7355','#00d4ff','#f59e0b','#ef4444','#dedede','#2a2a2a'];
function makePartGeometry(type){
  switch(type){
    case 'box': return new THREE.BoxGeometry(1,1,1);
    case 'sphere': return new THREE.SphereGeometry(0.5,14,14);
    case 'cylinder': return new THREE.CylinderGeometry(0.4,0.4,1,12);
    case 'cone': return new THREE.ConeGeometry(0.5,1,10);
    case 'capsule': return makeCapsuleGeo(0.3,0.5,4,8);
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.5,0);
    default: return new THREE.BoxGeometry(1,1,1);
  }
}
function buildFromParts(assetData){
  const g = new THREE.Group();
  (assetData.parts||[]).forEach(p=>{
    const geo = makePartGeometry(p.type);
    const mat = new THREE.MeshStandardMaterial({color:p.color||'#888', roughness:.8, flatShading:p.type==='icosahedron'});
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p.pos.x, p.pos.y, p.pos.z);
    const s = p.scale||0.5;
    m.scale.set(s,s,s);
    m.castShadow = true; m.receiveShadow = true;
    if(p.isHead) m.userData.isHead = true;
    g.add(m);
  });
  return g;
}
async function loadAsset(id){ return await Store.get('asset:'+id, true); }
async function preloadAssets(ids){
  const map = {};
  await Promise.all([...new Set(ids)].filter(Boolean).map(async id=>{
    const a = await Store.get('asset:'+id, true);
    if(a) map[id] = a;
  }));
  return map;
}

export { makeCapsuleGeo, PART_TYPES, PART_LABELS, PART_COLORS, makePartGeometry, buildFromParts, loadAsset, preloadAssets };
