
import React from 'react';

interface StartScreenProps {
  onStart: () => void;
  message: string;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStart, message }) => {
  return (
    <div 
      className="absolute inset-0 bg-black bg-opacity-70 flex flex-col justify-center items-center text-center cursor-pointer pointer-events-auto"
      onClick={onStart}
    >
      <h1 className="text-6xl md:text-8xl font-bold text-cyan-300 text-shadow-neon whitespace-pre-wrap">
        {message}
      </h1>
      <p className="mt-8 text-2xl text-white animate-pulse">
        [ Click to Start ]
      </p>
    </div>
  );
};

export default StartScreen;
