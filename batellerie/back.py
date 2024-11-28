import os
import sys
from pathlib import Path
from time import sleep, time

import duckdb
import pandas as pd
from pyais import NMEAMessage
from pyais.stream import UDPReceiver

from batellerie import DB_PATH, TABLE_NAME, TXT_PATH, UDP_HOST_LISTEN, UDP_PORT_LISTEN


def _reverse_readline(filename, buf_size=8192):
    """A generator that returns the lines of a file in reverse order.

    Taken from https://stackoverflow.com/a/23646049
    """
    with open(filename, "rb") as fh:
        segment = None
        offset = 0
        fh.seek(0, os.SEEK_END)
        file_size = remaining_size = fh.tell()
        while remaining_size > 0:
            offset = min(file_size, offset + buf_size)
            fh.seek(file_size - offset)
            buffer = fh.read(min(remaining_size, buf_size))
            # remove file's last "\n" if it exists, only for the first buffer
            if remaining_size == file_size and buffer[-1] == ord("\n"):
                buffer = buffer[:-1]
            remaining_size -= buf_size
            lines = buffer.split("\n".encode())
            # append last chunk's segment to this chunk's last line
            if segment is not None:
                lines[-1] += segment
            segment = lines[0]
            lines = lines[1:]
            # yield lines in this chunk except the segment
            for line in reversed(lines):
                # only decode on a parsed line, to avoid utf-8 decode error
                yield line.decode()
        # Don't yield None if the file was empty
        if segment is not None:
            yield segment.decode()


def store():
    p = Path(TXT_PATH)
    p.touch()

    try:
        last_line = next(_reverse_readline(p))
        last_id = int(last_line.split(" ")[0])
    except StopIteration:  # The file is empty, we are starting from scratch
        last_id = 0
    current_id = last_id + 1

    print("Streaming messages...")
    for msg in UDPReceiver(UDP_HOST_LISTEN, UDP_PORT_LISTEN):
        with open(p, "a") as f:
            f.write(f"{current_id} {int(time())} {msg.raw}\n")
        current_id += 1


def sync():
    p = Path(TXT_PATH)

    with duckdb.connect(DB_PATH) as con:
        con.execute(f"""
            CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
                id UBIGINT,
                msg_type UTINYINT,
                repeat UTINYINT,
                mmsi VARCHAR, -- Storing as varchar instead of integer, as it could include leading zeroes
                status UTINYINT,
                turn TINYINT,
                speed DECIMAL(4, 1), -- max speed is 102.2 (and 102.3 which means unavailable)
                accuracy BOOLEAN,
                lon DOUBLE,
                lat DOUBLE,
                course DECIMAL(4, 1),
                heading DECIMAL(4, 1),
                second UTINYINT,
                maneuver UTINYINT,
                raim BOOLEAN,
                radio INTEGER,
                ts UBIGINT,
                year USMALLINT,
                month UTINYINT,
                day UTINYINT,
                hour UTINYINT,
                minute UTINYINT,
                epfd TINYINT,
                seqno TINYINT,
                dest_mmsi VARCHAR,
                retransmit BOOLEAN,
                dac USMALLINT,
                fid USMALLINT,
                ais_version UTINYINT,
                imo VARCHAR,
                callsign VARCHAR,
                shipname VARCHAR,
                ship_type UTINYINT,
                to_bow SMALLINT,
                to_stern SMALLINT,
                to_port SMALLINT,
                to_starboard SMALLINT,
                draught DOUBLE,
                destination VARCHAR,
                dte BOOLEAN,
                mmsi1 VARCHAR,
                mmsiseq1 UTINYINT,
                mmsi2 VARCHAR,
                mmsiseq2 UTINYINT,
                mmsi3 VARCHAR,
                mmsiseq3 UTINYINT,
                mmsi4 VARCHAR,
                mmsiseq4 UTINYINT,
                partno UTINYINT,
                reserved_1 UTINYINT,
                reserved_2 UTINYINT,
                cs BOOLEAN,
                display BOOLEAN,
                dsc BOOLEAN,
                band BOOLEAN,
                msg22 BOOLEAN,
                assigned BOOLEAN,
                vendorid VARCHAR,
                model UTINYINT,
                serial INTEGER,
                text VARCHAR
            )
            """)

    while True:
        with duckdb.connect(DB_PATH) as con:
            max_id = con.execute(f"SELECT MAX(id) FROM {TABLE_NAME}").fetchone()[0] or 0
        parsed_messages = []
        for line in _reverse_readline(p):
            line = line.strip()
            id_, ts, binary_message = line.split(" ")
            id_ = int(id_)
            if id_ > max_id:
                d = NMEAMessage.from_string(nmea_str=binary_message).decode().asdict()
                d["ts"] = int(ts)
                d["id"] = id_
                d.pop("spare_1", None)
                d.pop("data", None)
                parsed_messages.append(d)
            else:
                break

        if parsed_messages:
            df = pd.DataFrame(parsed_messages)
            print(f"Inserting {len(df)} rows")
            with duckdb.connect(DB_PATH) as con:
                con.execute(f"INSERT INTO {TABLE_NAME} BY NAME SELECT * FROM df")

        sleep(30)


if __name__ == "__main__":
    command = sys.argv[-1]
    if command == "store":
        store()
    elif command == "sync":
        sync()
    else:
        raise ValueError(f"Unknown command {command}")
