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

// Wichtig für HTTPS & Sessions auf Render.com
app.set('trust proxy', 1);

// Middleware Setup
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'toolbox_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 Stunden
  }
}));

// Statische Dateien aus dem Frontend bereitstellen
app.use(express.static(path.join(__dirname, '../../frontend')));

// Discord Bot Client initialisieren
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --- AUTHENTIFIZIERUNG (DISCORD OAUTH2) ---

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

    res.redirect('/');
  } catch (err) {
    console.error('[OAuth2 Error]', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- SERVER & TICKET API ---

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

// --- DISCORD INTERAKTIONEN ---

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'create_ticket') {
    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      const closeBtn = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Ticket schließen')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      const row = new ActionRowBuilder().addComponents(closeBtn);

      await ticketChannel.send({
        content: `Hallo ${interaction.user}, willkommen in deinem Ticket! Beschreibe bitte dein Anliegen.`,
        components: [row]
      });

      await interaction.reply({ content: `Dein Ticket wurde erstellt: ${ticketChannel}`, flags: 64 });
    } catch (err) {
      console.error('[Ticket Interaction Error]', err);
      await interaction.reply({ content: 'Fehler beim Erstellen des Ticket-Kanals.', flags: 64 });
    }
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket') {
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