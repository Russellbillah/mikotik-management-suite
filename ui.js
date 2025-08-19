// Minimal SPA utilities
const $ = (s)=>document.querySelector(s);
const h = (tag, props={}, kids=[])=>{ const el=document.createElement(tag);
  Object.entries(props).forEach(([k,v])=>{
    if(k==='class') el.className=v; else if(k==='text') el.textContent=v;
    else if(k==='html') el.innerHTML=v; else if(k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k,v);
  });
  kids.forEach(k=> el.appendChild(typeof k==='string'?document.createTextNode(k):k));
  return el;
};

// Auth
let token = localStorage.getItem('jwt')||'';
let profile = null;
async function api(path, opts={}){
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(token) opts.headers['Authorization'] = 'Bearer '+token;
  const r = await fetch(path, opts);
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||r.statusText);
  return j;
}
async function ensureLogin(){
  if(token) return true;
  const page=$('#page'); page.innerHTML='';
  const box=h('div',{class:'card'},[
    h('h2',{text:'Login'}),
    h('div',{class:'row'},[h('input',{id:'lu',placeholder:'Username'}), h('input',{id:'lp',type:'password',placeholder:'Password'}),
      h('button',{text:'Login', onclick: async()=>{
        try{ const j=await api('/auth/login',{method:'POST', body: JSON.stringify({username:$('#lu').value, password:$('#lp').value})}); token=j.token; profile=j.profile; localStorage.setItem('jwt',token); boot(); }catch(e){ alert(e.message); }
      }})]),
    h('p',{class:'small',text:'First run? If no users exist, register an owner:'}),
    h('div',{class:'row'},[h('input',{id:'ru',placeholder:'New Admin Username'}), h('input',{id:'rp',type:'password',placeholder:'New Admin Password'}),
      h('button',{text:'Register', onclick: async()=>{
        try{ const j=await api('/auth/register',{method:'POST', body: JSON.stringify({username:$('#ru').value, password:$('#rp').value})}); token=j.token; localStorage.setItem('jwt',token); boot(); }catch(e){ alert(e.message); }
      }})])
  ]);
  page.appendChild(box);
  return false;
}

// Routers
let routers=[]; let currentRouter=null; let activePage='dashboard';
async function loadRouters(){
  routers = await api('/api/routers');
  const sel=$('#routerSelect'); sel.innerHTML='';
  routers.forEach(r=> sel.appendChild(h('option',{value:r.id, text:`${r.host} (${r.user})`})) );
  if(routers.length && !currentRouter) currentRouter = routers[0].id;
  if(currentRouter) sel.value=currentRouter;
}
async function addRouter(){
  const host=prompt('Router IP / Host:'), user=prompt('Username:'), pass=prompt('Password:'), port=prompt('API port (8728):','8728');
  if(!host||!user) return;
  try{ await api('/api/routers',{method:'POST', body: JSON.stringify({host,user,pass,port})}); await loadRouters(); showPage(activePage); }catch(e){ alert(e.message); }
}
async function deleteRouter(){
  if(!currentRouter) return;
  if(!confirm('Delete selected router?')) return;
  await api('/api/routers/'+currentRouter,{method:'DELETE'});
  currentRouter=null; await loadRouters(); showPage('dashboard');
}

// Charts
let cpuTimer=null, trafficTimer=null, cpuChart=null, trafficChart=null;
function initCpuChart(){
  const ctx = document.getElementById('cpuChart').getContext('2d');
  cpuChart = new Chart(ctx,{type:'line', data:{labels:[], datasets:[{label:'CPU %', data:[], fill:false}]}, options:{animation:false, scales:{y:{beginAtZero:true, max:100}}}});
}
function cpuPush(v){
  cpuChart.data.labels.push(new Date().toLocaleTimeString());
  cpuChart.data.datasets[0].data.push(v);
  if(cpuChart.data.labels.length>50){ cpuChart.data.labels.shift(); cpuChart.data.datasets[0].data.shift(); }
  cpuChart.update();
}
async function cpuTick(){ try{ const j=await api(`/api/${currentRouter}/system/resource`); cpuPush(Number(j['cpu-load']||0)); }catch{} }
function initTrafficChart(){
  const ctx=document.getElementById('trafficChart').getContext('2d');
  trafficChart = new Chart(ctx,{type:'line', data:{labels:[], datasets:[{label:'RX bytes/s', data:[], fill:false},{label:'TX bytes/s', data:[], fill:false}]}, options:{animation:false}});
}

// Pages
const pages = {
  async dashboard(){
    const page=$('#page'); page.innerHTML='';
    const card=h('div',{class:'card'}); page.appendChild(card);
    const sys=h('div',{text:'Loading system resource...'}); card.appendChild(sys);
    const canv1=h('canvas',{id:'cpuChart',height:'80'}); page.appendChild(h('div',{class:'card'},[h('h3',{text:'CPU % (live)'}), canv1]));
    const canv2=h('canvas',{id:'trafficChart',height:'120'});
    page.appendChild(h('div',{class:'card'},[h('h3',{text:'Traffic (select interface)'}), h('div',{class:'row'},[h('select',{id:'ifaceSel'}), h('button',{text:'Start', onclick:startTraffic}), h('button',{text:'Stop', onclick:stopTraffic})]), canv2]));
    const res=await api(`/api/${currentRouter}/system/resource`);
    sys.textContent=`CPU: ${res['cpu-load']}% | Uptime: ${res['uptime']} | Free mem: ${res['free-memory']}`;
    const ifs=await api(`/api/${currentRouter}/interface`);
    const sel=$('#ifaceSel'); sel.innerHTML=''; sel.appendChild(h('option',{value:'',text:'-- select --'})); ifs.forEach(i=> sel.appendChild(h('option',{value:i.name, text:i.name})));
    initCpuChart(); initTrafficChart(); cpuTick(); cpuTimer=setInterval(cpuTick, 5000);
  },
  async interfaces(){
    const page=$('#page'); page.innerHTML='';
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Interfaces'}), tbl]));
    tbl.innerHTML='<tr><th>Name</th><th>Type</th><th>Running</th><th>Disabled</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/interface`);
    list.forEach(i=>{
      const tr=h('tr'); tr.innerHTML=`<td>${i.name}</td><td>${i.type||''}</td><td>${i.running}</td><td>${i.disabled}</td>`;
      const td=h('td'); td.appendChild(h('button',{text:(i.disabled==='true'?'Enable':'Disable'), onclick: async()=>{
        try{ await api(`/api/${currentRouter}/run`, {method:'POST', body: JSON.stringify({path:'/interface/set', params:[`=.id=${i['.id']}`, `=disabled=${i.disabled==='true'?'no':'yes'}`]})}); showPage('interfaces'); }catch(e){ alert(e.message); }
      }}));
      tr.appendChild(td); tbl.appendChild(tr);
    });
  },
  async ip(){
    const page=$('#page'); page.innerHTML='';
    const card=h('div',{class:'card'},[h('div',{class:'row'},[h('input',{id:'addr',placeholder:'192.168.88.10/24'}), h('input',{id:'iface',placeholder:'ether1'}), h('button',{text:'Add', onclick: async()=>{
      try{ await api(`/api/${currentRouter}/ip/address`, {method:'POST', body: JSON.stringify({address:$('#addr').value, interface:$('#iface').value})}); showPage('ip'); }catch(e){ alert(e.message); }
    }})])]); page.appendChild(card);
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'IP Addresses'}), tbl]));
    tbl.innerHTML='<tr><th>Address</th><th>Interface</th><th>Network</th><th>Disabled</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/ip/address`);
    list.forEach(x=>{ const tr=h('tr'); tr.innerHTML=`<td>${x.address}</td><td>${x.interface}</td><td>${x.network||''}</td><td>${x.disabled||''}</td>`;
      const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/ip/address/${x['.id']}`, {method:'DELETE'}); showPage('ip'); }})); tr.appendChild(td); tbl.appendChild(tr); });
  },
  async firewall(){
    const page=$('#page'); page.innerHTML='';
    const card=h('div',{class:'card'},[h('div',{class:'row'},[h('select',{id:'chain'}), h('select',{id:'action'}), h('input',{id:'src',placeholder:'src-address'}), h('input',{id:'dst',placeholder:'dst-address'}), h('input',{id:'proto',placeholder:'protocol'}), h('input',{id:'comm',placeholder:'comment'}), h('button',{text:'Add Rule', onclick:addRule})])]);
    page.appendChild(card);
    ['input','forward','output'].forEach(c=> card.querySelector('#chain').appendChild(h('option',{value:c,text:c}))); ['accept','drop','reject'].forEach(a=> card.querySelector('#action').appendChild(h('option',{value:a,text:a})));
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Firewall Filter'}), tbl]));
    tbl.innerHTML='<tr><th>#</th><th>Chain</th><th>Action</th><th>Src</th><th>Dst</th><th>Proto</th><th>Comment</th><th>Disabled</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/firewall/filter`);
    list.forEach((f,i)=>{ const tr=h('tr'); tr.innerHTML=`<td>${i+1}</td><td>${f.chain||''}</td><td>${f.action||''}</td><td>${f['src-address']||''}</td><td>${f['dst-address']||''}</td><td>${f.protocol||''}</td><td>${f.comment||''}</td><td>${f.disabled||''}</td>`;
      const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/firewall/filter/${f['.id']}`, {method:'DELETE'}); showPage('firewall'); }})); tr.appendChild(td); tbl.appendChild(tr); });
    async function addRule(){ try{ await api(`/api/${currentRouter}/firewall/filter`, {method:'POST', body: JSON.stringify({chain:$('#chain').value, action:$('#action').value, src:$('#src').value, dst:$('#dst').value, protocol:$('#proto').value, comment:$('#comm').value})}); showPage('firewall'); }catch(e){ alert(e.message); } }
  },
  async nat(){
    const page=$('#page'); page.innerHTML='';
    const form=h('div',{class:'card'},[h('div',{class:'row'},[h('select',{id:'chain'}), h('select',{id:'action'}), h('input',{id:'src',placeholder:'src-address'}), h('input',{id:'dst',placeholder:'dst-address'}), h('input',{id:'oif',placeholder:'out-interface'}), h('input',{id:'comm',placeholder:'comment'}), h('button',{text:'Add NAT', onclick: addNat})])]);
    ['srcnat','dstnat'].forEach(c=> form.querySelector('#chain').appendChild(h('option',{value:c,text:c}))); ['masquerade','dst-nat','src-nat','redirect'].forEach(a=> form.querySelector('#action').appendChild(h('option',{value:a,text:a})));
    const tbl=h('table'); page.appendChild(form); page.appendChild(h('div',{class:'card'},[h('h3',{text:'NAT Rules'}), tbl]));
    tbl.innerHTML='<tr><th>#</th><th>Chain</th><th>Action</th><th>Src</th><th>Dst</th><th>Out-IF</th><th>Comment</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/nat`);
    list.forEach((n,i)=>{ const tr=h('tr'); tr.innerHTML=`<td>${i+1}</td><td>${n.chain||''}</td><td>${n.action||''}</td><td>${n['src-address']||''}</td><td>${n['dst-address']||''}</td><td>${n['out-interface']||''}</td><td>${n.comment||''}</td>`;
      const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/nat/${n['.id']}`, {method:'DELETE'}); showPage('nat'); }}));
      tr.appendChild(td); tbl.appendChild(tr);
    });
    async function addNat(){ try{ await api(`/api/${currentRouter}/nat`, {method:'POST', body: JSON.stringify({chain:$('#chain').value, action:$('#action').value, src:$('#src').value, dst:$('#dst').value, out_interface:$('#oif').value, comment:$('#comm').value})}); showPage('nat'); }catch(e){ alert(e.message); } }
  },
  async vlan(){
    const page=$('#page'); page.innerHTML='';
    const form=h('div',{class:'card'},[h('div',{class:'row'},[h('input',{id:'vname',placeholder:'vlan name'}), h('input',{id:'vid',placeholder:'vlan id'}), h('input',{id:'viface',placeholder:'parent interface'}), h('button',{text:'Add VLAN', onclick: async()=>{
      try{ await api(`/api/${currentRouter}/vlan`, {method:'POST', body: JSON.stringify({name:$('#vname').value, vlan_id:$('#vid').value, interface:$('#viface').value})}); showPage('vlan'); }catch(e){ alert(e.message); }
    }})])]);
    const tblv=h('table'); const tblb=h('table');
    page.appendChild(form);
    page.appendChild(h('div',{class:'card'},[h('h3',{text:'VLANs'}), tblv]));
    page.appendChild(h('div',{class:'card'},[h('h3',{text:'Bridges'}), tblb]));
    tblv.innerHTML='<tr><th>Name</th><th>VID</th><th>Interface</th><th>Action</th></tr>';
    const vl=await api(`/api/${currentRouter}/vlan`);
    vl.forEach(v=>{ const tr=h('tr'); tr.innerHTML=`<td>${v.name}</td><td>${v['vlan-id']||''}</td><td>${v.interface||''}</td>`; const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/vlan/${v['.id']}`, {method:'DELETE'}); showPage('vlan'); }})); tr.appendChild(td); tblv.appendChild(tr); });
    tblb.innerHTML='<tr><th>Name</th><th>Protocol</th><th>Fast-Forward</th></tr>';
    const br=await api(`/api/${currentRouter}/bridge`);
    br.forEach(b=>{ const tr=h('tr'); tr.innerHTML=`<td>${b.name}</td><td>${b.protocol||''}</td><td>${b['fast-forward']||''}</td>`; tblb.appendChild(tr); });
  },
  async queues(){
    const page=$('#page'); page.innerHTML='';
    const form=h('div',{class:'card'},[h('div',{class:'row'},[h('input',{id:'qname',placeholder:'queue name'}), h('input',{id:'qtarget',placeholder:'target IP/subnet'}), h('input',{id:'qlim',placeholder:'max-limit e.g. 10M/10M'}), h('button',{text:'Add Queue', onclick: async()=>{
      try{ await api(`/api/${currentRouter}/queue/simple`, {method:'POST', body: JSON.stringify({name:$('#qname').value, target:$('#qtarget').value, max_limit:$('#qlim').value})}); showPage('queues'); }catch(e){ alert(e.message); }
    }})])]);
    page.appendChild(form);
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Simple Queues'}), tbl]));
    tbl.innerHTML='<tr><th>Name</th><th>Target</th><th>Max-Limit</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/queue/simple`);
    list.forEach(q=>{ const tr=h('tr'); tr.innerHTML=`<td>${q.name}</td><td>${q.target||''}</td><td>${q['max-limit']||''}</td>`; const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/queue/simple/${q['.id']}`, {method:'DELETE'}); showPage('queues'); }})); tr.appendChild(td); tbl.appendChild(tr); });
  },
  async dhcp(){
    const page=$('#page'); page.innerHTML='';
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'DHCP Leases'}), tbl]));
    tbl.innerHTML='<tr><th>Address</th><th>MAC</th><th>Host</th><th>Status</th></tr>';
    const list=await api(`/api/${currentRouter}/dhcp/lease`);
    list.forEach(x=>{ const tr=h('tr'); tr.innerHTML=`<td>${x.address||''}</td><td>${x['mac-address']||''}</td><td>${x['host-name']||''}</td><td>${x.status||''}</td>`; tbl.appendChild(tr); });
  },
  async hotspot(){
    const page=$('#page'); page.innerHTML='';
    const form=h('div',{class:'card'},[h('div',{class:'row'},[h('input',{id:'hname',placeholder:'user'}), h('input',{id:'hpass',placeholder:'password',type:'password'}), h('input',{id:'hprof',placeholder:'profile (optional)'}), h('button',{text:'Add Hotspot User', onclick: async()=>{
      try{ await api(`/api/${currentRouter}/hotspot/users`, {method:'POST', body: JSON.stringify({name:$('#hname').value, password:$('#hpass').value, profile:$('#hprof').value})}); showPage('hotspot'); }catch(e){ alert(e.message); }
    }})])]);
    page.appendChild(form);
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Hotspot Users'}), tbl]));
    tbl.innerHTML='<tr><th>Name</th><th>Profile</th><th>Limit-Bytes</th><th>Action</th></tr>';
    const list=await api(`/api/${currentRouter}/hotspot/users`);
    list.forEach(u=>{ const tr=h('tr'); tr.innerHTML=`<td>${u.name}</td><td>${u.profile||''}</td><td>${u['limit-bytes-total']||''}</td>`; const td=h('td'); td.appendChild(h('button',{text:'Delete', onclick: async()=>{ await api(`/api/${currentRouter}/hotspot/users/${u['.id']}`, {method:'DELETE'}); showPage('hotspot'); }})); tr.appendChild(td); tbl.appendChild(tr); });
  },
  async capsman(){
    const page=$('#page'); page.innerHTML='';
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'CAPsMAN Registrations'}), tbl]));
    tbl.innerHTML='<tr><th>Radio MAC</th><th>SSID</th><th>Signal</th><th>TX Rate</th><th>RX Rate</th><th>Uptime</th></tr>';
    const list=await api(`/api/${currentRouter}/capsman/registrations`);
    list.forEach(r=>{ const tr=h('tr'); tr.innerHTML=`<td>${r['radio-mac']||''}</td><td>${r.ssid||''}</td><td>${r.signal||''}</td><td>${r['tx-rate']||''}</td><td>${r['rx-rate']||''}</td><td>${r.uptime||''}</td>`; tbl.appendChild(tr); });
  },
  async scripts(){
    const page=$('#page'); page.innerHTML='';
    const area=h('textarea',{id:'cmd',rows:'6',style:'width:100%',placeholder:'Example:\n/ip/address/print\n/ip/firewall/filter/print\n'});
    const out=h('pre',{id:'out',class:'card'});
    const runBtn=h('button',{text:'Run (whitelist)', onclick: async()=>{
      const raw=area.value.trim().split(/\s+/); const path=raw.shift(); const params=raw.map(x=> x.startsWith('=')?x:(x.includes('=')?`=${x}`:x));
      try{ const j=await api(`/api/${currentRouter}/run`, {method:'POST', body: JSON.stringify({path, params})}); out.textContent=JSON.stringify(j,null,2); }catch(e){ alert(e.message); }
    }});
    page.appendChild(h('div',{class:'card'},[h('h3',{text:'Command Runner'}), area, h('div',{class:'row',style:'margin-top:8px'},[runBtn])]));
    page.appendChild(out);
  },
  async config(){
    const page=$('#page'); page.innerHTML='';
    const pre=h('pre',{class:'card',text:'Exporting...'}); page.appendChild(pre);
    const j=await api(`/api/${currentRouter}/export`);
    pre.textContent=(j.lines||[]).map(x=> typeof x==='string'?x:JSON.stringify(x)).join('\n');
  },
  async backups(){
    const page=$('#page'); page.innerHTML='';
    const row=h('div',{class:'row'},[h('button',{text:'Create Backup', onclick: async()=>{ try{ const j=await api(`/api/${currentRouter}/backup`, {method:'POST'}); alert('Saved: '+j.files.snapshot+' and '+j.files.export); showPage('backups'); }catch(e){ alert(e.message);} }})]);
    page.appendChild(h('div',{class:'card'},[row]));
    const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Stored Backups'}), tbl]));
    tbl.innerHTML='<tr><th>File</th><th>Link</th></tr>';
    const files=await api('/api/backups');
    files.forEach(f=>{ const tr=h('tr'); tr.innerHTML=`<td>${f.name}</td><td><a href="${f.url}" target="_blank">Download</a></td>`; tbl.appendChild(tr); });
  },
  async admin(){
    const page=$('#page'); page.innerHTML='';
    const info=h('div',{class:'card', html:`<div><strong>Your role:</strong> ${profile?profile.role:'(unknown)'}</div><div class="small">Only <em>owner</em> can change roles.</div>`});
    page.appendChild(info);
    try{
      const users=await api('/api/admin/users');
      const tbl=h('table'); page.appendChild(h('div',{class:'card'},[h('h3',{text:'Users & Roles'}), tbl]));
      tbl.innerHTML='<tr><th>Username</th><th>Role</th><th>Set Role</th></tr>';
      users.forEach(u=>{
        const tr=h('tr'); tr.innerHTML=`<td>${u.username}</td><td>${u.role}</td>`;
        const td=h('td'); const sel=h('select'); ['owner','admin','read'].forEach(r=> sel.appendChild(h('option',{value:r,text:r}))); sel.value=u.role;
        const btn=h('button',{text:'Apply', onclick: async()=>{ try{ await api(`/api/admin/users/${u.id}/role`, {method:'POST', body: JSON.stringify({role: sel.value})}); showPage('admin'); }catch(e){ alert(e.message);} }});
        td.appendChild(sel); td.appendChild(btn); tr.appendChild(td); tbl.appendChild(tr);
      });
    }catch(e){
      page.appendChild(h('div',{class:'card', text:'You are not owner or cannot list users.'}));
    }
  }
};

let lastTraffic=null;
function startTraffic(){
  const iface=$('#ifaceSel').value; if(!iface) return alert('Select interface');
  if(trafficTimer) clearInterval(trafficTimer);
  trafficChart.data.labels=[]; trafficChart.data.datasets[0].data=[]; trafficChart.data.datasets[1].data=[]; trafficChart.update();
  lastTraffic=null;
  trafficTimer=setInterval(async ()=>{
    try{
      const t=await api(`/api/${currentRouter}/interface/monitor?iface=${encodeURIComponent(iface)}`);
      const now=new Date();
      let rx=Number(t['rx-bytes-per-second']||t['rx-rate']||0);
      let tx=Number(t['tx-bytes-per-second']||t['tx-rate']||0);
      if(!rx && (t['rx-byte']||t['rx-bytes'])){
        const totRx=Number(t['rx-byte']||t['rx-bytes']||0), totTx=Number(t['tx-byte']||t['tx-bytes']||0);
        if(lastTraffic){ const dt=(now-lastTraffic.time)/1000; rx=Math.max(0,Math.round((totRx-lastTraffic.rx)/dt)); tx=Math.max(0,Math.round((totTx-lastTraffic.tx)/dt)); }
        lastTraffic={time:now, rx:totRx, tx:totTx};
      }
      trafficChart.data.labels.push(now.toLocaleTimeString());
      trafficChart.data.datasets[0].data.push(rx);
      trafficChart.data.datasets[1].data.push(tx);
      if(trafficChart.data.labels.length>50){ trafficChart.data.labels.shift(); trafficChart.data.datasets[0].data.shift(); trafficChart.data.datasets[1].data.shift(); }
      trafficChart.update();
    }catch(e){ console.error(e); }
  }, 2000);
}
function stopTraffic(){ if(trafficTimer) clearInterval(trafficTimer); trafficTimer=null; }

// Boot
async function boot(){
  $('#userbar').innerHTML='';
  $('#userbar').appendChild(h('div',{text: profile?`Logged in as ${profile.username} (${profile.role})`:'Logged in'}));
  $('#userbar').appendChild(h('button',{text:'Logout', onclick:()=>{ localStorage.removeItem('jwt'); token=''; location.reload(); }}));
  const ok=await ensureLogin(); if(!ok) return;
  try{ const j=await api('/auth/login',{method:'POST', body: JSON.stringify({username:'__noop__', password:'__noop__'})}); }catch{}
  // profile may be set on login; if not, ignore
  await loadRouters();
  $('#addRouterBtn').onclick=addRouter;
  $('#deleteRouterBtn').onclick=deleteRouter;
  $('#backupBtn').onclick=async()=>{ try{ const j=await api(`/api/${currentRouter}/backup`, {method:'POST'}); alert('Saved backup files:\n'+j.files.snapshot+'\n'+j.files.export); }catch(e){ alert(e.message);} };
  $('#routerSelect').addEventListener('change', e=>{ currentRouter=e.target.value; showPage(activePage); });
  document.querySelectorAll('nav .link').forEach(a=> a.addEventListener('click', ()=> showPage(a.dataset.page) ));
  showPage('dashboard');
}
async function showPage(name){ activePage=name; if(!currentRouter){ await loadRouters(); if(!routers.length){ alert('Add a router first'); return; } } await pages[name](); }
boot();
