"""FastAPI application. Local: `pnpm dev:api`. Vercel: imported by api/index.py."""

from __future__ import annotations

import logging

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.intelligence import router as intelligence_router
from app.api.routes import router
from app.auth import NotSignedIn
from app.common import DomainError
from app.rules import RuleError
from db import DatabaseNotConfigured

log = logging.getLogger("argus")

app = FastAPI(
    title="Argus API",
    description="AICTE approval workflow, compliance monitoring and alert management. "
                "Prototype with SYNTHETIC DATA, not an official AICTE system.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.include_router(router)
app.include_router(intelligence_router)


@app.exception_handler(DomainError)
async def domain_error(_: Request, exc: DomainError):
    return JSONResponse({"detail": exc.message}, status_code=exc.status)


@app.exception_handler(RuleError)
async def rule_error(_: Request, exc: RuleError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(NotSignedIn)
async def not_signed_in(_: Request, __: NotSignedIn):
    return JSONResponse({"detail": "Choose a demo user first."}, status_code=401)


@app.exception_handler(DatabaseNotConfigured)
async def no_database(_: Request, exc: DatabaseNotConfigured):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(psycopg.OperationalError)
async def db_down(_: Request, exc: psycopg.OperationalError):
    log.error("database unavailable: %s", type(exc).__name__)
    return JSONResponse({"detail": "The database is not reachable right now. Please retry."}, status_code=503)


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    return JSONResponse({"detail": f"Please check {field}: {first.get('msg', 'invalid value')}."}, status_code=422)
