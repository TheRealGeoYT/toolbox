document.addEventListener('DOMContentLoaded', () => {
  const fieldsContainer = document.getElementById('formFieldsContainer');
  const addFieldBtn = document.getElementById('addFieldBtn');
  const panelForm = document.getElementById('panelForm');

  // Ein neues Formularfeld zur Vorschau hinzufügen
  function addField(label = '', placeholder = '', required = true) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'flex items-center gap-2 bg-slate-750 p-2 rounded border border-slate-700';
    fieldDiv.innerHTML = `
      <input type="text" placeholder="Feld-Name (z.B. Ingame Name)" value="${label}" class="field-label flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm">
      <input type="text" placeholder="Platzhalter..." value="${placeholder}" class="field-placeholder flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm">
      <label class="text-xs flex items-center gap-1">
        <input type="checkbox" class="field-required" ${required ? 'checked' : ''}> Pflicht
      </label>
      <button type="button" class="remove-btn text-red-400 hover:text-red-300 px-2">✕</button>
    `;

    fieldDiv.querySelector('.remove-btn').addEventListener('click', () => fieldDiv.remove());
    fieldsContainer.appendChild(fieldDiv);
  }

  // Standardfeld beim Laden anlegen
  addField('Beschreibung des Problems', 'Bitte beschreibe dein Anliegen genauer...', true);

  addFieldBtn.addEventListener('click', () => addField());

  // Formular an Backend absenden
  panelForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fields = Array.from(fieldsContainer.children).map(div => ({
      label: div.querySelector('.field-label').value,
      placeholder: div.querySelector('.field-placeholder').value,
      required: div.querySelector('.field-required').checked
    }));

    const payload = {
      title: document.getElementById('panelTitle').value,
      description: document.getElementById('panelDescription').value,
      channelId: document.getElementById('channelId').value,
      fields: fields
    };

    try {
      const response = await fetch('/api/tickets/create-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        alert('Ticket-Panel erfolgreich auf Discord gesendet!');
      } else {
        alert('Fehler beim Senden des Panels.');
      }
    } catch (err) {
      console.error(err);
      alert('Netzwerkfehler: Backend nicht erreichbar.');
    }
  });
});
