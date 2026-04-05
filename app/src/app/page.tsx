"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useFortuneCookie } from '@/hooks/useFortuneCookieRealBlockchain';

interface Stats {
  totalPoints: number;
  tapCount: number;
}

interface Fortune {
  text: string;
  points: number;
}

type CookieState = 'intact' | 'cracking' | 'broken' | 'resetting';

const FORTUNES: string[] = [
  "Persistence pays off! Keep going! 💪",
  "Today is your lucky day! ✨",
  "Believe in yourself, you can do it! 🌟",
  "A fresh start is coming your way. 🍃",
  "Your kindness will lead you to success. 🧡",
  "Great things take time. Be patient. ⏳",
  "Adventure awaits you around the corner. 🗺️",
  "You are stronger than you think! 🦁",
  "A smile is your best accessory. 😊",
  "Good news is on its way to you. 📩"
];

const GESTURE_THRESHOLD_START = 280; 
const GESTURE_THRESHOLD_PULL = 550;
const STORAGE_KEY = 'zen_fortune_stats';

export default function HomePage() {
  const { publicKey, connected, disconnect } = useWallet();
  const { recordFortune } = useFortuneCookie();
  
  const [stats, setStats] = useState<Stats>(() => {
    if (typeof window === 'undefined') return { totalPoints: 0, tapCount: 0 };
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : { totalPoints: 0, tapCount: 0 };
  });

  const [cookieState, setCookieState] = useState<CookieState>('intact');
  const [currentFortune, setCurrentFortune] = useState<Fortune | null>(null);
  const [numHandsDetected, setNumHandsDetected] = useState(0);
  const [pullProgress, setPullProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing Camera...");
  const [isLocked, setIsLocked] = useState(false);
  const [handDistance, setHandDistance] = useState(0);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isReadyToPullRef = useRef<boolean>(false);
  const lastSeenTwoHands = useRef<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    }
  }, [stats]);

  const breakCookie = useCallback(async () => {
    if (cookieState !== 'intact') return;
    const randomFortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const points = Math.floor(Math.random() * 91) + 10;
    
    setCookieState('cracking');
    
    setTimeout(async () => {
      setCookieState('broken');
      setCurrentFortune({ text: randomFortune, points });
      setStats(prev => ({ totalPoints: prev.totalPoints + points, tapCount: prev.tapCount + 1 }));
      
      // Record on-chain if wallet connected
      if (connected && publicKey) {
        setIsRecording(true);
        try {
          const archetype = Math.floor(Math.random() * 4); // 0-3
          const signature = await recordFortune(archetype);
          setTxSignature(signature);
        } catch (error) {
          console.error('Failed to record fortune on-chain:', error);
        } finally {
          setIsRecording(false);
        }
      }
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
    if (!connected) return;
    if (!videoRef.current || !canvasRef.current || typeof window === 'undefined') return;
    if (!(window as any).Hands) {
      console.error('MediaPipe Hands not loaded');
      return;
    }

    const hands = new (window as any).Hands({
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
          (window as any).drawConnectors(canvasCtx, landmarks, (window as any).HAND_CONNECTIONS, { color: '#fb923c', lineWidth: 4 });
          (window as any).drawLandmarks(canvasCtx, landmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });
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

    const camera = new (window as any).Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 640,
      height: 480
    });

    camera.start();
    return () => { 
      try {
        camera.stop();
      } catch (e) {
        console.log('Camera stop error:', e);
      }
    };
  }, [breakCookie, cookieState, connected]);

  if (!connected) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        padding: '16px',
        background: 'linear-gradient(to bottom right, #fef3c7, #fed7aa)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '120px', marginBottom: '32px', lineHeight: '1' }}>🥠</div>
          <h1 style={{ fontSize: '48px', fontWeight: 900, color: '#78350f', marginBottom: '16px' }}>ZEN FORTUNE COOKIE</h1>
          <p style={{ fontSize: '24px', color: '#b45309', marginBottom: '48px' }}>Connect your wallet to start</p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <WalletMultiButton />
          </div>
          <p style={{ fontSize: '14px', color: '#92400e', marginTop: '32px', opacity: 0.7 }}>💡 Tip: Use "Mock Wallet" to test locally</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '16px',
      color: '#92400e',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      background: 'linear-gradient(to bottom right, #fef3c7, #fed7aa)',
      overflow: 'hidden'
    }}>
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px) rotate(-2deg); }
          75% { transform: translateX(8px) rotate(2deg); }
        }
        .animate-shake {
          animation: shake 0.15s ease-in-out infinite;
        }
        
        @keyframes paper-slip-out {
          0% { 
            transform: translate(-50%, -20px) scaleY(0); 
            opacity: 0; 
          }
          30% {
            opacity: 1;
          }
          100% { 
            transform: translate(-50%, 40px) scaleY(1); 
            opacity: 1; 
          }
        }
        .animate-paper {
          animation: paper-slip-out 0.8s cubic-bezier(0.23, 1, 0.32, 1) forwards;
          transform-origin: top center;
        }

        @keyframes particle-burst {
          0% { transform: scale(1) translate(0, 0); opacity: 1; }
          100% { transform: scale(0) translate(var(--tw-translate-x), var(--tw-translate-y)); opacity: 0; }
        }
        .particle {
          position: absolute;
          width: 8px;
          height: 8px;
          background-color: #fcd34d;
          border-radius: 2px;
          animation: particle-burst 0.6s ease-out forwards;
        }
        
        .paper-texture {
          background: linear-gradient(to bottom, #fff 0%, #f9f9f9 100%);
          box-shadow: 0 4px 15px rgba(0,0,0,0.1), inset 0 0 10px rgba(0,0,0,0.02);
        }
      `}</style>

      {/* Wallet Info & Disconnect */}
      <div style={{ position: 'absolute', top: '32px', right: '32px', zIndex: 50, display: 'flex', gap: '12px', alignItems: 'center' }}>
        {publicKey && (
          <div style={{
            background: 'rgba(255,255,255,0.9)',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#92400e',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </div>
        )}
        {connected && (
          <button
            onClick={() => disconnect()}
            style={{
              background: '#ef4444',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#dc2626'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#ef4444'}
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Stats Board */}
      <div style={{
        position: 'absolute',
        top: '32px',
        left: '32px',
        background: 'rgba(255,255,255,0.4)',
        backdropFilter: 'blur(12px)',
        padding: '20px',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.5)',
        boxShadow: '0 20px 25px rgba(0,0,0,0.1)',
        transition: 'transform 0.2s',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.6, fontWeight: 900, marginBottom: '4px' }}>Total Points</div>
        <div style={{ fontSize: '36px', fontWeight: 900, color: '#ea580c', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>{stats.totalPoints.toLocaleString()}</div>
        <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.6, fontWeight: 900, marginTop: '8px' }}>Cookies Cracked</div>
        <div style={{ fontSize: '24px', fontWeight: 900, color: '#f97316' }}>{stats.tapCount}</div>
      </div>
      
      {/* Main Cookie Stage */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {/* Instruction overlay */}
        {cookieState === 'intact' && !isLocked && (
          <div style={{
            position: 'absolute',
            top: '-192px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: 0.9,
            pointerEvents: 'none',
            transition: 'all 0.3s',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
          }}>
             <div style={{ display: 'flex', gap: '64px', fontSize: '48px' }}>
                <span>👊</span>
                <span style={{ fontSize: '18px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', lineHeight: 1.2 }}>Bring<br/>Together</span>
                <span>👊</span>
             </div>
             <p className="mt-6 font-black bg-white/90 text-orange-900 px-6 py-3 rounded-2xl shadow-2xl border-2 border-orange-200 uppercase text-sm tracking-widest">
               Tip: Keep hands separate but close (~15cm)
             </p>
          </div>
        )}

        {/* Cookie Visualization */}
        <div style={{
          position: 'relative',
          transition: 'all 0.3s'
        }} className={cookieState === 'cracking' ? 'animate-shake' : ''}>
          {cookieState !== 'broken' ? (
            <div 
              style={{ 
                fontSize: `${280 + pullProgress * 100}px`,
                transform: `scale(${1 + pullProgress * 0.4})`,
                filter: isLocked ? `drop-shadow(0 0 30px rgba(251, 146, 60, 0.4))` : `drop-shadow(0 20px 50px rgba(0,0,0,0.1))`,
                transition: 'all 0.1s',
                userSelect: 'none',
                lineHeight: '1'
              }}
            >
              🥠
            </div>
          ) : (
            <div style={{
              position: 'relative',
              width: '400px',
              height: '400px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {/* Particles/Crumbs Burst */}
              {[...Array(8)].map((_, i) => (
                <div 
                  key={i} 
                  className="particle" 
                  style={{ 
                    ['--tw-translate-x' as any]: `${(Math.random() - 0.5) * 300}px`,
                    ['--tw-translate-y' as any]: `${(Math.random() - 0.5) * 300}px`,
                    left: '50%',
                    top: '50%'
                  }}
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
                      disabled={isRecording}
                      className="bg-orange-600 text-white px-5 py-2 rounded-lg font-black text-sm uppercase tracking-wider hover:bg-orange-700 active:scale-95 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isRecording ? 'Recording...' : 'Next Cookie'}
                    </button>
                  </div>
                  
                  {/* On-chain confirmation */}
                  {txSignature && (
                    <div className="mt-3 pt-3 border-t border-orange-200 text-xs text-green-600">
                      <p className="font-bold mb-1">✓ Recorded on-chain</p>
                      <a 
                        href={`https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=http://localhost:8899`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-600 underline text-[10px]"
                      >
                        View Transaction
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Broken Halves */}
              <div style={{ fontSize: '280px', clipPath: 'inset(0 50% 0 0)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-110%, -50%) rotate(-25deg)', opacity: 0.9, transition: 'all 0.7s', userSelect: 'none' }}>🥠</div>
              <div style={{ fontSize: '280px', clipPath: 'inset(0 0 0 50%)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-10%, -50%) rotate(25deg)', opacity: 0.9, transition: 'all 0.7s', userSelect: 'none' }}>🥠</div>
            </div>
          )}
        </div>

        {/* Dynamic Status Display */}
        <div style={{
          marginTop: '80px',
          padding: '24px 48px',
          borderRadius: '24px',
          border: `4px solid ${isLocked ? '#ea580c' : '#fed7aa'}`,
          transition: 'all 0.3s',
          boxShadow: '0 20px 25px rgba(0,0,0,0.1)',
          minWidth: '380px',
          textAlign: 'center',
          background: isLocked ? '#ea580c' : 'rgba(255,255,255,0.9)',
          color: isLocked ? 'white' : '#92400e',
          animation: isLocked ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none'
        }}>
          <p style={{
            fontSize: '32px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '-1px'
          }}>{statusMessage}</p>
          {!isLocked && cookieState === 'intact' && (
             <p style={{
               fontSize: '12px',
               opacity: 0.5,
               marginTop: '12px',
               fontWeight: 700,
               textTransform: 'uppercase',
               letterSpacing: '1px'
             }}>Tip: Keep hands parallel and steady</p>
          )}
        </div>
      </div>

      {/* Enhanced Camera Viewfinder */}
      <div style={{
        position: 'fixed',
        bottom: '32px',
        right: '32px',
        width: '288px',
        height: '208px',
        borderRadius: '24px',
        overflow: 'hidden',
        border: '4px solid white',
        boxShadow: '0 0 50px rgba(0,0,0,0.15)',
        background: 'black',
        transition: 'transform 0.2s',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <video ref={videoRef} style={{ display: 'none' }} autoPlay muted playsInline />
        <canvas ref={canvasRef} width="640" height="480" style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)'
        }} />
        {isLocked && <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(249, 115, 22, 0.2)',
          border: '12px solid #f97316',
          boxSizing: 'border-box',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          pointerEvents: 'none'
        }} />}
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          padding: '4px 12px',
          borderRadius: '9999px',
          fontSize: '10px',
          color: 'white',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase'
        }}>
          {numHandsDetected} HANDS DETECTED
        </div>
      </div>

      {/* Tension Progress Bar */}
      {cookieState === 'intact' && pullProgress > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '96px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '384px',
          height: '40px',
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '9999px',
          overflow: 'hidden',
          border: '2px solid rgba(255,255,255,0.5)',
          padding: '6px',
          boxShadow: '0 20px 25px rgba(0,0,0,0.1)',
          backdropFilter: 'blur(4px)'
        }}>
          <div 
            style={{
              height: '100%',
              background: 'linear-gradient(to right, #fbbf24, #f97316, #dc2626)',
              transition: 'width 0.075s linear',
              borderRadius: '9999px',
              boxShadow: '0 0 20px rgba(249,115,22,0.4)',
              width: `${pullProgress * 100}%`
            }}
          />
        </div>
      )}
    </div>
  );
}
