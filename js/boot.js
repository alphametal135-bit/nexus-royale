// boot.js — entry point: loads screen modules for their event-wiring side effects, then starts the app
import { Store } from './store.js';
import './character-editor.js';
import './world-editor.js';
import './mold-editor.js';
import { PlayMenu } from './play-menu.js';

function startMenuParticles(){
  const c = document.getElementById('bg-particles');
  const ctx = c.getContext('2d');
  function resize(){ c.width=innerWidth; c.height=innerHeight; }
  resize(); window.addEventListener('resize', resize);
  const pts = Array.from({length:60}, ()=>({x:Math.random()*innerWidth, y:Math.random()*innerHeight, vx:(Math.random()-.5)*.4, vy:(Math.random()-.5)*.4}));
  (function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    for(const p of pts){
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=c.width; if(p.x>c.width)p.x=0; if(p.y<0)p.y=c.height; if(p.y>c.height)p.y=0;
      ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); ctx.fillStyle='rgba(0,212,255,.5)'; ctx.fill();
    }
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
      const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.hypot(dx,dy);
      if(d<120){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y); ctx.strokeStyle=`rgba(0,212,255,${(1-d/120)*.15})`; ctx.lineWidth=.6; ctx.stroke(); }
    }
    requestAnimationFrame(draw);
  })();
}

async function refreshMenuStatus(){
  const chars = (await Store.get('char-index', false)) || [];
  const worlds = (await Store.get('world-index', false)) || [];
  document.getElementById('menu-status').innerHTML =
    `الشخصيات المحفوظة: <b>${chars.length}</b> &nbsp;·&nbsp; الخرائط المحفوظة: <b>${worlds.length}</b>`;
}

document.addEventListener('DOMContentLoaded', ()=>{
  try{
    startMenuParticles();
    refreshMenuStatus();
    PlayMenu.init();
    document.getElementById('card-char').addEventListener('click', refreshMenuStatus);
    document.getElementById('card-world').addEventListener('click', refreshMenuStatus);
  }catch(err){ console.error('[NEXUS ROYALE Boot] init error:', err); }
});
