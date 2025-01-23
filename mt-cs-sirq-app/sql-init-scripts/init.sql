CREATE SCHEMA masterthesis_schema;
-------------------------------------------------------------------------------------------------
--------------------------------------- companies TABLE -----------------------------------------
CREATE TABLE masterthesis_schema.companies (
    company_id uuid PRIMARY KEY,
    company_name text UNIQUE
);
-------------------------------------------------------------------------------------------------
----------------------------------------- users TABLE -------------------------------------------
CREATE TABLE masterthesis_schema.users (
    company_id uuid REFERENCES masterthesis_schema.companies ON DELETE RESTRICT,
    uname text PRIMARY KEY,
    pwd text,
    active boolean
);
-------------------------------------------------------------------------------------------------
---------------------------------------- fleets TABLE -------------------------------------------
CREATE TABLE masterthesis_schema.fleets (
    license_plate text PRIMARY KEY,
    company_id uuid,
    active boolean
);
-------------------------------------------------------------------------------------------------
----------------------------------- charging_stations TABLE -----------------------------------------
CREATE TABLE masterthesis_schema.charging_stations (
    charging_station_id uuid PRIMARY KEY,
    charging_station_name text UNIQUE,
    total_charging_spots integer,
    max_reservation_spots integer,
    active boolean,
    CONSTRAINT max_smaller_than_total CHECK (max_reservation_spots <= total_charging_spots)
);
-------------------------------------------------------------------------------------------------
------------------------------------ reservations TABLE -----------------------------------------
CREATE TABLE masterthesis_schema.reservations (
    license_plate text REFERENCES masterthesis_schema.fleets ON DELETE CASCADE,
    charging_station_id uuid REFERENCES masterthesis_schema.charging_stations ON DELETE RESTRICT,
    start_ts timestamp,
    end_ts timestamp,
    PRIMARY KEY (license_plate, start_ts),
    CHECK (start_ts < end_ts)
);
-------------------------------------------------------------------------------------------------
-------------------------------------- chargers TABLE -------------------------------------------
CREATE TABLE masterthesis_schema.chargers (
    charger_id uuid,
    charging_station_id uuid REFERENCES masterthesis_schema.charging_stations ON DELETE RESTRICT,
    active boolean,
    PRIMARY KEY (charger_id, charging_station_id)
);
-------------------------------------------------------------------------------------------------
---------------------------------- charging_flows TABLE -----------------------------------------
CREATE TABLE masterthesis_schema.charging_flows (
    session_id uuid PRIMARY KEY,
    license_plate text,
    charging_station_id uuid REFERENCES masterthesis_schema.charging_stations ON DELETE RESTRICT,
    charger_id uuid,
    arrival_ts timestamp,
    spot_assignment_ts timestamp,
    charger_checkin_ts timestamp,
    start_charge_ts timestamp,
    end_charge_ts timestamp,
    departure_ts timestamp,
    FOREIGN KEY (charger_id, charging_station_id) REFERENCES masterthesis_schema.chargers (charger_id, charging_station_id) ON DELETE RESTRICT
);
-------------------------------------------------------------------------------------------------
-------------------------------------- auctions TYPE --------------------------------------------
CREATE TYPE auction_type AS ENUM ('SPOT', 'RESERVATION');
-------------------------------------------------------------------------------------------------
-------------------------------------- auctions TABLE -------------------------------------------
CREATE TABLE masterthesis_schema.auctions (
    auction_id uuid PRIMARY KEY,
    charging_station_id uuid REFERENCES masterthesis_schema.charging_stations ON DELETE RESTRICT,
    company_id uuid REFERENCES masterthesis_schema.companies ON DELETE RESTRICT,
    license_plate text,
    auction_start_ts timestamp,
    auction_end_ts timestamp,
    max_accepted_price numeric,
    auto_accept boolean,
    auction_type auction_type,
    winning_price numeric,
    auction_finished boolean
);
-------------------------------------------------------------------------------------------------
---------------------------------- spot_auction_offers TABLE ------------------------------------
CREATE TABLE masterthesis_schema.spot_auction_offers (
    auction_id uuid REFERENCES masterthesis_schema.auctions ON DELETE RESTRICT,
    company_id uuid,
    charging_station_id uuid,
    charger_id uuid,
    offer numeric,
    received_ts timestamp
);
-------------------------------------------------------------------------------------------------
------------------------------ reservation_auction_offers TABLE ---------------------------------
CREATE TABLE masterthesis_schema.reservation_auction_offers (
    auction_id uuid REFERENCES masterthesis_schema.auctions ON DELETE RESTRICT,
    charging_station_id uuid,
    company_id uuid,
    license_plate text,
    start_ts timestamp,
    end_ts timestamp,
    offer numeric,
    received_ts timestamp
);
-------------------------------------------------------------------------------------------------
--------------------------------- spot_assign_locks TABLE ---------------------------------------
CREATE TABLE masterthesis_schema.spot_assign_locks (
    charging_station_id uuid,
    charger_id uuid,
    license_plate text,
    lock_start_ts timestamp,
    lock_end_ts timestamp,
    auction_id uuid REFERENCES masterthesis_schema.auctions ON DELETE RESTRICT
);
-------------------------------------------------------------------------------------------------
----------------------------------- job_type TYPE -------------------------------------------
CREATE TYPE job_type AS ENUM (
    'AUCTIONS_SETTLING',
    'SPOT_ASSIGNMENT',
    'FLOW_ENFORCER'
);
-------------------------------------------------------------------------------------------------
----------------------------------- jobs TABLE ------------------------------------------
CREATE TABLE masterthesis_schema.jobs (
    execution_time timestamp,
    changes jsonb,
    job_type job_type
);
-------------------------------------------------------------------------------------------------
--------------------------------- reservation_count VIEW ----------------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_reservation_count AS (
        WITH rv_count AS (
            SELECT DISTINCT ON (start_ts) charging_station_id,
                start_ts,
                (
                    SELECT COUNT(1) AS rv_count
                    FROM masterthesis_schema.reservations AS rv
                    WHERE (
                            r.start_ts <= rv.start_ts
                            AND r.end_ts > rv.start_ts
                        )
                        OR (
                            r.start_ts >= rv.start_ts
                            AND r.end_ts <= rv.end_ts
                        )
                        AND r.charging_station_id = rv.charging_station_id
                        AND r.license_plate != rv.license_plate
                ) AS reservation_count
            FROM masterthesis_schema.reservations AS r
            UNION ALL
            SELECT DISTINCT ON (end_ts) charging_station_id,
                end_ts,
                (
                    SELECT COUNT(1) AS rv_count
                    FROM masterthesis_schema.reservations AS rv
                    WHERE r.end_ts > rv.start_ts
                        AND rv.end_ts > r.end_ts
                        AND r.charging_station_id = rv.charging_station_id
                        AND r.license_plate != rv.license_plate
                ) AS reservation_count
            FROM masterthesis_schema.reservations AS r
        )
        SELECT DISTINCT ON (start_ts) rc.charging_station_id,
            start_ts AS interval_timestamp,
            reservation_count,
            max_reservation_spots,
            CASE
                WHEN rc.reservation_count >= max_reservation_spots THEN TRUE
                ELSE FALSE
            END AS max_reservations_reached
        FROM rv_count AS rc
            LEFT JOIN masterthesis_schema.charging_stations AS cl ON cl.charging_station_id = rc.charging_station_id
    );
-------------------------------------------------------------------------------------------------
----------------------------------- spot_occupation VIEW ----------------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_spot_occupation AS (
        WITH reservations AS (
            SELECT charging_station_id,
                license_plate,
                start_ts AS reservation_start,
                end_ts AS reservation_end
            FROM masterthesis_schema.reservations
            WHERE CURRENT_TIMESTAMP BETWEEN start_ts - INTERVAL '${SPOT_ASSIGN_RESERVATION_LOOK_AHEAD} seconds'
                AND end_ts
        ),
        currently_charging AS (
            SELECT charging_station_id,
                license_plate,
                charger_id,
                spot_assignment_ts,
                start_charge_ts,
                end_charge_ts,
                departure_ts
            FROM masterthesis_schema.charging_flows
            WHERE departure_ts IS NULL
                AND end_charge_ts IS NULL
                AND (
                    spot_assignment_ts IS NOT NULL
                    OR (
                        start_charge_ts IS NOT NULL
                        AND start_charge_ts <= CURRENT_TIMESTAMP
                    )
                )
        )
        SELECT COALESCE(cc.charging_station_id, r.charging_station_id) AS charging_station_id,
            COALESCE(cc.license_plate, r.license_plate) AS license_plate,
            charger_id,
            total_charging_spots,
            reservation_start,
            reservation_end,
            spot_assignment_ts,
            start_charge_ts,
            end_charge_ts
        FROM reservations AS r
            FULL JOIN currently_charging AS cc ON cc.charging_station_id = r.charging_station_id
            LEFT JOIN masterthesis_schema.charging_stations AS cl ON cl.charging_station_id = COALESCE(cc.charging_station_id, r.charging_station_id)
    );
-------------------------------------------------------------------------------------------------
----------------------------------- available_spots VIEW ----------------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_available_spots AS (
        WITH chargers_ranking_for_reservations AS (
            SELECT charging_station_id,
                charger_id,
                ROW_NUMBER() OVER (PARTITION BY charging_station_id) AS charger_rank
            FROM masterthesis_schema.chargers AS c
            WHERE NOT EXISTS(
                    SELECT 1
                    FROM masterthesis_schema.spot_assign_locks AS sal
                    WHERE c.charger_id = sal.charger_id
                        AND c.charging_station_id = sal.charging_station_id
                        AND CURRENT_TIMESTAMP BETWEEN lock_start_ts AND lock_end_ts
                )
        ),
        spot_occupation_rank AS(
            SELECT charging_station_id,
                charger_id,
                ROW_NUMBER() OVER (PARTITION BY charging_station_id) as spot_occ_rank
            FROM masterthesis_schema.v_spot_occupation AS vso
        )
        SELECT charging_station_id,
            charger_id
        FROM chargers_ranking_for_reservations AS crfr
        WHERE NOT EXISTS(
                SELECT 1
                FROM spot_occupation_rank AS sor
                WHERE crfr.charger_rank = sor.spot_occ_rank
                    AND crfr.charging_station_id = sor.charging_station_id
            )
    );
-------------------------------------------------------------------------------------------------
------------------------------------------- queues VIEW -----------------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_queues AS (
        SELECT charging_station_id,
            session_id,
            arrival_ts,
            ROW_NUMBER() OVER (
                ORDER BY arrival_ts
            ) AS queue_position
        FROM masterthesis_schema.charging_flows
        WHERE arrival_ts IS NOT NULL
            AND spot_assignment_ts IS NULL
            AND departure_ts IS NULL
    );
-------------------------------------------------------------------------------------------------
---------------------------- occupied_spots_for_reservations VIEW -------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_occupied_spots_for_reservations AS (
        WITH exceeded_reservations AS(
            SELECT cf.charger_id,
                cf.charging_station_id,
                cf.session_id,
                CURRENT_TIMESTAMP - start_charge_ts AS elapsed_charging_time
            FROM masterthesis_schema.charging_flows AS cf
                JOIN masterthesis_schema.reservations AS r ON r.license_plate = cf.license_plate
                AND r.charging_station_id = cf.charging_station_id
            WHERE r.end_ts < CURRENT_TIMESTAMP
                AND cf.end_charge_ts IS NULL
        ),
        exceeded_minimum_charging_time AS(
            SELECT charger_id,
                cf.charging_station_id,
                cf.session_id,
                CURRENT_TIMESTAMP - start_charge_ts AS elapsed_charging_time
            FROM masterthesis_schema.charging_flows AS cf
            WHERE start_charge_ts + INTERVAL '${MINIMUM_CHARGING_TIME} seconds' < CURRENT_TIMESTAMP
                AND cf.end_charge_ts IS NULL
                AND NOT EXISTS (
                    SELECT 1
                    FROM masterthesis_schema.reservations AS r
                    WHERE license_plate = cf.license_plate
                        AND charging_station_id = cf.charging_station_id
                        AND CURRENT_TIMESTAMP BETWEEN start_ts - INTERVAL '${RESERVATION_EARLY_ARRIVAL_SLACK} seconds'
                        AND end_ts
                )
        )
        SELECT DISTINCT COALESCE(er.charger_id, emct.charger_id) AS charger_id,
            jl.charging_station_id,
            COALESCE(er.session_id, emct.session_id) AS session_id,
            GREATEST(
                er.elapsed_charging_time,
                emct.elapsed_charging_time
            ) AS elapsed_charging_time
        FROM exceeded_minimum_charging_time AS emct
            FULL JOIN exceeded_reservations AS er ON er.charger_id = emct.charger_id
            JOIN LATERAL (
                SELECT COALESCE(er.charging_station_id, emct.charging_station_id) AS charging_station_id
            ) AS jl ON TRUE
        ORDER BY jl.charging_station_id,
            elapsed_charging_time DESC
    );
-------------------------------------------------------------------------------------------------
------------------------------------- loose_flows VIEW ------------------------------------------
--------------------------------- Flows Refresher Clean up --------------------------------------
CREATE OR REPLACE VIEW masterthesis_schema.v_loose_flows AS (
        WITH never_checked_in_at_charger AS (
            SELECT *,
                'departure_ts' AS update_col
            FROM masterthesis_schema.charging_flows
            WHERE charger_checkin_ts IS NULL
                AND CURRENT_TIMESTAMP > (
                    spot_assignment_ts + INTERVAL '${MAXIMUM_CHECKIN_SLACK} seconds'
                )
                AND departure_ts IS NULL
        ),
        never_started_charging AS (
            SELECT *,
                'departure_ts' AS update_col
            FROM masterthesis_schema.charging_flows
            WHERE start_charge_ts IS NULL
                AND CURRENT_TIMESTAMP > (
                    charger_checkin_ts + INTERVAL '${MAXIMUM_START_CHARGING_SLACK} seconds'
                )
                AND departure_ts IS NULL
        ),
        exceeds_charging_interval AS (
            SELECT *,
                'end_charge_ts' AS update_col
            FROM masterthesis_schema.charging_flows
            WHERE end_charge_ts IS NULL
                AND CURRENT_TIMESTAMP > (
                    start_charge_ts + INTERVAL '${MAXIMUM_CHARGING_TIME} seconds'
                )
                AND end_charge_ts IS NULL
        ),
        never_departed AS (
            SELECT *,
                'departure_ts' AS update_col
            FROM masterthesis_schema.charging_flows
            WHERE departure_ts IS NULL
                AND CURRENT_TIMESTAMP > (
                    end_charge_ts + INTERVAL '${MAXIMUM_DEPARTURE_SLACK} seconds'
                )
                AND departure_ts IS NULL
        )
        SELECT *
        FROM never_checked_in_at_charger
        UNION ALL
        SELECT *
        FROM never_started_charging
        UNION ALL
        SELECT *
        FROM exceeds_charging_interval
        UNION ALL
        SELECT *
        FROM never_departed
    );
------------------------------------------ SAMPLE DATA ------------------------------------------
------------------------------------- ADMIN USER INSERTION --------------------------------------
INSERT INTO masterthesis_schema.companies (company_id, company_name)
VALUES (gen_random_uuid(), 'TheAdminCompanyInc.');
WITH ins_adm AS (
    SELECT company_id,
        '${ADMIN_USER}',
        '${ADMIN_PASSWORD}',
        TRUE
    FROM masterthesis_schema.companies
    WHERE company_name = 'TheAdminCompanyInc.'
)
INSERT INTO masterthesis_schema.users (company_id, uname, pwd, active)
SELECT *
FROM ins_adm;
-------------------------------------------------------------------------------------------------
------------------------------------- INFRA USER INSERTION --------------------------------------
INSERT INTO masterthesis_schema.companies (company_id, company_name)
VALUES (
        gen_random_uuid(),
        'ChargingStationInfrastructureInc.'
    );
WITH ins_infra AS (
    SELECT company_id,
        '${INFRASTRUCTURE_USER}',
        '${INFRASTRUCTURE_PASSWORD}',
        TRUE
    FROM masterthesis_schema.companies
    WHERE company_name = 'ChargingStationInfrastructureInc.'
)
INSERT INTO masterthesis_schema.users (company_id, uname, pwd, active)
SELECT *
FROM ins_infra;