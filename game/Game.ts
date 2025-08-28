
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { GoogleGenAI, Type } from "@google/genai";
import type { GameState, PlayerStats, WaveState, BossState, Enemy, EnemyType, Bullet, BossBullet, Pickup, Particle, Grenade, DroneBullet, PickupType } from './types';
import { CONFIG } from './config';
import { ExtrudeGeometry } from 'three';

type BossType = THREE.Group & {
    hp: number; maxHp: number; damage: number; speed: number; size: number; name: string;
    lastAttackTime: number; attackPattern: number; attackPhase: number; attackTimer: number;
    visuals: THREE.Group;
    // Final boss properties
    isFinalBoss?: boolean;
    weakPoint?: THREE.Mesh;
    weakPointHp?: number;
    maxWeakPointHp?: number;
    weakPointPath?: THREE.CatmullRomCurve3;
    weakPointProgress?: number;
};

interface BossIntroData {
    bossName: string;
    introMessage: string;
}

export class Game {
    private canvas: HTMLCanvasElement;
    private onStatsUpdate: (stats: PlayerStats) => void;
    private onWaveUpdate: (wave: WaveState) => void;
    private onBossUpdate: (boss: BossState | null) => void;
    private onMessage: (message: string) => void;
    private onGameOver: () => void;
    private onVictory: () => void;
    private setGameState: (state: GameState) => void;

    private renderer!: THREE.WebGLRenderer;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private composer!: EffectComposer;
    private clock = new THREE.Clock();
    
    private gameState: GameState = 'start_screen';
    private previousGameState: GameState | null = null;
    private playerObject = new THREE.Group();
    private weaponGroup = new THREE.Group();
    private meleeWeapon = new THREE.Group();
    private shieldVisual: THREE.Mesh | null = null;
    private muzzleFlash!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    private skillZLight: THREE.PointLight | null = null;
    
    private isNewGamePlus = false;
    private currentLevel = 0;
    private weaponLevel: '1' | '2' = '1';
    
    private player!: PlayerStats & { velocity: THREE.Vector3; onGround: boolean; sprinting: boolean; lastShotTime: number };
    private wave!: { totalToKill: number; killedInWave: number; spawnedInWave: number; spawnInterval: number; spawnTimer: number; maxConcurrent: number; };
    private boss: BossType | null = null;

    private keys: { [key: string]: boolean } = {};
    private enemies: Enemy[] = [];
    private bullets: Bullet[] = [];
    private bossBullets: BossBullet[] = [];
    private grenades: Grenade[] = [];
    private boundaryWalls: THREE.Mesh[] = [];
    private drone: THREE.Group | null = null;
    private droneBullets: DroneBullet[] = [];
    private droneTarget: Enemy | BossType | null = null;
    private lastDroneShotTime = 0;
    private pickups: Pickup[] = [];
    private particles: Particle[] = [];
    private expiringLights: {light: THREE.PointLight, lifespan: number, maxLifespan: number}[] = [];
    private ambientParticles: THREE.Points | null = null;
    private earth: THREE.Mesh | null = null;

    private screenShake = { intensity: 0, duration: 0, time: 0 };
    private shakeOffset = new THREE.Euler(0, 0, 0);
    private animationFrameId!: number;
    private aiClient: GoogleGenAI | null = null;

    private bobTimer = 0;
    private readonly defaultWeaponPos = new THREE.Vector3(0.5, -0.3, -1);
    private readonly adsWeaponPos = new THREE.Vector3(0, -0.25, -0.85);
    private readonly defaultFov = 75;

    constructor(
        canvas: HTMLCanvasElement,
        onStatsUpdate: (stats: PlayerStats) => void,
        onWaveUpdate: (wave: WaveState) => void,
        onBossUpdate: (boss: BossState | null) => void,
        onMessage: (message: string) => void,
        onGameOver: () => void,
        onVictory: () => void,
        setGameState: (state: GameState) => void
    ) {
        this.canvas = canvas;
        this.onStatsUpdate = onStatsUpdate;
        this.onWaveUpdate = onWaveUpdate;
        this.onBossUpdate = onBossUpdate;
        this.onMessage = onMessage;
        this.onGameOver = onGameOver;
        this.onVictory = onVictory;
        this.setGameState = setGameState;
    }

    public init() { this.setupScene(); this.addEventListeners(); this.animate(); }
    public destroy() { this.removeEventListeners(); cancelAnimationFrame(this.animationFrameId); this.renderer.dispose(); }
    
    private setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(this.defaultFov, window.innerWidth / window.innerHeight, 0.1, 3000);
        this.playerObject.add(this.camera);
        this.camera.position.y = 1.6;
        this.scene.add(this.playerObject);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene.add(new THREE.AmbientLight(0x404050, 0.8));
        const dirLight = new THREE.DirectionalLight(0xffffff, 3.5);
        dirLight.position.set(20, 30, -20);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 100; dirLight.shadow.camera.bottom = -100;
        dirLight.shadow.camera.left = -100; dirLight.shadow.camera.right = 100;
        dirLight.shadow.mapSize.width = 4096; dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.bias = -0.0001;
        this.scene.add(dirLight);
        this.addLensflare(dirLight);

        const renderPass = new RenderPass(this.scene, this.camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.6, 0.85);
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderPass);
        this.composer.addPass(bloomPass);

        const loader = new THREE.TextureLoader();
        const moonTexture = loader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg');
        moonTexture.wrapS = THREE.RepeatWrapping;
        moonTexture.wrapT = THREE.RepeatWrapping;
        moonTexture.repeat.set(16, 16);

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 0.9, metalness: 0.1 }));
        ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
        this.scene.add(ground);
        
        const grid = new THREE.GridHelper(200, 100, 0x00ffff, 0x00ffff);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.15;
        this.scene.add(grid);

        this.setupSkybox(); this.setupCraters(); this.setupAlienBase(); this.setupAmbientParticles();
        
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.3, roughness: 0.6, emissive: 0x001111, transparent: true, opacity: 0.5 });
        const wallHeight = 15, wallThickness = 2, wallLength = 202;
        const wallPositions = [
            { size: [wallLength, wallHeight, wallThickness], pos: [0, wallHeight / 2, -101] }, 
            { size: [wallLength, wallHeight, wallThickness], pos: [0, wallHeight / 2, 101] }, 
            { size: [wallThickness, wallHeight, wallLength], pos: [-101, wallHeight / 2, 0] }, 
            { size: [wallThickness, wallHeight, wallLength], pos: [101, wallHeight / 2, 0] }
        ];
        wallPositions.forEach(w => { const wall = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), wallMaterial.clone()); wall.position.set(w.pos[0], w.pos[1], w.pos[2]); wall.receiveShadow = true; this.scene.add(wall); this.boundaryWalls.push(wall); });
        
        this.setupWeapon(this.weaponLevel);
        this.setupMeleeWeapon();
        this.setupShield();
    }
    
    private setupSkybox() { const loader = new THREE.CubeTextureLoader(); const texture = loader.load([ 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_px.jpg', 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_nx.jpg', 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_py.jpg', 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_ny.jpg', 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_pz.jpg', 'https://threejs.org/examples/textures/cube/MilkyWay/dark-s_nz.jpg' ]); this.scene.background = texture; const earthTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'); const earthGeo = new THREE.SphereGeometry(80, 64, 64); const earthMat = new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.9, emissiveMap: earthTexture, emissive: 0xaaaaaa, emissiveIntensity: 0.1 }); this.earth = new THREE.Mesh(earthGeo, earthMat); this.earth.position.set(-200, 100, -300); this.scene.add(this.earth); }
    private addLensflare(light: THREE.Light) { const textureLoader = new THREE.TextureLoader(); const textureFlare0 = textureLoader.load( 'https://threejs.org/examples/textures/lensflare/lensflare0.png' ); const textureFlare3 = textureLoader.load( 'https://threejs.org/examples/textures/lensflare/lensflare3.png' ); const lensflare = new Lensflare(); lensflare.addElement( new LensflareElement( textureFlare0, 700, 0, light.color ) ); lensflare.addElement( new LensflareElement( textureFlare3, 60, 0.6 ) ); lensflare.addElement( new LensflareElement( textureFlare3, 70, 0.7 ) ); lensflare.addElement( new LensflareElement( textureFlare3, 120, 0.9 ) ); lensflare.addElement( new LensflareElement( textureFlare3, 70, 1 ) ); light.add( lensflare ); }
    private setupCraters() { const craterMat = new THREE.MeshStandardMaterial({ color: 0x555560, roughness: 0.9, metalness: 0.1 }); for(let i=0; i<30; i++) { const radius = Math.random() * 8 + 2; const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), craterMat); crater.rotation.x = -Math.PI / 2; crater.position.set((Math.random() - 0.5) * 180, 0.01, (Math.random() - 0.5) * 180); this.scene.add(crater); } }
    private setupAmbientParticles() { const particleVertices = []; for (let i = 0; i < 2000; i++) { const x = THREE.MathUtils.randFloatSpread(400); const y = THREE.MathUtils.randFloat(1, 50); const z = THREE.MathUtils.randFloatSpread(400); particleVertices.push(x, y, z); } const particleGeometry = new THREE.BufferGeometry(); particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particleVertices, 3)); const particleMaterial = new THREE.PointsMaterial({ color: 0x00ffff, size: 0.2, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending }); this.ambientParticles = new THREE.Points(particleGeometry, particleMaterial); this.scene.add(this.ambientParticles); }
    private setupAlienBase() { const buildingMat = new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.4 }); const emissiveMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1 }); for (let i = 0; i < 25; i++) { const building = new THREE.Group(); const height = Math.random() * 25 + 8; const width = Math.random() * 8 + 4; const base = new THREE.Mesh(new THREE.BoxGeometry(width, height, width, 5, 5, 5), buildingMat); base.castShadow = true; base.receiveShadow = true; building.add(base); if (Math.random() > 0.5) { const antennaHeight = Math.random() * 15 + 8; const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, antennaHeight, 16), buildingMat); antenna.position.y = height / 2 + antennaHeight / 2; const antennaTop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), emissiveMat); antennaTop.position.y = height/2 + antennaHeight; building.add(antenna, antennaTop); } building.position.set((Math.random() - 0.5) * 180, height / 2, (Math.random() - 0.5) * 180); if (building.position.length() < 30) { building.position.setLength(30 + Math.random() * 150); } this.scene.add(building); } }
    
    private setupWeapon(level: '1' | '2') {
        this.weaponGroup.clear();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x454545, metalness: 0.7, roughness: 0.4 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 });
        const emissiveMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 2 });

        if (level === '1') {
            const mainBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.9, 8, 8, 16), bodyMat); mainBody.position.z = -0.1;
            const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.5, 4, 4, 8), darkMat); handguard.position.set(0, -0.015, -0.5);
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 128), darkMat); barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.9;
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.08, 4, 8, 4), darkMat); grip.position.set(0, -0.15, 0.15); grip.rotation.x = -0.1;
            const stockBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.3), bodyMat); stockBase.position.set(0, -0.02, 0.45);
            const stockEnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), darkMat); stockEnd.position.set(0, -0.02, 0.6);
            const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.3, 4, 6, 4), darkMat); magazine.position.set(0, -0.15, -0.1); magazine.rotation.x = 0.15;
            const sightRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.4), darkMat); sightRail.position.y = 0.085;
            const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), darkMat); rearSight.position.set(0, 0.115, 0.2);
            const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), darkMat); frontSight.position.set(0, 0.08, -0.7);
            const gasBlock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), darkMat); gasBlock.position.set(0, 0.01, -0.75);
            const emissiveStrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.2), emissiveMat); emissiveStrip.position.set(0.07, 0.03, -0.3);
            const emissiveStrip2 = emissiveStrip.clone(); emissiveStrip2.position.x = -0.07;
            const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.1, 0.4), darkMat); sidePanel.position.set(0.065, 0, 0);
            const sidePanel2 = sidePanel.clone(); sidePanel2.position.x = -0.065;
            this.weaponGroup.add(mainBody, handguard, barrel, grip, stockBase, stockEnd, magazine, sightRail, rearSight, frontSight, gasBlock, emissiveStrip, emissiveStrip2, sidePanel, sidePanel2);
        } else {
            const bodyMatL2 = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
            const mainBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.8, 10, 10, 16), bodyMatL2); mainBody.position.z = 0.05;
            
            const gripGroup = new THREE.Group();
            const gripMain = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08, 6, 8, 6), darkMat);
            const gripIndent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.05), darkMat);
            gripIndent.position.y = 0.04; gripIndent.position.z = 0.02;
            gripGroup.add(gripMain, gripIndent);
            gripGroup.position.set(0, -0.12, 0.15); gripGroup.rotation.x = -0.15;

            const barrelHousing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.6, 8, 8, 12), bodyMatL2); barrelHousing.position.z = -0.4;
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 256), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1.0, roughness: 0.1 })); barrel.position.z = -0.9; barrel.rotation.x = Math.PI / 2;
            const energyCell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 128), emissiveMat); energyCell.rotation.z = Math.PI / 2; energyCell.position.set(0, 0.05, 0.1); energyCell.name = "energy_cell";
            const wing1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.3), bodyMatL2); wing1.position.set(-0.1, 0, -0.2); wing1.rotation.y = 0.3; wing1.name = "wing";
            const wing2 = wing1.clone(); wing2.position.x = 0.1; wing2.rotation.y = -0.3; wing2.name = "wing";
            const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.7), bodyMatL2); topRail.position.set(0, 0.1, -0.1);
            const sideDetail1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.2), darkMat); sideDetail1.position.set(-0.08, -0.02, -0.2); sideDetail1.rotation.y = 0.2;
            const sideDetail2 = sideDetail1.clone(); sideDetail2.position.x = 0.08; sideDetail2.rotation.y = -0.2;
            const topFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.2), bodyMatL2); topFin.position.set(0, 0.08, -0.5); topFin.rotation.x = 0.2;
            this.weaponGroup.add(mainBody, gripGroup, barrelHousing, barrel, energyCell, wing1, wing2, topRail, sideDetail1, sideDetail2, topFin);
        }

        this.skillZLight = new THREE.PointLight(0xff00ff, 0, 8, 2); // color, intensity, distance, decay
        this.skillZLight.position.set(0, 0, -0.5);
        this.weaponGroup.add(this.skillZLight);

        this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0, map: this.createMuzzleFlashTexture(), side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        this.muzzleFlash.position.z = -1.1;
        const muzzleFlashLight = new THREE.PointLight(0xffaa55, 0, 10, 2);
        muzzleFlashLight.name = 'muzzleFlashLight';
        this.muzzleFlash.add(muzzleFlashLight);

        this.weaponGroup.add(this.muzzleFlash);
        this.weaponGroup.position.copy(this.defaultWeaponPos);

        if (!this.weaponGroup.parent) {
            this.camera.add(this.weaponGroup);
        }
    }
    private setupMeleeWeapon() {
        this.meleeWeapon.clear();
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 3, metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.8 });
        const hiltMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
    
        const bladeShape = new THREE.Shape();
        bladeShape.moveTo(0, 0);
        bladeShape.lineTo(0.1, 0.2);
        bladeShape.lineTo(0.1, 1.1);
        bladeShape.lineTo(0, 1.2);
        bladeShape.lineTo(-0.1, 1.1);
        bladeShape.lineTo(-0.1, 0.2);
        bladeShape.lineTo(0, 0);
        const extrudeSettings = { depth: 0.05, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0.01, bevelThickness: 0.01 };
        const bladeGeo = new ExtrudeGeometry(bladeShape, extrudeSettings);
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = -0.05;
        
        const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.3, 32), hiltMat);
        hilt.position.y = -0.2;
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.1), hiltMat);
        guard.position.y = -0.05;
    
        this.meleeWeapon.add(blade, hilt, guard);
        this.meleeWeapon.position.set(0, -0.8, -1.2);
        this.meleeWeapon.rotation.set(0, -0.5, Math.PI / 2);
        this.meleeWeapon.visible = false;
        this.camera.add(this.meleeWeapon);
    }
    private createShieldTexture(): THREE.CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const context = canvas.getContext('2d')!;
        context.strokeStyle = 'rgba(100, 255, 255, 0.8)';
        context.lineWidth = 3;
        const hexRadius = 20; const hexHeight = hexRadius * Math.sqrt(3);
        for (let y = -hexHeight; y < canvas.height + hexHeight; y += hexHeight) {
            for (let x = -hexRadius, j = 0; x < canvas.width + hexRadius; x += hexRadius * 1.5, j++) {
                const hexX = (j % 2 === 0) ? x : x + hexRadius * 0.75;
                const hexY = y;
                context.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 3 * i;
                    const px = hexX + hexRadius * Math.cos(angle);
                    const py = hexY + hexRadius * Math.sin(angle);
                    if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
                }
                context.closePath(); context.stroke();
            }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }
    private setupShield() { 
        const shieldTexture = this.createShieldTexture();
        const shieldMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1, transparent: true, opacity: 0.3, side: THREE.FrontSide, map: shieldTexture, alphaMap: shieldTexture 
        }); 
        const shieldGeo = new THREE.SphereGeometry(2, 64, 64); 
        this.shieldVisual = new THREE.Mesh(shieldGeo, shieldMat); 
        this.shieldVisual.visible = false; this.playerObject.add(this.shieldVisual); 
    }
    private changeGameState(newState: GameState) { this.gameState = newState; this.setGameState(newState); }

    public resetGame(isNGP: boolean) {
        this.isNewGamePlus = isNGP;
        this.currentLevel = 0;
        this.weaponLevel = '1';
        this.setupWeapon('1');
        this.previousGameState = null;
        
        const weaponConfig = CONFIG.WEAPON['1'];
        this.playerObject.position.set(0, 1.6, 0);
        this.player = {
            hp: CONFIG.PLAYER.HP, maxHp: CONFIG.PLAYER.HP,
            stamina: CONFIG.PLAYER.STAMINA, maxStamina: CONFIG.PLAYER.STAMINA,
            ammoInMagazine: weaponConfig.MAGAZINE_SIZE, maxAmmoInMagazine: weaponConfig.MAGAZINE_SIZE,
            reserveAmmo: weaponConfig.INITIAL_RESERVE_AMMO,
            velocity: new THREE.Vector3(), onGround: false, sprinting: false, lastShotTime: 0,
            reloading: false, reloadTime: 0,
            isAiming: false,
            skills: { q: { unlocked: isNGP, cooldown: 0 }, z: { unlocked: isNGP, cooldown: 0, active: false, duration: 0 } },
            melee: { attacking: false, cooldown: 0, swingTime: 0 },
            lastHitTime: 0,
            shield: { unlocked: false, cooldown: 0, active: false, duration: 0 },
            drone: { unlocked: false },
        };

        this.camera.fov = this.defaultFov;
        this.camera.updateProjectionMatrix();
        this.weaponGroup.position.copy(this.defaultWeaponPos);

        [...this.enemies, ...this.bullets, ...this.bossBullets, ...this.pickups, ...this.particles, ...this.grenades, ...this.droneBullets].forEach(obj => this.scene.remove(obj));
        if (this.boss) this.scene.remove(this.boss);
        if (this.drone) this.scene.remove(this.drone);
        
        this.enemies = []; this.bullets = []; this.bossBullets = []; this.pickups = []; this.particles = []; this.grenades = []; this.droneBullets = [];
        this.boss = null; this.drone = null;
        this.onBossUpdate(null);
        
        this.startGame();
    }
    
    public togglePause() {
        if (this.gameState === 'paused') {
            if (this.previousGameState) {
                this.changeGameState(this.previousGameState);
                this.previousGameState = null;
                this.clock.start(); // Resume clock
            }
        } else if (this.gameState === 'playing' || this.gameState === 'boss_fight') {
            this.previousGameState = this.gameState;
            this.changeGameState('paused');
            this.clock.stop(); // Pause clock to stop deltaTime progression
            if (document.pointerLockElement === this.canvas) {
                document.exitPointerLock();
            }
        }
    }

    public quitToMainMenu() {
        this.changeGameState('start_screen');
        if (document.pointerLockElement === this.canvas) {
            document.exitPointerLock();
        }
        this.resetGame(false); // Fully reset to a clean state
        this.onMessage("異星生還者\nAlien Survivor");
    }

    private startGame() { if(this.isNewGamePlus){ this.onMessage("警告：時空連續性不穩定...威脅等級加劇"); setTimeout(() => this.startNextWave(), 4000); } else { this.onMessage("COMM-LINK: ...Mayday...月面基地失聯...清除協議啟動..."); setTimeout(() => this.startNextWave(), 5000); } }

    private animate = () => {
        this.animationFrameId = requestAnimationFrame(this.animate);
        if (this.gameState === 'paused') { this.composer.render(); return; }

        const deltaTime = this.clock.getDelta();
        
        this.boundaryWalls.forEach(wall => {
            const mat = wall.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = (Math.sin(this.clock.getElapsedTime() * 2 + wall.position.x) * 0.5 + 0.5) * 0.5 + 0.2;
        });

        if (this.gameState === 'playing' || this.gameState === 'boss_fight') {
            this.updatePlayer(deltaTime);
            this.updateEnemies(deltaTime);
            this.updateBullets(deltaTime);
            this.updatePickups(deltaTime);
            this.updateGrenades(deltaTime);
            if (this.player.drone.unlocked) this.updateDrone(deltaTime);
            this.checkCollisions();
            this.updateSkills(deltaTime);
            this.updateMelee(deltaTime);
            this.onStatsUpdate({...this.player});
        }
        
        if (this.gameState === 'playing') this.updateWaveSpawning(deltaTime);
        if (this.gameState === 'boss_fight' && this.boss) { this.updateBoss(deltaTime); this.updateBossBullets(deltaTime); this.onBossUpdate({name: this.boss.name, hp: this.boss.hp, maxHp: this.boss.maxHp, isFinalBoss: this.boss.isFinalBoss, weakPointHp: this.boss.weakPointHp, maxWeakPointHp: this.boss.maxWeakPointHp }); }
        
        this.updateSky(deltaTime);
        this.updateParticles(deltaTime);
        this.updateExpiringLights(deltaTime);
        this.updateScreenShake(deltaTime);
        if(this.muzzleFlash && this.muzzleFlash.material.opacity > 0) this.muzzleFlash.material.opacity -= deltaTime * 15;
        this.composer.render();
    }
    
    private updateSky(deltaTime: number) { if(this.earth) this.earth.rotation.y += 0.01 * deltaTime; if(this.ambientParticles) this.ambientParticles.rotation.y += 0.01 * deltaTime; }
    
    private startNextWave() {
        this.currentLevel++; 
        
        const messages = [];

        if (this.currentLevel === 3 && !this.player.shield.unlocked) {
            this.player.shield.unlocked = true;
            messages.push({ text: "防禦系統升級：能量護盾已解鎖 (G鍵)", duration: 4000 });
        }
        if (this.currentLevel === 4 && !this.player.drone.unlocked) {
            this.player.drone.unlocked = true;
            this.spawnDrone();
            messages.push({ text: "支援已抵達：攻擊無人機已部署", duration: 4000 });
        }

        if (this.currentLevel === 3) {
            this.weaponLevel = '2'; this.setupWeapon('2');
            const weaponConfig = CONFIG.WEAPON[this.weaponLevel];
            this.player.maxAmmoInMagazine = weaponConfig.MAGAZINE_SIZE;
            this.player.reserveAmmo += weaponConfig.INITIAL_RESERVE_AMMO - CONFIG.WEAPON['1'].INITIAL_RESERVE_AMMO;
            messages.push({ text: "武器系統升級：已啟動高射速電漿步槍", duration: 4000 });
        }
        
        const showMessages = (index: number) => {
            if (index < messages.length) {
                this.onMessage(messages[index].text);
                setTimeout(() => showMessages(index + 1), messages[index].duration);
            } else {
                this.changeGameState('playing');
                this.wave = { totalToKill: 10 + this.currentLevel * 8, killedInWave: 0, spawnedInWave: 0, spawnInterval: Math.max(0.5, (this.isNewGamePlus ? 1.0 : 1.5) - this.currentLevel * 0.1), spawnTimer: 1.5, maxConcurrent: this.isNewGamePlus ? 15 : 12, };
                this.onMessage(`第 ${this.currentLevel} 波`);
                if (this.currentLevel === 2 && !this.isNewGamePlus) this.unlockSkills();
                this.onWaveUpdate({ currentLevel: this.currentLevel, killedInWave: 0, totalToKill: this.wave.totalToKill });
            }
        };

        if (messages.length > 0) {
            showMessages(0);
        } else {
            this.changeGameState('playing');
            this.wave = { totalToKill: 10 + this.currentLevel * 8, killedInWave: 0, spawnedInWave: 0, spawnInterval: Math.max(0.5, (this.isNewGamePlus ? 1.0 : 1.5) - this.currentLevel * 0.1), spawnTimer: 1.5, maxConcurrent: this.isNewGamePlus ? 15 : 12, };
            if (this.currentLevel > 1) this.onMessage(`第 ${this.currentLevel} 波`);
            if (this.currentLevel === 2 && !this.isNewGamePlus) this.unlockSkills();
            this.onWaveUpdate({ currentLevel: this.currentLevel, killedInWave: 0, totalToKill: this.wave.totalToKill });
        }
    }

    private updateWaveSpawning(deltaTime: number) { if (this.wave.spawnedInWave >= this.wave.totalToKill || this.enemies.length >= this.wave.maxConcurrent) return; this.wave.spawnTimer -= deltaTime; if (this.wave.spawnTimer <= 0) { this.wave.spawnTimer = this.wave.spawnInterval; this.spawnEnemy(); this.wave.spawnedInWave++; } }
    
    private createEnemyDrone(): THREE.Group { const g = new THREE.Group(); const s = CONFIG.ENEMY_DRONE.SIZE; const bodyMat = new THREE.MeshStandardMaterial({ color: 0xaa0000, metalness: 0.7, roughness: 0.3 }); const wingMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.4 }); const emissiveMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 4 }); const body = new THREE.Mesh(new THREE.SphereGeometry(s * 0.4, 64, 32), bodyMat); body.scale.z = 1.5; body.castShadow = true; const wing1 = new THREE.Mesh(new THREE.BoxGeometry(s*0.8, s*0.1, s*0.3), wingMat); wing1.position.set(-s*0.5, 0, 0); wing1.rotation.z = 0.5; const wing2 = wing1.clone(); wing2.position.x = s*0.5; wing2.rotation.z = -0.5; const eye = new THREE.Mesh(new THREE.SphereGeometry(s*0.15, 32, 16), emissiveMat); eye.position.z = -s*0.5; const antenna = new THREE.Mesh(new THREE.CylinderGeometry(s*0.02, s*0.02, s*0.4, 16), wingMat); antenna.position.y = s*0.4; const thruster = new THREE.Mesh(new THREE.CylinderGeometry(s*0.1, s*0.15, s*0.2, 32), wingMat); thruster.position.z = s*0.5; thruster.rotation.x = Math.PI / 2; g.add(body, wing1, wing2, eye, antenna, thruster); return g; }
    private createEnemyScout(): THREE.Group { const g = new THREE.Group(); const s = CONFIG.ENEMY_SCOUT.SIZE; const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00aa00, metalness: 0.7, roughness: 0.2 }); const emissiveMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 4 }); const body = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.7, 5), bodyMat); body.castShadow = true; const fin1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, s*0.2, s*0.8, 32), bodyMat); fin1.position.y = s*0.5; fin1.rotation.x = 0.2; const fin2 = fin1.clone(); fin2.rotation.y = Math.PI/2; const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), emissiveMat); eye.position.set(0, 0.1, -s * 0.5); body.add(eye); g.add(body, fin1, fin2); return g; }
    private createEnemyTank(): THREE.Group { const g = new THREE.Group(); const s = CONFIG.ENEMY_TANK.SIZE; const chassisMat = new THREE.MeshStandardMaterial({ color: 0x444488, metalness: 0.9, roughness: 0.5 }); const armorMat = new THREE.MeshStandardMaterial({ color: 0x333366, metalness: 1.0, roughness: 0.3 }); const emissiveMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 4 }); const chassis = new THREE.Mesh(new THREE.BoxGeometry(s*0.9, s*0.5, s, 8, 4, 8), chassisMat); chassis.castShadow = true; const turret = new THREE.Mesh(new THREE.CylinderGeometry(s*0.3, s*0.4, s*0.4, 64), armorMat); turret.position.y = s*0.45; const cannon = new THREE.Mesh(new THREE.CylinderGeometry(s*0.1, s*0.1, s*0.8, 64), armorMat); cannon.rotation.x = Math.PI/2; cannon.position.set(0, s*0.45, -s*0.5); const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.1), emissiveMat); eye.position.set(0, s*0.2, -s*0.5); const sidePod = new THREE.Mesh(new THREE.BoxGeometry(s*0.2, s*0.3, s*0.4, 4, 4, 4), chassisMat); sidePod.position.set(s*0.55, 0, 0); const sidePod2 = sidePod.clone(); sidePod2.position.x = -s*0.55; g.add(chassis, turret, cannon, eye, sidePod, sidePod2); return g; }
    private createEnemyKamikaze(): THREE.Group { const g = new THREE.Group(); const s = CONFIG.ENEMY_KAMIKAZE.SIZE; const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff8800, metalness: 0.5, roughness: 0.5, emissive: 0xff8800, emissiveIntensity: 1 }); const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 2 }); const body = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.5, 8), bodyMat); body.castShadow = true; const spikeGeo = new THREE.ConeGeometry(s * 0.1, s * 0.3, 16); body.geometry.attributes.position.array.forEach((_, i) => { if (i % 3 === 0 && Math.random() > 0.4) { const pos = new THREE.Vector3().fromBufferAttribute(body.geometry.attributes.position, i / 3); const spike = new THREE.Mesh(spikeGeo, spikeMat); spike.position.copy(pos); spike.lookAt(0,0,0); spike.position.multiplyScalar(1.2); body.add(spike); } }); g.add(body); return g; }
    
    private spawnEnemy() {
        let enemyMesh: THREE.Group;
        let enemyConfig: { HP: number; DAMAGE: number; SPEED: number; SIZE: number; DROP_CHANCE: number };
        let type: EnemyType;
        const rand = Math.random();

        if (this.currentLevel < 3) type = rand < 0.6 ? 'drone' : 'scout';
        else if (this.currentLevel === 3) type = rand < 0.4 ? 'drone' : rand < 0.8 ? 'scout' : 'tank';
        else type = rand < 0.3 ? 'drone' : rand < 0.6 ? 'scout' : rand < 0.85 ? 'tank' : 'kamikaze';

        switch(type) {
            case 'scout': enemyMesh = this.createEnemyScout(); enemyConfig = CONFIG.ENEMY_SCOUT; break;
            case 'tank': enemyMesh = this.createEnemyTank(); enemyConfig = CONFIG.ENEMY_TANK; break;
            case 'kamikaze': enemyMesh = this.createEnemyKamikaze(); enemyConfig = CONFIG.ENEMY_KAMIKAZE; break;
            case 'drone': default: enemyMesh = this.createEnemyDrone(); enemyConfig = CONFIG.ENEMY_DRONE; break;
        }

        const enemy = enemyMesh as Enemy;
        const spawnEdge = 98;
        const angle = Math.random() * Math.PI * 2;
        const yPos = type === 'drone' || type === 'scout' || type === 'kamikaze' ? Math.random() * 5 + 3 : enemyConfig.SIZE / 2;
        enemy.position.set(Math.cos(angle) * spawnEdge, yPos, Math.sin(angle) * spawnEdge);
        
        const scale = this.isNewGamePlus ? 1.2 : 1;
        enemy.hp = enemyConfig.HP * scale * (1 + (this.currentLevel-1) * 0.1);
        enemy.damage = enemyConfig.DAMAGE * scale * (1 + (this.currentLevel-1) * 0.1);
        enemy.speed = enemyConfig.SPEED * (this.isNewGamePlus ? 1.1 : 1);
        enemy.size = enemyConfig.SIZE;
        enemy.type = type;
        this.enemies.push(enemy);
        this.scene.add(enemy);
    }
    
    private _spawnPickup(position: THREE.Vector3) {
        const weights = CONFIG.PICKUPS.DROP_TYPE_WEIGHTS;
        let totalWeight = weights.AMMO + weights.HEALTH;
        // if (this.player.shield.unlocked) totalWeight += weights.GRENADE; // re-enable if shield pickups are desired
        
        const rand = Math.random() * totalWeight;
        let type: PickupType;
        if (rand < weights.AMMO) { type = 'ammo'; }
        else { type = 'health'; }
        
        const color = type === 'ammo' ? 0x00ffff : 0x00ff00;
        const pickupMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, transparent: true });
        const pickup = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pickupMat) as Pickup;
        pickup.position.copy(position);
        pickup.position.y = 0.5;
        pickup.type = type;
        this.pickups.push(pickup);
        this.scene.add(pickup);
    }

    private onEnemyDefeated(enemy: Enemy, index: number) { this.createExplosion(enemy.position, { coreColor: 0xff4400, sparkColor: 0xffaa00, count: 40 }); this.scene.remove(enemy); this.enemies.splice(index, 1); const dropConfig = {'drone':CONFIG.ENEMY_DRONE, 'scout':CONFIG.ENEMY_SCOUT, 'tank':CONFIG.ENEMY_TANK, 'kamikaze': CONFIG.ENEMY_KAMIKAZE}[enemy.type]; if (Math.random() < dropConfig.DROP_CHANCE) { this._spawnPickup(enemy.position); } this.wave.killedInWave++; this.onWaveUpdate({ ...this.wave, currentLevel: this.currentLevel }); if (this.wave.killedInWave >= this.wave.totalToKill && this.enemies.length === 0) { this.triggerBossSequence(); } }

    private createBossMesh(level: number): BossType {
        const bossGroup = new THREE.Group() as BossType;
        bossGroup.visuals = new THREE.Group();
        bossGroup.add(bossGroup.visuals);
        const coreMat = new THREE.MeshStandardMaterial({ color: 0xff00ff, metalness: 0.8, roughness: 0.2, emissive: 0x550055, emissiveIntensity: 2 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.3 });
        const emissiveMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000 });
        const size = CONFIG.BOSS_BASE[level as keyof typeof CONFIG.BOSS_BASE].SIZE / 2;

        if (level === 1) {
             const core = new THREE.Mesh(new THREE.TorusKnotGeometry(size * 0.8, size * 0.2, 384, 48), coreMat); core.castShadow = true; bossGroup.visuals.add(core);
             for(let i=0; i<8; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 1.5, 0.1, 32, 128), frameMat); ring.rotation.x = Math.random() * Math.PI; ring.rotation.y = Math.random() * Math.PI; bossGroup.visuals.add(ring); }
        } else if (level === 2) {
            const body = new THREE.Mesh(new THREE.OctahedronGeometry(size, 8), frameMat); const core = new THREE.Mesh(new THREE.SphereGeometry(size*0.5, 64, 64), coreMat); bossGroup.visuals.add(body, core);
             for(let i=0; i<6; i++) { const plate = new THREE.Mesh(new THREE.BoxGeometry(size*1.2, size*0.1, size*0.4), frameMat); plate.position.y = (i % 2 === 0 ? 1 : -1) * size * 0.7; plate.rotation.y = i * Math.PI / 3; plate.rotation.z = Math.random() * 0.5; bossGroup.visuals.add(plate); }
        } else if (level === 3) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(size*1.5, size*1.5, size*1.5, 12, 12, 12), frameMat); const core = new THREE.Mesh(new THREE.SphereGeometry(size*0.8, 64, 64), coreMat); bossGroup.visuals.add(body, core);
            for(let i = 0; i < 12; i++){ const corner = new THREE.Mesh(new THREE.SphereGeometry(size*0.2, 32, 16), emissiveMat); const angle = i * Math.PI / 6; corner.position.set( Math.cos(angle) * size, Math.sin(angle) * size, 0).applyAxisAngle(new THREE.Vector3(1,1,1).normalize(), Math.random() * Math.PI * 2); bossGroup.visuals.add(corner); }
        } else if (level === 4) {
            const body = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 12), frameMat); const laserEmitter = new THREE.Mesh(new THREE.CylinderGeometry(size*0.2, size*0.2, size*0.5, 128), emissiveMat); laserEmitter.position.y = size*1.2; bossGroup.visuals.add(body, laserEmitter);
            for(let i=0; i<5; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(size * (1.5 + i*0.2), 0.1, 32, 128), frameMat); ring.rotation.x = i * Math.PI/5; ring.rotation.z = Math.PI/2; bossGroup.visuals.add(ring); }
        } else if (level === 5) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(size, size, size, 16, 16, 16), frameMat); body.name = "final_boss_body";
            const weakPointMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 4 });
            bossGroup.weakPoint = new THREE.Mesh(new THREE.SphereGeometry(size*0.1, 64, 64), weakPointMat);
            bossGroup.isFinalBoss = true;
            bossGroup.visuals.add(body); bossGroup.add(bossGroup.weakPoint);
            bossGroup.weakPointPath = new THREE.CatmullRomCurve3([ new THREE.Vector3(-size*0.8, size*0.6, 0), new THREE.Vector3(0, size*0.8, size*0.6), new THREE.Vector3(size*0.8, 0, -size*0.6), new THREE.Vector3(0, -size*0.8, 0), new THREE.Vector3(-size*0.8, -size*0.4, size*0.6) ], true);
            bossGroup.weakPointProgress = 0;
        }
        return bossGroup;
    }

    private async _generateBossIntro(level: number, isNewGamePlus: boolean): Promise<BossIntroData> {
        const responseSchema = { type: Type.OBJECT, properties: { bossName: { type: Type.STRING, description: "A majestic and terrifying, unique name for a colossal, intricate, god-like alien machine boss. For example: 'Hyperion, the Star-Eater' or 'Omega Sentinel Ark'." }, introMessage: { type: Type.STRING, description: "A short, epic, and threatening one-sentence intro message for this colossal boss. For example: 'The cosmos will forget your existence.' or 'You dare challenge a god?'" }, }, required: ["bossName", "introMessage"], };
        const prompt = `Generate a unique boss encounter for a sci-fi survival game. The boss is a colossal, intricate, god-like alien machine. The player is on wave ${level}. The final boss is on wave 5. New Game Plus mode is ${isNewGamePlus ? 'active, so make it sound even more dangerous' : 'not active'}. Provide a suitably epic and terrifying name and a short, one-sentence intro message.`;
        try { if (!this.aiClient) { this.aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY }); } const response = await this.aiClient.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema: responseSchema, temperature: 0.9, } }); const jsonText = response.text.trim(); const bossData: BossIntroData = JSON.parse(jsonText); return bossData; } catch (error) { console.error("Error generating boss intro with Gemini:", error); return { bossName: `Cosmic Anomaly X${level}${isNewGamePlus ? '+' : ''}`, introMessage: "Threat signature unmatched. Engaging obliteration protocol.", }; }
    }
    
    private async triggerBossSequence() { this.changeGameState('wave_transition'); this.onMessage('大型目標接近...正在分析...'); const bossData = await this._generateBossIntro(this.currentLevel, this.isNewGamePlus); setTimeout(() => { this.onMessage(bossData.introMessage); this.changeGameState('boss_fight'); const scale = this.isNewGamePlus ? 1.5 : 1; const bossConfig = CONFIG.BOSS_BASE[this.currentLevel as keyof typeof CONFIG.BOSS_BASE]; this.boss = this.createBossMesh(this.currentLevel); this.boss.position.set(0, bossConfig.SIZE / 2, -80); this.boss.hp = bossConfig.HP * scale; this.boss.maxHp = bossConfig.HP * scale; this.boss.damage = bossConfig.DAMAGE * scale; this.boss.speed = bossConfig.SPEED * (this.isNewGamePlus ? 1.2 : 1); this.boss.size = bossConfig.SIZE; this.boss.name = bossData.bossName + (this.isNewGamePlus ? " +" : ""); this.boss.lastAttackTime = this.clock.getElapsedTime(); this.boss.attackPattern = 0; this.boss.attackPhase = 0; this.boss.attackTimer = 0; if(this.boss.isFinalBoss) { this.boss.weakPointHp = (bossConfig as any).WEAK_POINT_HP; this.boss.maxWeakPointHp = (bossConfig as any).WEAK_POINT_HP; } this.scene.add(this.boss); this.onBossUpdate({ name: this.boss.name, hp: this.boss.hp, maxHp: this.boss.maxHp, isFinalBoss: this.boss.isFinalBoss, weakPointHp: this.boss.weakPointHp, maxWeakPointHp: this.boss.maxWeakPointHp }); }, 3000); }

    private onBossDefeated() { 
        if (!this.boss) return; 
        this.createExplosion(this.boss.position, { coreColor: 0xff00ff, sparkColor: 0xffffff, count: 200 });
        this.scene.remove(this.boss); 
        this.boss = null; 
        this.onBossUpdate(null); 
        
        // Clean up all boss projectiles and special attacks to prevent post-mortem damage/camera shake
        this.bossBullets.forEach(b => this.scene.remove(b));
        this.bossBullets = [];
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i] as any;
            if (p.isShockwave || p.isShockwaveRing || p.isSweepingLaser) {
                this.scene.remove(p);
                this.particles.splice(i, 1);
            }
        }
        
        if (this.currentLevel >= CONFIG.GAME.MAX_LEVEL) { 
            this.changeGameState("victory"); 
            if (document.pointerLockElement === this.canvas) document.exitPointerLock(); this.onVictory(); 
        } else { 
            this.changeGameState('wave_transition');
            this.onMessage(`第 ${this.currentLevel} 波威脅已肅清`); 
            setTimeout(() => this.startNextWave(), 4000); 
        } 
    }
    
    private updatePlayer(deltaTime: number) {
        const weaponConfig = CONFIG.WEAPON[this.weaponLevel];
        
        if (this.weaponLevel === '2' && this.weaponGroup) {
            const energyCell = this.weaponGroup.getObjectByName('energy_cell') as THREE.Mesh;
            if (energyCell) {
                const material = energyCell.material as THREE.MeshStandardMaterial;
                const targetScale = this.player.skills.z.active ? 1.5 : 1.0;
                const targetIntensity = this.player.skills.z.active ? 5 : 2;

                energyCell.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), deltaTime * 10);
                material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, deltaTime * 10);
            }
            this.weaponGroup.children.filter(c => c.name === 'wing').forEach(wing => {
                const targetRot = this.player.skills.z.active ? (wing.position.x > 0 ? -0.8 : 0.8) : (wing.position.x > 0 ? -0.3 : 0.3);
                wing.rotation.y = THREE.MathUtils.lerp(wing.rotation.y, targetRot, deltaTime * 8);
            });
        }
        
        if (this.skillZLight) {
            const targetIntensity = (this.player.skills.z.active && this.weaponLevel === '2') ? 15 : 0;
            this.skillZLight.intensity = THREE.MathUtils.lerp(this.skillZLight.intensity, targetIntensity, deltaTime * 10);
        }

        if (this.player.reloading) {
            this.player.isAiming = false;
            this.player.reloadTime -= deltaTime;
            if (this.player.reloadTime <= 0) {
                const ammoNeeded = this.player.maxAmmoInMagazine - this.player.ammoInMagazine;
                const ammoToReload = Math.min(ammoNeeded, this.player.reserveAmmo);
                this.player.ammoInMagazine += ammoToReload; this.player.reserveAmmo -= ammoToReload; this.player.reloading = false; this.player.reloadTime = 0;
            }
        } else if (this.keys['KeyR'] && this.player.reserveAmmo > 0 && this.player.ammoInMagazine < this.player.maxAmmoInMagazine) {
            this.player.reloading = true; this.player.reloadTime = weaponConfig.RELOAD_TIME; this.onMessage("Reloading...");
        }
        
        const adsMultiplier = this.player.isAiming ? CONFIG.PLAYER.ADS_SPEED_MULTIPLIER : 1;
        this.player.sprinting = this.keys['ShiftLeft'] && !this.player.isAiming;
        const speed = (this.player.sprinting && this.player.stamina > 0) ? CONFIG.PLAYER.SPRINT_SPEED : CONFIG.PLAYER.SPEED;
        const moveDirection = new THREE.Vector3();
        const isMoving = this.keys['KeyW'] || this.keys['KeyA'] || this.keys['KeyS'] || this.keys['KeyD'];
        if (this.keys['KeyW']) moveDirection.z = -1; if (this.keys['KeyS']) moveDirection.z = 1; if (this.keys['KeyA']) moveDirection.x = -1; if (this.keys['KeyD']) moveDirection.x = 1;
        if (this.player.sprinting && isMoving) { this.player.stamina -= CONFIG.PLAYER.STAMINA_COST * deltaTime; } else { this.player.stamina += CONFIG.PLAYER.STAMINA_REGEN * deltaTime; }
        this.player.stamina = Math.max(0, Math.min(CONFIG.PLAYER.STAMINA, this.player.stamina));

        moveDirection.normalize().applyEuler(this.playerObject.rotation).multiplyScalar(speed * adsMultiplier * deltaTime);
        this.playerObject.position.add(moveDirection);
        this.player.velocity.y += CONFIG.GAME.GRAVITY * deltaTime; this.playerObject.position.y += this.player.velocity.y * deltaTime;
        
        let yPosBeforeBob = this.playerObject.position.y;
        if (yPosBeforeBob < 1.6) { yPosBeforeBob = 1.6; this.player.velocity.y = 0; this.player.onGround = true; }
        
        this.bobTimer += deltaTime;
        let bobFreq = isMoving ? (this.player.sprinting ? 14 : 8) : 2;
        let bobAmp = isMoving ? (this.player.sprinting ? 0.08 : 0.04) : 0.015;
        if (this.player.isAiming) { bobFreq *= 0.3; bobAmp *= 0.3; }
        const bobOffset = Math.sin(this.bobTimer * bobFreq) * bobAmp;
        this.playerObject.position.y = yPosBeforeBob;
        this.camera.position.y = 1.6 + bobOffset;

        if (this.keys['Space'] && this.player.onGround) { this.player.velocity.y = CONFIG.PLAYER.JUMP_FORCE; this.player.onGround = false; }
        
        const targetFov = this.player.isAiming ? CONFIG.PLAYER.ADS_FOV : this.defaultFov;
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, deltaTime * 12);
        this.camera.updateProjectionMatrix();
        const targetWeaponPos = this.player.isAiming ? this.adsWeaponPos : this.defaultWeaponPos;
        this.weaponGroup.position.lerp(targetWeaponPos, deltaTime * 15);

        const shootCooldown = this.player.skills.z.active ? CONFIG.WEAPON.LASER_MODE.COOLDOWN : weaponConfig.COOLDOWN;
        const canShoot = this.clock.getElapsedTime() > this.player.lastShotTime + shootCooldown;
        if (this.keys['mouse0'] && canShoot && !this.player.reloading && !this.player.melee.attacking) {
            if (this.player.skills.z.active) {
                this.playerShoot(true);
            } else if (this.player.ammoInMagazine > 0) {
                this.playerShoot(false); if (this.weaponLevel === '1' || this.isNewGamePlus) this.keys['mouse0'] = false;
            }
        }

        if (this.keys['KeyF']) this.playerMeleeAttack();
        if (this.keys['KeyQ'] && this.player.skills.q.unlocked && this.player.skills.q.cooldown <= 0) this.useSkillQ();
        if (this.keys['KeyZ'] && this.player.skills.z.unlocked && this.player.skills.z.cooldown <= 0) this.useSkillZ();
        if (this.keys['KeyG'] && this.player.shield.unlocked && this.player.shield.cooldown <= 0) this.useSkillG();
    }
    
    private playerShoot(isLaser: boolean) {
        if (!isLaser) this.player.ammoInMagazine--;
        this.player.lastShotTime = this.clock.getElapsedTime();
        this.muzzleFlash.material.opacity = 1; this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
        const light = this.muzzleFlash.getObjectByName('muzzleFlashLight') as THREE.PointLight;
        if (light) { light.intensity = isLaser ? 8 : 4; setTimeout(() => { light.intensity = 0; }, 60); }
        
        const bulletMat = isLaser 
            ? new THREE.MeshBasicMaterial({ color: 0xff00ff })
            : new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const bulletGeo = isLaser 
            ? new THREE.CylinderGeometry(0.15, 0.15, 8, 16)
            : new THREE.SphereGeometry(0.1, 8, 8);
        
        const bullet = new THREE.Mesh(bulletGeo, bulletMat) as unknown as Bullet;
        const bulletLight = new THREE.PointLight(isLaser ? 0xff00ff : 0xffff00, 2, 15, 2);
        bullet.add(bulletLight);
        if(isLaser) bullet.rotation.x = Math.PI / 2;

        const direction = new THREE.Vector3(); this.camera.getWorldDirection(direction); 
        
        if (!this.player.isAiming && !isLaser) {
            const spread = CONFIG.WEAPON[this.weaponLevel].SPREAD;
            direction.x += THREE.MathUtils.randFloat(-spread, spread);
            direction.y += THREE.MathUtils.randFloat(-spread, spread);
            direction.z += THREE.MathUtils.randFloat(-spread, spread);
        }
        
        direction.normalize();
        const spawnPos = new THREE.Vector3(); this.muzzleFlash.getWorldPosition(spawnPos);
        bullet.position.copy(spawnPos);
        bullet.velocity = direction.multiplyScalar(isLaser ? 250 : 100);
        bullet.lookAt(bullet.position.clone().add(bullet.velocity));
        bullet.isLaser = isLaser;
        this.bullets.push(bullet);
        this.scene.add(bullet);
    }
    private playerTakeDamage(amount: number) { 
        if (this.gameState === 'game_over') return; 
        if (this.player.shield.active) { 
            this.triggerScreenShake(0.05, 0.2); 
            if(this.shieldVisual) {
                const material = this.shieldVisual.material as THREE.MeshStandardMaterial;
                material.emissiveIntensity = 10;
                setTimeout(() => { material.emissiveIntensity = 1 }, 100);
            }
            return; 
        } 
        this.player.hp -= amount; 
        this.triggerScreenShake(0.1, 0.3); 
        if (this.player.hp <= 0) { 
            this.player.hp = 0; this.changeGameState('game_over'); 
            if (document.pointerLockElement === this.canvas) document.exitPointerLock(); 
            this.onGameOver(); 
        } 
        this.onStatsUpdate({ ...this.player }); 
    }

    private useSkillQ() { this.player.hp = Math.min(this.player.maxHp, this.player.hp + CONFIG.SKILL_Q.HEAL); this.player.skills.q.cooldown = CONFIG.SKILL_Q.COOLDOWN; this.createHealEffect(); }
    private createHealEffect() { for (let i = 0; i < 30; i++) { const particle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, blending: THREE.AdditiveBlending })) as unknown as Particle; particle.position.copy(this.playerObject.position).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)); particle.velocity = new THREE.Vector3(0, Math.random() * 1 + 1, 0); particle.lifespan = Math.random() * 0.8 + 0.5; this.particles.push(particle); this.scene.add(particle); } }
    
    private useSkillZ() { this.player.skills.z.active = true; this.player.skills.z.duration = CONFIG.SKILL_Z.DURATION; this.player.skills.z.cooldown = CONFIG.SKILL_Z.COOLDOWN; this.onMessage("雷射加農模式啟動！"); }
    private useSkillG() { this.player.shield.active = true; this.player.shield.duration = CONFIG.SHIELD.DURATION; this.player.shield.cooldown = CONFIG.SHIELD.COOLDOWN; if(this.shieldVisual) this.shieldVisual.visible = true; this.onMessage("能量護盾已啟動！"); }

    private throwGrenade() { /* Replaced by shield */ }
    private updateGrenades(deltaTime: number) { /* Replaced by shield */ }

    private createMeleeSwingEffect() {
        const count = 25;
        const angleSpan = Math.PI / 1.5;

        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(this.camera.up, forward).normalize();
        
        const swingCenter = new THREE.Vector3();
        this.camera.getWorldPosition(swingCenter);
        swingCenter.add(forward.clone().multiplyScalar(CONFIG.MELEE.RANGE / 2.5));

        for (let i = 0; i < count; i++) {
            const angle = -angleSpan / 2 + (i / (count - 1)) * angleSpan;
            const radius = Math.random() * (CONFIG.MELEE.RANGE / 2.5);

            const offset = forward.clone().multiplyScalar(Math.cos(angle) * radius)
                .add(right.clone().multiplyScalar(Math.sin(angle) * radius));
            
            const particle = new THREE.Mesh(
                new THREE.PlaneGeometry(0.5, 0.05),
                new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
            ) as unknown as Particle;

            particle.position.copy(swingCenter).add(offset);
            particle.position.y += (Math.random() - 0.5); // vertical spread
            particle.lookAt(swingCenter);
            
            particle.velocity = new THREE.Vector3(); // Static
            particle.lifespan = Math.random() * 0.15 + 0.1;
            this.particles.push(particle);
            this.scene.add(particle);
        }
    }

    private playerMeleeAttack() { if (this.player.melee.cooldown > 0 || this.player.melee.attacking || this.player.isAiming) return; this.createMeleeSwingEffect(); this.player.melee.cooldown = CONFIG.MELEE.COOLDOWN; this.player.melee.attacking = true; this.player.melee.swingTime = CONFIG.MELEE.SWING_DURATION; this.weaponGroup.visible = false; this.meleeWeapon.visible = true; this.meleeWeapon.scale.set(1.2, 1.2, 1.2); const playerPos = this.playerObject.position.clone(); const forward = new THREE.Vector3(); this.camera.getWorldDirection(forward); const checkHit = (target: Enemy | BossType, range: number, damage: number) => { const distance = target.position.distanceTo(playerPos); const toTarget = new THREE.Vector3().subVectors(target.position, playerPos).normalize(); const angle = forward.angleTo(toTarget); if (distance < range && angle < Math.PI / 2.5) { this.dealDamageTo(target, damage); this.createExplosion(target.position, {coreColor: 0x00ffff, sparkColor: 0xaaaaff, count: 15}); return true; } return false; }; setTimeout(() => { for (let j = this.enemies.length - 1; j >= 0; j--) if (this.enemies[j]) checkHit(this.enemies[j], CONFIG.MELEE.RANGE, CONFIG.MELEE.DAMAGE); if (this.boss) checkHit(this.boss, CONFIG.MELEE.RANGE + this.boss.size / 2, CONFIG.MELEE.DAMAGE); }, CONFIG.MELEE.SWING_DURATION / 2 * 1000); }
    private updateMelee(deltaTime: number) { if(this.player.melee.cooldown > 0) this.player.melee.cooldown -= deltaTime; if(this.player.melee.attacking) { this.player.melee.swingTime -= deltaTime; const swingProgress = 1 - (this.player.melee.swingTime / CONFIG.MELEE.SWING_DURATION); const swingAngle = Math.sin(swingProgress * Math.PI) * 2; this.meleeWeapon.rotation.z = Math.PI / 2 - swingAngle; if(this.player.melee.swingTime <= 0) { this.player.melee.attacking = false; this.meleeWeapon.visible = false; this.weaponGroup.visible = true; this.meleeWeapon.scale.set(1, 1, 1); } } }

    private updateEnemies(deltaTime: number) { for(const enemy of this.enemies) { const dir = new THREE.Vector3().subVectors(this.playerObject.position, enemy.position); if (enemy.type !== 'drone' && enemy.type !== 'scout') dir.y = 0; dir.normalize(); enemy.position.add(dir.multiplyScalar(enemy.speed * deltaTime)); enemy.lookAt(this.playerObject.position); } }
    
    private updateBoss(deltaTime: number) { if (!this.boss) return; const dir = new THREE.Vector3().subVectors(this.playerObject.position, this.boss.position); dir.y = 0; dir.normalize(); if (this.currentLevel < 5) this.boss.position.add(dir.multiplyScalar(this.boss.speed * deltaTime)); const lookAtPos = this.playerObject.position.clone(); lookAtPos.y = this.boss.position.y; this.boss.lookAt(lookAtPos); this.boss.visuals.rotation.y += 0.2 * deltaTime; this.boss.visuals.rotation.x += 0.1 * deltaTime; this.boss.attackTimer -= deltaTime; if (this.boss.attackTimer <= 0) this.executeBossAttack(deltaTime); if(this.boss.isFinalBoss && this.boss.weakPoint) { this.boss.weakPointProgress = (this.boss.weakPointProgress! + deltaTime * 0.1) % 1; this.boss.weakPointPath!.getPointAt(this.boss.weakPointProgress!, this.boss.weakPoint.position); } }
    private executeBossAttack(deltaTime: number) { if(!this.boss) return; const cfg = CONFIG.BOSS_BASE[this.currentLevel as keyof typeof CONFIG.BOSS_BASE]; this.boss.attackTimer = cfg.ATTACK_COOLDOWN; const playerPos = this.playerObject.position; const bossPos = this.boss.position; const dirToPlayer = new THREE.Vector3().subVectors(playerPos, bossPos).normalize(); switch(this.currentLevel) { case 1: this.bossShootSimple(dirToPlayer); break; case 2: for (let i = -2; i <= 2; i++) { const angle = i * Math.PI / 16; const spreadDir = dirToPlayer.clone().applyAxisAngle(new THREE.Vector3(0,1,0), angle); this.bossShootSimple(spreadDir); } break; case 3: this.bossShootSimple(dirToPlayer); const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.3, 64), new THREE.MeshBasicMaterial({color: 0xff0000, side: THREE.DoubleSide, transparent: true})); shockwave.position.copy(bossPos); shockwave.position.y = 0.1; shockwave.rotation.x = -Math.PI/2; this.scene.add(shockwave); this.particles.push(Object.assign(shockwave, { velocity: new THREE.Vector3(1,0,0), lifespan: 3, isShockwave: true, damage: cfg.BULLET_DAMAGE }) as any); break; case 4: this.bossShootSimple(dirToPlayer, true); const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.2, 16, 64), new THREE.MeshStandardMaterial({color: 0xff8800, side: THREE.DoubleSide, transparent: true, emissive: 0xff8800})); ring.position.copy(bossPos); ring.position.y = 0.2; ring.rotation.x = -Math.PI/2; this.scene.add(ring); this.particles.push(Object.assign(ring, { velocity: new THREE.Vector3(1,0,0), lifespan: 4, isShockwaveRing: true, damage: cfg.BULLET_DAMAGE, initialRadius: 1, expansionRate: 25 }) as any); break; case 5: const attackType = Math.floor(Math.random() * 2); if (attackType === 0) { for (let i = 0; i < 20; i++) setTimeout(() => { if(!this.boss) return; const angle = (i / 20) * Math.PI * 2; const spreadDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)); this.bossShootSimple(spreadDir); }, i * 50); } else { const laser = new THREE.Mesh(new THREE.BoxGeometry(400, 1, 1), new THREE.MeshBasicMaterial({color: 0xff0000, transparent: true, opacity: 0.8})); laser.position.copy(bossPos); laser.position.y = 1.6; this.scene.add(laser); this.particles.push(Object.assign(laser, { velocity: new THREE.Vector3(1,0,0), lifespan: 5, isSweepingLaser: true, damage: cfg.BULLET_DAMAGE, rotationSpeed: 0.5 }) as any); } break; } }
    private bossShootSimple(direction: THREE.Vector3, isLaser = false) { if (!this.boss) return; const cfg = CONFIG.BOSS_BASE[this.currentLevel as keyof typeof CONFIG.BOSS_BASE]; const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 }); const geo = isLaser ? new THREE.BoxGeometry(0.3, 0.3, 3) : new THREE.SphereGeometry(0.5, 32, 16); const bullet = new THREE.Mesh(geo, mat) as unknown as BossBullet; bullet.position.copy(this.boss.position); bullet.velocity = direction.clone().multiplyScalar(cfg.BULLET_SPEED); bullet.lookAt(bullet.position.clone().add(bullet.velocity)); bullet.isLaser = isLaser; const bulletLight = new THREE.PointLight(0xff0000, 4, 20, 2.5); bullet.add(bulletLight); this.bossBullets.push(bullet); this.scene.add(bullet); }

    private spawnDrone() { this.drone = new THREE.Group(); const bodyMat = new THREE.MeshStandardMaterial({color: 0x00ff00, metalness: 0.8, emissive: 0x003300}); const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), bodyMat); this.drone.add(body); this.scene.add(this.drone); }
    private updateDrone(deltaTime: number) { if (!this.drone) return; const targetPos = new THREE.Vector3().copy(this.playerObject.position).add(new THREE.Vector3(-2, 2, -2)); this.drone.position.lerp(targetPos, 0.1); this.drone.lookAt(this.playerObject.position); const now = this.clock.getElapsedTime(); if (now > this.lastDroneShotTime + CONFIG.DRONE.FIRE_RATE) { if (!this.droneTarget || this.droneTarget.hp <= 0 || this.drone.position.distanceTo(this.droneTarget.position) > CONFIG.DRONE.RANGE) { this.findDroneTarget(); } if (this.droneTarget) { this.droneShoot(); this.lastDroneShotTime = now; } } }
    private findDroneTarget() { let closestDist = CONFIG.DRONE.RANGE; this.droneTarget = null; for (const enemy of this.enemies) { const dist = this.drone!.position.distanceTo(enemy.position); if (dist < closestDist) { closestDist = dist; this.droneTarget = enemy; } } if (this.boss && this.drone!.position.distanceTo(this.boss.position) < closestDist) this.droneTarget = this.boss; }
    private droneShoot() { if (!this.drone || !this.droneTarget) return; const mat = new THREE.MeshBasicMaterial({color: 0x00ff00}); const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), mat) as unknown as DroneBullet; const dir = new THREE.Vector3().subVectors(this.droneTarget.position, this.drone.position).normalize(); bullet.position.copy(this.drone.position).add(dir); bullet.velocity = dir.multiplyScalar(80); const bulletLight = new THREE.PointLight(0x00ff00, 1, 10, 2); bullet.add(bulletLight); this.droneBullets.push(bullet); this.scene.add(bullet); }

    private updateBullets(deltaTime: number) { for (let i = this.bullets.length - 1; i >= 0; i--) { const bullet = this.bullets[i]; bullet.position.add(bullet.velocity.clone().multiplyScalar(deltaTime)); if (bullet.position.distanceTo(this.playerObject.position) > 300) { this.scene.remove(bullet); this.bullets.splice(i, 1); } } for (let i = this.droneBullets.length - 1; i >= 0; i--) { const bullet = this.droneBullets[i]; bullet.position.add(bullet.velocity.clone().multiplyScalar(deltaTime)); if (bullet.position.distanceTo(this.playerObject.position) > 300) { this.scene.remove(bullet); this.droneBullets.splice(i, 1); } } }
    
    private updateBossBullets(deltaTime: number) {
        for (let i = this.bossBullets.length - 1; i >= 0; i--) {
            const bullet = this.bossBullets[i];
            if (!bullet) continue;
            
            bullet.position.add(bullet.velocity.clone().multiplyScalar(deltaTime));
    
            if (bullet.position.distanceTo(this.playerObject.position) > 400) {
                this.scene.remove(bullet);
                this.bossBullets.splice(i, 1);
                continue;
            }
    
            let hitWall = false;
            for (const wall of this.boundaryWalls) {
                const wallBox = new THREE.Box3().setFromObject(wall);
                let bulletCollided = false;
                
                if (bullet.isLaser) {
                    const bulletBox = new THREE.Box3().setFromObject(bullet);
                    bulletCollided = wallBox.intersectsBox(bulletBox);
                } else {
                    const bulletSphere = new THREE.Sphere(bullet.position, 0.5); // SphereGeometry radius
                    bulletCollided = wallBox.intersectsSphere(bulletSphere);
                }
    
                if (bulletCollided) {
                    this.createExplosion(bullet.position, { coreColor: 0xff8800, sparkColor: 0xffffff, count: 5 });
                    this.scene.remove(bullet);
                    this.bossBullets.splice(i, 1);
                    hitWall = true;
                    break; 
                }
            }
        }
    }

    private updatePickups(deltaTime: number) { for(const p of this.pickups) { p.rotation.y += 1 * deltaTime; p.material.opacity = Math.sin(this.clock.getElapsedTime() * 3) * 0.25 + 0.75; } }
    private updateSkills(deltaTime: number) { if(this.player?.skills) { if (this.player.skills.q.cooldown > 0) this.player.skills.q.cooldown -= deltaTime; if (this.player.skills.z.cooldown > 0) this.player.skills.z.cooldown -= deltaTime; if (this.player.skills.z.active) { this.player.skills.z.duration -= deltaTime; if (this.player.skills.z.duration <= 0) this.player.skills.z.active = false; } } if (this.player?.shield.cooldown > 0) this.player.shield.cooldown -= deltaTime; if (this.player.shield.active) { this.player.shield.duration -= deltaTime; if (this.player.shield.duration <= 0) { this.player.shield.active = false; if(this.shieldVisual) this.shieldVisual.visible = false; } else { if(this.shieldVisual) { const mat = this.shieldVisual.material as THREE.MeshStandardMaterial; const baseOpacity = (this.player.shield.duration / CONFIG.SHIELD.DURATION) * 0.2 + 0.1; mat.opacity = baseOpacity + Math.sin(this.clock.getElapsedTime() * 15) * 0.1; if (mat.map) { mat.map.offset.x += 0.1 * deltaTime; mat.map.offset.y -= 0.05 * deltaTime; } } } } }
    
    private updateScreenShake(deltaTime: number) {
        // 1. Revert previous frame's shake from the base rotation
        this.camera.rotation.x -= this.shakeOffset.x;
        this.playerObject.rotation.y -= this.shakeOffset.y;

        // 2. Calculate this frame's shake
        if (this.screenShake.time < this.screenShake.duration) {
            this.screenShake.time += deltaTime;
            const shakeAmount = 1 - Math.min(1, this.screenShake.time / this.screenShake.duration);
            const intensity = this.screenShake.intensity * shakeAmount;
            
            // Calculate new offset
            this.shakeOffset.x = (Math.random() - 0.5) * intensity * 0.15; // Pitch for camera
            this.shakeOffset.y = (Math.random() - 0.5) * intensity * 0.15; // Yaw for playerObject
        } else {
            this.shakeOffset.set(0, 0, 0);
        }

        // 3. Apply new shake to the base rotation
        this.camera.rotation.x += this.shakeOffset.x;
        this.playerObject.rotation.y += this.shakeOffset.y;
    }

    private triggerScreenShake(intensity: number, duration: number) { this.screenShake.intensity = intensity; this.screenShake.duration = duration; this.screenShake.time = 0; }
    
    private checkCollisions() { this._checkBulletCollisions(); this._checkBossBulletCollisions(); this._checkPlayerCollisions(); }
    
    private dealDamageTo(target: Enemy | BossType, damage: number, fromExplosion = false) {
        if (target.hp <= 0) return;
        
        let meshToFlash: THREE.Mesh | undefined;
        let positionToExplode: THREE.Vector3 = target.position;

        if (target.type === 'kamikaze' && !fromExplosion) {
             this.triggerExplosion(target.position, target.size * 5, target.damage, { coreColor: 0xff4400, sparkColor: 0xffaa00, count: 50 });
             target.hp = 0;
        } else if ((target as BossType).isFinalBoss) {
            // Can't damage final boss directly
            meshToFlash = (target as BossType).visuals.children[0] as THREE.Mesh;
        } else {
            target.hp -= damage;
            meshToFlash = (target as BossType).visuals?.children[0] as THREE.Mesh || (target as Enemy).children[0] as THREE.Mesh;
        }
        
        if (meshToFlash) this.flashMesh(meshToFlash);

        if (target.hp <= 0) {
            if (this.enemies.includes(target as Enemy)) {
                this.onEnemyDefeated(target as Enemy, this.enemies.indexOf(target as Enemy));
            } else if (target === this.boss) {
                this.onBossDefeated();
            }
        }
    }
    
    private triggerExplosion(position: THREE.Vector3, radius: number, damage: number, options: {coreColor: number, sparkColor: number, count: number}) {
        this.createExplosion(position, options);
        this.triggerScreenShake(0.2, 0.4);

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (enemy && enemy.position.distanceTo(position) < radius) {
                this.dealDamageTo(enemy, damage, true);
            }
        }

        if (this.boss && this.boss.position.distanceTo(position) < radius + this.boss.size / 2) {
             if (this.boss.isFinalBoss) {
                if (this.boss.weakPoint!.position.distanceTo(position) < radius) {
                    this.boss.hp -= damage;
                    this.flashMesh(this.boss.weakPoint!);
                    if (this.boss.hp <= 0) this.onBossDefeated();
                }
             } else {
                 this.dealDamageTo(this.boss, damage, true);
             }
        }
    }

    private _checkBulletCollisions() { const weaponConfig = CONFIG.WEAPON[this.weaponLevel]; const laserDamage = CONFIG.WEAPON.LASER_MODE.DAMAGE; for (let i = this.bullets.length - 1; i >= 0; i--) { const b = this.bullets[i]; if(!b) continue; let h=false; let p:THREE.Vector3|null=null; for (let j=this.enemies.length-1; j>=0; j--) { const e=this.enemies[j]; if(e&&b.position.distanceTo(e.position)<e.size) { if(b.isLaser) this.dealDamageTo(e, laserDamage); else if(!b.isExplosive) this.dealDamageTo(e, weaponConfig.DAMAGE); h=true;p=e.position.clone();break;}} if(!h&&this.boss) { let hitTarget = null; if (this.boss.isFinalBoss && this.boss.weakPoint) { if (b.position.distanceTo(this.boss.weakPoint.position) < 1.5) hitTarget = this.boss.weakPoint; } else { if (b.position.distanceTo(this.boss.position) < this.boss.size/2) hitTarget = this.boss; } if (hitTarget) { if(b.isLaser) {this.boss.hp -= laserDamage; this.flashMesh(hitTarget === this.boss.weakPoint ? this.boss.weakPoint! : this.boss.visuals.children[0] as THREE.Mesh); if(this.boss.hp <= 0) this.onBossDefeated();} else if(!b.isExplosive) { this.boss.hp -= weaponConfig.DAMAGE; this.flashMesh(hitTarget === this.boss.weakPoint ? this.boss.weakPoint! : this.boss.visuals.children[0] as THREE.Mesh); if(this.boss.hp <= 0) this.onBossDefeated(); } h=true;p=hitTarget.position.clone(); } } if (h) { if (b.isExplosive) { this.triggerExplosion(p!, CONFIG.SKILL_Z.AOE_RADIUS, CONFIG.SKILL_Z.DAMAGE, { coreColor: 0xff88ff, sparkColor: 0xffffff, count: 50 }); } else { this.createExplosion(b.position, { coreColor: b.isLaser ? 0xff00ff: 0x00ffff, sparkColor: 0xaaaaff, count: 10 }); } if(!b.isLaser){ this.scene.remove(b); this.bullets.splice(i, 1); } } } for (let i = this.droneBullets.length - 1; i >= 0; i--) { const b = this.droneBullets[i]; if (!b) continue; let h=false; for (let j=this.enemies.length-1; j>=0; j--) { const e=this.enemies[j]; if (e && b.position.distanceTo(e.position) < e.size) { this.dealDamageTo(e, CONFIG.DRONE.DAMAGE); h=true; break; } } if (!h && this.boss) { if (this.boss.isFinalBoss && this.boss.weakPoint && b.position.distanceTo(this.boss.weakPoint.position) < 1.5) { this.boss.hp -= CONFIG.DRONE.DAMAGE; this.flashMesh(this.boss.weakPoint); if(this.boss.hp <= 0) this.onBossDefeated(); h=true; } else if (!this.boss.isFinalBoss && b.position.distanceTo(this.boss.position) < this.boss.size) { this.dealDamageTo(this.boss, CONFIG.DRONE.DAMAGE); h=true; } } if (h) { this.scene.remove(b); this.droneBullets.splice(i, 1); } } }

    private _checkBossBulletCollisions() { const playerWorldPos = this.playerObject.position; for (let i = this.bossBullets.length - 1; i >= 0; i--) { const bullet = this.bossBullets[i]; if (playerWorldPos.distanceTo(bullet.position) < 1.5) { const bossConfig = CONFIG.BOSS_BASE[this.currentLevel as keyof typeof CONFIG.BOSS_BASE]; this.playerTakeDamage(bossConfig.BULLET_DAMAGE); this.createExplosion(bullet.position, { coreColor: 0xff0000, sparkColor: 0xff8800, count: 25 }); this.scene.remove(bullet); this.bossBullets.splice(i, 1); } } }
    private _checkPlayerCollisions() { const playerWorldPos = this.playerObject.position; const now = this.clock.getElapsedTime(); const weaponConfig = CONFIG.WEAPON[this.weaponLevel]; if (now > this.player.lastHitTime + CONFIG.PLAYER.DAMAGE_IMMUNITY) { let damaged = false; for (let i = this.enemies.length - 1; i >= 0; i--) { const enemy = this.enemies[i]; if (!enemy) continue; if (playerWorldPos.distanceTo(enemy.position) < 1.0 + enemy.size / 2) { if (enemy.type === 'kamikaze') { this.dealDamageTo(enemy, enemy.hp); } else { this.playerTakeDamage(enemy.damage); } this.player.lastHitTime = now; damaged = true; break; } } if (!damaged && this.boss && playerWorldPos.distanceTo(this.boss.position) < this.boss.size / 2) { this.playerTakeDamage(this.boss.damage); this.player.lastHitTime = now; } } for (let i = this.pickups.length - 1; i >= 0; i--) { const pickup = this.pickups[i]; if (playerWorldPos.distanceTo(pickup.position) < 1.5) { if (pickup.type === 'ammo') this.player.reserveAmmo += weaponConfig.PICKUP_AMMO_AMOUNT; if (pickup.type === 'health') this.player.hp = Math.min(this.player.maxHp, this.player.hp + CONFIG.PICKUPS.HEALTH_AMOUNT); this.scene.remove(pickup); this.pickups.splice(i, 1); } } }

    private flashMesh(mesh?: THREE.Mesh) { if (mesh?.material instanceof THREE.MeshStandardMaterial) { const material = mesh.material; const originalEmissive = material.emissive.getHex(); material.emissive.setHex(0xffffff); setTimeout(() => { if (material) { material.emissive.setHex(originalEmissive); } }, 100); } }
    
    private unlockSkills() { this.player.skills.q.unlocked = true; this.player.skills.z.unlocked = true; this.onMessage("系統升級：技能已解鎖 (Q & Z)"); }
    
    private onWindowResize = () => { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); this.composer.setSize(window.innerWidth, window.innerHeight); }
    private onKeyDown = (event: KeyboardEvent) => { if (event.code === 'Escape' && (this.gameState === 'playing' || this.gameState === 'boss_fight' || this.gameState === 'paused')) { this.togglePause(); } else { this.keys[event.code] = true; } }
    private onKeyUp = (event: KeyboardEvent) => { this.keys[event.code] = false; }
    private onMouseDown = (event: MouseEvent) => {
        if (document.pointerLockElement === this.canvas && this.player) {
            if (event.button === 0) {
                this.keys['mouse0'] = true;
            }
            if (event.button === 2 && !this.player.melee.attacking && !this.player.reloading) {
                this.player.isAiming = true;
            }
        }
    };
    private onMouseUp = (event: MouseEvent) => {
        if (event.button === 0) this.keys['mouse0'] = false;
        if (event.button === 2 && this.player) {
            this.player.isAiming = false;
        }
    };
    private onMouseMove = (event: MouseEvent) => { if (document.pointerLockElement === this.canvas) { this.playerObject.rotation.y -= event.movementX / 500; this.camera.rotation.x -= event.movementY / 500; this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x)); } };

    private addEventListeners() { window.addEventListener("resize", this.onWindowResize); document.addEventListener("keydown", this.onKeyDown); document.addEventListener("keyup", this.onKeyUp); document.addEventListener("mousedown", this.onMouseDown); document.addEventListener("mouseup", this.onMouseUp); document.addEventListener("mousemove", this.onMouseMove); this.canvas.addEventListener('contextmenu', (e) => e.preventDefault()); }
    private removeEventListeners() { window.removeEventListener("resize", this.onWindowResize); document.removeEventListener("keydown", this.onKeyDown); document.removeEventListener("keyup", this.onKeyUp); document.removeEventListener("mousedown", this.onMouseDown); document.removeEventListener("mouseup", this.onMouseUp); document.removeEventListener("mousemove", this.onMouseMove); }
    
    private createExplosion(position: THREE.Vector3, options: {coreColor: number, sparkColor: number, count: number}) { 
        const coreParticle = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), new THREE.MeshBasicMaterial({ color: options.coreColor, transparent: true, blending: THREE.AdditiveBlending })) as unknown as Particle; 
        coreParticle.position.copy(position); coreParticle.velocity = new THREE.Vector3(0,0,0); coreParticle.lifespan = 0.15; 
        this.particles.push(coreParticle); this.scene.add(coreParticle); 
        
        const explosionLight = new THREE.PointLight(options.coreColor, 15, 40, 3);
        explosionLight.position.copy(position);
        this.scene.add(explosionLight);
        this.expiringLights.push({ light: explosionLight, lifespan: 0.5, maxLifespan: 0.5 });
        
        for (let i = 0; i < options.count; i++) { 
            const particle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: options.sparkColor, transparent: true, blending: THREE.AdditiveBlending })) as unknown as Particle; 
            particle.position.copy(position); 
            particle.velocity = new THREE.Vector3((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15); 
            particle.lifespan = Math.random() * 0.8 + 0.4; 
            this.particles.push(particle); 
            this.scene.add(particle); 
        } 
    }
    private updateExpiringLights(deltaTime: number) {
        for (let i = this.expiringLights.length - 1; i >= 0; i--) {
            const l = this.expiringLights[i];
            l.lifespan -= deltaTime;
            if (l.lifespan <= 0) {
                this.scene.remove(l.light);
                l.light.dispose();
                this.expiringLights.splice(i, 1);
            } else {
                l.light.intensity = 15 * (l.lifespan / l.maxLifespan);
            }
        }
    }
    private updateParticles(deltaTime: number) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i] as any;
            p.lifespan -= deltaTime;

            if (p.isShockwave) {
                p.scale.x += deltaTime * 50;
                p.scale.y += deltaTime * 50;
                p.material.opacity = p.lifespan / 3;
                const playerDist = p.position.distanceTo(this.playerObject.position);
                if (Math.abs(playerDist - p.scale.x * p.geometry.parameters.innerRadius) < 1.0) this.playerTakeDamage(p.damage);
            } else if (p.isShockwaveRing) {
                const currentRadius = p.scale.x;
                p.scale.set(currentRadius + p.expansionRate * deltaTime, currentRadius + p.expansionRate * deltaTime, 1);
                p.material.opacity = p.lifespan / 4;
                const playerDist = p.position.distanceTo(this.playerObject.position);
                if (this.player.onGround && Math.abs(playerDist - p.scale.x) < 0.5) {
                    this.playerTakeDamage(p.damage);
                    p.lifespan = 0; // one hit only
                }
            } else if (p.isSweepingLaser) {
                p.rotation.y += p.rotationSpeed * deltaTime;
                p.material.opacity = p.lifespan / 5;
                const localPlayerPos = this.playerObject.position.clone();
                p.worldToLocal(localPlayerPos);
                if(Math.abs(localPlayerPos.y - p.position.y) < p.geometry.parameters.height && Math.abs(localPlayerPos.z - p.position.z) < p.geometry.parameters.depth) this.playerTakeDamage(p.damage * deltaTime);
            } else {
                // Regular particle update
                if (p.velocity) {
                    p.position.add(p.velocity.clone().multiplyScalar(deltaTime));
                }
                p.material.opacity = Math.max(0, p.lifespan * 2);
            }
            
            if (p.lifespan <= 0) {
                this.scene.remove(p);
                this.particles.splice(i, 1);
            }
        }
    }
    private createMuzzleFlashTexture() { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const context = canvas.getContext('2d')!; const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32); gradient.addColorStop(0, 'rgba(255, 255, 200, 1)'); gradient.addColorStop(0.3, 'rgba(255, 200, 100, 0.8)'); gradient.addColorStop(1, 'rgba(255, 100, 0, 0)'); context.fillStyle = gradient; context.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(canvas); }
}