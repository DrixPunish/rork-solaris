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
-- 1. rpc_send_fleet (SECURED)
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
  p_cargo_xenogas double precision DEFAULT 0
) RETURNS json AS $
DECLARE
  v_key text;
  v_val jsonb;
  v_ship_qty integer;
  v_current_qty integer;
  v_res record;
  v_now bigint;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

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

  RETURN json_build_object('success', true);
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 2. rpc_claim_tutorial_reward (SECURED)
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

-- 3. Add production_percentages column to planets table
ALTER TABLE planets ADD COLUMN IF NOT EXISTS production_percentages jsonb DEFAULT NULL;

-- =============================================================
-- 4. rpc_process_fleet_returns (ATOMIC)
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
-- 5. Cleanup: purge old completed fleet missions (> 7 days)
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
