import json
import os
from datetime import datetime
from pathlib import Path

import altair as alt
import pandas as pd
from flask import Flask, Response, redirect, render_template, request
from jinja2 import Template
from pyais.constants import NavigationStatus, ShipType

from batellerie import DB_PATH, TABLE_NAME, duckdb_connect

current_path = Path(__file__).parent

app = Flask(__name__)

STATIC_MMSIS = (
    "226015750",  # STATION FLUV GUERDIN
    "2268206",  # Clairoix antenna
)


def get_ships_static_data(con):
    # Fetch ship names
    query_shipnames = f"""
        SELECT DISTINCT ON (mmsi) mmsi, shipname, ship_type
        FROM {TABLE_NAME}
        WHERE
        shipname IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    shipnames = con.sql(query_shipnames).df()
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
    dimensions = con.sql(query_dimensions).df()
    return shipnames.merge(dimensions, on="mmsi", how="left")


def fetch_all_the_things(ts_max: str | None = None, ts_min: str | None = None):
    """Fetch the required data (positions, tracks, shipnames) from the database.

    Args:
        - ts_max: The maximum timestamp until which positions and tracks are taken.
            If None is given, will take the timestamp of the most recent record in the DB.
        - ts_min: Same as `ts_max`, but minimum.
            If None is given, will take 15 minutes before `ts_max` (or 15 minutes before the most recent timestamp).
    """
    con = duckdb_connect(DB_PATH, read_only=True)

    if ts_max is None:
        query_ts_max = f"SELECT MAX(ts) FROM {TABLE_NAME}"
        res = con.execute(query_ts_max).fetchone()
        if not res:
            raise ValueError("The database is empty")
        ts_max: str = res[0]

    if ts_min is None:
        ts_min = str(int(ts_max) - 15 * 60)

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
            AND ts::int >= {ts_min}
            AND ts::int <= {ts_max}
        ORDER BY mmsi, ts DESC;
    """
    latest_positions = con.sql(query_positions).df()

    def _status_name(status_code):
        try:
            NavigationStatus.from_value(status_code).name
        except AttributeError:
            return "Undefined"

    latest_positions["status"] = latest_positions.status.apply(_status_name)

    # Fetch ship destinations
    query_destinations = f"""
        SELECT DISTINCT ON (mmsi) mmsi, destination, ts as destination_ts
        FROM {TABLE_NAME}
        WHERE
        destination IS NOT NULL
        ORDER BY mmsi, ts DESC;
    """
    destinations = con.sql(query_destinations).df()

    ships_static = get_ships_static_data(con)

    latest_positions = latest_positions.merge(ships_static, on="mmsi", how="left").merge(
        destinations, on="mmsi", how="left"
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
            AND ts::int >= {ts_min}
            AND ts::int <= {ts_max}
            AND mmsi NOT IN {STATIC_MMSIS}
        ORDER BY
            ts DESC;
    """
    latest_tracks = (
        con.sql(query_tracks)
        .df()
        .groupby("mmsi")
        .apply(lambda group: list(zip(group["lat"], group["lon"], group["ts"])), include_groups=False)
        .to_json()
    )
    return {
        "positions": json.loads(latest_positions.to_json(orient="records")),
        "tracks": json.loads(latest_tracks),
        "tsMax": ts_max,
        "tsMin": ts_min,
    }


@app.route("/data/map")
def data() -> Response:
    ts_max = request.args.get("tsMax", None)
    ts_min = request.args.get("tsMin", None)
    return Response(json.dumps(fetch_all_the_things(ts_max, ts_min)), mimetype="application/json")


def _get_trips(ts_min: str | None = None, ts_max: str | None = None):
    con = duckdb_connect(DB_PATH, read_only=True)
    sql_template = (current_path / "queries" / "trips.sql").read_text()

    template = Template(sql_template)
    where_ts = ""
    if ts_min:
        where_ts += f"AND ts >= {ts_min}"
    if ts_max:
        where_ts += f"AND ts <= {ts_max}"
    query = template.render(where_ts=where_ts)

    df = con.sql(query).df()
    df = df.merge(get_ships_static_data(con), on="mmsi", how="left")
    return df


@app.route("/data/trips")
def get_trips():
    ts_min = request.args.get("tsMin", None)
    ts_max = request.args.get("tsMax", None)
    return Response(_get_trips(ts_min, ts_max).to_json(orient="records"), mimetype="application/json")


@app.route("/")
def index():
    return redirect("/map")


@app.route("/map")
def map():
    return render_template("map.html")


# Sample data for the chart
def create_chart():
    data = pd.DataFrame({"x": list(range(1, 11)), "y": [3, 8, 4, 5, 6, 7, 9, 3, 6, 8]})

    # Create an interactive Altair chart
    chart = alt.Chart(data).mark_line().encode(x="x", y="y", tooltip=["x", "y"]).interactive()

    return chart.to_json()


def get_totals():
    con = duckdb_connect(DB_PATH, read_only=True)

    now_epoch = int(datetime.now().timestamp())
    time_ranges = {
        "Past 24 Hours": now_epoch - 24 * 3600,
        "Past Week": now_epoch - 7 * 24 * 3600,
        "Past 30 Days": now_epoch - 30 * 24 * 3600,
        "All Time": None,
    }

    totals = []

    for label, start_time in time_ranges.items():
        query = """
            SELECT
                COUNT(DISTINCT mmsi) AS nb_ships,
                COUNT(*) AS nb_messages
            FROM messages
            """
        if start_time:
            query += f"WHERE ts >= '{start_time}'"

        result = con.sql(query).df().iloc[0]
        trips = _get_trips(ts_min=start_time)
        totals.append(
            {
                "time_range": label,
                "nb_ships": result["nb_ships"],
                "nb_trips": len(trips),
                "nb_messages": result["nb_messages"],
            }
        )

    return totals


@app.template_filter("format_number")
def format_number(value):
    return "{:,}".replace(",", " ").format(value)


@app.route("/stats")
def stats():
    chart_json = create_chart()
    totals = get_totals()
    return render_template(
        "stats.html",
        chart_json=chart_json,
        totals=totals,
    )


@app.route("/trips")
def trips():
    return render_template("trips.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=bool(os.getenv("DEBUG", False)))
