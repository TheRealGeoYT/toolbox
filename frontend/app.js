let activeGuild = null;
let currentUser = null;

// Beim Start Nutzer & Verifizierungsstatus prüfen
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  loadGuilds();
});

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    const userInfoEl = document.getElementById('userInfo');
    const authBtn = document.getElementById('authBtn');

    if (data.authenticated) {
      currentUser = data.user;
      const verifiedBadge = data.isVerified ? ' <span class="verified-icon" title="Discord Account Verifiziert">☑️</span>' : '';
      userInfoEl.innerHTML = `<strong>${currentUser.username}</strong>${verifiedBadge}`;
      authBtn.innerText = 'Abmelden';
    } else {
      userInfoEl.innerHTML = `<span>Nicht angemeldet</span>`;
      authBtn.innerText = 'Login';
    }
  } catch (err) {
    console.error('Auth-Check fehlgeschlagen:', err);
  }
}

function handleAuth() {
  if (currentUser) {
    fetch('/api/auth/logout').then(() => window.location.reload());
  } else {
    window.location.href = '/api/auth/login';
  }
}

// Tab Wechsel
function switchTab(tabName) {
  ['servers', 'tickets', 'moderation'].forEach(tab => {
    document.getElementById(`tab-${tab}`).classList.add('hidden');
    document.getElementById(`btnNav${capitalize(tab)}`).classList.remove('active');
  });

  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  document.getElementById(`btnNav${capitalize(tabName)}`).classList.add('active');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Server Laden
async function loadGuilds() {
  const container = document.getElementById('serverList');
  try {
    const res = await fetch('/api/guilds');
    const guilds = await res.json();

    if (!Array.isArray(guilds)) {
      container.innerHTML = '<p>Bitte zuerst mit Discord anmelden!</p>';
      return;
    }

    container.innerHTML = '';
    guilds.forEach(guild => {
      const card = document.createElement('div');
      card.className = 'server-card';
      card.onclick = () => selectGuild(guild);

      const iconUrl = guild.icon || '';
      card.innerHTML = `
        <div class="server-avatar" style="margin: 0 auto 10px;">
          ${iconUrl ? `<img src="${iconUrl}">` : guild.name.charAt(0)}
        </div>
        <h4>${guild.name}</h4>
        <small style="color: ${guild.hasBot ? '#10b981' : '#f59e0b'}">
          ${guild.hasBot ? '● Bot vorhanden' : '○ Bot fehlt'}
        </small>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<p>Fehler beim Laden der Server.</p>';
  }
}

// Server Auswählen
function selectGuild(guild) {
  activeGuild = guild;

  // Sidebar Aktualisieren
  document.getElementById('sidebarServerName').innerText = guild.name;
  document.getElementById('sidebarServerStatus').innerText = guild.hasBot ? 'Aktiv' : 'Bot einladen';
  
  const iconEl = document.getElementById('sidebarServerIcon');
  if (guild.icon) {
    iconEl.innerHTML = `<img src="${guild.icon}">`;
  } else {
    iconEl.innerText = guild.name.charAt(0);
  }

  loadChannels(guild.id);
  switchTab('tickets');
}

// Kanäle Laden
async function loadChannels(guildId) {
  const select = document.getElementById('ticketChannelSelect');
  select.innerHTML = '<option>Lade Kanäle...</option>';

  try {
    const res = await fetch(`/api/guilds/${guildId}/channels`);
    const channels = await res.json();

    select.innerHTML = '';
    channels.forEach(ch => {
      select.innerHTML += `<option value="${ch.id}"># ${ch.name}</option>`;
    });
  } catch (err) {
    select.innerHTML = '<option>Konnte Kanäle nicht laden</option>';
  }
}

// Ticket Templates (Vorlagen)
function applyTemplate() {
  const template = document.getElementById('ticketTemplate').value;
  const title = document.getElementById('panelTitle');
  const desc = document.getElementById('panelDesc');
  const label = document.getElementById('buttonLabel');

  if (template === 'support') {
    title.value = '🛠️ Allgemeine Support-Anfrage';
    desc.value = 'Benötigst du Hilfe auf unserem Server? Klicke unten, um ein privates Ticket mit dem Team zu starten.';
    label.value = 'Support anfordern';
  } else if (template === 'apply') {
    title.value = '📝 Team-Bewerbungen';
    desc.value = 'Möchtest du dich als Moderator oder Entwickler bewerben? Erstelle ein Bewerbungsticket!';
    label.value = 'Jetzt bewerben';
  } else if (template === 'bug') {
    title.value = '🐛 Bug / Fehler melden';
    desc.value = 'Hast du einen Fehler gefunden? Beschreibe ihn im Ticket so genau wie möglich!';
    label.value = 'Fehler melden';
  }
}

// Panel Senden
async function sendTicketPanel() {
  if (!activeGuild) return alert('Bitte wähle zuerst einen Server aus!');

  const body = {
    channelId: document.getElementById('ticketChannelSelect').value,
    title: document.getElementById('panelTitle').value,
    description: document.getElementById('panelDesc').value,
    buttonLabel: document.getElementById('buttonLabel').value,
    buttonStyle: 'Primary'
  };

  const res = await fetch('/api/tickets/create-panel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  alert(data.message || data.error);
}

// Moderations-Aktion Ausführen
async function executeModAction() {
  if (!activeGuild) return alert('Bitte wähle zuerst einen Server aus!');

  const body = {
    guildId: activeGuild.id,
    userId: document.getElementById('modUserId').value,
    action: document.getElementById('modAction').value,
    reason: document.getElementById('modReason').value
  };

  if (!body.userId) return alert('Bitte eine Discord User ID eingeben!');

  const res = await fetch('/api/moderation/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  alert(data.message || data.error);
}