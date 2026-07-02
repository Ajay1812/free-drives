from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    google_credentials_path: str = "credentials/google_credentials.json"
    google_token_path: str = "credentials/google_token.json"

    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_bot_token: str = ""
    telegram_channel_id: int = 0

    secret_key: str = "change-me"
    database_url: str = "sqlite:///./freedrives.db"

    provider_priority: list[str] = ["google_drive", "telegram"]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
