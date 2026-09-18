const state = { players: [], filtered: [], source: 'demo', position: 'ALL', mode: 'points', draft: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const initials = (name) => name.split(' ').slice(0, 2).map(part => part[0]).join('');
const fmt = (value, digits = 1) => Number(value || 0).toFixed(digits);

async function api(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'İstek başarısız');
  return payload;
}

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2200);
}

async function loadStatusAndLeagues() {
  try {
    const status = await api('/api/status');
    if (status.connected) {
      const { leagues } = await api('/api/leagues');
      leagues.forEach(league => $('#leagueSelect').insertAdjacentHTML('beforeend', `<option value="${league.key}">${league.name}${league.season ? ` · ${league.season}` : ''}</option>`));
      if (leagues[0]) $('#leagueSelect').value = leagues[0].key;
      await loadPlayers();
    } else if (status.configured) {
      showNotice('Yahoo ayarları bulundu. Canlı ligin için <a href="/auth/yahoo">Yahoo hesabını bağla →</a>');
    } else {
      showNotice('Şu an demo veri gösteriliyor. Canlı veri için README’deki üç Yahoo ayarını ekle.');
    }
  } catch (error) { showNotice(`Yahoo bağlantısı kontrol edilemedi: ${error.message}`); }
}

function showNotice(html) { const notice = $('#notice'); notice.innerHTML = html; notice.classList.remove('hidden'); }

async function loadPlayers() {
  $('#refreshBtn').classList.add('loading'); $('#syncText').textContent = 'Yenileniyor…';
  const league = $('#leagueSelect').value;
  try {
    const data = await api(`/api/players?mode=${state.mode}&league_key=${encodeURIComponent(league)}`);
    state.players = data.players; state.source = data.source;
    $('#syncDot').classList.toggle('live', data.source.startsWith('yahoo'));
    $('#syncText').textContent = data.source.startsWith('yahoo') ? `Yahoo · ${data.seasons.join(' + ')}` : 'Demo veri';
    if (data.warning) showNotice(data.warning);
    else $('#notice').classList.add('hidden');
    applyFilters(); renderDraft();
  } catch (error) { showNotice(error.message); $('#syncText').textContent = 'Yenileme başarısız'; }
  finally { $('#refreshBtn').classList.remove('loading'); }
}

function applyFilters() {
  const term = $('#searchInput').value.toLocaleLowerCase('tr');
  state.filtered = state.players.filter(player => (state.position === 'ALL' || player.positions.includes(state.position)) && player.name.toLocaleLowerCase('tr').includes(term));
  renderTable();
}

function renderTable() {
  $('#playerTotal').textContent = `${state.filtered.length} oyuncu`;
  $('#emptyState').classList.toggle('hidden', state.filtered.length > 0);
  $('#playerRows').innerHTML = state.filtered.map(player => {
    const stats = player.stats; const hasRiskData = typeof player.missed_game_rate === 'number';
    const missed = hasRiskData ? player.missed_game_rate : null;
    const warning = (hasRiskData && missed >= .2) || player.status !== 'Healthy';
    const riskLabel = !hasRiskData ? 'Veri yok' : missed >= .25 ? `Yüksek · %${Math.round(missed * 100)}` : missed >= .1 ? `Orta · %${Math.round(missed * 100)}` : `Düşük · %${Math.round(missed * 100)}`;
    const history = player.season_history?.map(item => `${item.season}: ${item.games} maç`).join(' · ') || 'Demo veri';
    return `<tr><td class="rank-cell">${String(player.rank).padStart(2, '0')}</td><td><div class="player-cell"><span class="avatar">${initials(player.name)}</span><span class="player-meta"><strong>${player.name}</strong><span>${player.team}</span></span></div></td><td>${player.positions.map(pos => `<span class="pos-badge">${pos}</span>`).join('')}</td><td>${fmt(stats.pts)}</td><td>${fmt(stats.reb)}</td><td>${fmt(stats.ast)}</td><td>${fmt(stats.stl)}</td><td>${fmt(stats.blk)}</td><td>${fmt(stats.fg_pct * 100)}%</td><td>${fmt(stats.ft_pct * 100)}%</td><td><span class="risk ${warning ? 'warn' : ''}" title="${history}${player.injury_note ? ` · ${player.injury_note}` : ''}">${riskLabel}</span></td><td><span class="score-pill">${fmt(player.score, 2)}</span></td></tr>`;
  }).join('');
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

function startDraft(teamCount, rounds) {
  const teams = shuffle(['Sen', ...Array.from({ length: teamCount - 1 }, (_, i) => `Rakip ${i + 1}`)]);
  state.draft = { teams, rounds, pick: 0, drafted: [], rosters: Object.fromEntries(teams.map(team => [team, []])) };
  saveDraft(); $('#draftSetup').classList.add('hidden'); $('#draftRoom').classList.remove('hidden'); renderDraft();
}

function pickSequence() {
  if (!state.draft) return [];
  const sequence = [];
  for (let round = 0; round < state.draft.rounds; round++) sequence.push(...(round % 2 ? [...state.draft.teams].reverse() : state.draft.teams));
  return sequence;
}

function getRecommendation() {
  if (!state.draft) return null;
  const available = state.players.filter(player => !state.draft.drafted.includes(player.id));
  const roster = state.draft.rosters['Sen'];
  const rosterPositions = roster.flatMap(player => player.positions);
  const round = Math.floor(state.draft.pick / state.draft.teams.length) + 1;
  return available.map(player => {
    let fit = player.score + (player.positions.some(pos => !rosterPositions.includes(pos)) && round >= 3 ? .35 : 0) + (player.positions.length > 1 ? .15 : 0) + (player.risk_penalty ? 0 : .12);
    const hasRiskData = typeof player.missed_game_rate === 'number';
    const missed = hasRiskData ? player.missed_game_rate : null;
    const reason = hasRiskData && missed >= .2 ? `Üretimi yüksek; son iki sezonda ağırlıklı maç kaçırma oranı %${Math.round(missed * 100)}.` : player.risk_penalty ? 'Üretimi yüksek; güncel sakatlık durumunu izle.' : hasRiskData && player.positions.length > 1 ? 'Yüksek fantasy puanı, düşük sakatlık riski ve çoklu mevki esnekliği.' : hasRiskData ? 'Kalan havuzdaki en güçlü risk ayarlı fantasy puanı.' : 'Demo modunda sakatlık geçmişi yok; öneri yalnızca fantasy üretimine dayanıyor.';
    return { player, fit, reason };
  }).sort((a, b) => b.fit - a.fit)[0];
}

function renderDraft() {
  if (!state.draft || !state.players.length) return;
  const sequence = pickSequence(); const owner = sequence[state.draft.pick]; const finished = state.draft.pick >= sequence.length;
  const round = Math.floor(state.draft.pick / state.draft.teams.length) + 1; const pickInRound = state.draft.pick % state.draft.teams.length + 1;
  $('#pickLabel').textContent = finished ? 'Draft tamamlandı' : `${round}. Tur · ${pickInRound}. Seçim`;
  $('#currentTeam').textContent = finished ? '—' : owner; $('#currentTeam').style.color = owner === 'Sen' ? 'var(--purple)' : '';
  $('#draftCount').textContent = state.draft.drafted.length;
  $('#orderStrip').innerHTML = state.draft.teams.map((team, index) => `<span title="${team}" class="order-chip ${team === owner ? 'active' : ''} ${team === 'Sen' ? 'me' : ''}">${index + 1}</span>`).join('');
  const roster = state.draft.rosters['Sen']; $('#rosterCount').textContent = `${roster.length}/${state.draft.rounds}`;
  $('#myRoster').innerHTML = roster.length ? roster.map((player, index) => `<div class="roster-player"><span class="avatar">${initials(player.name)}</span><div><strong>${player.name}</strong><br><span>${player.positions.join('/')} · ${index + 1}. seçim</span></div></div>`).join('') : '<p style="color:#788075;font-size:11px">Henüz seçim yapmadın.</p>';
  const rec = getRecommendation();
  $('#recommendation').innerHTML = rec ? `<span class="mini-label">ÖNERİLEN SEÇİM</span><h3>${rec.player.name}</h3><p>${rec.reason}</p><div class="rec-stats"><span>${fmt(rec.player.stats.pts)} PTS</span><span>${fmt(rec.player.stats.reb)} REB</span><span>${fmt(rec.player.stats.ast)} AST</span></div>` : '<h3>Draft tamamlandı</h3>';
  const term = $('#draftSearch').value.toLocaleLowerCase('tr'); const position = $('#draftPosition').value;
  const available = state.players.filter(player => !state.draft.drafted.includes(player.id) && player.name.toLocaleLowerCase('tr').includes(term) && (position === 'ALL' || player.positions.includes(position)));
  $('#draftGrid').innerHTML = available.map(player => `<button class="draft-card ${rec?.player.id === player.id ? 'recommended' : ''}" data-player-id="${player.id}" ${finished ? 'disabled' : ''}><span class="avatar">${initials(player.name)}</span><span class="player-meta"><strong>${player.name}</strong><span>${player.team} · ${player.positions.join('/')}</span></span><span class="value">#${player.rank}</span></button>`).join('');
  $$('.draft-card').forEach(card => card.addEventListener('click', () => draftPlayer(card.dataset.playerId)));
}

function draftPlayer(playerId) {
  const sequence = pickSequence(); const owner = sequence[state.draft.pick]; const player = state.players.find(item => item.id === playerId);
  if (!owner || !player) return;
  state.draft.drafted.push(player.id); state.draft.rosters[owner].push(player); state.draft.pick += 1; saveDraft(); renderDraft(); toast(`${player.name} → ${owner}`);
}

function saveDraft() { localStorage.setItem('draftlab-draft', JSON.stringify(state.draft)); }
function restoreDraft() {
  try { state.draft = JSON.parse(localStorage.getItem('draftlab-draft')); } catch { state.draft = null; }
  if (state.draft) { $('#draftSetup').classList.add('hidden'); $('#draftRoom').classList.remove('hidden'); }
}

$$('.nav-link').forEach(button => button.addEventListener('click', () => { $$('.nav-link').forEach(item => item.classList.toggle('active', item === button)); $$('.view').forEach(view => view.classList.remove('active')); $(`#${button.dataset.view}View`).classList.add('active'); renderDraft(); }));
$('#positionFilters').addEventListener('click', event => { if (!event.target.dataset.position) return; state.position = event.target.dataset.position; $$('#positionFilters button').forEach(button => button.classList.toggle('active', button === event.target)); applyFilters(); });
$('#searchInput').addEventListener('input', applyFilters); $('#draftSearch').addEventListener('input', renderDraft); $('#draftPosition').addEventListener('change', renderDraft);
$('#modeSelect').addEventListener('change', event => { state.mode = event.target.value; loadPlayers(); }); $('#leagueSelect').addEventListener('change', loadPlayers); $('#refreshBtn').addEventListener('click', loadPlayers);
let teamCount = 10; $('#teamMinus').addEventListener('click', () => { teamCount = Math.max(4, teamCount - 1); $('#teamCount').textContent = teamCount; }); $('#teamPlus').addEventListener('click', () => { teamCount = Math.min(20, teamCount + 1); $('#teamCount').textContent = teamCount; });
$('#draftForm').addEventListener('submit', event => { event.preventDefault(); startDraft(teamCount, Number($('#roundCount').value)); });
$('#resetDraft').addEventListener('click', () => { if (!confirm('Mevcut draft seçimleri silinsin mi?')) return; localStorage.removeItem('draftlab-draft'); state.draft = null; $('#draftRoom').classList.add('hidden'); $('#draftSetup').classList.remove('hidden'); $('#draftCount').textContent = '0'; });

restoreDraft(); loadPlayers().then(loadStatusAndLeagues);
