"use client";

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFortuneCookie } from '@/hooks/useFortuneCookieRealBlockchain';
import { useWalletMode } from '@/components/WalletModeSelector';

const WalletButton = dynamic(() => import('@/components/WalletButton'), { ssr: false });

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

const STORAGE_KEY = 'zen_fortune_stats';
const CRACK_COST_SOL = 0.001;

export default function HomePage() {
  const { publicKey, connected, disconnect } = useWallet();
  const { mode, setMode, localWallet } = useWalletMode();
  const { recordFortune } = useFortuneCookie();
  const [isDemoMode, setIsDemoMode] = useState(mode === 'demo');
  const [isLocalMode, setIsLocalMode] = useState(mode === 'local');

  const [stats, setStats] = useState<Stats>({ totalPoints: 0, tapCount: 0 });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setStats(JSON.parse(saved));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    }
  }, [stats]);

  useEffect(() => {
    if (connected) {
      setIsDemoMode(false);
      setIsLocalMode(false);
    }
  }, [connected]);

  const [cookieState, setCookieState] = useState<CookieState>('intact');
  const [currentFortune, setCurrentFortune] = useState<Fortune | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const breakCookie = useCallback(() => {
    if (cookieState !== 'intact') return;

    const randomFortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const points = Math.floor(Math.random() * 91) + 10;
    const archetype = Math.floor(Math.random() * 4);

    setCookieState('cracking');
    setTxError(null);
    setTxSignature(null);

    setTimeout(() => {
      setCookieState('broken');
      setCurrentFortune({ text: randomFortune, points });
      setStats(prev => ({ totalPoints: prev.totalPoints + points, tapCount: prev.tapCount + 1 }));
    }, 400);

    setTimeout(() => {
      setCookieState('resetting');
      setTimeout(() => {
        setCookieState('intact');
        setCurrentFortune(null);
      }, 300);
    }, 5000);

    if (isDemoMode) {
      setIsRecording(true);
      setTimeout(() => {
        setTxSignature('demo_tx_' + Math.random().toString(36).slice(2, 10));
        setIsRecording(false);
      }, 1000);
    } else if (isLocalMode && localWallet) {
      setIsRecording(true);
      recordFortune(archetype)
        .then((signature) => setTxSignature(signature))
        .catch((error: any) => setTxError(error?.message || 'Transaction failed'))
        .finally(() => setIsRecording(false));
    } else if (connected && publicKey) {
      setIsRecording(true);
      recordFortune(archetype)
        .then((signature) => setTxSignature(signature))
        .catch((error: any) => setTxError(error?.message || 'Transaction failed'))
        .finally(() => setIsRecording(false));
    }
  }, [cookieState, connected, publicKey, recordFortune, isDemoMode, isLocalMode, localWallet]);

  const resetCookie = () => {
    setCookieState('resetting');
    setTimeout(() => {
      setCookieState('intact');
      setCurrentFortune(null);
      setTxSignature(null);
      setTxError(null);
    }, 300);
  };

  if (!connected && !isDemoMode && !isLocalMode) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #ea580c 100%)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: '120px', marginBottom: '20px' }}>🥠</div>
          <h1 style={{ fontSize: '56px', fontWeight: 900, margin: '0 0 20px 0', letterSpacing: '-2px' }}>Zen Fortune Cookie</h1>
          <p style={{ fontSize: '18px', marginBottom: '60px', opacity: 0.9 }}>Choose your mode</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setIsDemoMode(true); setIsLocalMode(false); setMode('demo'); }}
              style={{ background: '#3b82f6', color: 'white', fontWeight: 'bold', fontSize: '16px', padding: '16px 32px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              🎬 Demo Mode
            </button>
            <button
              onClick={() => { setIsLocalMode(true); setIsDemoMode(false); setMode('local'); localWallet?.connect(); }}
              style={{ background: '#10b981', color: 'white', fontWeight: 'bold', fontSize: '16px', padding: '16px 32px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              💻 Local Wallet
            </button>
            <div style={{ width: '100%' }} />
            <WalletButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={{ width: '100vw', height: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #ea580c 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>

      {/* Wallet Info */}
      <div style={{ position: 'absolute', top: '32px', right: '32px', zIndex: 50, display: 'flex', gap: '12px', alignItems: 'center', flexDirection: 'column' }}>
        {isDemoMode && (
          <div style={{ background: '#3b82f6', padding: '12px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: 'white', textAlign: 'center' }}>
            🎬 Demo Mode<br /><span style={{ fontSize: '10px', opacity: 0.9 }}>Click 🥠 to break</span>
          </div>
        )}
        {isLocalMode && localWallet && (
          <div style={{ background: '#10b981', padding: '12px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: 'white' }}>
            <div>💻 Local Wallet</div>
            <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.8, fontFamily: 'monospace' }}>
              {localWallet.publicKey.toString().slice(0, 8)}...{localWallet.publicKey.toString().slice(-6)}
            </div>
            <div style={{ fontSize: '10px', marginTop: '4px' }}>✅ Connected</div>
          </div>
        )}
        {publicKey && (
          <>
            <div style={{ background: 'rgba(255,255,255,0.9)', padding: '12px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
              <div>📍 {publicKey.toString().slice(0, 8)}...{publicKey.toString().slice(-6)}</div>
            </div>
            <button
              onClick={() => disconnect()}
              style={{ background: '#ef4444', color: 'white', padding: '6px 12px', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
            >
              断开
            </button>
          </>
        )}
        {(isDemoMode || isLocalMode) && (
          <button
            onClick={() => { setIsDemoMode(false); setIsLocalMode(false); localWallet?.disconnect(); }}
            style={{ background: '#ef4444', color: 'white', padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
          >
            ← 切换模式
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ position: 'absolute', top: '32px', left: '32px', background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.5)' }}>
        <div style={{ color: 'white', fontWeight: 900, textAlign: 'center', fontSize: '14px' }}>
          <div>🎯 {stats.tapCount} Opened</div>
          <div style={{ fontSize: '20px', fontWeight: 900, marginTop: '8px' }}>{stats.totalPoints} PTS</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20, position: 'relative' }}>
        <div
          style={{ position: 'relative', transition: 'all 0.3s', cursor: cookieState === 'intact' ? 'pointer' : 'default' }}
          className={cookieState === 'cracking' ? 'animate-shake' : ''}
          onClick={() => cookieState === 'intact' && breakCookie()}
        >
          {cookieState !== 'broken' ? (
            <div style={{ fontSize: '280px', filter: 'drop-shadow(0 20px 50px rgba(0,0,0,0.1))', userSelect: 'none', lineHeight: '1' }}>
              🥠
            </div>
          ) : (
            <div style={{ position: 'relative', width: '400px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {[...Array(8)].map((_, i) => (
                <div key={i} className="particle" style={{ ['--tw-translate-x' as any]: `${(Math.random() - 0.5) * 300}px`, ['--tw-translate-y' as any]: `${(Math.random() - 0.5) * 300}px`, left: '50%', top: '50%' }} />
              ))}
              <div className="animate-paper" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                <div className="paper-texture" style={{ width: '420px', padding: '32px', borderTop: '4px solid #fed7aa', borderRadius: '4px', boxShadow: '0 20px 25px rgba(0,0,0,0.2)', transform: 'rotate(2deg)' }}>
                  <p style={{ color: '#9ca3af', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 12px 0' }}>Your Fortune</p>
                  <p style={{ fontSize: '18px', fontWeight: 700, fontStyle: 'italic', color: '#1f2937', lineHeight: '1.5', marginBottom: '20px' }}>&quot;{currentFortune?.text}&quot;</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #fed7aa' }}>
                    <span style={{ color: '#b45309', fontWeight: 900, fontSize: '18px' }}>+{currentFortune?.points} PTS</span>
                    <span style={{ color: '#92400e', fontWeight: 700, fontSize: '14px' }}>⚡ {CRACK_COST_SOL} SOL</span>
                  </div>
                  <div style={{ marginBottom: '24px', minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {isRecording && (
                      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 700, color: '#2563eb' }}>
                        ⏳ 正在上链...
                      </div>
                    )}
                    {txSignature && (
                      <div style={{ textAlign: 'center', background: '#dcfce7', border: '2px solid #22c55e', borderRadius: '8px', padding: '16px' }}>
                        <p style={{ color: '#15803d', fontWeight: 900, fontSize: '12px', margin: '0 0 8px 0' }}>✓ 上链成功!</p>
                        <p style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: '10px', wordBreak: 'break-all', margin: 0 }}>
                          TX: {txSignature}
                        </p>
                      </div>
                    )}
                    {txError && (
                      <div style={{ textAlign: 'center', background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '8px', padding: '12px' }}>
                        <p style={{ color: '#7f1d1d', fontWeight: 900, fontSize: '11px', margin: '0 0 4px 0' }}>✗ 交易失败</p>
                        <p style={{ color: '#991b1b', fontSize: '10px', margin: 0 }}>{txError}</p>
                      </div>
                    )}
                    {!isRecording && !txSignature && !txError && (
                      <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '12px' }}>💾 待交易...</div>
                    )}
                  </div>
                  <button onClick={resetCookie} style={{ width: '100%', background: '#f59e0b', color: 'white', padding: '14px', borderRadius: '8px', fontWeight: 900, fontSize: '14px', border: 'none', cursor: 'pointer' }}>
                    再来一次 🥠
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '280px', clipPath: 'inset(0 50% 0 0)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-110%, -50%) rotate(-25deg)', opacity: 0.9, userSelect: 'none' }}>🥠</div>
              <div style={{ fontSize: '280px', clipPath: 'inset(0 0 0 50%)', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-10%, -50%) rotate(25deg)', opacity: 0.9, userSelect: 'none' }}>🥠</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '80px', padding: '24px 48px', borderRadius: '24px', border: '4px solid #fed7aa', boxShadow: '0 20px 25px rgba(0,0,0,0.1)', minWidth: '380px', textAlign: 'center', background: 'rgba(255,255,255,0.9)', color: '#1f2937', fontWeight: 700, fontSize: '16px' }}>
          👆 点击 🥠 开始
        </div>
      </div>
    </main>
  );
}
