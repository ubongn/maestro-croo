/* Maestro dashboard client — polls /api/state and renders the live view. */

const $ = (id) => document.getElementById(id);
let stateCache = null;
let lastStratOrderId = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtAddr(a) {
  if (!a) return "not connected";
  return a.slice(0, 6) + "…" + a.slice(-4);
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
}
function short(id) { return id ? id.slice(0, 8) + "…" : "—"; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderWallet(s) {
  $("wallet-usdc").textContent = s.wallet.usdc !== null ? s.wallet.usdc.toFixed(2) + " USDC" : "— USDC";
  $("wallet-addr").textContent = fmtAddr(s.wallet.address);
  const b = $("status-badge");
  if (s.agent.configured) { b.textContent = "live"; b.className = "badge ok"; }
  else { b.textContent = "degraded"; b.className = "badge"; }
}

function renderStats(s) {
  $("stat-orders").textContent = s.stats.totalOrders;
  $("stat-completed").textContent = s.stats.completedOrders;
  $("stat-agents").textContent = s.stats.agentsHired;
  $("stat-success").textContent = s.stats.successRate + "%";
  $("stat-synth").textContent = s.stats.avgSynthesisMs ? (s.stats.avgSynthesisMs / 1000).toFixed(1) + "s" : "0s";
  $("uptime").textContent = "uptime " + Math.floor(s.uptime / 1000) + "s";
}

function renderIncoming(s) {
  const el = $("incoming");
  if (!s.incoming.length) { el.innerHTML = '<div class="empty">No incoming orders yet.</div>'; return; }
  el.innerHTML = s.incoming.map((o) => `
    <div class="row">
      <span class="glyph">📥</span>
      <div class="row-main">
        <div class="row-title">${esc(o.requestLabel)}</div>
        <div class="row-sub">${short(o.orderId)} • ${fmtUsd(o.priceUsdc)}</div>
      </div>
      <span class="phase">${esc(o.phase)}</span>
      <span class="pill ${pillClass(o.phase)}">${esc(o.status)}</span>
    </div>`).join("");
}

function pillClass(phase) {
  const p = String(phase).toLowerCase();
  if (p.includes("deliver")) return "delivered";
  if (p.includes("orchestr") || p.includes("hir") || p.includes("synth")) return "orchestrating";
  return "pending";
}

function renderSubOrders(s) {
  const el = $("suborders");
  if (!s.subOrders.length) { el.innerHTML = '<div class="empty">No sub-agents hired yet.</div>'; return; }
  el.innerHTML = s.subOrders.map((o) => `
    <div class="row">
      <span class="glyph">${o.glyph || "🤖"}</span>
      <div class="row-main">
        <div class="row-title">${esc(o.agentName)} <span style="color:var(--text-faint);font-weight:400;font-size:12px">${esc(o.role)}</span></div>
        <div class="row-sub">${short(o.orderId)} ${o.priceUsdc !== null ? "• " + fmtUsd(o.priceUsdc) : ""} ${o.error ? "• " + esc(o.error) : ""}</div>
      </div>
      <span class="pill ${o.status}">${o.status}</span>
    </div>`).join("");
}

function renderFeed(s) {
  const el = $("feed");
  if (!s.feed.length) { el.innerHTML = '<div class="empty">Waiting for events…</div>'; return; }
  el.innerHTML = s.feed.slice(0, 40).map((f) => `
    <div class="feed-item">
      <span class="feed-dot ${f.kind}"></span>
      <div class="feed-body">
        <div class="feed-label">${esc(f.label)}</div>
        <div class="feed-detail">${esc(f.detail)}</div>
      </div>
      <span class="feed-time">${timeAgo(f.ts)}</span>
    </div>`).join("");
}

function renderStrategy(s) {
  const el = $("strategy");
  if (!s.strategies.length) { el.innerHTML = '<div class="empty">No strategies delivered yet.</div>'; return; }
  const top = s.strategies[0];
  lastStratOrderId = top.orderId;
  const strat = top.result || null;

  // If we only have summary (no full result), fetch & expand lazily.
  if (!strat) {
    el.innerHTML = `<div class="row-title">${esc(top.summary)}</div>
      <button class="strat-toggle" onclick="loadStrategy('${top.orderId}')">view full schema →</button>`;
    return;
  }

  const pctColor = (p) => Math.min(100, Math.max(0, p));
  const allocs = strat.allocations.map((a) => `
    <tr>
      <td><div class="alloc-asset">${esc(a.asset)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(a.protocol)}</div></td>
      <td>${esc(a.vehicle)}</td>
      <td>
        <div class="alloc-pct">${a.percentage}%</div>
        <div class="pct-bar"><i style="width:${pctColor(a.percentage)}%"></i></div>
      </td>
      <td style="color:var(--text-muted);font-size:12px">${esc(a.rationale)}</td>
    </tr>`).join("");

  const actions = (strat.actionItems || []).map((x) => `<li>${esc(x)}</li>`).join("");
  const warns = (strat.warnings || []).map((x) => `<li>${esc(x)}</li>`).join("");

  el.innerHTML = `
    <div class="strat-head">
      <span class="pill ${strat.riskLevel === "low" ? "success" : strat.riskLevel === "high" ? "failed" : "pending"}">${esc(strat.riskLevel)} risk</span>
      <div class="risk-meter">
        <div class="risk-bar"><div class="risk-fill" style="width:${strat.riskScore}%"></div></div>
        <span>${strat.riskScore}/100</span>
      </div>
      <span style="font-size:12px;color:var(--text-muted)">${(strat.sources || []).length} source(s) • ${strat.generatedAt ? new Date(strat.generatedAt).toLocaleTimeString() : ""}</span>
      <a class="strat-toggle" onclick="toggleJson()">raw JSON</a>
    </div>
    <p class="strat-summary">${esc(strat.summary)}</p>
    <table class="alloc-table">
      <thead><tr><th>Asset</th><th>Vehicle</th><th style="text-align:right">Weight</th><th>Rationale</th></tr></thead>
      <tbody>${allocs}</tbody>
    </table>
    ${actions ? `<div class="list-block"><h4>Action items</h4><ul>${actions}</ul></div>` : ""}
    ${warns ? `<div class="list-block warnings"><h4>Warnings</h4><ul>${warns}</ul></div>` : ""}
    <pre class="json" id="rawjson" style="display:none">${esc(JSON.stringify(strat, null, 2))}</pre>
  `;
}

window.toggleJson = function () {
  const el = $("rawjson");
  if (el) el.style.display = el.style.display === "none" ? "block" : "none";
};

window.loadStrategy = async function (orderId) {
  try {
    const data = await getJson("/api/strategy/" + orderId);
    if (stateCache) { stateCache.strategies[0].result = data.result; renderStrategy(stateCache); }
  } catch (e) { console.warn(e); }
};

function renderRegistry(agents) {
  const el = $("registry");
  const items = [
    ...agents.configured.map((a) => regCard(a, true)),
    ...agents.unconfigured.map((a) => regCard(a, false)),
  ];
  el.innerHTML = items.join("");
}
function regCard(a, ok) {
  return `<div class="reg-item ${ok ? "" : "unconfigured"}">
    <div class="reg-top"><span class="glyph">${a.glyph || "🤖"}</span>
      <span class="reg-name">${esc(a.name)}</span>
      <span class="pill ${ok ? "success" : "pending"}">${ok ? "ready" : "unconfigured"}</span></div>
    <p class="reg-desc">${esc(a.description)}</p>
    <div class="reg-meta">${esc(a.role)} • agent ${short(a.agentId)}${ok ? "" : " • set " + a.envVar}</div>
  </div>`;
}

async function poll() {
  try {
    const s = await getJson("/api/state");
    stateCache = s;
    renderWallet(s);
    renderStats(s);
    renderIncoming(s);
    renderSubOrders(s);
    renderFeed(s);
    renderStrategy(s);
    $("pulse").style.opacity = 1;
  } catch (e) {
    $("pulse").style.opacity = 0.3;
    console.warn("poll failed", e);
  }
}

async function init() {
  try {
    const agents = await getJson("/api/target-agents");
    renderRegistry(agents);
  } catch (e) { console.warn(e); }
  poll();
  setInterval(poll, 2000);
}

init();
