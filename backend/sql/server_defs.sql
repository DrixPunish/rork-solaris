-- =============================================================
-- SERVER-SIDE GAME DEFINITIONS & CALCULATION FUNCTIONS
-- Run this BEFORE rpc_functions.sql in Supabase SQL Editor
-- =============================================================

-- 1. DEFINITION TABLES
-- =============================================================

CREATE TABLE IF NOT EXISTS building_defs (
  building_id text PRIMARY KEY,
  base_cost_fer double precision NOT NULL DEFAULT 0,
  base_cost_silice double precision NOT NULL DEFAULT 0,
  base_cost_xenogas double precision NOT NULL DEFAULT 0,
  cost_factor double precision NOT NULL DEFAULT 1.5,
  base_time double precision NOT NULL DEFAULT 30,
  time_factor double precision NOT NULL DEFAULT 1.8
);

CREATE TABLE IF NOT EXISTS research_defs (
  research_id text PRIMARY KEY,
  base_cost_fer double precision NOT NULL DEFAULT 0,
  base_cost_silice double precision NOT NULL DEFAULT 0,
  base_cost_xenogas double precision NOT NULL DEFAULT 0,
  cost_factor double precision NOT NULL DEFAULT 2,
  base_time double precision NOT NULL DEFAULT 120,
  time_factor double precision NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS ship_defs (
  ship_id text PRIMARY KEY,
  cost_fer double precision NOT NULL DEFAULT 0,
  cost_silice double precision NOT NULL DEFAULT 0,
  cost_xenogas double precision NOT NULL DEFAULT 0,
  build_time double precision NOT NULL DEFAULT 30,
  base_attack double precision NOT NULL DEFAULT 0,
  base_shield double precision NOT NULL DEFAULT 0,
  base_hull double precision NOT NULL DEFAULT 0,
  base_speed double precision NOT NULL DEFAULT 0,
  base_cargo double precision NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS defense_defs (
  defense_id text PRIMARY KEY,
  cost_fer double precision NOT NULL DEFAULT 0,
  cost_silice double precision NOT NULL DEFAULT 0,
  cost_xenogas double precision NOT NULL DEFAULT 0,
  build_time double precision NOT NULL DEFAULT 15,
  base_attack double precision NOT NULL DEFAULT 0,
  base_shield double precision NOT NULL DEFAULT 0,
  base_hull double precision NOT NULL DEFAULT 0
);

-- 2. SEED DATA
-- =============================================================

INSERT INTO building_defs (building_id, base_cost_fer, base_cost_silice, base_cost_xenogas, cost_factor, base_time, time_factor) VALUES
  ('ferMine',          60,      15,      0,       1.5, 30,   1.8),
  ('siliceMine',       48,      24,      0,       1.6, 40,   1.8),
  ('xenogasRefinery',  225,     75,      0,       1.5, 60,   1.8),
  ('solarPlant',       75,      30,      0,       1.5, 30,   1.8),
  ('ferroStore',       1000,    0,       0,       2,   40,   1.8),
  ('silicaStore',      1000,    500,     0,       2,   40,   1.8),
  ('xenoStore',        1000,    1000,    0,       2,   50,   1.8),
  ('roboticsFactory',  400,     120,     200,     2,   120,  2),
  ('shipyard',         400,     200,     100,     2,   120,  2),
  ('researchLab',      200,     400,     200,     2,   150,  2),
  ('naniteFactory',    1000000, 500000,  100000,  2,   3600, 2),
  ('geoformEngine',    0,       50000,   100000,  2,   7200, 2)
ON CONFLICT (building_id) DO UPDATE SET
  base_cost_fer = EXCLUDED.base_cost_fer,
  base_cost_silice = EXCLUDED.base_cost_silice,
  base_cost_xenogas = EXCLUDED.base_cost_xenogas,
  cost_factor = EXCLUDED.cost_factor,
  base_time = EXCLUDED.base_time,
  time_factor = EXCLUDED.time_factor;

INSERT INTO research_defs (research_id, base_cost_fer, base_cost_silice, base_cost_xenogas, cost_factor, base_time, time_factor) VALUES
  ('quantumFlux',      0,      800,    400,    2,    120,  2),
  ('particleBeam',     200,    100,    0,      2,    90,   2),
  ('ionicStream',      1000,   300,    100,    2,    150,  2),
  ('plasmaOverdrive',  2000,   4000,   1000,   2,    300,  2),
  ('weaponsTech',      800,    200,    0,      2,    150,  2),
  ('shieldTech',       200,    600,    0,      2,    150,  2),
  ('armorTech',        1000,   0,      0,      2,    120,  2),
  ('chemicalDrive',    400,    600,    0,      2,    180,  2),
  ('impulseReactor',   2000,   4000,   600,    2,    300,  2),
  ('voidDrive',        10000,  20000,  6000,   2,    600,  2),
  ('computerTech',     0,      400,    600,    2,    120,  2),
  ('espionageTech',    200,    1000,   200,    2,    120,  2),
  ('astrophysics',     4000,   8000,   4000,   1.75, 600,  2),
  ('subspacialNodes',  0,      4000,   2000,   2,    300,  2),
  ('neuralMesh',       240000, 400000, 160000, 2,    600,  2),
  ('gravitonTech',     0,      0,      0,      3,    3600, 3)
ON CONFLICT (research_id) DO UPDATE SET
  base_cost_fer = EXCLUDED.base_cost_fer,
  base_cost_silice = EXCLUDED.base_cost_silice,
  base_cost_xenogas = EXCLUDED.base_cost_xenogas,
  cost_factor = EXCLUDED.cost_factor,
  base_time = EXCLUDED.base_time,
  time_factor = EXCLUDED.time_factor;

INSERT INTO ship_defs (ship_id, cost_fer, cost_silice, cost_xenogas, build_time, base_attack, base_shield, base_hull, base_speed, base_cargo) VALUES
  ('novaScout',        3000,    1000,    0,       30,   50,     10,     400,     12500,     50),
  ('ferDeLance',       6000,    4000,    0,       60,   150,    25,     1000,    10000,     100),
  ('cyclone',          20000,   7000,    2000,    120,  400,    50,     2700,    15000,     800),
  ('bastion',          45000,   15000,   0,       180,  1000,   200,    6000,    10000,     1500),
  ('pyro',             50000,   25000,   15000,   240,  1000,   500,    7500,    4000,      500),
  ('nemesis',          30000,   40000,   15000,   180,  700,    400,    7000,    10000,     750),
  ('fulgurant',        60000,   50000,   15000,   300,  2000,   500,    11000,   5000,      2000),
  ('titanAstral',      5000000, 4000000, 1000000, 3600, 200000, 50000,  900000,  100,       1000000),
  ('atlasCargo',       2000,    2000,    0,       20,   5,      10,     400,     10000,     5000),
  ('atlasCargoXL',     6000,    6000,    0,       40,   5,      25,     1200,    7500,      25000),
  ('colonyShip',       10000,   20000,   10000,   300,  50,     100,    3000,    2500,      7500),
  ('mantaRecup',       10000,   6000,    2000,    60,   1,      10,     1600,    2000,      20000),
  ('spectreSonde',     0,       1000,    0,       10,   0,      0,      100,     100000000, 0),
  ('heliosRemorqueur', 0,       2000,    500,     10,   1,      1,      200,     0,         0)
ON CONFLICT (ship_id) DO UPDATE SET
  cost_fer = EXCLUDED.cost_fer,
  cost_silice = EXCLUDED.cost_silice,
  cost_xenogas = EXCLUDED.cost_xenogas,
  build_time = EXCLUDED.build_time,
  base_attack = EXCLUDED.base_attack,
  base_shield = EXCLUDED.base_shield,
  base_hull = EXCLUDED.base_hull,
  base_speed = EXCLUDED.base_speed,
  base_cargo = EXCLUDED.base_cargo;

INSERT INTO defense_defs (defense_id, cost_fer, cost_silice, cost_xenogas, build_time, base_attack, base_shield, base_hull) VALUES
  ('kineticTurret', 2000,  0,     0,     15,  80,   20,    200),
  ('pulseCannon',   1500,  500,   0,     20,  100,  25,    250),
  ('beamCannon',    6000,  2000,  0,     30,  250,  100,   800),
  ('massDriver',    20000, 15000, 2000,  60,  1100, 200,   3500),
  ('ionProjector',  5000,  3000,  0,     30,  150,  500,   800),
  ('solarCannon',   50000, 50000, 30000, 120, 3000, 300,   10000),
  ('smallShield',   10000, 10000, 0,     120, 1,    2000,  2000),
  ('largeShield',   50000, 50000, 0,     300, 1,    10000, 10000)
ON CONFLICT (defense_id) DO UPDATE SET
  cost_fer = EXCLUDED.cost_fer,
  cost_silice = EXCLUDED.cost_silice,
  cost_xenogas = EXCLUDED.cost_xenogas,
  build_time = EXCLUDED.build_time,
  base_attack = EXCLUDED.base_attack,
  base_shield = EXCLUDED.base_shield,
  base_hull = EXCLUDED.base_hull;

-- 3. HELPER: Storage capacity for a given storage building level
-- =============================================================
CREATE OR REPLACE FUNCTION calc_storage_cap(p_level int)
RETURNS double precision AS $$
BEGIN
  RETURN 5000.0 * FLOOR(2.5 * EXP(20.0 * p_level / 33.0));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. HELPER: Effective lab level with Neural Mesh
-- =============================================================
CREATE OR REPLACE FUNCTION calc_effective_lab_level(
  p_user_id uuid,
  p_planet_id uuid
) RETURNS int AS $$
DECLARE
  v_lab_level int;
  v_neural_mesh int;
  v_other_levels int[];
  v_total int;
  v_i int;
BEGIN
  v_lab_level := COALESCE(
    (SELECT level FROM planet_buildings WHERE planet_id = p_planet_id AND building_id = 'researchLab'),
    0
  );
  v_neural_mesh := COALESCE(
    (SELECT level FROM player_research WHERE user_id = p_user_id AND research_id = 'neuralMesh'),
    0
  );

  IF v_neural_mesh <= 0 THEN
    RETURN v_lab_level;
  END IF;

  SELECT ARRAY(
    SELECT COALESCE(pb.level, 0)
    FROM planets p
    LEFT JOIN planet_buildings pb ON pb.planet_id = p.id AND pb.building_id = 'researchLab'
    WHERE p.user_id = p_user_id AND p.id != p_planet_id AND COALESCE(pb.level, 0) > 0
    ORDER BY COALESCE(pb.level, 0) DESC
  ) INTO v_other_levels;

  v_total := v_lab_level;
  FOR v_i IN 1..LEAST(v_neural_mesh, COALESCE(array_length(v_other_levels, 1), 0)) LOOP
    v_total := v_total + v_other_levels[v_i];
  END LOOP;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. HELPER: Planet economy (production rates, storage caps, net energy)
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
  OUT energy_net double precision
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

  SELECT
    COALESCE(MAX(CASE WHEN research_id = 'quantumFlux' THEN level END), 0),
    COALESCE(MAX(CASE WHEN research_id = 'plasmaOverdrive' THEN level END), 0)
  INTO v_quantum_flux, v_plasma
  FROM player_research
  WHERE user_id = p_user_id
    AND research_id IN ('quantumFlux','plasmaOverdrive');

  SELECT COALESCE(quantity, 0) INTO v_helios
  FROM planet_ships
  WHERE planet_id = p_planet_id AND ship_id = 'heliosRemorqueur';
  IF NOT FOUND THEN v_helios := 0; END IF;

  SELECT production_percentages INTO v_pct
  FROM planets WHERE id = p_planet_id;

  IF v_pct IS NOT NULL THEN
    v_pct_fer := COALESCE((v_pct->>'ferMine')::double precision, 100);
    v_pct_silice := COALESCE((v_pct->>'siliceMine')::double precision, 100);
    v_pct_xenogas := COALESCE((v_pct->>'xenogasRefinery')::double precision, 100);
    v_pct_solar := COALESCE((v_pct->>'solarPlant')::double precision, 100);
    v_pct_helios := COALESCE((v_pct->>'heliosRemorqueur')::double precision, 100);
  END IF;

  v_energy_prod := FLOOR(20.0 * v_solar_plant * POWER(1.1, v_solar_plant) * (1.0 + v_quantum_flux * 0.05) * (v_pct_solar / 100.0))
                 + FLOOR(v_helios * 30.0 * (v_pct_helios / 100.0));

  v_energy_cons := FLOOR(10.0 * v_fer_mine * POWER(1.1, v_fer_mine) * (v_pct_fer / 100.0))
                 + FLOOR(10.0 * v_silice_mine * POWER(1.1, v_silice_mine) * (v_pct_silice / 100.0))
                 + FLOOR(20.0 * v_xenogas_ref * POWER(1.1, v_xenogas_ref) * (v_pct_xenogas / 100.0));

  IF v_energy_cons > 0 THEN
    v_ratio := LEAST(1.0, v_energy_prod / v_energy_cons);
  ELSE
    v_ratio := 1.0;
  END IF;

  prod_fer_h := 10 + FLOOR(30.0 * v_fer_mine * POWER(1.1, v_fer_mine) * v_ratio * (v_pct_fer / 100.0) * (1.0 + v_plasma * 0.01));
  prod_silice_h := 5 + FLOOR(20.0 * v_silice_mine * POWER(1.1, v_silice_mine) * v_ratio * (v_pct_silice / 100.0) * (1.0 + v_plasma * 0.0066));
  prod_xenogas_h := FLOOR(10.0 * v_xenogas_ref * POWER(1.1, v_xenogas_ref) * v_ratio * (v_pct_xenogas / 100.0) * (1.0 + v_plasma * 0.0033));

  storage_fer := calc_storage_cap(v_ferro_store);
  storage_silice := calc_storage_cap(v_silica_store);
  storage_xenogas := calc_storage_cap(v_xeno_store);

  energy_net := v_energy_prod - v_energy_cons;
END;
$$ LANGUAGE plpgsql STABLE;
