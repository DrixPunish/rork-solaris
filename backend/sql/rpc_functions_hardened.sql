-- =============================================================
-- HARDENED RPC FUNCTIONS - ALL BUILD RPCs USE safe_materialize_inline
-- =============================================================
-- Run this AFTER: resource_hardening.sql
--
-- Changes:
-- 1. All build RPCs (build_structure, start_research, build_ships,
--    build_defenses) now use safe_materialize_inline instead of
--    inline materialization. This guarantees:
--    - Resources NEVER decrease from materialization
--    - Storage caps are always respected
--    - All materialization uses the same hardened code path
--
-- 2. Cancel RPCs (cancel_timer, cancel_shipyard) also hardened.
--
-- 3. Transaction context is set BEFORE any UPDATE to planet_resources
--    so the audit trigger always logs the correct type/reason.
-- =============================================================

-- =============================================================
-- 1. BUILD STRUCTURE (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_build_structure(
  p_user_id uuid,
  p_planet_id uuid,
  p_building_id text
) RETURNS json AS $$
DECLARE
  v_def record;
  v_current_level int;
  v_target_level int;
  v_cost_fer double precision;
  v_cost_silice double precision;
  v_cost_xenogas double precision;
  v_robotics int;
  v_nanite int;
  v_raw_time double precision;
  v_duration_ms bigint;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_already boolean;
  v_mat record;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT * INTO v_def FROM building_defs WHERE building_id = p_building_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Unknown building');
  END IF;

  v_current_level := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = p_building_id), 0);
  v_target_level := v_current_level + 1;

  v_cost_fer := FLOOR(v_def.base_cost_fer * POWER(v_def.cost_factor, v_current_level));
  v_cost_silice := FLOOR(v_def.base_cost_silice * POWER(v_def.cost_factor, v_current_level));
  v_cost_xenogas := FLOOR(v_def.base_cost_xenogas * POWER(v_def.cost_factor, v_current_level));

  v_robotics := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'roboticsFactory'), 0);
  v_nanite := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'naniteFactory'), 0);
  v_raw_time := FLOOR(v_def.base_time * POWER(v_def.time_factor, v_current_level));
  v_duration_ms := (GREATEST(5, FLOOR(v_raw_time / (1.0 + v_robotics * 0.1) * (CASE WHEN v_nanite > 0 THEN 1.0 / POWER(2, v_nanite) ELSE 1.0 END))) * 1000)::bigint;

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources
  WHERE planet_id = p_planet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update
  FROM planets
  WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  PERFORM 1 FROM active_timers
    WHERE user_id = p_user_id AND target_id = p_building_id AND timer_type = 'building'
      AND planet_id = p_planet_id
    FOR UPDATE;
  v_already := FOUND;

  IF v_already THEN
    RETURN json_build_object('success', false, 'error', 'Already upgrading');
  END IF;

  IF v_fer < v_cost_fer OR v_silice < v_cost_silice OR v_xenogas < v_cost_xenogas THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient resources');
  END IF;

  v_fer := v_fer - v_cost_fer;
  v_silice := v_silice - v_cost_silice;
  v_xenogas := v_xenogas - v_cost_xenogas;

  PERFORM set_resource_tx_context('build_structure', p_building_id);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  INSERT INTO active_timers (user_id, planet_id, timer_type, target_id, target_level, start_time, end_time)
  VALUES (p_user_id, p_planet_id, 'building', p_building_id, v_target_level, v_now, v_now + v_duration_ms);

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy),
    'timer', json_build_object('id', p_building_id, 'type', 'building', 'targetLevel', v_target_level, 'startTime', v_now, 'endTime', v_now + v_duration_ms)
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 2. START RESEARCH (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_start_research(
  p_user_id uuid,
  p_planet_id uuid,
  p_research_id text
) RETURNS json AS $$
DECLARE
  v_def record;
  v_current_level int;
  v_target_level int;
  v_cost_fer double precision;
  v_cost_silice double precision;
  v_cost_xenogas double precision;
  v_lab_level int;
  v_nanite int;
  v_raw_time double precision;
  v_duration_ms bigint;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_already boolean;
  v_mat record;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT * INTO v_def FROM research_defs WHERE research_id = p_research_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Unknown research');
  END IF;

  v_current_level := COALESCE((SELECT level FROM player_research WHERE user_id = p_user_id AND research_id = p_research_id), 0);
  v_target_level := v_current_level + 1;

  v_cost_fer := FLOOR(v_def.base_cost_fer * POWER(v_def.cost_factor, v_current_level));
  v_cost_silice := FLOOR(v_def.base_cost_silice * POWER(v_def.cost_factor, v_current_level));
  v_cost_xenogas := FLOOR(v_def.base_cost_xenogas * POWER(v_def.cost_factor, v_current_level));

  v_lab_level := calc_effective_lab_level(p_user_id, p_planet_id);
  v_nanite := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'naniteFactory'), 0);
  v_raw_time := FLOOR(v_def.base_time * POWER(v_def.time_factor, v_current_level));
  v_duration_ms := (GREATEST(5, FLOOR(v_raw_time / (1.0 + v_lab_level * 0.1) * (CASE WHEN v_nanite > 0 THEN 1.0 / POWER(2, v_nanite) ELSE 1.0 END))) * 1000)::bigint;

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources
  WHERE planet_id = p_planet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update
  FROM planets WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  PERFORM 1 FROM active_timers
    WHERE user_id = p_user_id AND target_id = p_research_id AND timer_type = 'research'
    FOR UPDATE;
  v_already := FOUND;

  IF v_already THEN
    RETURN json_build_object('success', false, 'error', 'Already researching');
  END IF;

  IF v_fer < v_cost_fer OR v_silice < v_cost_silice OR v_xenogas < v_cost_xenogas THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient resources');
  END IF;

  v_fer := v_fer - v_cost_fer;
  v_silice := v_silice - v_cost_silice;
  v_xenogas := v_xenogas - v_cost_xenogas;

  PERFORM set_resource_tx_context('start_research', p_research_id);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  INSERT INTO active_timers (user_id, planet_id, timer_type, target_id, target_level, start_time, end_time)
  VALUES (p_user_id, NULL, 'research', p_research_id, v_target_level, v_now, v_now + v_duration_ms);

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy),
    'timer', json_build_object('id', p_research_id, 'type', 'research', 'targetLevel', v_target_level, 'startTime', v_now, 'endTime', v_now + v_duration_ms)
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 3. BUILD SHIPS (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_build_ships(
  p_user_id uuid,
  p_planet_id uuid,
  p_ship_id text,
  p_quantity integer
) RETURNS json AS $$
DECLARE
  v_def record;
  v_cost_fer double precision;
  v_cost_silice double precision;
  v_cost_xenogas double precision;
  v_shipyard_level int;
  v_nanite int;
  v_build_time_per_unit double precision;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_existing record;
  v_new_total integer;
  v_new_remaining integer;
  v_start_time bigint;
  v_end_time bigint;
  v_btp double precision;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT * INTO v_def FROM ship_defs WHERE ship_id = p_ship_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Unknown ship');
  END IF;

  v_cost_fer := v_def.cost_fer * p_quantity;
  v_cost_silice := v_def.cost_silice * p_quantity;
  v_cost_xenogas := v_def.cost_xenogas * p_quantity;

  v_shipyard_level := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'shipyard'), 1);
  v_nanite := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'naniteFactory'), 0);
  v_build_time_per_unit := GREATEST(5, FLOOR(v_def.build_time / (1.0 + (v_shipyard_level - 1) * 0.1) * (CASE WHEN v_nanite > 0 THEN 1.0 / POWER(2, v_nanite) ELSE 1.0 END)));

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources WHERE planet_id = p_planet_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update FROM planets WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  IF v_fer < v_cost_fer OR v_silice < v_cost_silice OR v_xenogas < v_cost_xenogas THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient resources');
  END IF;

  v_fer := v_fer - v_cost_fer;
  v_silice := v_silice - v_cost_silice;
  v_xenogas := v_xenogas - v_cost_xenogas;

  PERFORM set_resource_tx_context('build_ships', p_ship_id || 'x' || p_quantity);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  SELECT total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time
  INTO v_existing
  FROM shipyard_queue
  WHERE planet_id = p_planet_id AND item_id = p_ship_id AND item_type = 'ship'
  FOR UPDATE;

  IF FOUND THEN
    v_new_total := v_existing.total_quantity + p_quantity;
    v_new_remaining := v_existing.remaining_quantity + p_quantity;
    UPDATE shipyard_queue
    SET total_quantity = v_new_total, remaining_quantity = v_new_remaining
    WHERE planet_id = p_planet_id AND item_id = p_ship_id AND item_type = 'ship';

    v_btp := v_existing.build_time_per_unit;
    v_start_time := v_existing.current_unit_start_time;
    v_end_time := v_existing.current_unit_end_time;
  ELSE
    v_new_total := p_quantity;
    v_new_remaining := p_quantity;
    v_btp := v_build_time_per_unit;
    v_start_time := v_now;
    v_end_time := v_now + (v_build_time_per_unit * 1000)::bigint;

    INSERT INTO shipyard_queue (planet_id, item_id, item_type, total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time)
    VALUES (p_planet_id, p_ship_id, 'ship', v_new_total, v_new_remaining, v_build_time_per_unit, v_start_time, v_end_time);
  END IF;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy),
    'queueItem', json_build_object(
      'id', p_ship_id, 'type', 'ship',
      'totalQuantity', v_new_total, 'remainingQuantity', v_new_remaining,
      'buildTimePerUnit', v_btp,
      'currentUnitStartTime', v_start_time, 'currentUnitEndTime', v_end_time
    )
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 4. BUILD DEFENSES (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_build_defenses(
  p_user_id uuid,
  p_planet_id uuid,
  p_defense_id text,
  p_quantity integer
) RETURNS json AS $$
DECLARE
  v_def record;
  v_cost_fer double precision;
  v_cost_silice double precision;
  v_cost_xenogas double precision;
  v_shipyard_level int;
  v_nanite int;
  v_build_time_per_unit double precision;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_existing record;
  v_new_total integer;
  v_new_remaining integer;
  v_start_time bigint;
  v_end_time bigint;
  v_btp double precision;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT * INTO v_def FROM defense_defs WHERE defense_id = p_defense_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Unknown defense');
  END IF;

  v_cost_fer := v_def.cost_fer * p_quantity;
  v_cost_silice := v_def.cost_silice * p_quantity;
  v_cost_xenogas := v_def.cost_xenogas * p_quantity;

  v_shipyard_level := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'shipyard'), 1);
  v_nanite := COALESCE((SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'naniteFactory'), 0);
  v_build_time_per_unit := GREATEST(5, FLOOR(v_def.build_time / (1.0 + (v_shipyard_level - 1) * 0.1) * (CASE WHEN v_nanite > 0 THEN 1.0 / POWER(2, v_nanite) ELSE 1.0 END)));

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources WHERE planet_id = p_planet_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update FROM planets WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  IF v_fer < v_cost_fer OR v_silice < v_cost_silice OR v_xenogas < v_cost_xenogas THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient resources');
  END IF;

  v_fer := v_fer - v_cost_fer;
  v_silice := v_silice - v_cost_silice;
  v_xenogas := v_xenogas - v_cost_xenogas;

  PERFORM set_resource_tx_context('build_defenses', p_defense_id || 'x' || p_quantity);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  SELECT total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time
  INTO v_existing
  FROM shipyard_queue
  WHERE planet_id = p_planet_id AND item_id = p_defense_id AND item_type = 'defense'
  FOR UPDATE;

  IF FOUND THEN
    v_new_total := v_existing.total_quantity + p_quantity;
    v_new_remaining := v_existing.remaining_quantity + p_quantity;
    UPDATE shipyard_queue
    SET total_quantity = v_new_total, remaining_quantity = v_new_remaining
    WHERE planet_id = p_planet_id AND item_id = p_defense_id AND item_type = 'defense';

    v_btp := v_existing.build_time_per_unit;
    v_start_time := v_existing.current_unit_start_time;
    v_end_time := v_existing.current_unit_end_time;
  ELSE
    v_new_total := p_quantity;
    v_new_remaining := p_quantity;
    v_btp := v_build_time_per_unit;
    v_start_time := v_now;
    v_end_time := v_now + (v_build_time_per_unit * 1000)::bigint;

    INSERT INTO shipyard_queue (planet_id, item_id, item_type, total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time)
    VALUES (p_planet_id, p_defense_id, 'defense', v_new_total, v_new_remaining, v_build_time_per_unit, v_start_time, v_end_time);
  END IF;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy),
    'queueItem', json_build_object(
      'id', p_defense_id, 'type', 'defense',
      'totalQuantity', v_new_total, 'remainingQuantity', v_new_remaining,
      'buildTimePerUnit', v_btp,
      'currentUnitStartTime', v_start_time, 'currentUnitEndTime', v_end_time
    )
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 5. CANCEL TIMER (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_cancel_timer(
  p_user_id uuid,
  p_planet_id uuid,
  p_timer_id text,
  p_timer_type text
) RETURNS json AS $$
DECLARE
  v_timer record;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_current_level int;
  v_refund_fer double precision := 0;
  v_refund_silice double precision := 0;
  v_refund_xenogas double precision := 0;
  v_bdef record;
  v_rdef record;
  v_refund_rate double precision := 0.8;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT id, target_id, target_level INTO v_timer
  FROM active_timers
  WHERE user_id = p_user_id AND target_id = p_timer_id AND timer_type = p_timer_type
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Timer not found');
  END IF;

  v_current_level := v_timer.target_level - 1;

  IF p_timer_type = 'building' THEN
    SELECT * INTO v_bdef FROM building_defs WHERE building_id = p_timer_id;
    IF FOUND THEN
      v_refund_fer := FLOOR(v_bdef.base_cost_fer * POWER(v_bdef.cost_factor, v_current_level)) * v_refund_rate;
      v_refund_silice := FLOOR(v_bdef.base_cost_silice * POWER(v_bdef.cost_factor, v_current_level)) * v_refund_rate;
      v_refund_xenogas := FLOOR(v_bdef.base_cost_xenogas * POWER(v_bdef.cost_factor, v_current_level)) * v_refund_rate;
    END IF;
  ELSIF p_timer_type = 'research' THEN
    SELECT * INTO v_rdef FROM research_defs WHERE research_id = p_timer_id;
    IF FOUND THEN
      v_refund_fer := FLOOR(v_rdef.base_cost_fer * POWER(v_rdef.cost_factor, v_current_level)) * v_refund_rate;
      v_refund_silice := FLOOR(v_rdef.base_cost_silice * POWER(v_rdef.cost_factor, v_current_level)) * v_refund_rate;
      v_refund_xenogas := FLOOR(v_rdef.base_cost_xenogas * POWER(v_rdef.cost_factor, v_current_level)) * v_refund_rate;
    END IF;
  END IF;

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources WHERE planet_id = p_planet_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update FROM planets WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  v_fer := v_fer + v_refund_fer;
  v_silice := v_silice + v_refund_silice;
  v_xenogas := v_xenogas + v_refund_xenogas;

  DELETE FROM active_timers WHERE id = v_timer.id;

  PERFORM set_resource_tx_context('cancel_timer', p_timer_id || ':' || p_timer_type);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy)
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 6. CANCEL SHIPYARD (hardened)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_cancel_shipyard(
  p_user_id uuid,
  p_planet_id uuid,
  p_item_id text,
  p_item_type text
) RETURNS json AS $$
DECLARE
  v_queue record;
  v_res record;
  v_last_update bigint;
  v_now bigint;
  v_fer double precision;
  v_silice double precision;
  v_xenogas double precision;
  v_energy double precision;
  v_unit_fer double precision := 0;
  v_unit_silice double precision := 0;
  v_unit_xenogas double precision := 0;
  v_refund_qty int;
  v_refund_rate double precision := 0.8;
  v_sdef record;
  v_ddef record;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  IF NOT assert_planet_owner(p_user_id, p_planet_id) THEN
    RETURN json_build_object('success', false, 'error', 'Planet not owned by user');
  END IF;

  SELECT remaining_quantity, build_time_per_unit, current_unit_end_time
  INTO v_queue
  FROM shipyard_queue
  WHERE planet_id = p_planet_id AND item_id = p_item_id AND item_type = p_item_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Queue item not found');
  END IF;

  IF v_queue.remaining_quantity <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Nothing to cancel');
  END IF;

  IF p_item_type = 'ship' THEN
    SELECT cost_fer, cost_silice, cost_xenogas INTO v_sdef FROM ship_defs WHERE ship_id = p_item_id;
    IF FOUND THEN
      v_unit_fer := v_sdef.cost_fer;
      v_unit_silice := v_sdef.cost_silice;
      v_unit_xenogas := v_sdef.cost_xenogas;
    END IF;
  ELSE
    SELECT cost_fer, cost_silice, cost_xenogas INTO v_ddef FROM defense_defs WHERE defense_id = p_item_id;
    IF FOUND THEN
      v_unit_fer := v_ddef.cost_fer;
      v_unit_silice := v_ddef.cost_silice;
      v_unit_xenogas := v_ddef.cost_xenogas;
    END IF;
  END IF;

  v_refund_qty := v_queue.remaining_quantity;

  SELECT fer, silice, xenogas INTO v_res
  FROM planet_resources WHERE planet_id = p_planet_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  SELECT last_update INTO v_last_update FROM planets WHERE id = p_planet_id;

  SELECT mat_fer, mat_silice, mat_xenogas, mat_energy
  INTO v_fer, v_silice, v_xenogas, v_energy
  FROM safe_materialize_inline(
    p_planet_id, p_user_id,
    COALESCE(v_res.fer, 0), COALESCE(v_res.silice, 0), COALESCE(v_res.xenogas, 0),
    v_last_update, v_now
  );

  v_fer := v_fer + v_unit_fer * v_refund_qty * v_refund_rate;
  v_silice := v_silice + v_unit_silice * v_refund_qty * v_refund_rate;
  v_xenogas := v_xenogas + v_unit_xenogas * v_refund_qty * v_refund_rate;

  DELETE FROM shipyard_queue
  WHERE planet_id = p_planet_id AND item_id = p_item_id AND item_type = p_item_type;

  PERFORM set_resource_tx_context('cancel_shipyard', p_item_id || ':' || p_item_type);

  UPDATE planet_resources
  SET fer = v_fer, silice = v_silice, xenogas = v_xenogas, energy = v_energy
  WHERE planet_id = p_planet_id;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'resources', json_build_object('fer', v_fer, 'silice', v_silice, 'xenogas', v_xenogas, 'energy', v_energy)
  );
END;
$$ LANGUAGE plpgsql;
