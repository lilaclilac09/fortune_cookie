"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface GestureDetectorProps {
  onCrackGestureDetected: () => void;
  enabled: boolean;
  onDisable?: () => void;
}

export default function GestureDetector({
  onCrackGestureDetected,
  enabled,
  onDisable
}: GestureDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [waitingForPermission, setWaitingForPermission] = useState(true);
  const [loadingStep, setLoadingStep] = useState<"mediapipe" | "camera">("mediapipe");
  const previousDistanceRef = useRef<number | null>(null);
  const gestureTriggeredRef = useRef(false);
  const handDetectorRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !handDetectorRef.current) {
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(
      videoRef.current,
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );

    try {
      const results = await handDetectorRef.current.detectForVideo(
        videoRef.current,
        performance.now()
      );

      if (results.landmarks && results.landmarks.length === 2) {
        const leftHand = results.landmarks[0];
        const rightHand = results.landmarks[1];

        if (leftHand[0] && rightHand[0]) {
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
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(processFrame);
    } catch (err) {
      console.error("Hand detection error:", err);
    }
  }, [onCrackGestureDetected]);

  useEffect(() => {
    if (!enabled || isInitialized) return;

    let mounted = true;
    let cameraTimeout: NodeJS.Timeout | null = null;

    const initMediaPipe = async () => {
      // Set 10 second timeout for entire initialization
      initTimeoutRef.current = setTimeout(() => {
        if (mounted && !isInitialized) {
          setInitializationError(
            "Hand tracking took too long to load. Please enable camera access or try refreshing."
          );
          setWaitingForPermission(false);
        }
      }, 10000);

      try {
        setLoadingStep("mediapipe");
        const { HandLandmarker, FilesetResolver } = await import(
          "@mediapipe/tasks-vision"
        );

        if (!mounted) return;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker.task"
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        handDetectorRef.current = handLandmarker;

        if (videoRef.current && navigator.mediaDevices) {
          try {
            setLoadingStep("camera");
            setWaitingForPermission(true);

            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480 }
            });

            if (!mounted) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }

            videoRef.current.srcObject = stream;

            // Set timeout for video metadata
            cameraTimeout = setTimeout(() => {
              if (mounted && !isInitialized) {
                setInitializationError("Camera stream failed to load.");
                setPermissionDenied(true);
                stream.getTracks().forEach((track) => track.stop());
              }
            }, 5000);

            videoRef.current.onloadedmetadata = () => {
              if (mounted && cameraTimeout) {
                clearTimeout(cameraTimeout);
              }
              if (mounted) {
                setWaitingForPermission(false);
                setIsInitialized(true);
                if (initTimeoutRef.current) {
                  clearTimeout(initTimeoutRef.current);
                }
                animationFrameRef.current = requestAnimationFrame(processFrame);
              }
            };
          } catch (err: any) {
            console.error("Camera access error:", err);
            if (mounted) {
              setWaitingForPermission(false);
              if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
                setPermissionDenied(true);
              } else {
                setInitializationError(
                  "Camera access failed. Please check permissions or try again."
                );
              }
            }
          }
        }
      } catch (err) {
        console.error("MediaPipe initialization failed:", err);
        if (mounted) {
          setWaitingForPermission(false);
          setInitializationError(
            "Failed to load hand tracking. Please refresh the page."
          );
        }
      }
    };

    initMediaPipe();

    return () => {
      mounted = false;
      if (cameraTimeout) clearTimeout(cameraTimeout);
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (handDetectorRef.current) {
        handDetectorRef.current.close();
      }
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [enabled, isInitialized, processFrame]);

  if (!enabled) return null;

  const handleDisableGesture = () => {
    if (onDisable) onDisable();
  };

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
