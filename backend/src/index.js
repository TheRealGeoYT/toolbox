require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder, 
  PermissionFlagsBits 
} = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'toolbox_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 Tage merken
  }
}));

app.use(express.static(path.join(__dirname, '../../frontend')));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- AUTHENTIFIZIERUNG & VERIFIZIERUNG ---

app.get('/api/auth/login', (req, res) => {
  const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
  const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
  res.redirect(authorizeUrl);
});

app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) return res.redirect('/?error=token_failed');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();

    req.session.user = userData;
    req.session.accessToken = tokenData.access_token;
    req.session.isVerified = userData.verified || true; // Discord Account Status merken

    res.redirect('/');
  } catch (err) {
    console.error('[OAuth2 Error]', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  res.json({ 
    authenticated: true, 
    user: req.session.user,
    isVerified: req.session.isVerified || false
  });
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- GUILDS & CHANNELS API ---

app.get('/api/guilds', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'Nicht angemeldet' });

  try {
    const userGuildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });
    const userGuilds = await userGuildsRes.json();

    if (!Array.isArray(userGuilds)) {
      return res.status(500).json({ error: 'Fehler beim Abrufen der Discord-Server' });
    }

    const adminGuilds = userGuilds.filter(g => {
      const perms = BigInt(g.permissions);
      return g.owner || (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
    });

    const botGuilds = client.guilds.cache;
    const result = adminGuilds.map(guild => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
      hasBot: botGuilds.has(guild.id)
    }));

    res.json(result);
  } catch (err) {
    console.error('[Guilds Error]', err);
    res.status(500).json({ error: 'Fehler beim Laden der Server' });
  }
});

app.get('/api/guilds/:guildId/channels', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht angemeldet' });

  try {
    const guild = await client.guilds.fetch(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });

    const channels = guild.channels.cache
      .filter(c => c.isTextBased() && !c.isThread())
      .map(c => ({ id: c.id, name: c.name }));

    res.json(channels);
  } catch (err) {
    console.error('[Channels Error]', err);
    res.status(500).json({ error: 'Konnte Kanäle nicht laden' });
  }
});

// --- TICKET PANEL API ---

app.post('/api/tickets/create-panel', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { channelId, title, description, buttonLabel, buttonStyle } = req.body;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).json({ error: 'Kanal nicht gefunden' });

    const embed = new EmbedBuilder()
      .setTitle(title || 'Support-Tickets')
      .setDescription(description || 'Klicke unten, um ein privates Support-Ticket zu öffnen.')
      .setColor('#5865F2');

    const button = new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel(buttonLabel || 'Ticket erstellen')
      .setStyle(ButtonStyle[buttonStyle] || ButtonStyle.Primary)
      .setEmoji('📩');

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({ embeds: [embed], components: [row] });
    res.json({ success: true, message: 'Panel erfolgreich gesendet!' });
  } catch (err) {
    console.error('[Create Panel Error]', err);
    res.status(500).json({ error: 'Fehler beim Senden des Panels auf Discord.' });
  }
});

// --- MODERATION API (BAN, KICK, WARN, TIMEOUT) ---

app.post('/api/moderation/action', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { guildId, userId, action, reason } = req.body;

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });

    const member = await guild.members.fetch(userId).catch(() => null);

    if (action === 'ban') {
      await guild.members.ban(userId, { reason: reason || 'Über Dashboard gebannt' });
      return res.json({ success: true, message: `Benutzer ${userId} wurde gebannt.` });
    }

    if (!member) return res.status(404).json({ error: 'Benutzer ist nicht auf diesem Server.' });

    if (action === 'kick') {
      await member.kick(reason || 'Über Dashboard gekickt');
      return res.json({ success: true, message: `Benutzer ${member.user.tag} wurde gekickt.` });
    }

    if (action === 'timeout') {
      await member.timeout(60 * 60 * 1000, reason || '1 Stunde Timeout über Dashboard');
      return res.json({ success: true, message: `Benutzer ${member.user.tag} für 1 Std ins Timeout versetzt.` });
    }

    if (action === 'warn') {
      // Sendet eine Verwarnung per Direktnachricht
      await member.send(`⚠️ **Verwarnung von ${guild.name}:** ${reason || 'Kein Grund angegeben.'}`).catch(() => {});
      return res.json({ success: true, message: `Verwarnung an ${member.user.tag} gesendet.` });
    }

    res.status(400).json({ error: 'Ungültige Aktion' });
  } catch (err) {
    console.error('[Moderation Action Error]', err);
    res.status(500).json({ error: 'Aktion konnte nicht ausgeführt werden. Prüfe Bot-Rechte!' });
  }
});

// --- DISCORD INTERAKTIONEN (CLAIM, CLOSE, CLOSE REQUEST) ---

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // 1. Ticket Erstellen
  if (interaction.customId === 'create_ticket') {
    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      const claimBtn = new ButtonBuilder()
        .setCustomId('claim_ticket')
        .setLabel('Claim (Beanspruchen)')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🙋‍♂️');

      const closeReqBtn = new ButtonBuilder()
        .setCustomId('request_close')
        .setLabel('Close Request')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚠️');

      const closeBtn = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Schließen')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      const row = new ActionRowBuilder().addComponents(claimBtn, closeReqBtn, closeBtn);

      const embed = new EmbedBuilder()
        .setTitle(`Ticket von ${interaction.user.username}`)
        .setDescription('Willkommen! Ein Teammitglied wird sich in Kürze um dein Anliegen kümmern.')
        .setColor('#5865F2');

      await ticketChannel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: `Dein Ticket wurde erstellt: ${ticketChannel}`, flags: 64 });
    } catch (err) {
      console.error('[Ticket Create Error]', err);
      await interaction.reply({ content: 'Fehler beim Erstellen des Tickets.', flags: 64 });
    }
  }

  // 2. Ticket Beanspruchen (Claim)
  if (interaction.customId === 'claim_ticket') {
    const embed = new EmbedBuilder()
      .setDescription(`🙋‍♂️ Dieses Ticket wurde von **${interaction.user.tag}** übernommen!`)
      .setColor('#57F287');
    
    await interaction.reply({ embeds: [embed] });
  }

  // 3. Schließen anfragen (Close Request)
  if (interaction.customId === 'request_close') {
    const confirmBtn = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Jetzt Schließen')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(confirmBtn);

    const embed = new EmbedBuilder()
      .setTitle('Löschantrag gestellt')
      .setDescription(`⚠️ **${interaction.user.tag}** schlägt vor, dieses Ticket zu schließen. Bitte bestätigen!`)
      .setColor('#FEE75C');

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  // 4. Ticket Schließen
  if (interaction.customId === 'close_ticket') {
    await interaction.reply('Das Ticket wird in 5 Sekunden gelöscht...');
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
});

client.once('ready', () => {
  console.log(`[Discord] Bot ist online als ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`[Express] Webserver läuft auf Port ${PORT}`);
});