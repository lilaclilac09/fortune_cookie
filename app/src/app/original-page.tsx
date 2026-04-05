
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Stats, CookieState, Fortune } from './types';
import { FORTUNES, STORAGE_KEY, GESTURE_THRESHOLD_START, GESTURE_THRESHOLD_PULL } from './constants';

declare const Hands: any;
declare const Camera: any;
declare const drawConnectors: any;
declare const drawLandmarks: any;
declare const HAND_CONNECTIONS: any;

const App: React.FC = () => {
  const [stats, setStats] = useState<Stats>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : { totalPoints: 0, tapCount: 0 };
  });

  const [cookieState, setCookieState] = useState<CookieState>('intact');
  const [currentFortune, setCurrentFortune] = useState<Fortune | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [numHandsDetected, setNumHandsDetected] = useState(0);
  const [pullProgress, setPullProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing Camera...");
  const [isLocked, setIsLocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isReadyToPullRef = useRef<boolean>(false);
  const lastSeenTwoHands = useRef<number>(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }, [stats]);

  const breakCookie = useCallback(() => {
    if (cookieState !== 'intact') return;
    const randomFortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const points = Math.floor(Math.random() * 91) + 10;
    
    setCookieState('cracking');
    
    // Trigger sound if we had one, but let's stick to visual impact
    setTimeout(() => {
      setCookieState('broken');
      setCurrentFortune({ text: randomFortune, points });
      setStats(prev => ({ totalPoints: prev.totalPoints + points, tapCount: prev.tapCount + 1 }));
    }, 400);
  }, [cookieState]);

  const resetCookie = () => {
    setCookieState('resetting');
    setTimeout(() => {
      setCookieState('intact');
      setCurrentFortune(null);
      setPullProgress(0);
      isReadyToPullRef.current = false;
      setIsLocked(false);
    }, 300);
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const hands = new Hands({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    const canvasCtx = canvasRef.current.getContext('2d')!;

    hands.onResults((results: any) => {
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      
      const handsFound = results.multiHandLandmarks?.length || 0;
      setNumHandsDetected(handsFound);
      
      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#fb923c', lineWidth: 4 });
          drawLandmarks(canvasCtx, landmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });
        }

        if (handsFound >= 2 && cookieState === 'intact') {
          lastSeenTwoHands.current = Date.now();
          const h1 = results.multiHandLandmarks[0][0]; 
          const h2 = results.multiHandLandmarks[1][0]; 
          const dx = (h1.x - h2.x) * 1000;
          const dy = (h1.y - h2.y) * 1000;
          const distance = Math.sqrt(dx * dx + dy * dy);

          canvasCtx.beginPath();
          canvasCtx.moveTo(h1.x * canvasRef.current!.width, h1.y * canvasRef.current!.height);
          canvasCtx.lineTo(h2.x * canvasRef.current!.width, h2.y * canvasRef.current!.height);
          canvasCtx.strokeStyle = isReadyToPullRef.current ? '#f59e0b' : '#ffffff';
          canvasCtx.lineWidth = 6;
          canvasCtx.stroke();

          if (!isReadyToPullRef.current) {
            if (distance < GESTURE_THRESHOLD_START) {
              isReadyToPullRef.current = true;
              setIsLocked(true);
              setStatusMessage("LOCKED! NOW PULL! ↔️");
            } else {
              setStatusMessage("Bring hands closer together...");
              setIsLocked(false);
            }
          } else {
            const progress = Math.min(1, Math.max(0, (distance - GESTURE_THRESHOLD_START) / (GESTURE_THRESHOLD_PULL - GESTURE_THRESHOLD_START)));
            setPullProgress(progress);
            setStatusMessage("Pulling hard...!");

            if (distance > GESTURE_THRESHOLD_PULL) {
              breakCookie();
              isReadyToPullRef.current = false;
              setIsLocked(false);
            }
          }
        } else if (handsFound < 2 && cookieState === 'intact') {
          const timeSinceLastSeen = Date.now() - lastSeenTwoHands.current;
          if (isReadyToPullRef.current && timeSinceLastSeen < 500) {
            // Tolerate flicker
          } else {
            setStatusMessage(handsFound === 1 ? "Show both hands (don't overlap)" : "Place both hands in front of camera 🖐️");
            setPullProgress(0);
            isReadyToPullRef.current = false;
            setIsLocked(false);
          }
        }
      }
      canvasCtx.restore();
    });

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 640,
      height: 480
    });

    camera.start().then(() => setIsCameraReady(true));
    return () => { camera.stop(); };
  }, [breakCookie, cookieState]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-orange-900 font-sans relative">
      {/* Stats Board */}
      <div className="absolute top-8 left-8 bg-white/40 backdrop-blur-md p-5 rounded-2xl border border-white/50 shadow-xl transition-all hover:scale-105">
        <div className="text-xs uppercase tracking-widest opacity-60 font-black mb-1">Total Points</div>
        <div className="text-4xl font-black text-orange-600 drop-shadow-sm">{stats.totalPoints.toLocaleString()}</div>
      </div>
      
      {/* Main Cookie Stage */}
      <div className="relative flex flex-col items-center justify-center">
        {/* Instruction overlay */}
        {cookieState === 'intact' && !isLocked && (
          <div className="absolute -top-48 flex flex-col items-center opacity-90 pointer-events-none transition-all">
             <div className="flex gap-16 text-6xl animate-pulse">
                <span>👊</span>
                <span className="text-2xl flex flex-col items-center justify-center font-black uppercase tracking-tighter">Bring<br/>Together</span>
                <span>👊</span>
             </div>
             <p className="mt-6 font-black bg-white/90 text-orange-900 px-6 py-3 rounded-2xl shadow-2xl border-2 border-orange-200 uppercase text-sm tracking-widest">
               Tip: Keep hands separate but close (~15cm)
             </p>
          </div>
        )}

        {/* Cookie Visualization */}
        <div className={`relative transition-all duration-300 ${cookieState === 'cracking' ? 'animate-shake' : ''}`}>
          {cookieState !== 'broken' ? (
            <div 
              className="text-[280px] md:text-[380px] select-none filter drop-shadow-[0_20px_50px_rgba(0,0,0,0.2)] transition-all duration-100"
              style={{ 
                transform: `scale(${1 + pullProgress * 0.4})`,
                filter: isLocked ? `drop-shadow(0 0 30px rgba(251, 146, 60, 0.4))` : `drop-shadow(0 20px 50px rgba(0,0,0,0.1))`
              }}
            >
              🥠
            </div>
          ) : (
            <div className="relative w-[400px] h-[400px] flex items-center justify-center">
              {/* Particles/Crumbs Burst */}
              {[...Array(8)].map((_, i) => (
                <div 
                  key={i} 
                  className="particle" 
                  style={{ 
                    '--tw-translate-x': `${(Math.random() - 0.5) * 300}px`,
                    '--tw-translate-y': `${(Math.random() - 0.5) * 300}px`,
                    left: '50%',
                    top: '50%'
                  } as any}
                />
              ))}

              {/* Physical Paper Slip */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-paper z-10">
                <div className="paper-texture w-[320px] p-6 border-t-4 border-orange-300 rounded-sm transform shadow-xl rotate-1">
                  <p className="text-gray-400 text-[10px] uppercase font-bold tracking-widest mb-1 text-left">Your Fortune</p>
                  <p className="text-xl font-bold italic text-gray-800 leading-tight">"{currentFortune?.text}"</p>
                  <div className="mt-4 flex justify-between items-center">
                    <span className="text-orange-500 font-black text-lg">+{currentFortune?.points} PTS</span>
                    <button 
                      onClick={resetCookie} 
                      className="bg-orange-600 text-white px-5 py-2 rounded-lg font-black text-sm uppercase tracking-wider hover:bg-orange-700 active:scale-95 transition-all shadow-lg"
                    >
                      Next Cookie
                    </button>
                  </div>
                </div>
              </div>

              {/* Broken Halves */}
              <div className="absolute left-1/2 top-1/2 -translate-x-[110%] -translate-y-1/2 text-[280px] md:text-[380px] select-none transition-all duration-700 rotate-[-25deg] opacity-90" style={{ clipPath: 'inset(0 50% 0 0)' }}>🥠</div>
              <div className="absolute left-1/2 top-1/2 -translate-x-[-10%] -translate-y-1/2 text-[280px] md:text-[380px] select-none transition-all duration-700 rotate-[25deg] opacity-90" style={{ clipPath: 'inset(0 0 0 50%)' }}>🥠</div>
            </div>
          )}
        </div>

        {/* Dynamic Status Display */}
        <div className={`mt-20 px-12 py-6 rounded-3xl border-4 transition-all shadow-2xl min-w-[380px] text-center ${isLocked ? 'bg-orange-600 border-orange-400 text-white animate-pulse' : 'bg-white/90 border-orange-200 text-orange-950'}`}>
          <p className="text-3xl font-black uppercase tracking-tighter">{statusMessage}</p>
          {!isLocked && cookieState === 'intact' && (
             <p className="text-xs opacity-50 mt-3 font-bold uppercase tracking-widest">Tip: Keep hands parallel and steady</p>
          )}
        </div>
      </div>

      {/* Enhanced Camera Viewfinder */}
      <div className="fixed bottom-8 right-8 w-72 h-52 rounded-3xl overflow-hidden border-4 border-white shadow-[0_0_50px_rgba(0,0,0,0.15)] bg-black group transition-all hover:scale-105">
        <video ref={videoRef} className="hidden" autoPlay muted playsInline />
        <canvas ref={canvasRef} width="640" height="480" className="w-full h-full object-cover scale-x-[-1]" />
        {isLocked && <div className="absolute inset-0 bg-orange-500/20 border-[12px] border-orange-500 animate-pulse pointer-events-none" />}
        <div className="absolute bottom-3 left-3 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] text-white font-bold tracking-widest uppercase">
          {numHandsDetected} HANDS DETECTED
        </div>
      </div>

      {/* Tension Progress Bar */}
      {cookieState === 'intact' && pullProgress > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-96 h-10 bg-black/10 rounded-full overflow-hidden border-2 border-white/50 p-1.5 shadow-2xl backdrop-blur-sm">
          <div 
            className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-600 transition-all duration-75 rounded-full shadow-[0_0_20px_rgba(249,115,22,0.4)]" 
            style={{ width: `${pullProgress * 100}%` }} 
          />
        </div>
      )}
    </div>
  );
};

export default App;
