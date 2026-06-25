from __future__ import annotations

from pathlib import Path


class MediaAccessDeniedError(PermissionError):
    pass


def resolve_media_path(path_value: str, roots: tuple[Path, ...]) -> Path:
    if not roots:
        raise MediaAccessDeniedError("no media roots are configured")

    candidate = Path(path_value).expanduser()
    if not candidate.is_absolute():
        raise MediaAccessDeniedError("media path must be absolute")
    candidate = candidate.resolve()

    for root in roots:
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if not candidate.is_file():
            raise FileNotFoundError(candidate)
        return candidate

    raise MediaAccessDeniedError("media path is outside configured roots")

