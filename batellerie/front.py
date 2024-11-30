import json
import os

import pandas as pd
from flask import Flask, Response, render_template, request
from pyais.constants import NavigationStatus, ShipType

from batellerie import DB_PATH, TABLE_NAME, duckdb_connect

app = Flask(__name__)

STATIC_MMSIS = (
    "226015750",  # STATION FLUV GUERDIN
    "2268206",  # Clairoix antenna
)


def fetch_all_the_things(ts_max: str | None = None, ts_delta_minutes: int = 15):
    """Fetch the required data (positions, tracks, shipnames) from the database.

    Args:
        - ts_max: The maximum timestamp until which positions and tracks are taken.
            If None is given, will take the most recent.
        - ts_delta_minutes: The timedelta before `ts_max` until which latest positions and tracks are taken.
    """
    con = duckdb_connect(DB_PATH, read_only=True)

    if ts_max is None:
        query_tracks = f"SELECT MAX(ts) FROM {TABLE_NAME}"
        ts_max = con.execute(query_tracks).fetchone()[0]

    valid_latlon = "lat IS NOT NULL AND lon IS NOT NULL AND lat < 90 AND lat > -90 AND lon < 180 AND lon > -180"

    # Fetch latest positions
    # https://duckdb.org/docs/sql/query_syntax/select.html#distinct-on-clause
    # The first 3 digits of the MMSI are the Maritime Identification Digits, which give the country
    # of registration of the ship (https://www.itu.int/en/itu-r/terrestrial/fmd/pages/mid.aspx)
    query_positions = f"""
        SELECT DISTINCT ON (mmsi) mmsi, ts, lat, lon, course, speed, status, substr(mmsi, 1, 3) as mid
        FROM {TABLE_NAME}
        WHERE
            {valid_latlon}
            AND ts::int >= {ts_max} - {ts_delta_minutes * 60}
            AND ts::int <= {ts_max}
        ORDER BY mmsi, ts DESC;
    """
    latest_positions = pd.read_sql(query_positions, con)
    latest_positions["status"] = latest_positions.status.apply(lambda status: NavigationStatus.from_value(status).name)

    # Fetch ship names
    query_shipnames = f"""
        SELECT DISTINCT ON (mmsi) mmsi, shipname, ship_type
        FROM {TABLE_NAME}
        WHERE
        shipname IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    shipnames = pd.read_sql(query_shipnames, con)
    shipnames["ship_type"] = shipnames.ship_type.apply(
        lambda status: ShipType.from_value(status).name.replace("_NoAdditionalInformation", "").replace("_", " ")
    )

    # Remove shipname from persistent static emitters
    for mmsi in STATIC_MMSIS:
        shipnames.loc[shipnames.mmsi == mmsi, "shipname"] = None

    # Fetch ship dimensions
    query_dimensions = f"""
        SELECT DISTINCT ON (mmsi) mmsi, to_bow + to_stern as length, to_port + to_starboard as width
        FROM {TABLE_NAME}
        WHERE
        to_bow IS NOT NULL AND
        to_stern IS NOT NULL AND
        to_port IS NOT NULL AND
        to_starboard IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    dimensions = pd.read_sql(query_dimensions, con)

    # Fetch ship names
    query_destinations = f"""
        SELECT DISTINCT ON (mmsi) mmsi, destination, ts as destination_ts
        FROM {TABLE_NAME}
        WHERE
        destination IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    destinations = pd.read_sql(query_destinations, con)

    # Merge ship names into the positions DataFrame
    latest_positions = (
        latest_positions.merge(shipnames, on="mmsi", how="left")
        .merge(dimensions, on="mmsi", how="left")
        .merge(destinations, on="mmsi", how="left")
    )

    # Fetch past positions of the ships
    query_tracks = f"""
        SELECT
            mmsi,
            ts,
            lat,
            lon
        FROM
            {TABLE_NAME}
        WHERE
            {valid_latlon}
            AND ts::int >= {ts_max} - {ts_delta_minutes * 60}
            AND ts::int <= {ts_max}
            AND mmsi NOT IN {STATIC_MMSIS}
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
        "latestTs": ts_max,
    }


@app.route("/data")
def data() -> Response:
    ts_max = request.args.get("tsMax", None)
    ts_delta_minutes = int(request.args.get("tsDeltaMinutes", 15))
    return Response(json.dumps(fetch_all_the_things(ts_max, ts_delta_minutes)), mimetype="application/json")


@app.route("/")
def index():
    return render_template("index.html")  # Serve the map frontend


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=bool(os.getenv("DEBUG", False)))
