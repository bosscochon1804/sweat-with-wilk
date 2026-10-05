'use strict';
/* Sweat With Wilk — standalone bet tracker.
   Zero external dependencies: node:http, node:sqlite, node:crypto, global fetch. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const PUSH_TOKEN = process.env.PUSH_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- database ---------------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  default_book TEXT NOT NULL DEFAULT 'Hard Rock Bet',
  starting_bankroll REAL NOT NULL DEFAULT 0,
  unit_size REAL NOT NULL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sportsbook TEXT NOT NULL DEFAULT 'Hard Rock Bet',
  stake REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  boosted_payout REAL,
  status TEXT NOT NULL DEFAULT 'open',
  payout REAL,
  image_file TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  league TEXT NOT NULL DEFAULT '',
  game_label TEXT NOT NULL DEFAULT '',
  selection TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  line TEXT NOT NULL DEFAULT '',
  odds INTEGER NOT NULL DEFAULT -110,
  starts_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  event_id TEXT,
  final_value REAL
);
CREATE TABLE IF NOT EXISTS board_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_date TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT '',
  play TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  odds INTEGER,
  tier TEXT NOT NULL DEFAULT 'actionable',
  edge_note TEXT NOT NULL DEFAULT '',
  sportsbook TEXT NOT NULL DEFAULT 'Hard Rock Bet',
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(board_date, league, play)
);
CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'discussion',
  body TEXT NOT NULL DEFAULT '',
  ticket_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS community_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS community_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reaction TEXT NOT NULL,
  UNIQUE(post_id, user_id, reaction)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  ticket_id INTEGER,
  event_id TEXT,
  dedupe_key TEXT UNIQUE NOT NULL,
  held_quietly INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_prefs (
  user_id INTEGER PRIMARY KEY,
  prefs TEXT NOT NULL DEFAULT '{}',
  quiet_start TEXT NOT NULL DEFAULT '',
  quiet_end TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS alert_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  ticket_id INTEGER,
  event_id TEXT,
  on_flag INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, scope, ticket_id, event_id)
);
CREATE TABLE IF NOT EXISTS alert_leg_states (
  leg_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`);

/* ---------------- small utils ---------------- */
const nowISO = () => new Date().toISOString();
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limitBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashCode(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
function makeRecoveryCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const seg = (n) => Array.from(crypto.randomBytes(n)).map((b) => alphabet[b % alphabet.length]).join('');
  return `${seg(4)}-${seg(4)}`;
}
function decimalFromAmerican(odds) {
  odds = Number(odds) || 0;
  if (odds > 0) return 1 + odds / 100;
  if (odds < 0) return 1 + 100 / Math.abs(odds);
  return 1;
}
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* Eastern Time helpers (ESPN rolls its day on UTC; we query a 3-day ET window) */
function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function etDatesWindow() {
  const out = [];
  const now = new Date();
  for (const off of [-1, 0, 1]) {
    const d = new Date(now.getTime() + off * 86400000);
    out.push(etDateStr(d).replace(/-/g, ''));
  }
  return out;
}
function etHourNow() {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date());
  return parseInt(s, 10) % 24;
}

/* ---------------- auth ---------------- */
function currentUser(req) {
  const token = parseCookies(req).sww_session;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const u = db.prepare('SELECT id, username, email, display_name, created_at FROM users WHERE id = ?').get(s.user_id);
  return u || null;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, nowISO(), exp);
  res.setHeader('Set-Cookie', `sww_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
  return token;
}
function endSession(req, res) {
  const token = parseCookies(req).sww_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sww_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function getSettings(userId) {
  let s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!s) {
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
    s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  }
  return { defaultBook: s.default_book, startingBankroll: s.starting_bankroll, unitSize: s.unit_size };
}
function displayNameOf(u) { return (u.display_name || '').trim() || u.username; }

/* ---------------- ESPN layer ---------------- */
const LEAGUES = {
  NFL: ['football', 'nfl'], NCAAF: ['football', 'college-football'],
  NBA: ['basketball', 'nba'], WNBA: ['basketball', 'wnba'],
  NCAAB: ['basketball', 'mens-college-basketball'], NCAAW: ['basketball', 'womens-college-basketball'],
  MLB: ['baseball', 'mlb'], NHL: ['hockey', 'nhl'],
  UFC: ['mma', 'ufc'], MLS: ['soccer', 'usa.1'], EPL: ['soccer', 'eng.1'],
};
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const cache = new Map(); // key -> {at, data}
async function fetchJSON(url, ttlMs = 15000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const r = await fetch(url, { headers: { 'User-Agent': 'SweatWithWilk/1.0' } });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  const data = await r.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}
function leaguePath(league) {
  const p = LEAGUES[(league || '').toUpperCase()];
  return p ? `${p[0]}/${p[1]}` : null;
}
function normalizeGame(ev, league) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
  const st = ev.status || comp.status || {};
  const sit = comp.situation || {};
  const team = (c) => ({
    abbr: (c.team && (c.team.abbreviation || c.team.shortDisplayName)) || '',
    name: (c.team && (c.team.displayName || c.team.name)) || '',
    shortName: (c.team && (c.team.shortDisplayName || c.team.name)) || '',
    record: (c.records && c.records[0] && c.records[0].summary) || '',
    score: c.score === undefined || c.score === '' ? null : Number(c.score),
  });
  return {
    id: String(ev.id),
    league,
    state: (st.type && st.type.state) || 'pre',
    detail: (st.type && (st.type.shortDetail || st.type.detail)) || '',
    clock: st.displayClock || '',
    period: st.period || 0,
    start: ev.date || comp.date || '',
    home: team(home), away: team(away),
    broadcasts: (comp.broadcasts || []).flatMap((b) => b.names || []),
    venue: (comp.venue && comp.venue.fullName) || '',
    possessionAbbr: sit.possession ? ((competitors.find((c) => String(c.id) === String(sit.possession)) || {}).team || {}).abbreviation || '' : '',
    downDistanceText: sit.downDistanceText || '',
    situationText: sit.lastPlay ? (sit.lastPlay.text || '') : '',
    lastPlayText: sit.lastPlay ? (sit.lastPlay.text || '') : '',
    balls: sit.balls ?? null, strikes: sit.strikes ?? null, outs: sit.outs ?? null,
    onFirst: !!sit.onFirst, onSecond: !!sit.onSecond, onThird: !!sit.onThird,
    batterName: '', winProbHome: null,
  };
}
async function getScoreboardWindow(league) {
  const p = leaguePath(league);
  if (!p) throw new Error(`unknown league ${league}`);
  const byId = new Map();
  for (const d of etDatesWindow()) {
    const data = await fetchJSON(`${ESPN_BASE}/${p}/scoreboard?dates=${d}`, 20000);
    for (const ev of data.events || []) {
      const g = normalizeGame(ev, league.toUpperCase());
      byId.set(g.id, g);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
async function getSummary(league, eventId) {
  const p = leaguePath(league);
  if (!p) throw new Error(`unknown league ${league}`);
  return fetchJSON(`${ESPN_BASE}/${p}/summary?event=${encodeURIComponent(eventId)}`, 12000);
}
function normalizePlay(pl, homeAbbr, awayAbbr) {
  const period = pl.period || {};
  return {
    id: String(pl.id || ''),
    periodLabel: period.displayValue || (period.number ? String(period.number) : ''),
    periodNumber: period.number || 0,
    clock: (pl.clock && pl.clock.displayValue) || '',
    teamAbbr: (pl.team && pl.team.abbreviation) || '',
    category: (pl.type && pl.type.text) || '',
    text: pl.text || pl.shortText || '',
    playersLine: (pl.participants || []).map((x) => (x.athlete && x.athlete.displayName) || '').filter(Boolean).join(' · '),
    scoringPlay: !!pl.scoringPlay,
    scoreValue: pl.scoreValue || 0,
    homeScore: pl.homeScore ?? null,
    awayScore: pl.awayScore ?? null,
  };
}
function normalizeDetail(sum, league, eventId) {
  const header = sum.header || {};
  const comp = (header.competitions && header.competitions[0]) || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
  const homeAbbr = (home.team && home.team.abbreviation) || '';
  const awayAbbr = (away.team && away.team.abbreviation) || '';
  const linescores = competitors.map((c) => ({
    abbr: (c.team && c.team.abbreviation) || '',
    periods: (c.linescores || []).map((l) => String(l.displayValue ?? l.value ?? '')),
    total: c.score ?? '',
  }));
  // plays: summary.plays for NHL/MLB/most; NFL nests under drives
  let rawPlays = [];
  if (Array.isArray(sum.plays)) rawPlays = sum.plays;
  else if (sum.drives) {
    for (const drv of [...(sum.drives.previous || []), ...(sum.drives.current ? [sum.drives.current] : [])]) {
      for (const pl of drv.plays || []) rawPlays.push(pl);
    }
  }
  const plays = rawPlays.map((pl) => normalizePlay(pl, homeAbbr, awayAbbr)).reverse();
  const scoringPlays = plays.filter((p) => p.scoringPlay);
  // team stats
  const boxTeams = (sum.boxscore && sum.boxscore.teams) || [];
  const teamStats = [];
  const statTeamAbbrs = boxTeams.map((t) => (t.team && t.team.abbreviation) || '');
  const statMap = new Map();
  boxTeams.forEach((t, ti) => {
    for (const s of t.statistics || []) {
      if (!statMap.has(s.label || s.name)) statMap.set(s.label || s.name, { label: s.label || s.name, values: [] });
      statMap.get(s.label || s.name).values[ti] = s.displayValue ?? '';
    }
  });
  for (const v of statMap.values()) teamStats.push(v);
  // player stats
  const playerStats = [];
  for (const pg of (sum.boxscore && sum.boxscore.players) || []) {
    const teamAbbr = (pg.team && pg.team.abbreviation) || '';
    for (const cat of pg.statistics || []) {
      const columns = cat.labels || cat.names || [];
      const rows = (cat.athletes || []).map((a) => ({
        player: (a.athlete && a.athlete.displayName) || '',
        playerId: (a.athlete && String(a.athlete.id)) || '',
        values: a.stats || [],
      }));
      playerStats.push({ teamAbbr, category: cat.name || cat.displayName || '', columns, rows });
    }
  }
  const leaders = [];
  for (const lg of sum.leaders || []) {
    const teamAbbr = (lg.team && lg.team.abbreviation) || '';
    for (const l of lg.leaders || []) {
      leaders.push({ label: lg.displayName || lg.name || '', team: teamAbbr, value: `${(l.athlete && l.athlete.displayName) || ''} — ${l.displayValue || ''}` });
    }
  }
  let winProbHome = null;
  if (Array.isArray(sum.winprobability) && sum.winprobability.length) {
    const last = sum.winprobability[sum.winprobability.length - 1];
    if (typeof last.homeWinPercentage === 'number') winProbHome = Math.round(last.homeWinPercentage * 1000) / 10;
  }
  const sit = sum.situation || comp.situation || {};
  return {
    eventId: String(eventId), league,
    homeAbbr, awayAbbr, linescores, plays, scoringPlays, teamStats, statTeamAbbrs, playerStats, leaders,
    winProbHome,
    downDistanceText: sit.downDistanceText || '',
    driveText: sit.driveText || '',
    possessionAbbr: sit.possession ? ((competitors.find((c) => String(c.id) === String(sit.possession)) || {}).team || {}).abbreviation || '' : '',
    balls: sit.balls ?? null, strikes: sit.strikes ?? null, outs: sit.outs ?? null,
    onFirst: !!sit.onFirst, onSecond: !!sit.onSecond, onThird: !!sit.onThird,
    batterName: sit.batter ? (sit.batter.athlete && sit.batter.athlete.displayName) || '' : '',
    lastPlayText: sit.lastPlay ? (sit.lastPlay.text || '') : '',
    venue: (sum.gameInfo && sum.gameInfo.venue && sum.gameInfo.venue.fullName) || '',
  };
}

/* ---------------- team matching & grading ---------------- */
const STOP_TOKENS = new Set(['the', 'at', 'vs', 'ml', 'moneyline']);
function tokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP_TOKENS.has(t));
}
function teamTokenHit(team, textTokens) {
  // a team matches if its nickname (last token of display name) or its full-name tokens hit
  const nameToks = tokens(team.name);
  const nick = nameToks[nameToks.length - 1];
  const abbr = (team.abbr || '').toLowerCase();
  let hits = 0;
  for (const t of nameToks) if (textTokens.includes(t)) hits++;
  return { hits, nickHit: nick && textTokens.includes(nick), abbrHit: abbr.length >= 2 && textTokens.includes(abbr) };
}
/* A game matches a leg ONLY when BOTH teams hit (never a single team). */
function matchGameForLeg(leg, games) {
  if (leg.event_id) {
    const g = games.find((x) => x.id === String(leg.event_id));
    if (g) return g;
  }
  const text = `${leg.game_label || ''} ${leg.selection || ''}`;
  const tt = tokens(text);
  let best = null;
  for (const g of games) {
    const a = teamTokenHit(g.away, tt);
    const h = teamTokenHit(g.home, tt);
    const awayOk = a.nickHit || a.hits >= 2 || a.abbrHit;
    const homeOk = h.nickHit || h.hits >= 2 || h.abbrHit;
    if (awayOk && homeOk) {
      const score = a.hits + h.hits;
      if (!best || score > best.score) best = { game: g, score };
    }
  }
  return best ? best.game : null;
}
function pickTeam(leg, game) {
  // The SELECTION names the side — the game label names both teams (it's the matchup),
  // so only the selection text may be used to pick a side.
  const tt = tokens(leg.selection || '');
  const a = teamTokenHit(game.away, tt);
  const h = teamTokenHit(game.home, tt);
  const aOk = a.nickHit || a.abbrHit || a.hits >= 1;
  const hOk = h.nickHit || h.abbrHit || h.hits >= 1;
  if (aOk && !hOk) return 'away';
  if (hOk && !aOk) return 'home';
  return null;
}
function parseNumber(text) {
  const m = String(text || '').match(/([+-]?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function gradeTeamLeg(leg, game) {
  if (game.state !== 'post') return null;
  const market = (leg.market || '').toLowerCase();
  const sel = (leg.selection || '').toLowerCase();
  const isTotal = market.includes('total') || /\b(over|under)\b/.test(sel) || /\b(over|under)\b/.test((leg.line || '').toLowerCase());
  if (isTotal) {
    const src = `${leg.line || ''} ${leg.selection || ''}`;
    const dir = /under/.test(src.toLowerCase()) ? 'under' : (/over/.test(src.toLowerCase()) ? 'over' : null);
    const num = parseNumber(src.replace(/(over|under)/i, ' '));
    if (dir === null || num === null || game.home.score === null || game.away.score === null) return null;
    const total = game.home.score + game.away.score;
    if (total === num) return 'push';
    return (dir === 'over' ? total > num : total < num) ? 'won' : 'lost';
  }
  const side = pickTeam(leg, game);
  if (!side) return null;
  const mine = side === 'home' ? game.home.score : game.away.score;
  const theirs = side === 'home' ? game.away.score : game.home.score;
  if (mine === null || theirs === null) return null;
  const isSpread = market.includes('spread') || market.includes('run line') || market.includes('puck line') || (/[+-]\d/.test(leg.line || '') && !market.includes('moneyline'));
  if (isSpread) {
    const num = parseNumber(leg.line) ?? parseNumber(leg.selection);
    if (num === null) return null;
    const adj = mine + num;
    if (adj === theirs) return 'push';
    return adj > theirs ? 'won' : 'lost';
  }
  // moneyline
  if (mine === theirs) return 'push';
  return mine > theirs ? 'won' : 'lost';
}
function liveTeamLegState(leg, game) {
  if (!game || game.state !== 'in') return null;
  const market = (leg.market || '').toLowerCase();
  const sel = (leg.selection || '').toLowerCase();
  const isTotal = market.includes('total') || /\b(over|under)\b/.test(sel) || /\b(over|under)\b/.test((leg.line || '').toLowerCase());
  if (game.home.score === null || game.away.score === null) return null;
  if (isTotal) {
    const src = `${leg.line || ''} ${leg.selection || ''}`;
    const dir = /under/.test(src.toLowerCase()) ? 'under' : 'over';
    const num = parseNumber(src.replace(/(over|under)/i, ' '));
    if (num === null) return null;
    const total = game.home.score + game.away.score;
    if (total === num) return 'tied';
    return (dir === 'over' ? total > num : total < num) ? 'winning' : 'losing';
  }
  const side = pickTeam(leg, game);
  if (!side) return null;
  const mine = side === 'home' ? game.home.score : game.away.score;
  const theirs = side === 'home' ? game.away.score : game.home.score;
  const isSpread = market.includes('spread') || market.includes('run line') || market.includes('puck line');
  if (isSpread) {
    const num = parseNumber(leg.line) ?? parseNumber(leg.selection);
    if (num === null) return null;
    const adj = mine + num;
    if (adj === theirs) return 'tied';
    return adj > theirs ? 'winning' : 'losing';
  }
  if (mine === theirs) return 'tied';
  return mine > theirs ? 'winning' : 'losing';
}

/* ---------------- props ---------------- */
/* Taxonomy from the original product audit, mapped to ESPN boxscore categories/labels. */
const PROP_STATS = [
  { keys: ['anytime td', 'anytime touchdown', 'to score a touchdown', 'td scorer'], stat: 'anytime_td', label: 'Anytime TD' },
  { keys: ['passing yards', 'pass yards'], stat: 'pass_yards', label: 'Passing Yards', cats: ['passing'], labels: ['YDS'] },
  { keys: ['passing touchdowns', 'passing tds', 'pass tds'], stat: 'pass_td', label: 'Passing TDs', cats: ['passing'], labels: ['TD'] },
  { keys: ['interceptions thrown', 'interceptions'], stat: 'pass_int', label: 'Interceptions', cats: ['passing'], labels: ['INT'] },
  { keys: ['completions'], stat: 'completions', label: 'Completions', cats: ['passing'], labels: ['COMP', 'C'] },
  { keys: ['rushing yards', 'rush yards'], stat: 'rush_yards', label: 'Rushing Yards', cats: ['rushing'], labels: ['YDS'] },
  { keys: ['rushing touchdowns', 'rushing tds', 'rush tds'], stat: 'rush_td', label: 'Rushing TDs', cats: ['rushing'], labels: ['TD'] },
  { keys: ['carries', 'rushing attempts'], stat: 'carries', label: 'Carries', cats: ['rushing'], labels: ['CAR', 'ATT'] },
  { keys: ['receiving yards', 'rec yards'], stat: 'rec_yards', label: 'Receiving Yards', cats: ['receiving'], labels: ['YDS'] },
  { keys: ['receptions'], stat: 'receptions', label: 'Receptions', cats: ['receiving'], labels: ['REC'] },
  { keys: ['receiving touchdowns', 'receiving tds'], stat: 'rec_td', label: 'Receiving TDs', cats: ['receiving'], labels: ['TD'] },
  { keys: ['points'], stat: 'points', label: 'Points', cats: ['forwards', 'defenses', ''], labels: ['PTS'] },
  { keys: ['rebounds'], stat: 'rebounds', label: 'Rebounds', cats: [''], labels: ['REB'] },
  { keys: ['assists'], stat: 'assists', label: 'Assists', cats: ['forwards', 'defenses', ''], labels: ['A', 'AST'] },
  { keys: ['three pointers', '3-pointers', '3 pointers made', 'threes'], stat: 'threes', label: '3-Pointers Made', cats: [''], labels: ['3PT'] },
  { keys: ['steals'], stat: 'steals', label: 'Steals', cats: [''], labels: ['STL'] },
  { keys: ['blocks'], stat: 'blocks', label: 'Blocks', cats: [''], labels: ['BLK'] },
  { keys: ['shots on goal', 'sog'], stat: 'sog', label: 'Shots on Goal', cats: ['forwards', 'defenses'], labels: ['SOG', 'S'] },
  { keys: ['goals'], stat: 'goals', label: 'Goals', cats: ['forwards', 'defenses'], labels: ['G'] },
  { keys: ['saves'], stat: 'saves', label: 'Saves', cats: ['goalies'], labels: ['SV'] },
  { keys: ['hits'], stat: 'hits', label: 'Hits', cats: ['batting', ''], labels: ['H'] },
  { keys: ['home runs', 'hrs'], stat: 'hr', label: 'Home Runs', cats: ['batting', ''], labels: ['HR'] },
  { keys: ['rbis', 'runs batted in'], stat: 'rbi', label: 'RBIs', cats: ['batting', ''], labels: ['RBI'] },
  { keys: ['runs scored'], stat: 'runs', label: 'Runs', cats: ['batting', ''], labels: ['R'] },
  { keys: ['total bases'], stat: 'total_bases', label: 'Total Bases', cats: ['batting', ''], labels: ['TB'] },
  { keys: ['stolen bases'], stat: 'sb', label: 'Stolen Bases', cats: ['batting', ''], labels: ['SB'] },
  { keys: ['strikeouts'], stat: 'ks', label: 'Strikeouts', cats: ['pitching', 'batting', ''], labels: ['K', 'SO'] },
  { keys: ['tackles'], stat: 'tackles', label: 'Tackles', cats: ['defensive'], labels: ['TOT'] },
  { keys: ['sacks'], stat: 'sacks', label: 'Sacks', cats: ['defensive'], labels: ['SACK'] },
  { keys: ['field goals made', 'field goals'], stat: 'fg', label: 'Field Goals Made', cats: ['kicking'], labels: ['FG'] },
];
function parseProp(leg) {
  const market = (leg.market || '').toLowerCase();
  const sel = leg.selection || '';
  const selLow = sel.toLowerCase();
  const isPropMarket = market.includes('prop') || PROP_STATS.some((p) => market.includes(p.keys[0]) || p.keys.some((k) => market.includes(k)));
  const statDef = PROP_STATS.find((p) => p.keys.some((k) => selLow.includes(k) || market.includes(k)));
  if (!statDef && !isPropMarket) return null;
  if (!statDef) return { unresolved: true, player: sel.trim(), statLabel: leg.market, stat: null, dir: null, line: parseNumber(leg.line) };
  // direction + number
  let dir = null; let line = null;
  const m = selLow.match(/(over|under)\s*(\d+(?:\.\d+)?)/);
  if (m) { dir = m[1]; line = parseFloat(m[2]); }
  else {
    line = parseNumber(leg.line);
    if (/\bunder\b/.test(leg.line || '') || /\bunder\b/.test(selLow)) dir = 'under';
    else if (statDef.stat !== 'anytime_td') dir = 'over';
  }
  if (statDef.stat === 'anytime_td') { dir = 'over'; line = 0.5; }
  // player name = selection text before Over/Under, minus the stat phrase
  let player = sel;
  const ouIdx = selLow.search(/\b(over|under)\b/);
  if (ouIdx > 0) player = sel.slice(0, ouIdx);
  for (const k of statDef.keys) {
    const idx = player.toLowerCase().indexOf(k);
    if (idx >= 0) player = player.slice(0, idx);
  }
  player = player.replace(/[-–—]+$/g, '').trim();
  return { player, stat: statDef.stat, statLabel: statDef.label, def: statDef, dir, line };
}
function playerStatValue(detail, prop) {
  if (!prop || !prop.def) return null;
  const target = tokens(prop.player).join(' ');
  for (const cat of detail.playerStats) {
    if (prop.def.cats && prop.def.cats.length && prop.def.cats[0] !== '') {
      const catName = (cat.category || '').toLowerCase();
      if (!prop.def.cats.some((c) => c === '' || catName.includes(c))) continue;
    }
    for (const row of cat.rows) {
      if (tokens(row.player).join(' ') !== target) continue;
      for (const lab of prop.def.labels) {
        const idx = cat.columns.findIndex((c) => String(c).toUpperCase() === lab);
        if (idx >= 0) {
          const v = parseFloat(row.values[idx]);
          if (!Number.isNaN(v)) return v;
        }
      }
      // NHL points = goals + assists when PTS column absent
      if (prop.stat === 'points') {
        const gi = cat.columns.findIndex((c) => String(c).toUpperCase() === 'G');
        const ai = cat.columns.findIndex((c) => String(c).toUpperCase() === 'A');
        if (gi >= 0 && ai >= 0) {
          const g = parseFloat(row.values[gi]); const a = parseFloat(row.values[ai]);
          if (!Number.isNaN(g) && !Number.isNaN(a)) return g + a;
        }
      }
      // NBA PRA combos
      if (prop.stat === 'points' && prop.statLabel === 'Points') { /* plain PTS handled above */ }
      return null;
    }
  }
  return null;
}
function anytimeTdValue(detail, prop) {
  const target = tokens(prop.player).join(' ');
  for (const p of detail.scoringPlays) {
    const txt = tokens(p.text).join(' ');
    if (txt.includes(target) && /touchdown| td\b/.test(p.text.toLowerCase())) return 1;
    if (tokens(p.playersLine).join(' ').includes(target) && /touchdown/.test(p.text.toLowerCase())) return 1;
  }
  return 0;
}
async function propCurrentValue(leg, game) {
  const prop = parseProp(leg);
  if (!prop) return null;
  if (!game) return { prop, value: null, available: false };
  let detail;
  try { detail = normalizeDetail(await getSummary(leg.league, game.id), leg.league, game.id); }
  catch { return { prop, value: null, available: false }; }
  if (prop.stat === 'anytime_td') return { prop, value: anytimeTdValue(detail, prop), available: true, detail };
  const v = playerStatValue(detail, prop);
  return { prop, value: v, available: v !== null, detail };
}
function gradeProp(prop, value, gameFinal) {
  if (value === null || value === undefined) return null;
  if (prop.stat === 'anytime_td') return value >= 1 ? 'won' : (gameFinal ? 'lost' : null);
  if (prop.dir === 'over') return value > prop.line ? 'won' : (gameFinal ? (value === prop.line ? 'push' : 'lost') : null);
  if (prop.dir === 'under') return value < prop.line ? 'won' : (gameFinal ? (value === prop.line ? 'push' : 'lost') : null);
  return null;
}

/* ---------------- settle engine ---------------- */
const boardCache = new Map(); // league -> games (refreshed per settle pass)
async function gamesForLeague(league) {
  try { return await getScoreboardWindow(league); } catch { return []; }
}
function computeTicketOutcome(ticket, legs) {
  const graded = legs.filter((l) => ['won', 'lost', 'push'].includes(l.status));
  if (graded.length < legs.length) return null;
  if (legs.some((l) => l.status === 'lost')) return { status: 'lost', payout: 0 };
  const dec = legs.reduce((acc, l) => acc * (l.status === 'push' ? 1 : decimalFromAmerican(l.odds)), 1);
  let payout = money(ticket.stake * dec);
  if (legs.every((l) => l.status === 'push')) return { status: 'push', payout: money(ticket.stake) };
  if (ticket.boosted_payout && ticket.boosted_payout > 0) payout = money(ticket.boosted_payout);
  return { status: 'won', payout };
}
function parseBoostedPayout(notes) {
  const m = String(notes || '').match(/boosted payout[^$]*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}
async function settleTicket(ticket) {
  const legs = db.prepare('SELECT * FROM legs WHERE ticket_id = ? ORDER BY id').all(ticket.id);
  let changed = false;
  const leaguesNeeded = [...new Set(legs.filter((l) => l.status === 'pending' || l.status === 'live').map((l) => l.league))];
  const leagueGames = {};
  for (const lg of leaguesNeeded) leagueGames[lg] = await gamesForLeague(lg);
  for (const leg of legs) {
    if (['won', 'lost', 'push'].includes(leg.status)) continue;
    const games = leagueGames[leg.league] || [];
    const game = matchGameForLeg(leg, games);
    if (!game) continue;
    if (game.id !== leg.event_id) {
      db.prepare('UPDATE legs SET event_id = ? WHERE id = ?').run(game.id, leg.id);
      leg.event_id = game.id; changed = true;
    }
    const prop = parseProp(leg);
    if (game.state === 'post') {
      let result = null;
      if (prop) {
        const pv = await propCurrentValue(leg, game);
        if (pv && pv.available) result = gradeProp(pv.prop, pv.value, true);
        if (pv && pv.value !== null) db.prepare('UPDATE legs SET final_value = ? WHERE id = ?').run(pv.value, leg.id);
      } else {
        result = gradeTeamLeg(leg, game);
      }
      if (result) {
        db.prepare('UPDATE legs SET status = ? WHERE id = ?').run(result, leg.id);
        leg.status = result; changed = true;
        if (ticket.user_id) {
          const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
          if (u) addAlert(ticket.user_id, 'leg_final', `Leg final: ${leg.selection}`, `${leg.selection} ${result.toUpperCase()} — ${game.away.abbr} ${game.away.score} @ ${game.home.abbr} ${game.home.score}`, ticket.id, game.id, `legfinal:${leg.id}:${result}`);
        }
      }
    } else if (game.state === 'in' && leg.status === 'pending') {
      db.prepare('UPDATE legs SET status = ? WHERE id = ?').run('live', leg.id);
      leg.status = 'live'; changed = true;
    }
  }
  const freshLegs = db.prepare('SELECT * FROM legs WHERE ticket_id = ? ORDER BY id').all(ticket.id);
  if (ticket.status === 'open') {
    const outcome = computeTicketOutcome(ticket, freshLegs);
    if (outcome) {
      db.prepare('UPDATE tickets SET status = ?, payout = ?, settled_at = ? WHERE id = ?').run(outcome.status, outcome.payout, nowISO(), ticket.id);
      changed = true;
      const profit = money((outcome.payout || 0) - ticket.stake);
      addAlert(ticket.user_id, 'ticket_settled',
        outcome.status === 'won' ? `Ticket cashed: +$${profit.toFixed(2)}` : outcome.status === 'lost' ? `Ticket lost: -$${money(ticket.stake).toFixed(2)}` : 'Ticket pushed',
        `${ticket.title || 'Ticket'} settled ${outcome.status.toUpperCase()} — payout $${money(outcome.payout || 0).toFixed(2)}`,
        ticket.id, null, `ticketsettled:${ticket.id}:${outcome.status}`);
    }
  }
  return changed;
}
let settling = false;
async function settleAll() {
  if (settling) return;
  settling = true;
  try {
    const open = db.prepare("SELECT * FROM tickets WHERE status = 'open'").all();
    for (const t of open) { try { await settleTicket(t); } catch { /* keep going */ } }
  } finally { settling = false; }
}

/* ---------------- alerts engine ---------------- */
function getPrefs(userId) {
  let p = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
  if (!p) {
    db.prepare('INSERT INTO alert_prefs (user_id) VALUES (?)').run(userId);
    p = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
  }
  let prefs = {};
  try { prefs = JSON.parse(p.prefs || '{}'); } catch { prefs = {}; }
  return { prefs, quietStart: p.quiet_start || '', quietEnd: p.quiet_end || '' };
}
const ALERT_TYPES = ['game_start', 'leg_flip', 'prop_cross', 'prop_dead', 'leg_final', 'ticket_settled'];
function inQuietHours(p) {
  if (!p.quietStart || !p.quietEnd) return false;
  const cur = etHourNow();
  const [sh] = p.quietStart.split(':').map(Number);
  const [eh] = p.quietEnd.split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  return sh <= eh ? (cur >= sh && cur < eh) : (cur >= sh || cur < eh);
}
function addAlert(userId, type, title, body, ticketId, eventId, dedupeKey) {
  const { prefs, quietStart, quietEnd } = getPrefs(userId);
  if (prefs[type] === false) return;
  const held = inQuietHours({ quietStart, quietEnd }) ? 1 : 0;
  try {
    db.prepare('INSERT INTO alerts (user_id, type, title, body, ticket_id, event_id, dedupe_key, held_quietly, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(userId, type, title, body, ticketId || null, eventId || null, dedupeKey, held, nowISO());
  } catch { /* duplicate dedupe_key — never fire the same event twice */ }
}
function alertsEnabledFor(userId, ticketId, eventId) {
  const rows = db.prepare('SELECT * FROM alert_subs WHERE user_id = ?').all(userId);
  for (const r of rows) {
    if (r.scope === 'ticket' && r.ticket_id === ticketId && !r.on_flag) return false;
    if (r.scope === 'game' && r.event_id === String(eventId) && !r.on_flag) return false;
  }
  return true;
}
async function alertCycle() {
  const open = db.prepare("SELECT * FROM tickets WHERE status = 'open'").all();
  for (const ticket of open) {
    const legs = db.prepare('SELECT * FROM legs WHERE ticket_id = ?').all(ticket.id);
    const leaguesNeeded = [...new Set(legs.map((l) => l.league))];
    const leagueGames = {};
    for (const lg of leaguesNeeded) leagueGames[lg] = await gamesForLeague(lg);
    for (const leg of legs) {
      if (['won', 'lost', 'push'].includes(leg.status)) continue;
      const game = matchGameForLeg(leg, leagueGames[leg.league] || []);
      if (!game) continue;
      if (!alertsEnabledFor(ticket.user_id, ticket.id, game.id)) continue;
      const prevRow = db.prepare('SELECT * FROM alert_leg_states WHERE leg_id = ?').get(leg.id);
      let prev = {};
      try { prev = prevRow ? JSON.parse(prevRow.state_json || '{}') : {}; } catch { prev = {}; }
      const state = { gameState: game.state, detail: game.detail };
      // game start
      if (prev.gameState === 'pre' && game.state === 'in') {
        addAlert(ticket.user_id, 'game_start', `Game started: ${game.away.name} @ ${game.home.name}`, leg.selection, ticket.id, game.id, `gamestart:${leg.id}:${game.id}`);
      }
      // leg flip (team/total legs)
      const prop = parseProp(leg);
      if (!prop) {
        const live = liveTeamLegState(leg, game);
        state.legLive = live;
        if (prev.legLive && live && prev.legLive !== live && (live === 'winning' || live === 'losing')) {
          addAlert(ticket.user_id, 'leg_flip', `Leg flipped: ${leg.selection}`, `Now ${live.toUpperCase()} — ${game.away.abbr} ${game.away.score} @ ${game.home.abbr} ${game.home.score} (${game.detail})`, ticket.id, game.id, `legflip:${leg.id}:${live}:${game.away.score}-${game.home.score}`);
        }
      } else {
        const pv = await propCurrentValue(leg, game);
        if (pv && pv.available && pv.prop.line !== null && pv.prop.dir) {
          state.propValue = pv.value;
          const crossed = pv.prop.dir === 'over' ? pv.value > pv.prop.line : pv.value >= pv.prop.line;
          if (crossed && !prev.propCrossed) {
            addAlert(ticket.user_id, 'prop_cross', `Prop crossed: ${leg.selection}`, `${pv.prop.player} at ${pv.value} vs line ${pv.prop.line} (${pv.prop.statLabel})`, ticket.id, game.id, `propcross:${leg.id}`);
          }
          state.propCrossed = crossed;
          // heuristic dead: late in the final period, still short of an Over line
          if (game.state === 'in' && pv.prop.dir === 'over' && pv.value <= pv.prop.line) {
            const latePeriod = { NFL: 4, NBA: 4, WNBA: 4, NHL: 3 }[leg.league];
            if (latePeriod && game.period >= latePeriod) {
              const clockSec = (() => { const m = String(game.clock || '').match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; })();
              if (clockSec !== null && clockSec <= 60 && !prev.propDead) {
                addAlert(ticket.user_id, 'prop_dead', `Prop in trouble: ${leg.selection}`, `${pv.prop.player} needs ${pv.prop.line} (${pv.prop.statLabel}), at ${pv.value} with under a minute left`, ticket.id, game.id, `propdead:${leg.id}`);
                state.propDead = true;
              }
            }
          }
        }
      }
      db.prepare('INSERT INTO alert_leg_states (leg_id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(leg_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at')
        .run(leg.id, ticket.user_id, JSON.stringify(state), nowISO());
    }
  }
}

/* ---------------- serialization ---------------- */
function ticketJSON(t) {
  const legs = db.prepare('SELECT * FROM legs WHERE ticket_id = ? ORDER BY id').all(t.id);
  const combined = legs.reduce((a, l) => a * decimalFromAmerican(l.odds), 1);
  return {
    id: t.id, title: t.title, sportsbook: t.sportsbook, stake: t.stake, notes: t.notes,
    source: t.source, boostedPayout: t.boosted_payout, status: t.status, payout: t.payout,
    hasImage: !!t.image_file, externalRef: t.external_ref, createdAt: t.created_at, settledAt: t.settled_at,
    combinedOdds: combined <= 1 ? 0 : combined >= 2 ? Math.round((combined - 1) * 100) : -Math.round(100 / (combined - 1)),
    potentialPayout: t.boosted_payout && t.boosted_payout > 0 ? t.boosted_payout : money(t.stake * combined),
    legs: legs.map((l) => ({
      id: l.id, league: l.league, gameLabel: l.game_label, selection: l.selection, market: l.market,
      line: l.line, odds: l.odds, startsAt: l.starts_at, status: l.status, eventId: l.event_id, finalValue: l.final_value,
    })),
  };
}
async function ticketJSONWithGames(t) {
  const base = ticketJSON(t);
  if (t.status === 'open') {
    const leagues = [...new Set(base.legs.map((l) => l.league))];
    const map = {};
    for (const lg of leagues) {
      const games = await gamesForLeague(lg);
      for (const g of games) map[g.id] = g;
    }
    base.games = {};
    for (const leg of base.legs) {
      const legsRaw = db.prepare('SELECT * FROM legs WHERE id = ?').get(leg.id);
      const game = matchGameForLeg(legsRaw, Object.values(map).filter((g) => g.league === leg.league));
      if (game) base.games[leg.id] = game;
    }
  }
  return base;
}
function bankrollFor(userId) {
  const s = getSettings(userId);
  const settled = db.prepare("SELECT * FROM tickets WHERE user_id = ? AND status IN ('won','lost','push') ORDER BY settled_at DESC").all(userId);
  let wins = 0, losses = 0, pushes = 0, net = 0, staked = 0;
  const byDayMap = new Map();
  for (const t of settled) {
    const profit = money((t.payout || 0) - t.stake);
    net = money(net + profit); staked = money(staked + t.stake);
    if (t.status === 'won') wins++; else if (t.status === 'lost') losses++; else pushes++;
    const day = etDateStr(new Date(t.settled_at || t.created_at));
    const d = byDayMap.get(day) || { date: day, profit: 0, wins: 0, losses: 0 };
    d.profit = money(d.profit + profit);
    if (t.status === 'won') d.wins++; else if (t.status === 'lost') d.losses++;
    byDayMap.set(day, d);
  }
  let streak = { type: null, count: 0 };
  for (const t of settled) {
    if (t.status === 'push') continue;
    if (!streak.type) { streak = { type: t.status, count: 1 }; }
    else if (streak.type === t.status) streak.count++;
    else break;
  }
  const decided = wins + losses;
  return {
    startingBankroll: s.startingBankroll, unitSize: s.unitSize,
    currentBankroll: money(s.startingBankroll + net),
    wins, losses, pushes, winRate: decided ? Math.round((wins / decided) * 1000) / 10 : null,
    netProfit: net, totalStaked: staked, streak,
    byDay: [...byDayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
function communityJSON(viewer) {
  const posts = db.prepare('SELECT p.*, u.username, u.display_name FROM community_posts p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 100').all();
  const out = [];
  for (const p of posts) {
    const comments = db.prepare('SELECT c.*, u.username, u.display_name FROM community_comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id').all(p.id)
      .map((c) => ({ id: c.id, authorName: displayNameOf(c), body: c.body, createdAt: c.created_at }));
    const reactions = ['respect', 'tail', 'hot'].map((r) => {
      const cnt = db.prepare('SELECT COUNT(*) AS n FROM community_reactions WHERE post_id = ? AND reaction = ?').get(p.id, r).n;
      const mine = viewer ? !!db.prepare('SELECT id FROM community_reactions WHERE post_id = ? AND user_id = ? AND reaction = ?').get(p.id, viewer.id, r) : false;
      return { reaction: r, count: cnt, mine };
    });
    let ticket = null;
    if (p.kind === 'ticket' && p.ticket_id) {
      const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(p.ticket_id);
      if (t) { const tj = ticketJSON(t); ticket = { ticketId: t.id, title: tj.title, sportsbook: tj.sportsbook, stake: tj.stake, combinedOdds: tj.combinedOdds, payout: tj.potentialPayout, outcome: tj.status === 'open' ? 'live' : tj.status, legs: tj.legs }; }
    }
    out.push({ id: p.id, kind: p.kind, authorName: displayNameOf(p), body: p.body, createdAt: p.created_at, comments, reactions, ticket, mine: viewer ? p.user_id === viewer.id : false });
  }
  // leaderboard: ONLY real graded results
  const lb = db.prepare(`
    SELECT u.username, u.display_name,
      SUM(CASE WHEN t.status='won' THEN 1 ELSE 0 END) AS w,
      SUM(CASE WHEN t.status='lost' THEN 1 ELSE 0 END) AS l,
      SUM((COALESCE(t.payout,0) - t.stake)) AS net
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.status IN ('won','lost')
    GROUP BY t.user_id HAVING (w + l) > 0
    ORDER BY net DESC, w DESC`).all();
  const leaderboard = lb.map((r) => ({
    name: (r.display_name || '').trim() || r.username, wins: r.w, losses: r.l,
    winRate: Math.round((r.w / (r.w + r.l)) * 1000) / 10, netProfit: money(r.net),
  }));
  return { posts: out, leaderboard };
}

/* ---------------- routes ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    /* ---- auth ---- */
    if (p === '/api/auth/signup' && req.method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const email = String(b.email || '').trim();
      const password = String(b.password || '');
      if (!/^[A-Za-z0-9_.\-]{3,24}$/.test(username)) return sendJSON(res, 400, { error: 'Username must be 3–24 characters (letters, numbers, _ . -).' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJSON(res, 400, { error: 'Enter a valid email.' });
      if (password.length < 10) return sendJSON(res, 400, { error: 'Password must be at least 10 characters.' });
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return sendJSON(res, 409, { error: 'That username is taken.' });
      const salt = newSalt();
      const info = db.prepare('INSERT INTO users (username, email, pass_hash, salt, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, email, hashPassword(password, salt), salt, username, nowISO());
      const userId = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
      const codes = [];
      for (let i = 0; i < 8; i++) {
        const code = makeRecoveryCode();
        codes.push(code);
        db.prepare('INSERT INTO recovery_codes (user_id, code_hash, used) VALUES (?, ?, 0)').run(userId, hashCode(code));
      }
      startSession(res, userId);
      const u = db.prepare('SELECT id, username, email, display_name FROM users WHERE id = ?').get(userId);
      return sendJSON(res, 201, { user: { id: u.id, username: u.username, email: u.email, displayName: displayNameOf(u) }, recoveryCodes: codes });
    }
    if (p === '/api/auth/signin' && req.method === 'POST') {
      const b = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(b.username || '').trim());
      if (!u || hashPassword(String(b.password || ''), u.salt) !== u.pass_hash) return sendJSON(res, 401, { error: 'Wrong username or password.' });
      startSession(res, u.id);
      return sendJSON(res, 200, { user: { id: u.id, username: u.username, email: u.email, displayName: displayNameOf(u) } });
    }
    if (p === '/api/auth/signout' && req.method === 'POST') {
      endSession(req, res);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/auth/reset' && req.method === 'POST') {
      const b = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(b.username || '').trim());
      if (!u) return sendJSON(res, 404, { error: 'Account not found.' });
      const newPassword = String(b.newPassword || '');
      if (newPassword.length < 10) return sendJSON(res, 400, { error: 'New password must be at least 10 characters.' });
      const rc = db.prepare('SELECT * FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used = 0').get(u.id, hashCode(String(b.code || '').trim().toUpperCase()));
      if (!rc) return sendJSON(res, 401, { error: 'That recovery code is not valid (codes work one time only).' });
      const salt = newSalt();
      db.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').run(hashPassword(newPassword, salt), salt, u.id);
      db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(rc.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/me' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 200, { user: null });
      return sendJSON(res, 200, { user: { id: u.id, username: u.username, email: u.email, displayName: displayNameOf(u) }, settings: getSettings(u.id) });
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const b = await readBody(req);
      if (b.displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(String(b.displayName).slice(0, 40), u.id);
      const s = getSettings(u.id);
      db.prepare('UPDATE settings SET default_book = ?, starting_bankroll = ?, unit_size = ? WHERE user_id = ?')
        .run(String(b.defaultBook ?? s.defaultBook).slice(0, 60), Number(b.startingBankroll ?? s.startingBankroll) || 0, Number(b.unitSize ?? s.unitSize) || 0, u.id);
      return sendJSON(res, 200, { settings: getSettings(u.id) });
    }

    /* ---- scores / news / game detail (public) ---- */
    if (p === '/api/scores' && req.method === 'GET') {
      const league = (url.searchParams.get('league') || 'NFL').toUpperCase();
      try {
        const games = await getScoreboardWindow(league);
        return sendJSON(res, 200, { league, games, fetchedAt: nowISO(), error: '' });
      } catch (e) {
        return sendJSON(res, 200, { league, games: [], fetchedAt: nowISO(), error: `Could not load ${league} scores right now.` });
      }
    }
    if (p === '/api/game' && req.method === 'GET') {
      const league = (url.searchParams.get('league') || '').toUpperCase();
      const eventId = url.searchParams.get('eventId') || '';
      try {
        const sum = await getSummary(league, eventId);
        const detail = normalizeDetail(sum, league, eventId);
        const games = await gamesForLeague(league);
        const g = games.find((x) => x.id === String(eventId));
        if (g) detail.game = g;
        return sendJSON(res, 200, detail);
      } catch {
        return sendJSON(res, 502, { error: 'Could not load game detail right now.' });
      }
    }
    if (p === '/api/news' && req.method === 'GET') {
      const league = (url.searchParams.get('league') || 'NFL').toUpperCase();
      const lp = leaguePath(league);
      if (!lp) return sendJSON(res, 200, { items: [], error: 'Unknown league.' });
      try {
        const data = await fetchJSON(`${ESPN_BASE}/${lp}/news?limit=12`, 300000);
        const items = (data.articles || []).map((a) => ({
          id: String(a.id), headline: a.headline || '', description: a.description || '',
          published: a.published || '', source: 'ESPN',
          url: (a.links && a.links.web && a.links.web.href) || '',
        }));
        return sendJSON(res, 200, { items, fetchedAt: nowISO(), error: '' });
      } catch {
        return sendJSON(res, 200, { items: [], fetchedAt: nowISO(), error: 'Could not load news right now.' });
      }
    }

    /* ---- tickets ---- */
    if (p === '/api/tickets' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      await settleAll();
      const rows = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC').all(u.id);
      const out = [];
      for (const t of rows) out.push(await ticketJSONWithGames(t));
      return sendJSON(res, 200, { tickets: out });
    }
    if (p === '/api/tickets' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const b = await readBody(req);
      const legs = Array.isArray(b.legs) ? b.legs : [];
      if (!legs.length) return sendJSON(res, 400, { error: 'Add at least one leg.' });
      if (legs.length > 25) return sendJSON(res, 400, { error: 'Too many legs.' });
      const notes = String(b.notes || '').slice(0, 1000);
      const boosted = b.boostedPayout ? Number(b.boostedPayout) : parseBoostedPayout(notes);
      const info = db.prepare('INSERT INTO tickets (user_id, title, sportsbook, stake, notes, source, boosted_payout, status, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.id, String(b.title || '').slice(0, 120), String(b.sportsbook || getSettings(u.id).defaultBook || 'Hard Rock Bet').slice(0, 60),
          Math.max(0, Number(b.stake) || 0), notes, ['manual', 'screenshot', 'morning'].includes(b.source) ? b.source : 'manual',
          boosted || null, 'open', b.externalRef ? String(b.externalRef).slice(0, 120) : null, nowISO());
      const ticketId = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO legs (ticket_id, league, game_label, selection, market, line, odds, starts_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const l of legs) {
        ins.run(ticketId, String(l.league || '').toUpperCase().slice(0, 20), String(l.gameLabel || '').slice(0, 120),
          String(l.selection || '').slice(0, 200), String(l.market || '').slice(0, 80), String(l.line || '').slice(0, 40),
          Math.round(Number(l.odds) || -110), String(l.startsAt || '').slice(0, 40), 'pending');
      }
      const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      return sendJSON(res, 201, { ticket: ticketJSON(t) });
    }
    const ticketImgMatch = p.match(/^\/api\/tickets\/(\d+)\/image$/);
    if (ticketImgMatch && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(Number(ticketImgMatch[1]), u.id);
      if (!t) return sendJSON(res, 404, { error: 'Ticket not found.' });
      const b = await readBody(req);
      const m = String(b.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!m) return sendJSON(res, 400, { error: 'Image must be a PNG, JPG, or WebP data URL.' });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const fname = `ticket-${t.id}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(m[2], 'base64'));
      db.prepare('UPDATE tickets SET image_file = ? WHERE id = ?').run(fname, t.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (ticketImgMatch && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(Number(ticketImgMatch[1]), u.id);
      if (!t || !t.image_file) return sendJSON(res, 404, { error: 'No image.' });
      const fp = path.join(UPLOAD_DIR, path.basename(t.image_file));
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: 'No image.' });
      const ext = path.extname(fp).slice(1);
      res.writeHead(200, { 'Content-Type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' });
      return res.end(fs.readFileSync(fp));
    }
    const ticketDelMatch = p.match(/^\/api\/tickets\/(\d+)$/);
    if (ticketDelMatch && req.method === 'DELETE') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(Number(ticketDelMatch[1]), u.id);
      if (!t) return sendJSON(res, 404, { error: 'Ticket not found.' });
      db.prepare('DELETE FROM legs WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/props' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const ticketId = Number(url.searchParams.get('ticketId') || 0);
      const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(ticketId, u.id);
      if (!t) return sendJSON(res, 404, { error: 'Ticket not found.' });
      const legs = db.prepare('SELECT * FROM legs WHERE ticket_id = ?').all(ticketId);
      const out = [];
      for (const leg of legs) {
        const prop = parseProp(leg);
        if (!prop) continue;
        const games = await gamesForLeague(leg.league);
        const game = matchGameForLeg(leg, games);
        const pv = await propCurrentValue(leg, game);
        let statusText = 'Player stat not available in feed';
        let progress = null, remaining = null;
        if (pv && pv.available) {
          statusText = '';
          const line = pv.prop.line;
          if (pv.prop.stat === 'anytime_td') {
            progress = pv.value >= 1 ? 100 : 0;
            remaining = pv.value >= 1 ? 'Cashed' : 'Needs a touchdown';
          } else if (line) {
            progress = Math.max(0, Math.min(100, Math.round((pv.value / line) * 100)));
            if (pv.prop.dir === 'under') {
              remaining = `Room left: ${Math.max(0, money(line - pv.value))}`;
              progress = Math.max(0, Math.min(100, Math.round((1 - pv.value / (line + 1)) * 100)));
            } else {
              remaining = pv.value >= line ? 'Line crossed' : `${money(line - pv.value)} to go`;
            }
          }
        }
        out.push({
          legId: leg.id, selection: leg.selection, player: pv ? pv.prop.player : prop.player,
          statLabel: pv ? pv.prop.statLabel : prop.statLabel, dir: pv ? pv.prop.dir : prop.dir,
          line: pv ? pv.prop.line : prop.line, value: pv ? pv.value : null, available: pv ? pv.available : false,
          display: pv && pv.available && pv.prop.line !== null ? `${pv.value} / ${pv.prop.line} (${pv.prop.dir === 'under' ? 'Under' : 'Over'})` : null,
          progress, remaining, statusText, legStatus: leg.status,
        });
      }
      return sendJSON(res, 200, { props: out });
    }

    /* ---- board ---- */
    if (p === '/api/board' && req.method === 'GET') {
      const date = url.searchParams.get('date') || etDateStr();
      const plays = db.prepare('SELECT * FROM board_plays WHERE board_date = ? ORDER BY id').all(date)
        .map((r) => ({ id: r.id, boardDate: r.board_date, league: r.league, play: r.play, market: r.market, odds: r.odds, tier: r.tier, edgeNote: r.edge_note, sportsbook: r.sportsbook, verified: !!r.verified, verifiedAt: r.verified_at }));
      const dates = db.prepare('SELECT DISTINCT board_date FROM board_plays ORDER BY board_date DESC LIMIT 30').all().map((r) => r.board_date);
      return sendJSON(res, 200, { date, plays, dates });
    }
    if (p === '/api/push/board' && req.method === 'POST') {
      if (!PUSH_TOKEN || req.headers['x-push-token'] !== PUSH_TOKEN) return sendJSON(res, 403, { error: 'Bad push token.' });
      const b = await readBody(req);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : etDateStr();
      const list = Array.isArray(b.plays) ? b.plays : [b];
      let inserted = 0;
      const ins = db.prepare('INSERT OR IGNORE INTO board_plays (board_date, league, play, market, odds, tier, edge_note, sportsbook, verified, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pl of list) {
        if (!pl || !pl.play) continue;
        const info = ins.run(date, String(pl.league || '').toUpperCase().slice(0, 20), String(pl.play).slice(0, 200), String(pl.market || '').slice(0, 80),
          pl.odds === null || pl.odds === undefined ? null : Math.round(Number(pl.odds)), pl.tier === 'watch' ? 'watch' : 'actionable',
          String(pl.edgeNote || '').slice(0, 300), String(pl.sportsbook || 'Hard Rock Bet').slice(0, 60), pl.verified ? 1 : 0,
          pl.verifiedAt || (pl.verified ? nowISO() : null), nowISO());
        inserted += Number(info.changes);
      }
      return sendJSON(res, 200, { ok: true, date, inserted });
    }
    if (p === '/api/push/ticket' && req.method === 'POST') {
      if (!PUSH_TOKEN || req.headers['x-push-token'] !== PUSH_TOKEN) return sendJSON(res, 403, { error: 'Bad push token.' });
      const b = await readBody(req);
      const ref = String(b.externalRef || '');
      if (!ref) return sendJSON(res, 400, { error: 'externalRef required for idempotent ticket push.' });
      // morning tickets attach to the first registered account (the owner's) — or the user named in the push
      let owner = null;
      if (b.username) owner = db.prepare('SELECT * FROM users WHERE username = ?').get(String(b.username));
      if (!owner) owner = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
      if (!owner) return sendJSON(res, 409, { error: 'No account exists yet to own the pushed ticket.' });
      const existing = db.prepare('SELECT id FROM tickets WHERE user_id = ? AND external_ref = ?').get(owner.id, ref);
      if (existing) return sendJSON(res, 200, { ok: true, deduped: true, ticketId: existing.id });
      const legs = Array.isArray(b.legs) ? b.legs : [];
      if (!legs.length) return sendJSON(res, 400, { error: 'legs required.' });
      const notes = String(b.notes || 'Morning ticket — from today\'s Board').slice(0, 1000);
      const info = db.prepare('INSERT INTO tickets (user_id, title, sportsbook, stake, notes, source, boosted_payout, status, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(owner.id, String(b.title || 'Morning ticket').slice(0, 120), String(b.sportsbook || 'Hard Rock Bet').slice(0, 60), Math.max(0, Number(b.stake) || 0), notes, 'morning', b.boostedPayout ? Number(b.boostedPayout) : parseBoostedPayout(notes), 'open', ref, nowISO());
      const ticketId = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO legs (ticket_id, league, game_label, selection, market, line, odds, starts_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const l of legs) {
        ins.run(ticketId, String(l.league || '').toUpperCase().slice(0, 20), String(l.gameLabel || '').slice(0, 120), String(l.selection || '').slice(0, 200), String(l.market || '').slice(0, 80), String(l.line || '').slice(0, 40), Math.round(Number(l.odds) || -110), String(l.startsAt || '').slice(0, 40), 'pending');
      }
      return sendJSON(res, 201, { ok: true, ticketId });
    }

    /* ---- bankroll ---- */
    if (p === '/api/bankroll' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      await settleAll();
      return sendJSON(res, 200, bankrollFor(u.id));
    }

    /* ---- community ---- */
    if (p === '/api/community' && req.method === 'GET') {
      const u = currentUser(req);
      return sendJSON(res, 200, communityJSON(u));
    }
    if (p === '/api/community/posts' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required to post.' });
      const b = await readBody(req);
      const body = String(b.body || '').trim().slice(0, 2000);
      if (!body) return sendJSON(res, 400, { error: 'Write something first.' });
      const info = db.prepare('INSERT INTO community_posts (user_id, kind, body, ticket_id, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, 'discussion', body, null, nowISO());
      return sendJSON(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if (p === '/api/community/ticket' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required to post.' });
      const b = await readBody(req);
      const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(Number(b.ticketId), u.id);
      if (!t) return sendJSON(res, 404, { error: 'Ticket not found.' });
      const dup = db.prepare('SELECT id FROM community_posts WHERE kind = ? AND ticket_id = ? AND user_id = ?').get('ticket', t.id, u.id);
      if (dup) return sendJSON(res, 200, { id: dup.id, deduped: true });
      const info = db.prepare('INSERT INTO community_posts (user_id, kind, body, ticket_id, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, 'ticket', String(b.body || '').trim().slice(0, 2000), t.id, nowISO());
      return sendJSON(res, 201, { id: Number(info.lastInsertRowid) });
    }
    const commentMatch = p.match(/^\/api\/community\/posts\/(\d+)\/comments$/);
    if (commentMatch && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required to comment.' });
      const post = db.prepare('SELECT * FROM community_posts WHERE id = ?').get(Number(commentMatch[1]));
      if (!post) return sendJSON(res, 404, { error: 'Post not found.' });
      const b = await readBody(req);
      const body = String(b.body || '').trim().slice(0, 1000);
      if (!body) return sendJSON(res, 400, { error: 'Write something first.' });
      const info = db.prepare('INSERT INTO community_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(post.id, u.id, body, nowISO());
      return sendJSON(res, 201, { id: Number(info.lastInsertRowid) });
    }
    const reactionMatch = p.match(/^\/api\/community\/posts\/(\d+)\/reactions$/);
    if (reactionMatch && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required to react.' });
      const post = db.prepare('SELECT * FROM community_posts WHERE id = ?').get(Number(reactionMatch[1]));
      if (!post) return sendJSON(res, 404, { error: 'Post not found.' });
      const b = await readBody(req);
      const reaction = ['respect', 'tail', 'hot'].includes(b.reaction) ? b.reaction : null;
      if (!reaction) return sendJSON(res, 400, { error: 'Unknown reaction.' });
      const existing = db.prepare('SELECT id FROM community_reactions WHERE post_id = ? AND user_id = ? AND reaction = ?').get(post.id, u.id, reaction);
      if (existing) db.prepare('DELETE FROM community_reactions WHERE id = ?').run(existing.id);
      else db.prepare('INSERT INTO community_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)').run(post.id, u.id, reaction);
      return sendJSON(res, 200, { ok: true, on: !existing });
    }
    const postDelMatch = p.match(/^\/api\/community\/posts\/(\d+)$/);
    if (postDelMatch && req.method === 'DELETE') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const post = db.prepare('SELECT * FROM community_posts WHERE id = ? AND user_id = ?').get(Number(postDelMatch[1]), u.id);
      if (!post) return sendJSON(res, 404, { error: 'Post not found.' });
      db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(post.id);
      db.prepare('DELETE FROM community_reactions WHERE post_id = ?').run(post.id);
      db.prepare('DELETE FROM community_posts WHERE id = ?').run(post.id);
      return sendJSON(res, 200, { ok: true });
    }

    /* ---- alerts ---- */
    if (p === '/api/alerts' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const rows = db.prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(u.id);
      const unread = db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND is_read = 0 AND held_quietly = 0').get(u.id).n;
      const subs = db.prepare('SELECT * FROM alert_subs WHERE user_id = ?').all(u.id)
        .map((r) => ({ scope: r.scope, ticketId: r.ticket_id, eventId: r.event_id, on: !!r.on_flag }));
      const { prefs, quietStart, quietEnd } = getPrefs(u.id);
      return sendJSON(res, 200, {
        alerts: rows.map((a) => ({ id: a.id, type: a.type, title: a.title, body: a.body, ticketId: a.ticket_id, eventId: a.event_id, heldQuietly: !!a.held_quietly, read: !!a.is_read, createdAt: a.created_at })),
        unread, subs, prefs, quietStart, quietEnd, types: ALERT_TYPES,
      });
    }
    if (p === '/api/alerts/read' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const b = await readBody(req);
      db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(b.id), u.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/alerts/read-all' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      db.prepare('UPDATE alerts SET is_read = 1 WHERE user_id = ?').run(u.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/alerts/prefs' && req.method === 'PUT') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const b = await readBody(req);
      const cur = getPrefs(u.id);
      const prefs = { ...cur.prefs };
      for (const t of ALERT_TYPES) if (typeof b.prefs?.[t] === 'boolean') prefs[t] = b.prefs[t];
      db.prepare('UPDATE alert_prefs SET prefs = ?, quiet_start = ?, quiet_end = ? WHERE user_id = ?')
        .run(JSON.stringify(prefs), String(b.quietStart ?? cur.quietStart).slice(0, 5), String(b.quietEnd ?? cur.quietEnd).slice(0, 5), u.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/alerts/toggle' && req.method === 'POST') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { error: 'Sign in required.' });
      const b = await readBody(req);
      const scope = b.scope === 'game' ? 'game' : 'ticket';
      const on = b.on === false ? 0 : 1;
      db.prepare('INSERT INTO alert_subs (user_id, scope, ticket_id, event_id, on_flag) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, scope, ticket_id, event_id) DO UPDATE SET on_flag = excluded.on_flag')
        .run(u.id, scope, scope === 'ticket' ? Number(b.ticketId) || null : null, scope === 'game' ? String(b.eventId || '') : null, on);
      return sendJSON(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not found.' });

    /* ---- static / PWA ---- */
    const STATIC_OK = new Set(['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icon.svg']);
    const rel = (p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    let filePath = path.join(PUBLIC_DIR, rel);
    if ((!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) && STATIC_OK.has(rel)) {
      const flat = path.join(__dirname, rel);
      if (fs.existsSync(flat)) filePath = flat;
    }
    if (!filePath.startsWith(PUBLIC_DIR) && filePath !== path.join(__dirname, rel)) return sendJSON(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html')) ? path.join(PUBLIC_DIR, 'index.html') : path.join(__dirname, 'index.html'); // SPA fallback
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    return res.end(fs.readFileSync(filePath));
  } catch (e) {
    return sendJSON(res, 500, { error: 'Server error: ' + (e && e.message ? e.message : 'unknown') });
  }
});

server.listen(PORT, () => {
  console.log(`Sweat With Wilk listening on http://localhost:${PORT}`);
});
setInterval(() => { settleAll().catch(() => {}); }, 60000);
setInterval(() => { alertCycle().catch(() => {}); }, 30000);
setTimeout(() => { settleAll().catch(() => {}); }, 3000);
