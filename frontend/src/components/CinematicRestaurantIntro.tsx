import { useEffect, useRef } from 'react';

interface Props {
  restaurantName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  onDone: () => void;
}

export default function CinematicRestaurantIntro({ restaurantName, logoUrl, primaryColor, onDone }: Props) {
  const doneRef = useRef(false);

  const accent = primaryColor ?? '#4a6930';

  useEffect(() => {
    const t = setTimeout(() => {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
    }, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 60%, #0d1a0f 0%, #060c07 100%)' }}
      dir="rtl"
    >
      {/* Ambient glow */}
      <div
        className="absolute rounded-full blur-[120px] opacity-30 animate-iron-pulse"
        style={{
          width: '480px',
          height: '480px',
          background: accent,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Light sweep */}
      <div className="absolute inset-0 animate-iron-sweep pointer-events-none"
        style={{
          background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.04) 50%, transparent 70%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-6 animate-iron-fadein px-8 text-center">

        {logoUrl ? (
          <img
            src={logoUrl}
            alt={restaurantName}
            className="w-24 h-24 rounded-2xl object-cover shadow-2xl"
            style={{ boxShadow: `0 0 40px ${accent}55` }}
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white shadow-2xl"
            style={{ background: accent, boxShadow: `0 0 40px ${accent}66` }}
          >
            {restaurantName.charAt(0)}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h1
            className="text-4xl font-extrabold tracking-tight text-white"
            style={{ textShadow: `0 0 30px ${accent}99` }}
          >
            {restaurantName}
          </h1>
          <p className="text-sm font-medium tracking-widest uppercase"
            style={{ color: `${accent}cc`, letterSpacing: '0.2em' }}>
            מערכת האירוח החכמה של IRON
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-32 h-0.5 rounded-full overflow-hidden mt-2"
          style={{ background: `${accent}33` }}>
          <div
            className="h-full rounded-full animate-iron-progress"
            style={{ background: accent }}
          />
        </div>
      </div>

      <style>{`
        @keyframes iron-fadein {
          0%   { opacity: 0; transform: translateY(16px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes iron-pulse {
          0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(1);    }
          50%       { opacity: 0.40; transform: translate(-50%, -50%) scale(1.12); }
        }
        @keyframes iron-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%);  }
        }
        @keyframes iron-progress {
          0%   { width: 0%;    }
          100% { width: 100%;  }
        }
        .animate-iron-fadein  { animation: iron-fadein  0.7s cubic-bezier(.22,1,.36,1) forwards; }
        .animate-iron-pulse   { animation: iron-pulse   3s ease-in-out infinite; }
        .animate-iron-sweep   { animation: iron-sweep   2.4s ease-in-out forwards; }
        .animate-iron-progress{ animation: iron-progress 2.8s linear forwards; }
      `}</style>
    </div>
  );
}
