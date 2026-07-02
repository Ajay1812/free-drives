from sqlalchemy import create_engine, Column, Integer, String, BigInteger, Boolean, DateTime, ForeignKey, text
from sqlalchemy.orm import DeclarativeBase, Session, relationship
from sqlalchemy.sql import func
from contextlib import contextmanager
from backend.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)


class Base(DeclarativeBase):
    pass


class FileRecord(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    size = Column(BigInteger, nullable=False)
    mime_type = Column(String, default="application/octet-stream")
    is_encrypted = Column(Boolean, default=True)
    iv_b64 = Column(String, nullable=True)  # AES-GCM IV, base64-encoded
    hint = Column(String, nullable=True)    # plain-text passphrase hint
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    chunks = relationship("ChunkRecord", back_populates="file", cascade="all, delete-orphan")


class ChunkRecord(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    provider = Column(String, nullable=False)
    provider_file_id = Column(String, nullable=False)
    size = Column(BigInteger, nullable=False)

    file = relationship("FileRecord", back_populates="chunks")


class ProviderRecord(Base):
    __tablename__ = "providers"

    name = Column(String, primary_key=True)
    capacity_bytes = Column(BigInteger, default=0)
    used_bytes = Column(BigInteger, default=0)
    priority = Column(Integer, default=99)
    enabled = Column(Boolean, default=False)


def create_tables():
    Base.metadata.create_all(bind=engine)


def run_migrations():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE files ADD COLUMN hint TEXT"))
            conn.commit()
        except Exception:
            pass  # column already exists


@contextmanager
def get_db():
    db = Session(engine)
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
