-- =============================================================
-- RESOURCE SECURITY & AUDIT LAYER
-- =============================================================
--
-- Ce fichier centralise TOUTES les operations qui modifient
-- les ressources (fer, silice, xenogas, energy) dans
-- planet_resources.
--
-- REGLES DE SECURITE:
-- 1. Chaque fonction qui ecrit dans planet_resources DOIT
--    d'abord faire un SELECT ... FOR UPDATE pour verrouiller
--    la ligne et eviter les race conditions.
-- 2. La mise a jour de planets.last_update DOIT etre faite
--    dans la meme transaction que la modification des ressources.
-- 3. Aucune fonction ne doit recevoir de valeurs de ressources
--    "deja calculees" par le client. Les couts et productions
--    sont TOUJOURS calcules cote serveur (cf. server_defs.sql).
-- 4. Toute modification de ressources est loguee automatiquement
--    par le trigger log_resource_changes sur planet_resources.
--
-- ORDRE D'EXECUTION:
--   1. server_defs.sql
--   2. rpc_functions.sql
--   3. resource_security.sql  (ce fichier)
--   4. server_fleet_extras.sql
-- =============================================================

-- =============================================================
-- 1. AUDIT TABLE: resource_transactions
-- =============================================================
CREATE TABLE IF NOT EXISTS resource_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  planet_id uuid NOT NULL,
  player_id uuid,
  transaction_type text NOT NULL DEFAULT 'unknown',
  reason text,
  fer_before double precision,
  silice_before double precision,
  xenogas_before double precision,
  energy_before double precision,
  fer_after double precision,
  silice_after double precision,
  xenogas_after double precision,
  energy_after double precision,
  fer_delta double precision,
  silice_delta double precision,
  xenogas_delta double precision,
  energy_delta double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_transactions_planet_id
  ON resource_transactions(planet_id);
CREATE INDEX IF NOT EXISTS idx_resource_transactions_player_id
  ON resource_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_resource_transactions_created_at
  ON resource_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_resource_transactions_type
  ON resource_transactions(transaction_type);

-- =============================================================
-- 2. TRIGGER FUNCTION: log_resource_changes
-- =============================================================
-- Loggue automatiquement toute modification de fer, silice,
-- xenogas ou energy dans planet_resources.
-- Le transaction_type et reason peuvent etre passes via
-- current_setting('app.resource_tx_type') et
-- current_setting('app.resource_tx_reason').
-- Si non definis, utilise 'auto' / NULL.
-- =============================================================
CREATE OR REPLACE FUNCTION log_resource_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_player_id uuid;
  v_tx_type text;
  v_tx_reason text;
  v_fer_changed boolean;
  v_silice_changed boolean;
  v_xenogas_changed boolean;
  v_energy_changed boolean;
BEGIN
  v_fer_changed := COALESCE(OLD.fer, 0) IS DISTINCT FROM COALESCE(NEW.fer, 0);
  v_silice_changed := COALESCE(OLD.silice, 0) IS DISTINCT FROM COALESCE(NEW.silice, 0);
  v_xenogas_changed := COALESCE(OLD.xenogas, 0) IS DISTINCT FROM COALESCE(NEW.xenogas, 0);
  v_energy_changed := COALESCE(OLD.energy, 0) IS DISTINCT FROM COALESCE(NEW.energy, 0);

  IF NOT (v_fer_changed OR v_silice_changed OR v_xenogas_changed OR v_energy_changed) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_tx_type := current_setting('app.resource_tx_type', true);
  EXCEPTION WHEN OTHERS THEN
    v_tx_type := NULL;
  END;

  BEGIN
    v_tx_reason := current_setting('app.resource_tx_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_tx_reason := NULL;
  END;

  IF v_tx_type IS NULL OR v_tx_type = '' THEN
    v_tx_type := 'auto';
  END IF;

  SELECT user_id INTO v_player_id
  FROM planets
  WHERE id = NEW.planet_id;

  INSERT INTO resource_transactions (
    planet_id, player_id, transaction_type, reason,
    fer_before, silice_before, xenogas_before, energy_before,
    fer_after, silice_after, xenogas_after, energy_after,
    fer_delta, silice_delta, xenogas_delta, energy_delta
  ) VALUES (
    NEW.planet_id, v_player_id, v_tx_type, v_tx_reason,
    COALESCE(OLD.fer, 0), COALESCE(OLD.silice, 0), COALESCE(OLD.xenogas, 0), COALESCE(OLD.energy, 0),
    COALESCE(NEW.fer, 0), COALESCE(NEW.silice, 0), COALESCE(NEW.xenogas, 0), COALESCE(NEW.energy, 0),
    COALESCE(NEW.fer, 0) - COALESCE(OLD.fer, 0),
    COALESCE(NEW.silice, 0) - COALESCE(OLD.silice, 0),
    COALESCE(NEW.xenogas, 0) - COALESCE(OLD.xenogas, 0),
    COALESCE(NEW.energy, 0) - COALESCE(OLD.energy, 0)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_log_resource_changes ON planet_resources;
CREATE TRIGGER trg_log_resource_changes
  AFTER UPDATE ON planet_resources
  FOR EACH ROW
  EXECUTE FUNCTION log_resource_changes();

-- Also log INSERT (new planets get initial resources)
DROP TRIGGER IF EXISTS trg_log_resource_insert ON planet_resources;
CREATE TRIGGER trg_log_resource_insert
  AFTER INSERT ON planet_resources
  FOR EACH ROW
  EXECUTE FUNCTION log_resource_changes();

-- =============================================================
-- 3. HELPER: set_resource_tx_context
-- =============================================================
-- Permet aux RPC de tagger le type de transaction avant
-- de modifier planet_resources. Le trigger lira ces valeurs.
-- =============================================================
CREATE OR REPLACE FUNCTION set_resource_tx_context(
  p_type text,
  p_reason text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.resource_tx_type', p_type, true);
  PERFORM set_config('app.resource_tx_reason', COALESCE(p_reason, ''), true);
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 4. add_resources_to_planet (SECURED)
-- =============================================================
-- Ajoute des ressources a une planete avec verrouillage FOR UPDATE.
-- Utilisee par: retour de flotte, transport, recyclage, station.
--
-- SECURITE:
-- - SELECT ... FOR UPDATE sur planet_resources avant modification
-- - Met a jour planets.last_update dans la meme transaction
-- - Ne recoit PAS de valeurs "calculees par le client" pour les
--   couts; ici on ajoute des quantites absolues (loot, transport)
-- - Doit etre appelee dans un contexte authentifie (RPC securisee)
-- =============================================================
CREATE OR REPLACE FUNCTION add_resources_to_planet(
  p_planet_id uuid,
  p_fer double precision DEFAULT 0,
  p_silice double precision DEFAULT 0,
  p_xenogas double precision DEFAULT 0
) RETURNS json AS $$
DECLARE
  v_res record;
  v_now bigint;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  PERFORM set_resource_tx_context('add_resources', 'transport/return/station');

  SELECT fer, silice, xenogas, energy INTO v_res
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

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'fer', COALESCE(v_res.fer, 0) + GREATEST(0, p_fer),
    'silice', COALESCE(v_res.silice, 0) + GREATEST(0, p_silice),
    'xenogas', COALESCE(v_res.xenogas, 0) + GREATEST(0, p_xenogas)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 5. apply_attack_loot (SECURED)
-- =============================================================
-- Deduit le butin d'une attaque sur la planete cible,
-- applique les pertes de vaisseaux et defenses,
-- et reconstruit partiellement les defenses.
--
-- SECURITE:
-- - SELECT ... FOR UPDATE sur planet_resources avant modification
-- - Les ressources ne peuvent pas devenir negatives (GREATEST(0,...))
-- - Met a jour planets.last_update dans la meme transaction
-- - Ne recoit PAS de valeurs de ressources client; le loot est
--   calcule cote serveur par simulateCombat dans worldTick.ts
-- - Doit etre appelee dans un contexte authentifie
-- =============================================================
CREATE OR REPLACE FUNCTION apply_attack_loot(
  p_planet_id uuid,
  p_loot_fer double precision DEFAULT 0,
  p_loot_silice double precision DEFAULT 0,
  p_loot_xenogas double precision DEFAULT 0,
  p_ship_losses jsonb DEFAULT '{}'::jsonb,
  p_defense_losses jsonb DEFAULT '{}'::jsonb,
  p_defense_rebuilds jsonb DEFAULT '{}'::jsonb
) RETURNS json AS $$
DECLARE
  v_res record;
  v_now bigint;
  v_key text;
  v_val jsonb;
  v_loss_qty integer;
  v_rebuild_qty integer;
  v_current_qty integer;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  PERFORM set_resource_tx_context('attack_loot', 'combat_deduction');

  SELECT fer, silice, xenogas, energy INTO v_res
  FROM planet_resources
  WHERE planet_id = p_planet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Planet resources not found');
  END IF;

  UPDATE planet_resources
  SET fer = GREATEST(0, COALESCE(v_res.fer, 0) - GREATEST(0, p_loot_fer)),
      silice = GREATEST(0, COALESCE(v_res.silice, 0) - GREATEST(0, p_loot_silice)),
      xenogas = GREATEST(0, COALESCE(v_res.xenogas, 0) - GREATEST(0, p_loot_xenogas))
  WHERE planet_id = p_planet_id;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_ship_losses)
  LOOP
    v_loss_qty := (v_val::text)::integer;
    IF v_loss_qty <= 0 THEN CONTINUE; END IF;

    SELECT quantity INTO v_current_qty
    FROM planet_ships
    WHERE planet_id = p_planet_id AND ship_id = v_key
    FOR UPDATE;

    IF v_current_qty IS NOT NULL THEN
      UPDATE planet_ships
      SET quantity = GREATEST(0, v_current_qty - v_loss_qty)
      WHERE planet_id = p_planet_id AND ship_id = v_key;
    END IF;
  END LOOP;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_defense_losses)
  LOOP
    v_loss_qty := (v_val::text)::integer;
    IF v_loss_qty <= 0 THEN CONTINUE; END IF;

    v_rebuild_qty := COALESCE((p_defense_rebuilds->>v_key)::integer, 0);

    SELECT quantity INTO v_current_qty
    FROM planet_defenses
    WHERE planet_id = p_planet_id AND defense_id = v_key
    FOR UPDATE;

    IF v_current_qty IS NOT NULL THEN
      UPDATE planet_defenses
      SET quantity = GREATEST(0, v_current_qty - v_loss_qty + v_rebuild_qty)
      WHERE planet_id = p_planet_id AND defense_id = v_key;
    END IF;
  END LOOP;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 6. materialize_planet_resources (SECURED)
-- =============================================================
-- Materialise la production de ressources accumulee depuis le
-- dernier last_update. Utilisee par le worldTick pour mettre
-- a jour periodiquement les planetes.
--
-- SECURITE:
-- - SELECT ... FOR UPDATE sur planet_resources
-- - Calcule la production via calc_planet_economy (serveur)
-- - Respecte les limites de stockage
-- - Met a jour planets.last_update atomiquement
-- - Ne recoit AUCUNE valeur de production du client
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
  v_new_fer double precision;
  v_new_silice double precision;
  v_new_xenogas double precision;
BEGIN
  v_now := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  PERFORM set_resource_tx_context('production', 'world_tick_materialize');

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

  SELECT fer, silice, xenogas, energy INTO v_res
  FROM planet_resources
  WHERE planet_id = p_planet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO planet_resources (planet_id, fer, silice, xenogas, energy)
    VALUES (p_planet_id, 500, 300, 0, v_econ.energy_net);
    UPDATE planets SET last_update = v_now WHERE id = p_planet_id;
    RETURN json_build_object('success', true, 'created', true);
  END IF;

  v_new_fer := CASE WHEN v_res.fer >= v_econ.storage_fer THEN v_res.fer
    ELSE LEAST(v_res.fer + (v_econ.prod_fer_h / 3600.0) * v_elapsed, v_econ.storage_fer) END;
  v_new_silice := CASE WHEN v_res.silice >= v_econ.storage_silice THEN v_res.silice
    ELSE LEAST(v_res.silice + (v_econ.prod_silice_h / 3600.0) * v_elapsed, v_econ.storage_silice) END;
  v_new_xenogas := CASE WHEN v_res.xenogas >= v_econ.storage_xenogas THEN v_res.xenogas
    ELSE LEAST(v_res.xenogas + (v_econ.prod_xenogas_h / 3600.0) * v_elapsed, v_econ.storage_xenogas) END;

  UPDATE planet_resources
  SET fer = v_new_fer,
      silice = v_new_silice,
      xenogas = v_new_xenogas,
      energy = v_econ.energy_net
  WHERE planet_id = p_planet_id;

  UPDATE planets SET last_update = v_now WHERE id = p_planet_id;

  RETURN json_build_object(
    'success', true,
    'fer', v_new_fer,
    'silice', v_new_silice,
    'xenogas', v_new_xenogas,
    'energy', v_econ.energy_net
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 7. Purge old resource_transactions (maintenance)
-- =============================================================
-- Supprime les logs de plus de 30 jours. A appeler periodiquement
-- (via cron pg_cron ou manuellement).
-- =============================================================
CREATE OR REPLACE FUNCTION purge_old_resource_transactions(
  p_days integer DEFAULT 30
) RETURNS integer AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM resource_transactions
  WHERE created_at < now() - (p_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;
