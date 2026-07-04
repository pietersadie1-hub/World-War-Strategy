/* ============ config.js — game data: terrain, buildings, units, balance ============ */
window.RTS = window.RTS || {};

RTS.config = (function () {
  'use strict';

  const TILE_W = 64;          // isometric tile width  (px at zoom 1)
  const TILE_H = 32;          // isometric tile height (~30° projection)
  const MAP_W = 96;
  const MAP_H = 96;
  const SIM_DT = 1 / 20;      // fixed simulation step (20 Hz)
  const NET_DELAY_TICKS = 4;  // command latency buffer for multiplayer

  const T = { WATER: 0, RIVER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6 };

  /* Ground movement cost per tile type (Infinity = impassable). Roads,
     bridges and dam crests override with ROAD_COST. */
  const MOVE_COST = {};
  MOVE_COST[T.WATER] = Infinity;
  MOVE_COST[T.RIVER] = Infinity;
  MOVE_COST[T.SAND] = 1.15;
  MOVE_COST[T.GRASS] = 1.0;
  MOVE_COST[T.FOREST] = 1.9;
  MOVE_COST[T.HILL] = 1.7;
  MOVE_COST[T.MOUNTAIN] = Infinity;
  const ROAD_COST = 0.6;

  const PLAYER_COLORS = [
    { main: '#3f7fe0', dark: '#274f92', light: '#8ab4f2', name: 'Blue' },
    { main: '#e05038', dark: '#8e2c1d', light: '#f2937f', name: 'Red' }
  ];
  const NEUTRAL_COLOR = { main: '#8b8f96', dark: '#565a61', light: '#c2c6cc', name: 'Neutral' };

  /* ---------- Buildings ----------
     provides: resource income per second while powered & complete
     energyUse: passive energy drain per second
     place: 'land' | 'deposit' | 'shore' | 'river'                       */
  const BUILDINGS = {
    hq: {
      name: 'Headquarters', w: 3, h: 3, hp: 2600, sight: 9, buildTime: 90,
      cost: { m: 600, e: 200, w: 0 }, provides: { m: 0.6, e: 1.0, w: 0.4 }, energyUse: 0,
      place: 'land', trains: ['worker'], desc: 'Command center. Trains Engineers. Lose it and the war is over.'
    },
    power: {
      name: 'Power Plant', w: 2, h: 2, hp: 750, sight: 6, buildTime: 18,
      cost: { m: 90, e: 0, w: 0 }, provides: { e: 6 }, energyUse: 0,
      place: 'land', desc: 'Generates energy for your war machine.'
    },
    mine: {
      name: 'Mineral Mine', w: 2, h: 2, hp: 850, sight: 6, buildTime: 22,
      cost: { m: 110, e: 0, w: 0 }, provides: { m: 5 }, energyUse: 0.5,
      place: 'deposit', desc: 'Extracts minerals. Must be built on a mineral field ◆.'
    },
    pump: {
      name: 'Water Pump', w: 2, h: 2, hp: 650, sight: 6, buildTime: 16,
      cost: { m: 70, e: 0, w: 0 }, provides: { w: 4 }, energyUse: 0.3,
      place: 'shore', desc: 'Pumps fresh water. Build beside a river or lake.'
    },
    dam: {
      name: 'Hydro Dam', w: 2, h: 2, hp: 1800, sight: 7, buildTime: 45,
      cost: { m: 320, e: 100, w: 0 }, provides: { e: 15, w: 2 }, energyUse: 0,
      place: 'river', desc: 'Massive energy from the river — and doubles as a crossing.'
    },
    barracks: {
      name: 'Barracks', w: 2, h: 2, hp: 950, sight: 6, buildTime: 20,
      cost: { m: 130, e: 40, w: 0 }, provides: {}, energyUse: 0.5,
      place: 'land', trains: ['infantry', 'rocket'], desc: 'Trains infantry squads.'
    },
    factory: {
      name: 'War Factory', w: 3, h: 2, hp: 1300, sight: 6, buildTime: 30,
      cost: { m: 220, e: 90, w: 0 }, provides: {}, energyUse: 1.0,
      place: 'land', trains: ['tank', 'artillery'], desc: 'Produces armored vehicles.'
    },
    airfield: {
      name: 'Airfield', w: 3, h: 2, hp: 1100, sight: 7, buildTime: 34,
      cost: { m: 280, e: 130, w: 0 }, provides: {}, energyUse: 1.5,
      place: 'land', trains: ['gunship'], desc: 'Builds and services gunships.'
    },
    turret: {
      name: 'Guard Turret', w: 1, h: 1, hp: 620, sight: 8, buildTime: 14,
      cost: { m: 100, e: 35, w: 0 }, provides: {}, energyUse: 0.8,
      place: 'land', weapon: { dmg: 26, range: 6.5, rof: 1.4, projectile: 'shell' },
      desc: 'Automated defense cannon.'
    },
    house: { /* neutral town building — capturable */
      name: 'Town House', w: 1, h: 1, hp: 420, sight: 4, buildTime: 10,
      cost: { m: 0 }, provides: { m: 0.7 }, energyUse: 0,
      place: 'land', neutral: true, desc: 'Civilian structure. Capture with an Engineer for tax income.'
    },
    depot: {
      name: 'Supply Depot', w: 2, h: 2, hp: 700, sight: 5, buildTime: 12,
      cost: { m: 0 }, provides: { m: 1.4, w: 0.6 }, energyUse: 0,
      place: 'land', neutral: true, desc: 'Town warehouse. Capture for supplies.'
    }
  };

  /* Buildable list for the player's build menu (order matters). */
  const BUILD_MENU = ['power', 'mine', 'pump', 'barracks', 'factory', 'airfield', 'turret', 'dam'];

  /* ---------- Units ---------- */
  const UNITS = {
    worker: {
      name: 'Engineer', hp: 60, speed: 2.3, sight: 6, buildTime: 8, radius: 0.28,
      cost: { m: 40, e: 0, w: 15 }, air: false,
      desc: 'Builds, repairs and captures neutral structures.'
    },
    infantry: {
      name: 'Rifle Squad', hp: 85, speed: 1.9, sight: 6, buildTime: 6, radius: 0.26,
      cost: { m: 35, e: 0, w: 15 }, air: false,
      weapon: { dmg: 8, range: 3.2, rof: 0.9, projectile: 'bullet' },
      desc: 'Cheap, versatile foot soldiers.'
    },
    rocket: {
      name: 'Rocket Team', hp: 70, speed: 1.75, sight: 6.5, buildTime: 9, radius: 0.26,
      cost: { m: 55, e: 15, w: 15 }, air: false,
      weapon: { dmg: 22, range: 4.4, rof: 2.0, projectile: 'rocket', bonusVsBuilding: 1.6 },
      desc: 'Anti-armor and siege infantry.'
    },
    tank: {
      name: 'Battle Tank', hp: 280, speed: 2.7, sight: 7, buildTime: 14, radius: 0.36,
      cost: { m: 130, e: 60, w: 0 }, air: false,
      weapon: { dmg: 32, range: 4.6, rof: 1.7, projectile: 'shell' },
      desc: 'Main line armor. Loves roads.'
    },
    artillery: {
      name: 'Artillery', hp: 130, speed: 1.6, sight: 7, buildTime: 18, radius: 0.36,
      cost: { m: 190, e: 95, w: 0 }, air: false,
      weapon: { dmg: 62, range: 8.2, minRange: 2.5, rof: 3.8, projectile: 'arc', splash: 1.4 },
      desc: 'Long-range bombardment. Fragile up close.'
    },
    gunship: {
      name: 'Gunship', hp: 190, speed: 4.3, sight: 8, buildTime: 16, radius: 0.34,
      cost: { m: 210, e: 120, w: 25 }, air: true,
      weapon: { dmg: 24, range: 4.2, rof: 1.1, projectile: 'rocket' },
      desc: 'Fast attack aircraft. Ignores terrain.'
    }
  };

  const ECON = {
    startRes: { m: 420, e: 160, w: 110 },
    roadCostPerTile: 6,       // minerals
    bridgeCostPerTile: 30,    // road over river/water
    buildRadius: 11,          // must build within N tiles of an own building
    captureTime: 4,           // seconds an engineer channels to capture
    lowPowerFactor: 0.45,     // production speed multiplier when energy is empty
    repairHpPerSec: 14,
    repairCostPerHp: 0.25
  };

  const DIFFICULTY = {
    easy:   { income: 0.8, wave: 150, waveSize: 0.7, name: 'Easy' },
    normal: { income: 1.0, wave: 115, waveSize: 1.0, name: 'Normal' },
    hard:   { income: 1.35, wave: 85, waveSize: 1.45, name: 'Hard' }
  };

  const DAY_LENGTH = 190;     // seconds for a full day/night cycle

  return {
    TILE_W: TILE_W, TILE_H: TILE_H, MAP_W: MAP_W, MAP_H: MAP_H,
    SIM_DT: SIM_DT, NET_DELAY_TICKS: NET_DELAY_TICKS,
    T: T, MOVE_COST: MOVE_COST, ROAD_COST: ROAD_COST,
    PLAYER_COLORS: PLAYER_COLORS, NEUTRAL_COLOR: NEUTRAL_COLOR,
    BUILDINGS: BUILDINGS, BUILD_MENU: BUILD_MENU, UNITS: UNITS,
    ECON: ECON, DIFFICULTY: DIFFICULTY, DAY_LENGTH: DAY_LENGTH
  };
})();
