# FreeDrives

Aggregate free cloud storage (Google Drive 15 GB + Telegram unlimited) into one web UI with client-side AES-256-GCM encryption.

## Features

- Waterfall fill — auto-routes files to whichever provider has space
- Browser-side encryption — passphrase never leaves your device
- Parallel uploads with per-file progress, speed, and ETA
- Pagination, multi-select bulk download/delete, sortable table
- Dashboard with storage usage, file-type charts, recent uploads
- Dark / light mode

## Quick Start

```bash
git clone https://github.com/Ajay1812/free-drives.git && cd free-drives
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in credentials
uvicorn backend.main:app --reload
```

Open http://localhost:8000

## Provider Setup

### Google Drive
1. [Google Cloud Console](https://console.cloud.google.com) → new project → enable **Google Drive API**
2. Credentials → OAuth client ID → **Desktop app** → download JSON → save as `credentials/google_credentials.json`
3. OAuth consent screen → add your email as a test user
4. First server start opens a browser auth window and saves `credentials/google_token.json`

### Telegram
1. [my.telegram.org](https://my.telegram.org) → API development tools → copy **api_id** and **api_hash**
2. [@BotFather](https://t.me/BotFather) → `/newbot` → copy **bot token**
3. Create a private channel → add bot as admin → get channel ID from [@userinfobot](https://t.me/userinfobot) (starts with `-100`)

## .env

```env
# Google Drive
GOOGLE_CREDENTIALS_PATH=credentials/google_credentials.json
GOOGLE_TOKEN_PATH=credentials/google_token.json

# App
SECRET_KEY=alike-salon-obtain 
DATABASE_URL=sqlite:///./freedrives.db

TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=123456789:AAH-your-bot-token
TELEGRAM_CHANNEL_ID=-1001234567890
```

Google Drive paths default to `credentials/google_credentials.json` and `credentials/google_token.json` — no need to set them unless you move the files.

## Encryption

Key derived via PBKDF2 (100k iterations, SHA-256) → AES-256-GCM in the browser. The server only ever stores ciphertext. Losing your passphrase = losing the file.

## Notes

- Files > 2 GB are split into 2 GB chunks for Telegram and reassembled on download
- `credentials/`, `.env`, `*.session`, and `freedrives.db` are gitignored — never commit them
