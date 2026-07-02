# Telegram MTProto allows at most 4000 parts × 512 KB = 2,097,152,000 bytes per file.
# 2 * 1024³ = 2,147,483,648 exceeds that (4096 parts → FilePartsInvalidError).
# Use 2,000,000,000 bytes (~1.86 GiB) to stay safely under the 4000-part limit.
TELEGRAM_CHUNK_LIMIT = 2_000_000_000


def split_into_chunks(data: bytes, chunk_size: int = TELEGRAM_CHUNK_LIMIT) -> list[bytes]:
    """Split bytes into a list of chunks, each at most chunk_size bytes."""
    if len(data) <= chunk_size:
        return [data]
    return [data[i : i + chunk_size] for i in range(0, len(data), chunk_size)]


def reassemble_chunks(chunks: list[bytes]) -> bytes:
    return b"".join(chunks)
