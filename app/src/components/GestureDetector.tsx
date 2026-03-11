
'use client';

import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

interface Fortune {
  text: string;
  number: string;
}

export default function GestureDetector() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fortune, setFortune] = useState<Fortune | null>(null);
  const [isCracked, setIsCracked] = useState(false);
  const [status, setStatus] = useState('点击「开始」开启摄像头');

  // ==================== 可调参数（重点！） ====================
  const [closeThreshold, setCloseThreshold] = useState(0.25);   // 双手靠近阈值（越小越要靠近）
  const [pullThreshold, setPullThreshold] = useState(0.42);     // 拉开阈值（越大越要拉得开）
  const [debounceTime, setDebounceTime] = useState(300);        // 防抖时间（ms）

  const [currentDistance, setCurrentDistance] = useState(0);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastCrackTimeRef = useRef(0);
  const stateRef = useRef<'IDLE' | 'CLOSE' | 'PULL'>('IDLE'); // 状态机防误触

  // 加载 fortunes.json
  const [fortunes, setFortunes] = useState<Fortune[]>([]);
  useEffect(() => {
    fetch('/fortunes.json').then(r => r.json()).then(setFortunes);
  }, []);

  const initGesture = async () => {
    setStatus('初始化 MediaPipe...');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
      runningMode: 'VIDEO',
      numHands: 2
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', startPrediction);
    }
    setStatus('✅ 摄像头已开启！双手靠近 → 快速拉开');
  };

  const startPrediction = () => {
    if (!handLandmarkerRef.current || !videoRef.current || !canvasRef.current) return;

    const canvasCtx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!canvasCtx) return;

    let lastTriggerTime = 0;

    const predict = () => {
      if (!videoRef.current || !handLandmarkerRef.current) return;

      const results = handLandmarkerRef.current.detectForVideo(videoRef.current, Date.now());

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      canvasCtx.drawImage(videoRef.current, 0, 0, canvasRef.current!.width, canvasRef.current!.height);

      let distance = 0;
      let isCloseNow = false;

      if (results.landmarks && results.landmarks.length >= 2) {
        const drawingUtils = new DrawingUtils(canvasCtx);
        results.landmarks.forEach(landmarks => {
          drawingUtils.drawConnectors(landmarks, [], { color: '#FF9800', lineWidth: 3 });
          const wrist = landmarks[0];
          canvasCtx.fillStyle = '#FF9800';
          canvasCtx.beginPath();
          canvasCtx.arc(wrist.x * canvasRef.current!.width, wrist.y * canvasRef.current!.height, 10, 0, 2 * Math.PI);
          canvasCtx.fill();
        });

        const leftW = results.landmarks[0][0];
        const rightW = results.landmarks[1][0];
        distance = Math.sqrt(Math.pow(leftW.x - rightW.x, 2) + Math.pow(leftW.y - rightW.y, 2));

        isCloseNow = distance < closeThreshold;
        setCurrentDistance(Number(distance.toFixed(3)));
      }

      // ==================== 状态机 + 阈值判断 ====================
      const now = Date.now();
      if (now - lastTriggerTime < debounceTime) {
        // 防抖
      } else if (stateRef.current === 'IDLE' && isCloseNow) {
        stateRef.current = 'CLOSE';
        addDebugLog(`👋 进入 CLOSE 状态 (距离 ${distance.toFixed(3)})`);
      } else if (stateRef.current === 'CLOSE' && !isCloseNow && distance > pullThreshold) {
        stateRef.current = 'PULL';
        if (now - lastCrackTimeRef.current > 1500) { // 冷却1.5秒
          crackCookie();
          lastTriggerTime = now;
          lastCrackTimeRef.current = now;
        }
      } else if (!isCloseNow && distance > pullThreshold * 0.6) {
        stateRef.current = 'IDLE';
      }

      setDebugLog(prev => prev.slice(-4)); // 只保留最后4条

      animationRef.current = requestAnimationFrame(predict);
    };

    predict();
  };

  const crackCookie = () => {
    if (fortunes.length === 0) return;
    const randomFortune = fortunes[Math.floor(Math.random() * fortunes.length)];
    setFortune(randomFortune);
    setIsCracked(true);
    setStatus('🎉 饼干裂开啦！');
    addDebugLog('🔥 触发裂开！');

    setTimeout(() => {
      setIsCracked(false);
      setFortune(null);
      stateRef.current = 'IDLE';
      setStatus('继续玩！双手靠近 → 快速拉开');
    }, 2800);
  };

  const addDebugLog = (msg: string) => {
    setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // 清理
  useEffect(() => {
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: '20px', background: '#fffaf0', borderRadius: '15px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>🍪 手势开幸运饼干 · 实时调优面板</h2>
      <button onClick={initGesture} style={{ padding: '12px 24px', fontSize: '1.3em', marginBottom: '15px' }}>
        开始手势模式
      </button>

      <p style={{ fontSize: '1.2em' }}>{status}</p>

      {/* 调试面板 */}
      <div style={{ background: '#333', color: '#0f0', padding: '15px', borderRadius: '8px', margin: '15px auto', maxWidth: '520px', fontFamily: 'monospace', textAlign: 'left', fontSize: '0.95em' }}>
        当前距离: <strong>{currentDistance}</strong><br />
        状态: <strong>{stateRef.current}</strong><br />
        <div style={{ marginTop: '8px', fontSize: '0.9em', opacity: 0.9 }}>
          {debugLog.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>

      {/* 阈值滑块 */}
      <div style={{ margin: '20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <label>靠近阈值 (closeThreshold): {closeThreshold}</label>
          <input type="range" min="0.08" max="0.35" step="0.01" value={closeThreshold}
            onChange={e => setCloseThreshold(parseFloat(e.target.value))} style={{ width: '100%' }} />
          <small>建议 0.18~0.28（越小越要双手贴近）</small>
        </div>
        <div>
          <label>拉开阈值 (pullThreshold): {pullThreshold}</label>
          <input type="range" min="0.30" max="0.65" step="0.01" value={pullThreshold}
            onChange={e => setPullThreshold(parseFloat(e.target.value))} style={{ width: '100%' }} />
          <small>建议 0.38~0.48（越大越要拉得开）</small>
        </div>
      </div>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <video ref={videoRef} autoPlay playsInline width="520" height="390" style={{ borderRadius: '12px', display: isCracked ? 'none' : 'block' }} />
        <canvas ref={canvasRef} width="520" height="390" style={{ position: 'absolute', top: 0, left: 0, borderRadius: '12px', display: isCracked ? 'none' : 'block' }} />
      </div>

      {isCracked && fortune && (
        <div style={{ marginTop: '30px', fontSize: '2.4em', color: '#d32f2f', animation: 'pop 0.6s' }}>
          🎉 幸运号码 <strong>{fortune.number}</strong><br />
          {fortune.text}
        </div>
      )}

      {isCracked && <button onClick={() => { setIsCracked(false); setFortune(null); stateRef.current = 'IDLE'; }} style={{ marginTop: '15px', padding: '10px 20px' }}>再抽一次</button>}
    </div>
  );
}

  return (
    <div style={{ width: "100%" }}>
      <div className="gesture-hint">
        <strong>How to crack:</strong> Hold both hands close together in front of
        the camera, then pull them apart quickly to crack the cookie! 🍪
      </div>
      <div style={{ position: "relative", width: "100%", maxWidth: 640, margin: "12px auto" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ display: "none" }}
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={{
            borderRadius: 18,
            border: "2px solid rgba(255, 127, 63, 0.3)",
            width: "100%",
            height: "auto",
            display: "block",
            background: isInitialized ? "transparent" : "rgba(0, 0, 0, 0.05)"
          }}
        />
        
        {/* Permission Request Screen */}
        {waitingForPermission && !permissionDenied && !initializationError && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(255, 255, 255, 0.98)",
              padding: "24px",
              borderRadius: 12,
              textAlign: "center",
              maxWidth: "85%",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
            }}
          >
            <p style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>
              📷 Camera Permission Required
            </p>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#666" }}>
              {loadingStep === "mediapipe"
                ? "Loading hand tracking model..."
                : "Waiting for camera access..."}
            </p>
            <small style={{ display: "block", color: "#999", marginBottom: 16, fontSize: 12 }}>
              {loadingStep === "camera"
                ? "Please approve camera access in the popup or browser settings."
                : ""}
            </small>
            <button
              onClick={handleDisableGesture}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#f0f0f0",
                color: "#333",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#e0e0e0")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#f0f0f0")}
            >
              Use Button Instead
            </button>
          </div>
        )}

        {/* Permission Denied */}
        {permissionDenied && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(255, 255, 255, 0.98)",
              padding: "24px",
              borderRadius: 12,
              textAlign: "center",
              maxWidth: "85%",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
            }}
          >
            <p style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>
              ❌ Camera Access Denied
            </p>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#666" }}>
              Hand gesture mode requires camera access. You can still crack cookies
              using the button below.
            </p>
            <button
              onClick={handleDisableGesture}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#ff7f3f",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#ce4b1a")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#ff7f3f")}
            >
              Switch to Button Mode
            </button>
          </div>
        )}

        {/* Initialization Error */}
        {initializationError && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(255, 255, 255, 0.98)",
              padding: "24px",
              borderRadius: 12,
              textAlign: "center",
              maxWidth: "85%",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
            }}
          >
            <p style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>
              ⚠️ Hand Tracking Unavailable
            </p>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#666" }}>
              {initializationError}
            </p>
            <button
              onClick={handleDisableGesture}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#ff7f3f",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#ce4b1a")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#ff7f3f")}
            >
              Use Button Mode Instead
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
