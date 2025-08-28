
import React, { useState, useEffect } from 'react';
import type { PlayerStats, WaveState, BossState, GameState } from '../game/types';
import { CONFIG } from '../game/config';

interface BarProps {
  value: number;
  maxValue: number;
  color: string;
  className?: string;
  isBlinking?: boolean;
}

const StatBar: React.FC<BarProps> = ({ value, maxValue, color, className, isBlinking = false }) => {
  const percentage = (value / maxValue) * 100;
  return (
    <div className={`w-full h-5 bg-black bg-opacity-50 border border-gray-400 rounded-sm overflow-hidden ${className}`}>
      <div 
        className={`h-full transition-all duration-300 ${isBlinking ? 'animate-blink' : ''}`} 
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </div>
  );
};

interface SkillIconProps {
  label: string | React.ReactNode;
  unlocked: boolean;
  active?: boolean;
  duration?: number;
  cooldown: number;
  maxCooldown: number;
  children?: React.ReactNode;
}

const SkillIcon: React.FC<SkillIconProps> = ({ label, unlocked, active, duration, cooldown, maxCooldown, children }) => {
  const cooldownPercentage = unlocked && !active ? (cooldown / maxCooldown) * 100 : 100;

  return (
    <div className={`relative w-14 h-14 border-2 rounded-md flex justify-center items-center text-2xl font-bold overflow-hidden
      ${unlocked ? (active ? 'border-yellow-400 text-yellow-400 bg-yellow-900 bg-opacity-50 animate-pulse' :'border-cyan-400 text-cyan-400 bg-black bg-opacity-50') : 'border-gray-600 text-gray-600 bg-gray-800'}`}>
      {label}
      {unlocked && cooldown > 0 && !active && (
        <div 
          className="absolute inset-0 bg-black bg-opacity-80 flex justify-center items-center text-white text-lg"
          style={{ clipPath: `inset(${100 - cooldownPercentage}% 0 0 0)`}}
        >
          {cooldown.toFixed(1)}
        </div>
      )}
      {unlocked && active && (
        <>
        <div 
          className="absolute bottom-0 left-0 h-full bg-yellow-400 bg-opacity-40"
          style={{ width: `${(duration! / maxCooldown) * 100}%`}}
        />
        <span className="z-10 text-white text-lg">{duration?.toFixed(1)}</span>
        </>
      )}
      {children}
    </div>
  );
};


interface GameUIProps {
  playerStats: PlayerStats;
  waveState: WaveState | null;
  bossState: BossState | null;
  message: { text: string; id: number } | null;
  gameState: GameState;
  onTogglePause: () => void;
}

const MeleeIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-4.879-4.879l-4.242-4.243-4.243 4.243 4.243 4.243zM12 3v18" /></svg> );
const PauseIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> );
const ShieldIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 001.414 1.414L10 9.414l3.293 3.293a1 1 0 001.414-1.414l-4-4z" clipRule="evenodd" /></svg> );
const DroneIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg> );

const GameUI: React.FC<GameUIProps> = ({ playerStats, waveState, bossState, message, gameState, onTogglePause }) => {
  const { hp, maxHp, stamina, maxStamina, ammoInMagazine, reserveAmmo, skills, reloading, melee, shield, drone, isAiming } = playerStats;
  const healthPercent = hp / maxHp;

  const [currentMessage, setCurrentMessage] = useState<{ text: string; id: number } | null>(null);
  const [showDamageVignette, setShowDamageVignette] = useState(false);
  const messageTimer = React.useRef<number | null>(null);

  useEffect(() => { if (message) { setCurrentMessage(message); if (messageTimer.current) clearTimeout(messageTimer.current); messageTimer.current = window.setTimeout(() => { setCurrentMessage(null); }, 3000); } }, [message]);
  useEffect(() => { if (healthPercent < 0.3) { setShowDamageVignette(true); } else { setShowDamageVignette(false); } }, [healthPercent]);

  return (
    <div className="absolute inset-0 pointer-events-none text-white text-shadow-neon">
      {!isAiming && <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-5"><div className="absolute w-px h-full bg-cyan-400 top-0 left-1/2 -translate-x-1/2" /><div className="absolute h-px w-full bg-cyan-400 left-0 top-1/2 -translate-y-1/2" /></div>}
      <div className="absolute inset-0 transition-all duration-500" style={{boxShadow: showDamageVignette ? `inset 0 0 150px 50px rgba(255, 0, 0, ${0.7 * (1 - healthPercent / 0.3)})` : 'none'}} />
      
      {(gameState === 'playing' || gameState === 'boss_fight') && (<button onClick={onTogglePause} className="absolute top-5 right-5 p-2 bg-black bg-opacity-30 rounded-full text-cyan-400 hover:bg-cyan-400 hover:text-black transition-colors pointer-events-auto z-20"><PauseIcon /></button>)}

      {waveState && gameState === 'playing' && ( <div className="absolute top-5 left-5 text-2xl p-2 bg-black bg-opacity-30 rounded-md"> 第 {waveState.currentLevel} 波 | 擊殺: {waveState.killedInWave} / {waveState.totalToKill} </div> )}
      {gameState === 'boss_fight' && waveState && ( <div className="absolute top-5 left-5 text-2xl p-2 bg-black bg-opacity-30 rounded-md"> 第 {waveState.currentLevel} 波 | BOSS 戰 </div> )}

      <div className="absolute bottom-5 left-5 w-80 p-4 bg-black bg-opacity-30 rounded-md">
        <div className="text-lg">生命值</div>
        <StatBar value={hp} maxValue={maxHp} color={healthPercent > 0.25 ? '#c62828' : '#ffff00'} isBlinking={healthPercent < 0.25} />
        <div className="text-lg mt-2">耐力</div>
        <StatBar value={stamina} maxValue={maxStamina} color="#1565c0" />
      </div>

      <div className="absolute bottom-5 right-5 p-4 bg-black bg-opacity-30 rounded-md flex items-end space-x-4">
        <div className="text-right">
          <div className="text-sm">彈藥</div>
            <div className="h-14 flex items-end justify-end">
                {reloading ? <span className="text-yellow-400 text-4xl font-bold animate-pulse">RELOADING...</span> : skills.z.active ? <span className="text-purple-400 text-5xl font-bold">∞</span> : (<><span className="text-5xl font-bold">{ammoInMagazine}</span><span className="text-3xl text-gray-400 ml-2"> | {reserveAmmo}</span></>)}
            </div>
        </div>
        <div className="flex space-x-2">
            <SkillIcon label="Q" unlocked={skills.q.unlocked} cooldown={skills.q.cooldown} maxCooldown={CONFIG.SKILL_Q.COOLDOWN} />
            <SkillIcon label="Z" unlocked={skills.z.unlocked} active={skills.z.active} duration={skills.z.duration} cooldown={skills.z.cooldown} maxCooldown={CONFIG.SKILL_Z.DURATION} />
            <div className="relative">
                <SkillIcon label={<MeleeIcon/>} unlocked={true} cooldown={melee.cooldown} maxCooldown={CONFIG.MELEE.COOLDOWN} />
                <span className="absolute top-1 left-2 text-sm font-bold text-white" style={{textShadow: '1px 1px 2px #000a'}}>F</span>
            </div>
            <SkillIcon label={<ShieldIcon />} unlocked={shield.unlocked} active={shield.active} duration={shield.duration} cooldown={shield.cooldown} maxCooldown={CONFIG.SHIELD.DURATION}>
               <span className="absolute top-1 left-2 text-sm font-bold text-white" style={{textShadow: '1px 1px 2px #000a'}}>G</span>
            </SkillIcon>
            {drone.unlocked && <div className="relative w-14 h-14 border-2 rounded-md flex justify-center items-center text-2xl font-bold border-green-400 text-green-400 bg-black bg-opacity-50 animate-pulse"><DroneIcon/></div>}
        </div>
      </div>
      
      {bossState && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 w-4/5 max-w-4xl text-center p-3 bg-black bg-opacity-30 rounded-md">
          <div className="text-2xl font-bold">{bossState.name}</div>
          <StatBar value={bossState.hp} maxValue={bossState.maxHp} color="#ab47bc" className="mt-2 h-6" />
          {bossState.isFinalBoss && (
            <>
            <div className="text-lg mt-1">核心完整性</div>
            <StatBar value={bossState.weakPointHp!} maxValue={bossState.maxWeakPointHp!} color="#00ffff" className="h-4" />
            </>
          )}
        </div>
      )}

      {currentMessage && ( <div key={currentMessage.id} className="absolute top-1/3 left-1/2 -translate-x-1/2 w-full px-4 text-center"> <h2 className="text-5xl font-bold text-cyan-300 animate-pulse">{currentMessage.text}</h2> </div> )}
    </div>
  );
};

export default GameUI;
