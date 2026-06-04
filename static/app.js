// static/app.js
const state = {
  groups: [],
  selectedGroup: null,
  playbackToken: 0,
  currentAudio: new Audio(),
  playbackRate: 1.0,
  playbackImagesHidden: false,
  pauseBetweenCards: 0,
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
  pauseBetweenCardsInput: document.querySelector('#pauseBetweenCardsInput'),
  cardsList: document.querySelector('#cardsList'),
  cardsCounter: document.querySelector('#cardsCounter'),
  toast: document.querySelector('#toast'),
  playbackImageOverlay: document.querySelector('#playbackImageOverlay'),
  playbackImage: document.querySelector('#playbackImage'),
  overlayStopPlaybackBtn: document.querySelector('#overlayStopPlaybackBtn'),
  hidePlaybackImagesBtn: document.querySelector('#hidePlaybackImagesBtn'),
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

function boundedInt(value, fallback = 1, min = 1, max = 100) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function positiveInt(value, fallback = 1) {
  return boundedInt(value, fallback, 1, 100);
}

function cardRepeatsInt(value, fallback = 1) {
  return boundedInt(value, fallback, 0, 100);
}

function booleanFromGroupOption(value) {
  return value !== false;
}

function clampPlaybackRate(value, fallback = state.playbackRate || 1) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number)) return fallback;
  return Math.max(0.5, Math.min(number, 2));
}

function formatPlaybackRate(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampPauseBetweenCards(value, fallback = 0) {
  const number = Number.parseFloat(value);

  if (Number.isNaN(number)) {
    return fallback;
  }

  return Math.max(0, Math.min(number, 3600));
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
    const item = document.createElement('div');
    item.className = `group-item ${state.selectedGroup?.id === group.id ? 'active' : ''}`;

    const button = document.createElement('button');
    button.className = 'group-select-btn';
    button.type = 'button';
    button.innerHTML = `
      <strong></strong>
      <span></span>
    `;
    button.querySelector('strong').textContent = group.name;
    button.querySelector('span').textContent = `Карточек: ${group.cards_count}; повторов группы: ${group.group_repeats}`;
    button.addEventListener('click', () => selectGroup(group.id));

    const imageToggle = document.createElement('label');
    imageToggle.className = 'group-image-toggle';
    imageToggle.innerHTML = `
      <input type="checkbox">
      <span>Показывать картинку при воспроизведении</span>
    `;

    const checkbox = imageToggle.querySelector('input');
    checkbox.checked = booleanFromGroupOption(group.show_card_image);
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => updateGroupImageSetting(group.id, checkbox.checked));

    item.append(button, imageToggle);
    el.groupsList.append(item);
  }
}

async function updateGroupImageSetting(groupId, enabled) {
  try {
    const updatedGroup = await requestJson(`/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_card_image: enabled }),
    });

    if (state.selectedGroup?.id === groupId) {
      state.selectedGroup = updatedGroup;
      renderWorkspace();
    }

    await loadGroups();
    showToast(enabled ? 'Показ изображений включён.' : 'Показ изображений отключён.');
  } catch (error) {
    showToast(error.message, true);
    await loadGroups();
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
          <label class="card-repeats-field">
            Повторы
            <input class="card-repeats" type="number" min="0" max="100">
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
    node.querySelector('.card-text').value = card.text;
    node.querySelector('.card-repeats').value = card.card_repeats;

    const audio = node.querySelector('audio');
    audio.src = `${card.audio_path}${cardCacheBuster(card)}`;
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;
    audio.addEventListener('play', () => {
      state.playbackImagesHidden = false;
      showPlaybackImage(card);
    });
    audio.addEventListener('pause', hidePlaybackImage);
    audio.addEventListener('ended', hidePlaybackImage);

    const replaceImageInput = node.querySelector('.replace-image');
    const removeImageButton = node.querySelector('.remove-image-btn');
    removeImageButton.disabled = !card.image_path;
    if (!card.image_path) {
      removeImageButton.textContent = 'Изображения нет';
    }

    const cardRepeatsInput = node.querySelector('.card-repeats');
    cardRepeatsInput.addEventListener('change', () => updateCardRepeats(card.id, cardRepeatsInput.value, cardRepeatsInput));

    node.querySelector('.play-card-btn').addEventListener('click', () => {
      const repeats = cardRepeatsInt(cardRepeatsInput.value, card.card_repeats);
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

async function updateCardRepeats(cardId, value, input = null) {
  const repeats = cardRepeatsInt(value, 0);

  try {
    const updatedCard = await requestJson(`/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_repeats: repeats }),
    });

    if (input) {
      input.value = updatedCard.card_repeats;
    }

    const card = state.selectedGroup?.cards.find(item => item.id === cardId);
    if (card) {
      card.card_repeats = updatedCard.card_repeats;
      card.updated_at = updatedCard.updated_at;
    }

    showToast(updatedCard.card_repeats === 0 ? 'Карточка будет пропускаться.' : 'Повторы карточки сохранены.');
  } catch (error) {
    showToast(error.message, true);
    await refreshSelectedGroup();
  }
}

async function saveCardFromNode(node, cardId) {
  const text = node.querySelector('.card-text').value.trim();
  if (!text) {
    showToast('Текст карточки не может быть пустым.', true);
    return;
  }

  const formData = new FormData();
  formData.append('text', text);
  formData.append('card_repeats', cardRepeatsInt(node.querySelector('.card-repeats').value));

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

function shouldShowPlaybackImage() {
  return booleanFromGroupOption(state.selectedGroup?.show_card_image) && !state.playbackImagesHidden;
}

function showPlaybackImage(card) {
  if (!el.playbackImageOverlay || !el.playbackImage) return;

  if (!shouldShowPlaybackImage() || !card?.image_path) {
    hidePlaybackImage();
    return;
  }

  el.playbackImage.src = `${card.image_path}${cardCacheBuster(card)}`;
  el.playbackImage.alt = card.text ? `Изображение карточки: ${card.text}` : 'Изображение карточки';
  el.playbackImageOverlay.classList.remove('hidden');
  el.playbackImageOverlay.setAttribute('aria-hidden', 'false');
}

function hidePlaybackImage() {
  if (!el.playbackImageOverlay || !el.playbackImage) return;

  el.playbackImageOverlay.classList.add('hidden');
  el.playbackImageOverlay.setAttribute('aria-hidden', 'true');
  el.playbackImage.removeAttribute('src');
}

function hideImagesForPlayback() {
  state.playbackImagesHidden = true;
  hidePlaybackImage();
  showToast('Изображения скрыты до следующего запуска.');
}

function stopPlayback() {
  state.playbackToken += 1;

  hidePlaybackImage();

  document.querySelectorAll('audio').forEach(audio => {
    audio.pause();
    audio.currentTime = 0;
  });

  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.currentTime = 0;
    state.currentAudio.removeAttribute('src');
    state.currentAudio.load();
  }
}

function playAudioOnce(src, token) {
  return new Promise((resolve, reject) => {
    if (token !== state.playbackToken) {
      resolve();
      return;
    }

    const audio = state.currentAudio;

    audio.pause();
    audio.currentTime = 0;
    audio.src = src;

    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Не удалось воспроизвести MP3'));
    };

    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    audio.play().catch(error => {
      cleanup();
      reject(error);
    });
  });
}

async function playCardRepeats(card, repeats, token) {
  if (repeats <= 0 || token !== state.playbackToken) return;

  showPlaybackImage(card);

  try {
    for (let i = 0; i < repeats; i += 1) {
      if (token !== state.playbackToken) {
        break;
      }

      await playAudioOnce(
        `${card.audio_path}${cardCacheBuster(card)}`,
        token
      );

      if (token !== state.playbackToken) {
        break;
      }

      if (state.pauseBetweenCards > 0 && i < repeats - 1) {
        await sleep(state.pauseBetweenCards * 1000);
      }
    }
  } finally {
    hidePlaybackImage();
  }
}

async function playCard(card, repeats = card.card_repeats) {
  stopPlayback();
  state.playbackImagesHidden = false;
  const token = state.playbackToken;
  const safeRepeats = cardRepeatsInt(repeats, card.card_repeats);

  if (safeRepeats === 0) {
    showToast('У карточки 0 повторов — она пропущена.');
    return;
  }

  try {
    await playCardRepeats(card, safeRepeats, token);
  } catch (error) {
    hidePlaybackImage();
    showToast(error.message, true);
  }
}

async function playGroup() {
  if (!state.selectedGroup || state.selectedGroup.cards.length === 0) {
    showToast('В группе нет карточек для воспроизведения.', true);
    return;
  }

  stopPlayback();
  state.playbackImagesHidden = false;
  const token = state.playbackToken;
  const groupRepeats = positiveInt(el.selectedGroupRepeats.value, state.selectedGroup.group_repeats);

  state.pauseBetweenCards = clampPauseBetweenCards(
    el.pauseBetweenCardsInput?.value,
    state.pauseBetweenCards
  );

  try {
    for (let groupLoop = 0; groupLoop < groupRepeats; groupLoop += 1) {
      for (const card of state.selectedGroup.cards) {
        const repeats = cardRepeatsInt(card.card_repeats, 0);
        if (repeats === 0) continue;
        if (token !== state.playbackToken) return;
        await playCardRepeats(card, repeats, token);

        if (token !== state.playbackToken) {
          return;
        }

        if (state.pauseBetweenCards > 0) {
          await sleep(state.pauseBetweenCards * 1000);
        }
      }
    }
  } catch (error) {
    hidePlaybackImage();
    showToast(error.message, true);
  } finally {
    hidePlaybackImage();
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
      body: JSON.stringify({ card_repeats: cardRepeatsInt(el.bulkCardRepeats.value) }),
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
  formData.append('card_repeats', cardRepeatsInt(el.cardRepeats.value));
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

if (el.overlayStopPlaybackBtn) {
  el.overlayStopPlaybackBtn.addEventListener('click', stopPlayback);
}

if (el.hidePlaybackImagesBtn) {
  el.hidePlaybackImagesBtn.addEventListener('click', hideImagesForPlayback);
}

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