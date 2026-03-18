-- =============================================================
-- LEADERBOARD & PLAYER SCORES
-- =============================================================
--
-- Table centralisée des scores joueurs, recalculée côté serveur.
-- Les points sont calculés à partir des tables server_defs
-- (building_defs, research_defs, ship_defs, defense_defs)
-- et des données réelles en base (planet_buildings, player_research,
-- planet_ships, planet_defenses).
--
-- FORMULE: points = SUM(cost_fer + cost_silice + cost_xenogas) / 1000
--   - Bâtiments: somme des coûts cumulés niveau 0..N-1 pour TOUTES les planètes
--   - Recherches: somme des coûts cumulés niveau 0..N-1
--   - Vaisseaux: coût unitaire * quantité pour TOUTES les planètes
--   - Défenses: coût unitaire * quantité pour TOUTES les planètes
--
-- IMPORTANT: Le client ne calcule JAMAIS les scores.
-- =============================================================

CREATE TABLE IF NOT EXISTS player_scores (
  player_id uuid PRIMARY KEY REFERENCES players(user_id) ON DELETE CASCADE,
  total_points bigint NOT NULL DEFAULT 0,
  building_points bigint NOT NULL DEFAULT 0,
  research_points bigint NOT NULL DEFAULT 0,
  fleet_points bigint NOT NULL DEFAULT 0,
  defense_points bigint NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_scores_total ON player_scores(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_player_scores_updated ON player_scores(last_updated);

-- =============================================================
-- RPC: recalc_player_score
-- Recalcule les points d'un joueur depuis les données serveur.
-- Prend en compte TOUTES les planètes (main + colonies).
-- =============================================================
CREATE OR REPLACE FUNCTION recalc_player_score(p_player_id uuid)
RETURNS json AS $$
DECLARE
  v_building_raw bigint := 0;
  v_research_raw bigint := 0;
  v_fleet_raw bigint := 0;
  v_defense_raw bigint := 0;
  v_building_points bigint;
  v_research_points bigint;
  v_fleet_points bigint;
  v_defense_points bigint;
  v_total bigint;
  r record;
  i int;
  v_level_cost double precision;
BEGIN
  -- Building points: sum cost for each level 0..level-1 across ALL planets
  FOR r IN
    SELECT pb.building_id, pb.level, bd.base_cost_fer, bd.base_cost_silice, bd.base_cost_xenogas, bd.cost_factor
    FROM planet_buildings pb
    JOIN planets p ON p.id = pb.planet_id
    JOIN building_defs bd ON bd.building_id = pb.building_id
    WHERE p.user_id = p_player_id AND pb.level > 0
  LOOP
    FOR i IN 0..(r.level - 1) LOOP
      v_building_raw := v_building_raw
        + FLOOR(r.base_cost_fer * POWER(r.cost_factor, i))::bigint
        + FLOOR(r.base_cost_silice * POWER(r.cost_factor, i))::bigint
        + FLOOR(r.base_cost_xenogas * POWER(r.cost_factor, i))::bigint;
    END LOOP;
  END LOOP;

  -- Research points: sum cost for each level 0..level-1
  FOR r IN
    SELECT pr.research_id, pr.level, rd.base_cost_fer, rd.base_cost_silice, rd.base_cost_xenogas, rd.cost_factor
    FROM player_research pr
    JOIN research_defs rd ON rd.research_id = pr.research_id
    WHERE pr.user_id = p_player_id AND pr.level > 0
  LOOP
    FOR i IN 0..(r.level - 1) LOOP
      v_research_raw := v_research_raw
        + FLOOR(r.base_cost_fer * POWER(r.cost_factor, i))::bigint
        + FLOOR(r.base_cost_silice * POWER(r.cost_factor, i))::bigint
        + FLOOR(r.base_cost_xenogas * POWER(r.cost_factor, i))::bigint;
    END LOOP;
  END LOOP;

  -- Fleet points: unit cost * quantity across ALL planets
  SELECT COALESCE(SUM(
    (sd.cost_fer + sd.cost_silice + sd.cost_xenogas)::bigint * ps.quantity::bigint
  ), 0)
  INTO v_fleet_raw
  FROM planet_ships ps
  JOIN planets p ON p.id = ps.planet_id
  JOIN ship_defs sd ON sd.ship_id = ps.ship_id
  WHERE p.user_id = p_player_id AND ps.quantity > 0;

  -- Defense points: unit cost * quantity across ALL planets
  SELECT COALESCE(SUM(
    (dd.cost_fer + dd.cost_silice + dd.cost_xenogas)::bigint * pd.quantity::bigint
  ), 0)
  INTO v_defense_raw
  FROM planet_defenses pd
  JOIN planets p ON p.id = pd.planet_id
  JOIN defense_defs dd ON dd.defense_id = pd.defense_id
  WHERE p.user_id = p_player_id AND pd.quantity > 0;

  v_building_points := FLOOR(v_building_raw / 1000);
  v_research_points := FLOOR(v_research_raw / 1000);
  v_fleet_points := FLOOR(v_fleet_raw / 1000);
  v_defense_points := FLOOR(v_defense_raw / 1000);
  v_total := v_building_points + v_research_points + v_fleet_points + v_defense_points;

  INSERT INTO player_scores (player_id, total_points, building_points, research_points, fleet_points, defense_points, last_updated)
  VALUES (p_player_id, v_total, v_building_points, v_research_points, v_fleet_points, v_defense_points, now())
  ON CONFLICT (player_id) DO UPDATE SET
    total_points = EXCLUDED.total_points,
    building_points = EXCLUDED.building_points,
    research_points = EXCLUDED.research_points,
    fleet_points = EXCLUDED.fleet_points,
    defense_points = EXCLUDED.defense_points,
    last_updated = EXCLUDED.last_updated;

  RETURN json_build_object(
    'success', true,
    'player_id', p_player_id,
    'total_points', v_total,
    'building_points', v_building_points,
    'research_points', v_research_points,
    'fleet_points', v_fleet_points,
    'defense_points', v_defense_points
  );
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =============================================================
-- RPC: recalc_all_player_scores
-- Recalcule les scores de TOUS les joueurs.
-- Appelé périodiquement par le worldTick.
-- =============================================================
CREATE OR REPLACE FUNCTION recalc_all_player_scores()
RETURNS json AS $$
DECLARE
  v_player record;
  v_count int := 0;
BEGIN
  FOR v_player IN SELECT user_id FROM players LOOP
    PERFORM recalc_player_score(v_player.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('success', true, 'players_updated', v_count);
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =============================================================
-- RPC: get_leaderboard
-- Retourne le top N joueurs triés par total_points.
-- =============================================================
CREATE OR REPLACE FUNCTION get_leaderboard(p_limit int DEFAULT 100)
RETURNS json AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      ps.player_id,
      p.username,
      p.coordinates,
      ps.total_points,
      ps.building_points,
      ps.research_points,
      ps.fleet_points,
      ps.defense_points,
      ps.last_updated,
      RANK() OVER (ORDER BY ps.total_points DESC) as rank
    FROM player_scores ps
    JOIN players p ON ps.player_id = p.user_id
    ORDER BY ps.total_points DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================
-- Migration: seed player_scores for existing players
-- =============================================================
INSERT INTO player_scores (player_id, total_points, building_points, research_points, fleet_points, defense_points)
SELECT user_id, 0, 0, 0, 0, 0 FROM players
ON CONFLICT (player_id) DO NOTHING;
