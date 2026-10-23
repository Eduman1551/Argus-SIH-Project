"""Single-function entrypoint for the FastAPI app.

vercel.json deploys the backend as a service (root backend/, entrypoint app.main:app). This file is
the alternative for the classic layout, where Vercel serves api/*.py as Python functions next to a
Next.js app: it puts backend/ on the import path and exposes the same ASGI `app`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402

__all__ = ["app"]
