-- Filter messages with valid lat/lon and non-negligible speed
WITH data_filtered AS (
    SELECT
        mmsi,
        ts,
        lon,
        lat
    FROM messages
    WHERE
        speed > 1
        AND lon BETWEEN -180 AND 180
        AND lat BETWEEN -90 AND 90
        {{ where_ts }}
),

-- Flag rows where a new trip starts.
-- We consider that a new trip starts when the timedelta between consecutive pings of a given ship is more than 1 hour.
time_differences AS (
    SELECT
        *,
        CASE
            WHEN
                LAG(ts) OVER (PARTITION BY mmsi ORDER BY ts) IS NULL
                OR ts - LAG(ts) OVER (PARTITION BY mmsi ORDER BY ts) > 3600
                THEN 1
            ELSE 0
        END AS new_trip
    FROM data_filtered
),

-- Assign trip identifiers
trip_groups AS (
    SELECT
        *,
        SUM(new_trip) OVER (PARTITION BY mmsi ORDER BY ts) AS trip_id
    FROM time_differences
),

-- Keep trips with at least 3 rows
filtered_trips AS (
    SELECT
        mmsi,
        trip_id
    FROM trip_groups
    GROUP BY mmsi, trip_id
    HAVING COUNT(*) >= 3
)

-- Join filtered trips back to trip_groups
SELECT
    g.mmsi,
    MIN(g.ts) AS min_ts,
    MAX(g.ts) - MIN(g.ts) AS duration
FROM trip_groups AS g
INNER JOIN filtered_trips AS f
    ON g.mmsi = f.mmsi AND g.trip_id = f.trip_id
GROUP BY g.mmsi, g.trip_id
ORDER BY min_ts DESC;
