from fastapi import APIRouter
from backend.services.orchestrator import get_provider_status

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("")
def list_providers():
    return get_provider_status()
