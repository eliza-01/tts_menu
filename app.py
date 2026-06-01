import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from gtts import gTTS
from sqlalchemy.exc import OperationalError
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
AUDIO_DIR = BASE_DIR / "static" / "audio"
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "mysql+pymysql://app:app_password@localhost:3306/tts_cards"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-secret-key")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH_MB", "16")) * 1024 * 1024

TTS_LANG = os.getenv("TTS_LANG", "ru")

db = SQLAlchemy(app)


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    group_repeats = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    cards = db.relationship(
        "Card",
        backref="group",
        cascade="all, delete-orphan",
        lazy=True,
        order_by="Card.position.asc(), Card.id.asc()",
    )


class Card(db.Model):
    __tablename__ = "cards"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    text = db.Column(db.Text, nullable=False)
    audio_path = db.Column(db.String(500), nullable=True)
    image_path = db.Column(db.String(500), nullable=True)
    card_repeats = db.Column(db.Integer, nullable=False, default=1)
    position = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


def clamp_positive_int(value, default=1, max_value=100):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, max_value))


def allowed_image(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def public_static_path(path: Path) -> str:
    rel = path.relative_to(BASE_DIR / "static")
    return f"/static/{rel.as_posix()}"


def delete_static_file(public_path: str | None) -> None:
    if not public_path or not public_path.startswith("/static/"):
        return
    local_path = BASE_DIR / public_path.removeprefix("/static/")
    try:
        if local_path.exists() and local_path.is_file():
            local_path.unlink()
    except OSError:
        pass


def generate_tts_mp3(card: Card) -> str:
    if not card.text.strip():
        raise ValueError("Текст карточки не может быть пустым")

    filename = f"card_{card.id}_{uuid4().hex}.mp3"
    output_path = AUDIO_DIR / filename

    tts = gTTS(text=card.text, lang=TTS_LANG)
    tts.save(str(output_path))

    old_audio = card.audio_path
    card.audio_path = public_static_path(output_path)
    delete_static_file(old_audio)
    return card.audio_path


def save_image(file_storage, old_image_path: str | None = None) -> str | None:
    if not file_storage or file_storage.filename == "":
        return old_image_path

    if not allowed_image(file_storage.filename):
        raise ValueError("Разрешены только изображения: png, jpg, jpeg, gif, webp")

    original = secure_filename(file_storage.filename)
    ext = original.rsplit(".", 1)[1].lower()
    filename = f"image_{uuid4().hex}.{ext}"
    output_path = UPLOAD_DIR / filename
    file_storage.save(output_path)

    delete_static_file(old_image_path)
    return public_static_path(output_path)


def serialize_card(card: Card) -> dict:
    return {
        "id": card.id,
        "group_id": card.group_id,
        "text": card.text,
        "audio_path": card.audio_path,
        "image_path": card.image_path,
        "card_repeats": card.card_repeats,
        "position": card.position,
        "updated_at": card.updated_at.isoformat() if card.updated_at else None,
    }


def serialize_group(group: Group, include_cards=False) -> dict:
    data = {
        "id": group.id,
        "name": group.name,
        "group_repeats": group.group_repeats,
        "cards_count": len(group.cards),
    }
    if include_cards:
        data["cards"] = [serialize_card(card) for card in group.cards]
    return data


def get_payload_value(name: str, default=None):
    if request.is_json:
        return (request.get_json(silent=True) or {}).get(name, default)
    return request.form.get(name, default)


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "Файл слишком большой"}), 413


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/groups")
def list_groups():
    groups = Group.query.order_by(Group.created_at.desc(), Group.id.desc()).all()
    return jsonify([serialize_group(group) for group in groups])


@app.post("/api/groups")
def create_group():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Название группы обязательно"}), 400

    group = Group(
        name=name,
        group_repeats=clamp_positive_int(payload.get("group_repeats"), default=1),
    )
    db.session.add(group)
    db.session.commit()
    return jsonify(serialize_group(group, include_cards=True)), 201


@app.get("/api/groups/<int:group_id>")
def get_group(group_id):
    group = db.get_or_404(Group, group_id)
    return jsonify(serialize_group(group, include_cards=True))


@app.patch("/api/groups/<int:group_id>")
def update_group(group_id):
    group = db.get_or_404(Group, group_id)
    payload = request.get_json(silent=True) or {}

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Название группы не может быть пустым"}), 400
        group.name = name

    if "group_repeats" in payload:
        group.group_repeats = clamp_positive_int(payload.get("group_repeats"), default=group.group_repeats)

    db.session.commit()
    return jsonify(serialize_group(group, include_cards=True))


@app.delete("/api/groups/<int:group_id>")
def delete_group(group_id):
    group = db.get_or_404(Group, group_id)
    for card in group.cards:
        delete_static_file(card.audio_path)
        delete_static_file(card.image_path)
    db.session.delete(group)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/groups/<int:group_id>/cards")
def create_card(group_id):
    group = db.get_or_404(Group, group_id)
    text = (get_payload_value("text", "") or "").strip()
    if not text:
        return jsonify({"error": "Текст карточки обязателен"}), 400

    next_position = (db.session.query(db.func.max(Card.position)).filter_by(group_id=group.id).scalar() or 0) + 1
    card = Card(
        group_id=group.id,
        text=text,
        card_repeats=clamp_positive_int(get_payload_value("card_repeats", 1), default=1),
        position=next_position,
    )
    db.session.add(card)
    db.session.flush()

    try:
        card.image_path = save_image(request.files.get("image"))
        generate_tts_mp3(card)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        delete_static_file(card.image_path)
        return jsonify({"error": f"Не удалось сохранить карточку: {exc}"}), 400

    return jsonify(serialize_card(card)), 201


@app.patch("/api/cards/<int:card_id>")
def update_card(card_id):
    card = db.get_or_404(Card, card_id)
    text_changed = False

    if request.is_json:
        payload = request.get_json(silent=True) or {}
        if "text" in payload:
            new_text = (payload.get("text") or "").strip()
            if not new_text:
                return jsonify({"error": "Текст карточки не может быть пустым"}), 400
            if new_text != card.text:
                card.text = new_text
                text_changed = True
        if "card_repeats" in payload:
            card.card_repeats = clamp_positive_int(payload.get("card_repeats"), default=card.card_repeats)
        if payload.get("remove_image") is True:
            delete_static_file(card.image_path)
            card.image_path = None
    else:
        if "text" in request.form:
            new_text = (request.form.get("text") or "").strip()
            if not new_text:
                return jsonify({"error": "Текст карточки не может быть пустым"}), 400
            if new_text != card.text:
                card.text = new_text
                text_changed = True
        if "card_repeats" in request.form:
            card.card_repeats = clamp_positive_int(request.form.get("card_repeats"), default=card.card_repeats)
        if request.form.get("remove_image") == "true":
            delete_static_file(card.image_path)
            card.image_path = None
        if "image" in request.files:
            try:
                card.image_path = save_image(request.files.get("image"), card.image_path)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

    try:
        if text_changed:
            generate_tts_mp3(card)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Не удалось обновить карточку: {exc}"}), 400

    return jsonify(serialize_card(card))


@app.delete("/api/cards/<int:card_id>")
def delete_card(card_id):
    card = db.get_or_404(Card, card_id)
    delete_static_file(card.audio_path)
    delete_static_file(card.image_path)
    db.session.delete(card)
    db.session.commit()
    return jsonify({"ok": True})


@app.patch("/api/groups/<int:group_id>/cards/repeats")
def bulk_update_card_repeats(group_id):
    group = db.get_or_404(Group, group_id)
    payload = request.get_json(silent=True) or {}
    repeats = clamp_positive_int(payload.get("card_repeats"), default=1)

    for card in group.cards:
        card.card_repeats = repeats
    db.session.commit()

    return jsonify(serialize_group(group, include_cards=True))


def init_db_with_retry():
    last_error = None
    for _ in range(40):
        try:
            with app.app_context():
                db.create_all()
            return
        except OperationalError as exc:
            last_error = exc
            time.sleep(1)
    raise last_error


init_db_with_retry()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
