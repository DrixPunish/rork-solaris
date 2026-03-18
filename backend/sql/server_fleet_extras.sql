-- =============================================================
-- SERVER-SIDE FLEET & EXTRAS RPC FUNCTIONS
-- Run in Supabase SQL Editor AFTER rpc_functions.sql
-- AND AFTER resource_security.sql
-- =============================================================

-- =============================================================
-- 0. SCHEMA ADDITIONS: mission_phase + completed_at
-- =============================================================
-- mission_phase tracks the lifecycle independently of the
-- legacy 'status' column to avoid race conditions between
-- processArrivedFleets and processReturningFleets.
--
-- Values:
--   en_route   -> fleet is traveling to target
--   arrived    -> fleet arrived, mission being processed
--   returning  -> fleet heading back to sender planet
--   completed  -> fleet returned, ships/resources restored
-- =============================================================
ALTER TABLE fleet_missions
  ADD COLUMN IF NOT EXISTS mission_phase text DEFAULT 'en_route';

ALTER TABLE fleet_missions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL;

-- Constraint (idempotent via DO block)
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_mission_phase'
  ) THEN
    ALTER TABLE fleet_missions
      ADD CONSTRAINT chk_mission_phase
      CHECK (mission_phase IN ('en_route','arrived','returning','completed'));
  END IF;
END $;

-- Index for the world tick query
CREATE INDEX IF NOT EXISTS idx_fleet_missions_phase_return
  ON fleet_missions (mission_phase, return_time)
  WHERE mission_phase = 'returning';

CREATE INDEX IF NOT EXISTS idx_fleet_missions_phase_arrival
  ON fleet_missions (mission_phase, arrival_time)
  WHERE mission_phase = 'en_route';

-- Migration: backfill existing rows
UPDATE fleet_missions SET mission_phase = 'completed'
  WHERE status = 'completed' AND mission_phase = 'en_route';
UPDATE fleet_missions SET mission_phase = 'returning'
  WHERE status = 'returning' AND mission_phase = 'en_route';
UPDATE fleet_missions SET mission_phase = 'arrived'
  WHERE status = 'arrived' AND mission_phase = 'en_route';

-- =============================================================
-- 1. rpc_calculate_flight_time (SERVER-SIDE)
-- =============================================================
-- Calcule le temps de vol 100% serveur en utilisant ship_defs
-- et les recherches du joueur. Le client n'envoie JAMAIS de
-- temps de vol calcule.
--
-- Formule distance (type OGame):
--   galaxies differentes: 20000 * |g1-g2|
--   systemes differents:  2700 + 95 * |s1-s2|
--   positions differentes: 1000 + 5 * |p1-p2|
--
-- Formule temps:
--   time = max(30, round(10 + 3500 * sqrt(distance*10/speed) / speed * 10))
--
-- SECURITE:
-- - Lecture seule, pas d'effet de bord
-- - Utilise ship_defs (source de verite) pour les vitesses
-- - Utilise player_research pour les bonus de propulsion
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_calculate_flight_time(
  p_sender_coords jsonb,
  p_target_coords jsonb,
  p_fleet_ships jsonb,
  p_user_id uuid
) RETURNS json AS $fn$
DECLARE
  v_g1 int; v_s1 int; v_p1 int;
  v_g2 int; v_s2 int; v_p2 int;
  v_distance double precision;
  v_ship_key text;
  v_ship_val jsonb;
  v_ship_qty int;
  v_base_speed double precision;
  v_ship_speed double precision;
  v_slowest_speed double precision := 999999999;
  v_has_ships boolean := false;
  v_chemical_level int := 0;
  v_impulse_level int := 0;
  v_void_level int := 0;
  v_drive_type text;
  v_bonus double precision;
  v_flight_time_sec int;
  v_base_drive text;
BEGIN
  v_g1 := (p_sender_coords->>0)::int;
  v_s1 := (p_sender_coords->>1)::int;
  v_p1 := (p_sender_coords->>2)::int;
  v_g2 := (p_target_coords->>0)::int;
  v_s2 := (p_target_coords->>1)::int;
  v_p2 := (p_target_coords->>2)::int;

  IF v_g1 != v_g2 THEN
    v_distance := 20000.0 * ABS(v_g1 - v_g2);
  ELSIF v_s1 != v_s2 THEN
    v_distance := 2700.0 + 95.0 * ABS(v_s1 - v_s2);
  ELSE
    v_distance := 1000.0 + 5.0 * ABS(v_p1 - v_p2);
  END IF;

  SELECT
    COALESCE(MAX(CASE WHEN research_id = 'chemicalDrive' THEN level END), 0),
    COALESCE(MAX(CASE WHEN research_id = 'impulseReactor' THEN level END), 0),
    COALESCE(MAX(CASE WHEN research_id = 'voidDrive' THEN level END), 0)
  INTO v_chemical_level, v_impulse_level, v_void_level
  FROM player_research
  WHERE user_id = p_user_id
    AND research_id IN ('chemicalDrive', 'impulseReactor', 'voidDrive');

  FOR v_ship_key, v_ship_val IN SELECT * FROM jsonb_each(p_fleet_ships)
  LOOP
    v_ship_qty := (v_ship_val #>> '{}')::int;
    IF v_ship_qty IS NULL OR v_ship_qty <= 0 THEN CONTINUE; END IF;
    v_has_ships := true;

    SELECT base_speed INTO v_base_speed
    FROM ship_defs WHERE ship_id = v_ship_key;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_base_drive := CASE v_ship_key
      WHEN 'novaScout' THEN 'chemical'
      WHEN 'atlasCargo' THEN 'chemical'
      WHEN 'atlasCargoXL' THEN 'chemical'
      WHEN 'mantaRecup' THEN 'chemical'
      WHEN 'spectreSonde' THEN 'chemical'
      WHEN 'heliosRemorqueur' THEN 'chemical'
      WHEN 'ferDeLance' THEN 'impulse'
      WHEN 'cyclone' THEN 'impulse'
      WHEN 'pyro' THEN 'impulse'
      WHEN 'colonyShip' THEN 'impulse'
      WHEN 'bastion' THEN 'void'
      WHEN 'nemesis' THEN 'void'
      WHEN 'fulgurant' THEN 'void'
      WHEN 'titanAstral' THEN 'void'
      ELSE 'chemical'
    END;

    v_drive_type := v_base_drive;
    IF v_ship_key = 'atlasCargo' AND v_impulse_level >= 5 THEN
      v_drive_type := 'impulse';
    ELSIF v_ship_key = 'mantaRecup' THEN
      IF v_void_level >= 15 THEN v_drive_type := 'void';
      ELSIF v_impulse_level >= 17 THEN v_drive_type := 'impulse';
      END IF;
    ELSIF v_ship_key = 'pyro' AND v_void_level >= 8 THEN
      v_drive_type := 'void';
    END IF;

    CASE v_drive_type
      WHEN 'chemical' THEN v_bonus := v_chemical_level * 0.10;
      WHEN 'impulse' THEN v_bonus := v_impulse_level * 0.20;
      WHEN 'void' THEN v_bonus := v_void_level * 0.30;
      ELSE v_bonus := 0;
    END CASE;

    v_ship_speed := FLOOR(v_base_speed * (1.0 + v_bonus));

    IF v_ship_speed > 0 AND v_ship_speed < v_slowest_speed THEN
      v_slowest_speed := v_ship_speed;
    END IF;
  END LOOP;

  IF NOT v_has_ships THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No ships in fleet'
    );
  END IF;

  IF v_slowest_speed <= 0 OR v_slowest_speed >= 999999999 THEN
    v_slowest_speed := 1000;
  END IF;

  v_flight_time_sec := GREATEST(30, ROUND(10 + 3500.0 * SQRT(v_distance * 10.0 / v_slowest_speed) / v_slowest_speed * 10.0));

  RETURN json_build_object(
    'success', true,
    'distance', v_distance,
    'slowest_speed', v_slowest_speed,
    'chemical_level', v_chemical_level,
    'impulse_level', v_impulse_level,
    'void_level', v_void_level,
    'flight_time_sec', v_flight_time_sec,
    'return_time_sec', v_flight_time_sec
  );
END;
$fn$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================
-- 2. rpc_send_fleet (SECURED)
-- =============================================================
-- Deduit atomiquement les vaisseaux et ressources cargo
-- lors de l'envoi d'une flotte.
--
-- SECURITE:
-- - SELECT ... FOR UPDATE sur planet_ships (deja present)
-- - SELECT ... FOR UPDATE sur planet_resources avant deduction cargo
-- - Met a jour planets.last_update dans la meme transaction
-- - Ne doit jamais recevoir de valeurs calculees par le client
--   pour les couts; ici on deduit des quantites absolues.
-- - Doit etre appelee dans un contexte authentifie
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_send_fleet(
  p_planet_id uuid,
  p_ships jsonb,
  p_cargo_fer double precision DEFAULT 0,
  p_cargo_silice double precision DEFAULT 0,
  p_cargo_xenogas double precision DEFAULT 0,
  p_sender_coords jsonb DEFAULT NULL,
  p_target_coords jsonb DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS json AS $
DECLARE
  v_key text;
  v_val jsonb;
  v_ship_qty integer;
  v_current_qty integer;
  v_res record;
  v_now bigint;
  v_flight_result json;
  v_flight_time_sec int;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF p_sender_coords IS NOT NULL AND p_target_coords IS NOT NULL AND p_user_id IS NOT NULL THEN
    v_flight_result := rpc_calculate_flight_time(p_sender_coords, p_target_coords, p_ships, p_user_id);
    IF NOT (v_flight_result->>'success')::boolean THEN
      RETURN json_build_object('success', false, 'error', v_flight_result->>'error');
    END IF;
    v_flight_time_sec := (v_flight_result->>'flight_time_sec')::int;
  END IF;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_ships)
  LOOP
    v_ship_qty := (v_val::text)::integer;
    IF v_ship_qty <= 0 THEN CONTINUE; END IF;

    SELECT quantity INTO v_current_qty
    FROM planet_ships
    WHERE planet_id = p_planet_id AND ship_id = v_key
    FOR UPDATE;

    IF v_current_qty IS NULL OR v_current_qty < v_ship_qty THEN
      RETURN json_build_object('success', false, 'error', 'Vaisseaux insuffisants: ' || v_key);
    END IF;

    UPDATE planet_ships
    SET quantity = quantity - v_ship_qty
    WHERE planet_id = p_planet_id AND ship_id = v_key;
  END LOOP;

  IF p_cargo_fer > 0 OR p_cargo_silice > 0 OR p_cargo_xenogas > 0 THEN
    PERFORM set_resource_tx_context('fleet_send', 'cargo_deduction');

    SELECT fer, silice, xenogas INTO v_res
    FROM planet_resources
    WHERE planet_id = p_planet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'Planet resources not found');
    END IF;

    IF v_res.fer < p_cargo_fer OR v_res.silice < p_cargo_silice OR v_res.xenogas < p_cargo_xenogas THEN
      RETURN json_build_object('success', false, 'error', 'Ressources insuffisantes pour le cargo');
    END IF;

    UPDATE planet_resources
    SET fer = GREATEST(0, v_res.fer - p_cargo_fer),
        silice = GREATEST(0, v_res.silice - p_cargo_silice),
        xenogas = GREATEST(0, v_res.xenogas - p_cargo_xenogas)
    WHERE planet_id = p_planet_id;
  END IF;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  IF v_flight_time_sec IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'flight_time_sec', v_flight_time_sec,
      'departure_time', v_now,
      'arrival_time', v_now + (v_flight_time_sec::bigint * 1000),
      'return_time', v_now + (v_flight_time_sec::bigint * 2000)
    );
  END IF;

  RETURN json_build_object('success', true);
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 3. rpc_claim_tutorial_reward (SECURED)
-- =============================================================
-- Ajoute atomiquement une recompense de tutoriel (ressources
-- ou solar) au joueur.
--
-- SECURITE:
-- - assert_planet_owner verifie la propriete de la planete
-- - SELECT ... FOR UPDATE sur planet_resources avant ajout
-- - SELECT ... FOR UPDATE sur players avant ajout de solar
-- - Transaction context tagge avec step_id pour audit
-- - Doit etre appelee dans un contexte authentifie
-- - Les valeurs de recompense proviennent du client mais sont
--   validees par le systeme de tutoriel (claimed_rewards)
--
-- IMPORTANT: Si vous avez un doublon de cette fonction dans
-- Supabase, executez d'abord:
--   DROP FUNCTION IF EXISTS rpc_claim_tutorial_reward(uuid, uuid, text, double precision, double precision, double precision, double precision);
-- =============================================================
DROP FUNCTION IF EXISTS rpc_claim_tutorial_reward(uuid, uuid, text, double precision, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION rpc_claim_tutorial_reward(
  p_user_id uuid,
  p_planet_id uuid,
  p_step_id text,
  p_reward_type text,
  p_fer double precision DEFAULT 0,
  p_silice double precision DEFAULT 0,
  p_xenogas double precision DEFAULT 0,
  p_solar double precision DEFAULT 0
) RETURNS json AS $
DECLARE
  v_new_solar double precision;
  v_res record;
  v_new_fer double precision;
  v_new_silice double precision;
  v_new_xenogas double precision;
BEGIN
  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  RAISE NOTICE '[rpc_claim_tutorial_reward] user=%, planet=%, step=%, type=%', p_user_id, p_planet_id, p_step_id, p_reward_type;

  IF p_reward_type = 'resources' THEN
    PERFORM set_resource_tx_context('tutorial_claim', 'claim_step_' || p_step_id);

    SELECT fer, silice, xenogas INTO v_res
    FROM planet_resources
    WHERE planet_id = p_planet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'Planet resources not found');
    END IF;

    v_new_fer := COALESCE(v_res.fer, 0) + GREATEST(0, p_fer);
    v_new_silice := COALESCE(v_res.silice, 0) + GREATEST(0, p_silice);
    v_new_xenogas := COALESCE(v_res.xenogas, 0) + GREATEST(0, p_xenogas);

    RAISE NOTICE '[rpc_claim_tutorial_reward] Adding resources to planet %: fer=% silice=% xenogas=%', p_planet_id, p_fer, p_silice, p_xenogas;

    UPDATE planet_resources
    SET fer = v_new_fer,
        silice = v_new_silice,
        xenogas = v_new_xenogas
    WHERE planet_id = p_planet_id;

    RETURN json_build_object(
      'success', true,
      'resources', json_build_object('fer', v_new_fer, 'silice', v_new_silice, 'xenogas', v_new_xenogas)
    );

  ELSIF p_reward_type = 'solar' THEN
    SELECT solar INTO v_new_solar
    FROM players
    WHERE user_id = p_user_id
    FOR UPDATE;

    UPDATE players
    SET solar = COALESCE(v_new_solar, 0) + GREATEST(0, p_solar)
    WHERE user_id = p_user_id
    RETURNING solar INTO v_new_solar;

    RAISE NOTICE '[rpc_claim_tutorial_reward] Added solar for user %: new_solar=%', p_user_id, v_new_solar;

    RETURN json_build_object('success', true, 'solar', v_new_solar);
  END IF;

  RETURN json_build_object('success', false, 'error', 'Unknown reward type');
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Add production_percentages column to planets table
ALTER TABLE planets ADD COLUMN IF NOT EXISTS production_percentages jsonb DEFAULT NULL;

-- =============================================================
-- 5. rpc_process_fleet_returns (ATOMIC)
-- =============================================================
-- Processes ALL fleets with mission_phase='returning' whose
-- return_time has elapsed. For each fleet:
--   1. Locks the row with FOR UPDATE SKIP LOCKED
--   2. Finds sender planet by sender_id + sender_coords
--   3. Returns ships to planet_ships (upsert)
--   4. Returns cargo resources via add_resources_to_planet
--   5. Marks mission_phase='completed', status='completed'
--
-- SECURITY:
-- - Uses FOR UPDATE SKIP LOCKED to avoid deadlocks
-- - Calls add_resources_to_planet which has its own FOR UPDATE
-- - SECURITY DEFINER to access all tables
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_process_fleet_returns()
RETURNS json AS $
DECLARE
  v_now bigint;
  v_mission record;
  v_sender_planet_id uuid;
  v_ship_key text;
  v_ship_val jsonb;
  v_ship_qty integer;
  v_cargo_fer double precision;
  v_cargo_silice double precision;
  v_cargo_xenogas double precision;
  v_count integer := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  FOR v_mission IN
    SELECT *
    FROM fleet_missions
    WHERE mission_phase = 'returning'
      AND return_time IS NOT NULL
      AND return_time <= v_now
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Find sender planet
      SELECT id INTO v_sender_planet_id
      FROM planets
      WHERE user_id = v_mission.sender_id
        AND coordinates = v_mission.sender_coords;

      IF v_sender_planet_id IS NULL THEN
        -- Planet gone (abandoned?), just mark completed
        UPDATE fleet_missions
        SET mission_phase = 'completed',
            status = 'completed',
            completed_at = NOW()
        WHERE id = v_mission.id;
        v_count := v_count + 1;
        CONTINUE;
      END IF;

      -- Return ships
      IF v_mission.ships IS NOT NULL AND v_mission.ships != '{}'::jsonb THEN
        FOR v_ship_key, v_ship_val IN
          SELECT * FROM jsonb_each(v_mission.ships)
        LOOP
          v_ship_qty := (v_ship_val #>> '{}')::integer;
          IF v_ship_qty IS NOT NULL AND v_ship_qty > 0 THEN
            INSERT INTO planet_ships (planet_id, ship_id, quantity)
            VALUES (v_sender_planet_id, v_ship_key, v_ship_qty)
            ON CONFLICT (planet_id, ship_id)
            DO UPDATE SET quantity = planet_ships.quantity + EXCLUDED.quantity;
          END IF;
        END LOOP;
      END IF;

      -- Return cargo resources
      v_cargo_fer := COALESCE((v_mission.resources->>'fer')::double precision, 0);
      v_cargo_silice := COALESCE((v_mission.resources->>'silice')::double precision, 0);
      v_cargo_xenogas := COALESCE((v_mission.resources->>'xenogas')::double precision, 0);

      IF v_cargo_fer > 0 OR v_cargo_silice > 0 OR v_cargo_xenogas > 0 THEN
        PERFORM add_resources_to_planet(
          v_sender_planet_id,
          v_cargo_fer,
          v_cargo_silice,
          v_cargo_xenogas
        );
      END IF;

      -- Mark completed
      UPDATE fleet_missions
      SET mission_phase = 'completed',
          status = 'completed',
          completed_at = NOW()
      WHERE id = v_mission.id;

      v_count := v_count + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, v_mission.id::text || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'processed', v_count,
    'errors', to_json(v_errors)
  );
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 6. Cleanup: purge old completed fleet missions (> 7 days)
-- =============================================================
CREATE OR REPLACE FUNCTION purge_old_fleet_missions(
  p_days integer DEFAULT 7
) RETURNS integer AS $
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM fleet_missions
  WHERE mission_phase = 'completed'
    AND completed_at IS NOT NULL
    AND completed_at < NOW() - (p_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;
