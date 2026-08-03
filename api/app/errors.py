from __future__ import annotations


class ApplicationError(RuntimeError):
    """Expected application failure that can be translated to an HTTP response."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class BadRequestError(ApplicationError):
    def __init__(self, detail: str) -> None:
        super().__init__(400, detail)


class NotFoundError(ApplicationError):
    def __init__(self, detail: str) -> None:
        super().__init__(404, detail)


class ValidationError(ApplicationError):
    def __init__(self, detail: str) -> None:
        super().__init__(422, detail)


class ProviderUnavailableError(ApplicationError):
    def __init__(self, detail: str) -> None:
        super().__init__(503, detail)
