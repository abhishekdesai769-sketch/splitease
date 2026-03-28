import type { Express, Request, Response } from "express";
import { type Server } from "http";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { Pool } from "pg";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "@shared/schema";
import { notifyExpenseCreated, sendOtpEmail, sendResetPasswordEmail, sendExportEmail, sendSupportEmail, sendInviteToInviteeEmail, sendInviteToAdminEmail } from "./email";
import { parseReceipt, RECEIPT_SCANNING_ENABLED } from "./receipt-parser";
import {
  upload, hashPassword, verifyPassword, needsHashUpgrade,
  rateLimit, sanitize,
  requireAuth, requireAdmin,
  AVATAR_COLORS, ADMIN_EMAIL,
} from "./middleware";


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Trust proxy (Render runs behind a reverse proxy)
  app.set("trust proxy", 1);

  // Global API rate limiter: 200 requests per minute per IP (prevents abuse on all endpoints)
  const globalApiLimiter = rateLimit(60 * 1000, 200);
  app.use("/api", globalApiLimiter);

  // Digital Asset Links for Google Play TWA verification
  app.get("/.well-known/assetlinks.json", (_req, res) => {
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "ca.klarityit.spliiit",
          sha256_cert_fingerprints: [
            "67:63:BD:34:40:80:D5:A3:EB:7C:A4:0B:AB:D5:25:32:DE:60:5F:F6:0E:AC:1F:B2:12:D9:F0:0F:83:07:B6:90"
          ]
        }
      }
    ]);
  });

  // Privacy Policy page (public, no auth required)
  app.get("/privacy", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy â Spliiit</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0f0d; color: #d1d5db; line-height: 1.7; padding: 2rem 1.25rem; }
    .container { max-width: 680px; margin: 0 auto; }
    h1 { color: #f9fafb; font-size: 1.75rem; margin-bottom: 0.25rem; }
    .tagline { color: #4fd1c5; font-size: 0.875rem; margin-bottom: 0.5rem; }
    .updated { color: #6b7280; font-size: 0.8rem; margin-bottom: 2rem; }
    h2 { color: #f9fafb; font-size: 1.1rem; margin-top: 2rem; margin-bottom: 0.5rem; }
    p, li { font-size: 0.925rem; margin-bottom: 0.75rem; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.4rem; }
    a { color: #4fd1c5; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1f2937; color: #6b7280; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="tagline">Spliiit â Expense splitting made easy</p>
    <p class="updated">Last updated: March 20, 2026</p>

    <h2>Introduction</h2>
    <p>Spliiit is operated by Klarity IT Corp. This privacy policy explains how we collect, use, and protect your information when you use our app.</p>

    <h2>Information We Collect</h2>
    <ul>
      <li><strong>Account information:</strong> Your name, email address, and password (stored securely as a hash) when you create an account.</li>
      <li><strong>Expense data:</strong> Descriptions, amounts, dates, and group/friend associations for expenses you create or are part of.</li>
      <li><strong>Usage data:</strong> Basic server logs including IP addresses and timestamps for security and troubleshooting purposes.</li>
    </ul>

    <h2>How We Use Your Information</h2>
    <ul>
      <li>To provide and maintain the expense splitting service</li>
      <li>To send you transaction notifications and account verification emails</li>
      <li>To authenticate your identity and secure your account</li>
      <li>To enable expense sharing with friends and groups</li>
    </ul>

    <h2>Information Sharing</h2>
    <p>We do not sell, trade, or share your personal information with third parties, except:</p>
    <ul>
      <li>With other Spliiit users you choose to split expenses with (they see your name and email)</li>
      <li>With our email service provider (Resend) to deliver transactional emails</li>
      <li>If required by law or to protect our legal rights</li>
    </ul>

    <h2>Data Storage &amp; Security</h2>
    <p>Your data is stored on secure servers. Passwords are hashed and never stored in plain text. We use HTTPS encryption for all data in transit.</p>

    <h2>Data Retention</h2>
    <p>Your expense data is retained for as long as your account is active. You can delete your account and all associated data directly from the app by opening the menu and selecting Delete Account.</p>

    <h2>Children's Privacy</h2>
    <p>Spliiit is not intended for children under 13. We do not knowingly collect information from children under 13.</p>

    <h2>Changes to This Policy</h2>
    <p>We may update this policy from time to time. Changes will be posted on this page with an updated date.</p>

    <h2>Contact Us</h2>
    <p>If you have questions about this privacy policy, contact us at <a href="mailto:inquiries@klarityit.ca">inquiries@klarityit.ca</a>.</p>

    <div class="footer">
      <p>&copy; 2026 Klarity IT Corp. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`);
  });

  // Session setup — PostgreSQL-backed so sessions survive deploys
  const PgStore = pgSession(session);
  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sessionSecret = process.env.SESSION_SECRET || "spliiit-secret-" + randomBytes(16).toString("hex");

  // Create session table if it doesn't exist (inline SQL — avoids missing table.sql file in prod build)
  await sessionPool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new PgStore({
        pool: sessionPool,
        tableName: "session",
        createTableIfMissing: false, // we create it above
        pruneSessionInterval: 60 * 15, // prune expired sessions every 15 min
      }),
      cookie: {
        secure: process.env.NODE_ENV === "production", // HTTPS-only in prod (Render terminates TLS at proxy)
        httpOnly: true, // prevents JS access to cookie
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: "lax", // CSRF protection
      },
    })
  );

  // ========== Admin Dashboard (standalone desktop page) ==========
  app.get("/admin-dashboard", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.redirect("/#/");
    const user = await storage.getUser(userId);
    if (!user || !user.isAdmin) return res.status(403).send("Access denied");

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Spliiit Admin Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0f0d;color:#d1d5db;line-height:1.5}
.container{max-width:1100px;margin:0 auto;padding:1.5rem}
h1{color:#f9fafb;font-size:1.5rem;margin-bottom:.25rem}
h2{color:#f9fafb;font-size:1.1rem;margin:2rem 0 .75rem}
.subtitle{color:#6b7280;font-size:.8rem}
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem}
.topbar-left{display:flex;align-items:center;gap:.75rem}
.logo{display:flex;align-items:center;gap:.5rem;font-size:1.1rem;font-weight:600;color:#f9fafb}
.logo span{color:#4fd1c5}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:.65rem;font-weight:600}
.badge-admin{background:rgba(79,209,197,.15);color:#4fd1c5}
.badge-ghost{background:rgba(234,179,8,.15);color:#eab308}
.search{background:#1a1f1c;border:1px solid #2d3330;border-radius:8px;padding:.5rem .75rem;color:#d1d5db;width:300px;font-size:.85rem;outline:none}
.search:focus{border-color:#4fd1c5}
.search::placeholder{color:#555}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;padding:.5rem .75rem;color:#9ca3af;font-weight:500;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1f2937}
td{padding:.6rem .75rem;border-bottom:1px solid #141a16}
tr:hover{background:#111816}
.avatar{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem;font-weight:600;flex-shrink:0}
.user-cell{display:flex;align-items:center;gap:.6rem}
.user-name{color:#f9fafb;font-weight:500}
.user-email{color:#6b7280;font-size:.75rem}
.actions{display:flex;gap:.25rem}
.btn{padding:.35rem .7rem;border-radius:6px;border:1px solid #2d3330;background:#1a1f1c;color:#d1d5db;cursor:pointer;font-size:.75rem;display:inline-flex;align-items:center;gap:4px;transition:all .15s}
.btn:hover{background:#242a27;border-color:#3d4340}
.btn-danger:hover{background:#7f1d1d;border-color:#991b1b;color:#fca5a5}
.btn-restore{border-color:rgba(79,209,197,.3);color:#4fd1c5}
.btn-restore:hover{background:rgba(79,209,197,.1)}
.section{background:#111816;border:1px solid #1f2937;border-radius:12px;padding:1.25rem;margin-bottom:1.5rem}
.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.count{color:#6b7280;font-size:.8rem}
.days-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;font-size:.65rem;font-weight:600}
.days-ok{background:rgba(107,114,128,.15);color:#9ca3af}
.days-warn{background:rgba(245,158,11,.15);color:#f59e0b}
.days-crit{background:rgba(239,68,68,.15);color:#ef4444}
.empty{text-align:center;padding:2rem;color:#6b7280;font-size:.85rem}
.toast{position:fixed;top:1rem;right:1rem;padding:.75rem 1.25rem;border-radius:8px;font-size:.85rem;z-index:9999;animation:fadeIn .2s}
.toast-ok{background:#065f46;color:#6ee7b7;border:1px solid #047857}
.toast-err{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.tabs{display:flex;gap:2px;background:#1a1f1c;border-radius:8px;padding:3px;margin-bottom:1.5rem;width:fit-content}
.tab{padding:.4rem 1rem;border-radius:6px;border:none;background:transparent;color:#9ca3af;cursor:pointer;font-size:.8rem;font-weight:500;transition:all .15s}
.tab.active{background:rgba(79,209,197,.15);color:#4fd1c5}
.tab:hover:not(.active){color:#d1d5db}
.stat-row{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
.stat{background:#111816;border:1px solid #1f2937;border-radius:10px;padding:1rem 1.25rem;flex:1;min-width:140px}
.stat-val{font-size:1.5rem;font-weight:700;color:#f9fafb}
.stat-label{font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
a.back{color:#4fd1c5;text-decoration:none;font-size:.8rem}
a.back:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div class="topbar-left">
      <div class="logo">Spl<span>iii</span>t <span style="font-weight:400;font-size:.8rem;color:#6b7280;margin-left:4px">Admin</span></div>
      <a href="/" class="back">&larr; Back to app</a>
    </div>
    <input class="search" id="search" placeholder="Search users, groups, expenses..." />
  </div>

  <div class="stat-row" id="stats"></div>

  <div class="tabs">
    <button class="tab active" data-tab="users" onclick="switchTab('users')">Users</button>
    <button class="tab" data-tab="recycle" onclick="switchTab('recycle')">Recycle Bin</button>
  </div>

  <div id="users-section">
    <div class="section">
      <table><thead><tr><th>User</th><th>Email</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody id="user-table"></tbody></table>
    </div>
  </div>

  <div id="recycle-section" style="display:none">
    <div class="section">
      <div class="section-title"><h2 style="margin:0">Deleted Groups</h2><span class="count" id="group-count"></span></div>
      <table><thead><tr><th>Group</th><th>Created By</th><th>Members</th><th>Deleted</th><th style="text-align:right">Action</th></tr></thead><tbody id="group-table"></tbody></table>
      <div class="empty" id="no-groups" style="display:none">No deleted groups</div>
    </div>
    <div class="section">
      <div class="section-title"><h2 style="margin:0">Deleted Expenses</h2><span class="count" id="expense-count"></span></div>
      <table><thead><tr><th>Description</th><th>Amount</th><th>Paid By</th><th>Deleted</th><th style="text-align:right">Action</th></tr></thead><tbody id="expense-table"></tbody></table>
      <div class="empty" id="no-expenses" style="display:none">No deleted expenses</div>
    </div>
  </div>
</div>

<script>
var ME = "${user.id}";
var allUsers=[], deletedData={groups:[],expenses:[]}, searchQ="";

function toast(msg,ok){
  if(ok===undefined)ok=true;
  var d=document.createElement("div");
  d.className="toast "+(ok?"toast-ok":"toast-err");
  d.textContent=msg;
  document.body.appendChild(d);
  setTimeout(function(){d.remove();},3000);
}

function api(method,url,body){
  var opts={method:method,credentials:"include",headers:{}};
  if(body){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
  return fetch(url,opts).then(function(r){
    if(!r.ok)return r.text().then(function(t){throw new Error(t);});
    if(r.status===204)return null;
    return r.json();
  });
}

function daysLeft(deletedAt){
  if(!deletedAt)return 30;
  var exp=new Date(new Date(deletedAt).getTime()+30*86400000);
  return Math.max(0,Math.ceil((exp-Date.now())/86400000));
}

function daysBadge(deletedAt){
  var d=daysLeft(deletedAt);
  var cls=d<=3?"days-crit":d<=7?"days-warn":"days-ok";
  return '<span class="days-badge '+cls+'">'+d+'d left</span>';
}

function fmtDate(s){if(!s)return"";return new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});}

function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

function switchTab(t){
  document.querySelectorAll(".tab").forEach(function(b){b.classList.toggle("active",b.dataset.tab===t);});
  document.getElementById("users-section").style.display=t==="users"?"":"none";
  document.getElementById("recycle-section").style.display=t==="recycle"?"":"none";
}

function renderStats(){
  var gh=allUsers.filter(function(u){return u.isGhost;}).length;
  var dg=(deletedData.groups?deletedData.groups.length:0);
  var de=(deletedData.expenses?deletedData.expenses.length:0);
  document.getElementById("stats").innerHTML=
    '<div class="stat"><div class="stat-val">'+allUsers.length+'</div><div class="stat-label">Total Users</div></div>'+
    '<div class="stat"><div class="stat-val">'+(allUsers.length-gh)+'</div><div class="stat-label">Active</div></div>'+
    '<div class="stat"><div class="stat-val">'+gh+'</div><div class="stat-label">Ghost</div></div>'+
    '<div class="stat"><div class="stat-val">'+dg+'</div><div class="stat-label">Deleted Groups</div></div>'+
    '<div class="stat"><div class="stat-val">'+de+'</div><div class="stat-label">Deleted Expenses</div></div>';
}

function renderUsers(){
  var q=searchQ.toLowerCase();
  var rows=allUsers.filter(function(u){return !q||u.name.toLowerCase().indexOf(q)>=0||u.email.toLowerCase().indexOf(q)>=0;});
  var tb=document.getElementById("user-table");
  if(!rows.length){tb.innerHTML='<tr><td colspan="4" class="empty">No users found</td></tr>';return;}
  tb.innerHTML=rows.map(function(u){
    var badges=(u.isAdmin?'<span class="badge badge-admin">Admin</span> ':'')+(u.isGhost?'<span class="badge badge-ghost">Ghost</span>':'');
    var acts;
    if(u.id===ME){
      acts='<span style="color:#555;font-size:.75rem">You</span>';
    }else{
      acts='<div class="actions">'+
        '<button class="btn" data-uid="'+esc(u.id)+'" data-uname="'+esc(u.name)+'" data-uemail="'+esc(u.email)+'" onclick="resetPwBtn(this)">&#128273; Reset PW</button>'+
        (!u.isAdmin?'<button class="btn btn-danger" data-uid="'+esc(u.id)+'" data-uname="'+esc(u.name)+'" onclick="delUserBtn(this)">&times; Delete</button>':'')+
        '</div>';
    }
    return '<tr><td><div class="user-cell"><div class="avatar" style="background:'+u.avatarColor+'">'+esc(u.name[0]).toUpperCase()+'</div><div><div class="user-name">'+esc(u.name)+'</div></div></div></td><td class="user-email">'+esc(u.email)+'</td><td>'+badges+'</td><td style="text-align:right">'+acts+'</td></tr>';
  }).join("");
}

function renderRecycle(){
  var q=searchQ.toLowerCase();
  var gs=(deletedData.groups||[]).filter(function(g){return !q||g.name.toLowerCase().indexOf(q)>=0||(g.createdByName||"").toLowerCase().indexOf(q)>=0;});
  var es=(deletedData.expenses||[]).filter(function(e){return !q||e.description.toLowerCase().indexOf(q)>=0||(e.paidByName||"").toLowerCase().indexOf(q)>=0||String(e.amount).indexOf(q)>=0;});

  document.getElementById("group-count").textContent=gs.length+" group"+(gs.length!==1?"s":"");
  document.getElementById("expense-count").textContent=es.length+" expense"+(es.length!==1?"s":"");

  var gt=document.getElementById("group-table");
  document.getElementById("no-groups").style.display=gs.length?"none":"";
  gt.innerHTML=gs.map(function(g){
    return '<tr><td><strong>'+esc(g.name)+'</strong> '+daysBadge(g.deletedAt)+'</td><td>'+esc(g.createdByName)+'</td><td>'+g.memberNames.length+'</td><td>'+fmtDate(g.deletedAt)+'</td><td style="text-align:right"><button class="btn btn-restore" data-gid="'+esc(g.id)+'" onclick="restoreGroupBtn(this)">Restore</button></td></tr>';
  }).join("");

  var et=document.getElementById("expense-table");
  document.getElementById("no-expenses").style.display=es.length?"none":"";
  et.innerHTML=es.map(function(e){
    return '<tr><td><strong>'+esc(e.description)+'</strong> '+daysBadge(e.deletedAt)+'</td><td>$'+Number(e.amount).toFixed(2)+'</td><td>'+esc(e.paidByName)+'</td><td>'+fmtDate(e.deletedAt)+'</td><td style="text-align:right"><button class="btn btn-restore" data-eid="'+esc(e.id)+'" onclick="restoreExpenseBtn(this)">Restore</button></td></tr>';
  }).join("");
}

function loadAll(){
  Promise.all([api("GET","/api/admin/users"),api("GET","/api/admin/deleted")]).then(function(res){
    allUsers=res[0]; deletedData=res[1];
    renderStats(); renderUsers(); renderRecycle();
  }).catch(function(e){toast("Failed to load: "+e.message,false);});
}

function resetPwBtn(el){
  var id=el.getAttribute("data-uid");
  var label=el.getAttribute("data-uname")+" ("+el.getAttribute("data-uemail")+")";
  var pw=prompt("Set new password for "+label+" (min 6 characters):");
  if(!pw)return;
  if(pw.length<6){toast("Password must be at least 6 characters",false);return;}
  api("POST","/api/admin/users/"+id+"/reset-password",{newPassword:pw}).then(function(){toast("Password reset!");}).catch(function(e){toast("Failed: "+e.message,false);});
}

function delUserBtn(el){
  var id=el.getAttribute("data-uid");
  var name=el.getAttribute("data-uname");
  if(!confirm("Delete "+name+"? This removes them and their friend links."))return;
  api("DELETE","/api/admin/users/"+id).then(function(){toast("User deleted");loadAll();}).catch(function(e){toast("Failed: "+e.message,false);});
}

function restoreGroupBtn(el){
  var id=el.getAttribute("data-gid");
  api("POST","/api/admin/restore/group/"+id).then(function(){toast("Group restored");loadAll();}).catch(function(e){toast("Failed: "+e.message,false);});
}

function restoreExpenseBtn(el){
  var id=el.getAttribute("data-eid");
  api("POST","/api/admin/restore/expense/"+id).then(function(){toast("Expense restored");loadAll();}).catch(function(e){toast("Failed: "+e.message,false);});
}

document.getElementById("search").addEventListener("input",function(e){searchQ=e.target.value;renderUsers();renderRecycle();});

loadAll();
setInterval(loadAll,30000);
</script>
</body>
</html>`);
  });

  // ========== Auth (rate limited) ==========
  const authLimiter = rateLimit(15 * 60 * 1000, 20); // 20 attempts per 15 min

  // Step 1: Send OTP to verify email before creating account
  app.post("/api/auth/send-otp", authLimiter, async (req, res) => {
    const { email, name } = req.body;
    if (!email || !name) return res.status(400).json({ error: "Email and name are required" });

    const cleanEmail = email.toLowerCase().trim();
    const existing = await storage.getUserByEmail(cleanEmail);
    if (existing && !existing.isGhost) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    await storage.createOtp({ email: cleanEmail, code, expiresAt });
    sendOtpEmail(cleanEmail, sanitize(name, 100), code);

    res.json({ message: "OTP sent" });
  });

  // Step 2: Verify OTP and create the account
  app.post("/api/auth/signup", authLimiter, async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { name, email, password } = parsed.data;
    const otpCode = req.body.otpCode;
    const cleanName = sanitize(name, 100);
    const cleanEmail = email.toLowerCase().trim();

    // Verify OTP
    if (!otpCode) {
      return res.status(400).json({ error: "Verification code is required" });
    }
    const validOtp = await storage.verifyOtp(cleanEmail, otpCode);
    if (!validOtp) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    const existing = await storage.getUserByEmail(cleanEmail);

    // If a ghost account exists for this email, upgrade it to a real account
    // (ghost accounts are placeholders created during Splitwise CSV import)
    if (existing && existing.isGhost) {
      const isAdmin = cleanEmail === ADMIN_EMAIL;
      await storage.upgradeGhostUser(existing.id, {
        name: cleanName,
        password: hashPassword(password),
        isAdmin,
        isEmailVerified: true,
      });
      const upgraded = await storage.getUser(existing.id);
      if (!upgraded) return res.status(500).json({ error: "Failed to upgrade account" });

      (req.session as any).userId = upgraded.id;
      const { password: _, ...safeUser } = upgraded;
      return res.status(201).json(safeUser);
    }

    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Check if this is the admin email
    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const isApproved = true; // All users auto-approved on signup

    const user = await storage.createUser({
      name: cleanName,
      email: cleanEmail,
      password: hashPassword(password),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      isAdmin,
      isApproved,
      isEmailVerified: true,
    });

    (req.session as any).userId = user.id;

    // Auto-merge any ghost users that were invited with this email
    try {
      const ghosts = await storage.getGhostsByEmail(cleanEmail);
      for (const ghost of ghosts) {
        await storage.mergeGhostUser(ghost.id, user.id);
      }
    } catch (e) { /* don't block signup if merge fails */ }

    const { password: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const { email, password } = parsed.data;
      const cleanEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(cleanEmail);

      if (!user) {
        console.log(`[login] no user found for ${cleanEmail}`);
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (!verifyPassword(password, user.password)) {
        console.log(`[login] password mismatch for ${cleanEmail} (hash starts: ${user.password.substring(0, 10)}...)`);
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Ghost users need to sign up first to claim their account
      if (user.isGhost) {
        return res.status(403).json({ error: "ghost_account" });
      }

      // Transparently upgrade legacy SHA-256 hash to scrypt on successful login
      if (needsHashUpgrade(user.password)) {
        const upgraded = hashPassword(password);
        await storage.updateUserPassword(user.id, upgraded);
      }

      (req.session as any).userId = user.id;

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err) {
      console.error(`[login] unexpected error:`, err);
      res.status(500).json({ error: "Login failed — please try again or reset your password" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // ========== Forgot / Reset Password ==========
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const cleanEmail = parsed.data.email.toLowerCase().trim();
    const user = await storage.getUserByEmail(cleanEmail);

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If an account exists with that email, a reset link has been sent." });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await storage.createResetToken({ userId: user.id, token, expiresAt });

    // Build reset link â uses hash routing
    const baseUrl = process.env.APP_URL || "https://splitease-81re.onrender.com";
    const resetLink = `${baseUrl}/#/reset-password?token=${token}`;

    sendResetPasswordEmail(cleanEmail, user.name, resetLink);

    res.json({ message: "If an account exists with that email, a reset link has been sent." });
  });

  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { token, password } = parsed.data;
    const resetToken = await storage.verifyResetToken(token);

    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
    }

    await storage.updateUserPassword(resetToken.userId, hashPassword(password));

    res.json({ message: "Password has been reset successfully. You can now sign in." });
  });

  // ========== Users (search) â requires approved ==========
  app.get("/api/users/search", requireAuth, async (req, res) => {
    const email = sanitize((req.query.email as string) || "", 255);
    const userId = (req.session as any).userId;
    if (email.length < 2) return res.json([]);
    const results = await storage.searchUsersByEmail(email, userId);
    res.json(results);
  });

  // ========== Admin routes ==========
  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers);
  });

  app.patch("/api/admin/users/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    const updated = await storage.updateUser(req.params.id, { isApproved: true });
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.patch("/api/admin/users/:id/revoke", requireAuth, requireAdmin, async (req, res) => {
    // Cannot revoke own admin
    const userId = (req.session as any).userId;
    if (req.params.id === userId) {
      return res.status(400).json({ error: "Cannot revoke your own access" });
    }
    const updated = await storage.updateUser(req.params.id, { isApproved: false });
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  });

  // Admin: force-reset a user's password (for locked-out users)
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await storage.updateUserPassword(user.id, hashPassword(newPassword));
    res.json({ message: `Password reset for ${user.email}` });
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const userId = (req.session as any).userId;
    if (req.params.id === userId) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }
    const deleted = await storage.deleteUser(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
  });

  // Get soft-deleted groups and expenses (enriched with user names)
  app.get("/api/admin/deleted", requireAuth, requireAdmin, async (_req, res) => {
    // Auto-purge items older than 30 days on every fetch
    await storage.purgeExpiredDeleted(30);

    const deletedGroups = await storage.getDeletedGroups();
    const deletedExpenses = await storage.getDeletedExpenses();

    // Collect all user IDs we need to look up
    const userIds = new Set<string>();
    deletedGroups.forEach(g => {
      userIds.add(g.createdById);
      g.memberIds.forEach((m: string) => userIds.add(m));
    });
    deletedExpenses.forEach(e => {
      userIds.add(e.paidById);
      userIds.add(e.addedById);
    });

    const userList = await storage.getUsersSafe(Array.from(userIds));
    const userMap: Record<string, { name: string; email: string }> = {};
    userList.forEach(u => { userMap[u.id] = { name: u.name, email: u.email }; });

    // Enrich groups
    const enrichedGroups = deletedGroups.map(g => ({
      ...g,
      createdByName: userMap[g.createdById]?.name || "Unknown",
      createdByEmail: userMap[g.createdById]?.email || "",
      memberNames: g.memberIds.map((m: string) => userMap[m]?.name || "Unknown"),
    }));

    // Enrich expenses
    const enrichedExpenses = deletedExpenses.map(e => ({
      ...e,
      paidByName: userMap[e.paidById]?.name || "Unknown",
      paidByEmail: userMap[e.paidById]?.email || "",
      addedByName: userMap[e.addedById]?.name || "Unknown",
    }));

    res.json({ groups: enrichedGroups, expenses: enrichedExpenses });
  });

  // Manual purge endpoint
  app.post("/api/admin/purge-deleted", requireAuth, requireAdmin, async (_req, res) => {
    const result = await storage.purgeExpiredDeleted(30);
    res.json({ purged: result });
  });

  // Restore a soft-deleted group (and its expenses)
  app.post("/api/admin/restore/group/:id", requireAuth, requireAdmin, async (req, res) => {
    const restored = await storage.restoreGroup(req.params.id);
    if (!restored) return res.status(404).json({ error: "Group not found" });
    res.json(restored);
  });

  // Restore a soft-deleted expense
  app.post("/api/admin/restore/expense/:id", requireAuth, requireAdmin, async (req, res) => {
    const restored = await storage.restoreExpense(req.params.id);
    if (!restored) return res.status(404).json({ error: "Expense not found" });
    res.json(restored);
  });

  // ========== Friends â requires approved ==========
  app.get("/api/friends", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const friendsList = await storage.getFriends(userId);
    res.json(friendsList);
  });

  app.post("/api/friends", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const email = sanitize((req.body.email || "").toLowerCase(), 255);

    if (!email) return res.status(400).json({ error: "Email is required" });

    const targetUser = await storage.getUserByEmail(email);
    if (!targetUser) {
      return res.status(404).json({ error: "No user found with that email. They need to sign up first." });
    }

    if (targetUser.id === userId) {
      return res.status(400).json({ error: "You can't add yourself as a friend" });
    }

    const already = await storage.areFriends(userId, targetUser.id);
    if (already) {
      return res.status(409).json({ error: "Already friends" });
    }

    await storage.addFriend(userId, targetUser.id);
    const { password: _, ...safeFriend } = targetUser;
    res.status(201).json(safeFriend);
  });

  app.delete("/api/friends/:friendId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    await storage.removeFriend(userId, req.params.friendId);
    res.status(204).send();
  });

  // Direct expenses between friends (no group)
  app.get("/api/friends/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const directExpenses = await storage.getDirectExpensesForUser(userId);
    res.json(directExpenses);
  });

  app.post("/api/friends/expenses", requireAuth, upload.single("receipt"), async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, date, isSettlement } = req.body;
    // splitAmongIds comes as JSON string from FormData
    let splitAmongIds = req.body.splitAmongIds;
    if (typeof splitAmongIds === "string") {
      try { splitAmongIds = JSON.parse(splitAmongIds); } catch { /* keep as-is */ }
    }

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const expense = await storage.createExpense({
      description: sanitize(description, 200),
      amount: parsedAmount,
      paidById,
      splitAmongIds,
      groupId: null,
      date,
      addedById: userId,
      isSettlement: !!isSettlement,
    });
    res.status(201).json(expense);

    // Receipt from upload (held in memory only â not saved)
    const receiptFile = req.file;

    // Send email notifications (fire-and-forget)
    try {
      const payer = await storage.getUser(paidById);
      const splitUsers = await storage.getUsersSafe(splitAmongIds);
      const perPerson = parsedAmount / splitAmongIds.length;
      if (payer) {
        notifyExpenseCreated({
          description: sanitize(description, 200),
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: splitUsers.map((u) => ({ name: u.name, email: u.email, share: perPerson })),
          isSettlement: !!isSettlement,
          receiptBuffer: receiptFile?.buffer,
          receiptFilename: receiptFile?.originalname,
        });
      }
    } catch (e) { /* ignore email errors */ }

    // Receipt data: client-side (free tier Tesseract) or server-side (premium Haiku)
    const clientReceiptData = req.body.receiptData;
    if (clientReceiptData) {
      // Free tier: client already parsed and confirmed — save directly
      try {
        const parsed = typeof clientReceiptData === "string" ? JSON.parse(clientReceiptData) : clientReceiptData;
        if (parsed.items && Array.isArray(parsed.items)) {
          storage.updateExpenseReceiptData(expense.id, JSON.stringify(parsed));
        }
      } catch { /* ignore invalid JSON */ }
    } else if (RECEIPT_SCANNING_ENABLED && receiptFile?.buffer) {
      // Premium tier: AI receipt scanning (fire-and-forget)
      parseReceipt(receiptFile.buffer, receiptFile.mimetype || "image/jpeg")
        .then((data) => {
          if (data) {
            storage.updateExpenseReceiptData(expense.id, JSON.stringify(data));
          }
        })
        .catch(() => { /* ignore parse errors */ });
    }
  });

  // ========== Settle Up ==========
  app.post("/api/settle-up", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { friendId, amount, groupId } = req.body;

    if (!friendId || !amount) {
      return res.status(400).json({ error: "Friend and amount are required" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Determine who pays whom based on positive/negative amount
    // If amount > 0, current user pays friend (current user owed friend)
    // We create a payment record: paidById = userId (the one paying), splitAmongIds = [friendId]
    const expense = await storage.createExpense({
      description: `Settlement payment`,
      amount: parsedAmount,
      paidById: userId, // person who is paying/settling
      splitAmongIds: [friendId], // person receiving the payment
      groupId: groupId || null,
      date: new Date().toISOString(),
      addedById: userId,
      isSettlement: true,
    });
    res.status(201).json(expense);

    // Send email notification for settlement (fire-and-forget)
    try {
      const payer = await storage.getUser(userId);
      const receiver = await storage.getUser(friendId);
      if (payer && receiver) {
        notifyExpenseCreated({
          description: "Settlement payment",
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: [{ name: receiver.name, email: receiver.email, share: parsedAmount }],
          isSettlement: true,
        });
      }
    } catch (e) { /* ignore email errors */ }
  });

  // ========== Groups â requires approved ==========
  app.get("/api/groups", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const groupsList = await storage.getGroupsForUser(userId);
    res.json(groupsList);
  });

  app.get("/api/groups/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    res.json(group);
  });

  app.post("/api/groups", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { name, memberIds } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }

    const allMembers = Array.from(new Set([userId, ...(memberIds || [])]));

    const group = await storage.createGroup({
      name: sanitize(name, 100),
      createdById: userId,
      memberIds: allMembers,
      adminIds: [],
    });
    res.status(201).json(group);
  });

  // ========== Group roles: promote/demote/leave ==========

  // Helper: compute a member's balance in a group
  function getGroupMemberBalance(groupExpenses: any[], memberId: string): number {
    let balance = 0;
    for (const e of groupExpenses) {
      const splitCount = e.splitAmongIds.length;
      if (splitCount === 0) continue;
      const perPerson = e.amount / splitCount;
      if (e.paidById === memberId) balance += e.amount;
      if (e.splitAmongIds.includes(memberId)) balance -= perPerson;
    }
    return Math.round(balance * 100) / 100;
  }

  // POST /api/groups/:id/promote/:memberId â owner or global admin only
  app.post("/api/groups/:id/promote/:memberId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isOwner = group.createdById === userId;
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner can promote members" });
    }

    const memberId = req.params.memberId;
    if (!group.memberIds.includes(memberId)) {
      return res.status(400).json({ error: "User is not a member of this group" });
    }
    if (memberId === group.createdById) {
      return res.status(400).json({ error: "The owner is already the highest role" });
    }
    const adminIds = group.adminIds || [];
    if (adminIds.includes(memberId)) {
      return res.status(400).json({ error: "Member is already an admin" });
    }

    const updated = await storage.updateGroupAdmins(group.id, [...adminIds, memberId]);
    res.json(updated);
  });

  // POST /api/groups/:id/demote/:memberId â owner or global admin only
  app.post("/api/groups/:id/demote/:memberId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isOwner = group.createdById === userId;
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner can demote admins" });
    }

    const memberId = req.params.memberId;
    if (memberId === group.createdById) {
      return res.status(400).json({ error: "Cannot demote the group owner" });
    }

    const adminIds = group.adminIds || [];
    if (!adminIds.includes(memberId)) {
      return res.status(400).json({ error: "Member is not an admin" });
    }

    const updated = await storage.updateGroupAdmins(group.id, adminIds.filter(id => id !== memberId));
    res.json(updated);
  });

  // POST /api/groups/:id/leave â any member can leave
  // Delete all expenses in a group (admin/owner only)
  app.delete("/api/groups/:id/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const user = await storage.getUser(userId);
    const isOwner = group.createdById === userId;
    const isGroupAdmin = (group.adminIds || []).includes(userId);
    const isGlobalAdmin = user?.isAdmin;
    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only admins can delete all expenses" });
    }

    const expenses = await storage.getExpensesByGroup(group.id);
    for (const exp of expenses) {
      await storage.deleteExpense(exp.id);
    }
    res.json({ deleted: expenses.length });
  });

  app.post("/api/groups/:id/leave", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!group.memberIds.includes(userId)) {
      return res.status(400).json({ error: "You are not a member of this group" });
    }

    // Balance check â server-side
    const groupExpenses = await storage.getExpensesByGroup(group.id);
    const balance = getGroupMemberBalance(groupExpenses, userId);
    if (balance !== 0) {
      return res.status(400).json({
        error: `You have unsettled balances in this group ($${Math.abs(balance).toFixed(2)} ${balance > 0 ? "owed to you" : "you owe"}). Please settle up before leaving.`,
        balance,
      });
    }

    // Admin/owner check â if leaving person is the only admin/owner, block
    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isAdmin = adminIds.includes(userId);

    if (isOwner || isAdmin) {
      // Check if there's anyone else with elevated role
      const otherAdmins = adminIds.filter(id => id !== userId);
      // If they're owner, check if there are any other admins remaining
      if (isOwner && otherAdmins.length === 0) {
        return res.status(400).json({
          error: "You must assign another admin before leaving as the group owner.",
        });
      }
      // If they're an admin (but not owner), and there are no other admins AND no owner â but owner always exists
      // So if they're admin (not owner), they can always leave (owner remains)
    }

    // Remove from memberIds and adminIds
    const newMemberIds = group.memberIds.filter(id => id !== userId);
    const newAdminIds = adminIds.filter(id => id !== userId);
    await storage.updateGroupMembersAndAdmins(group.id, newMemberIds, newAdminIds);

    res.json({ ok: true });
  });

  // POST /api/groups/:id/invite â Create invite (replaces direct add)
  app.post("/api/groups/:id/invite", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const inviter = await storage.getUser(userId);
    if (!inviter) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }

    const email = sanitize((req.body.email || "").toLowerCase(), 255);
    if (!email) return res.status(400).json({ error: "Email is required" });

    const targetUser = await storage.getUserByEmail(email);
    if (!targetUser) {
      return res.status(404).json({ error: "No user found with that email. They need to sign up first." });
    }

    if (group.memberIds.includes(targetUser.id)) {
      return res.status(409).json({ error: "User is already a member" });
    }

    // Check for existing pending invite
    const existing = await storage.getPendingInvitesForGroup(group.id);
    const dup = existing.find(i => i.inviteeId === targetUser.id);
    if (dup) {
      return res.status(409).json({ error: "There is already a pending invite for this user" });
    }

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = inviter.isAdmin;
    const autoApprove = isOwner || isGroupAdmin || isGlobalAdmin;

    const invite = await storage.createGroupInvite({
      groupId: group.id,
      inviterId: userId,
      inviteeId: targetUser.id,
      adminApproved: autoApprove,
      adminApprovedBy: autoApprove ? userId : null,
      inviteeAccepted: null,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({
      ...invite,
      inviterName: inviter.name,
      inviteeName: targetUser.name,
      inviteeEmail: targetUser.email,
      groupName: group.name,
    });

    // Fire-and-forget email notifications
    // 1. Always notify the invitee
    sendInviteToInviteeEmail({
      inviteeName: targetUser.name,
      inviteeEmail: targetUser.email,
      inviterName: inviter.name,
      groupName: group.name,
    });

    // 2. If inviter is NOT an admin/owner, notify the group owner + admins for approval
    if (!autoApprove) {
      // Notify group owner
      const owner = await storage.getUser(group.createdById);
      if (owner && owner.id !== userId) {
        sendInviteToAdminEmail({
          adminName: owner.name,
          adminEmail: owner.email,
          inviterName: inviter.name,
          inviteeName: targetUser.name,
          groupName: group.name,
        });
      }
      // Notify group admins
      for (const adminId of adminIds) {
        if (adminId === userId || adminId === group.createdById) continue; // skip inviter & owner (already notified)
        const admin = await storage.getUser(adminId);
        if (admin) {
          sendInviteToAdminEmail({
            adminName: admin.name,
            adminEmail: admin.email,
            inviterName: inviter.name,
            inviteeName: targetUser.name,
            groupName: group.name,
          });
        }
      }
    }
  });

  // GET /api/groups/:id/invites â Get pending invites for group
  app.get("/api/groups/:id/invites", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }

    const invites = await storage.getPendingInvitesForGroup(group.id);

    // Enrich with user info
    const enriched = await Promise.all(invites.map(async (invite) => {
      const [inviter, invitee] = await Promise.all([
        storage.getUser(invite.inviterId),
        storage.getUser(invite.inviteeId),
      ]);
      return {
        ...invite,
        inviterName: inviter?.name || "Unknown",
        inviteeName: invitee?.name || "Unknown",
        inviteeEmail: invitee?.email || "",
        groupName: group.name,
      };
    }));

    res.json(enriched);
  });

  // GET /api/invites/incoming â Get incoming invites for current user
  app.get("/api/invites/incoming", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const invites = await storage.getPendingInvitesForUser(userId);

    const enriched = await Promise.all(invites.map(async (invite) => {
      const [inviter, group] = await Promise.all([
        storage.getUser(invite.inviterId),
        storage.getGroup(invite.groupId),
      ]);
      return {
        ...invite,
        inviterName: inviter?.name || "Unknown",
        groupName: group?.name || "Unknown Group",
      };
    }));

    res.json(enriched);
  });

  // POST /api/invites/:id/admin-approve
  app.post("/api/invites/:id/admin-approve", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const invite = await storage.getGroupInvite(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });

    const group = await storage.getGroup(invite.groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can approve invites" });
    }

    const updated = await storage.updateGroupInvite(invite.id, {
      adminApproved: true,
      adminApprovedBy: userId,
    });
    if (!updated) return res.status(500).json({ error: "Failed to update invite" });

    // If invitee already accepted, complete the invite
    if (updated.inviteeAccepted === true) {
      await storage.updateGroupInvite(invite.id, { status: "completed" });
      await storage.updateGroupMembers(group.id, [...group.memberIds, invite.inviteeId]);
    }

    res.json(updated);
  });

  // POST /api/invites/:id/admin-reject
  app.post("/api/invites/:id/admin-reject", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const invite = await storage.getGroupInvite(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });

    const group = await storage.getGroup(invite.groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can reject invites" });
    }

    const updated = await storage.updateGroupInvite(invite.id, { status: "rejected" });
    res.json(updated);
  });

  // POST /api/invites/:id/accept
  app.post("/api/invites/:id/accept", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;

    const invite = await storage.getGroupInvite(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.inviteeId !== userId) return res.status(403).json({ error: "Not your invite" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });

    const updated = await storage.updateGroupInvite(invite.id, { inviteeAccepted: true });
    if (!updated) return res.status(500).json({ error: "Failed to update invite" });

    // If admin already approved, complete the invite
    if (updated.adminApproved === true) {
      await storage.updateGroupInvite(invite.id, { status: "completed" });
      const group = await storage.getGroup(invite.groupId);
      if (group) {
        await storage.updateGroupMembers(group.id, [...group.memberIds, invite.inviteeId]);
      }
    }

    res.json(updated);
  });

  // POST /api/invites/:id/decline
  app.post("/api/invites/:id/decline", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;

    const invite = await storage.getGroupInvite(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.inviteeId !== userId) return res.status(403).json({ error: "Not your invite" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });

    const updated = await storage.updateGroupInvite(invite.id, { status: "rejected" });
    res.json(updated);
  });

  app.delete("/api/groups/:id/members/:memberId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    // Only owner, group admin, or global admin can remove members
    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can remove members" });
    }

    const memberId = req.params.memberId;

    // Can't remove the owner
    if (memberId === group.createdById) {
      return res.status(400).json({ error: "Cannot remove the group owner" });
    }

    // Admin can't remove other admins (only owner or global admin can)
    if (!isOwner && !isGlobalAdmin && adminIds.includes(memberId)) {
      return res.status(403).json({ error: "Only the group owner can remove other admins" });
    }

    // Balance check â block if member has unsettled balance
    const groupExpenses = await storage.getExpensesByGroup(group.id);
    const balance = getGroupMemberBalance(groupExpenses, memberId);
    if (balance !== 0) {
      return res.status(400).json({
        error: `This member has unsettled balances ($${Math.abs(balance).toFixed(2)} ${balance > 0 ? "owed to them" : "they owe"}). Please settle up before removing.`,
        balance,
      });
    }

    const newMembers = group.memberIds.filter((id) => id !== memberId);
    const newAdminIds = adminIds.filter((id) => id !== memberId);
    const updated = await storage.updateGroupMembersAndAdmins(group.id, newMembers, newAdminIds);
    res.json(updated);
  });

  // Rename group — owner, group admin, or global admin only
  app.patch("/api/groups/:id/name", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can rename the group" });
    }

    const name = (req.body.name || "").trim();
    if (!name || name.length < 1) {
      return res.status(400).json({ error: "Group name is required" });
    }

    const updated = await storage.updateGroupName(group.id, sanitize(name, 100));
    res.json(updated);
  });

  // Toggle simplify debts — owner, group admin, or global admin only
  app.patch("/api/groups/:id/simplify-debts", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can change this setting" });
    }

    const simplifyDebts = !!req.body.simplifyDebts;
    const updated = await storage.updateGroupSimplifyDebts(group.id, simplifyDebts);
    res.json(updated);
  });

  app.delete("/api/groups/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });

    const adminIds = group.adminIds || [];
    const isOwner = group.createdById === userId;
    const isGroupAdmin = adminIds.includes(userId);
    const isGlobalAdmin = user.isAdmin;

    if (!isOwner && !isGroupAdmin && !isGlobalAdmin) {
      return res.status(403).json({ error: "Only the group owner or an admin can delete it" });
    }

    await storage.deleteGroup(req.params.id);
    res.status(204).send();
  });

  // ========== Expenses â requires approved ==========
  app.get("/api/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const expensesList = await storage.getExpensesForUser(userId);
    res.json(expensesList);
  });

  app.get("/api/expenses/group/:groupId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.groupId);
    if (!group || !group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    const expensesList = await storage.getExpensesByGroup(req.params.groupId);
    res.json(expensesList);
  });

  app.post("/api/expenses", requireAuth, upload.single("receipt"), async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, groupId, date, isSettlement } = req.body;
    // splitAmongIds comes as JSON string from FormData
    let splitAmongIds = req.body.splitAmongIds;
    if (typeof splitAmongIds === "string") {
      try { splitAmongIds = JSON.parse(splitAmongIds); } catch { /* keep as-is */ }
    }

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // If group expense, verify user is in the group
    if (groupId) {
      const group = await storage.getGroup(groupId);
      if (!group || !group.memberIds.includes(userId)) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
    }

    const expense = await storage.createExpense({
      description: sanitize(description, 200),
      amount: parsedAmount,
      paidById,
      splitAmongIds,
      groupId: groupId || null,
      date,
      addedById: userId,
      isSettlement: !!isSettlement,
    });
    res.status(201).json(expense);

    // Receipt from upload (held in memory only â not saved)
    const receiptFile = req.file;

    // Send email notifications for group expense (fire-and-forget)
    try {
      const payer = await storage.getUser(paidById);
      const splitUsers = await storage.getUsersSafe(splitAmongIds);
      const perPerson = parsedAmount / splitAmongIds.length;
      let groupName: string | undefined;
      if (groupId) {
        const group = await storage.getGroup(groupId);
        groupName = group?.name;
      }
      if (payer) {
        notifyExpenseCreated({
          description: sanitize(description, 200),
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: splitUsers.map((u) => ({ name: u.name, email: u.email, share: perPerson })),
          groupName,
          isSettlement: !!isSettlement,
          receiptBuffer: receiptFile?.buffer,
          receiptFilename: receiptFile?.originalname,
        });
      }
    } catch (e) { /* ignore email errors */ }

    // Receipt data: client-side (free tier Tesseract) or server-side (premium Haiku)
    const clientReceiptData = req.body.receiptData;
    if (clientReceiptData) {
      try {
        const parsed = typeof clientReceiptData === "string" ? JSON.parse(clientReceiptData) : clientReceiptData;
        if (parsed.items && Array.isArray(parsed.items)) {
          storage.updateExpenseReceiptData(expense.id, JSON.stringify(parsed));
        }
      } catch { /* ignore invalid JSON */ }
    } else if (RECEIPT_SCANNING_ENABLED && receiptFile?.buffer) {
      parseReceipt(receiptFile.buffer, receiptFile.mimetype || "image/jpeg")
        .then((data) => {
          if (data) {
            storage.updateExpenseReceiptData(expense.id, JSON.stringify(data));
          }
        })
        .catch(() => { /* ignore parse errors */ });
    }
  });

  app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Check expense exists
    const expense = await storage.getExpense(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });

    // Only the person who added the expense or admin can delete
    if (expense.addedById !== userId && !user.isAdmin) {
      return res.status(403).json({ error: "Only the person who created this expense can delete it" });
    }

    const deleted = await storage.deleteExpense(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========== Receipt data for an expense ==========
  app.get("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
    const expense = await storage.getExpense(req.params.id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });
    if (!expense.receiptData) return res.json(null);
    try {
      res.json(JSON.parse(expense.receiptData));
    } catch {
      res.json(null);
    }
  });

  // ========== Members info for a group ==========
  app.get("/api/groups/:id/members", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }
    const members = await storage.getUsersSafe(group.memberIds);
    res.json(members);
  });

  // Batch: all unique members across all user's groups (avoids N+1 on dashboard)
  app.get("/api/members/all", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const userGroups = await storage.getGroupsForUser(userId);
    const memberIdSet = new Set<string>();
    for (const g of userGroups) {
      g.memberIds.forEach((id: string) => memberIdSet.add(id));
    }
    if (memberIdSet.size === 0) return res.json([]);
    const members = await storage.getUsersSafe(Array.from(memberIdSet));
    res.json(members);
  });

  // ========== Data Export (emailed as CSV) ==========
  app.post("/api/export/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const { scope, friendId, groupId } = req.body;
    // scope: "all" | "friend" | "group"

    let expenses: any[] = [];
    let scopeLabel = "All Expenses";

    if (scope === "friend" && friendId) {
      // Get direct expenses between this user and the friend
      const directExpenses = await storage.getDirectExpensesForUser(userId);
      expenses = directExpenses.filter(
        (e: any) =>
          (e.paidById === userId && e.splitAmongIds.includes(friendId)) ||
          (e.paidById === friendId && e.splitAmongIds.includes(userId))
      );
      const friendUser = await storage.getUser(friendId);
      scopeLabel = friendUser ? `Expenses with ${friendUser.name}` : "Friend Expenses";
    } else if (scope === "group" && groupId) {
      // Get group expenses
      const group = await storage.getGroup(groupId);
      if (!group || !group.memberIds.includes(userId)) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
      expenses = await storage.getExpensesByGroup(groupId);
      scopeLabel = `Expenses in ${group.name}`;
    } else {
      // All expenses
      expenses = await storage.getExpensesForUser(userId);
      scopeLabel = "All Expenses";
    }

    if (expenses.length === 0) {
      return res.status(400).json({ error: "No expenses to export" });
    }

    // Build user and group lookup maps
    const userIds = new Set<string>();
    expenses.forEach((e: any) => {
      userIds.add(e.paidById);
      e.splitAmongIds.forEach((id: string) => userIds.add(id));
    });
    const usersMap = new Map<string, string>();
    if (userIds.size > 0) {
      const users = await storage.getUsersSafe(Array.from(userIds));
      users.forEach(u => usersMap.set(u.id, u.name));
    }
    const allGroups = await storage.getGroupsForUser(userId);
    const groupsMap = new Map<string, string>();
    allGroups.forEach(g => groupsMap.set(g.id, g.name));

    // Sort by date descending
    const sorted = [...expenses].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Build CSV
    const csvRows = ["Date,Description,Amount,Paid By,Split Among,Group,Type"];
    for (const e of sorted) {
      const date = new Date(e.date).toLocaleDateString("en-CA"); // YYYY-MM-DD
      const desc = e.description.replace(/"/g, '""');
      const paidBy = usersMap.get(e.paidById) || "Unknown";
      const splitAmong = e.splitAmongIds.map((id: string) => usersMap.get(id) || "Unknown").join("; ");
      const group = e.groupId ? (groupsMap.get(e.groupId) || "Unknown Group") : "Direct";
      const type = e.isSettlement ? "Settlement" : "Expense";
      csvRows.push(`"${date}","${desc}",${e.amount.toFixed(2)},"${paidBy}","${splitAmong}","${group}","${type}"`);
    }

    const csv = csvRows.join("\n");

    // Email the CSV to the user
    try {
      await sendExportEmail(user.email, user.name, csv, scopeLabel);
      res.json({ message: `Export sent to ${user.email}` });
    } catch (err) {
      console.error("Export email failed:", err);
      res.status(500).json({ error: "Failed to send export email. Please try again." });
    }
  });

  // ========== Delete Account ==========
  app.delete("/api/user/delete-account", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    try {
      await storage.deleteUser(userId);
      req.session.destroy(() => {
        res.json({ ok: true });
      });
    } catch (err) {
      console.error("Account deletion failed:", err);
      res.status(500).json({ error: "Failed to delete account. Please try again." });
    }
  });

  // ========== Support Contact ==========
  const supportLimiter = rateLimit(60 * 60 * 1000, 5); // 5 support requests per hour per IP

  app.post("/api/support", requireAuth, supportLimiter, async (req, res) => {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message is too long (max 2000 characters)" });
    }

    const userId = (req.session as any).userId;
    try {
      await sendSupportEmail({
        fromName: sanitize(name, 100),
        fromEmail: sanitize(email, 200),
        subject: sanitize(subject, 200),
        message: sanitize(message, 2000),
        userId,
      });
      res.json({ message: "Support request sent. We'll get back to you soon!" });
    } catch (err) {
      console.error("Support email failed:", err);
      res.status(500).json({ error: "Failed to send. Please try again later." });
    }
  });

  // CSV line parser helper for Splitwise import (handles quoted fields)
  function importParseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }


  // ========== Splitwise CSV Import ==========
  app.post("/api/import/splitwise", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const currentUser = await storage.getUser(userId);
      if (!currentUser) return res.status(401).json({ error: "User not found" });

      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const csvText = file.buffer.toString("utf-8");
      const lines = csvText.split("\n").filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV file is empty" });

      // Parse headers
      const headers = importParseCSVLine(lines[0]);
      const dateIdx = headers.indexOf("Date");
      const descIdx = headers.indexOf("Description");
      const costIdx = headers.indexOf("Cost");
      const catIdx = headers.indexOf("Category");
      const currIdx = headers.indexOf("Currency");

      if (dateIdx === -1 || descIdx === -1 || costIdx === -1 || currIdx === -1) {
        return res.status(400).json({
          error: "Invalid Splitwise CSV. Expected columns: Date, Description, Cost, Currency"
        });
      }

      // Person columns are everything after Currency
      const personNames = headers.slice(currIdx + 1).map(n => n.trim()).filter(n => n);
      if (personNames.length === 0) {
        return res.status(400).json({ error: "No person columns found in CSV" });
      }

      // Match importing user to a CSV column (fuzzy match)
      const userName = currentUser.name.toLowerCase().trim();
      let importerIdx = -1;

      // 1. Exact match
      importerIdx = personNames.findIndex(n => n.toLowerCase() === userName);
      // 2. Contains match (CSV name contains user name or vice versa)
      if (importerIdx === -1) {
        importerIdx = personNames.findIndex(n =>
          n.toLowerCase().includes(userName) || userName.includes(n.toLowerCase())
        );
      }
      // 3. First name match
      if (importerIdx === -1) {
        const firstName = userName.split(" ")[0];
        importerIdx = personNames.findIndex(n =>
          n.toLowerCase().split(" ")[0] === firstName
        );
      }

      if (importerIdx === -1) {
        return res.status(400).json({
          error: `Could not match your name "${currentUser.name}" to any person in the CSV. Found: ${personNames.join(", ")}. Please update your display name to match.`
        });
      }

      // Check if updating an existing group or creating a new one
      const targetGroupId = req.body.groupId;
      const colToUserId = new Map<number, string>();
      const ghostMembers: { id: string; name: string }[] = [];
      colToUserId.set(importerIdx, userId);
      let group: any;
      let existingExpenses: any[] = [];

      // Helper: match a CSV name against a list of users (exact → contains → first name)
      function matchUserByName(csvName: string, candidates: { id: string; name: string }[]): { id: string; name: string } | undefined {
        const cn = csvName.toLowerCase().trim();
        let m = candidates.find(u => u.name.toLowerCase() === cn);
        if (!m) m = candidates.find(u =>
          u.name.toLowerCase().includes(cn) || cn.includes(u.name.toLowerCase())
        );
        if (!m) {
          const firstName = cn.split(" ")[0];
          m = candidates.find(u => u.name.toLowerCase().split(" ")[0] === firstName);
        }
        return m;
      }

      if (targetGroupId) {
        // Re-import mode: update existing group
        group = await storage.getGroup(targetGroupId);
        if (!group) return res.status(404).json({ error: "Group not found" });
        if (!group.memberIds.includes(userId)) {
          return res.status(403).json({ error: "Not a member of this group" });
        }

        // Match CSV person names to existing group members
        const groupMembers = await storage.getUsersSafe(group.memberIds);
        for (let i = 0; i < personNames.length; i++) {
          if (i === importerIdx) continue;

          const matched = matchUserByName(personNames[i], groupMembers);

          if (matched) {
            colToUserId.set(i, matched.id);
          } else {
            // No match in group — create a ghost user and add to group
            const ghost = await storage.createGhostUser(personNames[i]);
            colToUserId.set(i, ghost.id);
            ghostMembers.push({ id: ghost.id, name: personNames[i] });
            await storage.updateGroupMembers(group.id, [...group.memberIds, ghost.id]);
            group.memberIds.push(ghost.id);
          }
        }

        // Load existing expenses for dedup
        existingExpenses = await storage.getExpensesByGroup(group.id);
      } else {
        // New import: create ghost users for everyone except the importer
        // (ghosts get linked to real accounts later via the invite flow, which uses email — reliable)
        for (let i = 0; i < personNames.length; i++) {
          if (i === importerIdx) continue;
          const ghost = await storage.createGhostUser(personNames[i]);
          colToUserId.set(i, ghost.id);
          ghostMembers.push({ id: ghost.id, name: personNames[i] });
        }

        const allMemberIds = Array.from(colToUserId.values());
        group = await storage.createGroup({
          name: `Splitwise Import — ${new Date().toISOString().split("T")[0]}`,
          createdById: userId,
          memberIds: allMemberIds,
          adminIds: [userId],
        });
      }

      // Parse data rows
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      const personColStart = currIdx + 1;

      for (let i = 1; i < lines.length; i++) {
        try {
          const cols = importParseCSVLine(lines[i]);
          const description = (cols[descIdx] || "").trim();
          const cost = parseFloat(cols[costIdx]);
          const date = cols[dateIdx] || new Date().toISOString().split("T")[0];
          const category = catIdx !== -1 ? (cols[catIdx] || "").trim() : "";

          // Skip total balance row and empty rows
          if (description.toLowerCase().includes("total balance") || !description) {
            skipped++;
            continue;
          }
          if (isNaN(cost) || cost === 0) {
            skipped++;
            continue;
          }

          // Detect settlement: Category is "Payment" or description matches "X paid Y"
          const isSettlement = category.toLowerCase() === "payment" ||
            /^.+ paid .+$/i.test(description);

          // Parse person values from CSV columns
          const personValues: { colIdx: number; userId: string; value: number }[] = [];
          for (let j = 0; j < personNames.length; j++) {
            const val = parseFloat(cols[personColStart + j]);
            if (!isNaN(val) && val !== 0) {
              personValues.push({ colIdx: j, userId: colToUserId.get(j)!, value: val });
            }
          }

          if (personValues.length === 0) {
            skipped++;
            continue;
          }

          // Payer = person with positive value (they fronted the money)
          const payer = personValues.reduce((a, b) => a.value > b.value ? a : b);
          if (payer.value <= 0) {
            // Everyone has negative values — skip this row
            skipped++;
            continue;
          }

          // Split among = all involved persons
          const splitAmongIds = personValues.map(pv => pv.userId);
          const desc = category && !isSettlement ? `${description} (${category})` : description;

          // Build per-person split amounts from CSV values
          // CSV: negative = owes, positive = is owed (payer)
          // We store: how much each person's share is (what they owe for this expense)
          const splitAmounts: Record<string, number> = {};
          for (const pv of personValues) {
            if (pv.userId === payer.userId) {
              // Payer's own share = total cost - what they're owed
              // e.g., cost=307.45, payer value=+245.96 → payer's share = 307.45 - 245.96 = 61.49
              splitAmounts[pv.userId] = Math.round((Math.abs(cost) - payer.value) * 100) / 100;
            } else {
              // Others: their share = absolute value of their negative CSV value
              splitAmounts[pv.userId] = Math.round(Math.abs(pv.value) * 100) / 100;
            }
          }

          // Dedup: skip if an expense with same date + amount + description already exists in this group
          if (existingExpenses.length > 0) {
            const isDuplicate = existingExpenses.some(e =>
              e.date === date &&
              Math.abs(e.amount - Math.abs(cost)) < 0.01 &&
              e.description === sanitize(desc, 200)
            );
            if (isDuplicate) {
              skipped++;
              continue;
            }
          }

          await storage.createExpense({
            description: sanitize(desc, 200),
            amount: Math.abs(cost),
            paidById: payer.userId,
            splitAmongIds,
            groupId: group.id,
            date,
            addedById: userId,
            isSettlement,
            splitAmounts: JSON.stringify(splitAmounts),
          });

          imported++;
        } catch (err) {
          errors.push(`Row ${i + 1}: Failed to import`);
          skipped++;
        }
      }

      res.json({
        imported,
        skipped,
        errors,
        groupId: group.id,
        groupName: group.name,
        ghostMembers,
        isUpdate: !!targetGroupId,
      });
    } catch (err) {
      console.error("Import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  });

  // ========== Import into existing group with explicit member mapping ==========
  app.post("/api/groups/:groupId/import-mapped", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const currentUser = await storage.getUser(userId);
      if (!currentUser) return res.status(401).json({ error: "User not found" });

      const groupId = req.params.groupId;
      const group = await storage.getGroup(groupId);
      if (!group) return res.status(404).json({ error: "Group not found" });
      if (!group.memberIds.includes(userId)) return res.status(403).json({ error: "Not a member" });

      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const mapping = JSON.parse(req.body.mapping || "{}");

      const csvText = file.buffer.toString("utf-8");
      const lines = csvText.split("\n").filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV file is empty" });

      const headers = importParseCSVLine(lines[0]);
      const dateIdx = headers.indexOf("Date");
      const descIdx = headers.indexOf("Description");
      const costIdx = headers.indexOf("Cost");
      const currIdx = headers.indexOf("Currency");
      if (dateIdx === -1 || descIdx === -1 || costIdx === -1 || currIdx === -1) {
        return res.status(400).json({ error: "Invalid Splitwise CSV" });
      }

      const personNames = headers.slice(currIdx + 1).map(n => n.trim()).filter(n => n);
      const colToUserId = new Map<number, string>();
      const ghostMembers: { id: string; name: string }[] = [];

      // Build colToUserId from the explicit mapping
      for (let i = 0; i < personNames.length; i++) {
        const csvName = personNames[i];
        const m = mapping[csvName];
        if (!m) return res.status(400).json({ error: `No mapping for "${csvName}"` });

        if (m.type === "skip") {
          // Skipped person — don't add to group, their expense share is ignored
          continue;
        } else if (m.type === "self") {
          colToUserId.set(i, userId);
        } else if (m.type === "member") {
          colToUserId.set(i, m.userId);
        } else if (m.type === "new" && m.email) {
          // Check if a real user with this email exists
          const existing = await storage.getUserByEmail(m.email.toLowerCase().trim());
          if (existing && !existing.isGhost) {
            colToUserId.set(i, existing.id);
            if (!group.memberIds.includes(existing.id)) {
              await storage.updateGroupMembers(group.id, [...group.memberIds, existing.id]);
              group.memberIds.push(existing.id);
            }
          } else {
            // Create ghost + set email for invite
            const ghost = await storage.createGhostUser(csvName);
            await storage.updateUserEmail(ghost.id, m.email.toLowerCase().trim());
            colToUserId.set(i, ghost.id);
            ghostMembers.push({ id: ghost.id, name: csvName });
            await storage.updateGroupMembers(group.id, [...group.memberIds, ghost.id]);
            group.memberIds.push(ghost.id);

            // Send invite email
            try {
              const { sendGhostInviteEmail } = await import("./email");
              await sendGhostInviteEmail({
                to: m.email.toLowerCase().trim(),
                inviterName: currentUser.name,
                ghostName: csvName,
                groupName: group.name,
              });
            } catch {}
          }
        }
      }

      // Load existing expenses for dedup
      const existingExpenses = await storage.getExpensesByGroup(group.id);

      // Parse and import expenses
      let imported = 0, skipped = 0;
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const cols = importParseCSVLine(lines[i]);
          const desc = cols[descIdx]?.trim();
          const date = cols[dateIdx]?.trim();
          const cost = parseFloat(cols[costIdx]?.trim() || "0");
          if (!desc || !date || isNaN(cost) || cost === 0) { skipped++; continue; }
          if (desc.toLowerCase().includes("total balance")) { skipped++; continue; }

          const isSettlement = desc.toLowerCase().includes("payment") || desc.toLowerCase().includes("settle up") || desc.toLowerCase().includes("settled") || desc.toLowerCase().includes("settle all");

          // Find payer: person with highest positive value (skip unmapped people)
          let payer = { idx: 0, amount: 0, userId: userId };
          for (let p = 0; p < personNames.length; p++) {
            const uid = colToUserId.get(p);
            if (!uid) continue; // skipped person
            const val = parseFloat(cols[currIdx + 1 + p]?.trim() || "0");
            if (val > payer.amount) {
              payer = { idx: p, amount: val, userId: uid };
            }
          }

          // Build split amounts — match original import logic exactly
          // CSV: negative = owes, positive = is owed (payer)
          // We store: how much each person's share is (what they owe for this expense)
          const personValues: { userId: string; value: number }[] = [];
          for (let p = 0; p < personNames.length; p++) {
            const val = parseFloat(cols[currIdx + 1 + p]?.trim() || "0");
            const uid = colToUserId.get(p);
            if (!uid) continue; // skipped person — their share excluded
            if (val !== 0) personValues.push({ userId: uid, value: val });
          }

          // When members are skipped, adjust expense amount to exclude their share
          // Payer's share = full cost - payer's positive CSV value
          // Mapped cost = payer's share + sum of mapped people's negative values
          const sumMappedNegatives = personValues.filter(pv => pv.value < 0).reduce((s, pv) => s + Math.abs(pv.value), 0);
          const payerShare = Math.round((Math.abs(cost) - payer.amount) * 100) / 100;
          const mappedCost = Math.round((payerShare + sumMappedNegatives) * 100) / 100;

          const splitAmounts: Record<string, number> = {};
          const splitAmongIds: string[] = [];
          for (const pv of personValues) {
            splitAmongIds.push(pv.userId);
            if (pv.userId === payer.userId) {
              splitAmounts[pv.userId] = payerShare;
            } else {
              splitAmounts[pv.userId] = Math.round(Math.abs(pv.value) * 100) / 100;
            }
          }
          if (splitAmongIds.length === 0) { skipped++; continue; }

          // Dedup
          const isDuplicate = existingExpenses.some(e =>
            e.date === date && Math.abs(e.amount - mappedCost) < 0.01 && e.description === sanitize(desc, 200)
          );
          if (isDuplicate) { skipped++; continue; }

          await storage.createExpense({
            description: sanitize(desc, 200),
            amount: mappedCost,
            paidById: payer.userId,
            splitAmongIds,
            groupId: group.id,
            date,
            addedById: userId,
            isSettlement,
            splitAmounts: JSON.stringify(splitAmounts),
          });
          imported++;
        } catch {
          errors.push(`Row ${i + 1}: Failed`);
          skipped++;
        }
      }

      res.json({ imported, skipped, errors, groupId: group.id, groupName: group.name, ghostMembers });
    } catch (err) {
      console.error("Mapped import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  });

  // ========== Ghost Member Invite ==========
  app.post("/api/ghost/:ghostId/invite", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const inviter = await storage.getUser(userId);
    if (!inviter) return res.status(401).json({ error: "User not found" });

    const ghost = await storage.getUser(req.params.ghostId);
    if (!ghost || !ghost.isGhost) {
      return res.status(404).json({ error: "Ghost member not found" });
    }

    const email = sanitize((req.body.email || "").toLowerCase(), 255);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    // Check if a real user with this email already exists
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser && !existingUser.isGhost) {
      // Merge ghost into the existing user
      await storage.mergeGhostUser(ghost.id, existingUser.id);
      return res.json({ merged: true, userId: existingUser.id, userName: existingUser.name });
    }

    // No existing user — update ghost's email and send invite
    await storage.updateUserEmail(ghost.id, email);

    // Find a group this ghost belongs to (for the email)
    const allGroups = await storage.getGroupsForUser(userId);
    const sharedGroup = allGroups.find(g => g.memberIds.includes(ghost.id));
    const groupName = sharedGroup?.name || "a group";

    // Send invite email
    const { sendGhostInviteEmail } = await import("./email");
    await sendGhostInviteEmail({
      to: email,
      inviterName: inviter.name,
      ghostName: ghost.name,
      groupName,
    });

    res.json({ invited: true, email });
  });

  return httpServer;
}
