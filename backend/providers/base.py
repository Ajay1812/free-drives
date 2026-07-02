from abc import ABC, abstractmethod


class StorageProvider(ABC):
    name: str = ""

    @abstractmethod
    async def upload(self, data: bytes, filename: str, progress_callback=None) -> str:
        """Upload data and return a provider-specific file ID."""

    @abstractmethod
    async def download(self, provider_file_id: str) -> bytes:
        """Download and return raw bytes for the given provider file ID."""

    @abstractmethod
    async def delete(self, provider_file_id: str) -> None:
        """Delete a file from the provider."""

    @abstractmethod
    def used_bytes(self) -> int:
        """Return bytes currently used on this provider."""

    @abstractmethod
    def capacity_bytes(self) -> int:
        """Return total capacity in bytes for this provider's free tier."""

    def free_bytes(self) -> int:
        return self.capacity_bytes() - self.used_bytes()

    def is_available(self) -> bool:
        return True
