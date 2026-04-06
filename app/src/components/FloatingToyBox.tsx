'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import GestureDetector from './GestureDetector';

export default function FloatingToyBox() {
  const { publicKey } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [inviteCode, setInviteCode] = useState<string>('');
  const [inviteBonus, setInviteBonus] = useState<number>(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 默认右下角
  useEffect(() => {
    setPosition({
      x: window.innerWidth - 110,
      y: window.innerHeight - 130,
    });
  }, []);

  // 拖动逻辑
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!boxRef.current) return;
    setIsDragging(true);
    const rect = boxRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: Math.max(20, Math.min(window.innerWidth - 120, e.clientX - dragOffset.x)),
        y: Math.max(20, Math.min(window.innerHeight - 140, e.clientY - dragOffset.y)),
      });
    };
    const up = () => setIsDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [isDragging, dragOffset]);

  const validateInviteCode = async (code: string) => {
    try {
      // Demo: simulate invite code validation
      // In production, this would call your backend API
      if (code.startsWith('COOKIE-')) {
        setInviteBonus(50);
        alert(`✓ 邀请码有效! +${50} 赠送积分`);
      } else {
        alert('❌ 邀请码无效');
        setInviteBonus(0);
      }
    } catch (error) {
      console.error('Invite code validation failed:', error);
      alert('验证失败');
    }
  };

  return (
    <>
      {/* 全站漂浮的幸运饼干 */}
      <div
        ref={boxRef}
        onMouseDown={handleMouseDown}
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9999,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        className="select-none transition-all duration-300 hover:scale-110 active:scale-95 drop-shadow-xl"
      >
        <div className="text-[58px] drop-shadow-2xl animate-bob">🥠</div>
        
        <div className="text-center text-[9px] font-bold text-amber-800 tracking-widest mt-1 opacity-60">
          点击打开玩具箱
        </div>
      </div>

      {/* 打开后的玩具箱弹窗 */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000]" onClick={() => setIsOpen(false)}>
          <div 
            onClick={e => e.stopPropagation()}
            className="bg-[#1a1a1a] text-white w-[500px] rounded-3xl p-8 shadow-2xl relative overflow-hidden border border-amber-900 max-h-[80vh] overflow-y-auto"
          >
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">🥠</div>
              <h2 className="text-3xl font-bold">我的玩具箱</h2>
              <p className="text-amber-400 text-sm">随时点开玩 · 邀请朋友赚奖励</p>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div 
                onClick={() => {alert('手势幸运饼干已启动！')}}
                className="bg-zinc-900 rounded-2xl p-6 hover:bg-zinc-800 transition-all cursor-pointer border border-amber-700 flex flex-col items-center"
              >
                <div className="text-6xl mb-4 animate-bob">🥠</div>
                <div className="font-bold text-amber-400">手势幸运饼干</div>
                <div className="text-xs text-zinc-400 mt-2 text-center">对着镜头比手势开签</div>
              </div>

              <div className="bg-zinc-900 rounded-2xl p-6 hover:bg-zinc-800 transition-all cursor-pointer border border-purple-700 flex flex-col items-center opacity-80">
                <div className="text-6xl mb-4">🎧</div>
                <div className="font-bold text-purple-400">打碟机</div>
                <div className="text-xs text-zinc-400 mt-2 text-center">真实混音 · 马上上线</div>
              </div>
            </div>

            {/* 邀请码系统 - Invite Code Section */}
            <div className="bg-orange-900/30 rounded-xl p-4 border border-orange-700/50 mb-4">
              <h3 className="text-amber-400 font-bold mb-3 flex items-center gap-2">
                🎁 邀请朋友赚奖励
              </h3>
              
              <div className="space-y-2">
                <input 
                  type="text" 
                  placeholder="输入邀请码(可选)"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  className="w-full bg-zinc-800 text-white rounded px-3 py-2 text-sm border border-orange-700/30 placeholder-zinc-500"
                />
                <button 
                  onClick={() => validateInviteCode(inviteCode)}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white rounded px-3 py-2 text-xs font-bold transition-all"
                >
                  验证邀请码
                </button>
                
                {inviteBonus > 0 && (
                  <div className="bg-green-900/30 border border-green-700 rounded px-3 py-2 text-xs text-green-300 font-bold">
                    ✓ 获得 {inviteBonus} 赠送积分!
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-orange-700/30">
                <p className="text-zinc-400 text-xs mb-2">你的推荐码:</p>
                <div className="bg-zinc-800/60 rounded px-3 py-2 border border-orange-700/30 flex justify-between items-center">
                  <code className="text-amber-400 font-mono text-xs font-bold">
                    COOKIE-USER-{publicKey?.toString().slice(0, 6).toUpperCase() || 'NOKEY'}
                  </code>
                  <button 
                    onClick={() => {
                      const code = `COOKIE-USER-${publicKey?.toString().slice(0, 6).toUpperCase()}`;
                      navigator.clipboard.writeText(code);
                      alert('✓ 已复制到剪贴板!');
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300"
                  >
                    📋 复制
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-6 right-6 text-3xl text-amber-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 动画样式 */}
      <style jsx global>{`
        @keyframes bob {
          0%, 100% { transform: translateY(0) rotate(-4deg); }
          50% { transform: translateY(-8px) rotate(4deg); }
        }
        .animate-bob { animation: bob 2.8s ease-in-out infinite; }
      `}</style>
    </>
  );
}

