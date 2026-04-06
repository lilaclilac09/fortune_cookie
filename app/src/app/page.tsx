"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFortuneCookie } from '@/hooks/useFortuneCookieRealBlockchain';
import WalletButton from '@/components/WalletButton';

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

const GESTURE_THRESHOLD_START = 180;  // 降低:更容易锁定
const GESTURE_THRESHOLD_PULL = 450;  // 降低:更容易拉动
const STORAGE_KEY = 'zen_fortune_stats';
const CRACK_COST_SOL = 0.001;

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
  const [txError, setTxError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string>('');
  const [inviteBonus, setInviteBonus] = useState<number>(0);

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
    setTxError(null);
    setTxSignature(null);
    setStatusMessage('💾 Recording on-chain...');
    
    setTimeout(async () => {
      setCookieState('broken');
      setCurrentFortune({ text: randomFortune, points });
      setStats(prev => ({ totalPoints: prev.totalPoints + points, tapCount: prev.tapCount + 1 }));
      
      if (connected && publicKey) {
        setIsRecording(true);
        try {
          const archetype = Math.floor(Math.random() * 4);
          const signature = await recordFortune(archetype);
          setTxSignature(signature);
          setStatusMessage('✓ Transaction confirmed!');
        } catch (error: any) {
          console.error('Failed to record fortune on-chain:', error);
          setTxError(error?.message || 'Transaction failed. Check wallet balance.');
          setStatusMessage('✗ Transaction failed');
        } finally {
          setIsRecording(false);
        }
      }
    }, 400);
  }, [cookieState, connected, publicKey, recordFortune]);

  const resetCookie = () => {
    setCookieState('resetting');
    setTimeout(() => {
      setCookieState('intact');
      setCurrentFortune(null);
      setPullProgress(0);
      isReadyToPullRef.current = false;
      setIsLocked(false);
      setTxSignature(null);
      setTxError(null);
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
      minDetectionConfidence: 0.3,  // 降低:更容易检测手
      minTrackingConfidence: 0.3    // 降低:更容易追踪
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
            setStatusMessage("Show both hands!");
            setIsLocked(false);
            isReadyToPullRef.current = false;
          }
        }
      }
      canvasCtx.restore();
    });

    const camera = new (window as any).Camera(videoRef.current, {
      onFrame: async () => await hands.send({ image: videoRef.current }),
      width: 1280,
      height: 720
    });

    camera.start();
    setStatusMessage("Ready! Show both hands...");

    return () => {
      camera.stop();
      hands.close();
    };
  }, [connected, cookieState, breakCookie]);

  if (!connected) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #ea580c 100%)' }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@700;900&display=swap');
          body { font-family: 'Poppins', sans-serif; margin: 0; overflow: hidden; }
          script { display: none; }
          .wallet-button {
            background: #f59e0b;
            color: #000;
            font-weight: bold;
            font-size: 16px;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
          }
          .wallet-button:hover {
            background: #d97706;
            transform: scale(1.05);
          }
          .wallet-button:active {
            transform: scale(0.95);
          }
        `}</style>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: '120px', marginBottom: '20px' }}>🥠</div>
          <h1 style={{ fontSize: '56px', fontWeight: 900, margin: '0 0 20px 0', letterSpacing: '-2px' }}>Zen Fortune Cookie</h1>
          <p style={{ fontSize: '18px', marginBottom: '40px', opacity: 0.9 }}>Connect your wallet to start breaking cookies</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
            <WalletButton />
          </div>
          <p style={{ fontSize: '14px', opacity: 0.8, marginTop: '30px' }}>💡 Tip: Each fortune costs 0.001 SOL</p>
        </div>
      </div>
    );
  }

  return (
    <main style={{ width: '100vw', height: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #ea580c 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@700;900&display=swap');
        body { font-family: 'Poppins', sans-serif; margin: 0; overflow: hidden; }
        
        @keyframes shake {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(-3deg); }
          75% { transform: rotate(3deg); }
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

        @media (max-width: 768px) {
          body { font-size: 14px; }
        }
        
        @media (max-width: 480px) {
          body { font-size: 12px; }
        }
      `}</style>

      {/* Camera Feed */}
      <video ref={videoRef} style={{ position: 'absolute', left: '-9999px' }} />
      <canvas ref={canvasRef} width={1280} height={720} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10 }} />

      {/* Wallet Info */}
      <div style={{ position: 'absolute', top: '32px', right: '32px', zIndex: 50, display: 'flex', gap: '12px', alignItems: 'center' }}>
        {publicKey && (
          <div style={{ background: 'rgba(255,255,255,0.9)', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
            💰 {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </div>
        )}
        <button onClick={() => disconnect()} style={{ background: '#ef4444', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#dc2626'} onMouseLeave={(e) => e.currentTarget.style.background = '#ef4444'}>
          Disconnect
        </button>
      </div>

      {/* Stats Board */}
      <div style={{ position: 'absolute', top: '32px', left: '32px', background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '0 20px 25px rgba(0,0,0,0.1)' }}>
        <div style={{ color: 'white', fontWeight: 900, textAlign: 'center', fontSize: '14px' }}>
          <div>🎯 {stats.tapCount} Opened</div>
          <div style={{ fontSize: '20px', fontWeight: 900, marginTop: '8px' }}>{stats.totalPoints} PTS</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20, position: 'relative' }}>
        {/* Cookie Visualization */}
        <div style={{ position: 'relative', transition: 'all 0.3s' }} className={cookieState === 'cracking' ? 'animate-shake' : ''}>
          {cookieState !== 'broken' ? (
            <div style={{ fontSize: `${280 + pullProgress * 100}px`, transform: `scale(${1 + pullProgress * 0.4})`, filter: isLocked ? `drop-shadow(0 0 30px rgba(251, 146, 60, 0.4))` : `drop-shadow(0 20px 50px rgba(0,0,0,0.1))`, transition: 'all 0.1s', userSelect: 'none', lineHeight: '1' }}>
              🥠
            </div>
          ) : (
            <div style={{ position: 'relative', width: '400px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {[...Array(8)].map((_, i) => (
                <div key={i} className="particle" style={{ ['--tw-translate-x' as any]: `${(Math.random() - 0.5) * 300}px`, ['--tw-translate-y' as any]: `${(Math.random() - 0.5) * 300}px`, left: '50%', top: '50%' }} />
              ))}

              {/* Fortune Slip */}
              <div className="animate-paper" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                <div className="paper-texture" style={{ width: '420px', padding: '32px', borderTop: '4px solid #fed7aa', borderRadius: '4px', boxShadow: '0 20px 25px rgba(0,0,0,0.2)', transform: 'rotate(2deg)' }}>
                  <p style={{ color: '#9ca3af', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 12px 0', textAlign: 'left' }}>Your Fortune</p>
                  <p style={{ fontSize: '18px', fontWeight: 700, fontStyle: 'italic', color: '#1f2937', lineHeight: '1.5', marginBottom: '20px' }}>&quot;{currentFortune?.text}&quot;</p>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #fed7aa' }}>
                    <span style={{ color: '#b45309', fontWeight: 900, fontSize: '18px' }}>+{currentFortune?.points} PTS</span>
                    <span style={{ color: '#92400e', fontWeight: 700, fontSize: '14px' }}>⚡ {CRACK_COST_SOL} SOL</span>
                  </div>
                  
                  {/* TX Status - PROMINENT */}
                  <div style={{ marginBottom: '24px', minHeight: '120px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {isRecording && (
                      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 700, color: '#2563eb', animation: 'pulse 2s infinite' }}>
                        ⏳ Recording transaction...
                      </div>
                    )}
                    {txSignature && (
                      <div style={{ textAlign: 'center', background: '#dcfce7', border: '2px solid #22c55e', borderRadius: '8px', padding: '16px' }}>
                        <p style={{ color: '#15803d', fontWeight: 900, fontSize: '12px', margin: '0 0 8px 0', textTransform: 'uppercase' }}>✓ SUCCESS</p>
                        <p style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: '10px', wordBreak: 'break-all', margin: 0, background: '#dcfce7', padding: '8px', borderRadius: '4px' }}>
                          TX: {txSignature}
                        </p>
                      </div>
                    )}
                    {txError && (
                      <div style={{ textAlign: 'center', background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '8px', padding: '12px' }}>
                        <p style={{ color: '#7f1d1d', fontWeight: 900, fontSize: '11px', margin: '0 0 4px 0' }}>✗ FAILED</p>
                        <p style={{ color: '#991b1b', fontSize: '10px', margin: 0 }}>{txError}</p>
                      </div>
                    )}
                    {!isRecording && !txSignature && !txError && (
                      <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '12px' }}>
                        💾 Recording to blockchain...
                      </div>
                    )}
                  </div>
                  
                  <button onClick={resetCookie} disabled={isRecording} style={{ width: '100%', background: '#ea580c', color: 'white', padding: '14px', borderRadius: '8px', fontWeight: 900, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px', border: 'none', cursor: isRecording ? 'not-allowed' : 'pointer', opacity: isRecording ? 0.6 : 1, transition: 'all 0.2s' }} onMouseEnter={(e) => !isRecording && (e.currentTarget.style.background = '#c2410c')} onMouseLeave={(e) => (e.currentTarget.style.background = '#ea580c')}>
                    {isRecording ? '⏳ Recording...' : '🥠 Next Cookie'}
                  </button>
                </div>
              </div>

              {/* Broken Halves */}
              <div style={{ fontSize: '280px', clipPath: 'inset(0 50% 0 0)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-110%, -50%) rotate(-25deg)', opacity: 0.9, userSelect: 'none' }}>🥠</div>
              <div style={{ fontSize: '280px', clipPath: 'inset(0 0 0 50%)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-10%, -50%) rotate(25deg)', opacity: 0.9, userSelect: 'none' }}>🥠</div>
            </div>
          )}
        </div>

        {/* Status Message */}
        <div style={{ marginTop: '80px', padding: '24px 48px', borderRadius: '24px', border: `4px solid ${isLocked ? '#ea580c' : '#fed7aa'}`, transition: 'all 0.3s', boxShadow: '0 20px 25px rgba(0,0,0,0.1)', minWidth: '380px', textAlign: 'center', background: isLocked ? '#ea580c' : 'rgba(255,255,255,0.9)', color: isLocked ? 'white' : '#1f2937', fontWeight: 700, fontSize: '16px' }}>
          {statusMessage}
        </div>
      </div>
    </main>
  );
}
