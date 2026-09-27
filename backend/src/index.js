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
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
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
    maxAge: 7 * 24 * 60 * 60 * 1000
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

// Temporärer Speicher für Panel-Fragen
const panelQuestionsStore = new Map();

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
    req.session.isVerified = userData.verified || true;

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

// --- SERVER & KANÄLE API ---

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
    res.status(500).json({ error: 'Konnte Kanäle nicht laden' });
  }
});

// --- TICKET PANEL CREATION API (MIT FRAGEN & MULTI-PANEL) ---

app.post('/api/tickets/create-panel', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { channelId, title, description, buttonLabel, buttonStyle, questions } = req.body;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).json({ error: 'Kanal nicht gefunden' });

    const panelId = `panel_${Date.now()}`;
    if (questions && Array.isArray(questions)) {
      panelQuestionsStore.set(panelId, questions.filter(q => q.trim().length > 0));
    }

    const embed = new EmbedBuilder()
      .setTitle(title || 'Support-Tickets')
      .setDescription(description || 'Klicke unten, um ein privates Support-Ticket zu öffnen.')
      .setColor('#5865F2');

    const button = new ButtonBuilder()
      .setCustomId(`create_ticket_${panelId}`)
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

// --- DISCORD SLASH COMMANDS REGISTRIERUNG ---

const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Fügt einen Benutzer zum Ticket-Thread hinzu')
    .addUserOption(opt => opt.setName('user').setDescription('Der hinzuzufügende Benutzer').setRequired(true)),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Entfernt einen Benutzer aus dem Ticket-Thread')
    .addUserOption(opt => opt.setName('user').setDescription('Der zu entfernende Benutzer').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Gibt ein beanspruchtes Ticket wieder frei'),
  new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Überträgt das Ticket an ein anderes Teammitglied')
    .addUserOption(opt => opt.setName('user').setDescription('Das neue Teammitglied').setRequired(true))
].map(cmd => cmd.toJSON());

// --- DISCORD BOT EVENT HANDLING ---

client.on('interactionCreate', async (interaction) => {

  // 1. MODAL ANZEIGEN WENN USER AUF TICKET-BUTTON KLICKT
  if (interaction.isButton() && interaction.customId.startsWith('create_ticket_')) {
    const panelId = interaction.customId.replace('create_ticket_', '');
    const questions = panelQuestionsStore.get(panelId) || [];

    if (questions.length > 0) {
      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${panelId}`)
        .setTitle('Ticket Fragen beantworten');

      questions.slice(0, 5).forEach((qText, index) => {
        const input = new TextInputBuilder()
          .setCustomId(`q_${index}`)
          .setLabel(qText.substring(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      });

      return await interaction.showModal(modal);
    } else {
      // Wenn keine Fragen definiert wurden, direkt Thread erstellen
      return createTicketThread(interaction, []);
    }
  }

  // 2. MODAL SUBMIT (FRAGEN ABGESENDET)
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
    const panelId = interaction.customId.replace('ticket_modal_', '');
    const questions = panelQuestionsStore.get(panelId) || [];
    
    const answers = questions.map((qText, index) => {
      const ans = interaction.fields.getTextInputValue(`q_${index}`);
      return { question: qText, answer: ans };
    });

    return createTicketThread(interaction, answers);
  }

  // 3. BUTTON INTERAKTIONEN (CLAIM, CLOSE REQUEST, CLOSE, CANCEL)
  if (interaction.isButton()) {

    // Claim
    if (interaction.customId === 'claim_ticket') {
      const embed = new EmbedBuilder()
        .setDescription(`🙋‍♂️ Dieses Ticket wurde von **${interaction.user}** übernommen!`)
        .setColor('#57F287');
      return await interaction.reply({ embeds: [embed] });
    }

    // Unclaim Button (Optional)
    if (interaction.customId === 'unclaim_ticket') {
      const embed = new EmbedBuilder()
        .setDescription(`🔄 Das Ticket wurde von **${interaction.user}** wieder freigegeben!`)
        .setColor('#FEE75C');
      return await interaction.reply({ embeds: [embed] });
    }

    // Close Request stellen
    if (interaction.customId === 'request_close') {
      const thread = interaction.channel;
      // Versuche den Ersteller des Threads/Tickets zu finden
      const creatorId = thread.ownerId || interaction.user.id;

      const acceptBtn = new ButtonBuilder()
        .setCustomId('accept_close')
        .setLabel('Akzeptieren & Schließen')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const rejectBtn = new ButtonBuilder()
        .setCustomId('reject_close')
        .setLabel('Offen lassen & Ablehnen')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

      const row = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn);

      return await interaction.reply({
        content: `⚠️ <@${creatorId}>, der Benutzer ${interaction.user} schlägt vor, dieses Ticket zu schließen!`,
        components: [row]
      });
    }

    // Close Request Akzeptieren
    if (interaction.customId === 'accept_close') {
      await interaction.reply('Das Ticket wird in 5 Sekunden geschlossen und archiviert...');
      setTimeout(async () => {
        if (interaction.channel.isThread()) {
          await interaction.channel.setArchived(true).catch(() => {});
        } else {
          await interaction.channel.delete().catch(() => {});
        }
      }, 5000);
      return;
    }

    // Close Request Ablehnen
    if (interaction.customId === 'reject_close') {
      await interaction.update({
        content: `❌ Der Schließantrag wurde von ${interaction.user} abgelehnt. Das Ticket bleibt offen!`,
        components: []
      });
      return;
    }

    // Direkt Schließen
    if (interaction.customId === 'close_ticket') {
      await interaction.reply('Das Ticket wird in 5 Sekunden geschlossen...');
      setTimeout(async () => {
        if (interaction.channel.isThread()) {
          await interaction.channel.setArchived(true).catch(() => {});
        } else {
          await interaction.channel.delete().catch(() => {});
        }
      }, 5000);
      return;
    }
  }

  // 4. SLASH COMMANDS IMPLEMENTIERUNG
  if (interaction.isChatInputCommand()) {
    const { commandName, options, channel } = interaction;

    if (!channel.isThread()) {
      return await interaction.reply({ content: 'Dieser Befehl kann nur in einem Ticket-Thread verwendet werden!', flags: 64 });
    }

    if (commandName === 'add') {
      const user = options.getUser('user');
      await channel.members.add(user.id);
      return await interaction.reply({ content: `✅ ${user} wurde zum Ticket hinzugefügt.` });
    }

    if (commandName === 'remove') {
      const user = options.getUser('user');
      await channel.members.remove(user.id);
      return await interaction.reply({ content: `🚪 ${user} wurde aus dem Ticket entfernt.` });
    }

    if (commandName === 'unclaim') {
      const embed = new EmbedBuilder()
        .setDescription(`🔄 Das Ticket wurde von ${interaction.user} freigegeben.`)
        .setColor('#FEE75C');
      return await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'transfer') {
      const newUser = options.getUser('user');
      await channel.members.add(newUser.id);
      const embed = new EmbedBuilder()
        .setDescription(`➡️ Ticket wurde an ${newUser} übertragen!`)
        .setColor('#5865F2');
      return await interaction.reply({ content: `${newUser}`, embeds: [embed] });
    }
  }
});

// Hilfsfunktion zum Erstellen des Ticket-Threads
async function createTicketThread(interaction, qAnswers = []) {
  try {
    const channel = interaction.channel;
    const threadName = `ticket-${interaction.user.username}`;

    // Erstelle einen Thread im aktuellen Textkanal
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread, // Versuche privaten Thread, sonst öffentlicher Fallback
      reason: `Ticket für ${interaction.user.username}`
    }).catch(async () => {
      return await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: ChannelType.PublicThread,
        reason: `Ticket für ${interaction.user.username}`
      });
    });

    await thread.members.add(interaction.user.id);

    const claimBtn = new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim')
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
      .setDescription(`Willkommen <@${interaction.user.id}>! Ein Teammitglied wird sich in Kürze um dein Anliegen kümmern.`)
      .setColor('#5865F2');

    if (qAnswers.length > 0) {
      qAnswers.forEach(qa => {
        embed.addFields({ name: `❓ ${qa.question}`, value: qa.answer || 'Keine Angabe' });
      });
    }

    await thread.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
    await interaction.reply({ content: `Dein Ticket-Thread wurde erstellt: ${thread}`, flags: 64 });
  } catch (err) {
    console.error('[Create Thread Error]', err);
    await interaction.reply({ content: 'Fehler beim Erstellen des Ticket-Threads.', flags: 64 });
  }
}

client.once('ready', async () => {
  console.log(`[Discord] Bot ist online als ${client.user.tag}`);

  // Slash Commands auf Discord registrieren
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('[Discord] Slash Commands (/add, /remove, /unclaim, /transfer) erfolgreich registriert!');
  } catch (err) {
    console.error('[Slash Commands Error]', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`[Express] Webserver läuft auf Port ${PORT}`);
});