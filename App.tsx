
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Game } from './game/Game';
import type { GameState, PlayerStats, WaveState, BossState } from './game/types';
import GameUI from './components/GameUI';
import StartScreen from './components/StartScreen';
import EndScreen from './components/EndScreen';
import PauseScreen from './components/PauseScreen';

const App: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameInstance = useRef<Game | null>(null);

    const [gameState, setGameState] = useState<GameState>('start_screen');
    const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
    const [waveState, setWaveState] = useState<WaveState | null>(null);
    const [bossState, setBossState] = useState<BossState | null>(null);
    const [message, setMessage] = useState<{ text: string; id: number } | null>({ text: '異星生還者\nAlien Survivor', id: 0 });
    const [endScreenState, setEndScreenState] = useState<{ title: string; showNGPlus: boolean } | null>(null);

    const handleStatsUpdate = useCallback((stats: PlayerStats) => {
        setPlayerStats(stats);
    }, []);

    const handleWaveUpdate = useCallback((wave: WaveState) => {
        setWaveState(wave);
    }, []);
    
    const handleBossUpdate = useCallback((boss: BossState | null) => {
        setBossState(boss);
    }, []);

    const handleMessage = useCallback((text: string) => {
        setMessage({ text, id: Date.now() });
    }, []);

    const handleGameOver = useCallback(() => {
        setGameState('game_over');
        setEndScreenState({ title: "任務失敗\nMission Failed", showNGPlus: false });
    }, []);
    
    const handleVictory = useCallback(() => {
        setGameState('victory');
        setEndScreenState({ title: "任務完成！\nMission Complete!", showNGPlus: true });
    }, []);

    const handleTogglePause = useCallback(() => {
        gameInstance.current?.togglePause();
    }, []);

    const handleResumeGame = useCallback(() => {
        if (gameInstance.current && canvasRef.current) {
            (canvasRef.current.requestPointerLock() as any)?.catch((err: any) => {
                console.warn("Could not acquire pointer lock on resume.", err);
            });
            gameInstance.current.togglePause();
        }
    }, []);
    
    const handleQuitToMainMenu = useCallback(() => {
        if (gameInstance.current) {
            gameInstance.current.quitToMainMenu();
        }
    }, []);

    useEffect(() => {
        if (canvasRef.current) {
            const game = new Game(
                canvasRef.current,
                handleStatsUpdate,
                handleWaveUpdate,
                handleBossUpdate,
                handleMessage,
                handleGameOver,
                handleVictory,
                (newState) => setGameState(newState)
            );
            gameInstance.current = game;
            game.init();

            return () => {
                game.destroy();
                gameInstance.current = null;
            };
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStartGame = (isNGP: boolean) => {
        if (gameInstance.current && canvasRef.current) {
            (canvasRef.current.requestPointerLock() as any)?.catch((err: any) => {
                console.warn("Could not acquire pointer lock. This can happen if the user denies permission or an exit is in progress.", err);
            });
            setMessage(null);
            gameInstance.current.resetGame(isNGP);
        }
    };

    return (
        <div className="relative w-screen h-screen bg-black">
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
            
            <div className="absolute inset-0 pointer-events-none">
                {gameState === 'start_screen' && <StartScreen onStart={() => handleStartGame(false)} message={message?.text ?? ''} />}

                {(gameState === 'playing' || gameState === 'boss_fight' || gameState === 'wave_transition') && playerStats && (
                    <GameUI 
                        playerStats={playerStats}
                        waveState={waveState}
                        bossState={bossState}
                        message={message}
                        gameState={gameState}
                        onTogglePause={handleTogglePause}
                    />
                )}
                
                {(gameState === 'game_over' || gameState === 'victory') && endScreenState && (
                    <EndScreen
                        title={endScreenState.title}
                        showNGPlus={endScreenState.showNGPlus}
                        onRestart={() => handleStartGame(false)}
                        onNGPlus={() => handleStartGame(true)}
                    />
                )}

                {gameState === 'paused' && (
                    <PauseScreen onResume={handleResumeGame} onMainMenu={handleQuitToMainMenu} />
                )}
            </div>
        </div>
    );
};

export default App;
