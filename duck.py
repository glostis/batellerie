import duckdb
import pandas as pd
from pyais import NMEAMessage

parsed_messages = []
with open("./messages.txt") as f:
    for line in f:
        line = line.strip()
        ts, binary_message = line.split(" ")
        d = NMEAMessage.from_string(binary_message).decode().asdict()
        d["ts"] = int(ts)
        parsed_messages.append(d)
df = pd.DataFrame(parsed_messages)

conn = duckdb.connect("ais_data.db")  # Creates or connects to a DuckDB file
conn.execute("DROP TABLE IF EXISTS ais_messages")
conn.execute("CREATE TABLE IF NOT EXISTS ais_messages AS SELECT * FROM df")
