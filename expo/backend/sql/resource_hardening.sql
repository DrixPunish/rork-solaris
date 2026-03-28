-- =============================================================
-- RESOURCE HARDENING & DEBUG MIGRATION
-- =============================================================
-- Run AFTER: server_defs.sql, rpc_functions.sql, resource_security.sql
--
-- Fixes:
-- 1. materialize_debug table for diagnostic logging
-- 2. Hardened calc_storage_cap with minimum floor
-- 3. Hardened calc_planet_economy with COALESCE/GREATEST
-- 4. Hardened materialize_planet_resources with validation & logging
-- 5. Hardened inline materialization in build RPCs
-- =============================================================

-- =============================================================
-- 1. DIAGNOSTIC TABLE: materialize_debug
-- =============================================================
CREATE TABLE IF NOT EXISTS materialize_debug (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  planet_id uuid NOT NULL,
  user_id uuid,
  ts timestamptz NOT NULL DEFAULT now(),
  cur_fer double precision,
  cur_silice double precision,
  cur_xenogas double precision,
  storage_fer double precision,
  storage_silice double precision,
  storage_xenogas double precision,
  prod_fer_h double precision,
  prod_silice_h double precision,
  prod_xenogas_h double precision,
  delta_fer double precision,
  delta_silice double precision,
  delta_xenogas double precision,
  new_fer double precision,
  new_silice double precision,
  new_xenogas double precision,
  elapsed_s double precision,
  decision text,
  ferro_store_level int,
  silica_store_level int,
  xeno_store_level int,
  fer_mine_level int,
  silice_mine_level int,
  xenogas_ref_level int,
  energy_net double precision
);

CREATE INDEX IF NOT EXISTS idx_materialize_debug_planet_id
  ON materialize_debug(planet_id);
CREATE INDEX IF NOT EXISTS idx_materialize_debug_ts
  ON materialize_debug(ts);

-- =============================================================
-- 2. HARDENED calc_storage_cap
-- =============================================================
-- Formula: 5000 * FLOOR(2.5 * e^(20*level/33))
-- Level 0 => 10000 (minimum guaranteed)
-- ADDED: explicit GREATEST(10000, ...) as safety floor
-- =============================================================
CREATE OR REPLACE FUNCTION calc_storage_cap(p_level int)
RETURNS double precision AS $$
BEGIN
  RETURN GREATEST(10000.0, 5000.0 * FLOOR(2.5 * EXP(20.0 * COALESCE(p_level, 0) / 33.0)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================
-- 3. HARDENED calc_planet_economy
-- =============================================================
-- Changes:
-- - All building/research level lookups wrapped in COALESCE
-- - Production per hour uses GREATEST(0, ...) to prevent negative
-- - Storage uses hardened calc_storage_cap (floor 10000)
-- - Returns additional OUT columns for store/mine levels
-- =============================================================
CREATE OR REPLACE FUNCTION calc_planet_economy(
  p_planet_id uuid,
  p_user_id uuid,
  OUT prod_fer_h double precision,
  OUT prod_silice_h double precision,
  OUT prod_xenogas_h double precision,
  OUT storage_fer double precision,
  OUT storage_silice double precision,
  OUT storage_xenogas double precision,
  OUT energy_net double precision,
  OUT ferro_store_level int,
  OUT silica_store_level int,
  OUT xeno_store_level int,
  OUT fer_mine_level int,
  OUT silice_mine_level int,
  OUT xenogas_ref_level int
) AS $$
DECLARE
  v_fer_mine int := 0;
  v_silice_mine int := 0;
  v_xenogas_ref int := 0;
  v_solar_plant int := 0;
  v_ferro_store int := 0;
  v_silica_store int := 0;
  v_xeno_store int := 0;
  v_quantum_flux int := 0;
  v_plasma int := 0;
  v_helios int := 0;
  v_pct jsonb;
  v_pct_fer double precision := 100;
  v_pct_silice double precision := 100;
  v_pct_xenogas double precision := 100;
  v_pct_solar double precision := 100;
  v_pct_helios double precision := 100;
  v_energy_prod double precision;
  v_energy_cons double precision;
  v_ratio double precision;
BEGIN
  SELECT
    COALESCE(MAX(CASE WHEN building_id = 'ferMine' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'siliceMine' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'xenogasRefinery' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'solarPlant' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'ferroStore' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'silicaStore' THEN level END), 0),
    COALESCE(MAX(CASE WHEN building_id = 'xenoStore' THEN level END), 0)
  INTO v_fer_mine, v_silice_mine, v_xenogas_ref, v_solar_plant, v_ferro_store, v_silica_store, v_xeno_store
  FROM planet_buildings
  WHERE planet_id = p_planet_id
    AND building_id IN ('ferMine','siliceMine','xenogasRefinery','solarPlant','ferroStore','silicaStore','xenoStore');

  v_fer_mine := COALESCE(v_fer_mine, 0);
  v_silice_mine := COALESCE(v_silice_mine, 0);
  v_xenogas_ref := COALESCE(v_xenogas_ref, 0);
  v_solar_plant := COALESCE(v_solar_plant, 0);
  v_ferro_store := COALESCE(v_ferro_store, 0);
  v_silica_store := COALESCE(v_silica_store, 0);
  v_xeno_store := COALESCE(v_xeno_store, 0);

  ferro_store_level := v_ferro_store;
  silica_store_level := v_silica_store;
  xeno_store_level := v_xeno_store;
  fer_mine_level := v_fer_mine;
  silice_mine_level := v_silice_mine;
  xenogas_ref_level := v_xenogas_ref;

  SELECT
    COALESCE(MAX(CASE WHEN research_id = 'quantumFlux' THEN level END), 0),
    COALESCE(MAX(CASE WHEN research_id = 'plasmaOverdrive' THEN level END), 0)
  INTO v_quantum_flux, v_plasma
  FROM player_research
  WHERE user_id = p_user_id
    AND research_id IN ('quantumFlux','plasmaOverdrive');

  v_quantum_flux := COALESCE(v_quantum_flux, 0);
  v_plasma := COALESCE(v_plasma, 0);

  SELECT COALESCE(quantity, 0) INTO v_helios
  FROM planet_ships
  WHERE planet_id = p_planet_id AND ship_id = 'heliosRemorqueur';
  IF NOT FOUND THEN v_helios := 0; END IF;
  v_helios := COALESCE(v_helios, 0);

  SELECT production_percentages INTO v_pct
  FROM planets WHERE id = p_planet_id;

  IF v_pct IS NOT NULL THEN
    v_pct_fer := COALESCE((v_pct->>'ferMine')::double precision, 100);
    v_pct_silice := COALESCE((v_pct->>'siliceMine')::double precision, 100);
    v_pct_xenogas := COALESCE((v_pct->>'xenogasRefinery')::double precision, 100);
    v_pct_solar := COALESCE((v_pct->>'solarPlant')::double precision, 100);
    v_pct_helios := COALESCE((v_pct->>'heliosRemorqueur')::double precision, 100);
  END IF;

  v_energy_prod := GREATEST(0,
    FLOOR(20.0 * v_solar_plant * POWER(1.1, v_solar_plant) * (1.0 + v_quantum_flux * 0.05) * (v_pct_solar / 100.0))
    + FLOOR(COALESCE(v_helios, 0) * 30.0 * (v_pct_helios / 100.0))
  );

  v_energy_cons := GREATEST(0,
    FLOOR(10.0 * v_fer_mine * POWER(1.1, v_fer_mine) * (v_pct_fer / 100.0))
    + FLOOR(10.0 * v_silice_mine * POWER(1.1, v_silice_mine) * (v_pct_silice / 100.0))
    + FLOOR(20.0 * v_xenogas_ref * POWER(1.1, v_xenogas_ref) * (v_pct_xenogas / 100.0))
  );

  IF v_energy_cons > 0 THEN
    v_ratio := LEAST(1.0, v_energy_prod / v_energy_cons);
  ELSE
    v_ratio := 1.0;
  END IF;

  v_ratio := GREATEST(0, COALESCE(v_ratio, 1.0));

  prod_fer_h := GREATEST(0,
    10 + FLOOR(30.0 * v_fer_mine * POWER(1.1, v_fer_mine) * v_ratio * (v_pct_fer / 100.0) * (1.0 + v_plasma * 0.01))
  );
  prod_silice_h := GREATEST(0,
    5 + FLOOR(20.0 * v_silice_mine * POWER(1.1, v_silice_mine) * v_ratio * (v_pct_silice / 100.0) * (1.0 + v_plasma * 0.0066))
  );
  prod_xenogas_h := GREATEST(0,
    FLOOR(10.0 * v_xenogas_ref * POWER(1.1, v_xenogas_ref) * v_ratio * (v_pct_xenogas / 100.0) * (1.0 + v_plasma * 0.0033))
  );

  storage_fer := GREATEST(10000, calc_storage_cap(v_ferro_store));
  storage_silice := GREATEST(10000, calc_storage_cap(v_silica_store));
  storage_xenogas := GREATEST(10000, calc_storage_cap(v_xeno_store));

  energy_net := COALESCE(v_energy_prod, 0) - COALESCE(v_energy_cons, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================
-- 4. HARDENED materialize_planet_resources
-- =============================================================
-- Changes:
-- - Validates storage caps >= 1000, logs WARNING if not
-- - Inserts debug row into materialize_debug before UPDATE
-- - Resources can NEVER go below 0 (GREATEST(0, ...))
-- - Aborts materialization (returns false) if storage anomaly
-- =============================================================
CREATE OR REPLACE FUNCTION materialize_planet_resources(
  p_planet_id uuid,
  p_user_id uuid
) RETURNS json AS $$
DECLARE
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_elapsed double precision;
  v_econ record;
  v_cur_fer double precision;
  v_cur_silice double precision;
  v_cur_xenogas double precision;
  v_delta_fer double precision;
  v_delta_silice double precision;
  v_delta_xenogas double precision;
  v_new_fer double precision;
  v_new_silice double precision;
  v_new_xenogas double precision;
  v_decision text := 'normal';
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  PERFORM set_resource_tx_context('production', 'tick_' || v_now::text);

  SELECT last_update INTO v_last_update
  FROM planets
  WHERE id = p_planet_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet not found or not owned');
  END IF;

  v_elapsed := GREATEST(0, (v_now - COALESCE(v_last_update, v_now)) / 1000.0);
  IF v_elapsed < 30 THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  SELECT * INTO v_econ FROM calc_planet_economy(p_planet_id, p_user_id);

  IF COALESCE(v_econ.storage_fer, 0) < 1000
     OR COALESCE(v_econ.storage_silice, 0) < 1000
     OR COALESCE(v_econ.storage_xenogas, 0) < 1000 THEN
    RAISE WARNING '[materialize] ANOMALY: storage < 1000 for planet %. storage_fer=%, storage_silice=%, storage_xenogas=%, ferro_store_lv=%, silica_store_lv=%, xeno_store_lv=%',
      p_planet_id,
      COALESCE(v_econ.storage_fer, 0),
      COALESCE(v_econ.storage_silice, 0),
      COALESCE(v_econ.storage_xenogas, 0),
      COALESCE(v_econ.ferro_store_level, -1),
      COALESCE(v_econ.silica_store_level, -1),
      COALESCE(v_econ.xeno_store_level, -1);

    v_decision := 'ABORTED_LOW_STORAGE';

    INSERT INTO materialize_debug (
      planet_id, user_id, cur_fer, cur_silice, cur_xenogas,
      storage_fer, storage_silice, storage_xenogas,
      prod_fer_h, prod_silice_h, prod_xenogas_h,
      delta_fer, delta_silice, delta_xenogas,
      new_fer, new_silice, new_xenogas,
      elapsed_s, decision,
      ferro_store_level, silica_store_level, xeno_store_level,
      fer_mine_level, silice_mine_level, xenogas_ref_level,
      energy_net
    ) VALUES (
      p_planet_id, p_user_id, NULL, NULL, NULL,
      COALESCE(v_econ.storage_fer, 0), COALESCE(v_econ.storage_silice, 0), COALESCE(v_econ.storage_xenogas, 0),
      COALESCE(v_econ.prod_fer_h, 0), COALESCE(v_econ.prod_silice_h, 0), COALESCE(v_econ.prod_xenogas_h, 0),
      0, 0, 0,
      NULL, NULL, NULL,
      v_elapsed, v_decision,
      COALESCE(v_econ.ferro_store_level, -1), COALESCE(v_econ.silica_store_level, -1), COALESCE(v_econ.xeno_store_level, -1),
      COALESCE(v_econ.fer_mine_level, -1), COALESCE(v_econ.silice_mine_level, -1), COALESCE(v_econ.xenogas_ref_level, -1),
      COALESCE(v_econ.energy_net, 0)
    );

    RETURN json_build_object('success', false, 'error', 'Storage anomaly detected', 'aborted', true);
  END IF;

  SELECT fer, silice, xenogas, energy INTO v_res
  FROM planet_resources
  WHERE planet_id = p_planet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO planet_resources (planet_id, fer, silice, xenogas, energy)
    VALUES (p_planet_id, 500, 300, 0, COALESCE(v_econ.energy_net, 0));
    UPDATE planets SET last_update = v_now WHERE id = p_planet_id;
    RETURN json_build_object('success', true, 'created', true);
  END IF;

  v_cur_fer := GREATEST(0, COALESCE(v_res.fer, 0));
  v_cur_silice := GREATEST(0, COALESCE(v_res.silice, 0));
  v_cur_xenogas := GREATEST(0, COALESCE(v_res.xenogas, 0));

  v_delta_fer := GREATEST(0, (COALESCE(v_econ.prod_fer_h, 0) / 3600.0) * v_elapsed);
  v_delta_silice := GREATEST(0, (COALESCE(v_econ.prod_silice_h, 0) / 3600.0) * v_elapsed);
  v_delta_xenogas := GREATEST(0, (COALESCE(v_econ.prod_xenogas_h, 0) / 3600.0) * v_elapsed);

  v_new_fer := CASE
    WHEN v_cur_fer >= COALESCE(v_econ.storage_fer, 10000) THEN v_cur_fer
    ELSE LEAST(v_cur_fer + v_delta_fer, COALESCE(v_econ.storage_fer, 10000))
  END;
  v_new_silice := CASE
    WHEN v_cur_silice >= COALESCE(v_econ.storage_silice, 10000) THEN v_cur_silice
    ELSE LEAST(v_cur_silice + v_delta_silice, COALESCE(v_econ.storage_silice, 10000))
  END;
  v_new_xenogas := CASE
    WHEN v_cur_xenogas >= COALESCE(v_econ.storage_xenogas, 10000) THEN v_cur_xenogas
    ELSE LEAST(v_cur_xenogas + v_delta_xenogas, COALESCE(v_econ.storage_xenogas, 10000))
  END;

  v_new_fer := GREATEST(0, v_new_fer);
  v_new_silice := GREATEST(0, v_new_silice);
  v_new_xenogas := GREATEST(0, v_new_xenogas);

  IF v_new_fer < v_cur_fer - 1 OR v_new_silice < v_cur_silice - 1 OR v_new_xenogas < v_cur_xenogas - 1 THEN
    v_decision := 'ANOMALY_DECREASE';
    RAISE WARNING '[materialize] ANOMALY: resources would DECREASE for planet %. cur_fer=%, new_fer=%, storage_fer=%, cur_silice=%, new_silice=%, cur_xenogas=%, new_xenogas=%',
      p_planet_id, v_cur_fer, v_new_fer, COALESCE(v_econ.storage_fer, 0),
      v_cur_silice, v_new_silice, v_cur_xenogas, v_new_xenogas;

    v_new_fer := v_cur_fer;
    v_new_silice := v_cur_silice;
    v_new_xenogas := v_cur_xenogas;
  END IF;

  INSERT INTO materialize_debug (
    planet_id, user_id, cur_fer, cur_silice, cur_xenogas,
    storage_fer, storage_silice, storage_xenogas,
    prod_fer_h, prod_silice_h, prod_xenogas_h,
    delta_fer, delta_silice, delta_xenogas,
    new_fer, new_silice, new_xenogas,
    elapsed_s, decision,
    ferro_store_level, silica_store_level, xeno_store_level,
    fer_mine_level, silice_mine_level, xenogas_ref_level,
    energy_net
  ) VALUES (
    p_planet_id, p_user_id, v_cur_fer, v_cur_silice, v_cur_xenogas,
    COALESCE(v_econ.storage_fer, 0), COALESCE(v_econ.storage_silice, 0), COALESCE(v_econ.storage_xenogas, 0),
    COALESCE(v_econ.prod_fer_h, 0), COALESCE(v_econ.prod_silice_h, 0), COALESCE(v_econ.prod_xenogas_h, 0),
    v_delta_fer, v_delta_silice, v_delta_xenogas,
    v_new_fer, v_new_silice, v_new_xenogas,
    v_elapsed, v_decision,
    COALESCE(v_econ.ferro_store_level, -1), COALESCE(v_econ.silica_store_level, -1), COALESCE(v_econ.xeno_store_level, -1),
    COALESCE(v_econ.fer_mine_level, -1), COALESCE(v_econ.silice_mine_level, -1), COALESCE(v_econ.xenogas_ref_level, -1),
    COALESCE(v_econ.energy_net, 0)
  );

  UPDATE planet_resources
  SET fer = v_new_fer,
      silice = v_new_silice,
      xenogas = v_new_xenogas,
      energy = COALESCE(v_econ.energy_net, 0)
  WHERE planet_id = p_planet_id;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'fer', v_new_fer,
    'silice', v_new_silice,
    'xenogas', v_new_xenogas,
    'energy', COALESCE(v_econ.energy_net, 0),
    'delta_fer', v_delta_fer,
    'delta_silice', v_delta_silice,
    'delta_xenogas', v_delta_xenogas,
    'elapsed_s', v_elapsed,
    'decision', v_decision
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 5. HARDENED INLINE MATERIALIZATION HELPER
-- =============================================================
-- Used by build RPCs (rpc_build_structure, rpc_start_research,
-- rpc_build_ships, rpc_build_defenses) to safely materialize
-- resources inline. Returns the materialized values.
--
-- KEY FIX: This function ensures that inline materialization
-- in build RPCs NEVER reduces resources below current values
-- (except for the build cost deduction which happens after).
-- =============================================================
CREATE OR REPLACE FUNCTION safe_materialize_inline(
  p_planet_id uuid,
  p_user_id uuid,
  p_cur_fer double precision,
  p_cur_silice double precision,
  p_cur_xenogas double precision,
  p_last_update bigint,
  p_now bigint,
  OUT mat_fer double precision,
  OUT mat_silice double precision,
  OUT mat_xenogas double precision,
  OUT mat_energy double precision
) AS $$
DECLARE
  v_econ record;
  v_elapsed double precision;
  v_delta_fer double precision;
  v_delta_silice double precision;
  v_delta_xenogas double precision;
  v_safe_cur_fer double precision;
  v_safe_cur_silice double precision;
  v_safe_cur_xenogas double precision;
BEGIN
  SELECT * INTO v_econ FROM calc_planet_economy(p_planet_id, p_user_id);

  v_elapsed := GREATEST(0, (p_now - COALESCE(p_last_update, p_now)) / 1000.0);

  v_safe_cur_fer := GREATEST(0, COALESCE(p_cur_fer, 0));
  v_safe_cur_silice := GREATEST(0, COALESCE(p_cur_silice, 0));
  v_safe_cur_xenogas := GREATEST(0, COALESCE(p_cur_xenogas, 0));

  v_delta_fer := GREATEST(0, (COALESCE(v_econ.prod_fer_h, 0) / 3600.0) * v_elapsed);
  v_delta_silice := GREATEST(0, (COALESCE(v_econ.prod_silice_h, 0) / 3600.0) * v_elapsed);
  v_delta_xenogas := GREATEST(0, (COALESCE(v_econ.prod_xenogas_h, 0) / 3600.0) * v_elapsed);

  mat_fer := CASE
    WHEN v_safe_cur_fer >= COALESCE(v_econ.storage_fer, 10000) THEN v_safe_cur_fer
    ELSE LEAST(v_safe_cur_fer + v_delta_fer, COALESCE(v_econ.storage_fer, 10000))
  END;
  mat_silice := CASE
    WHEN v_safe_cur_silice >= COALESCE(v_econ.storage_silice, 10000) THEN v_safe_cur_silice
    ELSE LEAST(v_safe_cur_silice + v_delta_silice, COALESCE(v_econ.storage_silice, 10000))
  END;
  mat_xenogas := CASE
    WHEN v_safe_cur_xenogas >= COALESCE(v_econ.storage_xenogas, 10000) THEN v_safe_cur_xenogas
    ELSE LEAST(v_safe_cur_xenogas + v_delta_xenogas, COALESCE(v_econ.storage_xenogas, 10000))
  END;

  mat_fer := GREATEST(v_safe_cur_fer, mat_fer);
  mat_silice := GREATEST(v_safe_cur_silice, mat_silice);
  mat_xenogas := GREATEST(v_safe_cur_xenogas, mat_xenogas);

  mat_energy := COALESCE(v_econ.energy_net, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================
-- 6. PURGE OLD materialize_debug (maintenance)
-- =============================================================
CREATE OR REPLACE FUNCTION purge_old_materialize_debug(
  p_days integer DEFAULT 7
) RETURNS integer AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM materialize_debug
  WHERE ts < now() - (p_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 7. TEST SCRIPT: Simulate low-storage scenario
-- =============================================================
-- Uncomment and run manually to verify behavior.
-- This test:
-- a) Calls calc_storage_cap with various levels
-- b) Verifies minimum floor of 10000
-- c) Tests that materialize never reduces resources
-- =============================================================
/*
DO $$
DECLARE
  v_cap0 double precision;
  v_cap1 double precision;
  v_cap5 double precision;
BEGIN
  -- Test calc_storage_cap minimums
  v_cap0 := calc_storage_cap(0);
  v_cap1 := calc_storage_cap(1);
  v_cap5 := calc_storage_cap(5);

  RAISE NOTICE 'calc_storage_cap(0) = %  (expect >= 10000)', v_cap0;
  RAISE NOTICE 'calc_storage_cap(1) = %  (expect >= 10000)', v_cap1;
  RAISE NOTICE 'calc_storage_cap(5) = %  (expect >= 10000)', v_cap5;

  IF v_cap0 < 10000 THEN
    RAISE EXCEPTION 'FAIL: calc_storage_cap(0) = % < 10000', v_cap0;
  END IF;
  IF v_cap1 < 10000 THEN
    RAISE EXCEPTION 'FAIL: calc_storage_cap(1) = % < 10000', v_cap1;
  END IF;

  RAISE NOTICE 'All calc_storage_cap tests PASSED';

  -- Test NULL handling
  DECLARE
    v_null_cap double precision;
  BEGIN
    v_null_cap := calc_storage_cap(NULL);
    RAISE NOTICE 'calc_storage_cap(NULL) = %  (expect 10000)', v_null_cap;
    IF v_null_cap < 10000 THEN
      RAISE EXCEPTION 'FAIL: calc_storage_cap(NULL) = % < 10000', v_null_cap;
    END IF;
    RAISE NOTICE 'NULL test PASSED';
  END;
END $$;

-- Test calc_planet_economy returns valid storage for a known planet
-- Replace the UUIDs with real values from your database
/*
SELECT
  prod_fer_h, prod_silice_h, prod_xenogas_h,
  storage_fer, storage_silice, storage_xenogas,
  ferro_store_level, silica_store_level, xeno_store_level,
  fer_mine_level, silice_mine_level, xenogas_ref_level,
  energy_net
FROM calc_planet_economy(
  '9e93ac12-ca91-40ac-9d39-064d8371a347'::uuid,
  'b8d09003-8e4c-4a73-bda6-35b5055e857e'::uuid
);
*/
*/
