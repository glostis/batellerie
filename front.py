import json

import duckdb
import pandas as pd
from flask import Flask, Response, render_template
from pyais.constants import NavigationStatus

app = Flask(__name__)


def fetch_all_the_things(ts_delta_minutes=15):
    con = duckdb.connect("messages.db", read_only=True)

    query_tracks = "SELECT MAX(ts) FROM messages"
    max_ts = con.execute(query_tracks).fetchone()[0]

    valid_latlon = "lat IS NOT NULL AND lon IS NOT NULL AND lat < 90 AND lat > -90 AND lon < 180 AND lon > -180"

    # https://duckdb.org/docs/sql/query_syntax/select.html#distinct-on-clause
    # Fetch all latest positions
    query_positions = f"""
        SELECT DISTINCT ON (mmsi) mmsi, ts, lat, lon, course, speed, status
        FROM messages
        WHERE
            {valid_latlon}
            AND ts::int >= {max_ts} - {ts_delta_minutes * 60}
        ORDER BY mmsi, ts DESC;
    """
    latest_positions = pd.read_sql(query_positions, con)
    latest_positions["status"] = latest_positions.status.apply(lambda status: NavigationStatus.from_value(status).name)

    # Fetch all ship names in bulk
    query_shipnames = """
        SELECT DISTINCT ON (mmsi) mmsi, shipname
        FROM messages
        WHERE
        shipname IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    shipnames = pd.read_sql(query_shipnames, con)

    # Remove shipname from persistent static emitter STATION FLUV GUERDIN
    shipnames.loc[shipnames.mmsi == '226015750', 'shipname'] = None

    # Merge ship names into the positions DataFrame
    latest_positions = latest_positions.merge(shipnames, on="mmsi", how="left")

    # Fetch past positions of the ships
    query_tracks = f"""
        SELECT
            mmsi,
            ts,
            lat,
            lon
        FROM
            messages
        WHERE
            {valid_latlon}
            AND ts::int >= {max_ts} - {ts_delta_minutes * 60}
        ORDER BY
            ts DESC;
    """
    latest_tracks = (
        pd.read_sql(query_tracks, con)
        .groupby("mmsi")
        .apply(lambda group: list(zip(group["lat"], group["lon"])))
        .to_json()
    )
    return {
        "positions": json.loads(latest_positions.to_json(orient="records")),
        "tracks": json.loads(latest_tracks),
        "latestTs": max_ts,
    }


@app.route("/data")
def data() -> Response:
    return Response(json.dumps(fetch_all_the_things()), mimetype="application/json")


@app.route("/")
def index():
    return render_template("index.html")  # Serve the map frontend


if __name__ == "__main__":
    app.run(host="0.0.0.0")
