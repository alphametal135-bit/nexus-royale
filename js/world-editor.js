// world-editor.js — world/map creation screen
import { Store, genCode } from './store.js';
import { Nav, notify } from './nav.js';
import { BIOMES, WEATHERS, WEATHER_LABELS, defaultWorldData, terrainHeightFn, buildTerrainScene, placeObjectsInScene, weatherParticles, updateWeatherParticles, WEAPON_PRESETS } from './terrain-builder.js';
import { preloadAssets } from './parts.js';
import { PlayMenu } from './play-menu.js';

const WorldEditor = (()=>{
  let scene, camera, renderer, raycaster, heightFn, biome, objGroup;
  let WD = defaultWorldData();
  let currentTool = 'tree';
  let assetIndex = []; // {id,name,category}
  let assetsCache = {};
  let orbit = { theta: 0.8, phi: 1.0, dist: 40, target:new THREE.Vector3(0,0,0) };
  let dragging=false, lastX=0,lastY=0;

  function _mkPills(containerId, values, prop, labels, onChange){
    const el = document.getElementById(containerId);
    el.innerHTML='';
    values.forEach((v,i)=>{
      const p = document.createElement('div');
      p.className = 'pill'+(v===WD[prop]?' on':'');
      p.textContent = labels ? labels[v]||labels[i] : v;
      p.addEventListener('click', ()=>{
        el.querySelectorAll('.pill').forEach(x=>x.classList.remove('on'));
        p.classList.add('on');
        WD[prop] = v;
        onChange && onChange();
      });
      el.appendChild(p);
    });
  }

  async function _refreshAssetIndex(){
    assetIndex = (await Store.get('asset-index', true)) || [];
    _refreshToolSelectors();
  }
  function _refreshToolSelectors(){
    const showAsset = ['tree','rock','mountain'].includes(currentTool);
    const showWeapon = currentTool==='crate';
    document.getElementById('wrap-asset-select').classList.toggle('hidden', !showAsset);
    document.getElementById('wrap-weapon-select').classList.toggle('hidden', !showWeapon);
    if(showAsset){
      const sel = document.getElementById('w-asset-select');
      sel.innerHTML = '<option value="">افتراضي (مولّد تلقائي)</option>';
      assetIndex.filter(a=>a.category===currentTool).forEach(a=>{
        const o=document.createElement('option'); o.value=a.id; o.textContent='🧩 '+a.name; sel.appendChild(o);
      });
    }
    if(showWeapon){
      const sel = document.getElementById('w-weapon-select');
      sel.innerHTML='';
      Object.entries(WEAPON_PRESETS).filter(([k])=>k!=='fists').forEach(([k,w])=>{
        const o=document.createElement('option'); o.value=k; o.textContent=w.icon+' '+w.name+' (أساسي)'; sel.appendChild(o);
      });
      assetIndex.filter(a=>a.category==='weapon').forEach(a=>{
        const o=document.createElement('option'); o.value=a.id; o.textContent='🧩 '+a.name+' (مخصص)'; sel.appendChild(o);
      });
    }
  }

  async function _rebuildTerrain(){
    while(scene.children.length) scene.remove(scene.children[0]);
    const t = buildTerrainScene(WD, scene);
    heightFn = t.heightFn; biome = t.biome;
    const ids = WD.objects.map(o=>o.assetId).filter(Boolean);
    const fresh = await preloadAssets(ids);
    assetsCache = Object.assign(assetsCache, fresh);
    objGroup = placeObjectsInScene(WD, scene, heightFn, biome, true, assetsCache);
    _updateCount();
  }
  function _updateCount(){
    const el = document.getElementById('world-objcount');
    const counts = {};
    WD.objects.forEach(o=>counts[o.type]=(counts[o.type]||0)+1);
    el.textContent = `عناصر: ${WD.objects.length}  |  🚩 نقاط ظهور: ${counts.spawn||0}`;
  }

  function _setupCamera(){
    _updateCamPos();
  }
  function _updateCamPos(){
    const {theta,phi,dist,target} = orbit;
    camera.position.set(
      target.x + dist*Math.sin(phi)*Math.sin(theta),
      target.y + dist*Math.cos(phi),
      target.z + dist*Math.sin(phi)*Math.cos(theta)
    );
    camera.lookAt(target);
  }

  function init(){
    const cv = document.getElementById('world-cv');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, cv.clientWidth/cv.clientHeight, 0.1, 500);
    renderer = new THREE.WebGLRenderer({canvas:cv, antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    raycaster = new THREE.Raycaster();

    function resize(){ renderer.setSize(cv.clientWidth, cv.clientHeight); camera.aspect = cv.clientWidth/cv.clientHeight; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize); resize();

    _rebuildTerrain();
    _setupCamera();
    _refreshAssetIndex();

    // orbit drag
    cv.addEventListener('pointerdown', e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
    window.addEventListener('pointerup', ()=>dragging=false);
    window.addEventListener('pointermove', e=>{
      if(!dragging) return;
      const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
      orbit.theta -= dx*0.006;
      orbit.phi = Math.max(0.25, Math.min(1.4, orbit.phi - dy*0.006));
      _updateCamPos();
    });
    cv.addEventListener('wheel', e=>{ orbit.dist = Math.max(8, Math.min(90, orbit.dist + e.deltaY*0.03)); _updateCamPos(); e.preventDefault(); }, {passive:false});

    // placement via double-click (avoids conflict with drag-orbit)
    cv.addEventListener('dblclick', e=>{
      const rect = cv.getBoundingClientRect();
      const mx = ((e.clientX-rect.left)/rect.width)*2-1;
      const my = -((e.clientY-rect.top)/rect.height)*2+1;
      raycaster.setFromCamera({x:mx,y:my}, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const groundHit = hits.find(h=>h.object.geometry && h.object.geometry.type==='PlaneGeometry' && h.point);
      if(!groundHit) return;
      const {x,z} = groundHit.point;
      if(currentTool==='erase'){
        let nearest=null, nd=999;
        WD.objects.forEach(o=>{ const d=Math.hypot(o.x-x,o.z-z); if(d<nd){nd=d; nearest=o;} });
        if(nearest && nd<3){ WD.objects = WD.objects.filter(o=>o!==nearest); _rebuildTerrain(); notify('🗑️ تم حذف العنصر'); }
        return;
      }
      const obj = {type:currentTool, x, z};
      if(['tree','rock','mountain'].includes(currentTool)){
        const aid = document.getElementById('w-asset-select').value;
        if(aid) obj.assetId = aid;
      }
      if(currentTool==='crate'){
        obj.weaponId = document.getElementById('w-weapon-select').value || 'easy';
      }
      WD.objects.push(obj);
      _rebuildTerrain();
    });

    document.querySelectorAll('.tool-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('on'));
        btn.classList.add('on');
        currentTool = btn.dataset.tool;
        _refreshToolSelectors();
      });
    });

    _mkPills('grp-biome', Object.keys(BIOMES), 'biome', {grass:'🌿 عشب',desert:'🏜️ صحراء',snow:'❄️ ثلج',volcanic:'🌋 بركاني'}, _rebuildTerrain);
    _mkPills('grp-weather', WEATHERS, 'weather', WEATHER_LABELS, _rebuildTerrain);

    document.getElementById('s-hills').addEventListener('input', e=>{ WD.hills=+e.target.value; document.getElementById('v-hills').textContent=e.target.value; _rebuildTerrain(); });
    document.getElementById('s-water').addEventListener('input', e=>{ WD.water=+e.target.value; document.getElementById('v-water').textContent=e.target.value; _rebuildTerrain(); });
    document.getElementById('w-name').addEventListener('input', e=>{ WD.name = e.target.value || 'خريطتي'; });

    (function loop(){ requestAnimationFrame(loop); renderer.render(scene,camera); })();
  }

  async function loadExisting(){
    const saved = await Store.get('my-active-world', false);
    if(saved){
      WD = Object.assign(defaultWorldData(), saved);
      document.getElementById('w-name').value = WD.name;
      document.getElementById('s-hills').value = WD.hills; document.getElementById('v-hills').textContent = WD.hills;
      document.getElementById('s-water').value = WD.water; document.getElementById('v-water').textContent = WD.water;
      if(scene) _rebuildTerrain();
    }
    if(scene) _refreshAssetIndex();
  }

  async function save(){
    if(!WD.objects.find(o=>o.type==='spawn')){ notify('⚠️ لازم تحط نقطة ظهور واحدة على الأقل قبل الحفظ'); return false; }
    const code = WD.code || genCode();
    WD.code = code;
    await Store.set('my-active-world', WD, false);
    await Store.set('world:'+code, WD, true); // shared so friends can load by code
    const idx = (await Store.get('world-index', false)) || [];
    if(!idx.find(x=>x.code===code)) idx.push({code, name:WD.name});
    else idx.find(x=>x.code===code).name = WD.name;
    await Store.set('world-index', idx, false);
    notify('✅ تم حفظ ونشر الخريطة — الكود: '+code);
    return true;
  }

  async function saveAndPlay(){
    const ok = await save();
    if(!ok) return;
    const charData = await Store.get('my-active-character', false);
    Nav.show('screen-play');
    PlayMenu.preselect(charData && charData.id, WD.code);
  }

  function getData(){ return WD; }
  function start(){ if(!scene) init(); else loadExisting(); }

  document.getElementById('world-back').addEventListener('click', ()=>Nav.show('screen-menu'));
  document.getElementById('world-save').addEventListener('click', save);
  document.getElementById('world-save-play').addEventListener('click', saveAndPlay);
  document.getElementById('card-world').addEventListener('click', ()=>{ Nav.show('screen-world'); start(); loadExisting(); });

  return { getData, start, refreshAssetIndex:_refreshAssetIndex };
})();

export { WorldEditor };
