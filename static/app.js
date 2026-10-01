const state = { players: [], filtered: [], position: 'ALL', auction: null, values: new Map(), targets: new Set(JSON.parse(localStorage.getItem('draftlab-targets') || '[]')), timerHandle: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const initials = name => name.split(' ').slice(0, 2).map(part => part[0]).join('');
const fmt = (value, digits = 1) => Number(value || 0).toFixed(digits);

async function api(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'İstek başarısız');
  return payload;
}

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2400);
}

async function loadPlayers(force = false) {
  $('#refreshBtn').classList.add('loading'); $('#syncText').textContent = 'Üç sezon yükleniyor…';
  try {
    const data = await api(`/api/players?mode=points${force ? '&refresh=1' : ''}`);
    state.players = data.players; calculateAuctionValues();
    $('#syncDot').classList.toggle('live', data.source === 'espn');
    $('#syncText').textContent = data.source === 'espn' ? `ESPN · ${data.seasons.join(' / ')}` : 'Demo veri';
    if (data.warning) showNotice(data.warning); else $('#notice').classList.add('hidden');
    applyFilters(); renderAuction();
  } catch (error) { showNotice(error.message); $('#syncText').textContent = 'Veri alınamadı'; }
  finally { $('#refreshBtn').classList.remove('loading'); }
}

function showNotice(text) { const node = $('#notice'); node.textContent = text; node.classList.remove('hidden'); }

function settings() {
  return state.auction?.settings || { teamCount: 10, budget: 200, rosterSize: 13 };
}

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
    const flexibility = player.positions.length > 1 ? 1.035 : 1;
    return { player, surplus: Math.max(0, total - baseline * .82) * flexibility };
  }).sort((a, b) => b.surplus - a.surplus);
  const rosterable = scored.slice(0, teamCount * rosterSize);
  const totalSurplus = rosterable.reduce((sum, entry) => sum + entry.surplus, 0) || 1;
  const discretionaryPool = teamCount * Math.max(0, budget - rosterSize);
  state.values = new Map(scored.map(entry => [entry.player.id, entry.surplus > 0 ? Math.max(1, Math.round(1 + discretionaryPool * entry.surplus / totalSurplus)) : 1]));
}

function applyFilters() {
  const term = $('#searchInput').value.toLocaleLowerCase('tr');
  state.filtered = state.players.filter(player => (state.position === 'ALL' || player.positions.includes(state.position)) && player.name.toLocaleLowerCase('tr').includes(term));
  renderBoard();
}

function riskLabel(player) {
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
    <td>${fmt(player.fantasy_ppg)}</td><td>${player.expected_games || '—'}</td>
    <td class="${player.missed_game_rate >= .2 ? 'risk-high' : ''}">%${Math.round((player.missed_game_rate || 0) * 100)}</td>
    <td>${Math.round(player.projected_total || player.score).toLocaleString('tr-TR')}</td>
    <td><span class="score-pill">$${state.values.get(player.id) || 1}</span></td>
    <td><button class="target-button ${state.targets.has(player.id) ? 'active' : ''}" data-target-id="${player.id}" title="Hedef oyuncu">★</button></td></tr>`).join('');
  $$('[data-target-id]').forEach(button => button.addEventListener('click', () => toggleTarget(button.dataset.targetId)));
}

function toggleTarget(id) {
  state.targets.has(id) ? state.targets.delete(id) : state.targets.add(id);
  localStorage.setItem('draftlab-targets', JSON.stringify([...state.targets])); renderBoard(); renderAuction();
}

function startAuction(form) {
  const opponents = $('#opponentNames').value.split('\n').map(name => name.trim()).filter(Boolean);
  if (!opponents.length) return toast('En az bir rakip adı gir.');
  const teamCount = opponents.length + 1; const myPosition = Math.min(teamCount, Math.max(1, Number($('#myPositionInput').value))) - 1;
  const names = [...opponents]; names.splice(myPosition, 0, 'Sen');
  const auctionSettings = {
    teamCount, budget: Number($('#budgetInput').value), rosterSize: Number($('#rosterInput').value),
    nominationSeconds: Number($('#nominationTimeInput').value), bidSeconds: Number($('#bidTimeInput').value), myPosition,
  };
  state.auction = {
    version: 2, settings: auctionSettings, teams: names.map(name => ({ name, budget: auctionSettings.budget, roster: [] })),
    nominatorIndex: 0, phase: 'nomination', timer: auctionSettings.nominationSeconds, paused: false,
    nominatedPlayerId: null, highBid: 0, highBidderIndex: null, drafted: [], purchases: [],
  };
  calculateAuctionValues(); saveAuction(); showRoom(); startTimer(); renderAuction();
}

function showRoom() { $('#auctionSetup').classList.add('hidden'); $('#auctionRoom').classList.remove('hidden'); }
function saveAuction() { localStorage.setItem('draftlab-auction-v2', JSON.stringify(state.auction)); }

function restoreAuction() {
  try { state.auction = JSON.parse(localStorage.getItem('draftlab-auction-v2')); } catch { state.auction = null; }
  if (state.auction?.version === 2) { showRoom(); startTimer(); }
}

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    if (!state.auction || state.auction.paused) return;
    state.auction.timer = Math.max(0, state.auction.timer - 1);
    if (state.auction.timer === 0) {
      if (state.auction.phase === 'bidding') awardPlayer();
      else autoNominate();
    }
    saveAuction(); updateClock();
  }, 1000);
}

function updateClock() {
  if (!state.auction) return;
  $('#clock').textContent = state.auction.timer; $('#clock').classList.toggle('urgent', state.auction.timer <= 10);
  $('#pauseTimer').textContent = state.auction.paused ? 'Saati devam ettir' : 'Saati durdur';
}

function activeTeams() { return state.auction.teams.filter(team => team.roster.length < state.auction.settings.rosterSize); }
function currentNominator() { return state.auction.teams[state.auction.nominatorIndex]; }
function availablePlayers() { return state.players.filter(player => !state.auction.drafted.includes(player.id)); }

function maxLegalBid(teamIndex) {
  const team = state.auction.teams[teamIndex]; const emptyAfterWin = state.auction.settings.rosterSize - team.roster.length - 1;
  return Math.max(0, team.budget - Math.max(0, emptyAfterWin));
}

function marketMultiplier() {
  if (!state.auction?.purchases.length) return 1;
  const actual = state.auction.purchases.reduce((sum, item) => sum + item.price, 0);
  const fair = state.auction.purchases.reduce((sum, item) => sum + (state.values.get(item.playerId) || 1), 0) || 1;
  return Math.min(1.22, Math.max(.82, actual / fair));
}

function recommendedMax(player) {
  let value = (state.values.get(player.id) || 1) * marketMultiplier();
  const myTeam = state.auction.teams[state.auction.settings.myPosition]; const rosterPlayers = myTeam.roster.map(id => state.players.find(player => player.id === id)).filter(Boolean);
  const covered = rosterPlayers.flatMap(item => item.positions);
  if (player.positions.some(position => !covered.includes(position)) && rosterPlayers.length >= 3) value *= 1.07;
  if (state.targets.has(player.id)) value *= 1.08;
  if ((player.missed_game_rate || 0) >= .25) value *= .94;
  const remainingSlots = state.auction.settings.rosterSize - myTeam.roster.length;
  const paceBudget = Math.max(0, myTeam.budget - remainingSlots);
  const pace = paceBudget / Math.max(1, remainingSlots);
  if (pace < state.auction.settings.budget / state.auction.settings.rosterSize * .65) value *= .9;
  return Math.max(1, Math.min(maxLegalBid(state.auction.settings.myPosition), Math.round(value)));
}

function autoNominate() {
  const player = availablePlayers()[0]; if (player) nominatePlayer(player.id, true);
}

function nominatePlayer(playerId, automatic = false) {
  if (!state.auction || state.auction.phase !== 'nomination') return;
  const nominator = currentNominator();
  if (!nominator || nominator.roster.length >= state.auction.settings.rosterSize) { advanceNominator(); return; }
  state.auction.phase = 'bidding'; state.auction.nominatedPlayerId = playerId; state.auction.highBid = 1;
  state.auction.highBidderIndex = state.auction.nominatorIndex; state.auction.timer = state.auction.settings.bidSeconds;
  saveAuction(); renderAuction(); if (automatic) toast('Süre doldu; en yüksek sıradaki oyuncu otomatik nomine edildi.');
}

function placeBid(teamIndex, amount) {
  if (state.auction.phase !== 'bidding') return;
  if (amount <= state.auction.highBid) return toast(`Teklif en az $${state.auction.highBid + 1} olmalı.`);
  if (amount > maxLegalBid(teamIndex)) return toast(`Bu takımın maksimum teklifi $${maxLegalBid(teamIndex)}.`);
  if (state.auction.teams[teamIndex].roster.length >= state.auction.settings.rosterSize) return toast('Bu takımın kadrosu dolu.');
  state.auction.highBid = amount; state.auction.highBidderIndex = teamIndex;
  if (state.auction.timer < 10) state.auction.timer = 10;
  saveAuction(); renderAuction();
}

function awardPlayer() {
  if (!state.auction || state.auction.phase !== 'bidding') return;
  const player = state.players.find(item => item.id === state.auction.nominatedPlayerId);
  const team = state.auction.teams[state.auction.highBidderIndex];
  if (!player || !team) return;
  const purchase = { playerId: player.id, teamIndex: state.auction.highBidderIndex, price: state.auction.highBid, nominatorIndex: state.auction.nominatorIndex };
  team.budget -= purchase.price; team.roster.push(player.id); state.auction.drafted.push(player.id); state.auction.purchases.push(purchase);
  toast(`${player.name}, ${team.name} takımına $${purchase.price}`); advanceNominator(); saveAuction(); calculateAuctionValues(); renderAuction();
}

function advanceNominator() {
  const total = state.auction.teams.length; let next = state.auction.nominatorIndex;
  for (let count = 0; count < total; count++) { next = (next + 1) % total; if (state.auction.teams[next].roster.length < state.auction.settings.rosterSize) break; }
  state.auction.nominatorIndex = next; state.auction.phase = 'nomination'; state.auction.nominatedPlayerId = null;
  state.auction.highBid = 0; state.auction.highBidderIndex = null; state.auction.timer = state.auction.settings.nominationSeconds;
}

function undoLastSale() {
  const purchase = state.auction?.purchases.pop(); if (!purchase) return toast('Geri alınacak satış yok.');
  const team = state.auction.teams[purchase.teamIndex]; team.budget += purchase.price; team.roster = team.roster.filter(id => id !== purchase.playerId);
  state.auction.drafted = state.auction.drafted.filter(id => id !== purchase.playerId); state.auction.nominatorIndex = purchase.nominatorIndex;
  state.auction.phase = 'nomination'; state.auction.nominatedPlayerId = null; state.auction.highBid = 0; state.auction.highBidderIndex = null;
  state.auction.timer = state.auction.settings.nominationSeconds; saveAuction(); renderAuction(); toast('Son satış geri alındı.');
}

function renderAuction() {
  if (!state.auction || !state.players.length) return;
  updateClock(); const auction = state.auction; const me = auction.teams[auction.settings.myPosition]; const nominated = state.players.find(player => player.id === auction.nominatedPlayerId);
  $('#draftCount').textContent = auction.drafted.length; $('#phaseLabel').textContent = auction.phase === 'nomination' ? 'Nomination' : 'Teklif açık';
  $('#turnCaption').textContent = auction.phase === 'nomination' ? 'Sıradaki nomination' : 'Oyuncuyu nomine eden'; $('#currentNominator').textContent = currentNominator()?.name || '—';
  $('#myBudget').textContent = `$${me.budget}`; const remaining = auction.settings.rosterSize - me.roster.length;
  $('#myPace').textContent = remaining ? `$${fmt(me.budget / remaining, 2)} / boş yer` : 'Kadro tamamlandı'; $('#rosterCount').textContent = `${me.roster.length}/${auction.settings.rosterSize}`;
  $('#teamStrip').innerHTML = auction.teams.map((team, index) => `<div class="team-card ${index === auction.nominatorIndex ? 'active' : ''} ${index === auction.settings.myPosition ? 'me' : ''}"><span>${team.name}</span><strong>$${team.budget}</strong><small>${team.roster.length}/${auction.settings.rosterSize}</small></div>`).join('');
  $('#myRoster').innerHTML = me.roster.length ? me.roster.map(id => { const player = state.players.find(item => item.id === id); const sale = auction.purchases.find(item => item.playerId === id); return `<div class="roster-player"><span>${player?.name || id}</span><strong>$${sale?.price || 0}</strong></div>`; }).join('') : '<p class="muted-small">Henüz oyuncu almadın.</p>';
  $('#bidStage').classList.toggle('hidden', auction.phase !== 'bidding'); $('.auction-toolbar').classList.toggle('hidden', auction.phase === 'bidding');
  if (nominated) renderBidStage(nominated);
  const term = $('#auctionSearch').value.toLocaleLowerCase('tr'); const position = $('#auctionPosition').value;
  const available = availablePlayers().filter(player => player.name.toLocaleLowerCase('tr').includes(term) && (position === 'ALL' || player.positions.includes(position)));
  $('#auctionGrid').innerHTML = auction.phase === 'nomination' ? available.slice(0, 180).map(player => `<button class="auction-player ${state.targets.has(player.id) ? 'target' : ''}" data-nominate="${player.id}"><span><strong>${player.name}</strong><small>${player.team} · ${player.positions.join('/')} · ${fmt(player.fantasy_ppg)} FPPG</small></span><b>$${state.values.get(player.id) || 1}</b></button>`).join('') : '';
  $$('[data-nominate]').forEach(button => button.addEventListener('click', () => nominatePlayer(button.dataset.nominate)));
  renderRecommendation(nominated); renderPurchaseLog();
}

function renderBidStage(player) {
  const auction = state.auction; const leader = auction.teams[auction.highBidderIndex];
  $('#nominatedPlayer').innerHTML = `${player.headshot ? `<img src="${player.headshot}" alt="">` : ''}<div><span class="mini-label">NOMİNE EDİLEN</span><h2>${player.name}</h2><p>${player.team} · ${player.positions.join('/')} · ${fmt(player.fantasy_ppg)} FPPG · ${riskLabel(player)}</p></div><span class="fair-price">Fair $${state.values.get(player.id) || 1}</span>`;
  $('#highBid').textContent = `$${auction.highBid}`; $('#highBidder').textContent = leader?.name || '—';
  $('#bidderSelect').innerHTML = auction.teams.map((team, index) => `<option value="${index}" ${index === auction.settings.myPosition ? 'selected' : ''} ${team.roster.length >= auction.settings.rosterSize ? 'disabled' : ''}>${team.name} · $${team.budget}</option>`).join('');
  $('#bidAmount').min = auction.highBid + 1; $('#bidAmount').value = auction.highBid + 1;
}

function renderRecommendation(nominated) {
  const available = availablePlayers();
  if (nominated) {
    const max = recommendedMax(nominated); const current = state.auction.highBid; const verdict = current < max ? `$${max}'a kadar teklif ver` : current === max ? 'Bu son mantıklı teklif' : 'PASS — fiyat değeri geçti';
    $('#recommendation').innerHTML = `<span class="mini-label">CANLI KARAR</span><h3>${verdict}</h3><p>Fair $${state.values.get(nominated.id) || 1} · Piyasa ×${fmt(marketMultiplier(), 2)} · Risk ${riskLabel(nominated)}</p>`;
  } else {
    const target = available.find(player => state.targets.has(player.id)) || available[Math.min(12, available.length - 1)] || available[0];
    $('#recommendation').innerHTML = target ? `<span class="mini-label">NOMINATION FİKRİ</span><h3>${target.name}</h3><p>Fair $${state.values.get(target.id) || 1}. Hedefin değilse rakip bütçe harcatmak için erken nomine et.</p>` : '<h3>Draft tamamlandı</h3>';
  }
}

function renderPurchaseLog() {
  $('#purchaseLog').innerHTML = state.auction.purchases.length ? [...state.auction.purchases].reverse().map(purchase => { const player = state.players.find(item => item.id === purchase.playerId); const team = state.auction.teams[purchase.teamIndex]; const fair = state.values.get(purchase.playerId) || 1; return `<div><span>${player?.name || purchase.playerId}</span><span>${team.name}</span><strong>$${purchase.price}</strong><small class="${purchase.price <= fair ? 'value-good' : 'value-over'}">${purchase.price <= fair ? 'değer' : 'pahalı'} · fair $${fair}</small></div>`; }).join('') : '<p class="muted-small">Henüz tamamlanan satış yok.</p>';
}

$$('.nav-link').forEach(button => button.addEventListener('click', () => { $$('.nav-link').forEach(item => item.classList.toggle('active', item === button)); $$('.view').forEach(view => view.classList.remove('active')); $(`#${button.dataset.view}View`).classList.add('active'); renderAuction(); }));
$('#positionFilters').addEventListener('click', event => { if (!event.target.dataset.position) return; state.position = event.target.dataset.position; $$('#positionFilters button').forEach(button => button.classList.toggle('active', button === event.target)); applyFilters(); });
$('#searchInput').addEventListener('input', applyFilters); $('#refreshBtn').addEventListener('click', () => loadPlayers(true));
$('#auctionSearch').addEventListener('input', renderAuction); $('#auctionPosition').addEventListener('change', renderAuction);
$('#auctionForm').addEventListener('submit', event => { event.preventDefault(); startAuction(event.target); });
$('#pauseTimer').addEventListener('click', () => { state.auction.paused = !state.auction.paused; saveAuction(); updateClock(); });
$('#placeBid').addEventListener('click', () => placeBid(Number($('#bidderSelect').value), Number($('#bidAmount').value)));
$$('.quick-bids button').forEach(button => button.addEventListener('click', () => { $('#bidAmount').value = state.auction.highBid + Number(button.dataset.increment); }));
$('#awardNow').addEventListener('click', awardPlayer); $('#undoAuction').addEventListener('click', undoLastSale);
$('#resetAuction').addEventListener('click', () => { if (!confirm('Auction geçmişi ve tüm kadrolar silinsin mi?')) return; localStorage.removeItem('draftlab-auction-v2'); state.auction = null; clearInterval(state.timerHandle); $('#auctionRoom').classList.add('hidden'); $('#auctionSetup').classList.remove('hidden'); $('#draftCount').textContent = '0'; calculateAuctionValues(); renderBoard(); });

restoreAuction(); loadPlayers();
