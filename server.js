/**
 * MikroTik Management Suite - COMPLETE
 * Features: Auth + RBAC, multi-router, monitoring, interfaces, IP addresses,
 * firewall filter & NAT, VLAN/Bridge, Queues (simple), DHCP leases, Hotspot users,
 * CAPsMAN registrations, script runner (whitelist), config export, backups to disk,
 * reboot, and admin user/role management.
 *
 * NOTE: This uses RouterOS API via `node-routeros`. Make sure API service is enabled on routers.
 */
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { RouterOSAPI } = require('node-routeros');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use('/backups', express.static('backups'));

const PORT = parseInt(process.env.PORT || '8080', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ENABLE_WRITE = (process.env.ENABLE_WRITE || 'true').toLowerCase() === 'true';

const FILE_USERS = path.join(__dirname, 'users.json');
const FILE_ROUTERS = path.join(__dirname, 'routers.json');
const BACKUPS_DIR = path.join(__dirname, 'backups');

// ---- utils ----
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function writeJSON(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function ensureFiles() {
  if (!fs.existsSync(FILE_USERS)) writeJSON(FILE_USERS, []);
  if (!fs.existsSync(FILE_ROUTERS)) writeJSON(FILE_ROUTERS, []);
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR);
}
ensureFiles();

function makeConn(cfg) {
  return new RouterOSAPI({
    host: cfg.host, user: cfg.user, password: cfg.pass, port: cfg.port || 8728,
    timeout: cfg.timeout || 8000, keepalive: false
  });
}
function findRouter(id) {
  const list = readJSON(FILE_ROUTERS, []);
  const cfg = list.find(r => r.id === id);
  if (!cfg) throw new Error('Router not found');
  return cfg;
}

// ---- auth & RBAC ----
function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role || 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}
function authMiddleware(req, res, next) {
  if (req.path.startsWith('/auth')) return next();
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { return res.status(401).json({ error: 'invalid token' }); }
}
function requireRole(roles) {
  return (req,res,next)=>{
    const role = (req.user && req.user.role) || 'read';
    if(!roles.includes(role)) return res.status(403).json({ error:'insufficient role' });
    next();
  };
}

// Public auth routes
app.post('/auth/register', (req, res) => {
  const users = readJSON(FILE_USERS, []);
  if (users.length > 0) return res.status(403).json({ error: 'registration closed' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  const id = Date.now().toString();
  const hash = bcrypt.hashSync(password, 10);
  users.push({ id, username, password: hash, role: 'owner' });
  writeJSON(FILE_USERS, users);
  res.json({ ok: true, token: issueToken({ id, role: 'owner' }) });
});
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = readJSON(FILE_USERS, []);
  const u = users.find(x => x.username === username);
  if (!u) return res.status(401).json({ error: 'bad credentials' });
  if (!bcrypt.compareSync(password, u.password)) return res.status(401).json({ error: 'bad credentials' });
  res.json({ ok: true, token: issueToken(u), profile: { id: u.id, username: u.username, role: u.role } });
});

// Protect API
app.use('/api', authMiddleware);

// RBAC admin (owner only)
app.get('/api/admin/users', requireRole(['owner']), (req, res)=>{
  res.json(readJSON(FILE_USERS, []).map(u=>({id:u.id, username:u.username, role:u.role})));
});
app.post('/api/admin/users/:id/role', requireRole(['owner']), (req,res)=>{
  const { role } = req.body||{};
  if(!['owner','admin','read'].includes(role)) return res.status(400).json({ error:'invalid role' });
  const users = readJSON(FILE_USERS, []);
  const u = users.find(x=>x.id===req.params.id);
  if(!u) return res.status(404).json({ error:'user not found' });
  u.role = role; writeJSON(FILE_USERS, users);
  res.json({ ok:true, id:u.id, role:u.role });
});

// ---- Routers registry ----
app.get('/api/routers', (req, res) => {
  res.json(readJSON(FILE_ROUTERS, []).map(({ id, host, user, port }) => ({ id, host, user, port })));
});
app.post('/api/routers', requireRole(['owner','admin']), (req, res) => {
  const { host, user, pass, port } = req.body || {};
  if (!host || !user) return res.status(400).json({ error: 'host & user required' });
  const list = readJSON(FILE_ROUTERS, []);
  const id = Date.now().toString();
  list.push({ id, host, user, pass: pass || '', port: port || 8728 });
  writeJSON(FILE_ROUTERS, list);
  res.json({ ok: true, id });
});
app.delete('/api/routers/:id', requireRole(['owner','admin']), (req, res) => {
  let list = readJSON(FILE_ROUTERS, []);
  list = list.filter(r => r.id !== req.params.id);
  writeJSON(FILE_ROUTERS, list);
  res.json({ ok: true });
});

// ---- Monitoring ----
app.get('/api/:id/system/resource', async (req, res) => {
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const data=await conn.write('/system/resource/print'); await conn.close(); res.json(data[0]||{});
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.get('/api/:id/interface', async (req, res) => {
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const data=await conn.write('/interface/print'); await conn.close(); res.json(data);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.get('/api/:id/interface/monitor', async (req, res) => {
  const iface = req.query.iface; if(!iface) return res.status(400).json({ error:'iface required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const data=await conn.write('/interface/monitor-traffic', `=interface=${iface}`, '=once='); await conn.close(); res.json(data[0]||{});
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Device controls ----
app.post('/api/:id/system/reboot', requireRole(['owner','admin']), async (req, res) => {
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); await conn.write('/system/reboot'); await conn.close(); res.json({ ok:true });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Generic whitelisted runner ----
app.post('/api/:id/run', requireRole(['owner','admin']), async (req, res)=>{
  const { path:p='', params=[] } = req.body||{};
  const whitelist = [
    // print
    '/system/resource/print','/interface/print','/ip/address/print','/ip/firewall/filter/print','/ip/firewall/nat/print',
    '/ip/dhcp-server/lease/print','/user/print','/queue/simple/print','/interface/bridge/print','/interface/vlan/print',
    '/caps-man/registration-table/print','/ip/hotspot/user/print',
    // changes
    '/ip/address/add','/ip/address/remove',
    '/ip/firewall/filter/add','/ip/firewall/filter/remove','/ip/firewall/nat/add','/ip/firewall/nat/remove',
    '/queue/simple/add','/queue/simple/remove',
    '/user/add','/user/remove',
    '/interface/set','/interface/vlan/add','/interface/vlan/remove',
    '/ip/hotspot/user/add','/ip/hotspot/user/remove'
  ];
  if(!whitelist.includes(p)) return res.status(400).json({ error:'command not allowed' });
  if(!ENABLE_WRITE && /(add|remove|set)/.test(p)) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect();
    const args=[p].concat((params||[]).map(x=> typeof x==='string'?x:String(x)));
    const out=await conn.write.apply(conn,args); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- IP addresses ----
app.get('/api/:id/ip/address', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/address/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/ip/address', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { address, interface:iface } = req.body||{};
  if(!address||!iface) return res.status(400).json({ error:'address & interface required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/address/add', `=address=${address}`, `=interface=${iface}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/ip/address/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/address/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Firewall filter ----
app.get('/api/:id/firewall/filter', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/firewall/filter/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/firewall/filter', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { chain='input', action='accept', src='', dst='', protocol='', comment='' } = req.body||{};
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect();
    const args=['/ip/firewall/filter/add', `=chain=${chain}`, `=action=${action}`];
    if(src) args.push(`=src-address=${src}`);
    if(dst) args.push(`=dst-address=${dst}`);
    if(protocol) args.push(`=protocol=${protocol}`);
    if(comment) args.push(`=comment=${comment}`);
    const out=await conn.write.apply(conn,args); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/firewall/filter/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/firewall/filter/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- NAT ----
app.get('/api/:id/nat', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/firewall/nat/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/nat', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { chain='srcnat', action='masquerade', src='', dst='', out_interface='', comment='' } = req.body||{};
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect();
    const args=['/ip/firewall/nat/add', `=chain=${chain}`, `=action=${action}`];
    if(src) args.push(`=src-address=${src}`);
    if(dst) args.push(`=dst-address=${dst}`);
    if(out_interface) args.push(`=out-interface=${out_interface}`);
    if(comment) args.push(`=comment=${comment}`);
    const out=await conn.write.apply(conn,args); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/nat/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/firewall/nat/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- VLAN/Bridge ----
app.get('/api/:id/bridge', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/interface/bridge/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.get('/api/:id/vlan', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/interface/vlan/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/vlan', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { name, vlan_id, interface:iface } = req.body||{};
  if(!name||!vlan_id||!iface) return res.status(400).json({ error:'name, vlan_id, interface required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/interface/vlan/add', `=name=${name}`, `=vlan-id=${vlan_id}`, `=interface=${iface}`);
    await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/vlan/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/interface/vlan/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Queues (simple) ----
app.get('/api/:id/queue/simple', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/queue/simple/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/queue/simple', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { name, target, max_limit } = req.body||{}; // "10M/10M"
  if(!name||!target||!max_limit) return res.status(400).json({ error:'name, target, max_limit required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/queue/simple/add', `=name=${name}`, `=target=${target}`, `=max-limit=${max_limit}`);
    await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/queue/simple/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/queue/simple/remove', `=.id=${req.params.dotid}`);
    await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- DHCP Leases ----
app.get('/api/:id/dhcp/lease', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/dhcp-server/lease/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Router users ----
app.get('/api/:id/router-users', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/user/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/router-users', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { name, password, group='full' } = req.body||{};
  if(!name||!password) return res.status(400).json({ error:'name & password required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/user/add', `=name=${name}`, `=password=${password}`, `=group=${group}`);
    await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/router-users/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/user/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Hotspot users ----
app.get('/api/:id/hotspot/users', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/hotspot/user/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/hotspot/users', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  const { name, password, profile='' } = req.body||{};
  if(!name||!password) return res.status(400).json({ error:'name & password required' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect();
    const args=['/ip/hotspot/user/add', `=name=${name}`, `=password=${password}`];
    if(profile) args.push(`=profile=${profile}`);
    const out=await conn.write.apply(conn,args); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.delete('/api/:id/hotspot/users/:dotid', requireRole(['owner','admin']), async (req,res)=>{
  if (!ENABLE_WRITE) return res.status(403).json({ error:'writes disabled' });
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/ip/hotspot/user/remove', `=.id=${req.params.dotid}`); await conn.close(); res.json({ ok:true, out });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- CAPsMAN (read-only registrations) ----
app.get('/api/:id/capsman/registrations', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const out=await conn.write('/caps-man/registration-table/print'); await conn.close(); res.json(out);
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});

// ---- Config export + Backups to disk ----
app.get('/api/:id/export', async (req,res)=>{
  try { const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect(); const lines=await conn.write('/export', '=terse='); await conn.close(); res.json({ ok:true, lines });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.post('/api/:id/backup', requireRole(['owner','admin']), async (req,res)=>{
  const when = new Date().toISOString().replace(/[:.]/g,'-');
  try {
    const cfg=findRouter(req.params.id); const conn=makeConn(cfg);
    await conn.connect();
    const exportLines = await conn.write('/export', '=terse=');
    const resource = await conn.write('/system/resource/print');
    const ipaddr = await conn.write('/ip/address/print');
    const filt = await conn.write('/ip/firewall/filter/print');
    const nat = await conn.write('/ip/firewall/nat/print');
    const queues = await conn.write('/queue/simple/print');
    const vlan = await conn.write('/interface/vlan/print');
    const bridge = await conn.write('/interface/bridge/print');
    await conn.close();
    const snap = { when, router: { host: cfg.host, user: cfg.user }, resource: resource[0]||{}, ipaddr, firewall: filt, nat, queues, vlan, bridge };
    const base = `${cfg.host.replace(/[:/\\]/g,'_')}_${when}`;
    const jsonPath = path.join(BACKUPS_DIR, base + '.json');
    const exportPath = path.join(BACKUPS_DIR, base + '.rsc.txt');
    fs.writeFileSync(jsonPath, JSON.stringify(snap, null, 2));
    fs.writeFileSync(exportPath, (exportLines||[]).map(x=> typeof x==='string'?x:JSON.stringify(x)).join('\n'));
    res.json({ ok:true, files: { snapshot: `/backups/${path.basename(jsonPath)}`, export: `/backups/${path.basename(exportPath)}` } });
  } catch(e){ res.status(500).json({ error:e.message||String(e) }); }
});
app.get('/api/backups', (req,res)=>{
  const files = fs.readdirSync(BACKUPS_DIR).filter(f=>f.endsWith('.json')||f.endsWith('.rsc.txt')).sort().reverse();
  res.json(files.map(f=> ({ name:f, url:`/backups/${f}` })));
});

// ---- Serve ----
app.listen(PORT, ()=> console.log(`MikroTik Management Suite running at http://localhost:${PORT}`));
