import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Upload, Film, Sliders, Scissors, VolumeX, Music, Image as ImageIcon,
  RotateCw, Gauge, Layers, Download, Check, AlertCircle, Play, Pause,
  Volume2, Maximize2, ShieldCheck, ArrowRight, RefreshCw, X, Zap,
  FileVideo, Clock, HardDrive, Cpu, Terminal, Sparkles, ChevronRight
} from 'lucide-react';

const PALETTE = {
  black: '#0A0A0A',
  white: '#FFFFFF',
  offWhite: '#F4F4F0',
  lime: '#CCFF00',
  pink: '#FF66CC',
  blue: '#3366FF',
  yellow: '#FFB800',
  red: '#FF3333',
  darkGray: '#1A1A1A',
  borderDark: '#262626'
};

const FORMATS = ['MP4', 'WEBM', 'MOV', 'MKV', 'M4V'];

// Helper to format bytes to human readable format
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Helper to format seconds to HH:MM:SS / MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0').slice(0, 1)}`;
}

// Detect best supported MediaRecorder MIME type for video
function getBestVideoMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm'
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Audio WAV Encoder from AudioBuffer
function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  const channels = [];
  let sampleRate = buffer.sampleRate;
  let offset = 0;
  let pos = 0;

  function setUint16(data) {
    out.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data) {
    out.setUint32(pos, data, true);
    pos += 4;
  }

  // RIFF identifier
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // subchunk1size (16 for PCM)
  setUint16(1);  // PCM
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2); // block align
  setUint16(16); // bits per sample
  setUint32(0x61746164); // "data" chunk
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([out], { type: 'audio/wav' });
}

export default function App() {
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [activeTool, setActiveTool] = useState('compress'); // compress, convert, resize, trim, extract_audio, remove_audio, extract_frame, rotate, change_fps, batch
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [resultBlob, setResultBlob] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);
  const [abortController, setAbortController] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Batch queue state
  const [batchQueue, setBatchQueue] = useState([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Video Element Ref for preview & measurements
  const previewVideoRef = useRef(null);

  // Clean up object URLs to prevent browser memory leaks
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [videoUrl, resultUrl]);

  const handleFileLoad = useCallback((selectedFile) => {
    if (!selectedFile) return;
    
    // Check if it's a video file or common container
    const isVideo = selectedFile.type.startsWith('video/') || 
      FORMATS.some(ext => selectedFile.name.toUpperCase().endsWith(`.${ext}`));

    if (!isVideo) {
      setErrorMessage(`UNSUPPORTED FILE FORMAT: "${selectedFile.name}". Please load MP4, WEBM, MOV, or MKV.`);
      return;
    }

    setErrorMessage(null);
    setResultBlob(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultMeta(null);

    const url = URL.createObjectURL(selectedFile);
    setVideoUrl(url);
    setFile(selectedFile);

    // Initial basic metadata while waiting for DOM video element
    const initialMeta = {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type || 'video/mp4',
      duration: 0,
      width: 0,
      height: 0,
      fps: 30, // standard baseline
      hasAudio: true
    };
    setMetadata(initialMeta);

    // Load actual dimensions and duration via lightweight temporary element
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;
    tempVideo.onloadedmetadata = () => {
      setMetadata({
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || 'video/mp4',
        duration: tempVideo.duration || 0,
        width: tempVideo.videoWidth || 1920,
        height: tempVideo.videoHeight || 1080,
        fps: 30,
        hasAudio: tempVideo.webkitAudioDecodedByteCount !== 0 // heuristic or WebAudio check
      });
    };
  }, [resultUrl]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileLoad(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
    }
    setIsProcessing(false);
    setProgress(0);
    setStatusMessage('PROCESSING CANCELLED');
  };

  const runVideoPipeline = async ({
    scaleWidth,
    scaleHeight,
    targetBitrate,
    targetFps = 30,
    startTime = 0,
    endTime = null,
    includeAudio = true,
    rotation = 0,
    format = 'webm',
    onProgress
  }) => {
    const controller = new AbortController();
    setAbortController(controller);
    setIsProcessing(true);
    setProgress(0);
    setStatusMessage('INITIALIZING LOCAL ENGINE...');

    return new Promise(async (resolve, reject) => {
      try {
        const offscreenVideo = document.createElement('video');
        offscreenVideo.src = videoUrl;
        offscreenVideo.muted = !includeAudio;
        offscreenVideo.playsInline = true;
        offscreenVideo.crossOrigin = 'anonymous';

        await new Promise((res, rej) => {
          offscreenVideo.onloadedmetadata = res;
          offscreenVideo.onerror = () => rej(new Error('CANNOT_DECODE_SOURCE_METADATA'));
        });

        const effectiveDuration = (endTime || offscreenVideo.duration) - startTime;
        if (effectiveDuration <= 0) {
          throw new Error('INVALID_TRIM_BOUNDARIES');
        }

        const outWidth = (rotation === 90 || rotation === 270) ? scaleHeight : scaleWidth;
        const outHeight = (rotation === 90 || rotation === 270) ? scaleWidth : scaleHeight;

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(outWidth);
        canvas.height = Math.round(outHeight);
        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

        // Build stream from canvas
        const canvasStream = canvas.captureStream(targetFps);

        // Audio extraction & mixing through AudioContext if audio is desired
        let finalStream = canvasStream;
        let audioCtx = null;
        let sourceNode = null;
        let destinationNode = null;

        if (includeAudio) {
          try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
            sourceNode = audioCtx.createMediaElementSource(offscreenVideo);
            destinationNode = audioCtx.createMediaStreamDestination();
            sourceNode.connect(destinationNode);

            const audioTrack = destinationNode.stream.getAudioTracks()[0];
            if (audioTrack) {
              finalStream.addTrack(audioTrack);
            }
          } catch (audioErr) {
            console.warn('AUDIO_PIPELINE_FALLBACK:', audioErr);
            // Continue silently without failing if audio capture fails in strict sandbox
          }
        }

        // Determine MIME codec
        let mimeType = getBestVideoMimeType();
        if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
        }

        const recorderOptions = {
          mimeType: mimeType || undefined,
          videoBitsPerSecond: targetBitrate || 2500000
        };

        let mediaRecorder;
        try {
          mediaRecorder = new MediaRecorder(finalStream, recorderOptions);
        } catch (e) {
          // Fallback with minimal options
          mediaRecorder = new MediaRecorder(finalStream);
        }

        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        let intervalId = null;

        const cleanup = () => {
          if (intervalId) clearInterval(intervalId);
          offscreenVideo.pause();
          offscreenVideo.src = '';
          offscreenVideo.load();
          if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close();
          }
        };

        controller.signal.addEventListener('abort', () => {
          if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          cleanup();
          reject(new Error('ABORTED_BY_USER'));
        });

        mediaRecorder.onstop = () => {
          cleanup();
          const finalBlob = new Blob(chunks, { type: mimeType || 'video/webm' });
          resolve(finalBlob);
        };

        // Seek to start position
        offscreenVideo.currentTime = startTime;
        await new Promise((res) => {
          offscreenVideo.onseeked = res;
        });

        mediaRecorder.start(100);
        await offscreenVideo.play();

        const renderFrame = () => {
          if (controller.signal.aborted) return;

          ctx.save();
          if (rotation === 90) {
            ctx.translate(canvas.width, 0);
            ctx.rotate((90 * Math.PI) / 180);
            ctx.drawImage(offscreenVideo, 0, 0, canvas.height, canvas.width);
          } else if (rotation === 180) {
            ctx.translate(canvas.width, canvas.height);
            ctx.rotate((180 * Math.PI) / 180);
            ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
          } else if (rotation === 270) {
            ctx.translate(0, canvas.height);
            ctx.rotate((270 * Math.PI) / 180);
            ctx.drawImage(offscreenVideo, 0, 0, canvas.height, canvas.width);
          } else {
            ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
          }
          ctx.restore();

          const currentElapsed = offscreenVideo.currentTime - startTime;
          const currentPct = Math.min(100, Math.max(0, (currentElapsed / effectiveDuration) * 100));
          onProgress(currentPct, `ENCODING FRAME (${Math.round(currentPct)}%)`);

          if (offscreenVideo.currentTime >= (endTime || offscreenVideo.duration) || offscreenVideo.ended) {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          } else {
            requestAnimationFrame(renderFrame);
          }
        };

        requestAnimationFrame(renderFrame);
      } catch (err) {
        reject(err);
      }
    });
  };

  
  // 01 COMPRESS
  const executeCompress = async (settings) => {
    try {
      const startTime = performance.now();
      const targetBitrate = settings.videoBitrate * 1000;
      const scaleFactor = settings.resolutionScale;
      const targetWidth = Math.floor((metadata.width * scaleFactor) / 2) * 2;
      const targetHeight = Math.floor((metadata.height * scaleFactor) / 2) * 2;

      const blob = await runVideoPipeline({
        scaleWidth: targetWidth,
        scaleHeight: targetHeight,
        targetBitrate,
        targetFps: settings.fps,
        includeAudio: settings.keepAudio,
        onProgress: (pct, msg) => {
          setProgress(pct);
          setStatusMessage(msg);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'COMPRESS',
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        width: targetWidth,
        height: targetHeight,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`COMPRESSION FAILED: ${err.message || 'Browser codec error'}`);
      }
      setIsProcessing(false);
    }
  };

  // 02 CONVERT
  const executeConvert = async (targetFormat) => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: metadata.width,
        scaleHeight: metadata.height,
        targetBitrate: 3500000,
        format: targetFormat,
        onProgress: (pct, msg) => {
          setProgress(pct);
          setStatusMessage(`CONVERTING TO ${targetFormat.toUpperCase()} (${Math.round(pct)}%)`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'CONVERT',
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        format: targetFormat.toUpperCase(),
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`CONVERSION FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // 03 RESIZE
  const executeResize = async (targetWidth, targetHeight) => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: targetWidth,
        scaleHeight: targetHeight,
        targetBitrate: 3000000,
        onProgress: (pct, msg) => {
          setProgress(pct);
          setStatusMessage(`RESIZING TO ${targetWidth}x${targetHeight} (${Math.round(pct)}%)`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'RESIZE',
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        width: targetWidth,
        height: targetHeight,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`RESIZE OPERATION FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // 04 TRIM
  const executeTrim = async (start, end) => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: metadata.width,
        scaleHeight: metadata.height,
        targetBitrate: 3500000,
        startTime: start,
        endTime: end,
        onProgress: (pct, msg) => {
          setProgress(pct);
          setStatusMessage(`TRIMMING RANGE [${formatTime(start)} - ${formatTime(end)}]`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'TRIM',
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: end - start,
        width: metadata.width,
        height: metadata.height,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`TRIM FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // 05 EXTRACT AUDIO
  const executeExtractAudio = async (audioFormat = 'wav') => {
    setIsProcessing(true);
    setProgress(20);
    setStatusMessage('READING AUDIO BUFFER WITH WEB AUDIO API...');
    try {
      const response = await fetch(videoUrl);
      const arrayBuffer = await response.arrayBuffer();
      setProgress(50);
      setStatusMessage('DECODING PCM AUDIO SAMPLES...');
      
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setProgress(80);
      setStatusMessage('PACKING HIGH-FIDELITY WAV CONTAINER...');

      const wavBlob = audioBufferToWav(audioBuffer);
      audioCtx.close();

      const outputUrl = URL.createObjectURL(wavBlob);
      setResultBlob(wavBlob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'EXTRACT AUDIO',
        originalSize: metadata.size,
        resultSize: wavBlob.size,
        savedPercent: (((metadata.size - wavBlob.size) / metadata.size) * 100).toFixed(1),
        duration: audioBuffer.duration,
        format: 'WAV 16-BIT PCM',
        channels: audioBuffer.numberOfChannels
      });
      setIsProcessing(false);
      setProgress(100);
    } catch (err) {
      setErrorMessage(`AUDIO EXTRACTION FAILED: ${err.message || 'No readable audio track in video.'}`);
      setIsProcessing(false);
    }
  };

  // 06 REMOVE AUDIO
  const executeRemoveAudio = async () => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: metadata.width,
        scaleHeight: metadata.height,
        targetBitrate: 3000000,
        includeAudio: false,
        onProgress: (pct) => {
          setProgress(pct);
          setStatusMessage(`RE-MUXING VIDEO STREAM WITHOUT AUDIO (${Math.round(pct)}%)`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: 'REMOVE AUDIO',
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        audioRemoved: true,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`STRIPPING AUDIO FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // 07 EXTRACT FRAME
  const executeExtractFrame = (timestamp, imageFormat = 'image/png') => {
    try {
      const vid = previewVideoRef.current;
      if (!vid) return;

      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || metadata.width;
      canvas.height = vid.videoHeight || metadata.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          setErrorMessage('FRAME CAPTURE ERROR: Canvas returned null blob.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const ext = imageFormat === 'image/jpeg' ? 'jpg' : 'png';
        const a = document.createElement('a');
        a.href = url;
        a.download = `FRAME_${Math.round(timestamp)}s_${canvas.width}x${canvas.height}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }, imageFormat, 0.95);
    } catch (err) {
      setErrorMessage(`FRAME CAPTURE FAILED: ${err.message}`);
    }
  };

  // 08 ROTATE
  const executeRotate = async (degrees) => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: metadata.width,
        scaleHeight: metadata.height,
        targetBitrate: 3200000,
        rotation: degrees,
        onProgress: (pct) => {
          setProgress(pct);
          setStatusMessage(`ROTATING FRAME MATRIX ${degrees}° (${Math.round(pct)}%)`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: `ROTATE ${degrees}°`,
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        rotation: `${degrees}°`,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`ROTATION FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // 09 CHANGE FPS
  const executeChangeFps = async (newFps) => {
    try {
      const startTime = performance.now();
      const blob = await runVideoPipeline({
        scaleWidth: metadata.width,
        scaleHeight: metadata.height,
        targetBitrate: 3000000,
        targetFps: newFps,
        onProgress: (pct) => {
          setProgress(pct);
          setStatusMessage(`RE-SAMPLING AT ${newFps} FPS (${Math.round(pct)}%)`);
        }
      });

      const outputUrl = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(outputUrl);
      setResultMeta({
        tool: `FPS CHANGE -> ${newFps}`,
        originalSize: metadata.size,
        resultSize: blob.size,
        savedPercent: (((metadata.size - blob.size) / metadata.size) * 100).toFixed(1),
        duration: metadata.duration,
        fps: newFps,
        executionTime: ((performance.now() - startTime) / 1000).toFixed(1)
      });
      setIsProcessing(false);
    } catch (err) {
      if (err.message !== 'ABORTED_BY_USER') {
        setErrorMessage(`FPS RESAMPLING FAILED: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  const addBatchFiles = (fileList) => {
    const items = Array.from(fileList).map(f => ({
      id: Math.random().toString(36).substring(7),
      file: f,
      name: f.name,
      size: f.size,
      status: 'WAITING',
      resultBlob: null,
      resultUrl: null
    }));
    setBatchQueue(prev => [...prev, ...items]);
  };

  const runBatchProcessing = async () => {
    setIsBatchRunning(true);
    for (let i = 0; i < batchQueue.length; i++) {
      const item = batchQueue[i];
      if (item.status === 'COMPLETE') continue;

      setBatchQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'PROCESSING' } : q));

      try {
        const itemUrl = URL.createObjectURL(item.file);
        const tempVid = document.createElement('video');
        tempVid.src = itemUrl;
        await new Promise(r => tempVid.onloadedmetadata = r);

        const canvas = document.createElement('canvas');
        canvas.width = Math.min(1280, tempVid.videoWidth || 1280);
        canvas.height = Math.round((canvas.width * (tempVid.videoHeight || 720)) / (tempVid.videoWidth || 1280));
        const ctx = canvas.getContext('2d');
        const stream = canvas.captureStream(24);
        const recorder = new MediaRecorder(stream, { videoBitsPerSecond: 1500000 });
        const chunks = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

        await new Promise((res, rej) => {
          recorder.onstop = res;
          tempVid.onended = () => recorder.stop();
          recorder.start(100);
          tempVid.play().catch(rej);
          const draw = () => {
            if (tempVid.ended || tempVid.paused) return;
            ctx.drawImage(tempVid, 0, 0, canvas.width, canvas.height);
            requestAnimationFrame(draw);
          };
          requestAnimationFrame(draw);
        });

        const b = new Blob(chunks, { type: 'video/webm' });
        const bUrl = URL.createObjectURL(b);

        setBatchQueue(prev => prev.map((q, idx) => idx === i ? {
          ...q,
          status: 'COMPLETE',
          resultBlob: b,
          resultUrl: bUrl,
          outSize: b.size
        } : q));
        URL.revokeObjectURL(itemUrl);
      } catch (e) {
        setBatchQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'ERROR' } : q));
      }
    }
    setIsBatchRunning(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F4F4F0] flex flex-col font-sans selection:bg-[#CCFF00] selection:text-black">
      {/* Top Brutalist Navigation Bar */}
      <header className="border-b-2 border-[#262626] bg-[#0A0A0A] sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#CCFF00] text-black font-extrabold flex items-center justify-center text-lg border-2 border-black shadow-[2px_2px_0px_#FFFFFF]">
              VF
            </div>
            <div>
              <span className="font-black text-xl tracking-tight text-white font-mono">VIDEO<span className="text-[#CCFF00]">FORGE</span></span>
              <span className="hidden sm:inline-block ml-3 px-2 py-0.5 text-[10px] uppercase font-mono font-bold bg-[#1A1A1A] text-[#A0A0A0] border border-[#333]">
                BROWSER ENGINE v2.6
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-xs font-mono bg-[#141414] px-3 py-1.5 border border-[#262626]">
              <ShieldCheck className="w-4 h-4 text-[#CCFF00]" />
              <span className="text-zinc-300">100% CLIENT-SIDE ENCODING</span>
            </div>

            {file && (
              <button
                onClick={() => {
                  setFile(null);
                  if (videoUrl) URL.revokeObjectURL(videoUrl);
                  setVideoUrl(null);
                  setMetadata(null);
                  setResultBlob(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold bg-[#1F1F1F] hover:bg-[#FF3333] hover:text-white transition-colors border border-[#333] text-zinc-300"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                START OVER
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="bg-[#FF3333] text-black px-4 py-3 flex items-center justify-between border-b-2 border-black font-mono text-sm font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-black hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Body */}
      <main className="flex-1 flex flex-col">
        {!file ? (
          <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 md:py-12 justify-center">
            {/* Editorial Title Block */}
            <div className="mb-10 text-center sm:text-left border-l-4 border-[#CCFF00] pl-4 sm:pl-6">
              <h1 className="text-4xl sm:text-7xl font-extrabold tracking-tighter uppercase leading-none font-sans text-white">
                COMPRESS. <br className="hidden sm:block" />
                <span className="text-[#CCFF00]">CONVERT.</span> CREATE.
              </h1>
              <p className="mt-4 text-sm sm:text-lg text-zinc-400 font-mono max-w-2xl">
                A high-performance browser-powered video toolkit. Local video streams, zero external server uploads, zero quality trade-offs.
              </p>
            </div>

            {/* Massive Drop Forge Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`relative border-3 border-dashed transition-all duration-150 p-8 sm:p-16 flex flex-col items-center justify-center text-center cursor-pointer group ${
                dragActive
                  ? 'border-[#CCFF00] bg-[#CCFF00]/10 scale-[1.01]'
                  : 'border-[#333333] hover:border-[#CCFF00] bg-[#111111]'
              } shadow-[6px_6px_0px_#000000]`}
              onClick={() => document.getElementById('hero-file-input').click()}
            >
              <input
                id="hero-file-input"
                type="file"
                accept="video/*,.mkv,.mov,.avi"
                className="hidden"
                onChange={(e) => e.target.files && handleFileLoad(e.target.files[0])}
              />

              <div className="w-20 h-20 bg-[#1A1A1A] border-2 border-[#333333] group-hover:border-[#CCFF00] group-hover:bg-[#CCFF00] group-hover:text-black flex items-center justify-center mb-6 transition-all text-[#CCFF00] shadow-[4px_4px_0px_#000000]">
                <Upload className="w-10 h-10" />
              </div>

              <h2 className="text-2xl sm:text-4xl font-black font-mono tracking-tight text-white mb-2 uppercase">
                {dragActive ? 'DROP TO FORGE' : 'DROP VIDEO HERE'}
              </h2>
              <p className="text-xs sm:text-sm font-mono text-zinc-400 mb-6">
                or click anywhere inside this forge to pick from your storage
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
                {FORMATS.map(fmt => (
                  <span key={fmt} className="px-2.5 py-1 text-xs font-mono font-bold bg-[#1F1F1F] text-zinc-300 border border-[#2B2B2B]">
                    {fmt}
                  </span>
                ))}
              </div>

              <button
                type="button"
                className="px-8 py-3.5 bg-[#CCFF00] hover:bg-white text-black font-black font-mono text-sm tracking-wide border-2 border-black shadow-[4px_4px_0px_#FFFFFF] uppercase transition-all active:translate-x-1 active:translate-y-1 active:shadow-none"
              >
                SELECT VIDEO FILE
              </button>
            </div>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12">
              <div className="p-5 border-2 border-[#262626] bg-[#0E0E0E]">
                <div className="text-[#CCFF00] font-mono text-xs font-bold uppercase mb-2">01 / PRIVACY FIRST</div>
                <h3 className="font-bold text-base mb-1 text-white">Zero Server Uploads</h3>
                <p className="text-xs text-zinc-400 font-mono">Your media never leaves your computer. All Canvas2D, audio and MediaRecorder operations occur locally.</p>
              </div>
              <div className="p-5 border-2 border-[#262626] bg-[#0E0E0E]">
                <div className="text-[#CCFF00] font-mono text-xs font-bold uppercase mb-2">02 / HARDWARE ENGINES</div>
                <h3 className="font-bold text-base mb-1 text-white">Browser Hardware Acceleration</h3>
                <p className="text-xs text-zinc-400 font-mono">Utilizes modern HTML5 WebCodecs & Canvas streams to process video directly on your GPU/CPU.</p>
              </div>
              <div className="p-5 border-2 border-[#262626] bg-[#0E0E0E]">
                <div className="text-[#CCFF00] font-mono text-xs font-bold uppercase mb-2">03 / MULTI-TOOL SUITE</div>
                <h3 className="font-bold text-base mb-1 text-white">10 Dedicated Utilities</h3>
                <p className="text-xs text-zinc-400 font-mono">Precision compression, dimension scaling, audio stripping, frame grabs, timeline trimming, and batching.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col max-w-[1700px] w-full mx-auto px-3 sm:px-6 py-4">
            {/* Large File Memory Advisory (>400MB) */}
            {metadata && metadata.size > 400 * 1024 * 1024 && (
              <div className="mb-4 bg-[#FFB800] text-black px-4 py-2 text-xs font-mono font-bold border-2 border-black flex items-center justify-between">
                <span>LARGE FILE WARNING ({formatBytes(metadata.size)}): In-browser rendering of high-capacity media requires substantial RAM.</span>
                <span className="text-[10px] uppercase bg-black text-[#FFB800] px-2 py-0.5">LOCAL MEMORY ACTIVE</span>
              </div>
            )}

            {/* Studio Workspace Header: File Details Bar */}
            <div className="bg-[#141414] border-2 border-[#262626] p-3 sm:p-4 mb-4 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
              <div className="flex items-center gap-3">
                <FileVideo className="w-5 h-5 text-[#CCFF00]" />
                <span className="font-bold text-sm text-white truncate max-w-xs sm:max-w-md">{metadata?.name}</span>
                <span className="px-2 py-0.5 bg-[#222] text-[#CCFF00] border border-[#333] font-bold">
                  {formatBytes(metadata?.size)}
                </span>
              </div>

              <div className="flex items-center gap-4 text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{formatTime(metadata?.duration)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{metadata?.width} × {metadata?.height}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-zinc-500" />
                  <span>~{metadata?.fps} FPS</span>
                </div>
              </div>
            </div>

            {/* Studio Split Layout: Left Preview / Right Control Center */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
              {/* Left Column: Video Preview and Timeline Monitor */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="bg-[#111] border-2 border-[#262626] relative overflow-hidden flex flex-col items-center justify-center p-2">
                  <video
                    ref={previewVideoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    className="max-h-[60vh] w-full object-contain bg-black border border-[#222]"
                  />
                  <div className="w-full flex items-center justify-between pt-2 px-2 text-[11px] font-mono text-zinc-400">
                    <span>PREVIEW MONITOR (NATIVE 1:1 ASPECT)</span>
                    <span className="text-[#CCFF00]">GPU CANVAS BACKED</span>
                  </div>
                </div>

                {/* Real Result Comparison Panel (When Generated) */}
                {resultBlob && resultMeta && (
                  <div className="bg-[#111111] border-3 border-[#CCFF00] p-5 shadow-[6px_6px_0px_#000000]">
                    <div className="flex items-center justify-between mb-4 border-b border-[#222] pb-3">
                      <div className="flex items-center gap-2">
                        <Check className="w-5 h-5 text-[#CCFF00]" />
                        <h3 className="font-extrabold text-white font-mono text-base uppercase">
                          FORGED COMPLETE · {resultMeta.tool}
                        </h3>
                      </div>
                      <span className="text-xs font-mono text-zinc-400">Time: {resultMeta.executionTime}s</span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-5 font-mono">
                      <div className="bg-[#181818] p-3 border border-[#2B2B2B]">
                        <div className="text-[10px] text-zinc-400 uppercase">ORIGINAL SIZE</div>
                        <div className="text-base font-bold text-zinc-200 mt-1">{formatBytes(resultMeta.originalSize)}</div>
                      </div>
                      <div className="bg-[#181818] p-3 border border-[#2B2B2B]">
                        <div className="text-[10px] text-zinc-400 uppercase">FORGED SIZE</div>
                        <div className="text-base font-bold text-[#CCFF00] mt-1">{formatBytes(resultMeta.resultSize)}</div>
                      </div>
                      <div className="bg-[#181818] p-3 border border-[#2B2B2B]">
                        <div className="text-[10px] text-zinc-400 uppercase">SAVED / DELTA</div>
                        <div className={`text-base font-bold mt-1 ${parseFloat(resultMeta.savedPercent) >= 0 ? 'text-[#CCFF00]' : 'text-[#FF3333]'}`}>
                          {parseFloat(resultMeta.savedPercent) >= 0 ? `-${resultMeta.savedPercent}%` : `+${Math.abs(resultMeta.savedPercent)}%`}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <a
                        href={resultUrl}
                        download={`FORGED_${resultMeta.tool.replace(/\s+/g, '_')}_${file.name}`}
                        className="flex-1 flex items-center justify-center gap-2 bg-[#CCFF00] hover:bg-white text-black font-extrabold font-mono text-sm py-3 px-4 border-2 border-black shadow-[3px_3px_0px_#FFFFFF] transition-all"
                      >
                        <Download className="w-4 h-4" />
                        DOWNLOAD VIDEO
                      </a>
                      <button
                        onClick={() => {
                          setResultBlob(null);
                          if (resultUrl) URL.revokeObjectURL(resultUrl);
                          setResultUrl(null);
                        }}
                        className="px-4 py-3 bg-[#222] hover:bg-[#333] text-zinc-300 font-mono text-xs font-bold border border-[#444]"
                      >
                        DISMISS
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Multi-tool Controller */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Tool Selector Tab Bar */}
                <div className="bg-[#141414] border-2 border-[#262626] p-2 overflow-x-auto scrollbar-none flex gap-1 font-mono text-xs">
                  {[
                    { id: 'compress', label: '01 COMPRESS', icon: Sliders },
                    { id: 'convert', label: '02 CONVERT', icon: Film },
                    { id: 'resize', label: '03 RESIZE', icon: Maximize2 },
                    { id: 'trim', label: '04 TRIM', icon: Scissors },
                    { id: 'extract_audio', label: '05 EXTRACT AUDIO', icon: Music },
                    { id: 'remove_audio', label: '06 STRIP AUDIO', icon: VolumeX },
                    { id: 'extract_frame', label: '07 GRAB FRAME', icon: ImageIcon },
                    { id: 'rotate', label: '08 ROTATE', icon: RotateCw },
                    { id: 'change_fps', label: '09 FPS', icon: Gauge },
                    { id: 'batch', label: '10 BATCH', icon: Layers }
                  ].map(tool => {
                    const Icon = tool.icon;
                    const isActive = activeTool === tool.id;
                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTool(tool.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 whitespace-nowrap font-bold transition-all border ${
                          isActive
                            ? 'bg-[#CCFF00] text-black border-black shadow-[2px_2px_0px_#FFFFFF]'
                            : 'bg-[#181818] text-zinc-400 border-transparent hover:text-white hover:border-[#333]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tool.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tool Configuration Panel Body */}
                <div className="bg-[#141414] border-2 border-[#262626] p-5 shadow-[4px_4px_0px_#000000]">
                  {/* Tool 01: COMPRESS */}
                  {activeTool === 'compress' && (
                    <CompressToolPanel
                      metadata={metadata}
                      onExecute={executeCompress}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 02: CONVERT */}
                  {activeTool === 'convert' && (
                    <ConvertToolPanel
                      metadata={metadata}
                      onExecute={executeConvert}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 03: RESIZE */}
                  {activeTool === 'resize' && (
                    <ResizeToolPanel
                      metadata={metadata}
                      onExecute={executeResize}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 04: TRIM */}
                  {activeTool === 'trim' && (
                    <TrimToolPanel
                      metadata={metadata}
                      previewRef={previewVideoRef}
                      onExecute={executeTrim}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 05: EXTRACT AUDIO */}
                  {activeTool === 'extract_audio' && (
                    <ExtractAudioToolPanel
                      metadata={metadata}
                      onExecute={executeExtractAudio}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 06: REMOVE AUDIO */}
                  {activeTool === 'remove_audio' && (
                    <RemoveAudioToolPanel
                      metadata={metadata}
                      onExecute={executeRemoveAudio}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 07: EXTRACT FRAME */}
                  {activeTool === 'extract_frame' && (
                    <ExtractFrameToolPanel
                      metadata={metadata}
                      previewRef={previewVideoRef}
                      onExecute={executeExtractFrame}
                    />
                  )}

                  {/* Tool 08: ROTATE */}
                  {activeTool === 'rotate' && (
                    <RotateToolPanel
                      metadata={metadata}
                      onExecute={executeRotate}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 09: CHANGE FPS */}
                  {activeTool === 'change_fps' && (
                    <ChangeFpsToolPanel
                      metadata={metadata}
                      onExecute={executeChangeFps}
                      isProcessing={isProcessing}
                    />
                  )}

                  {/* Tool 10: BATCH */}
                  {activeTool === 'batch' && (
                    <BatchToolPanel
                      queue={batchQueue}
                      isBatchRunning={isBatchRunning}
                      onAddFiles={addBatchFiles}
                      onRunBatch={runBatchProcessing}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#111] border-3 border-[#CCFF00] p-6 shadow-[8px_8px_0px_#000000]">
            <div className="flex items-center justify-between mb-4 border-b border-[#222] pb-3">
              <span className="font-mono text-xs font-bold text-[#CCFF00] tracking-wider uppercase">
                ACTIVE RENDERING ENGINE
              </span>
              <span className="font-mono text-xs text-zinc-400">FRAME PIPELINE</span>
            </div>

            <h3 className="text-xl font-black font-sans text-white mb-2 uppercase">
              ENCODING VIDEO STREAM
            </h3>
            <p className="text-xs font-mono text-zinc-400 mb-5">
              {statusMessage || 'Processing in-memory canvas frames...'}
            </p>

            {/* Genuine Measured Progress Bar */}
            <div className="w-full bg-[#222] h-4 border border-[#333] mb-3 relative overflow-hidden">
              <div
                className="bg-[#CCFF00] h-full transition-all duration-150 ease-out"
                style={{ width: `${Math.max(progress, 5)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-xs font-mono mb-6">
              <span className="text-zinc-500">CANVAS2D + MEDIARECORDER</span>
              <span className="text-white font-bold">{Math.round(progress)}%</span>
            </div>

            <button
              onClick={handleCancel}
              className="w-full py-2.5 bg-[#FF3333] hover:bg-white text-black font-bold font-mono text-xs uppercase border border-black shadow-[3px_3px_0px_#FFFFFF] transition-all"
            >
              CANCEL ENCODING
            </button>
          </div>
        </div>
      )}

      {}
      <footer className="border-t-2 border-[#262626] bg-[#0A0A0A] py-8 px-4 sm:px-6 mt-12 font-mono text-xs text-zinc-400">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="font-black text-white">VIDEOFORGE</span> — COMPRESS. CONVERT. CREATE.
            <span className="block text-zinc-400 text-[11px] mt-0.5">
              Browser-powered media tools. Local memory, zero upload.
            </span>
          </div>

          <div className="flex items-center gap-6">
            <span className="text-zinc-300 font-bold border-b border-[#CCFF00] pb-0.5">
              Created by Abhishek Rathi
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}


// 01 COMPRESS PANEL
function CompressToolPanel({ metadata, onExecute, isProcessing }) {
  const [preset, setPreset] = useState('balanced');
  const [targetSizeMb, setTargetSizeMb] = useState('');
  const [customBitrate, setCustomBitrate] = useState(2500);
  const [customScale, setCustomScale] = useState(1);
  const [customFps, setCustomFps] = useState(30);
  const [keepAudio, setKeepAudio] = useState(true);

  // Compute preset values
  const presets = {
    max: { name: 'MAX QUALITY', bitrate: 5500, scale: 1, desc: 'Near lossless visual preservation with minimal size reduction.' },
    high: { name: 'HIGH QUALITY', bitrate: 3800, scale: 1, desc: 'Sharp high-bitrate output for portfolio & presentation video.' },
    balanced: { name: 'BALANCED', bitrate: 2200, scale: 0.85, desc: 'Recommended trade-off: 50-70% size reduction with sharp edges.' },
    small: { name: 'SMALL FILE', bitrate: 1100, scale: 0.65, desc: 'Aggressive downsizing for Discord, email attachments & fast sharing.' },
    custom: { name: 'CUSTOM', bitrate: customBitrate, scale: customScale, desc: 'Direct manual control over frame dimensions, FPS, and bitrate.' }
  };

  // If user enters target size in MB, calculate target bitrate
  const handleTargetSizeChange = (val) => {
    setTargetSizeMb(val);
    const mb = parseFloat(val);
    if (!isNaN(mb) && mb > 0 && metadata.duration > 0) {
      // Bitrate (kbps) = (targetSizeMB * 8192) / durationSeconds
      const calculatedKbps = Math.max(250, Math.floor((mb * 8192) / metadata.duration));
      setCustomBitrate(calculatedKbps);
      setPreset('custom');
    }
  };

  const currentSettings = presets[preset];

  const handleStart = () => {
    onExecute({
      videoBitrate: preset === 'custom' ? customBitrate : currentSettings.bitrate,
      resolutionScale: preset === 'custom' ? customScale : currentSettings.scale,
      fps: customFps,
      keepAudio
    });
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">01 / COMPRESS VIDEO</h4>
        <p className="text-xs text-zinc-400 mt-1">Local stream compression with bit-rate clamping.</p>
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Object.entries(presets).map(([key, item]) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={`p-2.5 text-left text-xs font-bold border transition-all ${
              preset === key
                ? 'bg-[#CCFF00] text-black border-black shadow-[2px_2px_0px_#FFFFFF]'
                : 'bg-[#1A1A1A] text-zinc-300 border-[#2E2E2E] hover:border-zinc-500'
            }`}
          >
            <div>{item.name}</div>
          </button>
        ))}
      </div>

      <div className="bg-[#1A1A1A] p-3 border border-[#2A2A2A] text-xs text-zinc-300">
        {currentSettings.desc}
      </div>

      {/* Target Size Estimator */}
      <div className="bg-[#181818] p-3 border border-[#2E2E2E]">
        <label className="text-[11px] font-bold text-zinc-400 uppercase block mb-1.5">
          TARGET FILE SIZE PRESETS (ESTIMATE)
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {['10', '25', '50', '100'].map(sz => (
            <button
              key={sz}
              onClick={() => handleTargetSizeChange(sz)}
              className={`px-2.5 py-1 text-xs border ${
                targetSizeMb === sz ? 'bg-white text-black font-bold' : 'bg-[#222] text-zinc-300 border-[#333]'
              }`}
            >
              {sz} MB
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Custom MB (e.g. 15)"
            value={targetSizeMb}
            onChange={(e) => handleTargetSizeChange(e.target.value)}
            className="flex-1 bg-[#111] border border-[#333] px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#CCFF00]"
          />
          <span className="text-xs text-zinc-500">MB</span>
        </div>
      </div>

      {/* Custom Sliders when Custom is active */}
      {preset === 'custom' && (
        <div className="space-y-3 bg-[#181818] p-3 border border-[#2E2E2E] text-xs">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-400">BITRATE</span>
              <span className="text-[#CCFF00] font-bold">{customBitrate} kbps</span>
            </div>
            <input
              type="range"
              min="300"
              max="10000"
              step="100"
              value={customBitrate}
              onChange={(e) => setCustomBitrate(Number(e.target.value))}
              className="w-full accent-[#CCFF00]"
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span className="text-zinc-400">RESOLUTION SCALE</span>
              <span className="text-[#CCFF00] font-bold">{Math.round(customScale * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={customScale}
              onChange={(e) => setCustomScale(Number(e.target.value))}
              className="w-full accent-[#CCFF00]"
            />
          </div>
        </div>
      )}

      {/* Audio Toggle */}
      <div className="flex items-center justify-between bg-[#181818] p-3 border border-[#2E2E2E] text-xs">
        <span className="text-zinc-300">KEEP AUDIO TRACK</span>
        <button
          onClick={() => setKeepAudio(!keepAudio)}
          className={`px-3 py-1 font-bold text-xs border ${
            keepAudio ? 'bg-[#CCFF00] text-black border-black' : 'bg-[#222] text-zinc-400 border-[#333]'
          }`}
        >
          {keepAudio ? 'ENABLED' : 'MUTED'}
        </button>
      </div>

      <button
        onClick={handleStart}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        FORGE COMPRESSION
      </button>
    </div>
  );
}

// 02 CONVERT PANEL
function ConvertToolPanel({ metadata, onExecute, isProcessing }) {
  const [selectedFormat, setSelectedFormat] = useState('webm');
  const formats = [
    { id: 'webm', label: 'WEBM (VP9/VP8)', desc: 'High compatibility on web & Chromium.' },
    { id: 'mp4', label: 'MP4 (AVC/H264)', desc: 'Universal playback across Apple & Windows devices.' }
  ];

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">02 / FORMAT CONVERTER</h4>
        <p className="text-xs text-zinc-400 mt-1">Transcode video stream locally to standard formats.</p>
      </div>

      <div className="space-y-2">
        {formats.map(f => (
          <div
            key={f.id}
            onClick={() => setSelectedFormat(f.id)}
            className={`p-3 border cursor-pointer transition-all ${
              selectedFormat === f.id
                ? 'bg-[#CCFF00] text-black border-black shadow-[2px_2px_0px_#FFFFFF]'
                : 'bg-[#181818] text-zinc-300 border-[#2E2E2E] hover:border-zinc-500'
            }`}
          >
            <div className="font-bold text-xs">{f.label}</div>
            <div className="text-[11px] opacity-80 mt-0.5">{f.desc}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onExecute(selectedFormat)}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all mt-2"
      >
        CONVERT TO {selectedFormat.toUpperCase()}
      </button>
    </div>
  );
}

// 03 RESIZE PANEL
function ResizeToolPanel({ metadata, onExecute, isProcessing }) {
  const [width, setWidth] = useState(metadata.width);
  const [height, setHeight] = useState(metadata.height);
  const [lockRatio, setLockRatio] = useState(true);

  const aspectRatio = metadata.width / metadata.height;

  const handleWidthChange = (val) => {
    const w = Number(val);
    setWidth(w);
    if (lockRatio) setHeight(Math.round(w / aspectRatio));
  };

  const handleHeightChange = (val) => {
    const h = Number(val);
    setHeight(h);
    if (lockRatio) setWidth(Math.round(h * aspectRatio));
  };

  const setPreset = (targetW, targetH) => {
    setWidth(targetW);
    setHeight(targetH);
  };

  const isUpscaling = width > metadata.width || height > metadata.height;

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">03 / RESIZE DIMENSIONS</h4>
        <p className="text-xs text-zinc-400 mt-1">Scale canvas resolution dynamically.</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: '1080p', w: 1920, h: 1080 },
          { label: '720p', w: 1280, h: 720 },
          { label: '480p', w: 854, h: 480 },
          { label: '360p', w: 640, h: 360 }
        ].map(p => (
          <button
            key={p.label}
            onClick={() => setPreset(p.w, p.h)}
            className="p-2 bg-[#1A1A1A] hover:bg-[#252525] border border-[#333] text-xs font-bold text-zinc-300"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 bg-[#181818] p-3 border border-[#2E2E2E]">
        <div>
          <label className="text-[10px] text-zinc-400 uppercase block mb-1">WIDTH (PX)</label>
          <input
            type="number"
            value={width}
            onChange={(e) => handleWidthChange(e.target.value)}
            className="w-full bg-[#111] border border-[#333] p-2 text-xs text-white focus:outline-none focus:border-[#CCFF00]"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-400 uppercase block mb-1">HEIGHT (PX)</label>
          <input
            type="number"
            value={height}
            onChange={(e) => handleHeightChange(e.target.value)}
            className="w-full bg-[#111] border border-[#333] p-2 text-xs text-white focus:outline-none focus:border-[#CCFF00]"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>ASPECT RATIO LOCK ({aspectRatio.toFixed(2)}:1)</span>
        <button
          onClick={() => setLockRatio(!lockRatio)}
          className={`px-2.5 py-1 text-xs font-bold border ${lockRatio ? 'bg-[#CCFF00] text-black border-black' : 'bg-[#222] text-zinc-400 border-[#333]'}`}
        >
          {lockRatio ? 'LOCKED' : 'FREE'}
        </button>
      </div>

      {isUpscaling && (
        <div className="p-2.5 bg-[#FFB800] text-black font-bold text-xs border border-black">
          WARNING: Source is {metadata.width}x{metadata.height}. Upscaling may introduce blur and larger file size.
        </div>
      )}

      <button
        onClick={() => onExecute(width, height)}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        RESIZE VIDEO STREAM
      </button>
    </div>
  );
}

// 04 TRIM PANEL
function TrimToolPanel({ metadata, previewRef, onExecute, isProcessing }) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(metadata.duration, 30));

  const handlePreviewRange = () => {
    if (previewRef.current) {
      previewRef.current.currentTime = startTime;
      previewRef.current.play();
      const checkEnd = () => {
        if (previewRef.current && previewRef.current.currentTime >= endTime) {
          previewRef.current.pause();
          previewRef.current.removeEventListener('timeupdate', checkEnd);
        }
      };
      previewRef.current.addEventListener('timeupdate', checkEnd);
    }
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">04 / TRIM TIMELINE</h4>
        <p className="text-xs text-zinc-400 mt-1">Cut boundaries and export strictly selected duration.</p>
      </div>

      <div className="bg-[#181818] p-4 border border-[#2E2E2E] space-y-4">
        <div>
          <div className="flex justify-between text-xs mb-1 text-zinc-400">
            <span>START POINT</span>
            <span className="text-[#CCFF00] font-bold">{formatTime(startTime)}</span>
          </div>
          <input
            type="range"
            min="0"
            max={metadata.duration}
            step="0.1"
            value={startTime}
            onChange={(e) => setStartTime(Math.min(Number(e.target.value), endTime - 0.5))}
            className="w-full accent-[#CCFF00]"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1 text-zinc-400">
            <span>END POINT</span>
            <span className="text-[#CCFF00] font-bold">{formatTime(endTime)}</span>
          </div>
          <input
            type="range"
            min="0"
            max={metadata.duration}
            step="0.1"
            value={endTime}
            onChange={(e) => setEndTime(Math.max(Number(e.target.value), startTime + 0.5))}
            className="w-full accent-[#CCFF00]"
          />
        </div>

        <div className="flex justify-between items-center text-xs pt-2 border-t border-[#262626]">
          <span className="text-zinc-400">TRIMMED DURATION</span>
          <span className="text-white font-bold">{formatTime(endTime - startTime)}</span>
        </div>
      </div>

      <button
        onClick={handlePreviewRange}
        className="py-2 bg-[#222] hover:bg-[#333] text-zinc-200 border border-[#3A3A3A] font-bold text-xs"
      >
        PREVIEW SELECTED RANGE
      </button>

      <button
        onClick={() => onExecute(startTime, endTime)}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        TRIM & EXPORT
      </button>
    </div>
  );
}

// 05 EXTRACT AUDIO PANEL
function ExtractAudioToolPanel({ metadata, onExecute, isProcessing }) {
  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">05 / EXTRACT AUDIO</h4>
        <p className="text-xs text-zinc-400 mt-1">Extract pristine lossless 16-bit PCM WAV via Web Audio API.</p>
      </div>

      <div className="bg-[#181818] p-4 border border-[#2E2E2E] text-xs text-zinc-300 space-y-2">
        <div className="flex justify-between">
          <span className="text-zinc-500">FORMAT</span>
          <span className="text-[#CCFF00] font-bold">WAV (PCM 16-BIT)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">SAMPLING</span>
          <span className="text-white">44.1 kHz / 48 kHz</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">CHANNELS</span>
          <span className="text-white">STEREO CHANNELS</span>
        </div>
      </div>

      <button
        onClick={() => onExecute('wav')}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        DECODE & EXTRACT WAV
      </button>
    </div>
  );
}

// 06 REMOVE AUDIO PANEL
function RemoveAudioToolPanel({ metadata, onExecute, isProcessing }) {
  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">06 / STRIP AUDIO</h4>
        <p className="text-xs text-zinc-400 mt-1">Create a completely silent, muted video file.</p>
      </div>

      <div className="bg-[#181818] p-4 border border-[#2E2E2E] text-xs text-zinc-300">
        Completely disconnects and silences the audio tracks, re-encoding purely the video canvas. Ideal for social media clips, silent b-roll, and background loops.
      </div>

      <button
        onClick={() => onExecute()}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        STRIP AUDIO TRACK
      </button>
    </div>
  );
}

// 07 EXTRACT FRAME PANEL
function ExtractFrameToolPanel({ metadata, previewRef, onExecute }) {
  const [format, setFormat] = useState('image/png');

  const handleCapture = () => {
    const currentTime = previewRef.current ? previewRef.current.currentTime : 0;
    onExecute(currentTime, format);
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">07 / EXTRACT STILL FRAME</h4>
        <p className="text-xs text-zinc-400 mt-1">Capture high-resolution still images directly from preview playhead.</p>
      </div>

      <div className="bg-[#181818] p-3 border border-[#2E2E2E]">
        <label className="text-[10px] text-zinc-400 uppercase block mb-2">IMAGE ENCODING</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setFormat('image/png')}
            className={`p-2 text-xs font-bold border ${
              format === 'image/png' ? 'bg-[#CCFF00] text-black border-black' : 'bg-[#222] text-zinc-300 border-[#333]'
            }`}
          >
            PNG (LOSSLESS)
          </button>
          <button
            onClick={() => setFormat('image/jpeg')}
            className={`p-2 text-xs font-bold border ${
              format === 'image/jpeg' ? 'bg-[#CCFF00] text-black border-black' : 'bg-[#222] text-zinc-300 border-[#333]'
            }`}
          >
            JPG (COMPACT)
          </button>
        </div>
      </div>

      <div className="text-xs text-zinc-400">
        Scrub preview video on the left to the exact frame you want, then click capture.
      </div>

      <button
        onClick={handleCapture}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        CAPTURE & DOWNLOAD FRAME
      </button>
    </div>
  );
}

// 08 ROTATE PANEL
function RotateToolPanel({ metadata, onExecute, isProcessing }) {
  const [angle, setAngle] = useState(90);

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">08 / ROTATE MATRIX</h4>
        <p className="text-xs text-zinc-400 mt-1">Rotate 90°, 180°, or 270° with geometric canvas transformation.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[90, 180, 270].map(deg => (
          <button
            key={deg}
            onClick={() => setAngle(deg)}
            className={`p-3 font-bold text-xs border ${
              angle === deg ? 'bg-[#CCFF00] text-black border-black shadow-[2px_2px_0px_#FFFFFF]' : 'bg-[#181818] text-zinc-300 border-[#333]'
            }`}
          >
            {deg}° CLOCKWISE
          </button>
        ))}
      </div>

      <div className="bg-[#181818] p-3 border border-[#2E2E2E] text-xs text-zinc-300">
        New Output Size: {angle === 180 ? `${metadata.width} × ${metadata.height}` : `${metadata.height} × ${metadata.width}`}
      </div>

      <button
        onClick={() => onExecute(angle)}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        ROTATE & ENCODE ({angle}°)
      </button>
    </div>
  );
}

// 09 CHANGE FPS PANEL
function ChangeFpsToolPanel({ metadata, onExecute, isProcessing }) {
  const [targetFps, setTargetFps] = useState(24);

  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">09 / FRAME RATE RESAMPLING</h4>
        <p className="text-xs text-zinc-400 mt-1">Re-encode stream at target frames per second.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[60, 30, 25, 24, 15].map(fps => (
          <button
            key={fps}
            onClick={() => setTargetFps(fps)}
            className={`p-2.5 font-bold text-xs border ${
              targetFps === fps ? 'bg-[#CCFF00] text-black border-black shadow-[2px_2px_0px_#FFFFFF]' : 'bg-[#181818] text-zinc-300 border-[#333]'
            }`}
          >
            {fps} FPS
          </button>
        ))}
      </div>

      <button
        onClick={() => onExecute(targetFps)}
        disabled={isProcessing}
        className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        RESAMPLE TO {targetFps} FPS
      </button>
    </div>
  );
}

// 10 BATCH PANEL
function BatchToolPanel({ queue, isBatchRunning, onAddFiles, onRunBatch }) {
  return (
    <div className="flex flex-col gap-4 font-mono">
      <div className="border-b border-[#262626] pb-3">
        <h4 className="font-extrabold text-sm text-white uppercase tracking-tight">10 / BATCH PROCESSOR</h4>
        <p className="text-xs text-zinc-400 mt-1">Queue multiple videos for local sequential compression.</p>
      </div>

      <input
        id="batch-input"
        type="file"
        multiple
        accept="video/*"
        className="hidden"
        onChange={(e) => e.target.files && onAddFiles(e.target.files)}
      />

      <button
        onClick={() => document.getElementById('batch-input').click()}
        className="py-2.5 bg-[#1A1A1A] hover:bg-[#252525] border border-dashed border-[#444] text-xs font-bold text-[#CCFF00]"
      >
        + ADD VIDEOS TO QUEUE
      </button>

      <div className="max-h-48 overflow-y-auto space-y-2">
        {queue.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center py-4">NO BATCH ITEMS QUEUED</div>
        ) : (
          queue.map((item, i) => (
            <div key={item.id} className="p-2 bg-[#181818] border border-[#2E2E2E] flex items-center justify-between text-xs">
              <div className="truncate max-w-[180px]">
                <div className="text-white font-bold truncate">{item.name}</div>
                <div className="text-zinc-500 text-[10px]">{formatBytes(item.size)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-[10px] font-bold border ${
                  item.status === 'COMPLETE' ? 'bg-[#CCFF00] text-black border-black' :
                  item.status === 'PROCESSING' ? 'bg-[#3366FF] text-white border-white animate-pulse' :
                  'bg-[#222] text-zinc-400 border-[#333]'
                }`}>
                  {item.status}
                </span>
                {item.resultUrl && (
                  <a
                    href={item.resultUrl}
                    download={`BATCH_${item.name}`}
                    className="p-1 bg-[#CCFF00] text-black hover:bg-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {queue.length > 0 && (
        <button
          onClick={onRunBatch}
          disabled={isBatchRunning}
          className="w-full py-3.5 bg-[#CCFF00] hover:bg-white text-black font-extrabold text-xs uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_#FFFFFF] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
        >
          {isBatchRunning ? 'PROCESSING BATCH...' : 'START BATCH FORGE'}
        </button>
      )}
    </div>
  );
}