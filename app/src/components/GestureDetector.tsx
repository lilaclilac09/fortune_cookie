"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface GestureDetectorProps {
  onCrackGestureDetected: () => void;
  enabled: boolean;
}

export default function GestureDetector({
  onCrackGestureDetected,
  enabled
}: GestureDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const previousDistanceRef = useRef<number | null>(null);
  const gestureTriggeredRef = useRef(false);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  const onResults = useCallback(
    (results: any) => {
      if (!canvasRef.current || !videoRef.current) return;

      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.drawImage(
        results.image,
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );

      if (results.multiHandLandmarks && results.multiHandLandmarks.length === 2) {
        const leftHand = results.multiHandLandmarks[0];
        const rightHand = results.multiHandLandmarks[1];

        const leftWrist = leftHand[0];
        const rightWrist = rightHand[0];

        const distance = Math.hypot(
          leftWrist.x - rightWrist.x,
          leftWrist.y - rightWrist.y
        );

        if (previousDistanceRef.current !== null) {
          if (
            !gestureTriggeredRef.current &&
            previousDistanceRef.current < 0.2 &&
            distance > 0.4
          ) {
            gestureTriggeredRef.current = true;
            onCrackGestureDetected();
            setTimeout(() => {
              gestureTriggeredRef.current = false;
            }, 2000);
          }
        }

        previousDistanceRef.current = distance;

        ctx.fillStyle = "rgba(255, 127, 63, 0.5)";
        ctx.beginPath();
        ctx.arc(
          leftWrist.x * canvasRef.current.width,
          leftWrist.y * canvasRef.current.height,
          10,
          0,
          2 * Math.PI
        );
        ctx.fill();
        ctx.beginPath();
        ctx.arc(
          rightWrist.x * canvasRef.current.width,
          rightWrist.y * canvasRef.current.height,
          10,
          0,
          2 * Math.PI
        );
        ctx.fill();
      }

      ctx.restore();
    },
    [onCrackGestureDetected]
  );

  useEffect(() => {
    if (!enabled || isInitialized) return;

    let mounted = true;

    const initMediaPipe = async () => {
      try {
        const { Hands } = await import("@mediapipe/hands");
        const { Camera } = await import("@mediapipe/camera_utils");

        if (!mounted) return;

        const hands = new Hands({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
          selfieMode: true
        });

        hands.onResults(onResults);
        handsRef.current = hands;

        if (videoRef.current && navigator.mediaDevices) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480 }
            });
            videoRef.current.srcObject = stream;

            const camera = new Camera(videoRef.current, {
              onFrame: async () => {
                if (videoRef.current && handsRef.current) {
                  await handsRef.current.send({ image: videoRef.current });
                }
              },
              width: 640,
              height: 480
            });
            cameraRef.current = camera;
            camera.start();
            setIsInitialized(true);
          } catch (err) {
            console.error("Camera access denied:", err);
            setPermissionDenied(true);
          }
        }
      } catch (err) {
        console.error("MediaPipe initialization failed:", err);
      }
    };

    initMediaPipe();

    return () => {
      mounted = false;
      if (handsRef.current) {
        handsRef.current.close();
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [enabled, isInitialized, onResults]);

  if (!enabled) return null;

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
            display: "block"
          }}
        />
        {permissionDenied && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(255, 255, 255, 0.95)",
              padding: 20,
              borderRadius: 12,
              textAlign: "center",
              maxWidth: "80%"
            }}
          >
            <p style={{ margin: 0, fontSize: 14 }}>
              Camera access denied. Use the button instead.
            </p>
          </div>
        )}
        {!isInitialized && !permissionDenied && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              color: "#fff",
              fontSize: 14,
              background: "rgba(0, 0, 0, 0.7)",
              padding: "8px 16px",
              borderRadius: 8
            }}
          >
            Loading hand tracking...
          </div>
        )}
      </div>
    </div>
  );
}
