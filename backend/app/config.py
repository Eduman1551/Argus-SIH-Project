"""Settings from environment variables, with an optional .env file at the repo root."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    """Tiny .env reader: KEY=VALUE lines, existing environment variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


@dataclass(frozen=True)
class Settings:
    database_url: str
    session_secret: str
    groq_api_key: str
    llm_model: str
    cron_secret: str


@lru_cache
def get_settings() -> Settings:
    _load_dotenv(REPO_ROOT / ".env")
    return Settings(
        database_url=os.environ.get("DATABASE_URL", ""),
        session_secret=os.environ.get("SESSION_SECRET", "argus-dev-only-secret"),
        groq_api_key=os.environ.get("GROQ_API_KEY", ""),
        llm_model=os.environ.get("LLM_MODEL", "") or "llama-3.3-70b-versatile",
        cron_secret=os.environ.get("CRON_SECRET", ""),
    )
