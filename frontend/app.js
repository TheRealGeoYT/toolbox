let activeGuild = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  loadGuilds();
  addQuestionInput('In welcher Angelegenheit benötigst du Hilfe?');
});

function toggleServerDropdown() {
  const menu = document.getElementById('serverDropdownMenu');
  if (menu) menu.classList.toggle('show');
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('.server-dropdown-container')) {
    const menu = document.getElementById('serverDropdownMenu');
    if (menu) menu.classList.remove('show');
  }
});

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    const userInfoEl = document.getElementById('userInfo');
    const authBtn = document.getElementById('authBtn');

    if (data.authenticated) {
      currentUser = data.user;
      const avatarUrl = currentUser.avatar 
        ? `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png` 
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

      const verifiedBadge = data.isVerified ? ' <span class="verified-icon">☑️</span>' : '';
      userInfoEl.innerHTML = `<img src="${avatarUrl}" class="user-avatar"> <strong>${currentUser.username}</strong>${verifiedBadge}`;
      authBtn.innerText = 'Abmelden';
    } else {
      userInfoEl.innerHTML = `<span>Nicht angemeldet</span>`;
      authBtn.innerText = 'Login';
    }
  } catch (err) {
    console.error(err);
  }
}

function handleAuth() {
  if (currentUser) {
    fetch('/api/auth/logout').then(() => window.location.reload());
  } else {
    window.location.href = '/api/auth/login';
  }
}

function switchTab(tabName) {
  ['servers', 'tickets'].forEach(tab => {
    const t = document.getElementById(`tab-${tab}`);
    const b = document.getElementById(`btnNav${capitalize(tab)}`);
    if (t) t.classList.add('hidden');
    if (b) b.classList.remove('active');
  });

  const targetTab = document.getElementById(`tab-${tabName}`);
  const targetBtn = document.getElementById(`btnNav${capitalize(tabName)}`);
  if (targetTab) targetTab.classList.remove('hidden');
  if (targetBtn) targetBtn.classList.add('active');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function loadGuilds() {
  const container = document.getElementById('serverList');
  const dropdownMenu = document.getElementById('serverDropdownMenu');

  try {
    const res = await fetch('/api/guilds');
    const guilds = await res.json();

    if (!Array.isArray(guilds)) {
      container.innerHTML = '<p>Bitte zuerst oben rechts mit Discord anmelden!</p>';
      return;
    }

    container.innerHTML = '';
    dropdownMenu.innerHTML = '';

    guilds.forEach((guild, index) => {
      const iconUrl = guild.icon || '';
      
      const card = document.createElement('div');
      card.className = 'server-card';
      card.onclick = () => selectGuild(guild);
      card.innerHTML = `
        <div class="server-avatar" style="margin: 0 auto 10px;">${iconUrl ? `<img src="${iconUrl}">` : guild.name.charAt(0)}</div>
        <h4>${guild.name}</h4>
      `;
      container.appendChild(card);

      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.onclick = () => { selectGuild(guild); toggleServerDropdown(); };
      item.innerHTML = `
        <div class="server-avatar">${iconUrl ? `<img src="${iconUrl}">` : guild.name.charAt(0)}</div>
        <div><strong>${guild.name}</strong></div>
      `;
      dropdownMenu.appendChild(item);

      if (index === 0 && !activeGuild) selectGuild(guild, false);
    });
  } catch (err) {
    container.innerHTML = '<p>Fehler beim Laden.</p>';
  }
}

function selectGuild(guild, autoSwitch = true) {
  activeGuild = guild;
  document.getElementById('sidebarServerName').innerText = guild.name;
  document.getElementById('sidebarServerStatus').innerText = 'Aktiv';
  
  const iconEl = document.getElementById('sidebarServerIcon');
  if (guild.icon) iconEl.innerHTML = `<img src="${guild.icon}">`;
  else iconEl.innerText = guild.name.charAt(0);

  loadChannels(guild.id);
  if (autoSwitch) switchTab('tickets');
}

async function loadChannels(guildId) {
  const select = document.getElementById('ticketChannelSelect');
  select.innerHTML = '<option>Lade Kanäle...</option>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/channels`);
    const channels = await res.json();
    select.innerHTML = '';
    channels.forEach(ch => select.innerHTML += `<option value="${ch.id}"># ${ch.name}</option>`);
  } catch (err) {
    select.innerHTML = '<option>Fehler beim Laden</option>';
  }
}

// Dynamische Fragen hinzufügen
function addQuestionInput(defaultText = '') {
  const container = document.getElementById('questionsContainer');
  const count = container.children.length;
  if (count >= 5) return alert('Maximal 5 Fragen erlaubt!');

  const row = document.createElement('div');
  row.className = 'question-row';
  row.innerHTML = `
    <input type="text" class="question-input" placeholder="z. B. Wie lautet dein Ingame Name?" value="${defaultText}">
    <button class="btn btn-danger" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(row);
}

// Templates anwenden
function applyTemplate() {
  const template = document.getElementById('ticketTemplate').value;
  const container = document.getElementById('questionsContainer');
  container.innerHTML = '';

  if (template === 'support') {
    document.getElementById('panelTitle').value = '🛠️ Support Ticket';
    addQuestionInput('Beschreibe dein Anliegen:');
  } else if (template === 'apply') {
    document.getElementById('panelTitle').value = '📝 Team Bewerbung';
    addQuestionInput('Wie alt bist du?');
    addQuestionInput('Warum möchtest du ins Team?');
  } else if (template === 'bug') {
    document.getElementById('panelTitle').value = '🐛 Bug Report';
    addQuestionInput('Welcher Fehler ist aufgetreten?');
  }
}

// Panel Senden
async function sendTicketPanel() {
  if (!activeGuild) return alert('Bitte wähle zuerst einen Server aus!');

  const questionInputs = document.querySelectorAll('.question-input');
  const questions = Array.from(questionInputs).map(i => i.value).filter(v => v.trim() !== '');

  const body = {
    channelId: document.getElementById('ticketChannelSelect').value,
    title: document.getElementById('panelTitle').value,
    description: document.getElementById('panelDesc').value,
    buttonLabel: document.getElementById('buttonLabel').value,
    buttonStyle: 'Primary',
    questions: questions
  };

  const res = await fetch('/api/tickets/create-panel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  alert(data.message || data.error);
}