import os
import random
import time

import duckdb
from duckdb import DuckDBPyConnection

DATA_DIR = os.getenv("DATA_DIR", "/data")

TXT_PATH = f"{DATA_DIR}/messages.txt"

DB_PATH = f"{DATA_DIR}/messages.db"
TABLE_NAME = "messages"

UDP_HOST_LISTEN = "0.0.0.0"
UDP_PORT_LISTEN = 12345


def duckdb_connect(db_path, max_retries=10, base_delay=0.5, read_only=False) -> DuckDBPyConnection:
    """Opens a DuckDB connection with retries and exponential backoff.

    This is to avoid problems when the lock on the DB is already held.

    Args:
        - db_path: Path to the DuckDB database file.
        - max_retries: Maximum number of retries before giving up.
        - base_delay: Initial delay in seconds, will be doubled on each retry.
        - read_only: Whether the connection to the DB should be read_only.

    Returns:
        - DuckDB connection object if successful.

    Raises:
        - duckdb.IOException if all retries fail.
    """
    attempt = 0

    while attempt < max_retries:
        try:
            return duckdb.connect(db_path, read_only=read_only)
        except duckdb.IOException as e:
            attempt += 1
            if attempt >= max_retries:
                raise e

            # Exponential backoff with jitter
            delay = base_delay * (2 ** (attempt - 1)) * random.uniform(0.8, 1.2)
            print(f"Connection attempt {attempt} to {db_path} failed. Retrying in {delay:.2f} seconds...")
            time.sleep(delay)
