# MikroTik Management Suite (Complete)
###create a folder named public and place index.html, style.css and ui.js there.
Rest the files remain as it is. Thanks
A complete, self-hosted management console for MikroTik RouterOS.

## Highlights
- 🔐 Auth + RBAC: owner, admin, read; owner can change roles.
- 🗂️ Multi-router registry (add/delete).
- 📊 Monitoring: CPU/mem/uptime; per-interface live traffic.
- 🔌 Interfaces: list, enable/disable.
- 🌐 IP addresses: list/add/delete.
- 🔥 Firewall filter: list/add/delete.
- 🔀 NAT: list/add/delete (srcnat/dstnat, masquerade etc.).
- 🧱 VLAN/Bridge: view bridges; add/delete VLANs.
- 🚦 Queues (simple): list/add/delete.
- 📦 DHCP leases: list.
- 🧑‍💻 Router users: list/add/delete.
- 🌐 Hotspot users: list/add/delete.
- 📡 CAPsMAN: registrations table (read-only).
- 🧰 Script runner (whitelist).
- 🧾 Config export (`/export terse`).
- 💾 Backups: snapshot JSON + export text files saved to `backups/` and downloadable.
- 🔁 Reboot button.
- 🛡️ Safety switch: `ENABLE_WRITE=false` makes the suite read-only.

## Quick Start
```bash
npm install
cp .env.example .env        # set a strong JWT_SECRET; optionally change PORT or ENABLE_WRITE
node server.js
# open http://localhost:8080
```
First-time setup: If `users.json` is empty, use the **Register** form to create an `owner`. Then **Login**.

## Add a router
- Click **Add** and enter IP/host, username, password, API port (default 8728).
- Ensure RouterOS API service is enabled on the router.

## Notes
- Credentials are stored in `routers.json` for simplicity. Host securely or adapt to DB/secret manager.
- RouterOS fields can vary across versions; traffic monitor handles common variants and counter deltas.

## Extend
- Add modules (NTP, OSPF/BGP, Netwatch, Schedules, Certificates).
- Swap JSON files with SQLite/Postgres and add audit logs.
