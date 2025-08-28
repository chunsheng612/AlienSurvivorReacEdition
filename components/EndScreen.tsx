
import React from 'react';

interface EndScreenProps {
  title: string;
  showNGPlus: boolean;
  onRestart: () => void;
  onNGPlus: () => void;
}

const EndButton: React.FC<{onClick: () => void; children: React.ReactNode; className?: string}> = ({onClick, children, className}) => (
    <button
      onClick={onClick}
      className={`font-bold text-xl px-8 py-4 m-4 bg-black bg-opacity-40 border-2 border-cyan-400 text-cyan-400 rounded-md transition-all duration-300 hover:bg-cyan-400 hover:text-black hover:shadow-[0_0_20px_theme(colors.cyan.400)] ${className}`}
    >
      {children}
    </button>
);


const EndScreen: React.FC<EndScreenProps> = ({ title, showNGPlus, onRestart, onNGPlus }) => {
  return (
    <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col justify-center items-center text-center pointer-events-auto z-10">
      <h1 className="text-7xl font-bold text-shadow-neon text-cyan-300 mb-8 whitespace-pre-wrap">{title}</h1>
      <div>
        <EndButton onClick={onRestart}>再玩一次 (Restart)</EndButton>
        {showNGPlus && <EndButton onClick={onNGPlus}>新遊戲+ (New Game+)</EndButton>}
      </div>
    </div>
  );
};

export default EndScreen;
