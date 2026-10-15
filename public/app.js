'use strict';
/* Sweat With Wilk — client */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function showToast(msg) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 3400);
}
// Two-tap confirm that works in every webview (native confirm() is silently swallowed in some).
function armButton(btn, armedLabel) {
  if (!btn) return true;
  if (btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1';
  btn.dataset.orig = btn.textContent;
  btn.textContent = armedLabel;
  btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.orig || btn.textContent; btn.classList.remove('armed'); } }, 4000);
  return false;
}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const fmtMoney = (n) => { const v = Number(n) || 0; return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); };
const fmtOdds = (o) => { o = Number(o) || 0; return o > 0 ? `+${o}` : `${o}`; };
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
}
function fmtDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const LEAGUES = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'WNBA', 'NCAAB', 'NCAAW', 'UFC'];
const SCORE_PILLS = ['NFL', 'NHL', 'MLB', 'SOCCER', 'NBA', 'NCAAF', 'WNBA', 'NCAAB', 'NCAAW', 'UFC', 'ALL'];
const SCORE_FETCH = { SOCCER: ['MLS', 'EPL'], ALL: ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NCAAW', 'WNBA', 'MLB', 'NHL', 'MLS', 'EPL', 'UFC'] };
const NEWS_LEAGUES = ['ALL', 'NFL', 'NHL', 'MLB', 'NBA', 'SOCCER', 'NCAAF', 'UFC', 'WNBA', 'NCAAB', 'NCAAW'];
const NEWS_FETCH = { ALL: ['NFL', 'NHL', 'MLB', 'NBA', 'NCAAF', 'UFC', 'WNBA', 'NCAAB', 'NCAAW', 'MLS'], SOCCER: ['MLS'] };
const state = {
  user: null, settings: null, tickets: [], view: 'home',
  scoresLeague: 'ALL', scoresCache: {}, boardDate: null,
  newsLeague: 'ALL', newsLimit: 8,
  homeTab: 'tickets', scoresSeg: 'live', ticketSeg: 'current', boardSeg: 'friends', peopleCache: null, lastDetail: null,
  detailCache: new Map(), blockTab: new Map(), fullPlays: new Set(), expandedBlocks: new Set(),
  alerts: null, communityCache: null,
  formSeg: 'away', formData: null,
};

const MORE_VIEWS = ['props', 'news', 'bankroll', 'account'];
function renderMore() { /* static menu lives in index.html (#view-more) */ }
function showView(name) {
  // Home is a composite: Sports News on top, then the My Tickets or Community panel.
  if (name === 'tickets') { state.homeTab = 'tickets'; name = 'home'; }
  else if (name === 'community') { state.homeTab = 'community'; name = 'home'; }
  else if (name === 'news') { name = 'home'; }
  state.view = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (name === 'home') {
    $('#view-tickets').hidden = state.homeTab !== 'tickets';
    $('#view-community').hidden = state.homeTab !== 'community';
  }
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  window.scrollTo(0, 0);
  render();
}
function setHomeTab(tab) { state.homeTab = tab; showView('home'); }
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.nav)));
$('#alerts-bell').addEventListener('click', () => { showView('account'); setTimeout(() => { const el = $('#alerts-center'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 60); });

async function refreshMe() {
  try {
    const d = await api('GET', '/api/me');
    state.user = d.user; state.settings = d.settings || null;
  } catch { state.user = null; }
  $('#alerts-bell').hidden = !state.user;
  renderProfileChip();
  refreshAlertBadge();
}
async function refreshAlertBadge() {
  if (!state.user) return;
  try {
    const a = await api('GET', '/api/alerts');
    state.alerts = a;
    const badge = $('#alerts-badge');
    badge.hidden = !a.unread; badge.textContent = a.unread;
  } catch { /* ignore */ }
}
function render() {
  refreshAlertBadge();
  renderProfileChip();
  ({ home: renderHome, tickets: renderTickets, scores: renderScores, props: renderProps, news: renderNews, community: renderCommunity, board: renderBoard, people: renderPeople, bankroll: renderBankroll, account: renderAccount, more: renderMore })[state.view]();
}

/* ================= TICKETS ================= */
function signInPromptHTML(text) {
  return `<div class="card"><div class="empty">${esc(text || 'Sign in to use your tracker.')}<br><br><button class="btn" onclick="showView('account')">Go to Account</button></div></div>`;
}
async function loadTickets() {
  const d = await api('GET', '/api/tickets');
  state.tickets = d.tickets || [];
}
function legStatusPill(l) {
  const s = l.status;
  if (s === 'won') return '<span class="pill won">Won</span>';
  if (s === 'lost') return '<span class="pill lost">Lost</span>';
  if (s === 'push') return '<span class="pill push">Push</span>';
  if (s === 'live') return '<span class="pill live">Live</span>';
  return '<span class="pill">Pending</span>';
}
function groupLegsByGame(ticket) {
  const groups = new Map();
  for (const leg of ticket.legs) {
    const key = leg.eventId ? `ev:${leg.eventId}` : `lbl:${leg.league}|${leg.gameLabel || leg.selection}`;
    if (!groups.has(key)) groups.set(key, { eventId: leg.eventId, league: leg.league, gameLabel: leg.gameLabel, game: ticket.games ? ticket.games[leg.id] : null, legs: [] });
    const g = groups.get(key);
    if (!g.game && ticket.games && ticket.games[leg.id]) g.game = ticket.games[leg.id];
    g.legs.push(leg);
  }
  return [...groups.values()];
}
function winProbHTML(game) {
  if (!game || game.winProbHome === null || game.winProbHome === undefined) return '';
  const hp = game.winProbHome;
  return `<div class="small muted" style="margin-top:8px">Win probability — ${esc(game.away.abbr)} ${Math.round(100 - hp)}% · ${esc(game.home.abbr)} ${Math.round(hp)}%</div>
  <div class="wpbar"><div style="width:${hp}%"></div></div>`;
}
function situationHTML(game, detail) {
  const g = detail && detail.game ? detail.game : game;
  if (!g) return '';
  let html = '';
  const isBaseball = ['MLB'].includes(g.league);
  const isFootball = ['NFL', 'NCAAF'].includes(g.league);
  if (isFootball && (g.downDistanceText || (detail && detail.downDistanceText))) {
    const yl = detail && detail.yardLine !== null && detail.yardLine !== undefined ? detail.yardLine : (g.yardLine !== null && g.yardLine !== undefined ? g.yardLine : null);
    html += `<div class="card tight" style="margin-top:10px"><div class="row between"><span class="small" style="color:var(--mint);font-weight:800">ON OFFENSE</span>${g.possessionAbbr ? '<span class="pill on">POSSESSION</span>' : ''}</div>
      <div style="font-weight:800;margin-top:4px">${esc(g.possessionAbbr || '')}${g.possessionAbbr ? ' · ' : ''}${esc((detail && detail.downDistanceText) || g.downDistanceText || '')}</div>
      ${yl !== null ? `<div class="field-strip"><div class="field-ball" style="left:${Math.max(2, Math.min(98, Number(yl) || 0))}%"></div></div><div class="small muted" style="margin-top:4px">Ball at the ${esc(String(yl))}</div>` : ''}
      <div class="small muted">${esc((detail && detail.driveText) || g.situationText || g.lastPlayText || '')}</div></div>`;
  }
  if (isBaseball && g.state === 'in') {
    const base = (on, cls) => `<div class="base ${cls} ${on ? 'on' : ''}"></div>`;
    html += `<div class="card tight" style="margin-top:10px"><div class="small" style="color:var(--mint);font-weight:800">${g.balls ?? 0}-${g.strikes ?? 0} COUNT · ${g.outs ?? 0} OUT${g.outs === 1 ? '' : 'S'}</div>
      <div class="row"><div class="diamond">${base(g.onSecond, 'b2')}${base(g.onFirst, 'b1')}${base(g.onThird, 'b3')}<div class="base home"></div></div>
      <div class="small muted">${g.batterName ? `At the plate: ${esc(g.batterName)}` : ''}<br>${esc(g.lastPlayText || '')}</div></div></div>`;
  }
  return html;
}
function gameHeaderHTML(game, league, gameLabel) {
  if (!game) {
    return `<div class="game-head"><div><strong>${esc(gameLabel || league)}</strong><div class="small muted">${esc(league)}</div></div><span class="pill">Not started / not found</span></div>`;
  }
  const winner = game.state === 'post' ? (game.home.score > game.away.score ? 'home' : game.away.score > game.home.score ? 'away' : '') : '';
  return `<div class="game-head"><div class="small muted">${esc(league)} · ${game.state === 'in' ? `<span class="status-live">LIVE ${esc(game.detail)}</span>` : esc(game.detail || fmtDateTime(game.start))}</div>
    ${game.state === 'in' ? '<span class="pill live">Live</span>' : game.state === 'post' ? '<span class="pill">Final</span>' : `<span class="pill">${esc(fmtDateTime(game.start))}</span>`}</div>
    <div class="team-line ${winner === 'away' ? 'win' : ''}"><span class="row" style="gap:7px">${game.away.logo ? `<img src="${esc(game.away.logo)}" alt="" style="width:22px;height:22px;object-fit:contain" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(game.away.abbr)} ${esc(game.away.name)}</span></span><span class="score">${game.away.score ?? ''}</span></div>
    <div class="team-line ${winner === 'home' ? 'win' : ''}"><span class="row" style="gap:7px">${game.home.logo ? `<img src="${esc(game.home.logo)}" alt="" style="width:22px;height:22px;object-fit:contain" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(game.home.abbr)} ${esc(game.home.name)}</span></span><span class="score">${game.home.score ?? ''}</span></div>`;
}
function linescoreHTML(detail) {
  if (!detail || !detail.linescores || !detail.linescores.length) return '';
  const heads = detail.linescores[0].periods.map((_, i) => `<th>${i + 1}</th>`).join('');
  const rows = detail.linescores.map((r) => `<tr><td>${esc(r.abbr)}</td>${r.periods.map((x) => `<td>${esc(x)}</td>`).join('')}<td class="tot">${esc(r.total)}</td></tr>`).join('');
  return `<table class="lines"><tr><th>Team</th>${heads}<th>T</th></tr>${rows}</table>`;
}
function detailTabsHTML(blockId, league, eventId) {
  if (!eventId) return '';
  const tab = state.blockTab.get(blockId) || 'plays';
  const d = state.detailCache.get(String(eventId));
  let body = '<div class="small muted" style="padding:8px 0">Loading game detail…</div>';
  if (d) {
    if (tab === 'plays') {
      const playCard = (pl, cls) => `<div class="play ${cls || ''} ${pl.scoringPlay ? 'scoring' : ''}"><div class="meta">${esc(pl.periodLabel)}${pl.clock ? ' · ' + esc(pl.clock) : ''} ${pl.teamAbbr ? '· ' + esc(pl.teamAbbr) : ''} ${pl.category ? `<span class="cat-chip">${esc(pl.category.toUpperCase())}</span>` : ''}</div><div class="txt">${pl.playersLine ? `<span class="muted">${esc(pl.playersLine)}</span><br>` : ''}${esc(pl.text)}</div></div>`;
      const full = state.fullPlays.has(blockId);
      const recent = full ? d.plays.slice(1) : d.plays.slice(1, 5);
      body = (d.plays.length ? `<div class="small" style="color:var(--mint);font-weight:800;margin-top:10px">LATEST PLAY</div>${playCard(d.plays[0], 'latest')}` +
        (recent.length ? `<div class="small" style="color:var(--mint);font-weight:800;margin-top:12px">RECENT PLAYS</div>${recent.map((pl) => playCard(pl)).join('')}` : '') : '<div class="small muted" style="padding:8px 0">No plays in the feed yet.</div>') +
        (d.plays.length > 5 ? `<button class="btn secondary small" style="margin-top:8px" onclick="toggleFullPlays('${blockId}')">${full ? 'Show recent only' : `Full play-by-play — all ${d.plays.length} plays`}</button>` : '');
    } else if (tab === 'stats') {
      const teamStats = d.teamStats && d.teamStats.length
        ? `<table class="lines"><tr><th>Stat</th>${d.statTeamAbbrs.map((a) => `<th>${esc(a)}</th>`).join('')}</tr>${d.teamStats.map((s) => `<tr><td>${esc(s.label)}</td>${s.values.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="small muted" style="padding:8px 0">No team stats in the feed.</div>';
      const leaders = d.leaders && d.leaders.length ? `<div class="small" style="color:var(--mint);font-weight:800;margin-top:10px">GAME LEADERS</div>${d.leaders.map((l) => `<div class="kv"><span>${esc(l.team)} · ${esc(l.label)}</span><span>${esc(l.value)}</span></div>`).join('')}` : '';
      const playerStats = d.playerStats && d.playerStats.length ? `<div class="small" style="color:var(--mint);font-weight:800;margin-top:12px">PLAYER STATS</div>` + d.playerStats.map((gs) => `<div class="small" style="font-weight:800;margin-top:8px">${esc(gs.teamAbbr)}${gs.category ? ' — ' + esc(gs.category) : ''}</div><table class="lines"><tr><th>Player</th>${gs.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${gs.rows.slice(0, 15).map((r) => `<tr><td>${esc(r.player)}</td>${r.values.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`).join('') : '';
      body = teamStats + playerStats + leaders;
    } else {
      body = d.scoringPlays && d.scoringPlays.length
        ? d.scoringPlays.map((pl) => `<div class="play scoring"><div class="meta">${esc(pl.periodLabel)} · ${esc(pl.clock)} · ${esc(pl.teamAbbr)} — ${esc(pl.awayScore)}–${esc(pl.homeScore)}</div><div class="txt">${esc(pl.text)}</div></div>`).join('')
        : '<div class="small muted" style="padding:8px 0">No scoring plays yet.</div>';
    }
  }
  return `<div class="tabs">
      <button class="${tab === 'plays' ? 'on' : ''}" onclick="setBlockTab('${blockId}','plays')">Plays</button>
      <button class="${tab === 'stats' ? 'on' : ''}" onclick="setBlockTab('${blockId}','stats')">Stats</button>
      <button class="${tab === 'scoring' ? 'on' : ''}" onclick="setBlockTab('${blockId}','scoring')">Scoring</button>
    </div><div id="detail-${blockId}">${body}</div>`;
}
async function ensureDetail(league, eventId) {
  if (!eventId) return;
  const key = String(eventId);
  const cached = state.detailCache.get(key);
  if (cached && Date.now() - cached.at < 12000) return;
  try {
    const d = await api('GET', `/api/game?league=${encodeURIComponent(league)}&eventId=${encodeURIComponent(eventId)}`);
    d.at = Date.now();
    state.detailCache.set(key, d);
    render();
  } catch { /* keep stale */ }
}
function setBlockTab(blockId, tab) { state.blockTab.set(blockId, tab); render(); }
function toggleGameBlock(blockId) { state.expandedBlocks.has(blockId) ? state.expandedBlocks.delete(blockId) : state.expandedBlocks.add(blockId); render(); }
function toggleFullPlays(blockId) { state.fullPlays.has(blockId) ? state.fullPlays.delete(blockId) : state.fullPlays.add(blockId); render(); }

function gameAlertToggleHTML(ticketId, eventId, league) {
  if (!state.alerts || !eventId) return '';
  const off = state.alerts.subs.some((s) => s.scope === 'game' && s.eventId === String(eventId) && !s.on);
  return `<button class="btn secondary small" onclick="toggleGameAlerts(${ticketId},'${esc(eventId)}',${off ? 'true' : 'false'})">🔔 Game alerts ${off ? 'off' : 'on'}</button>`;
}
async function toggleGameAlerts(ticketId, eventId, turnOn) {
  await api('POST', '/api/alerts/toggle', { scope: 'game', eventId, on: turnOn });
  await refreshAlertBadge(); render();
}
async function toggleTicketAlerts(ticketId, turnOn) {
  await api('POST', '/api/alerts/toggle', { scope: 'ticket', ticketId, on: turnOn });
  await refreshAlertBadge(); render();
}

/* ===== Web Push (lock-screen alerts) ===== */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function fillPushRow() {
  const row = document.getElementById('push-row');
  if (!row) return;
  const supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  if (!supported) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    row.innerHTML = (ios && !standalone)
      ? '<div class="small muted">📲 On iPhone, lock-screen alerts need the app on your home screen first: tap <strong>Share → Add to Home Screen</strong>, open Sweat With Wilk from there, then come back to this page to turn push on.</div>'
      : '<div class="small muted">This browser does not support push notifications.</div>';
    return;
  }
  let keyInfo = null;
  try { keyInfo = await api('GET', '/api/push/key'); } catch { keyInfo = null; }
  if (!keyInfo || !keyInfo.enabled) { row.innerHTML = '<div class="small muted">Push is being set up on the server — check back shortly.</div>'; return; }
  let sub = null;
  try { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); } catch { sub = null; }
  if (Notification.permission === 'denied') { row.innerHTML = '<div class="small muted">Push is blocked in this browser\'s site settings. Allow notifications there, then come back here.</div>'; return; }
  row.innerHTML = `<div class="switch-row"><span>📲 Lock-screen push alerts</span><input type="checkbox" style="width:auto" ${sub ? 'checked' : ''} onchange="togglePush(this.checked)"></div>
    <div class="small muted">${sub ? 'On for this device. The alert types you have on below will also pop on your lock screen — quiet hours still hold them back.' : 'Off. Turn it on and allow notifications so game starts, leg flips, and settlements reach your lock screen.'}</div><div id="push-msg"></div>`;
}
async function togglePush(on) {
  const msg = document.getElementById('push-msg');
  try {
    const reg = await navigator.serviceWorker.ready;
    if (on) {
      const keyInfo = await api('GET', '/api/push/key');
      if (!keyInfo || !keyInfo.enabled) throw new Error('Push is not configured on the server yet.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey) });
      await api('POST', '/api/push/subscribe', sub.toJSON());
    } else {
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    }
  } catch (e) { if (msg) msg.innerHTML = `<div class="err" style="margin-top:8px">${esc(e.message || 'Push toggle failed.')}</div>`; }
  fillPushRow();
}

/* ===== Tickets — Hard Rock "My Bets" style ===== */
function classifyTicket(t) {
  if (t.status === 'lost') return 'lost';
  if (t.status === 'won' || t.status === 'push') return 'finished';
  const groups = groupLegsByGame(t);
  if (groups.some((g) => g.game && g.game.state === 'in')) return 'live';
  return 'upcoming';
}
function shortPick(l) {
  let s = String(l.selection || '').replace(/\s+Moneyline$/i, '').trim();
  if (/\b(Over|Under)\b/i.test(s)) return s;
  const lineM = s.match(/^(.*?)\s+([+-]\d+(?:\.\d+)?)$/);
  let team = s, line = '';
  if (lineM) { team = lineM[1].trim(); line = ' ' + lineM[2]; }
  const words = team.split(/\s+/).filter(Boolean);
  let short = words.length > 1 ? words[words.length - 1] : team;
  if (words.length > 1 && /^(golden|fighting|roaring)$/i.test(words[words.length - 2])) short = words[words.length - 2] + ' ' + short;
  if (words.length === 1) short = team;
  if (words.length > 1 && /^[A-Z]{2,5}$/.test(words[0])) short = words[0]; // acronym schools: UTSA, FIU, UCLA
  if (l.market === 'Total') return s;
  return short + line;
}
function marketLabel(l) {
  if (l.market === 'Moneyline') return 'TO WIN';
  if (l.market === 'Spread') return 'SPREAD';
  if (l.market === 'Total') return 'TOTAL';
  if (/\b(Over|Under)\b/i.test(l.selection || '')) return 'PLAYER PROP';
  return String(l.market || '').toUpperCase();
}
function setTicketFilter(f) { state.ticketFilter = f; renderTicketsLight(); }
function toggleTicketSelections(id) {
  if (!state.expandedTickets) state.expandedTickets = new Set();
  state.expandedTickets.has(id) ? state.expandedTickets.delete(id) : state.expandedTickets.add(id);
  renderTicketsLight();
}
function stripHTML(g) {
  const game = g.game;
  if (!game) return g.gameLabel ? `<div class="small muted" style="margin-top:2px">${esc(g.gameLabel)}</div>` : '';
  if (game.state === 'pre') {
    return `<div class="small muted" style="margin-top:2px">${esc(g.gameLabel || '')}${game.start ? ' · ' + fmtDateTime(game.start) : ''}</div>`;
  }
  const detail = g.eventId ? state.detailCache.get(String(g.eventId)) : null;
  const ticker = detail && detail.plays && detail.plays.length ? detail.plays[0].text : (game.lastPlayText || '');
  return `<div class="hr-strip">
    <div class="row between">
      <span><strong>${esc(game.away.abbr)}</strong> <strong>${esc(game.away.score ?? '–')}</strong></span>
      <span class="hr-clock">${game.state === 'in' ? '● ' : ''}${esc(game.detail || '')}</span>
      <span><strong>${esc(game.home.score ?? '–')}</strong> <strong>${esc(game.home.abbr)}</strong></span>
    </div>
    ${ticker ? `<div class="hr-ticker">${esc(ticker)}</div>` : ''}
  </div>`;
}
function ticketCardHTML(t) {
  const groups = groupLegsByGame(t);
  const ticketOff = state.alerts ? state.alerts.subs.some((s) => s.scope === 'ticket' && s.ticketId === t.id && !s.on) : false;
  const expanded = state.expandedTickets ? state.expandedTickets.has(t.id) : false;
  const isBonus = /bonus/i.test(t.notes || '');
  const title = t.title || `${t.legs.length}-Bet Parlay`;
  const summary = t.legs.map(shortPick).join(', ');
  const settled = t.status === 'won' ? `<span class="pill won">Won · ${fmtMoney(t.payout)}</span>` : t.status === 'lost' ? '<span class="pill lost">Lost</span>' : t.status === 'push' ? '<span class="pill push">Push</span>' : '';
  const body = !expanded ? '' : groups.map((g, gi) => {
    const blockId = `t${t.id}g${gi}`;
    const detail = g.eventId ? state.detailCache.get(String(g.eventId)) : null;
    const legsHtml = g.legs.map((l) => {
      const prop = state.propCache && state.propCache[t.id] ? state.propCache[t.id].find((x) => x.legId === l.id) : null;
      const dotCls = l.status === 'won' ? 'won' : l.status === 'lost' ? 'lost' : (g.game && g.game.state === 'in' && l.status === 'pending') ? 'live' : '';
      return `<div style="margin-top:12px">
        <div class="row between"><span class="row" style="gap:8px"><span class="legdot ${dotCls}"></span><strong>${esc(shortPick(l))}</strong></span><strong class="hr-odds">${fmtOdds(l.odds)}</strong></div>
        <div class="small muted" style="letter-spacing:.07em;margin-top:1px">${esc(marketLabel(l))}${l.status !== 'pending' ? ' · ' + esc(l.status.toUpperCase()) : ''}</div>
        ${l.selection !== shortPick(l) ? `<div class="small muted">${esc(l.selection)}</div>` : ''}
        ${prop ? (prop.available ? `<div class="small" style="margin-top:5px"><strong>${esc(prop.display || '')}</strong>${prop.progress !== null ? `<div class="propbar"><div style="width:${prop.progress}%"></div></div>` : ''}<span class="muted">${esc(prop.remaining || '')}</span></div>` : `<div class="small muted" style="margin-top:5px">${esc(prop.statusText || '')}</div>`) : ''}
      </div>`;
    }).join('');
    const blockOpen = state.expandedBlocks.has(blockId);
    return `<div style="border-top:1px solid var(--line);margin-top:4px">
      ${legsHtml}
      ${stripHTML(g)}
      <button class="btn secondary small" style="margin-top:8px" onclick="toggleGameBlock('${blockId}')">${blockOpen ? 'Hide game detail ▾' : 'Game detail — plays, stats, scoring ▸'}</button>
      ${blockOpen ? `
      ${linescoreHTML(detail)}
      ${situationHTML(g.game, detail)}
      ${winProbHTML(detail && detail.winProbHome !== null && detail.winProbHome !== undefined ? { winProbHome: detail.winProbHome, home: g.game ? g.game.home : {}, away: g.game ? g.game.away : {} } : g.game)}
      <div class="row" style="margin-top:8px">${gameAlertToggleHTML(t.id, g.eventId, g.league)}</div>
      ${detailTabsHTML(blockId, g.league, g.eventId)}` : ''}
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="row between">
      <span class="row" style="gap:8px"><span class="hr-badge">${t.legs.length > 1 ? 'PARLAY' : 'SINGLE'}</span><strong>${esc(title)}</strong></span>
      <strong class="hr-combined">${fmtOdds(t.combinedOdds)}</strong>
    </div>
    <div class="small muted hr-summary">${esc(summary)}</div>
    <div class="row between" style="margin-top:10px">
      <div><div class="small muted">Wager</div>${isBonus ? `<span class="wager-pill">${fmtMoney(t.stake)} BONUS</span>` : `<strong>${fmtMoney(t.stake)}</strong>`}</div>
      <div style="text-align:right"><div class="small muted">Payout</div><strong>${fmtMoney(t.boostedPayout || t.potentialPayout)}</strong></div>
    </div>
    ${settled ? `<div style="margin-top:8px">${settled}</div>` : ''}
    <div class="row between" style="margin-top:8px">
      <span class="small muted">${t.externalRef ? 'ID: ' + esc(t.externalRef) : esc(fmtDateTime(t.createdAt))}${t.source === 'morning' ? ' · Morning ticket' : ''}${t.source === 'screenshot' ? ' · From screenshot' : ''}</span>
    </div>
    <button class="hr-toggle" onclick="toggleTicketSelections(${t.id})">${expanded ? 'Hide selections ▴' : 'Show selections ▾'}</button>
    ${body}
    <div class="row wrap" style="margin-top:10px">
      <button class="btn secondary small" onclick="toggleTicketAlerts(${t.id}, ${ticketOff ? 'true' : 'false'})">🔔 Ticket alerts ${ticketOff ? 'off' : 'on'}</button>
      <button class="btn secondary small" onclick="postToCommunity(${t.id})">Post to Community</button>
      <button class="btn danger small" onclick="deleteTicket(${t.id}, this)">Delete</button>
    </div>
    ${t.notes ? `<div class="small muted" style="margin-top:10px">${esc(t.notes)}</div>` : ''}${t.hasImage ? `<img class="ticket-img" src="/api/tickets/${t.id}/image" alt="Ticket screenshot">` : ''}
  </div>`;
}
function ticketIsSettledBucket(t) {
  // Spec (video): settled tickets move to Settled 12 hours after their verified result.
  if (t.status === 'open' || !t.settledAt) return false;
  return Date.now() - new Date(t.settledAt).getTime() >= 12 * 3600 * 1000;
}
function filteredTickets() {
  if (!state.expandedTickets) state.expandedTickets = new Set();
  return state.tickets.filter((t) => state.ticketSeg === 'settled' ? ticketIsSettledBucket(t) : !ticketIsSettledBucket(t));
}
async function renderTickets() {
  const el = $('#view-tickets');
  if (!state.user) { el.innerHTML = signInPromptHTML('Sign in to add tickets and sweat them live, play by play.'); return; }
  el.innerHTML = `<div class="row" style="gap:10px;align-items:center">
      <button class="add-ticket-big" onclick="openAddTicket()"><span class="plus">+</span><span>Add Ticket</span></button>
      <button class="share-sq" onclick="openShareSheet()" aria-label="Share a ticket">⬆</button></div>
    <div class="seg-wrap"><div class="seg">
      <button class="${state.ticketSeg === 'current' ? 'on' : ''}" onclick="setTicketSeg('current')">Current</button>
      <button class="${state.ticketSeg === 'settled' ? 'on' : ''}" onclick="setTicketSeg('settled')">Settled</button>
    </div><button class="icon-btn" style="width:38px;height:38px;font-size:16px;flex:none" onclick="renderTickets()" aria-label="Refresh tickets">⟳</button></div>
    <div class="small muted">Settled tickets move to Settled 12 hours after their verified result.</div>
    <div id="tickets-list"><div class="empty">Loading…</div></div>`;
  try {
    await loadTickets();
    renderHomeTabs();
    renderTicketsLight();
    state.propCache = state.propCache || {};
    for (const t of state.tickets.filter((x) => x.status === 'open')) {
      api('GET', `/api/props?ticketId=${t.id}`).then((d) => { state.propCache[t.id] = d.props || []; if (state.view === 'home') renderTicketsLight(); }).catch(() => {});
    }
  } catch (e) {
    const l = $('#tickets-list'); if (l) l.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function renderTicketsLight() {
  const list = $('#tickets-list');
  if (!list) return;
  // Keep the segmented control's active state in sync after light re-renders.
  $$('#view-tickets .seg button').forEach((b) => b.classList.toggle('on', b.textContent.trim().toLowerCase() === state.ticketSeg));
  const vis = filteredTickets();
  list.innerHTML = vis.length ? vis.map(ticketCardHTML).join('') : `<div class="dashed-empty">${state.ticketSeg === 'settled' ? 'Nothing settled yet — settled tickets land here 12 hours after their verified result.' : 'No current tickets.<br>Tap + Add Ticket to sweat your first one.'}</div>`;
  if (state.expandedTickets) for (const t of vis) if (state.expandedTickets.has(t.id)) for (const g of groupLegsByGame(t)) if (g.eventId) ensureDetail(g.league, g.eventId);
}
function setTicketSeg(seg) { state.ticketSeg = seg; renderTicketsLight(); }
async function deleteTicket(id, btn) {
  if (!armButton(btn, 'Tap again to DELETE')) return;
  try {
    await api('DELETE', `/api/tickets/${id}`);
    state.tickets = state.tickets.filter((t) => t.id !== id);
    render();
    showToast('Ticket deleted.');
  } catch (e) { showToast('Delete failed: ' + e.message); }
}
async function postToCommunity(id) {
  try { await api('POST', '/api/community/ticket', { ticketId: id }); showToast('Posted to Community.'); showView('community'); }
  catch (e) { showToast(e.message); }
}

/* ================= ADD TICKET ================= */
let pendingImageDataUrl = null;
let pendingOcrText = '';
function openSheet(html) { $('#sheet-root').innerHTML = `<div class="sheet-back" onclick="if(event.target===this)closeSheet()"><div class="sheet">${html}</div></div>`; }
function closeSheet() { $('#sheet-root').innerHTML = ''; pendingImageDataUrl = null; pendingOcrText = ''; }
function legRowHTML(leg) {
  leg = leg || {};
  const leagueOpts = LEAGUES.map((l) => `<option ${leg.league === l ? 'selected' : ''}>${l}</option>`).join('');
  const markets = ['Moneyline', 'Spread', 'Total', 'Player Prop', 'Team Total'];
  const marketOpts = markets.map((m) => `<option ${leg.market === m ? 'selected' : ''}>${m}</option>`).join('');
  return `<div class="leg-form card tight">
    <div class="grid2">
      <div><label>League</label><select class="lf-league">${leagueOpts}</select></div>
      <div><label>Market</label><select class="lf-market">${marketOpts}</select></div>
    </div>
    <div><label>Matchup (Away @ Home)</label><input class="lf-game" placeholder="Jets @ Red Wings" value="${esc(leg.gameLabel || '')}"></div>
    <div><label>Selection (team, or player + stat for props)</label><input class="lf-selection" placeholder="Jets — or — Justin Jefferson Over 55.5 Receiving Yards" value="${esc(leg.selection || '')}"></div>
    <div class="grid3">
      <div><label>Line</label><input class="lf-line" placeholder="-3.5 / Over 5.5" value="${esc(leg.line || '')}"></div>
      <div><label>Odds</label><input class="lf-odds" type="number" placeholder="-110" value="${esc(leg.odds ?? '')}"></div>
      <div><label>Starts (optional)</label><input class="lf-starts" type="datetime-local" value="${esc(leg.startsAt || '')}"></div>
    </div>
    <button class="btn danger small" style="margin-top:8px" onclick="this.closest('.leg-form').remove()">Remove leg</button>
  </div>`;
}
function openAddTicket() {
  if (!state.user) { showView('account'); return; }
  const book = (state.settings && state.settings.defaultBook) || 'Hard Rock Bet';
  openSheet(`<h3>Add Ticket</h3>
    <div class="tabs" style="margin:0 0 6px">
      <button class="on" id="tab-shot" onclick="addTicketTab('shot')">📷 Screenshot</button>
      <button id="tab-type" onclick="addTicketTab('type')">⌨️ Type it in</button>
    </div>
    <div id="shot-pane">
      <p class="small muted">Pick your ticket screenshot. Best effort: we'll try to read it (OCR runs in your browser) and prefill the review form below — <strong>you always review and fix the legs before saving</strong>. If the read fails, the screenshot still attaches and you type the legs.</p>
      <input type="file" id="ticket-file" accept="image/*">
      <img id="ticket-preview" class="ticket-img" style="display:none">
      <div id="ocr-status" class="small muted" style="margin-top:6px"></div>
    </div>
    <div id="type-pane" hidden><p class="small muted">Type the ticket in — the legs below are the review form for both ways in.</p></div>
    <div class="grid2">
      <div><label>Sportsbook</label><input id="tf-book" value="${esc(book)}"></div>
      <div><label>Stake ($)</label><input id="tf-stake" type="number" step="0.01" min="0" placeholder="5.00"></div>
    </div>
    <div><label>Ticket title (optional)</label><input id="tf-title" placeholder="e.g. Sunday 5-leg"></div>
    <div><label>Notes (boost info, etc.)</label><textarea id="tf-notes" rows="2" placeholder="e.g. 25% Profit Boost, Boosted Payout $100.07"></textarea></div>
    <label>Boosted payout ($) — optional, overrides the math if the ticket wins</label>
    <input id="tf-boosted" type="number" step="0.01" min="0" placeholder="">
    <label>Combined odds — optional (for an SGP / same-game parlay, where the book shows one price for the whole ticket)</label>
    <input id="tf-combined" type="text" placeholder="e.g. +505">
    <h3 style="margin-top:16px">Legs — review before saving</h3>
    <div id="legs-wrap">${legRowHTML()}</div>
    <button class="btn secondary small" onclick="addLegRow()">+ Add leg</button>
    <div class="row" style="margin-top:16px">
      <button class="btn" onclick="saveTicket()">Save ticket</button>
      <button class="btn secondary" onclick="closeSheet()">Cancel</button>
    </div>
    <div id="tf-error"></div>`);
  const fileInput = $('#ticket-file');
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      // Downscale + re-encode to JPEG before OCR/upload: full-res phone screenshots
      // are multi-MB PNGs that make the attach step slow and fragile on cellular.
      pendingImageDataUrl = await downscaleImage(reader.result).catch(() => reader.result);
      const img = $('#ticket-preview'); img.src = pendingImageDataUrl; img.style.display = 'block';
      // OCR reads the ORIGINAL full-resolution image. The downscaled copy is
      // only for the attach/upload — reading it chopped digits off the odds
      // (a 2436px-tall screenshot shrank to 1280px and -185 came back as -18).
      runOcr(reader.result);
    };
    reader.readAsDataURL(f);
  });
}
function downscaleImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1 && String(dataUrl).startsWith('data:image/jpeg')) return resolve(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
function addTicketTab(which) {
  $('#tab-shot').classList.toggle('on', which === 'shot');
  $('#tab-type').classList.toggle('on', which === 'type');
  $('#shot-pane').hidden = which !== 'shot';
  $('#type-pane').hidden = which !== 'type';
}
function addLegRow(leg) {
  const wrap = $('#legs-wrap');
  wrap.insertAdjacentHTML('beforeend', legRowHTML(leg));
}
/* ---- Hard Rock slip parser: turns OCR text into leg rows (review-first) ---- */
const TEAM_BOOK = [
  // NFL
  ['Cardinals','Arizona Cardinals','NFL'],['Falcons','Atlanta Falcons','NFL'],['Ravens','Baltimore Ravens','NFL'],['Bills','Buffalo Bills','NFL'],['Panthers','Carolina Panthers','NFL'],['Bears','Chicago Bears','NFL'],['Bengals','Cincinnati Bengals','NFL'],['Browns','Cleveland Browns','NFL'],['Cowboys','Dallas Cowboys','NFL'],['Broncos','Denver Broncos','NFL'],['Lions','Detroit Lions','NFL'],['Packers','Green Bay Packers','NFL'],['Texans','Houston Texans','NFL'],['Colts','Indianapolis Colts','NFL'],['Jaguars','Jacksonville Jaguars','NFL'],['Chiefs','Kansas City Chiefs','NFL'],['Raiders','Las Vegas Raiders','NFL'],['Chargers','Los Angeles Chargers','NFL'],['Rams','Los Angeles Rams','NFL'],['Dolphins','Miami Dolphins','NFL'],['Vikings','Minnesota Vikings','NFL'],['Patriots','New England Patriots','NFL'],['Saints','New Orleans Saints','NFL'],['Giants','New York Giants','NFL'],['Jets','New York Jets','NFL'],['Eagles','Philadelphia Eagles','NFL'],['Steelers','Pittsburgh Steelers','NFL'],['49ers','San Francisco 49ers','NFL'],['Seahawks','Seattle Seahawks','NFL'],['Buccaneers','Tampa Bay Buccaneers','NFL'],['Titans','Tennessee Titans','NFL'],['Commanders','Washington Commanders','NFL'],
  // MLB
  ['Diamondbacks','Arizona Diamondbacks','MLB'],['Braves','Atlanta Braves','MLB'],['Orioles','Baltimore Orioles','MLB'],['Red Sox','Boston Red Sox','MLB'],['Cubs','Chicago Cubs','MLB'],['White Sox','Chicago White Sox','MLB'],['Reds','Cincinnati Reds','MLB'],['Guardians','Cleveland Guardians','MLB'],['Rockies','Colorado Rockies','MLB'],['Tigers','Detroit Tigers','MLB'],['Astros','Houston Astros','MLB'],['Royals','Kansas City Royals','MLB'],['Angels','Los Angeles Angels','MLB'],['Dodgers','Los Angeles Dodgers','MLB'],['Marlins','Miami Marlins','MLB'],['Brewers','Milwaukee Brewers','MLB'],['Twins','Minnesota Twins','MLB'],['Mets','New York Mets','MLB'],['Yankees','New York Yankees','MLB'],['Athletics','Athletics','MLB'],['Phillies','Philadelphia Phillies','MLB'],['Pirates','Pittsburgh Pirates','MLB'],['Padres','San Diego Padres','MLB'],['Giants','San Francisco Giants','MLB'],['Mariners','Seattle Mariners','MLB'],['Cardinals','St. Louis Cardinals','MLB'],['Rays','Tampa Bay Rays','MLB'],['Rangers','Texas Rangers','MLB'],['Blue Jays','Toronto Blue Jays','MLB'],['Nationals','Washington Nationals','MLB'],
  // NHL
  ['Ducks','Anaheim Ducks','NHL'],['Bruins','Boston Bruins','NHL'],['Sabres','Buffalo Sabres','NHL'],['Flames','Calgary Flames','NHL'],['Hurricanes','Carolina Hurricanes','NHL'],['Blackhawks','Chicago Blackhawks','NHL'],['Avalanche','Colorado Avalanche','NHL'],['Blue Jackets','Columbus Blue Jackets','NHL'],['Stars','Dallas Stars','NHL'],['Red Wings','Detroit Red Wings','NHL'],['Oilers','Edmonton Oilers','NHL'],['Panthers','Florida Panthers','NHL'],['Kings','Los Angeles Kings','NHL'],['Wild','Minnesota Wild','NHL'],['Canadiens','Montreal Canadiens','NHL'],['Predators','Nashville Predators','NHL'],['Devils','New Jersey Devils','NHL'],['Islanders','New York Islanders','NHL'],['Rangers','New York Rangers','NHL'],['Senators','Ottawa Senators','NHL'],['Flyers','Philadelphia Flyers','NHL'],['Penguins','Pittsburgh Penguins','NHL'],['Sharks','San Jose Sharks','NHL'],['Kraken','Seattle Kraken','NHL'],['Blues','St. Louis Blues','NHL'],['Lightning','Tampa Bay Lightning','NHL'],['Maple Leafs','Toronto Maple Leafs','NHL'],['Mammoth','Utah Mammoth','NHL'],['Canucks','Vancouver Canucks','NHL'],['Golden Knights','Vegas Golden Knights','NHL'],['Capitals','Washington Capitals','NHL'],['Jets','Winnipeg Jets','NHL'],
  // NBA
  ['Hawks','Atlanta Hawks','NBA'],['Celtics','Boston Celtics','NBA'],['Nets','Brooklyn Nets','NBA'],['Hornets','Charlotte Hornets','NBA'],['Bulls','Chicago Bulls','NBA'],['Cavaliers','Cleveland Cavaliers','NBA'],['Mavericks','Dallas Mavericks','NBA'],['Nuggets','Denver Nuggets','NBA'],['Pistons','Detroit Pistons','NBA'],['Warriors','Golden State Warriors','NBA'],['Rockets','Houston Rockets','NBA'],['Pacers','Indiana Pacers','NBA'],['Clippers','Los Angeles Clippers','NBA'],['Lakers','Los Angeles Lakers','NBA'],['Grizzlies','Memphis Grizzlies','NBA'],['Heat','Miami Heat','NBA'],['Bucks','Milwaukee Bucks','NBA'],['Timberwolves','Minnesota Timberwolves','NBA'],['Pelicans','New Orleans Pelicans','NBA'],['Knicks','New York Knicks','NBA'],['Thunder','Oklahoma City Thunder','NBA'],['Magic','Orlando Magic','NBA'],['76ers','Philadelphia 76ers','NBA'],['Suns','Phoenix Suns','NBA'],['Trail Blazers','Portland Trail Blazers','NBA'],['Kings','Sacramento Kings','NBA'],['Spurs','San Antonio Spurs','NBA'],['Raptors','Toronto Raptors','NBA'],['Jazz','Utah Jazz','NBA'],['Wizards','Washington Wizards','NBA'],
  ['Atlanta United','Atlanta United FC','MLS'],['Austin FC','Austin FC','MLS'],['Charlotte FC','Charlotte FC','MLS'],['Chicago Fire','Chicago Fire FC','MLS'],['FC Cincinnati','FC Cincinnati','MLS'],['Colorado Rapids','Colorado Rapids','MLS'],['Columbus Crew','Columbus Crew','MLS'],['D.C. United','D.C. United','MLS'],['FC Dallas','FC Dallas','MLS'],['Houston Dynamo','Houston Dynamo FC','MLS'],['Inter Miami','Inter Miami CF','MLS'],['LA Galaxy','LA Galaxy','MLS'],['Los Angeles FC','Los Angeles FC','MLS'],['Minnesota United','Minnesota United FC','MLS'],['CF Montreal','CF Montréal','MLS'],['Nashville SC','Nashville SC','MLS'],['New England Revolution','New England Revolution','MLS'],['New York City FC','New York City FC','MLS'],['Red Bulls','New York Red Bulls','MLS'],['Orlando City','Orlando City SC','MLS'],['Philadelphia Union','Philadelphia Union','MLS'],['Portland Timbers','Portland Timbers','MLS'],['Real Salt Lake','Real Salt Lake','MLS'],['Earthquakes','San Jose Earthquakes','MLS'],['Sounders','Seattle Sounders FC','MLS'],['Sporting Kansas City','Sporting Kansas City','MLS'],['St. Louis City','St. Louis CITY SC','MLS'],['Toronto FC','Toronto FC','MLS'],['Whitecaps','Vancouver Whitecaps FC','MLS'],['San Diego FC','San Diego FC','MLS'],
];
const COLLEGE_TOKENS = ['UTSA','South Florida','UCF','FAU','FIU','Miami','Florida State','Florida','Georgia','Alabama','Texas','Ohio State','Michigan','LSU','Tennessee','Oklahoma','Notre Dame','Clemson','Penn State','Oregon','USC','UCLA','Auburn','Texas A&M','Ole Miss','Arkansas','Kentucky','South Carolina','Mississippi State','Vanderbilt','Missouri','Iowa','Wisconsin','Nebraska','Illinois','Indiana','Purdue','Michigan State','Rutgers','Maryland','Northwestern','Minnesota','Washington','Utah','Arizona','Arizona State','Colorado','BYU','Kansas','Kansas State','Iowa State','TCU','Baylor','Texas Tech','Houston','Cincinnati','West Virginia','Oklahoma State','Syracuse','Pittsburgh','Louisville','NC State','Duke','North Carolina','Virginia','Virginia Tech','Georgia Tech','Wake Forest','Boston College','Stanford','California','SMU','Memphis','Tulane','Boise State','Fresno State','San Diego State','UNLV','Air Force','Army','Navy','Liberty','App State','Coastal Carolina','Marshall','Troy','Louisiana','Georgia Southern','Old Dominion','Western Kentucky','Middle Tennessee','UTEP','New Mexico State','Sam Houston','Jacksonville State','Kennesaw State','Delaware','Missouri State'];
function lookupTeam(name) {
  const n = (name || '').trim();
  if (!n) return null;
  // A matchup string ("A vs B" / "A @ B") is never a single team — without this
  // guard, "Nashville SC vs Sporting Kansas" college-matched on the word Kansas.
  if (/\s+vs\s+/i.test(n) || n.includes('@')) return null;
  // an exact full-name match always wins ("Winnipeg Jets" is the NHL team,
  // not the NFL's Jets — both share the nickname and the old rule kept the first)
  for (const [nick, full, league] of TEAM_BOOK) if (n === full) return { full, league };
  // exact full-name or nickname match, longest nickname wins
  let best = null;
  for (const [nick, full, league] of TEAM_BOOK) {
    if (n === full || n === nick || n.endsWith(' ' + nick) || n.endsWith(nick)) {
      if (!best || nick.length > best[0].length) best = [nick, full, league];
    }
  }
  if (best) return { full: best[1], league: best[2] };
  if (COLLEGE_TOKENS.some((c) => n === c || n.startsWith(c + ' ') || n.endsWith(' ' + c))) return { full: n, league: 'NCAAF' };
  return null;
}
function parseStartTime(text) {
  const tm = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!tm) return '';
  let h = parseInt(tm[1], 10);
  const ap = tm[3].toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/tomorrow/i.test(text)) d.setDate(d.getDate() + 1);
  const md = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
  if (md) { const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }; d.setMonth(months[md[1].slice(0,3).toLowerCase()]); d.setDate(parseInt(md[2], 10)); }
  const p2 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${tm[2]}`;
}
function titleCaseName(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}
function expandMatchup(label) {
  // "Away @ Home", or Hard Rock My Bets' "Home vs Away" -> { gameLabel, league }
  let away = '', home = '';
  if (label.includes('@')) { const p = label.split('@'); away = (p[0] || '').trim(); home = (p[1] || '').trim(); }
  else { const vm = label.match(/^(.+?)\s+vs\.?\s+(.+)$/i); if (!vm) return null; home = vm[1].trim(); away = vm[2].trim(); }
  if (!away || !home) return null;
  const ta = lookupTeam(away), th = lookupTeam(home);
  if (!ta && !th && /[&•|]/.test(label)) return null; // OCR junk line, not a matchup
  return { gameLabel: `${ta ? ta.full : away} @ ${th ? th.full : home}`, league: (ta && ta.league) || (th && th.league) || '' };
}
function marketFromLine(L, cur) {
  if (/^to win$/i.test(L) || /moneyline/i.test(L) || /game result/i.test(L)) return 'Moneyline';
  if (/anytime goalscorer|anytime goal scorer/i.test(L)) return 'Player Prop';
  if (/spread/i.test(L)) return 'Spread';
  if (/^(over|under|total)/i.test(L)) return 'Total';
  if (/-\s*(strikeouts|points|rebounds|assists|steals|blocks|shots on goal|saves|passing yards|rushing yards|receiving yards)\s*$/i.test(L)) return 'Player Prop';
  return cur;
}
function parseSlipText(raw) {
  const lines = raw.split('\n').map((s) => s.replace(/^[^A-Za-z0-9+$-]+/, '').trim()).filter(Boolean);
  const legs = [];
  const oddsAtEnd = /^(.+?)\s+([+-]\d{3,4})$/;
  const oddsOnly = /^([+-]\d{3,4})$/;
  const isHeader = (t) => /parlay|payout|wager|hide selections|track on lock|my bets/i.test(t);
  const consumed = new Set();
  let combinedOdds = 0;

  // --- SGP blocks (Hard Rock My Bets): a header line "Team @ Team +505" whose
  // legs carry NO individual odds — the sub-legs follow as bare lines.
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(oddsAtEnd);
    if (!hm || !hm[1].includes('@')) continue;
    const subs = [];
    let startsAt = '', timeIdx = -1;
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const L = lines[j];
      if (oddsAtEnd.test(L) || oddsOnly.test(L)) break;
      if (/:\d{2}\s*(am|pm)/i.test(L)) { startsAt = parseStartTime(L); timeIdx = j; continue; }
      const ou = L.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
      if (ou) { subs.push({ kind: 'ou', dir: ou[1], line: ou[2], idx: j }); continue; }
      const pm = L.match(/^(.+?)\s+-\s+([A-Za-z][A-Za-z ]*)$/);
      if (pm && subs.length && subs[subs.length - 1].kind === 'ou' && !subs[subs.length - 1].player) { subs[subs.length - 1].player = pm[1].trim(); subs[subs.length - 1].stat = pm[2].trim(); continue; }
      if (/^to win$/i.test(L)) { subs.push({ kind: 'towin', idx: j }); continue; }
      if (/^[A-Za-z][A-Za-z .']{1,40}$/.test(L) && !/go to event|super sub|enabled/i.test(L)) subs.push({ kind: 'team', text: L, idx: j });
    }
    const ouLegs = subs.filter((s) => s.kind === 'ou' && s.player);
    const teamSubs = subs.filter((s) => s.kind === 'team');
    if (ouLegs.length + teamSubs.length < 2) continue; // not really an SGP block
    const cleanHeader = hm[1].replace(/^[^A-Za-z]+/, '');
    const mm = expandMatchup(cleanHeader);
    const gameLabel = mm ? mm.gameLabel : cleanHeader;
    const league = mm ? mm.league : '';
    combinedOdds = parseInt(hm[2], 10);
    for (const s of subs) {
      if (s.kind === 'ou' && s.player) {
        legs.push({ league, market: 'Player Prop', gameLabel, selection: `${titleCaseName(s.player)} ${s.dir.toLowerCase() === 'over' ? 'Over' : 'Under'} ${s.line} ${titleCaseName(s.stat)}`, line: s.line, odds: '', startsAt });
      } else if (s.kind === 'team') {
        const t = lookupTeam(s.text);
        legs.push({ league: (t && t.league) || league, market: 'Moneyline', gameLabel, selection: t ? t.full : titleCaseName(s.text), line: '', odds: '', startsAt });
      }
    }
    consumed.add(i);
    subs.forEach((s) => consumed.add(s.idx));
    if (timeIdx >= 0) consumed.add(timeIdx);
  }

  // --- main pass: one selection line carrying its odds at the end
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    let selText = null, odds = null;
    let m = lines[i].match(oddsAtEnd);
    if (m && !isHeader(m[1])) { selText = m[1].trim(); odds = parseInt(m[2], 10); }
    else if (oddsOnly.test(lines[i]) && i > 0 && !consumed.has(i - 1) && !oddsAtEnd.test(lines[i - 1])) { selText = lines[i - 1]; odds = parseInt(lines[i], 10); }
    if (selText === null || odds === null || Number.isNaN(odds)) continue;
    if (/^\d+\s*-?\s*bet/i.test(selText)) continue;
    if (selText.includes('@')) continue; // a matchup/header line, not a selection
    // gather context from the next few lines (stop at the next leg)
    let market = '', gameLabel = '', startsAt = '', propLabel = '';
    const ctx = [];
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const L = lines[j];
      if (oddsAtEnd.test(L) || oddsOnly.test(L)) break;
      ctx.push(L);
      market = marketFromLine(L, market);
      if (/anytime goalscorer|anytime goal scorer/i.test(L)) propLabel = L;
      if (L.includes('@') || /\s+vs\s+/i.test(L)) { const mm = expandMatchup(L); if (mm && !gameLabel) gameLabel = mm.gameLabel; }
      if (/:\d{2}\s*(am|pm)/i.test(L)) startsAt = parseStartTime(L);
    }
    if (/anytime goalscorer|anytime goal scorer/i.test(selText)) market = 'Player Prop';
    if (!market && !gameLabel) continue; // not a leg block — likely the parlay header
    // split a trailing spread/total line off the selection ("UTSA -6.5", "Over 47.5")
    let line = '';
    const lm = selText.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)$/);
    if (lm) { selText = lm[1].trim(); line = lm[2]; if (!market) market = /^(over|under)$/i.test(selText) ? 'Total' : 'Spread'; }
    if (!market) market = 'Moneyline';
    const selTeam = lookupTeam(selText);
    let selection = selText;
    if (selTeam) selection = selTeam.full;
    if (market === 'Moneyline' && selTeam) selection = selTeam.full + ' ML';
    if (market === 'Spread' && line) selection = selection + ' ' + line;
    if (market === 'Total' && line) selection = selText + ' ' + line;
    if (market === 'Player Prop' && propLabel) selection = titleCaseName(propLabel);
    // expand matchup team names / resolve the league
    let league = selTeam ? selTeam.league : '';
    if (!league && gameLabel.includes('@')) {
      const [a, b] = gameLabel.split('@').map((s) => s.trim());
      const ta = lookupTeam(a), tb = lookupTeam(b);
      league = (ta && ta.league) || (tb && tb.league) || '';
    }
    if (!league && market === 'Player Prop' && /goalscorer|goal scorer/i.test(ctx.join(' '))) league = 'MLS';
    legs.push({ league: league || 'NFL', market, gameLabel, selection, line, odds, startsAt });
  }

  // --- salvage pass: a leg whose odds OCR garbled still shows up with a blank
  // odds box for review instead of vanishing. Context NEVER crosses the next
  // odds-bearing line — crossing it stitched two different legs together.
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const L = lines[i];
    if (L.includes('@') || /\s+vs\s+/i.test(L) || oddsAtEnd.test(L) || oddsOnly.test(L) || isHeader(L)) continue;
    const words = L.split(/\s+/);
    let team = null;
    for (let k = words.length; k >= 1; k--) { const t = lookupTeam(words.slice(0, k).join(' ')); if (t) { team = t; break; } }
    if (!team) continue;
    if (legs.some((l) => l.selection.startsWith(team.full))) continue;
    let market = '', gameLabel = '', startsAt = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const X = lines[j];
      if (oddsAtEnd.test(X) || oddsOnly.test(X)) break;
      market = marketFromLine(X, market);
      if (X.includes('@') || /\s+vs\s+/i.test(X)) { const mm = expandMatchup(X); if (mm && !gameLabel) gameLabel = mm.gameLabel; }
      if (/:\d{2}\s*(am|pm)/i.test(X)) startsAt = parseStartTime(X);
    }
    if (market && gameLabel) legs.push({ league: team.league, market, gameLabel, selection: market === 'Moneyline' ? team.full + ' ML' : team.full, line: '', odds: '', startsAt });
  }

  // stake: prefer the amount near "Wager"; ignore $0.00 and nav-bar amounts
  let stake = '';
  const wm = raw.match(/Wager[\s\S]{0,60}?\$\s?(\d+(?:\.\d{2})?)/i);
  if (wm && parseFloat(wm[1]) > 0) stake = wm[1];
  if (!stake) for (const L of lines) { if (/payout|my bets|rewards|games/i.test(L)) continue; const sm = L.match(/\$\s?(\d+(?:\.\d{2})?)/); if (sm && parseFloat(sm[1]) > 0) { stake = sm[1]; break; } }
  const idm = raw.match(/ID:?\s*(\d{8,})/i);
  const cm = raw.match(/(\d+)\s*-?\s*Bet Parlay/i);
  return { legs, stake, slipId: idm ? idm[1] : '', expectedLegs: cm ? parseInt(cm[1], 10) : 0, combinedOdds };
}
function makeInvertedDataUrl(dataUrl) {
  // Second OCR opinion for dark screenshots: white-on-black text inverted to
  // black-on-white, which Tesseract often reads more cleanly.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        for (let k = 0; k < px.length; k += 4) { px[k] = 255 - px[k]; px[k + 1] = 255 - px[k + 1]; px[k + 2] = 255 - px[k + 2]; }
        g.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
async function runOcr(dataUrl) {
  const status = $('#ocr-status');
  if (!window.Tesseract) { status.textContent = 'OCR is unavailable right now — the screenshot will attach; type the legs below.'; return; }
  status.textContent = 'Reading your ticket…';
  try {
    // Two passes — the screenshot as-is, then inverted — keeping whichever
    // parse finds more legs (ties: more legs carrying real odds).
    const passes = [dataUrl];
    const inverted = await makeInvertedDataUrl(dataUrl).catch(() => null);
    if (inverted) passes.push(inverted);
    let best = null;
    for (const p of passes) {
      try {
        const { data } = await Tesseract.recognize(p, 'eng');
        const parsed = parseSlipText(data.text || '');
        const score = parsed.legs.length * 10 + parsed.legs.filter((l) => l.odds !== '' && l.odds !== null && l.odds !== undefined).length;
        if (!best || score > best.score) best = { score, parsed, text: data.text || '' };
      } catch { /* fall through to the next pass */ }
    }
    if (!best) throw new Error('OCR failed on every pass');
    pendingOcrText = best.text;
    const parsed = best.parsed;
    if (parsed.stake && !$('#tf-stake').value) $('#tf-stake').value = parsed.stake;
    const notes = $('#tf-notes');
    if (parsed.legs.length) {
      $('#legs-wrap').innerHTML = '';
      parsed.legs.forEach((leg) => addLegRow(leg));
      if (parsed.slipId && !notes.value) notes.value = `Hard Rock Bet slip ${parsed.slipId}`;
      let sgpNote = '';
      if (parsed.combinedOdds) {
        const combEl = $('#tf-combined');
        if (combEl && !combEl.value) combEl.value = parsed.combinedOdds > 0 ? `+${parsed.combinedOdds}` : `${parsed.combinedOdds}`;
        sgpNote = ` This looks like an SGP — combined odds ${parsed.combinedOdds > 0 ? '+' : ''}${parsed.combinedOdds} filled in below; its legs share that one price.`;
      }
      const missing = parsed.expectedLegs && parsed.expectedLegs > parsed.legs.length ? parsed.expectedLegs - parsed.legs.length : 0;
      status.textContent = (missing
        ? `Read ${parsed.legs.length} of ${parsed.expectedLegs} legs — ${missing} didn't read cleanly. Check each leg below, fill in any blank odds, and fix anything wrong before saving.`
        : `Read ${parsed.legs.length} leg${parsed.legs.length > 1 ? 's' : ''} from your screenshot — check each one below and fix anything wrong before saving.`) + sgpNote;
    } else {
      if (!notes.value) notes.value = pendingOcrText.slice(0, 400);
      status.textContent = 'Read finished, but no legs could be picked out — the raw text was added to Notes. Type the legs below; the screenshot still attaches.';
    }
  } catch {
    status.textContent = 'Could not read this screenshot — it will still attach; type the legs below.';
  }
}
async function saveTicket() {
  const err = $('#tf-error');
  const legs = $$('.leg-form').map((row) => ({
    league: $('.lf-league', row).value, market: $('.lf-market', row).value,
    gameLabel: $('.lf-game', row).value.trim(), selection: $('.lf-selection', row).value.trim(),
    line: $('.lf-line', row).value.trim(), odds: parseInt($('.lf-odds', row).value, 10),
    startsAt: $('.lf-starts', row).value || '',
  })).filter((l) => l.selection);
  if (!legs.length) { err.innerHTML = '<div class="err" style="margin-top:10px">Add at least one leg with a selection.</div>'; return; }
  // SGP exception: when the ticket carries one combined price, legs may leave
  // their own odds blank (the book never showed them) — they store at the
  // default, and the combined price is the one the ticket displays.
  const combinedVal = parseInt(($('#tf-combined') ? $('#tf-combined').value : '').replace('+', ''), 10);
  const hasCombined = !Number.isNaN(combinedVal) && combinedVal !== 0 && Math.abs(combinedVal) >= 100;
  for (const l of legs) if (Number.isNaN(l.odds) && !hasCombined) { err.innerHTML = '<div class="err" style="margin-top:10px">Every leg needs American odds (like -110 or +150) — or set the ticket\'s combined odds for an SGP.</div>'; return; }
  for (const l of legs) if (Number.isNaN(l.odds)) l.odds = null;
  try {
    const d = await api('POST', '/api/tickets', {
      title: $('#tf-title').value.trim(), sportsbook: $('#tf-book').value.trim() || 'Hard Rock Bet',
      stake: parseFloat($('#tf-stake').value) || 0, notes: $('#tf-notes').value.trim(),
      boostedPayout: parseFloat($('#tf-boosted').value) || null,
      combinedOdds: hasCombined ? combinedVal : null,
      source: pendingImageDataUrl ? 'screenshot' : 'manual', legs,
    });
    let imageFailed = false;
    if (pendingImageDataUrl) {
      // The ticket is already saved at this point — a failed photo attach must
      // never make the save look failed. Attach best-effort, then close either way.
      try { await api('POST', `/api/tickets/${d.ticket.id}/image`, { dataUrl: pendingImageDataUrl }); }
      catch { imageFailed = true; }
    }
    closeSheet();
    await loadTickets();
    showView('tickets');
    if (imageFailed) showToast('Ticket saved — but the screenshot could not be attached. The ticket itself is in your list.');
  } catch (e) { err.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}

/* ================= SCORES ================= */
async function renderScores() {
  const el = $('#view-scores');
  const pillLabel = (l) => l === 'ALL' ? 'All leagues' : l === 'SOCCER' ? 'Soccer' : l;
  const chips = SCORE_PILLS.map((l) => `<button class="chip ${state.scoresLeague === l ? 'on' : ''}" onclick="setScoresLeague('${l}')">${pillLabel(l)}</button>`).join('');
  const segBtn = (key, label) => `<button class="${state.scoresSeg === key ? 'on' : ''}" onclick="setScoresSeg('${key}')">${label}</button>`;
  el.innerHTML = `<div class="row between"><h2 style="margin:0">Live Scores</h2><span class="row"><span id="scores-live-count" class="live-count"></span><button class="icon-btn" style="width:38px;height:38px;font-size:16px" onclick="renderScores()" aria-label="Refresh scores">⟳</button></span></div>
    <div class="chips" style="margin-top:12px">${chips}</div>
    <div class="seg" style="margin-bottom:12px">${segBtn('live', 'Live now')}${segBtn('upcoming', 'Upcoming')}${segBtn('today', 'Today')}</div>
    <div id="your-games"></div><div id="scores-list"><div class="empty">Loading scores…</div></div>`;
  // Your games first
  if (state.user) {
    try {
      await loadTickets();
      const mine = [];
      for (const t of state.tickets.filter((x) => x.status === 'open')) {
        for (const g of groupLegsByGame(t)) if (g.game) mine.push(g);
      }
      const seen = new Set();
      const uniq = mine.filter((g) => { const k = g.game.id; if (seen.has(k)) return false; seen.add(k); return true; });
      if (uniq.length) $('#your-games').innerHTML = `<h3>Your games</h3>` + uniq.map((g) => `<div class="card tight" onclick="openGameDetail('${g.league}','${g.game.id}')" style="cursor:pointer">${gameHeaderHTML(g.game, g.league, g.gameLabel)}</div>`).join('');
    } catch { /* ignore */ }
  }
  try {
    const d = await loadScores(state.scoresLeague);
    state.scoresCache[state.scoresLeague] = d;
    const list = $('#scores-list');
    if (!list) return;
    if (d.error) { list.innerHTML = `<div class="err">${esc(d.error)}</div>`; return; }
    const liveN = d.games.filter((g) => g.state === 'in').length;
    const lc = $('#scores-live-count'); if (lc) lc.textContent = `● ${liveN} live game${liveN === 1 ? '' : 's'}`;
    const segGames = d.games.filter((g) => state.scoresSeg === 'live' ? g.state === 'in' : state.scoresSeg === 'upcoming' ? g.state === 'pre' : true);
    const grid = state.scoresLeague === 'ALL';
    const cards = segGames.map((g) => `<div class="card tight" onclick="openGameDetail('${g.league}','${g.id}')" style="cursor:pointer">${scoreCardHTML(g)}</div>`).join('');
    list.innerHTML = (segGames.length ? (grid ? `<div class="score-grid">${cards}</div>` : cards) : `<div class="card"><div class="empty">${state.scoresSeg === 'live' ? 'No live games right now.' : state.scoresSeg === 'upcoming' ? 'No upcoming games in the window.' : 'No games in the window.'}</div></div>`)
      + `<div class="small muted" style="margin-top:10px">Updated ${fmtDateTime(d.fetchedAt)}</div>`;
    // Soccer cards show goal scorers from the detail feed once it lands (ensureDetail re-renders).
    for (const g of segGames) if (isSoccerLeague(g.league) && g.state !== 'pre') ensureDetail(g.league, g.id);
  } catch (e) {
    const list = $('#scores-list'); if (list) list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function setScoresLeague(l) { state.scoresLeague = l; renderScores(); }
function setScoresSeg(s) { state.scoresSeg = s; renderScores(); }
function isSoccerLeague(l) { return l === 'MLS' || l === 'EPL' || l === 'SOCCER'; }
function scoreSort(a, b) {
  const r = (g) => g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2;
  const d = r(a) - r(b);
  if (d) return d;
  return a.state === 'post' ? String(b.start || '').localeCompare(String(a.start || '')) : String(a.start || '').localeCompare(String(b.start || ''));
}
async function loadScores(league) {
  if (SCORE_FETCH[league]) {
    const parts = await Promise.all(SCORE_FETCH[league].map((l) => api('GET', `/api/scores?league=${l}`).catch(() => ({ games: [] }))));
    return { games: parts.flatMap((x) => x.games || []).sort(scoreSort), fetchedAt: new Date().toISOString(), error: '' };
  }
  return api('GET', `/api/scores?league=${league}`);
}
function scoreCardHTML(g) {
  const winner = g.state === 'post' ? (g.home.score > g.away.score ? 'home' : g.away.score > g.home.score ? 'away' : '') : '';
  const stateTag = g.state === 'in' ? '<span class="status-live">LIVE</span>' : g.state === 'post' ? '<span class="muted">FINAL</span>' : `<span class="muted">${esc(fmtDateTime(g.start))}</span>`;
  const price = (key) => g.odds ? (key === 'away' ? g.odds.awayML : g.odds.homeML) : null;
  const teamRow = (side, key) => `<div class="team-line ${winner === key ? 'win' : ''}"><span class="row" style="gap:7px">${side.logo ? `<img src="${esc(side.logo)}" alt="" style="width:20px;height:20px;object-fit:contain" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(side.abbr)}${g.state === 'in' && g.possessionAbbr === side.abbr ? ' 👁' : ''}</span></span><span class="score">${g.state === 'pre' && price(key) ? esc(price(key)) : (side.score ?? '')}</span></div>`;
  let scorers = '';
  if (isSoccerLeague(g.league) && g.state !== 'pre') {
    const d = state.detailCache.get(String(g.id));
    if (d && d.scoringPlays && d.scoringPlays.length) scorers = d.scoringPlays.map((pl) => `<div class="scorer-line">⚽ ${esc(pl.clock || '')} ${esc(pl.teamAbbr || '')} — ${esc(String(pl.text || '').slice(0, 70))}</div>`).join('');
  }
  return `<div class="game-head"><div class="small muted">${esc(g.league)}${isSoccerLeague(g.league) ? '' : ''}</div>${stateTag}</div>
    ${teamRow(g.away, 'away')}
    ${teamRow(g.home, 'home')}
    ${scorers}
    ${g.state === 'in' && g.downDistanceText ? `<div class="small" style="color:var(--mint);font-weight:700;margin-top:4px">${esc(g.downDistanceText)}${g.possessionAbbr ? ' · ' + esc(g.possessionAbbr) : ''}</div>` : ''}
    ${g.state === 'pre' && g.odds && (g.odds.awayML || g.odds.homeML) ? `<div class="small" style="margin-top:4px"><span style="color:var(--mint);font-weight:700">Listed ML${g.odds.provider ? ' · ' + esc(g.odds.provider) : ''}</span> <span class="muted">${esc(g.away.abbr)} ${esc(g.odds.awayML || '—')} · ${esc(g.home.abbr)} ${esc(g.odds.homeML || '—')}${g.odds.drawML ? ` · Draw ${esc(g.odds.drawML)}` : ''}</span></div>` : ''}
    <div class="tiny muted" style="margin-top:5px">🕐 ${g.state === 'pre' ? 'Scheduled' : esc(g.detail || '')} · ESPN · ${esc(fmtDateTime(g.start))}</div>
    ${g.broadcasts && g.broadcasts.length ? `<div class="watch-line"><b>Watch</b> ${esc(g.broadcasts.join(' · '))}</div>` : ''}
    <div class="small" style="color:var(--mint);font-weight:700;margin-top:4px">Game details</div>`;
}

/* ================= NEWS ================= */
/* ================= PROPS ================= */
function isBoardPropPlay(pl) {
  const m = (pl.market || '').toLowerCase();
  if (m.includes('prop') || m.includes('player')) return true;
  const t = (pl.play || '').toLowerCase();
  return /\b(over|under)\s+\d/.test(t) && /(yard|reception|point|rebound|assist|strikeout|hits|goal|shot|touchdown|passing|rushing|receiving|threes|blocks|steals|saves)/.test(t);
}
/* Projection block (SNB shape): big Proj vs the posted line, hit rate over the
   player's last games, and a last-5 bar series (mint = the side hit that game).
   Only rendered when the server returned real ESPN game-log math for the prop. */
function projBlockHTML(e) {
  if (!e || !e.hitL10) return '';
  const max = Math.max(...(e.last5 || [0]), e.line || 0, 1);
  const bars = (e.last5 || []).map((v) => {
    const hit = e.dir === 'under' ? v < e.line : v > e.line;
    const h = Math.max(12, Math.round((v / max) * 100));
    return `<span class="proj-dot ${hit ? 'hit' : 'miss'}" style="height:${h}%"></span>`;
  }).join('');
  return `<div class="proj-block">
    <div class="row between"><span class="proj-num">Proj ${e.proj}</span><span class="small muted">Line ${e.line} · ${esc(e.book || 'Hard Rock Bet')}</span></div>
    <div class="small" style="margin-top:3px">Hit in <strong>${e.hitL10.hits} of last ${e.hitL10.games}</strong> · Avg L5 ${e.avgL5} · Avg L10 ${e.avgL10}</div>
    <div class="proj-dots">${bars}</div>
    <div class="tiny muted">Last 5 (newest first): ${(e.last5 || []).join(' · ')} — projection = the player's own game-log average (ESPN), not a book number.</div>
  </div>`;
}
async function renderProps() {
  const el = $('#view-props');
  el.innerHTML = `<h2>Player Props</h2><div class="small muted" style="margin:-6px 2px 2px">Top rated · All leagues</div><div id="props-body"><div class="empty">Loading props…</div></div>`;
  const body = () => $('#props-body');
  try {
    let mine = [];
    if (state.user) {
      const d = await api('GET', '/api/props/mine');
      mine = d.props || [];
    }
    let boardProps = [];
    let boardDate = '';
    try {
      const b = await api('GET', '/api/board');
      boardDate = b.date;
      boardProps = (b.plays || []).filter(isBoardPropPlay);
    } catch { /* board section just stays empty */ }
    let projBoard = new Map(), projMine = new Map(), bookProps = [];
    try {
      const pj = await api('GET', '/api/props/projections');
      for (const e of pj.board || []) projBoard.set(e.refId, e);
      for (const e of pj.mine || []) projMine.set(e.refId, e);
      bookProps = pj.book || [];
    } catch { /* projections are an enrichment — the page works without them */ }
    const myCard = (p) => `<div class="card tight">
      <div class="row between"><strong>${esc(p.player || p.selection)}</strong><span class="pill ${p.legStatus === 'won' ? 'won' : p.legStatus === 'lost' ? 'lost' : 'pending'}">${esc(p.legStatus)}</span></div>
      <div class="small muted">${esc(p.statLabel || '')}${p.line !== null && p.line !== undefined ? ` · ${p.dir === 'under' ? 'Under' : 'Over'} ${p.line}` : ''} · ${fmtOdds(p.odds)} · ${esc(p.league)}</div>
      <div class="small muted">${esc(p.gameLabel || '')}${p.gameState === 'in' ? ` · <span style="color:var(--red)">LIVE</span> ${esc(p.gameDetail || '')}` : p.gameState === 'post' ? ' · Final' : p.startsAt ? ' · ' + fmtDateTime(p.startsAt) : ''}</div>
      ${p.available ? `<div class="small" style="margin-top:5px"><strong>${esc(p.display || '')}</strong>${p.progress !== null && p.progress !== undefined ? `<div class="propbar"><div style="width:${p.progress}%"></div></div>` : ''}<span class="muted">${esc(p.remaining || '')}</span></div>` : `<div class="small muted" style="margin-top:5px">${esc(p.statusText || '')}</div>`}
      <div class="small muted" style="margin-top:4px">On: ${esc(p.ticketTitle || 'a ticket')}</div>
      ${projBlockHTML(projMine.get(p.legId))}
    </div>`;
    const live = mine.filter((p) => p.gameState === 'in');
    const ranked = boardProps.map((pl, i) => `<div class="card tight">
      <div class="row between"><span class="row" style="gap:9px"><span class="rank-n">#${i + 1}</span><strong>${esc(pl.play)}</strong></span><span class="hr-odds">${pl.odds !== null && pl.odds !== undefined ? fmtOdds(pl.odds) : ''}</span></div>
      <div class="small muted" style="margin-top:3px">${esc(pl.league)}${pl.market ? ' · ' + esc(pl.market) : ''} · ${esc(pl.sportsbook)} · ${pl.tier !== 'watch' ? '<span style="color:var(--mint);font-weight:800">Actionable · +EV</span>' : 'Watch list'}</div>
      ${pl.edgeNote ? `<div class="small" style="margin-top:5px">${esc(pl.edgeNote)}</div>` : ''}
      ${pl.verified ? `<div class="small" style="color:var(--mint);margin-top:4px">✓ Verified on Hard Rock Bet${pl.verifiedAt ? ' · ' + fmtDateTime(pl.verifiedAt) : ''}</div>` : ''}${projBlockHTML(projBoard.get(pl.id))}</div>`).join('');
    const bookCards = bookProps.map((e) => `<div class="card tight">
      <div class="row between"><strong>${esc(e.player)} — ${e.dir === 'under' ? 'Under' : 'Over'} ${e.line} ${esc(e.statLabel || '')}</strong><span class="hr-odds">${e.odds !== null && e.odds !== undefined ? fmtOdds(e.odds) : ''}</span></div>
      <div class="small muted" style="margin-top:3px">${esc(e.league)}${e.matchup ? ' · ' + esc(e.matchup) : ''}${e.commenceTime ? ' · ' + fmtDateTime(e.commenceTime) : ''}</div>
      ${projBlockHTML(e)}
    </div>`).join('');
    body().innerHTML = `
      ${state.user ? `<h3>Live player progress</h3>
      ${live.length ? live.map(myCard).join('') : `<div class="card"><div class="empty">No live player props right now.<br>When one of your prop legs is in a live game, its progress sweats here.</div></div>`}` : ''}
      <h3>Top rated props${boardDate ? ` · ${fmtDay(boardDate)}` : ''}</h3>
      ${boardProps.length ? ranked : `<div class="card"><div class="empty">No player props on today's Board — today was all sides and totals.<br>When the morning Board carries props, they rank here with the verified Hard Rock line.</div></div>`}
      ${bookProps.length ? `<h3 style="margin-top:18px">More book props · live lines</h3>${bookCards}` : ''}
      <h3 style="margin-top:18px">Your props</h3>
      ${!state.user ? `<div class="card"><div class="empty">Sign in to sweat your prop legs here.<br><button class="btn" style="margin-top:8px" onclick="showView('account')">Sign in</button></div></div>`
        : mine.length ? mine.map(myCard).join('') : `<div class="card"><div class="empty">No player props on your open tickets right now.<br>Any ticket you add with a player prop leg — screenshot or typed — sweats here live with a progress bar.</div></div>`}
      <div class="card"><div class="small" style="color:var(--mint);font-weight:800">HOW THESE ARE PICKED</div>
      <div class="small muted" style="margin-top:5px">Every target on this page comes off the morning Sweat With Wilk Board and is re-verified on Hard Rock Bet before it posts — Hard Rock is the only book these plays are priced on. Edges are analysis, not guarantees: a prop still has to be played to hit. Set limits, take breaks, and never chase losses.</div></div>
      ${rgFooterHTML()}`;
  } catch (e) {
    body().innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function renderNews() {
  const el = $('#home-news');
  if (!el) return;
  const label = (l) => l === 'ALL' ? 'All leagues' : l === 'SOCCER' ? 'Soccer' : l;
  const chips = NEWS_LEAGUES.map((l) => `<button class="chip ${state.newsLeague === l ? 'on' : ''}" onclick="setNewsLeague('${l}')">${label(l)}</button>`).join('');
  el.innerHTML = `<div class="row between"><h2 style="margin:0">📰 Sports News</h2><button class="icon-btn" style="width:38px;height:38px;font-size:16px" onclick="renderNews()" aria-label="Refresh news">⟳</button></div>
    <div class="chips" style="margin-top:12px">${chips}</div><div id="news-list"><div class="empty">Loading news…</div></div>`;
  try {
    const items = await loadNews(state.newsLeague);
    const list = $('#news-list');
    if (!list) return;
    const shown = items.slice(0, state.newsLimit);
    list.innerHTML = (shown.length ? shown.map((a) => `
      <div class="card tight news-card">
        ${a.image ? `<img class="news-thumb" src="${esc(a.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <div style="flex:1;min-width:0">
          <div class="row between"><span class="news-tag">${esc(a._leagueLabel || '')}</span><span class="tiny muted">${esc(fmtDateTime(a.published))}</span></div>
          ${a.url ? `<a class="news-head" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a>` : `<div class="news-head">${esc(a.headline)}</div>`}
          <div class="tiny muted" style="margin-top:5px">ESPN · Read story</div>
        </div>
      </div>`).join('') : '<div class="card"><div class="empty">No headlines right now.</div></div>')
      + (items.length > state.newsLimit ? `<button class="btn secondary" style="width:100%" onclick="state.newsLimit+=10;renderNews()">More headlines</button>` : '')
      + `<div class="small muted" style="margin-top:8px">Updated ${fmtDateTime(new Date().toISOString())}</div>`;
  } catch (e) {
    const list = $('#news-list'); if (list) list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
async function loadNews(league) {
  const label = (l) => l === 'MLS' ? 'Soccer' : l;
  if (NEWS_FETCH[league]) {
    const parts = await Promise.all(NEWS_FETCH[league].map((l) => api('GET', `/api/news?league=${l}`).then((d) => ({ l, items: d.items || [] })).catch(() => ({ l, items: [] }))));
    const seen = new Set(); const out = [];
    for (const p of parts) for (const a of p.items) { const k = a.id || a.headline; if (seen.has(k)) continue; seen.add(k); out.push({ ...a, _leagueLabel: label(p.l) }); }
    out.sort((x, y) => String(y.published || '').localeCompare(String(x.published || '')));
    return out;
  }
  const fetchLeague = league === 'SOCCER' ? 'MLS' : league;
  const d = await api('GET', `/api/news?league=${fetchLeague}`);
  if (d.error) throw new Error(d.error);
  return (d.items || []).map((a) => ({ ...a, _leagueLabel: label(fetchLeague) }));
}
function setNewsLeague(l) { state.newsLeague = l; state.newsLimit = 8; renderNews(); }
/* ---- pregame form + head-to-head (SPEC §3a shape) ---- */
function fmtMD(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}
function formSectionShell(g) {
  if (!g || !g.home || !g.away || !g.home.id || !g.away.id) return '';
  const inner = `<div class="small" style="color:var(--mint);font-weight:800">PREGAME STATS</div><div id="gd-form"><div class="small muted" style="margin-top:4px">Loading form…</div></div>`;
  if (g.state === 'pre') return `<div class="card tight" style="margin-top:12px">${inner}<div class="tiny muted" style="margin-top:6px">Completed games only · ESPN schedules</div></div>`;
  return `<details class="card tight" style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Pregame form &amp; head-to-head</summary><div style="margin-top:8px">${inner}</div></details>`;
}
function setFormSeg(s) { state.formSeg = s; paintForm(); }
function paintForm() {
  const el = $('#gd-form');
  const d = state.formData;
  if (!el) return;
  if (!d) { el.innerHTML = '<div class="small muted" style="margin-top:4px">Loading form…</div>'; return; }
  const has = (d.home && d.home.last5 && d.home.last5.length) || (d.away && d.away.last5 && d.away.last5.length) || (d.h2h && d.h2h.length);
  if (!has) { el.innerHTML = '<div class="small muted" style="margin-top:4px">No recent completed games on file for these teams yet.</div>'; return; }
  const seg = state.formSeg;
  const segBtn = (key, label) => `<button class="${seg === key ? 'on' : ''}" onclick="setFormSeg('${key}')">${esc(label)}</button>`;
  const chip = (r) => `<span class="result-chip ${String(r).toLowerCase()}">${esc(r)}</span>`;
  let inner = `<div class="seg" style="margin:8px 0">${segBtn('away', (d.away && d.away.abbr) || 'Away')}${segBtn('home', (d.home && d.home.abbr) || 'Home')}${segBtn('h2h', 'H2H')}</div>`;
  const teamView = (t) => {
    if (!t || !t.last5 || !t.last5.length) return '<div class="small muted">No completed games on file for this team.</div>';
    return `<div class="row between"><strong>Last 5 games</strong><span class="small muted">${esc(t.abbr)} — ${esc(t.record || '')}</span></div>`
      + t.last5.map((r) => `<div class="form-row"><span class="muted">${esc(fmtMD(r.date))}</span><span>${r.home ? 'vs' : '@'} ${esc(r.oppAbbr)}</span><span><strong>${r.teamScore}–${r.oppScore}</strong></span>${chip(r.result)}</div>`).join('');
  };
  if (seg === 'h2h') {
    inner += `<div class="row between"><strong>Last ${d.h2h.length} against each other</strong><span class="small muted">Head-to-head${d.home && d.home.abbr ? ` — ${esc(d.home.abbr)} ${esc(d.h2hRecord || '')}` : ''}</span></div>`
      + (d.h2h.length ? d.h2h.map((r) => `<div class="form-row"><span class="muted">${esc(fmtMD(r.date))}</span><span>${esc(r.awayAbbr)} @ ${esc(r.homeAbbr)}</span><span><strong>${r.awayScore}–${r.homeScore}</strong></span>${chip(r.result)}</div>`).join('') : '<div class="small muted">No completed meetings found in the current or previous season schedules.</div>');
  } else {
    inner += teamView(seg === 'home' ? d.home : d.away);
  }
  el.innerHTML = inner;
}
async function loadGameForm(league, g) {
  state.formData = null;
  try {
    const d = await api('GET', `/api/games/form?league=${encodeURIComponent(league)}&homeId=${encodeURIComponent(g.home.id)}&awayId=${encodeURIComponent(g.away.id)}`);
    const ld = state.lastDetail;
    if (!ld || String(ld.eventId) !== String(g.id)) return; // dialog moved on to another game
    state.formData = d;
    paintForm();
  } catch { const el = $('#gd-form'); if (el) el.innerHTML = '<div class="small muted" style="margin-top:4px">Form unavailable right now.</div>'; }
}
async function openGameDetail(league, eventId) {
  const blockId = `score-${eventId}`;
  state.lastDetail = { league, eventId };
  openSheet(`<div class="row between"><h3 style="margin:0">Game details</h3><button class="close-pill" onclick="closeSheet()">✕ Close</button></div><div id="gd-body"><div class="empty">Loading…</div></div>`);
  try {
    const d = await api('GET', `/api/game?league=${encodeURIComponent(league)}&eventId=${encodeURIComponent(eventId)}`);
    d.at = Date.now();
    state.detailCache.set(String(eventId), d);
    const g = d.game || null;
    const body = $('#gd-body');
    if (!body) return;
    const stateLabel = !g ? '' : g.state === 'in' ? 'LIVE' : g.state === 'post' ? 'FINAL' : esc(fmtDateTime(g.start));
    const scorers = isSoccerLeague(league) && d.scoringPlays && d.scoringPlays.length ? `<div style="margin-top:6px">${d.scoringPlays.map((pl) => `<div class="scorer-line">⚽ ${esc(pl.clock || '')} ${esc(pl.teamAbbr || '')} — ${esc(pl.text || '')}</div>`).join('')}</div>` : '';
    body.innerHTML = `<div class="gd-top"><span class="gd-brand">SWEAT WITH WILK</span>${state.user && g ? `<button class="icon-btn" style="width:36px;height:36px;font-size:16px" onclick="toggleSheetGameAlert('${esc(String(eventId))}')" aria-label="Game alerts">🔔</button>` : '<span></span>'}<span class="small muted">${esc(league)} ${stateLabel}</span></div>
      ${g && g.broadcasts && g.broadcasts.length ? `<div class="small" style="text-align:center;margin-bottom:6px">Watch: ${esc(g.broadcasts.join(' · '))}</div>` : ''}
      ${gameHeaderHTML(g, league)}
      ${scorers}
      ${linescoreHTML(d)}
      ${situationHTML(g, d)}
      ${winProbHTML(d.winProbHome !== null && d.winProbHome !== undefined && g ? { winProbHome: d.winProbHome, home: g.home, away: g.away } : null)}
      ${formSectionShell(g)}
      ${gameAlertsPanelHTML(eventId)}
      ${detailTabsHTML(blockId, league, eventId)}`;
    state.formSeg = 'away';
    if (g && g.home && g.away && g.home.id && g.away.id) loadGameForm(league, g);
  } catch (e) {
    const body = $('#gd-body'); if (body) body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function gameAlertsPanelHTML(eventId) {
  if (!state.user || !state.alerts) return '';
  const off = state.alerts.subs.some((s) => s.scope === 'game' && s.eventId === String(eventId) && !s.on);
  return `<div class="card tight" style="margin-top:12px"><div class="small" style="color:var(--mint);font-weight:800">GAME ALERTS</div>
    <div class="switch-row"><span>Game start</span><input type="checkbox" style="width:auto" ${off ? '' : 'checked'} onchange="toggleSheetGameAlert('${esc(String(eventId))}')"></div>
    <div class="switch-row"><span>Score — when either team scores</span><input type="checkbox" style="width:auto" ${off ? '' : 'checked'} onchange="toggleSheetGameAlert('${esc(String(eventId))}')"></div>
    <div class="small muted" style="margin-top:6px">One switch covers this game — starts, scoring plays, and the final score — and alerts turn off when this game ends.</div></div>`;
}
async function toggleSheetGameAlert(eventId) {
  if (!state.alerts) { showToast('Sign in to use game alerts.'); return; }
  const off = state.alerts.subs.some((s) => s.scope === 'game' && s.eventId === String(eventId) && !s.on);
  try {
    await api('POST', '/api/alerts/toggle', { scope: 'game', eventId, on: off });
    await refreshAlertBadge();
    showToast(off ? 'Game alerts on for this game.' : 'Game alerts off for this game.');
    const ld = state.lastDetail;
    if (ld && String(ld.eventId) === String(eventId) && $('#gd-body')) openGameDetail(ld.league, ld.eventId);
    else render();
  } catch (e) { showToast(e.message); }
}

/* ================= BOARD ================= */
async function renderBoard() {
  const el = $('#view-board');
  el.innerHTML = `<h2>Board</h2><div class="seg" style="margin-bottom:14px"><button class="${state.boardSeg === 'friends' ? 'on' : ''}" onclick="setBoardSeg('friends')">Friends' tickets</button><button class="${state.boardSeg === 'top30' ? 'on' : ''}" onclick="setBoardSeg('top30')">Top 30 Board</button></div><div id="board-body"><div class="empty">Loading…</div></div>`;
  if (state.boardSeg === 'friends') return renderBoardFriends();
  return renderBoardTop30();
}
function setBoardSeg(s) { state.boardSeg = s; renderBoard(); }
async function renderBoardTop30() {
  try {
    const d = await api('GET', `/api/board${state.boardDate ? `?date=${state.boardDate}` : ''}`);
    state.boardDate = d.date;
    const dateOpts = (d.dates || []).map((x) => `<option value="${x}" ${x === d.date ? 'selected' : ''}>${fmtDay(x)}</option>`).join('');
    const actionable = d.plays.filter((x) => x.tier !== 'watch');
    const watch = d.plays.filter((x) => x.tier === 'watch');
    const playCard = (pl) => `<div class="card tight"><div class="row between"><strong>${esc(pl.play)}</strong><span>${pl.odds !== null && pl.odds !== undefined ? fmtOdds(pl.odds) : ''}</span></div>
      <div class="small muted">${esc(pl.league)}${pl.market ? ' · ' + esc(pl.market) : ''} · ${esc(pl.sportsbook)}</div>
      ${pl.edgeNote ? `<div class="small" style="margin-top:4px">${esc(pl.edgeNote)}</div>` : ''}
      ${pl.verified ? `<div class="small" style="color:var(--mint);margin-top:4px">✓ Verified on Hard Rock Bet${pl.verifiedAt ? ' · ' + fmtDateTime(pl.verifiedAt) : ''}</div>` : ''}</div>`;
    $('#board-body').innerHTML = `
      <div class="row between wrap"><div class="muted">${fmtDay(d.date)}</div>
      ${dateOpts ? `<select class="picker" onchange="state.boardDate=this.value;renderBoard()">${dateOpts}</select>` : ''}</div>
      <div style="height:10px"></div>
      ${d.plays.length === 0 ? `<div class="card"><div class="empty">Today's Board hasn't landed yet — it lands by 7:00 AM ET.<br>Past boards stay archived by date and still count in your Bankroll.</div></div>` : ''}
      ${actionable.length ? `<h3>Actionable — +EV</h3>${actionable.map(playCard).join('')}` : ''}
      ${watch.length ? `<h3>Watch</h3>${watch.map(playCard).join('')}` : ''}` + rgFooterHTML();
  } catch (e) {
    $('#board-body').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function renderBoardFriends() {
  const body = () => $('#board-body');
  try {
    const d = await api('GET', '/api/community');
    state.communityCache = d;
    const posts = (d.posts || []).filter((p) => p.kind === 'ticket' && p.ticket);
    if (!body()) return;
    body().innerHTML = `<div class="muted" style="margin-bottom:10px">Tickets friends and the room shared.</div>` +
      (posts.length ? posts.map(friendTicketCardHTML).join('') : `<div class="dashed-empty">No friend tickets yet.<br>Find people in People to see their tickets here.</div>`) + rgFooterHTML();
  } catch (e) {
    if (body()) body().innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function friendTicketCardHTML(post) {
  const t = post.ticket;
  const n = t.legs.length;
  const badge = t.outcome === 'won' ? '<span class="pill outcome-win">WIN</span>' : t.outcome === 'lost' ? '<span class="pill outcome-loss">LOSS</span>' : t.outcome === 'push' ? '<span class="pill push">PUSH</span>' : '<span class="pill live">LIVE</span>';
  const hit = t.legs.filter((l) => l.status === 'won').length;
  const byGame = new Map();
  for (const l of t.legs) { const k = l.gameLabel || l.league; if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(l); }
  const legRows = [...byGame.entries()].map(([label, legs]) => `<div style="margin-top:8px"><div class="small" style="font-weight:800">${esc(label)}</div>${legs.map((l) => `<div class="row between" style="margin-top:3px"><span class="small">${esc(l.selection)} <span class="muted">· ${esc(l.market)}${l.line ? ' ' + esc(l.line) : ''}</span></span><span class="row" style="gap:8px"><span class="odds-purple">${fmtOdds(l.odds)}</span>${l.status === 'won' ? '<span class="small" style="color:var(--mint);font-weight:800">✓ Hit</span>' : l.status === 'lost' ? '<span class="small" style="color:var(--red);font-weight:800">Missed</span>' : l.status === 'push' ? '<span class="small muted">Push</span>' : '<span class="small muted">···</span>'}</span></div>`).join('')}</div>`).join('');
  const reactionLabel = { respect: 'Respect', tail: 'Tail it', hot: 'Hot take' };
  return `<div class="card">
    <div class="row between"><span class="row" style="gap:9px"><span class="avatar-c gray">${esc((post.authorName || '?').trim().charAt(0).toUpperCase())}</span><span><strong>${esc(post.authorName)}</strong><div class="tiny muted">🌐 Community</div></span></span><span class="tiny muted">${fmtDateTime(post.createdAt)}</span></div>
    <div class="row" style="gap:8px;margin-top:10px"><span class="hr-badge">${n > 1 ? `${n}-LEG PARLAY` : 'SINGLE BET'}</span>${t.title ? `<span class="pill">${esc(t.title)}</span>` : ''}${badge}</div>
    ${legRows}
    <div style="margin-top:10px"><div class="row between small"><span class="muted">Leg progress</span><span><strong>${hit} / ${n}</strong> hit</span></div><div class="legprog"><div style="width:${n ? Math.round((hit / n) * 100) : 0}%"></div></div></div>
    <div class="small" style="margin-top:10px">Wager <strong>${fmtMoney(t.stake)}</strong> · Potential return <strong>${fmtMoney(t.payout)}</strong> · <span class="odds-purple">${fmtOdds(t.combinedOdds)}</span></div>
    <div class="row wrap" style="margin-top:10px">${post.reactions.map((r) => `<button class="reaction-btn ${r.mine ? 'on' : ''}" onclick="toggleReaction(${post.id},'${r.reaction}')">${reactionLabel[r.reaction]} · ${r.count}</button>`).join('')}</div>
  </div>`;
}

/* ================= BANKROLL ================= */
async function renderBankroll() {
  const el = $('#view-bankroll');
  if (!state.user) { el.innerHTML = '<h2>Bankroll</h2>' + signInPromptHTML('Sign in to see your record, streak, and profit by day.'); return; }
  el.innerHTML = '<h2>Bankroll</h2><div id="bank-body"><div class="empty">Loading…</div></div>';
  try {
    const b = await api('GET', '/api/bankroll');
    const streakTxt = b.streak && b.streak.type ? `${b.streak.type === 'won' ? 'W' : 'L'}${b.streak.count}` : '—';
    $('#bank-body').innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${fmtMoney(b.currentBankroll)}</div><div class="lbl">Bankroll (start ${fmtMoney(b.startingBankroll)})</div></div>
        <div class="stat-box"><div class="num" style="color:${b.netProfit >= 0 ? 'var(--mint)' : 'var(--red)'}">${fmtMoney(b.netProfit)}</div><div class="lbl">Net profit</div></div>
        <div class="stat-box"><div class="num">${b.wins}-${b.losses}${b.pushes ? `-${b.pushes}P` : ''}</div><div class="lbl">Record (W-L${b.pushes ? '-P' : ''})</div></div>
        <div class="stat-box"><div class="num">${b.winRate === null ? '—' : b.winRate + '%'}</div><div class="lbl">Win rate</div></div>
        <div class="stat-box"><div class="num">${streakTxt}</div><div class="lbl">Current streak</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(b.unitSize)}</div><div class="lbl">Unit size</div></div>
      </div>
      <h3>Profit by day</h3>
      ${b.byDay.length ? b.byDay.map((d) => `<div class="kv"><span>${fmtDay(d.date)} · ${d.wins}W-${d.losses}L</span><span style="color:${d.profit >= 0 ? 'var(--mint)' : 'var(--red)'};font-weight:700">${fmtMoney(d.profit)}</span></div>`).join('') : '<div class="empty">No settled tickets yet — finals grade themselves.</div>'}`;
  } catch (e) {
    $('#bank-body').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

/* ================= COMMUNITY ================= */
async function renderCommunity() {
  const el = $('#view-community');
  el.innerHTML = '<div id="comm-body"><div class="empty">Loading the room…</div></div>';
  try {
    const d = await api('GET', '/api/community');
    state.communityCache = d;
    const reactionLabel = { respect: 'Respect', tail: 'Tail it', hot: 'Hot take' };
    const postHTML = (post) => `<div class="card">
      <div class="row between"><strong>${esc(post.authorName)}</strong><span class="small muted">${fmtDateTime(post.createdAt)}</span></div>
      ${post.kind === 'ticket' && post.ticket ? `<div style="margin-top:8px"><div class="small" style="color:var(--mint);font-weight:800">${esc(post.ticket.title || 'Ticket')} · ${esc(post.ticket.sportsbook)}</div>
        <div class="small muted">Stake ${fmtMoney(post.ticket.stake)} · ${fmtOdds(post.ticket.combinedOdds)} · Payout ${fmtMoney(post.ticket.payout)} · ${esc(post.ticket.outcome)}</div>
        ${post.ticket.legs.map((l) => `<div class="leg"><div class="row between"><span class="sel" style="font-size:14px">${esc(l.selection)}</span>${legStatusPill(l)}</div><div class="small muted">${esc(l.market)}${l.line ? ' · ' + esc(l.line) : ''} · ${fmtOdds(l.odds)} · ${esc(l.league)}</div></div>`).join('')}</div>` : ''}
      ${post.body ? `<div style="margin-top:8px">${esc(post.body)}</div>` : ''}
      <div class="row wrap" style="margin-top:10px">
        ${post.reactions.map((r) => `<button class="reaction-btn ${r.mine ? 'on' : ''}" onclick="toggleReaction(${post.id},'${r.reaction}')">${reactionLabel[r.reaction]} · ${r.count}</button>`).join('')}
        ${post.mine && state.user ? `<button class="reaction-btn" onclick="deletePost(${post.id}, this)">Delete</button>` : ''}
      </div>
      <div style="margin-top:6px">${post.comments.map((c) => `<div class="comment"><strong>${esc(c.authorName)}</strong> <span class="muted small">${fmtDateTime(c.createdAt)}</span><br>${esc(c.body)}</div>`).join('')}</div>
      ${state.user ? `<div class="row" style="margin-top:8px"><input id="comment-${post.id}" placeholder="Add a comment…"><button class="btn secondary small" onclick="addComment(${post.id})">Send</button></div>` : ''}
    </div>`;
    $('#comm-body').innerHTML = `
      ${state.user ? `<div class="card"><label style="margin-top:0">Talk sports, picks, and props</label><textarea id="comm-new" rows="2" placeholder="Post to the room…"></textarea><button class="btn" style="margin-top:8px" onclick="createPost()">Post</button></div>`
        : `<div class="card"><div class="empty">You're reading as a guest.<br><button class="btn" style="margin-top:8px" onclick="showView('account')">Sign in to post</button></div></div>`}
      <h3>Predictions Leaderboard</h3>
      <div class="card tight">${d.leaderboard.length ? d.leaderboard.map((r, i) => `<div class="leader-row"><span>${i + 1}. <strong>${esc(r.name)}</strong></span><span class="muted">${r.wins}W-${r.losses}L · ${r.winRate}% · <span style="color:${r.netProfit >= 0 ? 'var(--mint)' : 'var(--red)'}">${fmtMoney(r.netProfit)}</span></span></div>`).join('') : '<div class="empty">No graded results yet — the board fills in from real settled tickets only.</div>'}</div>
      <h3>The Room</h3>
      ${d.posts.length ? d.posts.map(postHTML).join('') : '<div class="card"><div class="empty">The room is empty — be the first to post a ticket or a take.</div></div>'}`;
  } catch (e) {
    $('#comm-body').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
async function createPost() {
  const body = $('#comm-new').value.trim();
  if (!body) return;
  try { await api('POST', '/api/community/posts', { body }); render(); } catch (e) { showToast(e.message); }
}
async function addComment(postId) {
  const input = $(`#comment-${postId}`);
  const body = input.value.trim();
  if (!body) return;
  try { await api('POST', `/api/community/posts/${postId}/comments`, { body }); render(); } catch (e) { showToast(e.message); }
}
async function toggleReaction(postId, reaction) {
  if (!state.user) { showToast('Sign in to react.'); showView('account'); return; }
  try { await api('POST', `/api/community/posts/${postId}/reactions`, { reaction }); render(); } catch (e) { showToast(e.message); }
}
async function deletePost(postId, btn) {
  if (!armButton(btn, 'Tap again to DELETE')) return;
  try { await api('DELETE', `/api/community/posts/${postId}`); render(); showToast('Post deleted.'); } catch (e) { showToast(e.message); }
}

/* ================= ACCOUNT ================= */
const ALERT_LABELS = { game_start: 'Game starts', leg_flip: 'Scoring play flips a leg', prop_cross: 'Prop crosses its number', prop_dead: 'Prop is mathematically dead', leg_final: 'Leg goes final', ticket_settled: 'Ticket settles' };
async function renderAccount() {
  const el = $('#view-account');
  if (!state.user) {
    el.innerHTML = `<h2>Account</h2>
    <div class="card"><h3 style="margin-top:0;color:var(--text);text-transform:none;letter-spacing:0">Sign in</h3>
      <label>Username</label><input id="si-user" autocomplete="username">
      <label>Password</label><input id="si-pass" type="password" autocomplete="current-password">
      <div id="si-error"></div>
      <button class="btn" style="margin-top:12px" onclick="doSignIn()">Sign in</button>
      <div class="small muted" style="margin-top:10px">Forgot your password? Use a recovery code below.</div>
    </div>
    <div class="card"><h3 style="margin-top:0;color:var(--text);text-transform:none;letter-spacing:0">Create account</h3>
      <label>Username (3–24 characters)</label><input id="su-user" autocomplete="username">
      <label>Email</label><input id="su-email" type="email" autocomplete="email">
      <label>Password (10+ characters)</label><input id="su-pass" type="password" autocomplete="new-password">
      <div id="su-error"></div>
      <button class="btn" style="margin-top:12px" onclick="doSignUp()">Sign up</button>
      <div class="small muted" style="margin-top:8px">Signing up gives you 8 one-time recovery codes — save them somewhere safe.</div>
    </div>
    <div class="card"><h3 style="margin-top:0;color:var(--text);text-transform:none;letter-spacing:0">Reset password</h3>
      <label>Username</label><input id="rp-user">
      <label>Recovery code</label><input id="rp-code" placeholder="XXXX-XXXX">
      <label>New password (10+ characters)</label><input id="rp-pass" type="password">
      <div id="rp-error"></div>
      <button class="btn secondary" style="margin-top:12px" onclick="doReset()">Reset password</button>
    </div>`;
    return;
  }
  const s = state.settings || {};
  const a = state.alerts;
  el.innerHTML = `<h2>Account</h2>
    <div class="card"><div class="row between"><div><strong>${esc(state.user.displayName)}</strong><div class="small muted">@${esc(state.user.username)} · ${esc(state.user.email)}</div></div>
      <button class="btn secondary small" onclick="doSignOut()">Sign out</button></div></div>
    <div class="card"><h3 style="margin-top:0;color:var(--text);text-transform:none;letter-spacing:0">Settings</h3>
      <label>Display name</label><input id="set-name" value="${esc(state.user.displayName)}">
      <label>Default sportsbook</label><input id="set-book" value="${esc(s.defaultBook || 'Hard Rock Bet')}">
      <div class="grid2">
        <div><label>Starting bankroll ($)</label><input id="set-bank" type="number" step="0.01" value="${esc(s.startingBankroll ?? 0)}"></div>
        <div><label>Unit size ($)</label><input id="set-unit" type="number" step="0.01" value="${esc(s.unitSize ?? 10)}"></div>
      </div>
      <div id="set-msg"></div>
      <button class="btn" style="margin-top:12px" onclick="saveSettings()">Save settings</button>
    </div>
    <div class="card" id="alerts-center"><h3 style="margin-top:0;color:var(--text);text-transform:none;letter-spacing:0">Alerts</h3>
      <div class="small muted" style="margin-bottom:8px">Alerts live here in the app, with a badge on the bell — and with push on, they hit your phone's lock screen too.</div>
      <div id="push-row" style="margin:10px 0"></div>
      ${a ? `<div class="row between"><span class="small muted">${a.unread} unread</span><button class="btn secondary small" onclick="markAllRead()">Mark all read</button></div>
      <div style="margin-top:10px">${a.alerts.length ? a.alerts.map((al) => `<div class="alert-item ${al.read ? 'read' : ''}" onclick="markRead(${al.id})"><div><strong>${esc(al.title)}</strong> ${al.heldQuietly ? '<span class="pill">held quietly</span>' : ''}</div><div class="small muted">${esc(al.body)}</div><div class="tiny muted">${fmtDateTime(al.createdAt)}</div></div>`).join('') : '<div class="empty">No alerts yet. They fire for your open tickets: game starts, leg flips, props crossing, finals, and settlements.</div>'}</div>
      <h3 style="margin-top:16px">Alert preferences</h3>
      ${a.types.map((t) => `<div class="switch-row"><span>${esc(ALERT_LABELS[t] || t)}</span><input type="checkbox" style="width:auto" ${a.prefs[t] === false ? '' : 'checked'} onchange="savePref('${t}', this.checked)"></div>`).join('')}
      <div class="grid2">
        <div><label>Quiet hours start</label><input id="q-start" type="time" value="${esc(a.quietStart || '')}"></div>
        <div><label>Quiet hours end</label><input id="q-end" type="time" value="${esc(a.quietEnd || '')}"></div>
      </div>
      <button class="btn secondary small" style="margin-top:10px" onclick="saveQuiet()">Save quiet hours</button>
      <div class="small muted" style="margin-top:6px">Alerts during quiet hours still land here, flagged "held quietly" — they just don't raise the badge.</div>`
      : '<div class="empty">Loading alerts…</div>'}
    </div>`;
  fillPushRow();
  if (!a) refreshAlertBadge().then(() => { if (state.view === 'account') renderAccount(); });
}
async function doSignUp() {
  const err = $('#su-error');
  try {
    const d = await api('POST', '/api/auth/signup', { username: $('#su-user').value.trim(), email: $('#su-email').value.trim(), password: $('#su-pass').value });
    await refreshMe();
    openSheet(`<h3>Save your recovery codes</h3>
      <p class="small muted">These 8 codes are shown <strong>once</strong>. Each one can reset your password a single time. Screenshot them or write them down somewhere safe.</p>
      <div class="card tight" style="font-size:17px;letter-spacing:.04em;line-height:1.9">${d.recoveryCodes.map(esc).join('<br>')}</div>
      <button class="btn" onclick="closeSheet();showView('tickets')">I saved them — start sweating</button>`);
    render();
  } catch (e) { err.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}
async function doSignIn() {
  const err = $('#si-error');
  try {
    await api('POST', '/api/auth/signin', { username: $('#si-user').value.trim(), password: $('#si-pass').value });
    await refreshMe(); showView('tickets');
  } catch (e) { err.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}
async function doSignOut() {
  await api('POST', '/api/auth/signout');
  state.user = null; state.tickets = []; state.alerts = null;
  $('#alerts-bell').hidden = true;
  render();
}
async function doReset() {
  const err = $('#rp-error');
  try {
    await api('POST', '/api/auth/reset', { username: $('#rp-user').value.trim(), code: $('#rp-code').value.trim(), newPassword: $('#rp-pass').value });
    err.innerHTML = '<div class="okbox" style="margin-top:10px">Password reset. Sign in with your new password.</div>';
  } catch (e) { err.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}
async function saveSettings() {
  const msg = $('#set-msg');
  try {
    const d = await api('PUT', '/api/settings', {
      displayName: $('#set-name').value.trim(), defaultBook: $('#set-book').value.trim(),
      startingBankroll: parseFloat($('#set-bank').value) || 0, unitSize: parseFloat($('#set-unit').value) || 0,
    });
    state.settings = d.settings;
    await refreshMe();
    msg.innerHTML = '<div class="okbox" style="margin-top:10px">Settings saved.</div>';
  } catch (e) { msg.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}
async function markRead(id) { await api('POST', '/api/alerts/read', { id }); await refreshAlertBadge(); if (state.view === 'account') renderAccount(); }
async function markAllRead() { await api('POST', '/api/alerts/read-all', {}); await refreshAlertBadge(); if (state.view === 'account') renderAccount(); }
async function savePref(type, on) {
  const a = state.alerts; if (!a) return;
  a.prefs[type] = on;
  await api('PUT', '/api/alerts/prefs', { prefs: a.prefs, quietStart: a.quietStart, quietEnd: a.quietEnd });
  refreshAlertBadge();
}
async function saveQuiet() {
  const a = state.alerts; if (!a) return;
  await api('PUT', '/api/alerts/prefs', { prefs: a.prefs, quietStart: $('#q-start').value, quietEnd: $('#q-end').value });
  await refreshAlertBadge(); renderAccount();
}

/* ================= HOME / PROFILE / PEOPLE (video spec layer) ================= */
function rgFooterHTML() {
  return `<div class="rg-footer">
    <div class="rg-brand">SWEAT WITH WILK</div>
    <div><strong>Gamble responsibly.</strong></div>
    <div class="small">Set limits. Take breaks. Never chase losses.</div>
    <div class="small muted">Sweat With Wilk tracks tickets and never accepts or places wagers.</div>
    <div class="small" style="margin-top:10px">Need support for a gambling problem?</div>
    <div class="small"><a href="tel:18006973738">1-800-MY-RESET</a></div>
    <div class="small muted">Florida: <a href="tel:18882364848">888-ADMIT-IT (888-236-4848)</a></div>
    <div class="tiny muted" style="margin-top:10px">Privacy · Use &amp; community rules</div>
  </div>`;
}
function renderProfileChip() {
  const chip = $('#profile-chip');
  if (!chip) return;
  if (!state.user) {
    chip.innerHTML = '<span class="chip-name">Sign in</span>';
    chip.onclick = () => showView('account');
    return;
  }
  const name = state.user.displayName || state.user.username || '?';
  chip.innerHTML = `<span class="avatar-c">${esc(name.trim().charAt(0).toUpperCase())}</span><span class="chip-name">${esc(name)}</span><span class="chev">▾</span>`;
  chip.onclick = openProfileMenu;
}
function openProfileMenu() {
  if (!state.user) { showView('account'); return; }
  openSheet(`<h3>${esc(state.user.displayName || state.user.username)}</h3>
    <button class="more-row" onclick="closeSheet();showView('account')"><span class="more-ico">👤</span><span class="more-txt"><span class="more-t">Account</span><span class="more-s">Profile, alerts + push settings</span></span><span class="more-arrow">›</span></button>
    <button class="more-row" onclick="closeSheet();showView('bankroll')"><span class="more-ico">💰</span><span class="more-txt"><span class="more-t">Bankroll</span><span class="more-s">Your money tracker</span></span><span class="more-arrow">›</span></button>
    <button class="more-row" onclick="closeSheet();doSignOut()"><span class="more-ico">↩️</span><span class="more-txt"><span class="more-t">Sign out</span><span class="more-s">@${esc(state.user.username)}</span></span><span class="more-arrow">›</span></button>
    <button class="btn secondary" style="width:100%" onclick="closeSheet()">Cancel</button>`);
}
function openShareSheet() {
  if (!state.user) { showView('account'); return; }
  if (!state.tickets.length) { showToast('Add a ticket first — then you can share it to the Board.'); return; }
  openSheet(`<h3>Share a ticket</h3><p class="small muted">Post one of your tickets to the Community and the Board's Friends' tickets feed.</p>
    ${state.tickets.map((t) => `<button class="more-row" onclick="closeSheet();postToCommunity(${t.id})"><span class="more-ico">🎟️</span><span class="more-txt"><span class="more-t">${esc(t.title || `${t.legs.length}-Bet Parlay`)}</span><span class="more-s">${fmtOdds(t.combinedOdds)} · Wager ${fmtMoney(t.stake)}</span></span><span class="more-arrow">›</span></button>`).join('')}
    <button class="btn secondary" style="width:100%" onclick="closeSheet()">Cancel</button>`);
}
async function renderHome() {
  renderProfileChip();
  const el = $('#view-home');
  if (!$('#home-news')) {
    el.innerHTML = `<a class="report-link" href="mailto:Bosscochon1804@gmail.com">Report an issue</a><div id="home-news"></div><div id="home-tabs"></div>`;
  }
  renderHomeTabs();
  renderNews();
  if (state.homeTab === 'tickets') renderTickets(); else renderCommunity();
}
function renderHomeTabs() {
  const t = $('#home-tabs');
  if (!t) return;
  t.innerHTML = `<div class="home-tabs"><button class="${state.homeTab === 'tickets' ? 'on' : ''}" onclick="setHomeTab('tickets')">My Tickets <span class="count-chip">${state.tickets.length}</span></button><button class="${state.homeTab === 'community' ? 'on' : ''}" onclick="setHomeTab('community')">Community</button></div>`;
}
async function renderPeople() {
  const el = $('#view-people');
  if (!state.user) { el.innerHTML = '<h2>People</h2>' + signInPromptHTML('Sign in to follow people, approve followers, and see their tickets on the Board.'); return; }
  el.innerHTML = '<h2>People</h2><div id="people-body"><div class="empty">Loading people…</div></div>';
  try {
    const d = await api('GET', '/api/people');
    state.peopleCache = d;
    const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
    const row = (p, btns) => `<div class="card tight"><div class="row between"><span class="row" style="gap:10px"><span class="avatar-c gray">${initial(p.name)}</span><span><strong>${esc(p.name)}</strong><div class="tiny muted">@${esc(p.username)}</div></span></span><span class="row" style="gap:6px">${btns}</span></div></div>`;
    const reqBtns = (p) => `<button class="btn small" onclick="peopleApprove(${p.userId})">Approve</button><button class="btn secondary small" onclick="peopleDecline(${p.userId})">Decline</button>`;
    const findBtn = (p) => p.outState === 'approved' ? `<span class="pill won">Following</span><button class="btn secondary small" onclick="peopleUnfollow(${p.userId})">Unfollow</button>` : p.outState === 'pending' ? '<span class="pill">Requested</span>' : `<button class="btn small" onclick="peopleRequest(${p.userId})">Request</button>`;
    const body = $('#people-body');
    if (!body) return;
    body.innerHTML = `
      <h3>Follow requests</h3>
      <div class="small muted" style="margin-bottom:10px">People who follow you can see the tickets you share in the Board room. Approval is always up to you — nothing is shared until you approve.</div>
      ${d.requests.length ? d.requests.map((p) => row(p, reqBtns(p))).join('') : '<div class="card"><div class="empty">No pending follow requests.</div></div>'}
      <h3>Find people</h3>
      ${d.people.length ? d.people.map((p) => row(p, findBtn(p))).join('') : '<div class="card"><div class="empty">No other accounts yet — you are early. Invite your people and this list fills in.</div></div>'}
      <h3>Approved followers</h3>
      ${d.followers.length ? d.followers.map((p) => row(p, `<button class="btn secondary small" onclick="peopleRemoveFollower(${p.userId})">Remove</button>`)).join('') : '<div class="card"><div class="empty">Your private bets have no approved followers.</div></div>'}
      <h3>Following</h3>
      ${d.following.length ? d.following.map((p) => row(p, `<button class="btn secondary small" onclick="peopleUnfollow(${p.userId})">Unfollow</button>`)).join('') : '<div class="card"><div class="empty">You are not following anyone yet.</div></div>'}
      <button class="btn danger" style="width:100%;margin-top:14px" onclick="peopleRemoveAll(this)">Remove all follower access</button>
      ${rgFooterHTML()}`;
  } catch (e) {
    const b = $('#people-body'); if (b) b.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
async function peopleAct(path, userId) {
  try { await api('POST', path, userId === undefined ? {} : { userId }); renderPeople(); }
  catch (e) { showToast(e.message); }
}
function peopleRequest(id) { peopleAct('/api/people/request', id); }
function peopleApprove(id) { peopleAct('/api/people/approve', id); }
function peopleDecline(id) { peopleAct('/api/people/decline', id); }
function peopleUnfollow(id) { peopleAct('/api/people/unfollow', id); }
function peopleRemoveFollower(id) { peopleAct('/api/people/remove-follower', id); }
async function peopleRemoveAll(btn) {
  if (!armButton(btn, 'Tap again to REMOVE ALL')) return;
  try { await api('POST', '/api/people/remove-all', {}); showToast('All follower access removed.'); renderPeople(); }
  catch (e) { showToast(e.message); }
}

/* ================= boot + refresh ================= */
(async function boot() {
  await refreshMe();
  render();
})();
