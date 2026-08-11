/**
 * faceTracker.ts
 *
 * MediaPipe Face Detection を使用して動画中の顔位置を検出し、
 * FFmpeg の crop フィルタ用座標データを生成するモジュール。
 *
 * 2パス構成:
 *   パス1: ブラウザ上で動画をフレームごとに解析 → 顔座標配列を取得
 *   パス2: 座標データを Rust (FFmpeg) に渡し、動的 crop を適用
 */

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

export type LayoutMode = "center" | "commentary";

export interface FaceFrame {
    timestamp: number; // seconds
    x: number; // center x (pixels)
    y: number; // center y (pixels)
    width: number; // face width (pixels)
    height: number; // face height (pixels)
}

export interface CropFrame {
    timestamp: number;
    cropX: number;
    cropY: number;
    cropW: number;
    cropH: number;
}

// Smoothing window for moving average
const SMOOTHING_WINDOW = 7;

/**
 * Initialize MediaPipe Face Detector
 */
async function createFaceDetector(): Promise<FaceDetector> {
    const vision = await FilesetResolver.forVisionTasks(
        "/mediapipe-wasm"
    );
    const faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                "/mediapipe-wasm/blaze_face_short_range.tflite",
            delegate: "GPU",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
    });
    return faceDetector;
}

/**
 * Analyze face positions in a video element.
 */
export async function analyzeFacePositions(
    videoElement: HTMLVideoElement,
    intervalMs: number = 200,
    onProgress?: (progress: number) => void
): Promise<FaceFrame[]> {
    const faceDetector = await createFaceDetector();
    const frames: FaceFrame[] = [];

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");

    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    const duration = videoElement.duration;

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    const intervalSecs = intervalMs / 1000;
    let currentTime = 0;

    while (currentTime < duration) {
        videoElement.currentTime = currentTime;
        await new Promise<void>((resolve) => {
            videoElement.onseeked = () => resolve();
        });

        ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

        const timestampMs = currentTime * 1000;
        const result = faceDetector.detectForVideo(canvas, timestampMs);

        if (result.detections.length > 0) {
            const detection = result.detections[0];
            const bbox = detection.boundingBox;
            if (bbox) {
                frames.push({
                    timestamp: currentTime,
                    x: bbox.originX + bbox.width / 2,
                    y: bbox.originY + bbox.height / 2,
                    width: bbox.width,
                    height: bbox.height,
                });
            }
        }

        currentTime += intervalSecs;

        if (onProgress) {
            onProgress(Math.min(currentTime / duration, 1.0));
        }
    }

    faceDetector.close();
    return frames;
}

/**
 * Apply moving average smoothing to face positions (X and Y)
 */
function smoothPositions(
    frames: FaceFrame[],
    windowSize: number = SMOOTHING_WINDOW
): FaceFrame[] {
    if (frames.length === 0) return [];

    const smoothed: FaceFrame[] = [];
    for (let i = 0; i < frames.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(frames.length, i + Math.ceil(windowSize / 2));
        const win = frames.slice(start, end);

        const avgX = win.reduce((sum, f) => sum + f.x, 0) / win.length;
        const avgY = win.reduce((sum, f) => sum + f.y, 0) / win.length;
        const avgW = win.reduce((sum, f) => sum + f.width, 0) / win.length;
        const avgH = win.reduce((sum, f) => sum + f.height, 0) / win.length;

        smoothed.push({
            ...frames[i],
            x: avgX,
            y: avgY,
            width: avgW,
            height: avgH,
        });
    }

    return smoothed;
}

/**
 * Force value to be even (required by h264)
 */
function forceEven(n: number): number {
    return Math.round(n / 2) * 2;
}

/**
 * Center mode: simple 9:16 crop following face X position
 */
function computeCenterCrop(
    frames: FaceFrame[],
    videoWidth: number,
    videoHeight: number
): CropFrame[] {
    const smoothed = smoothPositions(frames);
    const cropH = forceEven(videoHeight);
    const cropW = forceEven(Math.round(videoHeight * (9 / 16)));

    return smoothed.map((frame) => {
        let cropX = Math.round(frame.x - cropW / 2);
        cropX = Math.max(0, Math.min(cropX, videoWidth - cropW));
        cropX = forceEven(cropX);

        return {
            timestamp: frame.timestamp,
            cropX,
            cropY: 0,
            cropW,
            cropH,
        };
    });
}

/**
 * Commentary mode: bust-up crop of avatar area.
 * Extracts a region centered on the face, extended downward for bust-up.
 *
 * The crop captures: face center - 0.5*faceH above → face center + 2.5*faceH below
 * This gives roughly head + shoulders framing.
 */
function computeCommentaryCrop(
    frames: FaceFrame[],
    videoWidth: number,
    videoHeight: number
): CropFrame[] {
    const smoothed = smoothPositions(frames);

    return smoothed.map((frame) => {
        // Bust-up: extend above face by 1x face height, below by 2.5x
        const bustH = forceEven(Math.round(frame.height * 3.5));
        const bustW = forceEven(Math.round(bustH * (9 / 16))); // maintain 9:16 for avatar strip
        const bustW2 = Math.min(bustW, forceEven(videoWidth)); // clamp

        let bustX = Math.round(frame.x - bustW2 / 2);
        bustX = Math.max(0, Math.min(bustX, videoWidth - bustW2));
        bustX = forceEven(bustX);

        let bustY = Math.round(frame.y - frame.height * 0.8);
        bustY = Math.max(0, Math.min(bustY, videoHeight - bustH));
        bustY = forceEven(bustY);

        const finalH = Math.min(bustH, videoHeight - bustY);

        return {
            timestamp: frame.timestamp,
            cropX: bustX,
            cropY: bustY,
            cropW: bustW2,
            cropH: forceEven(finalH),
        };
    });
}

/**
 * Convert face positions to crop coordinates based on layout mode.
 */
export function computeCropFrames(
    frames: FaceFrame[],
    videoWidth: number,
    videoHeight: number,
    layout: LayoutMode = "center"
): CropFrame[] {
    if (layout === "commentary") {
        return computeCommentaryCrop(frames, videoWidth, videoHeight);
    }
    return computeCenterCrop(frames, videoWidth, videoHeight);
}

/**
 * Serialize crop frames to the format expected by the Rust backend.
 * Format: "timestamp,x,y,w,h;timestamp,x,y,w,h;..."
 */
export function serializeCropData(cropFrames: CropFrame[]): string {
    return cropFrames
        .map(
            (f) =>
                `${f.timestamp},${f.cropX},${f.cropY},${f.cropW},${f.cropH}`
        )
        .join(";");
}

/**
 * Full pipeline: analyze video → compute crop → serialize
 */
export async function analyzeAndComputeCrop(
    videoElement: HTMLVideoElement,
    layout: LayoutMode = "center",
    onProgress?: (progress: number) => void
): Promise<string> {
    const faces = await analyzeFacePositions(videoElement, 200, onProgress);

    if (faces.length === 0) {
        return "";
    }

    const cropFrames = computeCropFrames(
        faces,
        videoElement.videoWidth,
        videoElement.videoHeight,
        layout
    );

    return serializeCropData(cropFrames);
}
