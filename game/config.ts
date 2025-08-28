
export const CONFIG = {
    PLAYER: {
        HP: 100,
        SPEED: 7,
        SPRINT_SPEED: 12,
        JUMP_FORCE: 8,
        STAMINA: 100,
        STAMINA_COST: 25,
        STAMINA_REGEN: 35,
        DAMAGE_IMMUNITY: 0.5, // seconds
        ADS_FOV: 55,
        ADS_SPEED_MULTIPLIER: 0.6,
    },
    WEAPON: {
        '1': {
            DAMAGE: 10,
            MAGAZINE_SIZE: 30,
            INITIAL_RESERVE_AMMO: 90,
            PICKUP_AMMO_AMOUNT: 30,
            COOLDOWN: 0.15,
            RELOAD_TIME: 1.5,
            SPREAD: 0.015,
        },
        '2': {
            DAMAGE: 15,
            MAGAZINE_SIZE: 40,
            INITIAL_RESERVE_AMMO: 120,
            PICKUP_AMMO_AMOUNT: 40,
            COOLDOWN: 0.08,
            RELOAD_TIME: 1.2,
            SPREAD: 0.01,
        },
        LASER_MODE: {
            DAMAGE: 25,
            COOLDOWN: 0.1,
        }
    },
    MELEE: {
        DAMAGE: 35,
        RANGE: 4.5,
        COOLDOWN: 1.2,
        SWING_DURATION: 0.3,
    },
    SKILL_Q: {
        HEAL: 35,
        COOLDOWN: 20,
    },
    SKILL_Z: {
        DURATION: 5,
        COOLDOWN: 30,
        DAMAGE: 50,
        AOE_RADIUS: 5,
    },
    SHIELD: {
        DURATION: 4,
        COOLDOWN: 25,
        PICKUP_AMOUNT: 1, // Not used as count, maybe for charges later
    },
    DRONE: {
        DAMAGE: 4,
        FIRE_RATE: 0.5, // seconds between shots
        RANGE: 40,
        SPEED: 10,
    },
    ENEMY_DRONE: {
        HP: 40,
        DAMAGE: 10,
        SPEED: 3.5,
        SIZE: 2.1,
        DROP_CHANCE: 0.5,
    },
    ENEMY_SCOUT: {
        HP: 25,
        DAMAGE: 8,
        SPEED: 5.5,
        SIZE: 1.5,
        DROP_CHANCE: 0.4,
    },
    ENEMY_TANK: {
        HP: 90,
        DAMAGE: 15,
        SPEED: 2.5,
        SIZE: 2.8,
        DROP_CHANCE: 0.6,
    },
     ENEMY_KAMIKAZE: {
        HP: 10,
        DAMAGE: 40,
        SPEED: 7,
        SIZE: 1.3,
        DROP_CHANCE: 0.1,
    },
    BOSS_BASE: {
        1: { HP: 800, DAMAGE: 20, SPEED: 3, SIZE: 7.0, ATTACK_COOLDOWN: 3, BULLET_SPEED: 25, BULLET_DAMAGE: 15 },
        2: { HP: 1200, DAMAGE: 15, SPEED: 5, SIZE: 6.0, ATTACK_COOLDOWN: 2, BULLET_SPEED: 35, BULLET_DAMAGE: 15 },
        3: { HP: 2000, DAMAGE: 25, SPEED: 4, SIZE: 9.0, ATTACK_COOLDOWN: 2.5, BULLET_SPEED: 30, BULLET_DAMAGE: 20 },
        4: { HP: 3500, DAMAGE: 30, SPEED: 4.5, SIZE: 10.0, ATTACK_COOLDOWN: 4, BULLET_SPEED: 40, BULLET_DAMAGE: 25 },
        5: { HP: 10000, DAMAGE: 40, SPEED: 2, SIZE: 30.0, WEAK_POINT_HP: 500, ATTACK_COOLDOWN: 5, BULLET_SPEED: 50, BULLET_DAMAGE: 30 },
    },
    GAME: {
        MAX_LEVEL: 5,
        GRAVITY: -25,
    },
    PICKUPS: {
        HEALTH_AMOUNT: 20,
        SHIELD_CHARGE_AMOUNT: 1, // Placeholder for future use
        DROP_TYPE_WEIGHTS: { // When a drop occurs
            AMMO: 10,
            HEALTH: 4,
            // SHIELD charges can be a future pickup type
        }
    }
};