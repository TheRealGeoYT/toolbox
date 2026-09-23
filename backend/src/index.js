require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionFlagsBits, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} = require('discord.js');
const express = require('express');

// 1. Express Webserver Setup (für das spätere Dashboard)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/status', (req, res) => {
    res.json({ status: 'ToolBox Backend läuft online!', botReady: client.isReady() });
});

app.listen(PORT, () => {
    console.log(`[Express] Webserver läuft auf Port ${PORT}`);
});

// 2. Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Slash-Command Definition für das Ticket-System
const commands = [
    new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Sendet das Ticket-Panel in den aktuellen Kanal')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

// Bot Start & Command Registration
client.once('ready', async () => {
    console.log(`[Discord] ToolBox ist eingeloggt als ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('[Discord] Registriere Slash-Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('[Discord] Slash-Commands erfolgreich registriert!');
    } catch (error) {
        console.error('[Discord] Fehler beim Registrieren der Commands:', error);
    }
});

// Interaktions-Handling (Commands & Buttons)
client.on('interactionCreate', async (interaction) => {
    // 1. Befehl: /setup-tickets
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-tickets') {
            const button = new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('📩 Ticket erstellen')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            await interaction.reply({
                content: '### 🛠️ ToolBox Support-System\nKlicke auf den Button unten, um ein privates Support-Ticket zu öffnen!',
                components: [row]
            });
        }
    }

    // 2. Button-Klick: "Ticket erstellen" oder "Ticket schließen"
    if (interaction.isButton()) {
        // Ticket Kanal erstellen
        if (interaction.customId === 'create_ticket') {
            const channelName = `ticket-${interaction.user.username.toLowerCase()}`;
            
            // Prüfen, ob bereits ein Ticket-Kanal existiert
            const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
            if (existingChannel) {
                return interaction.reply({ content: `Du hast bereits ein offenes Ticket: ${existingChannel}`, flags: 64 });
            }

            // Neuen privaten Textkanal erstellen
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id, // @everyone blockieren
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id, // Ticket-Ersteller erlauben
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }
                ]
            });

            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Ticket schließen')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(closeButton);

            await ticketChannel.send({
                content: `Hallo ${interaction.user}, willkommen in deinem Ticket! Beschreibe bitte dein Anliegen.`,
                components: [row]
            });

            await interaction.reply({ content: `Dein Ticket wurde erstellt: ${ticketChannel}`, flags: 64 });
        }

        // Ticket Kanal löschen
        if (interaction.customId === 'close_ticket') {
            await interaction.reply('Das Ticket wird in 5 Sekunden geschlossen...');
            setTimeout(() => {
                interaction.channel.delete().catch(() => {});
            }, 5000);
        }
    }
});
// API Route: Ticket Panel über Dashboard erstellen
app.post('/api/tickets/create-panel', async (req, res) => {
  const { title, description, channelId, fields } = req.body;

  try {
    // 1. Kanal auf Discord suchen
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Kanal nicht gefunden!' });
    }

    // 2. Embed & Button aufbauen
    const embed = new EmbedBuilder()
      .setTitle(title || 'Support-System')
      .setDescription(description || 'Klicke unten auf den Button, um ein Ticket zu öffnen.')
      .setColor('#5865F2');

    const button = new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel('Ticket erstellen')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📩');

    const row = new ActionRowBuilder().addComponents(button);

    // 3. Nachricht im Discord-Kanal posten
    await channel.send({ embeds: [embed], components: [row] });

    return res.status(200).json({ success: true, message: 'Panel erfolgreich gesendet!' });
  } catch (error) {
    console.error('[API Error] Fehler beim Erstellen des Panels:', error);
    return res.status(500).json({ error: 'Fehler beim Senden des Panels auf Discord.' });
  }
});
client.login(process.env.DISCORD_TOKEN);

// Frontend-Dateien bereitstellen
app.use(express.static(path.join(__dirname, '../../frontend')));
const path = require('path');

// ... dein bestehender Express-Code ...

// Statische Dateien aus dem frontend-Ordner bereitstellen
app.use(express.static(path.join(__dirname, '../../frontend')));

// Fallback: Alle nicht-API Anfragen auf die index.html leiten
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});
