// character-builder.js — charData -> THREE.Group (editor preview, players, bots)
import { buildFromParts, makeCapsuleGeo } from './parts.js';

const CharOptions = {
  skin: ['#e8b98f','#c98f5e','#a56a3d','#7a4a28','#5a3620','#f0d5b0'],
  hairstyle: ['short','long','mohawk','bald','ponytail'],
  hair: ['#1a1a1a','#4a2e1a','#8a5a2a','#c9a227','#dedede','#7a1fa2','#e0405a'],
  outfit: ['recon','heavy','stealth','medic'],
  outfitColor: ['#2b3a4a','#3a4a2b','#4a2b3a','#2b2b2b','#4a3a2b','#1f4a4a']
};
function defaultCharData(){
  return { name:'لاعب', skin:CharOptions.skin[0], hairstyle:'short', hair:CharOptions.hair[0],
    outfit:'recon', outfitColor:CharOptions.outfitColor[0], height:1.0, build:1.0, customBody:null };
}
function charStats(d){
  const speed = Math.round(60 + (1.25-d.height)*40 + (1.15-d.build)*20);
  const armor = { recon:20, heavy:70, stealth:10, medic:35 }[d.outfit] || 20;
  const hp = Math.round(80 + (d.build-0.8)*90 + (d.height-0.8)*30);
  return { speed: Math.max(10,Math.min(100,speed)), armor: Math.max(5,Math.min(100,armor)), hp: Math.max(60,Math.min(150,hp)) };
}
function buildCharacterMesh(d){
  const h = d.height||1.0, b = d.build||1.0;
  if(d.customBody && d.customBody.length){
    const g = buildFromParts({parts:d.customBody});
    g.scale.set(b,h,b);
    g.userData.headHeight = 1.55*h; g.userData.eyeHeight = 1.6*h;
    return g;
  }
  const g = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({color:d.skin, roughness:.8});
  const outfitMat = new THREE.MeshStandardMaterial({color:d.outfitColor, roughness:.7});
  const hairMat = new THREE.MeshStandardMaterial({color:d.hair, roughness:.9});

  const torso = new THREE.Mesh(makeCapsuleGeo(0.28*b,0.55*h,4,8), outfitMat);
  torso.position.y = 1.05*h; torso.castShadow=true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22,16,16), skinMat);
  head.position.y = 1.55*h; head.castShadow=true; head.userData.isHead = true;
  g.add(head);

  if(d.hairstyle!=='bald'){
    let hairGeo;
    if(d.hairstyle==='mohawk') hairGeo = new THREE.BoxGeometry(0.06,0.18,0.3);
    else if(d.hairstyle==='long') hairGeo = makeCapsuleGeo(0.23,0.3,4,8);
    else if(d.hairstyle==='ponytail') hairGeo = new THREE.ConeGeometry(0.08,0.35,6);
    else hairGeo = new THREE.SphereGeometry(0.235,12,12,0,Math.PI*2,0,Math.PI*0.55);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = d.hairstyle==='ponytail' ? 1.5*h : (d.hairstyle==='long' ? 1.45*h : 1.62*h);
    if(d.hairstyle==='ponytail') hair.position.z = -0.2;
    g.add(hair);
  }

  const armGeo = makeCapsuleGeo(0.07*b,0.45*h,4,6);
  const armL = new THREE.Mesh(armGeo, outfitMat); armL.position.set(0.35*b,1.05*h,0); armL.castShadow=true; g.add(armL);
  const armR = new THREE.Mesh(armGeo, outfitMat); armR.position.set(-0.35*b,1.05*h,0); armR.castShadow=true; g.add(armR);

  const legGeo = makeCapsuleGeo(0.09*b,0.5*h,4,6);
  const legL = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({color:'#20242c',roughness:.8}));
  legL.position.set(0.13,0.4*h,0); legL.castShadow=true; g.add(legL);
  const legR = legL.clone(); legR.position.x=-0.13; g.add(legR);

  if(d.outfit==='heavy'){
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.35,0.15), new THREE.MeshStandardMaterial({color:'#555',metalness:.6,roughness:.4}));
    plate.position.set(0,1.15*h,0.18); g.add(plate);
  }
  g.userData.headHeight = 1.55*h;
  g.userData.eyeHeight = 1.6*h;
  return g;
}

export { CharOptions, defaultCharData, charStats, buildCharacterMesh };
