'use strict';
/* Sweat With Wilk — client */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
const state = {
  user: null, settings: null, tickets: [], view: 'tickets',
  scoresLeague: 'NFL', scoresCache: {}, boardDate: null,
  newsLeague: 'NFL',
  detailCache: new Map(), blockTab: new Map(), fullPlays: new Set(), expandedBlocks: new Set(),
  alerts: null, communityCache: null,
};

function showView(name) {
  state.view = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  window.scrollTo(0, 0);
  render();
}
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.nav)));
$('#alerts-bell').addEventListener('click', () => { showView('account'); setTimeout(() => { const el = $('#alerts-center'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 60); });

async function refreshMe() {
  try {
    const d = await api('GET', '/api/me');
    state.user = d.user; state.settings = d.settings || null;
  } catch { state.user = null; }
  $('#alerts-bell').hidden = !state.user;
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
  ({ tickets: renderTickets, scores: renderScores, props: renderProps, news: renderNews, community: renderCommunity, board: renderBoard, bankroll: renderBankroll, account: renderAccount })[state.view]();
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
    html += `<div class="card tight" style="margin-top:10px"><div class="small" style="color:var(--mint);font-weight:800">ON OFFENSE — ${esc(g.possessionAbbr || '')}</div>
      <div>${esc((detail && detail.downDistanceText) || g.downDistanceText || '')}</div>
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
    <div class="team-line ${winner === 'away' ? 'win' : ''}"><span>${esc(game.away.abbr)} ${esc(game.away.name)}</span><span class="score">${game.away.score ?? ''}</span></div>
    <div class="team-line ${winner === 'home' ? 'win' : ''}"><span>${esc(game.home.abbr)} ${esc(game.home.name)}</span><span class="score">${game.home.score ?? ''}</span></div>`;
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
      const plays = state.fullPlays.has(blockId) ? d.plays : d.plays.slice(0, 5);
      body = `<div class="small" style="color:var(--mint);font-weight:800;margin-top:10px">RECENT PLAYS</div>` +
        (plays.length ? plays.map((pl) => `<div class="play ${pl.scoringPlay ? 'scoring' : ''}"><div class="meta">${esc(pl.periodLabel)} · ${esc(pl.clock)} ${pl.teamAbbr ? '· ' + esc(pl.teamAbbr) : ''} ${pl.category ? '· ' + esc(pl.category.toUpperCase()) : ''}</div><div class="txt">${pl.playersLine ? `<span class="muted">${esc(pl.playersLine)}</span><br>` : ''}${esc(pl.text)}</div></div>`).join('') : '<div class="small muted" style="padding:8px 0">No plays in the feed yet.</div>') +
        (d.plays.length > 5 ? `<button class="btn secondary small" style="margin-top:8px" onclick="toggleFullPlays('${blockId}')">${state.fullPlays.has(blockId) ? 'Show recent only' : `Full play-by-play — all ${d.plays.length} plays`}</button>` : '');
    } else if (tab === 'stats') {
      const teamStats = d.teamStats && d.teamStats.length
        ? `<table class="lines"><tr><th>Stat</th>${d.statTeamAbbrs.map((a) => `<th>${esc(a)}</th>`).join('')}</tr>${d.teamStats.map((s) => `<tr><td>${esc(s.label)}</td>${s.values.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="small muted" style="padding:8px 0">No team stats in the feed.</div>';
      const leaders = d.leaders && d.leaders.length ? `<div class="small" style="color:var(--mint);font-weight:800;margin-top:10px">GAME LEADERS</div>${d.leaders.map((l) => `<div class="kv"><span>${esc(l.team)} · ${esc(l.label)}</span><span>${esc(l.value)}</span></div>`).join('')}` : '';
      body = teamStats + leaders;
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
    if (state.view === 'tickets' || state.view === 'scores') render();
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

function ticketCardHTML(t) {
  const groups = groupLegsByGame(t);
  const ticketOff = state.alerts ? state.alerts.subs.some((s) => s.scope === 'ticket' && s.ticketId === t.id && !s.on) : false;
  const head = `<div class="row between wrap">
      <div><strong>${esc(t.title || `${t.legs.length}-leg ${t.legs[0] ? t.legs[0].league : ''} ticket`)}</strong>
      <div class="small muted">${esc(t.sportsbook)} · Stake ${fmtMoney(t.stake)} · To win ${fmtMoney((t.potentialPayout || 0) - t.stake)} · Payout ${fmtMoney(t.potentialPayout)} ${t.boostedPayout ? '· <span style="color:var(--mint)">boosted</span>' : ''}</div>
      <div class="small muted">${fmtDateTime(t.createdAt)}${t.source === 'morning' ? ' · Morning ticket — from today\'s Board' : ''}${t.source === 'screenshot' ? ' · From screenshot' : ''}</div></div>
      <div class="row">${t.status === 'open' ? '<span class="pill live">Open</span>' : t.status === 'won' ? `<span class="pill won">Won · ${fmtMoney(t.payout)}</span>` : t.status === 'lost' ? '<span class="pill lost">Lost</span>' : '<span class="pill push">Push</span>'}</div>
    </div>
    <div class="row wrap" style="margin-top:8px">
      <button class="btn secondary small" onclick="toggleTicketAlerts(${t.id}, ${ticketOff ? 'true' : 'false'})">🔔 Ticket alerts ${ticketOff ? 'off' : 'on'}</button>
      <button class="btn secondary small" onclick="postToCommunity(${t.id})">Post to Community</button>
      <button class="btn danger small" onclick="deleteTicket(${t.id})">Delete</button>
    </div>`;
  const summary = t.legs && t.legs.length > 1 ? `<div style="border:1.5px solid var(--mint);border-radius:12px;padding:12px;margin-top:12px">
      <div class="row between"><strong style="color:var(--mint)">🧾 THE WHOLE TICKET</strong><span class="small muted">${t.legs.length} legs</span></div>
      ${t.legs.map((l) => `<div style="border-top:1px solid var(--line);padding:7px 0">
        <div class="row between"><span class="sel">${esc(l.selection)}</span><span class="row" style="gap:6px"><strong style="color:var(--mint)">${fmtOdds(l.odds)}</strong>${legStatusPill(l)}</span></div>
        <div class="small muted">${l.gameLabel ? esc(l.gameLabel) + ' · ' : ''}${esc(l.market)}${l.line ? ' · ' + esc(l.line) : ''} · ${esc(l.league)}</div>
      </div>`).join('')}
      <div class="small muted" style="margin-top:6px">Screenshot this block — every leg on one screen. The live sweat for each game is below.</div>
    </div>` : '';
  const body = groups.map((g, gi) => {
    const blockId = `t${t.id}g${gi}`;
    const detail = g.eventId ? state.detailCache.get(String(g.eventId)) : null;
    const legsHtml = g.legs.map((l) => {
      const prop = state.propCache && state.propCache[t.id] ? state.propCache[t.id].find((x) => x.legId === l.id) : null;
      return `<div class="leg"><div class="row between"><span class="sel">${esc(l.selection)}</span>${legStatusPill(l)}</div>
        <div class="small muted">${esc(l.market)}${l.line ? ` · ${esc(l.line)}` : ''} · ${fmtOdds(l.odds)} · ${esc(l.league)}</div>
        ${prop ? (prop.available ? `<div class="small" style="margin-top:5px"><strong>${esc(prop.display || '')}</strong>${prop.progress !== null ? `<div class="propbar"><div style="width:${prop.progress}%"></div></div>` : ''}<span class="muted">${esc(prop.remaining || '')}</span></div>` : `<div class="small muted" style="margin-top:5px">${esc(prop.statusText || '')}</div>`) : ''}
      </div>`;
    }).join('');
    const expanded = state.expandedBlocks.has(blockId);
    return `<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
      ${gameHeaderHTML(g.game, g.league, g.gameLabel)}
      ${legsHtml}
      <button class="btn secondary small" style="margin-top:8px" onclick="toggleGameBlock('${blockId}')">${expanded ? 'Hide game detail ▾' : 'Game detail — plays, stats, scoring ▸'}</button>
      ${expanded ? `
      ${linescoreHTML(detail)}
      ${situationHTML(g.game, detail)}
      ${winProbHTML(detail && detail.winProbHome !== null && detail.winProbHome !== undefined ? { winProbHome: detail.winProbHome, home: g.game ? g.game.home : {}, away: g.game ? g.game.away : {} } : g.game)}
      <div class="row" style="margin-top:8px">${gameAlertToggleHTML(t.id, g.eventId, g.league)}</div>
      ${detailTabsHTML(blockId, g.league, g.eventId)}` : ''}
    </div>`;
  }).join('');
  return `<div class="card">${head}${summary}${body}${t.notes ? `<div class="small muted" style="margin-top:10px">${esc(t.notes)}</div>` : ''}${t.hasImage ? `<img class="ticket-img" src="/api/tickets/${t.id}/image" alt="Ticket screenshot">` : ''}</div>`;
}
async function renderTickets() {
  const el = $('#view-tickets');
  if (!state.user) { el.innerHTML = '<h2>Your Tickets</h2>' + signInPromptHTML('Sign in to add tickets and sweat them live, play by play.'); return; }
  if (!$('#tickets-list')) el.innerHTML = `<div class="row between"><h2>Your Tickets</h2><button class="btn" onclick="openAddTicket()">+ Add Ticket</button></div><div id="tickets-list"><div class="empty">Loading…</div></div>`;
  try {
    await loadTickets();
    const open = state.tickets.filter((t) => t.status === 'open');
    const liveGames = [];
    const seenLive = new Set();
    for (const t of open) for (const g of groupLegsByGame(t)) {
      if (!g.game || g.game.state !== 'in') continue;
      const key = g.eventId ? `ev:${g.eventId}` : `${g.league}|${g.gameLabel}`;
      if (seenLive.has(key)) continue; // same game on several tickets shows ONCE
      seenLive.add(key);
      liveGames.push({ t, g });
    }
    let html = '';
    if (liveGames.length) {
      html += `<h3>Live now — your games</h3>` + liveGames.map(({ g }) => `<div class="card tight">${gameHeaderHTML(g.game, g.league, g.gameLabel)}</div>`).join('');
    }
    html += state.tickets.length ? state.tickets.map(ticketCardHTML).join('') : '<div class="card"><div class="empty">No tickets yet.<br>Tap + Add Ticket — screenshot or type it in.</div></div>';
    $('#tickets-list').innerHTML = html;
    // fetch details + prop progress for open tickets
    state.propCache = state.propCache || {};
    for (const t of open) {
      groupLegsByGame(t).forEach((g, gi) => { if (g.eventId && state.expandedBlocks.has(`t${t.id}g${gi}`)) ensureDetail(g.league, g.eventId); });
      api('GET', `/api/props?ticketId=${t.id}`).then((d) => { state.propCache[t.id] = d.props || []; if (state.view === 'tickets') renderTicketsLight(); }).catch(() => {});
    }
  } catch (e) {
    $('#tickets-list').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function renderTicketsLight() {
  const list = $('#tickets-list');
  if (!list) return;
  const open = state.tickets.filter((t) => t.status === 'open');
  let html = '';
  const liveGames = [];
  for (const t of open) for (const g of groupLegsByGame(t)) if (g.game && g.game.state === 'in') liveGames.push({ t, g });
  if (liveGames.length) html += `<h3>Live now — your games</h3>` + liveGames.map(({ g }) => `<div class="card tight">${gameHeaderHTML(g.game, g.league, g.gameLabel)}</div>`).join('');
  html += state.tickets.length ? state.tickets.map(ticketCardHTML).join('') : '<div class="card"><div class="empty">No tickets yet.</div></div>';
  list.innerHTML = html;
  for (const t of open) for (const g of groupLegsByGame(t)) if (g.eventId) ensureDetail(g.league, g.eventId);
}
async function deleteTicket(id) {
  if (!confirm('Delete this ticket? This cannot be undone.')) return;
  await api('DELETE', `/api/tickets/${id}`);
  state.tickets = state.tickets.filter((t) => t.id !== id);
  render();
}
async function postToCommunity(id) {
  try { await api('POST', '/api/community/ticket', { ticketId: id }); alert('Posted to Community.'); showView('community'); }
  catch (e) { alert(e.message); }
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
      runOcr(pendingImageDataUrl);
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
];
const COLLEGE_TOKENS = ['UTSA','South Florida','UCF','FAU','FIU','Miami','Florida State','Florida','Georgia','Alabama','Texas','Ohio State','Michigan','LSU','Tennessee','Oklahoma','Notre Dame','Clemson','Penn State','Oregon','USC','UCLA','Auburn','Texas A&M','Ole Miss','Arkansas','Kentucky','South Carolina','Mississippi State','Vanderbilt','Missouri','Iowa','Wisconsin','Nebraska','Illinois','Indiana','Purdue','Michigan State','Rutgers','Maryland','Northwestern','Minnesota','Washington','Utah','Arizona','Arizona State','Colorado','BYU','Kansas','Kansas State','Iowa State','TCU','Baylor','Texas Tech','Houston','Cincinnati','West Virginia','Oklahoma State','Syracuse','Pittsburgh','Louisville','NC State','Duke','North Carolina','Virginia','Virginia Tech','Georgia Tech','Wake Forest','Boston College','Stanford','California','SMU','Memphis','Tulane','Boise State','Fresno State','San Diego State','UNLV','Air Force','Army','Navy','Liberty','App State','Coastal Carolina','Marshall','Troy','Louisiana','Georgia Southern','Old Dominion','Western Kentucky','Middle Tennessee','UTEP','New Mexico State','Sam Houston','Jacksonville State','Kennesaw State','Delaware','Missouri State'];
function lookupTeam(name) {
  const n = (name || '').trim();
  if (!n) return null;
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
function parseSlipText(raw) {
  const lines = raw.split('\n').map((s) => s.replace(/^[^A-Za-z0-9+$-]+/, '').trim()).filter(Boolean);
  const legs = [];
  const oddsAtEnd = /^(.+?)\s+([+-]\d{3,4})$/;
  const oddsOnly = /^([+-]\d{3,4})$/;
  const isHeader = (t) => /parlay|payout|wager|hide selections|track on lock|my bets/i.test(t);
  for (let i = 0; i < lines.length; i++) {
    let selText = null, odds = null;
    let m = lines[i].match(oddsAtEnd);
    if (m && !isHeader(m[1])) { selText = m[1].trim(); odds = parseInt(m[2], 10); }
    else if (oddsOnly.test(lines[i]) && i > 0 && !oddsAtEnd.test(lines[i - 1])) { selText = lines[i - 1]; odds = parseInt(lines[i], 10); }
    if (selText === null || odds === null || Number.isNaN(odds)) continue;
    if (/^\d+\s*-?\s*bet/i.test(selText)) continue;
    // gather context from the next few lines
    let market = '', gameLabel = '', startsAt = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const L = lines[j];
      if (oddsAtEnd.test(L) || oddsOnly.test(L)) break;
      if (/^to win$/i.test(L) || /moneyline/i.test(L)) market = 'Moneyline';
      else if (/spread/i.test(L)) market = 'Spread';
      else if (/^(over|under|total)/i.test(L)) market = 'Total';
      if (L.includes('@')) gameLabel = L.replace(/\s+/g, ' ');
      if (/:\d{2}\s*(am|pm)/i.test(L)) startsAt = parseStartTime(L);
    }
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
    // expand matchup team names
    let league = selTeam ? selTeam.league : '';
    if (gameLabel.includes('@')) {
      const [a, b] = gameLabel.split('@').map((s) => s.trim());
      const ta = lookupTeam(a), tb = lookupTeam(b);
      // OCR garbage lines (nav bars, icon rows) can contain '@' — if neither side
      // resolves to any known team and the line has junk symbols, leave it blank.
      if (!ta && !tb && /[&•|]/.test(gameLabel)) gameLabel = '';
      else gameLabel = `${ta ? ta.full : a} @ ${tb ? tb.full : b}`;
      if (!league) league = (ta && ta.league) || (tb && tb.league) || '';
    }
    legs.push({ league: league || 'NFL', market, gameLabel, selection, line, odds, startsAt });
  }
  // Salvage pass: a leg whose odds OCR garbled (e.g. "Golden Knights 0)") still
  // shows up with a blank odds field for review instead of vanishing entirely.
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.includes('@') || oddsAtEnd.test(L) || oddsOnly.test(L) || isHeader(L)) continue;
    const words = L.split(/\s+/);
    let team = null;
    for (let k = words.length; k >= 1; k--) { const t = lookupTeam(words.slice(0, k).join(' ')); if (t) { team = t; break; } }
    if (!team) continue;
    if (legs.some((l) => l.selection.startsWith(team.full))) continue;
    let market = '', gameLabel = '', startsAt = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const X = lines[j];
      if (/^to win$/i.test(X) || /moneyline/i.test(X)) market = 'Moneyline';
      else if (/spread/i.test(X)) market = 'Spread';
      else if (/^(over|under|total)/i.test(X)) market = 'Total';
      if (X.includes('@')) { const [a, b] = X.split('@').map((s) => s.trim()); const ta = lookupTeam(a), tb = lookupTeam(b); if (ta || tb) gameLabel = `${ta ? ta.full : a} @ ${tb ? tb.full : b}`; }
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
  return { legs, stake, slipId: idm ? idm[1] : '', expectedLegs: cm ? parseInt(cm[1], 10) : 0 };
}
async function runOcr(dataUrl) {
  const status = $('#ocr-status');
  if (!window.Tesseract) { status.textContent = 'OCR is unavailable right now — the screenshot will attach; type the legs below.'; return; }
  status.textContent = 'Reading your ticket…';
  try {
    const { data } = await Tesseract.recognize(dataUrl, 'eng');
    pendingOcrText = data.text || '';
    const parsed = parseSlipText(pendingOcrText);
    if (parsed.stake && !$('#tf-stake').value) $('#tf-stake').value = parsed.stake;
    const notes = $('#tf-notes');
    if (parsed.legs.length) {
      $('#legs-wrap').innerHTML = '';
      parsed.legs.forEach((leg) => addLegRow(leg));
      if (parsed.slipId && !notes.value) notes.value = `Hard Rock Bet slip ${parsed.slipId}`;
      const missing = parsed.expectedLegs && parsed.expectedLegs > parsed.legs.length ? parsed.expectedLegs - parsed.legs.length : 0;
      status.textContent = missing
        ? `Read ${parsed.legs.length} of ${parsed.expectedLegs} legs — ${missing} didn't read cleanly. Check each leg below, fill in any blank odds, and fix anything wrong before saving.`
        : `Read ${parsed.legs.length} leg${parsed.legs.length > 1 ? 's' : ''} from your screenshot — check each one below and fix anything wrong before saving.`;
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
  for (const l of legs) if (Number.isNaN(l.odds)) { err.innerHTML = '<div class="err" style="margin-top:10px">Every leg needs American odds (like -110 or +150).</div>'; return; }
  try {
    const d = await api('POST', '/api/tickets', {
      title: $('#tf-title').value.trim(), sportsbook: $('#tf-book').value.trim() || 'Hard Rock Bet',
      stake: parseFloat($('#tf-stake').value) || 0, notes: $('#tf-notes').value.trim(),
      boostedPayout: parseFloat($('#tf-boosted').value) || null,
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
    if (imageFailed) alert('Ticket saved — but the screenshot could not be attached. The ticket itself is in your list.');
  } catch (e) { err.innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}</div>`; }
}

/* ================= SCORES ================= */
async function renderScores() {
  const el = $('#view-scores');
  if (!$('#scores-list')) {
    const chips = LEAGUES.map((l) => `<button class="chip ${state.scoresLeague === l ? 'on' : ''}" onclick="setScoresLeague('${l}')">${l}</button>`).join('');
    el.innerHTML = `<h2>Scores</h2><div class="chips">${chips}</div><div id="your-games"></div><div id="scores-list"><div class="empty">Loading scores…</div></div>`;
  } else {
    $$('.chip', el).forEach((c) => c.classList.toggle('on', c.textContent === state.scoresLeague));
  }
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
    const d = await api('GET', `/api/scores?league=${state.scoresLeague}`);
    state.scoresCache[state.scoresLeague] = d;
    const list = $('#scores-list');
    if (!list) return;
    if (d.error) { list.innerHTML = `<div class="err">${esc(d.error)}</div>`; return; }
    list.innerHTML = `<h3>${esc(state.scoresLeague)}</h3>` + (d.games.length ? d.games.map((g) => `<div class="card tight" onclick="openGameDetail('${g.league}','${g.id}')" style="cursor:pointer">${gameHeaderHTML(g, g.league)}</div>`).join('') : '<div class="card"><div class="empty">No games in the window.</div></div>') +
      `<div class="small muted">Updated ${fmtDateTime(d.fetchedAt)}</div>`;
  } catch (e) {
    const list = $('#scores-list'); if (list) list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function setScoresLeague(l) { state.scoresLeague = l; renderScores(); }

/* ================= NEWS ================= */
/* ================= PROPS ================= */
function isBoardPropPlay(pl) {
  const m = (pl.market || '').toLowerCase();
  if (m.includes('prop') || m.includes('player')) return true;
  const t = (pl.play || '').toLowerCase();
  return /\b(over|under)\s+\d/.test(t) && /(yard|reception|point|rebound|assist|strikeout|hits|goal|shot|touchdown|passing|rushing|receiving|threes|blocks|steals|saves)/.test(t);
}
async function renderProps() {
  const el = $('#view-props');
  el.innerHTML = `<h2>Player Props</h2><div id="props-body"><div class="empty">Loading props…</div></div>`;
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
    const myCard = (p) => `<div class="card tight">
      <div class="row between"><strong>${esc(p.player || p.selection)}</strong><span class="pill ${p.legStatus === 'won' ? 'won' : p.legStatus === 'lost' ? 'lost' : 'pending'}">${esc(p.legStatus)}</span></div>
      <div class="small muted">${esc(p.statLabel || '')}${p.line !== null && p.line !== undefined ? ` · ${p.dir === 'under' ? 'Under' : 'Over'} ${p.line}` : ''} · ${fmtOdds(p.odds)} · ${esc(p.league)}</div>
      <div class="small muted">${esc(p.gameLabel || '')}${p.gameState === 'in' ? ` · <span style="color:var(--red)">LIVE</span> ${esc(p.gameDetail || '')}` : p.gameState === 'post' ? ' · Final' : p.startsAt ? ' · ' + fmtDateTime(p.startsAt) : ''}</div>
      ${p.available ? `<div class="small" style="margin-top:5px"><strong>${esc(p.display || '')}</strong>${p.progress !== null && p.progress !== undefined ? `<div class="propbar"><div style="width:${p.progress}%"></div></div>` : ''}<span class="muted">${esc(p.remaining || '')}</span></div>` : `<div class="small muted" style="margin-top:5px">${esc(p.statusText || '')}</div>`}
      <div class="small muted" style="margin-top:4px">On: ${esc(p.ticketTitle || 'a ticket')}</div>
    </div>`;
    const boardCard = (pl) => `<div class="card tight"><div class="row between"><strong>${esc(pl.play)}</strong><span>${pl.odds !== null && pl.odds !== undefined ? fmtOdds(pl.odds) : ''}</span></div>
      <div class="small muted">${esc(pl.league)}${pl.market ? ' · ' + esc(pl.market) : ''} · ${esc(pl.sportsbook)}${pl.tier !== 'watch' ? ' · <span style="color:var(--mint)">Actionable</span>' : ' · Watch'}</div>
      ${pl.edgeNote ? `<div class="small" style="margin-top:4px">${esc(pl.edgeNote)}</div>` : ''}
      ${pl.verified ? `<div class="small" style="color:var(--mint);margin-top:4px">✓ Verified on Hard Rock Bet${pl.verifiedAt ? ' · ' + fmtDateTime(pl.verifiedAt) : ''}</div>` : ''}</div>`;
    body().innerHTML = `
      <h3>Your props — live</h3>
      ${!state.user ? `<div class="card"><div class="empty">Sign in to sweat your prop legs here.<br><button class="btn" style="margin-top:8px" onclick="showView('account')">Sign in</button></div></div>`
        : mine.length ? mine.map(myCard).join('') : `<div class="card"><div class="empty">No player props on your open tickets right now.<br>Any ticket you add with a player prop leg — screenshot or typed — sweats here live with a progress bar.</div></div>`}
      <h3 style="margin-top:18px">Today's prop plays — from the Board${boardDate ? ` · ${fmtDay(boardDate)}` : ''}</h3>
      ${boardProps.length ? boardProps.map(boardCard).join('') : `<div class="card"><div class="empty">No player props on today's Board — today was all sides and totals.<br>When the morning Board carries props, they land here with the verified Hard Rock line.</div></div>`}`;
  } catch (e) {
    body().innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function renderNews() {
  const el = $('#view-news');
  if (!$('#news-list')) {
    const chips = LEAGUES.map((l) => `<button class="chip ${state.newsLeague === l ? 'on' : ''}" onclick="setNewsLeague('${l}')">${l}</button>`).join('');
    el.innerHTML = `<h2>Sports News</h2><div class="small muted" style="margin:-6px 2px 12px">The latest from ESPN — injuries, trades, and the storylines that move lines. Know what's going on before you sweat it.</div><div class="chips">${chips}</div><div id="news-list"><div class="empty">Loading news…</div></div>`;
  } else {
    $$('.chip', el).forEach((c) => c.classList.toggle('on', c.textContent === state.newsLeague));
  }
  try {
    const d = await api('GET', `/api/news?league=${state.newsLeague}`);
    const list = $('#news-list');
    if (!list) return;
    if (d.error) { list.innerHTML = `<div class="err">${esc(d.error)}</div>`; return; }
    list.innerHTML = (d.items.length ? d.items.map((a) => `
      <div class="card tight">
        ${a.url ? `<a class="news-head" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a>` : `<div class="news-head">${esc(a.headline)}</div>`}
        ${a.description ? `<div class="small" style="margin-top:4px">${esc(a.description)}</div>` : ''}
        <div class="tiny muted" style="margin-top:6px">${esc(a.source || 'ESPN')} · ${esc(fmtDateTime(a.published))}</div>
      </div>`).join('') : '<div class="card"><div class="empty">No headlines right now.</div></div>')
      + `<div class="small muted">Updated ${fmtDateTime(d.fetchedAt)}</div>`;
  } catch (e) {
    const list = $('#news-list'); if (list) list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
function setNewsLeague(l) { state.newsLeague = l; renderNews(); }
async function openGameDetail(league, eventId) {
  const blockId = `score-${eventId}`;
  openSheet(`<h3>Game Detail</h3><div id="gd-body"><div class="empty">Loading…</div></div><button class="btn secondary" style="margin-top:12px" onclick="closeSheet()">Close</button>`);
  try {
    const d = await api('GET', `/api/game?league=${encodeURIComponent(league)}&eventId=${encodeURIComponent(eventId)}`);
    d.at = Date.now();
    state.detailCache.set(String(eventId), d);
    const g = d.game || null;
    const body = $('#gd-body');
    if (!body) return;
    body.innerHTML = `${gameHeaderHTML(g, league)}
      ${linescoreHTML(d)}
      ${situationHTML(g, d)}
      ${winProbHTML(d.winProbHome !== null && d.winProbHome !== undefined && g ? { winProbHome: d.winProbHome, home: g.home, away: g.away } : null)}
      ${detailTabsHTML(blockId, league, eventId)}`;
  } catch (e) {
    const body = $('#gd-body'); if (body) body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

/* ================= BOARD ================= */
async function renderBoard() {
  const el = $('#view-board');
  el.innerHTML = `<h2>Today's Board</h2><div id="board-body"><div class="empty">Loading the Board…</div></div>`;
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
      ${watch.length ? `<h3>Watch</h3>${watch.map(playCard).join('')}` : ''}`;
  } catch (e) {
    $('#board-body').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
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
  el.innerHTML = '<h2>Community</h2><div id="comm-body"><div class="empty">Loading the room…</div></div>';
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
        ${post.mine && state.user ? `<button class="reaction-btn" onclick="deletePost(${post.id})">Delete</button>` : ''}
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
  try { await api('POST', '/api/community/posts', { body }); renderCommunity(); } catch (e) { alert(e.message); }
}
async function addComment(postId) {
  const input = $(`#comment-${postId}`);
  const body = input.value.trim();
  if (!body) return;
  try { await api('POST', `/api/community/posts/${postId}/comments`, { body }); renderCommunity(); } catch (e) { alert(e.message); }
}
async function toggleReaction(postId, reaction) {
  if (!state.user) { alert('Sign in to react.'); showView('account'); return; }
  try { await api('POST', `/api/community/posts/${postId}/reactions`, { reaction }); renderCommunity(); } catch (e) { alert(e.message); }
}
async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  try { await api('DELETE', `/api/community/posts/${postId}`); renderCommunity(); } catch (e) { alert(e.message); }
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
      <div class="small muted" style="margin-bottom:8px">Alerts live here in the app, with a badge on the bell. <strong>Push notifications are not included</strong> — nothing is sent to your phone's lock screen.</div>
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

/* ================= boot + refresh ================= */
(async function boot() {
  await refreshMe();
  render();
})();
