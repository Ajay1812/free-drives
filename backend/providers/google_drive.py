import io
import os
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from backend.providers.base import StorageProvider
from backend.config import settings

SCOPES = ["https://www.googleapis.com/auth/drive"]
FOLDER_NAME = "FreeDrives"


def _get_credentials() -> Credentials:
    creds = None
    token_path = settings.google_token_path
    creds_path = settings.google_credentials_path

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    return creds


def _get_or_create_folder(service) -> str:
    results = service.files().list(
        q=f"name='{FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields="files(id)",
    ).execute()
    items = results.get("files", [])
    if items:
        return items[0]["id"]
    folder = service.files().create(
        body={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
        fields="id",
    ).execute()
    return folder["id"]


class GoogleDriveProvider(StorageProvider):
    name = "google_drive"
    _CAPACITY = 15 * 1024 ** 3  # 15 GB

    def __init__(self):
        creds = _get_credentials()
        self._service = build("drive", "v3", credentials=creds)
        self._folder_id = _get_or_create_folder(self._service)

    async def upload(self, data: bytes, filename: str, progress_callback=None) -> str:
        media = MediaIoBaseUpload(io.BytesIO(data), mimetype="application/octet-stream", resumable=True)
        file_meta = {"name": filename, "parents": [self._folder_id]}
        result = self._service.files().create(body=file_meta, media_body=media, fields="id").execute()
        return result["id"]

    async def download(self, provider_file_id: str) -> bytes:
        request = self._service.files().get_media(fileId=provider_file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()

    async def delete(self, provider_file_id: str) -> None:
        self._service.files().delete(fileId=provider_file_id).execute()

    def used_bytes(self) -> int:
        about = self._service.about().get(fields="storageQuota").execute()
        # "usage" = total across Drive + Gmail + Photos; "usageInDrive" misses Gmail/Photos
        return int(about["storageQuota"].get("usage", 0))

    def capacity_bytes(self) -> int:
        return self._CAPACITY

    def is_available(self) -> bool:
        return os.path.exists(settings.google_credentials_path)
