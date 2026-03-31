from __future__ import annotations

import os

import uvicorn

from backend.app import create_app


app = create_app()


def main() -> None:
    host = os.getenv("API_HOST", "127.0.0.1")
    port = int(os.getenv("API_PORT", "8000"))
    reload_enabled = os.getenv("API_RELOAD", "false").lower() in {"1", "true", "yes", "on"}

    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=reload_enabled,
    )


if __name__ == "__main__":
    main()
