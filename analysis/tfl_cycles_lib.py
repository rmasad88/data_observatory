"""Reusable functions for loading, cleaning and aggregating TfL cycle hire
data."""

from pathlib import Path

import requests

# Large enough to keep the number of writes low, small enough to stay light
# on memory
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 60


def download_file(
    url: str, dest_dir: Path, filename: str | None = None
) -> Path:
    """Download a file to a local folder, skipping it if already cached.

    Parameters
    ----------
    url : str
        Remote location of the file.
    dest_dir : Path
        Folder to save the file in. Created if it does not exist.
    filename : str, optional
        Local filename to use. Defaults to the last part of the URL, which
        suits files like the journey CSVs but not API endpoints such as
        BikePoint that have no extension.

    Returns
    -------
    Path
        Location of the local file.

    Raises
    ------
    requests.HTTPError
        If the server responds with an error status.
    """
    dest = Path(dest_dir) / (filename or url.rstrip("/").split("/")[-1])
    if dest.exists():
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    # Download to a temporary name first so an interrupted transfer never
    # leaves a partial file that would be mistaken for a cached copy
    partial = dest.with_name(dest.name + ".part")

    # Stream in chunks so large CSVs are never held in memory all at once
    with requests.get(
        url, stream=True, timeout=DOWNLOAD_TIMEOUT_SECONDS
    ) as response:
        response.raise_for_status()
        with open(partial, "wb") as f:
            for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
                f.write(chunk)

    partial.rename(dest)
    return dest
