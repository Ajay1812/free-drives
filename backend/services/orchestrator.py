from fastapi import UploadFile
from backend.providers.base import StorageProvider
from backend.providers.google_drive import GoogleDriveProvider
from backend.providers.telegram import TelegramProvider
from backend.services.chunker import TELEGRAM_CHUNK_LIMIT, reassemble_chunks
from backend.database import FileRecord, ChunkRecord, get_db
from backend.config import settings

_REGISTRY: dict[str, type[StorageProvider]] = {
    "google_drive": GoogleDriveProvider,
    "telegram": TelegramProvider,
}


def _load_providers() -> list[StorageProvider]:
    result = []
    for name in settings.provider_priority:
        cls = _REGISTRY.get(name)
        if cls is None:
            continue
        try:
            p = cls()
            if p.is_available():
                result.append(p)
        except Exception:
            pass
    return result


def _providers_map() -> dict[str, StorageProvider]:
    return {p.name: p for p in _load_providers()}


def _pick(providers: list[StorageProvider], needed: int) -> StorageProvider | None:
    return next((p for p in providers if p.free_bytes() >= needed), None)


async def store_file(
    upload_file: UploadFile,
    filename: str,
    iv_b64: str | None,
    mime_type: str,
    force_provider: str | None = None,
    hint: str | None = None,
    progress_callback=None,
) -> int:
    providers = _load_providers()
    if not providers:
        raise RuntimeError("No storage providers are configured and available.")

    if force_provider:
        providers = [p for p in providers if p.name == force_provider]
        if not providers:
            raise RuntimeError(f"Provider '{force_provider}' is not available or not configured.")

    # Get total file size upfront for accurate cumulative progress reporting.
    upload_file.file.seek(0, 2)
    total_file_size = upload_file.file.tell()
    upload_file.file.seek(0)

    chunk_records: list[dict] = []
    chunk_index = 0
    total_size = 0
    bytes_uploaded = 0  # tracks bytes successfully sent to cloud across all chunks

    while True:
        chunk = await upload_file.read(TELEGRAM_CHUNK_LIMIT)
        if not chunk:
            break

        chunk_len = len(chunk)
        total_size += chunk_len
        provider = _pick(providers, chunk_len)
        if provider is None:
            raise RuntimeError("Not enough free space across all configured providers.")

        part_name = filename if chunk_index == 0 else f"{filename}.part{chunk_index}"

        # Build a per-chunk callback that reports cumulative progress over the whole file.
        chunk_callback = None
        if progress_callback and total_file_size > 0:
            base = bytes_uploaded
            def _make_cb(base_bytes):
                def _cb(sent: int, total: int):
                    progress_callback(base_bytes + sent, total_file_size)
                return _cb
            chunk_callback = _make_cb(base)

        provider_file_id = await provider.upload(chunk, part_name, progress_callback=chunk_callback)
        bytes_uploaded += chunk_len
        chunk_records.append({
            "chunk_index": chunk_index,
            "provider": provider.name,
            "provider_file_id": provider_file_id,
            "size": chunk_len,
        })
        chunk_index += 1

    if not chunk_records:
        raise RuntimeError("Upload contained no data.")

    with get_db() as db:
        file_rec = FileRecord(
            name=filename,
            size=total_size,
            mime_type=mime_type,
            is_encrypted=iv_b64 is not None,
            iv_b64=iv_b64,
            hint=hint or None,
        )
        db.add(file_rec)
        db.flush()
        for cr in chunk_records:
            db.add(ChunkRecord(file_id=file_rec.id, **cr))
        db.flush()
        return file_rec.id


async def retrieve_file(file_id: int) -> tuple[bytes, FileRecord]:
    with get_db() as db:
        file_rec = db.get(FileRecord, file_id)
        if file_rec is None:
            raise FileNotFoundError(f"File {file_id} not found")
        chunk_meta = [(c.provider, c.provider_file_id) for c in sorted(file_rec.chunks, key=lambda c: c.chunk_index)]
        db.expunge(file_rec)

    pmap = _providers_map()
    parts: list[bytes] = []
    for provider_name, provider_file_id in chunk_meta:
        p = pmap.get(provider_name)
        if p is None:
            raise RuntimeError(f"Provider '{provider_name}' is not available.")
        parts.append(await p.download(provider_file_id))

    return reassemble_chunks(parts), file_rec


async def delete_file(file_id: int) -> None:
    with get_db() as db:
        file_rec = db.get(FileRecord, file_id)
        if file_rec is None:
            raise FileNotFoundError(f"File {file_id} not found")
        chunk_meta = [(c.provider, c.provider_file_id) for c in file_rec.chunks]

    pmap = _providers_map()
    for provider_name, provider_file_id in chunk_meta:
        p = pmap.get(provider_name)
        if p:
            await p.delete(provider_file_id)

    with get_db() as db:
        file_rec = db.get(FileRecord, file_id)
        if file_rec:
            db.delete(file_rec)


def get_provider_status() -> list[dict]:
    result = []
    for name in settings.provider_priority:
        cls = _REGISTRY.get(name)
        if cls is None:
            continue
        try:
            p = cls()
            available = p.is_available()
            used = p.used_bytes() if available else 0
            cap = p.capacity_bytes()
        except Exception:
            available, used, cap = False, 0, 0
        result.append({
            "name": name,
            "capacity_bytes": cap,
            "used_bytes": used,
            "free_bytes": cap - used,
            "available": available,
        })
    return result
