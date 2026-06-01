FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/static/audio /app/static/uploads

EXPOSE 4000

CMD ["gunicorn", "-b", "0.0.0.0:4000", "app:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
