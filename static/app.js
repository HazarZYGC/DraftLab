const state = {
  players: [], filtered: [], position: 'ALL', auction: null, values: new Map(), starTiers: new Map(), marketSource: 'model',
  targets: new Set(JSON.parse(localStorage.getItem('draftlab-targets') || '[]')), timerHandle: null,
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const initials = name => name.split(' ').slice(0, 2).map(part => part[0]).join('');
const fmt = (value, digits = 1) => Number(value || 0).toFixed(digits);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeHttpUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const h2hPointsPerGame = stats => Number(stats?.pts || 0) + 1.2 * Number(stats?.reb || 0) + 1.5 * Number(stats?.ast || 0) + 3 * Number(stats?.stl || 0) + 3 * Number(stats?.blk || 0) - Number(stats?.tov || 0);
const h2hHistory = player => (player.season_history || []).map(season => {
  const pointsPerGame = h2hPointsPerGame(season.stats);
  return { season: String(season.season), games: Number(season.games || 0), points_per_game: Number(pointsPerGame.toFixed(2)), total_points: Math.round(pointsPerGame * Number(season.games || 0)) };
});

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'İstek başarısız');
  return payload;
}

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2400);
}

async function loadPlayers(force = false) {
  $('#refreshBtn').classList.add('loading'); $('#syncText').textContent = 'Veriler yükleniyor…';
  try {
    const data = await api(`/api/players?mode=points${force ? '&refresh=1' : ''}`);
    state.players = data.players; state.marketSource = data.market_source || 'model'; calculateAuctionValues();
    $('#syncDot').classList.toggle('live', data.source === 'espn');
    $('#syncText').textContent = data.source === 'espn' ? `ESPN ${data.seasons.join('/')} · ${state.marketSource === 'yahoo' ? 'Yahoo Avg $' : 'Model fiyatı'}` : 'Demo veri';
    if (data.warning) showNotice(data.warning); else $('#notice').classList.add('hidden');
    applyFilters(); renderAuction();
  } catch (error) { showNotice(error.message); $('#syncText').textContent = 'Veri alınamadı'; }
  finally { $('#refreshBtn').classList.remove('loading'); }
}

function showNotice(text) { const node = $('#notice'); node.textContent = text; node.classList.remove('hidden'); }
function settings() { return state.auction?.settings || { teamCount: 10, budget: 200, rosterSize: 13 }; }

function calculateAuctionValues() {
  if (!state.players.length) return;
  const { teamCount, budget, rosterSize } = settings();
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  const demandPerPosition = Math.max(teamCount * 2, Math.round(teamCount * rosterSize / 5));
  const baselines = Object.fromEntries(positions.map(position => {
    const eligible = state.players.filter(player => player.positions.includes(position)).map(player => player.projected_total || player.score).sort((a, b) => b - a);
    return [position, eligible[Math.min(demandPerPosition - 1, eligible.length - 1)] || 0];
  }));
  const scored = state.players.map(player => {
    const total = player.projected_total || player.score;
    const baseline = Math.max(...player.positions.map(position => baselines[position] || 0), 0);
    return { player, surplus: Math.max(0, total - baseline * .82) * (player.positions.length > 1 ? 1.035 : 1) };
  }).sort((a, b) => b.surplus - a.surplus);
  const rosterable = scored.slice(0, teamCount * rosterSize);
  const totalSurplus = rosterable.reduce((sum, entry) => sum + entry.surplus, 0) || 1;
  const discretionaryPool = teamCount * Math.max(0, budget - rosterSize);
  state.values = new Map(scored.map(entry => [entry.player.id, entry.surplus > 0 ? Math.max(1, Math.round(1 + discretionaryPool * entry.surplus / totalSurplus)) : 1]));
  state.players.filter(player => player.projection_only).forEach(player => {
    const yahoo = Math.max(Number(player.yahoo_average_salary || 0), Number(player.yahoo_projected_salary || 0));
    state.values.set(player.id, Math.max(1, Math.round(yahoo * (budget / 200) * .65)));
  });
  const reliable = state.players.filter(player => !player.projection_only && typeof player.missed_game_rate === 'number' && player.missed_game_rate <= .18)
    .sort((a, b) => (state.values.get(b.id) || 0) - (state.values.get(a.id) || 0));
  state.starTiers = new Map(reliable.slice(0, 10).map((player, index) => [player.id, index < 4 ? 1 : 2]));
}

function applyFilters() {
  const term = $('#searchInput').value.toLocaleLowerCase('tr');
  state.filtered = state.players.filter(player => (state.position === 'ALL' || player.positions.includes(state.position)) && player.name.toLocaleLowerCase('tr').includes(term));
  renderBoard();
}

function riskLabel(player) {
  if (player.projection_only) return 'Belirsiz · yeni/veri yok';
  if (typeof player.missed_game_rate !== 'number') return 'Veri yok';
  const missed = Math.round(player.missed_game_rate * 100);
  return `${missed >= 25 ? 'Yüksek' : missed >= 12 ? 'Orta' : 'Düşük'} · %${missed}`;
}

function renderBoard() {
  $('#playerTotal').textContent = `${state.filtered.length} oyuncu`;
  $('#emptyState').classList.toggle('hidden', state.filtered.length > 0);
  $('#playerRows').innerHTML = state.filtered.map(player => `<tr>
    <td class="rank-cell">${String(player.rank).padStart(2, '0')}</td>
    <td><div class="player-cell">${player.headshot ? `<img class="avatar photo" src="${player.headshot}" alt="">` : `<span class="avatar">${initials(player.name)}</span>`}<span class="player-meta"><strong>${player.name}</strong><span>${player.team} · ${riskLabel(player)}</span></span></div></td>
    <td>${player.positions.map(pos => `<span class="pos-badge">${pos}</span>`).join('')}</td>
    <td>${player.projection_only ? '—' : fmt(player.fantasy_ppg)}</td><td>${player.expected_games || '—'}</td>
    <td class="${player.missed_game_rate >= .2 ? 'risk-high' : ''}">${typeof player.missed_game_rate === 'number' ? `%${Math.round(player.missed_game_rate * 100)}` : '—'}</td>
    <td>${Math.round(player.projected_total || player.score).toLocaleString('tr-TR')}</td>
    <td><span class="score-pill">$${state.values.get(player.id) || 1}</span></td><td>${player.yahoo_average_salary ? `$${fmt(player.yahoo_average_salary)}` : '—'}</td>
    <td><button class="target-button ${state.targets.has(player.id) ? 'active' : ''}" data-target-id="${player.id}" title="Hedef oyuncu">★</button></td></tr>`).join('');
  $$('[data-target-id]').forEach(button => button.addEventListener('click', () => toggleTarget(button.dataset.targetId)));
}

function toggleTarget(id) {
  const adding = !state.targets.has(id);
  adding ? state.targets.add(id) : state.targets.delete(id);
  if (state.auction && (adding || state.auction.primaryTargetId === id)) state.auction.primaryTargetId = null;
  localStorage.setItem('draftlab-targets', JSON.stringify([...state.targets]));
  saveAuction(); renderBoard(); renderAuction();
}

function startAuction() {
  const opponents = $('#opponentNames').value.split('\n').map(name => name.trim()).filter(Boolean);
  if (!opponents.length) return toast('En az bir rakip adı gir.');
  const teamCount = opponents.length + 1;
  const myPosition = Math.min(teamCount, Math.max(1, Number($('#myPositionInput').value))) - 1;
  const names = [...opponents]; names.splice(myPosition, 0, 'Sen');
  const auctionSettings = {
    teamCount, budget: Number($('#budgetInput').value), rosterSize: Number($('#rosterInput').value), myPosition,
    nominationSeconds: Number($('#nominationTimeInput').value), bidSeconds: Number($('#bidTimeInput').value),
  };
  state.auction = {
    version: 3, settings: auctionSettings, teams: names.map(name => ({ name, budget: auctionSettings.budget, roster: [] })),
    nominatorIndex: 0, phase: 'nomination', timer: auctionSettings.nominationSeconds, paused: false,
    nominatedPlayerId: null, primaryTargetId: null, drafted: [], purchases: [], aiAdvice: null, aiRosterPreference: [], aiResearchCompleted: false,
  };
  calculateAuctionValues(); saveAuction(); showRoom(); startTimer(); renderAuction();
}

function showRoom() { $('#auctionSetup').classList.add('hidden'); $('#auctionRoom').classList.remove('hidden'); }
function saveAuction() { if (state.auction) localStorage.setItem('draftlab-auction-v2', JSON.stringify(state.auction)); }

function restoreAuction() {
  try { state.auction = JSON.parse(localStorage.getItem('draftlab-auction-v2')); } catch { state.auction = null; }
  if (!state.auction) return;
  if (state.auction.version === 2) {
    state.auction.version = 3;
    state.auction.phase = state.auction.nominatedPlayerId ? 'sale' : 'nomination';
    state.auction.primaryTargetId = null;
    delete state.auction.currentBids;
  }
  if (state.auction.version === 3) {
    state.auction.settings.nominationSeconds ||= 30; state.auction.settings.bidSeconds ||= 20;
    if (typeof state.auction.aiResearchCompleted !== 'boolean') state.auction.aiResearchCompleted = Boolean(state.auction.aiRosterPreference?.length);
    if (!Number.isFinite(state.auction.timer)) state.auction.timer = state.auction.phase === 'sale' ? state.auction.settings.bidSeconds : state.auction.settings.nominationSeconds;
    state.auction.paused = Boolean(state.auction.paused); saveAuction(); showRoom(); startTimer();
  }
}

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    if (!state.auction || state.auction.paused || state.auction.timer <= 0) return;
    state.auction.timer -= 1;
    if (state.auction.timer <= 0) { state.auction.timer = 0; state.auction.paused = true; }
    saveAuction(); updateClock();
  }, 1000);
}

function updateClock() {
  if (!state.auction) return;
  $('#clock').textContent = state.auction.timer;
  $('#clock').classList.toggle('urgent', state.auction.timer <= 10);
  $('#pauseTimer').textContent = state.auction.paused ? 'Saati devam ettir' : 'Saati durdur';
}

function resetTimer() {
  if (!state.auction) return;
  state.auction.timer = state.auction.phase === 'sale' ? state.auction.settings.bidSeconds : state.auction.settings.nominationSeconds;
  state.auction.paused = false; saveAuction(); updateClock();
}

function currentNominator() { return state.auction.teams[state.auction.nominatorIndex]; }
function availablePlayers() { return state.players.filter(player => !state.auction.drafted.includes(player.id)); }

function maxLegalBid(teamIndex) {
  const team = state.auction.teams[teamIndex];
  const emptyAfterWin = state.auction.settings.rosterSize - team.roster.length - 1;
  return Math.max(0, team.budget - Math.max(0, emptyAfterWin));
}

function marketAnchor(player) {
  const yahoo = Number(player.yahoo_average_salary || 0) * (settings().budget / 200);
  return yahoo > 0 ? yahoo : (state.values.get(player.id) || 1);
}

function marketMultiplier() {
  if (!state.auction?.purchases.length) return 1;
  const actual = state.auction.purchases.reduce((sum, item) => sum + item.price, 0);
  const expected = state.auction.purchases.reduce((sum, item) => {
    const player = state.players.find(candidate => candidate.id === item.playerId);
    return sum + (player ? marketAnchor(player) : item.price);
  }, 0) || 1;
  return Math.min(1.25, Math.max(.78, actual / expected));
}

function rosterNeedMultiplier(player) {
  const myTeam = state.auction.teams[state.auction.settings.myPosition];
  const roster = myTeam.roster.map(id => state.players.find(item => item.id === id)).filter(Boolean);
  if (roster.length < 3) return 1;
  const counts = Object.fromEntries(['PG', 'SG', 'SF', 'PF', 'C'].map(position => [position, roster.filter(member => member.positions.includes(position)).length]));
  const leastCovered = Math.min(...player.positions.map(position => counts[position] ?? 0));
  return leastCovered === 0 ? 1.07 : leastCovered === 1 ? 1.03 : 1;
}

function starCandidateTier(player) {
  return state.starTiers.get(player.id) || 0;
}

function injuryCeilingMultiplier(player) {
  const missed = Number(player.missed_game_rate);
  if (!Number.isFinite(missed)) return player.projection_only ? .88 : 1;
  if (missed >= .40) return .76;
  if (missed >= .30) return .83;
  if (missed >= .20) return .90;
  if (missed >= .12) return .96;
  return 1;
}

function baseRecommendedMax(player) {
  const ourValue = state.values.get(player.id) || 1;
  const yahooMarket = marketAnchor(player);
  let value = (ourValue * .76 + yahooMarket * .24) * marketMultiplier() * rosterNeedMultiplier(player);
  if (state.targets.has(player.id) || state.auction.primaryTargetId === player.id) value *= 1.04;
  const starTier = starCandidateTier(player);
  if (starTier === 1) value *= 1.12;
  else if (starTier === 2) value *= 1.05;
  value *= injuryCeilingMultiplier(player);
  const myTeam = state.auction.teams[state.auction.settings.myPosition];
  const remainingSlots = state.auction.settings.rosterSize - myTeam.roster.length;
  const spendable = Math.max(0, myTeam.budget - remainingSlots);
  if (remainingSlots && spendable / remainingSlots < state.auction.settings.budget / state.auction.settings.rosterSize * .55) value *= .9;
  return Math.max(1, Math.min(maxLegalBid(state.auction.settings.myPosition), Math.round(value)));
}

function competitionCount(player, price = marketAnchor(player)) {
  return state.auction.teams.filter((team, index) => index !== state.auction.settings.myPosition && team.roster.length < state.auction.settings.rosterSize && maxLegalBid(index) >= price).length;
}

function estimatedSalePrice(player) {
  const pressure = .96 + Math.min(.12, competitionCount(player) * .02);
  return Math.max(1, Math.round(marketAnchor(player) * marketMultiplier() * pressure));
}

function plannedTargetBid(player) { return Math.min(baseRecommendedMax(player), estimatedSalePrice(player)); }

function aiAdviceFor(player) {
  return state.auction?.aiAdvice?.priorities?.find(item => item.player_id === player.id) || null;
}

function aiRosterRank(player) {
  const freshAIRoster = state.auction?.aiAdvice?.fallback_used ? null : state.auction?.aiAdvice?.recommended_roster;
  const roster = freshAIRoster || state.auction?.aiRosterPreference || [];
  return roster.indexOf(player.id);
}

function effectiveCeiling(player) {
  const base = baseRecommendedMax(player); const advice = aiAdviceFor(player);
  if (!advice) return base;
  const lower = Math.max(1, base - 20); const upper = Math.min(maxLegalBid(state.auction.settings.myPosition), base + 20);
  return Math.max(lower, Math.min(upper, Math.round(advice.recommended_max || base)));
}

function targetPriority(player, includeAI = true) {
  const ourValue = state.values.get(player.id) || 1;
  const edge = ourValue - marketAnchor(player);
  const preference = state.targets.has(player.id) ? 14 : 0;
  const affordable = marketAnchor(player) <= maxLegalBid(state.auction.settings.myPosition) ? 0 : -1000;
  const uncertainty = player.projection_only ? -18 : 0;
  const aiAdjustment = includeAI ? Number(aiAdviceFor(player)?.priority_adjustment || 0) * 2 : 0;
  const rosterRank = includeAI ? aiRosterRank(player) : -1;
  const aiRosterBoost = rosterRank >= 0 ? Math.max(45, 125 - rosterRank * 6) : 0;
  return ourValue * 1.15 + edge * .8 + preference + (rosterNeedMultiplier(player) - 1) * 70 + affordable + uncertainty + aiAdjustment + aiRosterBoost;
}

const YAHOO_ROSTER_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'UTIL', 'UTIL', 'BN', 'BN', 'BN'];

function rosterSlots(size) {
  if (size === 13) return [...YAHOO_ROSTER_SLOTS];
  const core = ['PG', 'SG', 'SF', 'PF', 'C'];
  const extras = ['G', 'F', 'C', 'UTIL', 'UTIL', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
  return [...core, ...extras].slice(0, size);
}

function slotAccepts(slot, player) {
  if (slot === 'BN' || slot === 'UTIL') return true;
  if (slot === 'G') return player.positions.some(position => position === 'PG' || position === 'SG');
  if (slot === 'F') return player.positions.some(position => position === 'SF' || position === 'PF');
  return player.positions.includes(slot);
}

function takeBestSlot(player, openSlots) {
  const preference = slot => player.positions.includes(slot) ? 0 : slot === 'G' || slot === 'F' ? 1 : slot === 'UTIL' ? 2 : 3;
  const options = openSlots.map((slot, index) => ({ slot, index })).filter(item => slotAccepts(item.slot, player)).sort((a, b) => preference(a.slot) - preference(b.slot));
  if (!options.length) return null;
  const chosen = options[0]; openSlots.splice(chosen.index, 1); return chosen.slot;
}

function budgetEnvelopes(budget, count) {
  if (!count) return [];
  const baseWeights = [.40, .26, .11, .065, .045, .03, .022, .018, .014, .01, .008, .007, .005];
  const weights = Array.from({ length: count }, (_, index) => baseWeights[index] || .004);
  const discretionary = Math.max(0, budget - count); const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
  const raw = weights.map(weight => discretionary * weight / sum); const extras = raw.map(Math.floor);
  let remainder = discretionary - extras.reduce((total, value) => total + value, 0);
  raw.map((value, index) => ({ index, fraction: value - extras[index] })).sort((a, b) => b.fraction - a.fraction).forEach(item => {
    if (remainder > 0) { extras[item.index] += 1; remainder -= 1; }
  });
  return extras.map(value => value + 1).sort((a, b) => b - a);
}

function buildIdealPlan() {
  if (!state.auction || !state.players.length) return { acquired: [], future: [], totalCost: 0, remainingSpend: 0 };
  const me = state.auction.teams[state.auction.settings.myPosition]; const openSlots = rosterSlots(state.auction.settings.rosterSize);
  const acquiredPlayers = me.roster.map(id => state.players.find(player => player.id === id)).filter(Boolean).sort((a, b) => a.positions.length - b.positions.length);
  const acquired = acquiredPlayers.map(player => {
    const sale = state.auction.purchases.find(item => item.playerId === player.id);
    return { player, slot: takeBestSlot(player, openSlots) || 'BN', price: sale?.price || 1, acquired: true };
  });
  const envelopes = budgetEnvelopes(me.budget, openSlots.length); const selected = new Set(); const future = [];
  envelopes.forEach((envelope, index) => {
    const candidates = availablePlayers().filter(player => !selected.has(player.id) && openSlots.some(slot => slotAccepts(slot, player)));
    if (!candidates.length) return;
    const softEnvelope = envelope + Math.max(2, Math.round(envelope * .1));
    const fitting = candidates.filter(player => plannedTargetBid(player) <= softEnvelope);
    const pool = fitting.length ? fitting : candidates.filter(player => plannedTargetBid(player) <= Math.max(1, me.budget - (openSlots.length - 1)));
    const player = [...(pool.length ? pool : candidates)].sort((a, b) => {
      const fitA = Math.abs(envelope - plannedTargetBid(a)); const fitB = Math.abs(envelope - plannedTargetBid(b));
      return (targetPriority(b) - fitB * .12) - (targetPriority(a) - fitA * .12);
    })[0];
    if (!player) return;
    selected.add(player.id); const slot = takeBestSlot(player, openSlots);
    const planPrice = Math.min(effectiveCeiling(player), plannedTargetBid(player));
    future.push({ player, slot: slot || 'BN', price: planPrice, ceiling: effectiveCeiling(player), envelope, order: index + 1, starSlot: index < 2, acquired: false });
  });
  const reserve = future.length ? Math.max(2, Math.round(me.budget * .03)) : 0;
  const targetSpend = Math.max(future.length, me.budget - reserve);
  let plannedSpend = future.reduce((sum, entry) => sum + entry.price, 0);
  if (plannedSpend > targetSpend) {
    [...future].sort((a, b) => a.price - b.price || targetPriority(a.player) - targetPriority(b.player)).forEach(entry => {
      const reduction = Math.min(entry.price - 1, plannedSpend - targetSpend);
      entry.price -= reduction; plannedSpend -= reduction;
    });
  }
  let unallocated = Math.max(0, targetSpend - plannedSpend);
  const aggressiveOrder = [...future].sort((a, b) => targetPriority(b.player) - targetPriority(a.player));
  while (unallocated > 0 && aggressiveOrder.some(entry => entry.price < entry.ceiling)) {
    for (const entry of aggressiveOrder) {
      if (unallocated <= 0) break;
      if (entry.price < entry.ceiling) { entry.price += 1; unallocated -= 1; }
    }
  }
  future.sort((a, b) => b.price - a.price || targetPriority(b.player) - targetPriority(a.player));
  const remainingSpend = future.reduce((sum, entry) => sum + entry.price, 0);
  return { acquired, future, totalCost: acquired.reduce((sum, entry) => sum + entry.price, 0) + remainingSpend,
    remainingSpend, budgetLeft: me.budget - remainingSpend, reserve };
}

function getPrimaryTarget() {
  if (!state.auction || !state.players.length) return null;
  const plan = buildIdealPlan();
  const saved = plan.future.find(entry => entry.player.id === state.auction.primaryTargetId)?.player;
  if (saved) return saved;
  const target = plan.future[0]?.player || null;
  state.auction.primaryTargetId = target?.id || null;
  saveAuction();
  return target;
}

function setPrimaryTarget(id) { state.auction.primaryTargetId = id; saveAuction(); renderAuction(); }

function cyclePrimaryTarget() {
  const pool = buildIdealPlan().future.map(entry => entry.player);
  const current = pool.findIndex(player => player.id === state.auction.primaryTargetId);
  state.auction.primaryTargetId = pool[(current + 1) % Math.max(1, pool.length)]?.id || null;
  saveAuction(); renderAuction();
}

function decisionFor(player) {
  const baseMax = effectiveCeiling(player); const planEntry = buildIdealPlan().future.find(entry => entry.player.id === player.id); const target = getPrimaryTarget();
  if (planEntry) return { maxBid: Math.min(baseMax, planEntry.ceiling), target, reserveBid: planEntry.price, protectedCap: planEntry.ceiling, planEntry };
  if (!target || target.id === player.id) return { maxBid: baseMax, target, reserveBid: 0, protectedCap: baseMax };
  const myTeam = state.auction.teams[state.auction.settings.myPosition];
  const remainingAfterThis = state.auction.settings.rosterSize - myTeam.roster.length - 1;
  const reserveBid = plannedTargetBid(target); const reserveMinimums = Math.max(0, remainingAfterThis - 1);
  const protectedCap = Math.max(0, myTeam.budget - reserveBid - reserveMinimums);
  return { maxBid: Math.max(0, Math.min(baseMax, protectedCap)), target, reserveBid, protectedCap };
}

function nominatePlayer(playerId) {
  if (!state.auction || state.auction.phase !== 'nomination') return;
  state.auction.phase = 'sale'; state.auction.nominatedPlayerId = playerId;
  state.auction.timer = state.auction.settings.bidSeconds; state.auction.paused = false; saveAuction(); renderAuction();
}

function cancelNomination() {
  state.auction.phase = 'nomination'; state.auction.nominatedPlayerId = null;
  state.auction.timer = state.auction.settings.nominationSeconds; state.auction.paused = false; saveAuction(); renderAuction();
}

function recordSale() {
  if (!state.auction || state.auction.phase !== 'sale') return;
  const teamIndex = Number($('#saleTeam').value); const price = Math.round(Number($('#salePrice').value));
  const player = state.players.find(item => item.id === state.auction.nominatedPlayerId); const team = state.auction.teams[teamIndex];
  if (!player || !team || !Number.isFinite(price) || price < 1) return toast('Geçerli bir satış fiyatı gir.');
  if (price > maxLegalBid(teamIndex)) return toast(`${team.name} en fazla $${maxLegalBid(teamIndex)} ödeyebilir.`);
  const purchase = { playerId: player.id, teamIndex, price, nominatorIndex: state.auction.nominatorIndex };
  team.budget -= price; team.roster.push(player.id); state.auction.drafted.push(player.id); state.auction.purchases.push(purchase);
  if (state.auction.primaryTargetId === player.id) state.auction.primaryTargetId = null;
  if (state.auction.aiAdvice) { state.auction.aiAdvice = null; state.auction.aiAdviceStale = true; }
  toast(`${player.name}, ${team.name} takımına $${price}`); advanceNominator(); calculateAuctionValues(); saveAuction(); renderAuction();
}

function advanceNominator() {
  const total = state.auction.teams.length; let next = state.auction.nominatorIndex;
  for (let count = 0; count < total; count++) {
    next = (next + 1) % total;
    if (state.auction.teams[next].roster.length < state.auction.settings.rosterSize) break;
  }
  state.auction.nominatorIndex = next; state.auction.phase = 'nomination'; state.auction.nominatedPlayerId = null;
  state.auction.timer = state.auction.settings.nominationSeconds; state.auction.paused = false;
}

function undoLastSale() {
  const purchase = state.auction?.purchases.pop(); if (!purchase) return toast('Geri alınacak satış yok.');
  const team = state.auction.teams[purchase.teamIndex]; team.budget += purchase.price;
  team.roster = team.roster.filter(id => id !== purchase.playerId);
  state.auction.drafted = state.auction.drafted.filter(id => id !== purchase.playerId);
  state.auction.nominatorIndex = purchase.nominatorIndex; state.auction.phase = 'nomination'; state.auction.nominatedPlayerId = null; state.auction.primaryTargetId = null;
  if (state.auction.aiAdvice) { state.auction.aiAdvice = null; state.auction.aiAdviceStale = true; }
  state.auction.timer = state.auction.settings.nominationSeconds; state.auction.paused = false;
  saveAuction(); renderAuction(); toast('Son satış geri alındı.');
}

function renderAuction() {
  if (!state.auction || !state.players.length) return;
  updateClock();
  const auction = state.auction; const me = auction.teams[auction.settings.myPosition];
  const nominated = state.players.find(player => player.id === auction.nominatedPlayerId);
  $('#draftCount').textContent = auction.drafted.length;
  $('#phaseLabel').textContent = auction.phase === 'nomination' ? 'Oyuncu bekleniyor' : 'Karar zamanı';
  $('#turnCaption').textContent = auction.phase === 'nomination' ? 'Sıradaki nomination' : 'Oyuncuyu nomine eden';
  $('#currentNominator').textContent = currentNominator()?.name || '—'; $('#myBudget').textContent = `$${me.budget}`;
  const remaining = auction.settings.rosterSize - me.roster.length;
  $('#myPace').textContent = remaining ? `$${fmt(me.budget / remaining, 2)} / boş yer` : 'Kadro tamamlandı';
  $('#rosterCount').textContent = `${me.roster.length}/${auction.settings.rosterSize}`;
  $('#teamStrip').innerHTML = auction.teams.map((team, index) => `<div class="team-card ${index === auction.nominatorIndex ? 'active' : ''} ${index === auction.settings.myPosition ? 'me' : ''}"><span>${team.name}</span><strong>$${team.budget}</strong><small>${team.roster.length}/${auction.settings.rosterSize}</small></div>`).join('');
  $('#myRoster').innerHTML = me.roster.length ? me.roster.map(id => {
    const player = state.players.find(item => item.id === id); const sale = auction.purchases.find(item => item.playerId === id);
    return `<div class="roster-player"><span>${player?.name || id}</span><strong>$${sale?.price || 0}</strong></div>`;
  }).join('') : '<p class="muted-small">Henüz oyuncu almadın.</p>';
  renderPrimaryTarget(); renderTargetList(); renderIdealPlan();
  $('#bidStage').classList.toggle('hidden', auction.phase !== 'sale'); $('.auction-toolbar').classList.toggle('hidden', auction.phase === 'sale');
  if (nominated) renderBidStage(nominated);
  const term = $('#auctionSearch').value.toLocaleLowerCase('tr'); const position = $('#auctionPosition').value;
  const available = availablePlayers().filter(player => player.name.toLocaleLowerCase('tr').includes(term) && (position === 'ALL' || player.positions.includes(position)));
  $('#auctionGrid').innerHTML = auction.phase === 'nomination' ? available.slice(0, 220).map(player => `<button class="auction-player ${state.targets.has(player.id) ? 'target' : ''}" data-nominate="${player.id}"><span><strong>${player.name}</strong><small>${player.team} · ${player.positions.join('/')} · ${player.projection_only ? 'yeni/veri yok' : `${fmt(player.fantasy_ppg)} FPPG`} · Yahoo ${player.yahoo_average_salary ? `$${fmt(player.yahoo_average_salary)}` : '—'}</small></span><b>$${state.values.get(player.id) || 1}</b></button>`).join('') : '';
  $$('[data-nominate]').forEach(button => button.addEventListener('click', () => nominatePlayer(button.dataset.nominate)));
  renderPurchaseLog();
}

function renderPrimaryTarget() {
  const target = getPrimaryTarget();
  if (!target) { $('#primaryTarget').innerHTML = '<h3>Draft tamamlandı</h3>'; return; }
  const entry = buildIdealPlan().future.find(item => item.player.id === target.id);
  const plan = entry?.price || plannedTargetBid(target); const ceiling = entry?.ceiling || effectiveCeiling(target); const rivals = competitionCount(target, estimatedSalePrice(target));
  $('#primaryTarget').innerHTML = `<span class="mini-label">SIRADAKİ ANA HEDEFİM</span><h3>${target.name}</h3><p>${target.positions.join('/')} · ${riskLabel(target)}</p><div class="target-price">Plan $${plan}</div><p>Mutlak tavan $${ceiling} · Yahoo Avg $${fmt(target.yahoo_average_salary || marketAnchor(target))} · Piyasa fiyatına çıkabilen ${rivals} rakip</p><button id="recalculateTarget">Sonraki hedefi göster</button>`;
  $('#recalculateTarget').addEventListener('click', cyclePrimaryTarget);
}

function renderTargetList() {
  const targets = availablePlayers().filter(player => state.targets.has(player.id));
  $('#targetCount').textContent = `${targets.length} oyuncu`;
  $('#targetList').innerHTML = targets.length ? targets.map(player => `<div class="target-row ${state.auction.primaryTargetId === player.id ? 'primary' : ''}"><button class="target-name" data-target-nominate="${player.id}" ${state.auction.phase !== 'nomination' ? 'disabled' : ''}><span>${player.name}</span><small>${player.positions.join('/')} · Plan $${plannedTargetBid(player)} · Tavan $${effectiveCeiling(player)}</small></button><span class="target-actions"><button class="make-primary ${state.auction.primaryTargetId === player.id ? 'active' : ''}" data-make-primary="${player.id}">ANA</button><button class="target-remove" data-target-remove="${player.id}" title="Hedeften çıkar">×</button></span></div>`).join('') : '<p class="muted-small">Board ekranındaki yıldızla kişisel tercih ekleyebilirsin.</p>';
  $$('[data-target-nominate]').forEach(button => button.addEventListener('click', () => nominatePlayer(button.dataset.targetNominate)));
  $$('[data-make-primary]').forEach(button => button.addEventListener('click', () => setPrimaryTarget(button.dataset.makePrimary)));
  $$('[data-target-remove]').forEach(button => button.addEventListener('click', () => toggleTarget(button.dataset.targetRemove)));
}

async function refreshAIPlan() {
  if (!state.auction || !state.players.length) return;
  const button = $('#aiPlanBtn'); const note = $('#aiPlanNote');
  button.disabled = true; button.textContent = 'AI düşünüyor…'; note.textContent = 'Sayısal kısa liste OpenAI modeline gönderiliyor.';
  try {
    const me = state.auction.teams[state.auction.settings.myPosition]; const plan = buildIdealPlan();
    const available = availablePlayers();
    const numericShortlist = [...available].sort((a, b) => targetPriority(b, false) - targetPriority(a, false)).slice(0, 30);
    const researchShortlist = available.filter(player => player.projection_only)
      .sort((a, b) => (Number(a.yahoo_rank || 9999) - Number(b.yahoo_rank || 9999)) || (marketAnchor(b) - marketAnchor(a))).slice(0, 7);
    const candidatePlayers = [...numericShortlist, ...researchShortlist].filter((player, index, list) => list.findIndex(item => item.id === player.id) === index).slice(0, 45);
    const candidates = candidatePlayers.map(player => ({
      id: player.id, name: player.name, team: player.team, positions: player.positions,
      model_value: state.values.get(player.id) || 1, yahoo_avg: Number(player.yahoo_average_salary || 0),
      expected_price: estimatedSalePrice(player), numeric_ceiling: baseRecommendedMax(player),
      legal_max: maxLegalBid(state.auction.settings.myPosition), projected_total: Math.round(player.projected_total || player.score || 0),
      weighted_h2h_ppg: Number(player.fantasy_ppg || 0), actual_h2h_points_history: h2hHistory(player), expected_games: player.expected_games,
      missed_game_rate: player.missed_game_rate, projection_only: Boolean(player.projection_only), personal_target: state.targets.has(player.id),
      yahoo_rank: Number(player.yahoo_rank || 0), yahoo_projected_salary: Number(player.yahoo_projected_salary || 0),
      yahoo_percent_drafted: Number(player.yahoo_percent_drafted || 0), yahoo_preseason_average_salary: Number(player.yahoo_preseason_average_salary || 0),
      yahoo_note_available: Boolean(player.yahoo_has_player_note), yahoo_note_updated_at: Number(player.yahoo_note_updated_at || 0),
      star_candidate_tier: starCandidateTier(player), research_candidate: Boolean(player.projection_only),
    }));
    const payload = {
      scoring: 'PTS + 1.2 REB + 1.5 AST + 3 STL + 3 BLK - TO', season_weights: [0.55, 0.30, 0.15], no_il: true,
      strategy: 'Kalan bütçeyi bitir; dayanıklı ve elit 1-2 yıldıza kontrollü prim ver, ardından değer seçimleri yap. Sakatlık riskini yıldızlarda dahi gevşetme.',
      decision_order: 'Önce en güçlü ve sağlıklı kadroyu seç; fiyatı yalnızca bu kadroyu bütçeye sığdırmak için ikinci aşamada belirle.',
      enable_web_research: !state.auction.aiResearchCompleted,
      bid_adjustment_rule: 'AI numeric_ceiling değerini dolar bazında en fazla -20 veya +20 değiştirebilir.',
      h2h_history_definition: 'Tamamlanmış sezonlarda bu puanlama formülüyle hesaplanan gerçek maç başı ve toplam H2H puanı; en yeni sezon önce gelir.',
      yahoo_note_limitation: 'Yahoo not metni herkese açık veride yoktur; yalnızca notun varlığı ve son güncellenme zamanı verilmiştir, içerik çıkarımı yapılamaz.',
      roster_slots: rosterSlots(state.auction.settings.rosterSize), open_roster_slots: plan.future.map(entry => entry.slot), remaining_budget: me.budget,
      acquired: plan.acquired.map(entry => ({ id: entry.player.id, name: entry.player.name, slot: entry.slot, price: entry.price })),
      numeric_plan: plan.future.map(entry => ({ id: entry.player.id, name: entry.player.name, slot: entry.slot, budget: entry.price, ceiling: entry.ceiling })),
      opponents: state.auction.teams.filter((team, index) => index !== state.auction.settings.myPosition).map(team => ({ budget: team.budget, roster_count: team.roster.length })),
      candidates,
    };
    const advice = await api('/api/ai-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    state.auction.aiAdvice = advice;
    if (!advice.fallback_used) state.auction.aiRosterPreference = advice.recommended_roster;
    state.auction.aiResearchCompleted = true; state.auction.aiAdviceStale = false; state.auction.primaryTargetId = null;
    saveAuction(); renderAuction();
    toast(advice.fallback_used ? 'AI yanıtı yarım kaldı; sayısal plan korundu.' : `AI ${advice.recommended_roster.length} oyunculuk plan oluşturdu.`);
  } catch (error) {
    note.textContent = error.message; toast('AI planı alınamadı.');
  } finally {
    button.disabled = false; button.textContent = 'AI ile planı iyileştir';
  }
}

function renderIdealPlan() {
  const plan = buildIdealPlan(); const totalSlots = state.auction.settings.rosterSize;
  $('#planBudget').textContent = `${plan.acquired.length + plan.future.length}/${totalSlots} oyuncu`;
  $('#planSummary').textContent = plan.future.length
    ? `Plan $${plan.remainingSpend} + güvenlik payı $${plan.budgetLeft} = kasa $${state.auction.teams[state.auction.settings.myPosition].budget} · Hedefler pahalıdan ucuza sıralı.`
    : 'Kadron tamamlandı.';
  const aiAdvice = state.auction.aiAdvice;
  $('#aiPlanNote').textContent = aiAdvice ? `${aiAdvice.model}: ${aiAdvice.summary}` : state.auction.aiAdviceStale
    ? 'Son satıştan sonra AI önerisi eskidi. Yeniden çalıştırabilirsin.'
    : 'AI, sayısal modelin kısa listesini sakatlık, kadro dengesi ve bütçe kullanımı açısından yeniden sıralar.';
  const sources = aiAdvice?.priorities?.flatMap(advice => advice.sources || []).filter((source, index, list) => source.url && list.findIndex(item => item.url === source.url) === index).slice(0, 8) || [];
  $('#aiSources').innerHTML = sources.map(source => {
    const url = safeHttpUrl(source.url); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || 'Araştırma kaynağı')}</a>` : '';
  }).join('');
  const acquiredCards = plan.acquired.map((entry, index) => `<div class="plan-card acquired"><span class="plan-index">✓</span><div><span class="plan-slot">${entry.slot} · ALINDI</span><strong>${entry.player.name}</strong><small>${entry.player.positions.join('/')} · ${riskLabel(entry.player)}</small></div><div class="plan-money"><strong>$${entry.price}</strong><small>ödendi</small></div></div>`);
  const futureCards = plan.future.map((entry, index) => {
    const advice = aiAdviceFor(entry.player); const reason = advice?.reason ? ` · AI: ${escapeHtml(advice.reason)}` : '';
    const adjustment = advice?.bid_adjustment ? ` · AI ${advice.bid_adjustment > 0 ? '+' : ''}$${advice.bid_adjustment}` : '';
    const aiPick = aiRosterRank(entry.player) >= 0;
    const label = entry.starSlot ? `STAR HEDEF${aiPick ? ' · AI' : ''}` : aiPick ? 'AI KADROSU' : advice ? 'AI DESTEKLİ' : entry.player.projection_only ? 'BELİRSİZ' : 'PLAN';
    return `<button class="plan-card ${state.auction.primaryTargetId === entry.player.id ? 'primary' : ''} ${advice ? 'ai-ranked' : ''}" data-plan-nominate="${entry.player.id}" ${state.auction.phase !== 'nomination' ? 'disabled' : ''}><span class="plan-index">${index + 1}</span><div><span class="plan-slot">${entry.slot} · ${label}</span><strong>${entry.player.name}</strong><small>${entry.player.positions.join('/')} · ${riskLabel(entry.player)} · Yahoo ${entry.player.yahoo_average_salary ? `$${fmt(entry.player.yahoo_average_salary)}` : '—'}${adjustment}${reason}</small></div><div class="plan-money"><strong>$${entry.price}</strong><small>tavan $${entry.ceiling}</small></div></button>`;
  });
  $('#idealPlan').innerHTML = [...acquiredCards, ...futureCards].join('') || '<p class="muted-small">Plan oluşturulamadı.</p>';
  $$('[data-plan-nominate]').forEach(button => button.addEventListener('click', () => nominatePlayer(button.dataset.planNominate)));
}

function planComparisonFor(player) {
  const plan = buildIdealPlan(); const exactIndex = plan.future.findIndex(entry => entry.player.id === player.id);
  if (exactIndex >= 0) return { entry: plan.future[exactIndex], exact: true, index: exactIndex + 1 };
  const alternatives = plan.future.filter(entry => entry.player.positions.some(position => player.positions.includes(position)));
  const entry = alternatives.sort((a, b) => b.price - a.price || targetPriority(b.player) - targetPriority(a.player))[0];
  return entry ? { entry, exact: false, index: plan.future.indexOf(entry) + 1 } : null;
}

function renderBidStage(player) {
  const decision = decisionFor(player); const expected = estimatedSalePrice(player); const rivals = competitionCount(player, expected); const comparison = planComparisonFor(player);
  $('#nominatedPlayer').innerHTML = `${player.headshot ? `<img src="${player.headshot}" alt="">` : ''}<div><span class="mini-label">ŞU AN NOMİNE EDİLEN</span><h2>${player.name}</h2><p>${player.team} · ${player.positions.join('/')} · ${player.projection_only ? '3Y veri yok' : `${fmt(player.fantasy_ppg)} FPPG`} · ${riskLabel(player)}</p><span class="market-price">Bizim $${state.values.get(player.id) || 1} · Yahoo Avg $${player.yahoo_average_salary ? fmt(player.yahoo_average_salary) : '—'}</span></div>`;
  const isTarget = decision.target?.id === player.id;
  const verdict = comparison?.exact ? `PLAN OYUNCUSU #${comparison.index} — takip et` : isTarget ? 'ANA HEDEF — takip et' : decision.maxBid >= expected ? 'Uygun fiyatta alınabilir' : 'Sadece indirimde alınır';
  const reserve = comparison?.exact ? `Plan fiyatın <strong>$${comparison.entry.price}</strong>. Erken geldiyse de değerlendirebilirsin; <strong>$${decision.maxBid}</strong> mutlak tavan.` : isTarget ? `Bu ana hedefin. Planlanan satın alma fiyatı $${expected}; mutlak tavanı aşma.` : decision.target ? `Bu oyuncuda <strong>$${decision.maxBid}</strong> aşılırsa PASS. ${decision.target.name} için planlanan <strong>$${decision.reserveBid}</strong> bütçeyi ve diğer boş kadro yerleri için $1'leri koruyoruz.` : 'Kalan kadro ve minimum teklif bütçesi korunuyor.';
  let comparisonHtml = '';
  if (comparison) {
    const planned = comparison.entry.player; const scoreDelta = Math.round((player.projected_total || player.score || 0) - (planned.projected_total || planned.score || 0));
    comparisonHtml = comparison.exact
      ? `<div class="plan-comparison exact"><span>13'LÜ PLANDA</span><strong>#${comparison.index} · ${comparison.entry.slot} · Plan $${comparison.entry.price}</strong><small>Bu oyuncu zaten yaşayan planın içinde. Satış başkasına giderse yerine otomatik yeni hedef gelir.</small></div>`
      : `<div class="plan-comparison"><span>AYNI MEVKİDEKİ PLAN HEDEFİ</span><strong>${planned.name} · Plan $${comparison.entry.price}</strong><small>Nomine edilen oyuncunun 3Y risk-ayarlı toplam farkı ${scoreDelta >= 0 ? '+' : ''}${scoreDelta}. ${riskLabel(player)} ↔ ${riskLabel(planned)}</small></div>`;
  }
  $('#bidDecision').innerHTML = `<span class="mini-label">SENİN TEKLİF TAVANIN</span><h2>$${decision.maxBid}</h2><h3>${verdict}</h3><div class="decision-prices"><div><span>BİZİM DEĞER</span><strong>$${state.values.get(player.id) || 1}</strong></div><div><span>YAHOO AVG</span><strong>${player.yahoo_average_salary ? `$${fmt(player.yahoo_average_salary)}` : '—'}</strong></div><div><span>BEKLENEN SATIŞ</span><strong>$${expected}</strong></div></div>${comparisonHtml}<p class="reserve-note">${reserve}<br>${rivals} rakibin bu oyuncu için beklenen fiyatı ödeyecek bütçesi var.</p>`;
  $('#saleTeam').innerHTML = state.auction.teams.map((team, index) => `<option value="${index}" ${index === state.auction.settings.myPosition ? 'selected' : ''} ${team.roster.length >= state.auction.settings.rosterSize ? 'disabled' : ''}>${team.name} · $${team.budget} kaldı</option>`).join('');
  if ($('#salePrice').dataset.playerId !== player.id) {
    $('#salePrice').dataset.playerId = player.id; $('#salePrice').value = Math.max(1, Math.round(marketAnchor(player)));
  }
}

function renderPurchaseLog() {
  $('#purchaseLog').innerHTML = state.auction.purchases.length ? [...state.auction.purchases].reverse().map(purchase => {
    const player = state.players.find(item => item.id === purchase.playerId); const team = state.auction.teams[purchase.teamIndex];
    const expected = player ? marketAnchor(player) : purchase.price; const good = purchase.price <= expected;
    return `<div><span>${player?.name || purchase.playerId}</span><span>${team.name}</span><strong>$${purchase.price}</strong><small class="${good ? 'value-good' : 'value-over'}">${good ? 'piyasa altı' : 'piyasa üstü'} · Yahoo/market $${Math.round(expected)}</small></div>`;
  }).join('') : '<p class="muted-small">Henüz tamamlanan satış yok.</p>';
}

$$('.nav-link').forEach(button => button.addEventListener('click', () => {
  $$('.nav-link').forEach(item => item.classList.toggle('active', item === button));
  $$('.view').forEach(view => view.classList.remove('active')); $(`#${button.dataset.view}View`).classList.add('active'); renderAuction();
}));
$('#positionFilters').addEventListener('click', event => {
  if (!event.target.dataset.position) return; state.position = event.target.dataset.position;
  $$('#positionFilters button').forEach(button => button.classList.toggle('active', button === event.target)); applyFilters();
});
$('#searchInput').addEventListener('input', applyFilters); $('#refreshBtn').addEventListener('click', () => loadPlayers(true));
$('#auctionSearch').addEventListener('input', renderAuction); $('#auctionPosition').addEventListener('change', renderAuction);
$('#auctionForm').addEventListener('submit', event => { event.preventDefault(); startAuction(); });
$('#pauseTimer').addEventListener('click', () => { state.auction.paused = !state.auction.paused; saveAuction(); updateClock(); });
$('#resetTimer').addEventListener('click', resetTimer);
$('#aiPlanBtn').addEventListener('click', refreshAIPlan);
$('#recordSale').addEventListener('click', recordSale); $('#cancelNomination').addEventListener('click', cancelNomination);
$('#undoAuction').addEventListener('click', undoLastSale);
$('#resetAuction').addEventListener('click', () => {
  if (!confirm('Auction geçmişi ve tüm kadrolar silinsin mi?')) return;
  localStorage.removeItem('draftlab-auction-v2'); state.auction = null; clearInterval(state.timerHandle);
  $('#auctionRoom').classList.add('hidden'); $('#auctionSetup').classList.remove('hidden'); $('#draftCount').textContent = '0'; calculateAuctionValues(); renderBoard();
});

restoreAuction(); loadPlayers();
