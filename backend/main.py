from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from pathlib import Path
from backend.database import create_tables, run_migrations
from backend.routers.files import router as files_router
from backend.routers.providers import router as providers_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    run_migrations()
    yield


app = FastAPI(title="FreeDrives", version="0.1.0", lifespan=lifespan)

app.include_router(files_router)
app.include_router(providers_router)

frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(str(frontend_dir / "index.html"))

    @app.get("/dashboard")
    def serve_dashboard():
        return FileResponse(str(frontend_dir / "dashboard.html"))
