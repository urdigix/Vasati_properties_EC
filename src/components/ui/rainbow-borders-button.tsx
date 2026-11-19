'use client';

import React from 'react';

export const Button = () => {
  return (
    <div className="rainbow-button-stage isolate flex items-center justify-center min-h-screen">
      <button type="button" className="rainbow-border relative w-[140px] h-10 flex items-center justify-center gap-2.5 px-4 bg-black rounded-xl border-none text-white cursor-pointer font-black transition-all duration-200">
        Button
      </button>

      <style>{`
        .rainbow-button-stage .rainbow-border::before,
        .rainbow-button-stage .rainbow-border::after {
          content: '';
          position: absolute;
          left: -2px;
          top: -2px;
          border-radius: 12px;
          background: linear-gradient(45deg, #fb0094, #0000ff, #00ff00, #ffff00, #ff0000, #fb0094, #0000ff, #00ff00, #ffff00, #ff0000);
          background-size: 400%;
          width: calc(100% + 4px);
          height: calc(100% + 4px);
          z-index: -1;
          pointer-events: none;
          animation: rainbow-button-border 20s linear infinite;
        }
        .rainbow-button-stage .rainbow-border::after { filter: blur(50px); }
        .rainbow-button-stage .rainbow-border:focus-visible { outline: 3px solid #2563eb; outline-offset: 6px; }
        @keyframes rainbow-button-border {
          0% { background-position: 0 0; }
          50% { background-position: 400% 0; }
          100% { background-position: 0 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rainbow-button-stage .rainbow-border { transition: none; }
          .rainbow-button-stage .rainbow-border::before,
          .rainbow-button-stage .rainbow-border::after { animation: none; }
        }
      `}</style>
    </div>
  );
};
