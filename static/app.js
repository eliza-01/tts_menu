// static/app.js
const state = {
  groups: [],
  selectedGroup: null,
  playbackToken: 0,
  currentAudio: null,
  playbackRate: 1.0,
};

const el = {
  groupForm: document.querySelector('#groupForm'),
  groupName: document.querySelector('#groupName'),
  groupRepeats: document.querySelector('#groupRepeats'),
  groupsList: document.querySelector('#groupsList'),
  emptyState: document.querySelector('#emptyState'),
  groupWorkspace: document.querySelector('#groupWorkspace'),
  selectedGroupName: document.querySelector('#selectedGroupName'),
  selectedGroupRepeats: document.querySelector('#selectedGroupRepeats'),
  saveGroupBtn: document.querySelector('#saveGroupBtn'),
  deleteGroupBtn: document.querySelector('#deleteGroupBtn'),
  bulkCardRepeats: document.querySelector('#bulkCardRepeats'),
  applyBulkRepeatsBtn: document.querySelector('#applyBulkRepeatsBtn'),
  playGroupBtn: document.querySelector('#playGroupBtn'),
  stopPlaybackBtn: document.querySelector('#stopPlaybackBtn'),
  cardForm: document.querySelector('#cardForm'),
  cardText: document.querySelector('#cardText'),
  cardRepeats: document.querySelector('#cardRepeats'),
  cardImage: document.querySelector('#cardImage'),
  pasteImageBtn: document.querySelector('#pasteImageBtn'),
  playbackRateInput: document.querySelector('#playbackRateInput'),
  decreaseRateBtn: document.querySelector('#decreaseRateBtn'),
  increaseRateBtn: document.querySelector('#increaseRateBtn'),
  cardsList: document.querySelector('#cardsList'),
  cardsCounter: document.querySelector('#cardsCounter'),
  toast: document.querySelector('#toast'),
};

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.style.background = isError ? '#dc2626' : '#111827';
  el.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => el.toast.classList.add('hidden'), 3500);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error || `Ошибка запроса: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function positiveInt(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.max(1, Math.min(number, 100));
}

function clampPlaybackRate(value, fallback = state.playbackRate || 1) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number)) return fallback;
  return Math.max(0.5, Math.min(number, 2));
}

function formatPlaybackRate(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function applyPlaybackRate() {
  document.querySelectorAll('audio').forEach(audio => {
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;
  });

  if (state.currentAudio) {
    state.currentAudio.defaultPlaybackRate = state.playbackRate;
    state.currentAudio.playbackRate = state.playbackRate;
  }
}

function setPlaybackRate(value, notify = true) {
  state.playbackRate = clampPlaybackRate(value);

  if (el.playbackRateInput) {
    el.playbackRateInput.value = formatPlaybackRate(state.playbackRate);
  }

  applyPlaybackRate();

  if (notify) {
    showToast(`Скорость MP3: x${formatPlaybackRate(state.playbackRate)}`);
  }
}

function clipboardImageFilename(mimeType) {
  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  const extension = extensions[mimeType] || 'png';
  return `clipboard_${Date.now()}.${extension}`;
}

function normalizeClipboardImage(fileOrBlob) {
  if (!fileOrBlob) return null;

  if (fileOrBlob instanceof File && fileOrBlob.name) {
    return fileOrBlob;
  }

  const type = fileOrBlob.type || 'image/png';
  return new File([fileOrBlob], clipboardImageFilename(type), { type });
}

function setImageInputFile(input, file) {
  if (!input || !file) return false;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function imageFromPasteEvent(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
  return imageItem ? normalizeClipboardImage(imageItem.getAsFile()) : null;
}

async function imageFromClipboardApi() {
  if (!navigator.clipboard?.read) {
    throw new Error('Кнопка вставки недоступна в этом браузере. Используйте Ctrl+V.');
  }

  const clipboardItems = await navigator.clipboard.read();

  for (const item of clipboardItems) {
    const imageType = item.types.find(type => type.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType);
      return normalizeClipboardImage(blob);
    }
  }

  throw new Error('В буфере обмена нет изображения.');
}

function imagePasteTargetFromEvent(event) {
  const cardNode = event.target?.closest?.('.card');
  if (cardNode?.classList.contains('card-editing')) {
    return cardNode.querySelector('.replace-image');
  }

  const editingImageInput = document.querySelector('.card.card-editing .replace-image');
  return editingImageInput || el.cardImage;
}

function pasteMessageForInput(input) {
  return input?.classList.contains('replace-image')
    ? 'Изображение из буфера выбрано для замены в карточке.'
    : 'Изображение из буфера добавлено к новой карточке.';
}

async function pasteImageIntoInput(input) {
  try {
    if (!state.selectedGroup) {
      showToast('Сначала выберите группу.', true);
      return;
    }

    const file = await imageFromClipboardApi();
    setImageInputFile(input, file);
    showToast(pasteMessageForInput(input));
  } catch (error) {
    showToast(error.message, true);
  }
}


async function loadGroups() {
  state.groups = await requestJson('/api/groups');
  renderGroups();

  if (state.selectedGroup) {
    const stillExists = state.groups.some(group => group.id === state.selectedGroup.id);
    if (!stillExists) {
      state.selectedGroup = null;
      renderWorkspace();
    }
  }
}

async function selectGroup(groupId) {
  state.selectedGroup = await requestJson(`/api/groups/${groupId}`);
  renderGroups();
  renderWorkspace();
}

function renderGroups() {
  el.groupsList.innerHTML = '';

  if (state.groups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Групп пока нет.';
    el.groupsList.append(empty);
    return;
  }

  for (const group of state.groups) {
    const button = document.createElement('button');
    button.className = `group-item ${state.selectedGroup?.id === group.id ? 'active' : ''}`;
    button.innerHTML = `
      <strong></strong>
      <span></span>
    `;
    button.querySelector('strong').textContent = group.name;
    button.querySelector('span').textContent = `Карточек: ${group.cards_count}; повторов группы: ${group.group_repeats}`;
    button.addEventListener('click', () => selectGroup(group.id));
    el.groupsList.append(button);
  }
}

function renderWorkspace() {
  const group = state.selectedGroup;

  if (!group) {
    el.emptyState.classList.remove('hidden');
    el.groupWorkspace.classList.add('hidden');
    return;
  }

  el.emptyState.classList.add('hidden');
  el.groupWorkspace.classList.remove('hidden');
  el.selectedGroupName.value = group.name;
  el.selectedGroupRepeats.value = group.group_repeats;
  el.cardsCounter.textContent = `Всего: ${group.cards.length}`;

  renderCards(group.cards);
}

function cardCacheBuster(card) {
  return card.updated_at ? `?v=${encodeURIComponent(card.updated_at)}` : '';
}

function renderCards(cards) {
  el.cardsList.innerHTML = '';

  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'В этой группе пока нет карточек.';
    el.cardsList.append(empty);
    return;
  }

  for (const card of cards) {
    const node = document.createElement('article');
    node.className = 'card';
    node.dataset.cardId = card.id;

    const imageHtml = card.image_path
      ? `<img src="${card.image_path}" alt="Изображение карточки">`
      : '<span class="muted">Нет изображения</span>';

    node.innerHTML = `
      <div class="card-image-wrap">${imageHtml}</div>
      <div class="card-body">
        <p class="card-text-preview"></p>

        <label class="card-edit-field hidden">
          Текст
          <textarea class="card-text" rows="4"></textarea>
        </label>

        <div class="card-controls">
          <span class="card-repeats-preview muted"></span>
          <label class="card-repeats-field hidden">
            Повторы
            <input class="card-repeats" type="number" min="1" max="100">
          </label>
          <audio controls preload="none"></audio>
          <button class="play-card-btn primary" type="button">Играть</button>
          <button class="edit-card-btn" type="button">Редактировать</button>
          <button class="save-card-btn hidden" type="button">Сохранить</button>
          <button class="cancel-card-btn ghost hidden" type="button">Отмена</button>
          <button class="delete-card-btn danger" type="button">Удалить</button>
        </div>

        <div class="card-image-row hidden">
          <label>
            Заменить изображение
            <input class="replace-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp">
          </label>
          <button class="paste-replace-image-btn" type="button">Вставить из буфера</button>
          <button class="remove-image-btn" type="button">Убрать изображение</button>
        </div>
      </div>
    `;

    node.querySelector('.card-text-preview').textContent = card.text;
    node.querySelector('.card-repeats-preview').textContent = `Повторы: ${card.card_repeats}`;
    node.querySelector('.card-text').value = card.text;
    node.querySelector('.card-repeats').value = card.card_repeats;

    const audio = node.querySelector('audio');
    audio.src = `${card.audio_path}${cardCacheBuster(card)}`;
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;

    const replaceImageInput = node.querySelector('.replace-image');
    const removeImageButton = node.querySelector('.remove-image-btn');
    removeImageButton.disabled = !card.image_path;
    if (!card.image_path) {
      removeImageButton.textContent = 'Изображения нет';
    }

    node.querySelector('.play-card-btn').addEventListener('click', () => {
      const repeats = positiveInt(node.querySelector('.card-repeats').value, card.card_repeats);
      playCard(card, repeats);
    });

    node.querySelector('.edit-card-btn').addEventListener('click', () => setCardEditMode(node, true));

    node.querySelector('.cancel-card-btn').addEventListener('click', () => {
      node.querySelector('.card-text').value = card.text;
      node.querySelector('.card-repeats').value = card.card_repeats;
      replaceImageInput.value = '';
      setCardEditMode(node, false);
    });

    node.querySelector('.save-card-btn').addEventListener('click', () => saveCardFromNode(node, card.id));
    node.querySelector('.delete-card-btn').addEventListener('click', () => deleteCard(card.id));
    node.querySelector('.paste-replace-image-btn').addEventListener('click', () => pasteImageIntoInput(replaceImageInput));
    removeImageButton.addEventListener('click', () => removeCardImage(card.id));

    el.cardsList.append(node);
  }
}

function setCardEditMode(node, isEditing) {
  node.classList.toggle('card-editing', isEditing);
  node.querySelector('.card-text-preview').classList.toggle('hidden', isEditing);
  node.querySelector('.card-edit-field').classList.toggle('hidden', !isEditing);
  node.querySelector('.card-repeats-preview').classList.toggle('hidden', isEditing);
  node.querySelector('.card-repeats-field').classList.toggle('hidden', !isEditing);
  node.querySelector('.card-image-row').classList.toggle('hidden', !isEditing);
  node.querySelector('.edit-card-btn').classList.toggle('hidden', isEditing);
  node.querySelector('.save-card-btn').classList.toggle('hidden', !isEditing);
  node.querySelector('.cancel-card-btn').classList.toggle('hidden', !isEditing);
}

async function refreshSelectedGroup() {
  if (!state.selectedGroup) return;
  state.selectedGroup = await requestJson(`/api/groups/${state.selectedGroup.id}`);
  await loadGroups();
  renderWorkspace();
}

async function saveCardFromNode(node, cardId) {
  const text = node.querySelector('.card-text').value.trim();
  if (!text) {
    showToast('Текст карточки не может быть пустым.', true);
    return;
  }

  const formData = new FormData();
  formData.append('text', text);
  formData.append('card_repeats', positiveInt(node.querySelector('.card-repeats').value));

  const imageInput = node.querySelector('.replace-image');
  if (imageInput.files[0]) {
    formData.append('image', imageInput.files[0]);
  }

  try {
    await requestJson(`/api/cards/${cardId}`, { method: 'PATCH', body: formData });
    await refreshSelectedGroup();
    showToast('Карточка сохранена. Если текст изменился, MP3 создан заново.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function removeCardImage(cardId) {
  try {
    await requestJson(`/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_image: true }),
    });
    await refreshSelectedGroup();
    showToast('Изображение удалено.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteCard(cardId) {
  if (!confirm('Удалить карточку?')) return;

  try {
    await requestJson(`/api/cards/${cardId}`, { method: 'DELETE' });
    await refreshSelectedGroup();
    showToast('Карточка удалена.');
  } catch (error) {
    showToast(error.message, true);
  }
}

function stopPlayback() {
  state.playbackToken += 1;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.currentTime = 0;
    state.currentAudio = null;
  }
}

function playAudioOnce(src, token) {
  return new Promise((resolve, reject) => {
    if (token !== state.playbackToken) return resolve();

    const audio = new Audio(src);
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;
    state.currentAudio = audio;

    audio.addEventListener('ended', () => resolve(), { once: true });
    audio.addEventListener('error', () => reject(new Error('Не удалось воспроизвести MP3')), { once: true });

    audio.play().catch(reject);
  });
}

async function playCard(card, repeats = card.card_repeats) {
  stopPlayback();
  const token = state.playbackToken;

  try {
    for (let i = 0; i < repeats; i += 1) {
      if (token !== state.playbackToken) break;
      await playAudioOnce(`${card.audio_path}${cardCacheBuster(card)}`, token);
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

async function playGroup() {
  if (!state.selectedGroup || state.selectedGroup.cards.length === 0) {
    showToast('В группе нет карточек для воспроизведения.', true);
    return;
  }

  stopPlayback();
  const token = state.playbackToken;
  const groupRepeats = positiveInt(el.selectedGroupRepeats.value, state.selectedGroup.group_repeats);

  try {
    for (let groupLoop = 0; groupLoop < groupRepeats; groupLoop += 1) {
      for (const card of state.selectedGroup.cards) {
        const repeats = positiveInt(card.card_repeats);
        for (let cardLoop = 0; cardLoop < repeats; cardLoop += 1) {
          if (token !== state.playbackToken) return;
          await playAudioOnce(`${card.audio_path}${cardCacheBuster(card)}`, token);
        }
      }
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

el.groupForm.addEventListener('submit', async event => {
  event.preventDefault();

  try {
    const group = await requestJson('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: el.groupName.value,
        group_repeats: positiveInt(el.groupRepeats.value),
      }),
    });

    el.groupForm.reset();
    el.groupRepeats.value = 1;
    await loadGroups();
    await selectGroup(group.id);
    showToast('Группа создана.');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.saveGroupBtn.addEventListener('click', async () => {
  if (!state.selectedGroup) return;

  try {
    state.selectedGroup = await requestJson(`/api/groups/${state.selectedGroup.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: el.selectedGroupName.value,
        group_repeats: positiveInt(el.selectedGroupRepeats.value),
      }),
    });
    await loadGroups();
    renderWorkspace();
    showToast('Группа сохранена.');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.deleteGroupBtn.addEventListener('click', async () => {
  if (!state.selectedGroup || !confirm('Удалить группу вместе со всеми карточками?')) return;

  try {
    await requestJson(`/api/groups/${state.selectedGroup.id}`, { method: 'DELETE' });
    state.selectedGroup = null;
    await loadGroups();
    renderWorkspace();
    showToast('Группа удалена.');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.applyBulkRepeatsBtn.addEventListener('click', async () => {
  if (!state.selectedGroup) return;

  try {
    state.selectedGroup = await requestJson(`/api/groups/${state.selectedGroup.id}/cards/repeats`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_repeats: positiveInt(el.bulkCardRepeats.value) }),
    });
    await loadGroups();
    renderWorkspace();
    showToast('Повторы применены ко всем карточкам.');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.cardForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.selectedGroup) return;

  const formData = new FormData();
  formData.append('text', el.cardText.value);
  formData.append('card_repeats', positiveInt(el.cardRepeats.value));
  if (el.cardImage.files[0]) {
    formData.append('image', el.cardImage.files[0]);
  }

  try {
    await requestJson(`/api/groups/${state.selectedGroup.id}/cards`, {
      method: 'POST',
      body: formData,
    });
    el.cardForm.reset();
    el.cardRepeats.value = 1;
    await refreshSelectedGroup();
    showToast('Карточка сохранена, MP3 создан.');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.playGroupBtn.addEventListener('click', playGroup);
el.stopPlaybackBtn.addEventListener('click', stopPlayback);
el.pasteImageBtn.addEventListener('click', () => pasteImageIntoInput(el.cardImage));
el.playbackRateInput.addEventListener('change', () => setPlaybackRate(el.playbackRateInput.value));
el.decreaseRateBtn.addEventListener('click', () => setPlaybackRate(state.playbackRate - 0.1));
el.increaseRateBtn.addEventListener('click', () => setPlaybackRate(state.playbackRate + 0.1));

document.addEventListener('paste', event => {
  const file = imageFromPasteEvent(event);
  if (!file) return;

  if (!state.selectedGroup) {
    showToast('Сначала выберите группу.', true);
    return;
  }

  const input = imagePasteTargetFromEvent(event);
  if (!input) return;

  event.preventDefault();
  setImageInputFile(input, file);
  showToast(pasteMessageForInput(input));
});

setPlaybackRate(state.playbackRate, false);
loadGroups().catch(error => showToast(error.message, true));
