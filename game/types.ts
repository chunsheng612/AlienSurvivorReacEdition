
import type * as THREE from 'three';

export type GameState = 'start_screen' | 'playing' | 'wave_transition' | 'boss_fight' | 'game_over' | 'victory' | 'paused';

export interface SkillState {
    unlocked: boolean;
    cooldown: number;
}

export interface SkillZState {
    unlocked: boolean;
    cooldown: number;
    active: boolean;
    duration: number;
}

export interface MeleeState {
    attacking: boolean;
    cooldown: number;
    swingTime: number;
}

export interface PlayerStats {
    hp: number;
    maxHp: number;
    stamina: number;
    maxStamina: number;
    ammoInMagazine: number;
    maxAmmoInMagazine: number;
    reserveAmmo: number;
    reloading: boolean;
    reloadTime: number;
    isAiming: boolean;
    skills: {
        q: SkillState;
        z: SkillZState;
    };
    melee: MeleeState;
    lastHitTime: number;
    shield: {
        unlocked: boolean;
        cooldown: number;
        active: boolean;
        duration: number;
    };
    drone: {
        unlocked: boolean;
    };
}

export interface WaveState {
    currentLevel: number;
    killedInWave: number;
    totalToKill: number;
}

export interface BossState {
    name: string;
    hp: number;
    maxHp: number;
    isFinalBoss?: boolean;
    weakPointHp?: number;
    maxWeakPointHp?: number;
}

export type EnemyType = 'drone' | 'scout' | 'tank' | 'kamikaze';

export interface Enemy extends THREE.Group {
    hp: number;
    damage: number;
    speed: number;
    size: number;
    type: EnemyType;
}

export interface Bullet extends THREE.Mesh {
    velocity: THREE.Vector3;
    isExplosive?: boolean;
    isLaser?: boolean;
}

export interface BossBullet extends THREE.Mesh {
    velocity: THREE.Vector3;
    isLaser?: boolean;
}

export type PickupType = 'ammo' | 'health' | 'shield_charge';

export interface Pickup extends THREE.Mesh {
    type: PickupType;
    material: THREE.MeshStandardMaterial;
}

export interface Particle extends THREE.Mesh {
    velocity: THREE.Vector3;
    lifespan: number;
    material: THREE.MeshBasicMaterial;
}

export interface Grenade extends THREE.Mesh {
    velocity: THREE.Vector3;
    life: number;
}

export interface DroneBullet extends THREE.Mesh {
    velocity: THREE.Vector3;
}
