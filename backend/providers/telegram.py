import io
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import DocumentAttributeFilename
from backend.providers.base import StorageProvider
from backend.config import settings

# Uses a bot token + private channel instead of a user account.
# StringSession keeps the session in memory — no SQLite file, no locking issues
# when multiple concurrent uploads hit the Telegram provider simultaneously.

_client: TelegramClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> TelegramClient:
    global _client
    async with _client_lock:
        if _client is None or not _client.is_connected():
            _client = TelegramClient(
                StringSession(),
                settings.telegram_api_id,
                settings.telegram_api_hash,
            )
            await _client.start(bot_token=settings.telegram_bot_token)
    return _client


class TelegramProvider(StorageProvider):
    name = "telegram"
    _CAPACITY = 1_000 * 1024 ** 4  # sentinel for ~unlimited

    async def upload(self, data: bytes, filename: str, progress_callback=None) -> str:
        client = await _get_client()
        result = await client.send_file(
            settings.telegram_channel_id,
            file=io.BytesIO(data),
            force_document=True,
            attributes=[DocumentAttributeFilename(file_name=filename)],
            progress_callback=progress_callback,
            workers=4,  # upload 4 parts in parallel instead of 1
        )
        return str(result.id)

    async def download(self, provider_file_id: str) -> bytes:
        client = await _get_client()
        msg = await client.get_messages(settings.telegram_channel_id, ids=int(provider_file_id))
        buf = io.BytesIO()
        await client.download_media(msg, file=buf)
        return buf.getvalue()

    async def delete(self, provider_file_id: str) -> None:
        client = await _get_client()
        await client.delete_messages(settings.telegram_channel_id, [int(provider_file_id)])

    def used_bytes(self) -> int:
        return 0

    def capacity_bytes(self) -> int:
        return self._CAPACITY

    def is_available(self) -> bool:
        return bool(
            settings.telegram_api_id
            and settings.telegram_api_hash
            and settings.telegram_bot_token
            and settings.telegram_channel_id
        )
