-- =============================================================
-- SERVER-SIDE FLEET & EXTRAS RPC FUNCTIONS
-- Run in Supabase SQL Editor AFTER rpc_functions.sql
-- AND AFTER resource_security.sql
-- =============================================================

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
-- - SELECT ... FOR UPDATE sur planet_resources avant ajout
-- - SELECT ... FOR UPDATE sur players avant ajout de solar
-- - Doit etre appelee dans un contexte authentifie
-- - Les valeurs de recompense proviennent du client mais sont
--   validees par le systeme de tutoriel (claimed_rewards)
-- =============================================================
CREATE OR REPLACE FUNCTION rpc_claim_tutorial_reward(
  p_user_id uuid,
  p_planet_id uuid,
  p_reward_type text,
  p_fer double precision DEFAULT 0,
  p_silice double precision DEFAULT 0,
  p_xenogas double precision DEFAULT 0,
  p_solar double precision DEFAULT 0
) RETURNS json AS $
DECLARE
  v_new_solar double precision;
  v_res record;
BEGIN
  IF p_reward_type = 'resources' THEN
    PERFORM set_resource_tx_context('tutorial_reward', 'resources');

    SELECT fer, silice, xenogas INTO v_res
    FROM planet_resources
    WHERE planet_id = p_planet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'Planet resources not found');
    END IF;

    UPDATE planet_resources
    SET fer = COALESCE(v_res.fer, 0) + GREATEST(0, p_fer),
        silice = COALESCE(v_res.silice, 0) + GREATEST(0, p_silice),
        xenogas = COALESCE(v_res.xenogas, 0) + GREATEST(0, p_xenogas)
    WHERE planet_id = p_planet_id;
  ELSIF p_reward_type = 'solar' THEN
    SELECT solar INTO v_new_solar
    FROM players
    WHERE user_id = p_user_id
    FOR UPDATE;

    UPDATE players
    SET solar = COALESCE(v_new_solar, 0) + GREATEST(0, p_solar)
    WHERE user_id = p_user_id
    RETURNING solar INTO v_new_solar;
  END IF;

  RETURN json_build_object('success', true, 'solar', v_new_solar);
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Add production_percentages column to planets table
ALTER TABLE planets ADD COLUMN IF NOT EXISTS production_percentages jsonb DEFAULT NULL;
