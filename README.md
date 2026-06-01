# TTS Cards MVP

Небольшое веб-приложение на HTML/JS + Python Flask + MySQL 8.4 + Docker.

## Что умеет

- создавать группы;
- задавать количество повторов воспроизведения всей группы;
- создавать карточки внутри группы;
- хранить текст карточки;
- автоматически создавать MP3 через TTS при сохранении карточки;
- прикреплять изображение к карточке;
- воспроизводить одну карточку отдельно;
- воспроизводить всю группу целиком;
- учитывать количество повторов каждой карточки;
- массово менять количество повторов для всех карточек группы;
- редактировать текст, повторы и изображение карточки;
- при изменении текста автоматически пересоздавать MP3.

## Запуск

```bash
docker compose up --build
```

После запуска откройте:

```text
http://localhost:8000
```

## Настройки

В `docker-compose.yml` можно изменить:

```yaml
TTS_LANG: ru
```

Например:

- `ru` — русский;
- `en` — английский;
- `de` — немецкий.

## Важно про TTS

В этом MVP используется `gTTS`. Он генерирует MP3 через Google Translate TTS API, поэтому контейнеру нужен интернет во время создания или пересоздания аудио.

Для полностью офлайн-режима можно заменить функцию `generate_tts_mp3()` в `app.py` на Piper, Coqui TTS или другой локальный движок.

## Структура

```text
tts_cards_mvp/
  app.py
  docker-compose.yml
  Dockerfile
  requirements.txt
  templates/
    index.html
  static/
    app.js
    style.css
    audio/
    uploads/
```

## API

### Группы

- `GET /api/groups`
- `POST /api/groups`
- `GET /api/groups/<id>`
- `PATCH /api/groups/<id>`
- `DELETE /api/groups/<id>`

### Карточки

- `POST /api/groups/<id>/cards`
- `PATCH /api/cards/<id>`
- `DELETE /api/cards/<id>`
- `PATCH /api/groups/<id>/cards/repeats`
