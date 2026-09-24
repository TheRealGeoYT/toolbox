document.addEventListener('DOMContentLoaded', async () => {
  const userProfile = document.getElementById('userProfile');
  const dashboardContent = document.getElementById('dashboardContent');
  const loginNotice = document.getElementById('loginNotice');
  const guildList = document.getElementById('guildList');
  const panelSection = document.getElementById('panelSection');
  const channelSelect = document.getElementById('channelSelect');
  const panelForm = document.getElementById('panelForm');

  let selectedGuildId = null;

  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (data.authenticated) {
      loginNotice.classList.add('hidden');
      dashboardContent.classList.remove('hidden');

      const avatarUrl = data.user.avatar 
        ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png` 
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

      userProfile.innerHTML = `
        <img src="${avatarUrl}" class="w-8 h-8 rounded-full">
        <span class="font-medium">${data.user.username}</span>
        <button id="logoutBtn" class="text-xs bg-red-600/30 text-red-300 hover:bg-red-600/50 px-3 py-1 rounded transition ml-2">
          Abmelden
        </button>
      `;

      document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/auth/logout');
        window.location.reload();
      });

      loadGuilds();
    }
  } catch (err) {
    console.error('Fehler beim Laden', err);
  }

  async function loadGuilds() {
    guildList.innerHTML = '<p class="text-slate-400">Lade Server...</p>';
    try {
      const res = await fetch('/api/guilds');
      const guilds = await res.json();

      guildList.innerHTML = '';
      guilds.forEach(guild => {
        const card = document.createElement('div');
        card.className = `p-4 rounded-lg border flex items-center justify-between transition ${
          guild.hasBot 
            ? 'bg-slate-700/50 border-slate-600 hover:border-indigo-500 cursor-pointer' 
            : 'bg-slate-800/40 border-slate-700 opacity-60'
        }`;

        const icon = guild.icon 
          ? `<img src="${guild.icon}" class="w-10 h-10 rounded-full">` 
          : `<div class="w-10 h-10 bg-slate-600 rounded-full flex items-center justify-center font-bold">${guild.name[0]}</div>`;

        card.innerHTML = `
          <div class="flex items-center gap-3">
            ${icon}
            <div>
              <h3 class="font-medium">${guild.name}</h3>
              <span class="text-xs ${guild.hasBot ? 'text-green-400' : 'text-amber-400'}">
                ${guild.hasBot ? '● Bot vorhanden' : '○ Bot fehlt'}
              </span>
            </div>
          </div>
          ${!guild.hasBot ? `<a href="https://discord.com/api/oauth2/authorize?client_id=1508027425655619684&permissions=8&scope=bot" target="_blank" class="text-xs bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 rounded">Einladen</a>` : ''}
        `;

        if (guild.hasBot) {
          card.addEventListener('click', () => selectGuild(guild.id, card));
        }

        guildList.appendChild(card);
      });
    } catch (err) {
      guildList.innerHTML = '<p class="text-red-400">Fehler beim Laden der Server.</p>';
    }
  }

  async function selectGuild(guildId, cardElement) {
    selectedGuildId = guildId;

    Array.from(guildList.children).forEach(c => c.classList.remove('ring-2', 'ring-indigo-500'));
    cardElement.classList.add('ring-2', 'ring-indigo-500');

    channelSelect.innerHTML = '<option value="">Lade Kanäle...</option>';
    panelSection.classList.remove('opacity-50', 'pointer-events-none');

    try {
      const res = await fetch(`/api/guilds/${guildId}/channels`);
      const channels = await res.json();

      channelSelect.innerHTML = '<option value="">-- Kanal wählen --</option>';
      channels.forEach(ch => {
        channelSelect.innerHTML += `<option value="${ch.id}"># ${ch.name}</option>`;
      });
    } catch (err) {
      channelSelect.innerHTML = '<option value="">Fehler beim Laden der Kanäle</option>';
    }
  }

  panelForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      channelId: channelSelect.value,
      title: document.getElementById('panelTitle').value,
      description: document.getElementById('panelDescription').value,
      buttonLabel: document.getElementById('buttonLabel').value,
      buttonStyle: document.getElementById('buttonStyle').value
    };

    if (!payload.channelId) {
      alert('Bitte wähle einen Ziel-Kanal aus.');
      return;
    }

    try {
      const res = await fetch('/api/tickets/create-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert('Ticket-Panel erfolgreich gepostet!');
      } else {
        alert(`Fehler: ${data.error}`);
      }
    } catch (err) {
      alert('Netzwerkfehler beim Senden.');
    }
  });
});
