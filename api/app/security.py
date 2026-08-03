from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from api.app.config import Settings


CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
    )
)

DOCS_CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "img-src 'self' data: https://fastapi.tiangolo.com",
        "connect-src 'self'",
    )
)


def configure_security(app: FastAPI, settings: Settings) -> None:
    """Install host, CORS, request-size and browser security boundaries."""

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(settings.allowed_hosts),
    )

    @app.middleware("http")
    async def protect_http_boundary(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = _reject_invalid_content_length(request, settings.max_request_bytes)
        if response is None:
            response = await call_next(request)
        _apply_security_headers(request, response)
        return response


def _reject_invalid_content_length(
    request: Request,
    max_request_bytes: int,
) -> JSONResponse | None:
    content_length = request.headers.get("content-length")
    if not content_length:
        return None
    try:
        too_large = int(content_length) > max_request_bytes
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"detail": "Content-Length no válido."},
        )
    if not too_large:
        return None
    return JSONResponse(
        status_code=413,
        content={"detail": "La petición supera el límite de 6 MB."},
    )


def _apply_security_headers(request: Request, response: Response) -> None:
    docs_request = request.url.path in {"/api/docs", "/api/docs/"}
    response.headers["Content-Security-Policy"] = (
        DOCS_CONTENT_SECURITY_POLICY if docs_request else CONTENT_SECURITY_POLICY
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    )
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["X-XSS-Protection"] = "0"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path == "/" or request.url.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
