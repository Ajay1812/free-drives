import asyncio
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from backend.database import FileRecord, get_db
from backend.services.orchestrator import store_file, retrieve_file, delete_file

router = APIRouter(prefix="/files", tags=["files"])

# In-memory progress store: upload_id → {sent, total, task}
_progress: dict[str, dict] = {}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    iv_b64: str | None = Form(None),
    hint: str | None = Form(None),
    mime_type: str = Form("application/octet-stream"),
    provider: str | None = Form(None),
    upload_id: str | None = Form(None),
):
    if upload_id:
        _progress[upload_id] = {"sent": 0, "total": 0, "task": None}

    def on_progress(sent: int, total: int):
        if upload_id and upload_id in _progress:
            _progress[upload_id]["sent"] = sent
            _progress[upload_id]["total"] = total

    task = asyncio.create_task(store_file(
        upload_file=file,
        filename=file.filename or "unnamed",
        iv_b64=iv_b64,
        mime_type=mime_type,
        force_provider=provider or None,
        hint=hint,
        progress_callback=on_progress if upload_id else None,
    ))
    if upload_id and upload_id in _progress:
        _progress[upload_id]["task"] = task

    try:
        file_id = await task
    except asyncio.CancelledError:
        return Response(
            content='{"detail":"Upload cancelled"}',
            media_type="application/json",
            status_code=499,
        )
    finally:
        _progress.pop(upload_id, None)

    return {"id": file_id, "name": file.filename}


@router.get("/upload-progress/{upload_id}")
def get_upload_progress(upload_id: str):
    p = _progress.get(upload_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Not found or already complete")
    return {"sent": p["sent"], "total": p["total"]}


@router.delete("/upload-progress/{upload_id}")
def cancel_upload_progress(upload_id: str):
    p = _progress.get(upload_id)
    if p and p.get("task"):
        p["task"].cancel()
    return {"cancelled": True}


@router.get("")
def list_files():
    with get_db() as db:
        records = db.query(FileRecord).order_by(FileRecord.created_at.desc()).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "size": r.size,
                "mime_type": r.mime_type,
                "is_encrypted": r.is_encrypted,
                "iv_b64": r.iv_b64,
                "hint": r.hint,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "providers": list({c.provider for c in r.chunks}),
            }
            for r in records
        ]


@router.get("/{file_id}/download")
async def download_file(file_id: int):
    try:
        data, file_rec = await retrieve_file(file_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return Response(
        content=data,
        media_type=file_rec.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{file_rec.name}"'},
    )


@router.delete("/{file_id}")
async def delete_file_endpoint(file_id: int):
    try:
        await delete_file(file_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"deleted": file_id}
