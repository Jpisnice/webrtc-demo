import { useState, useRef, useCallback, useEffect } from 'react'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'recording' | 'error'

interface TranscriptionMessage {
  type: 'transcription' | 'status'
  text?: string
  message?: string
  timestamp?: number
}

export default function AudioTranscription() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [transcription, setTranscription] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const audioChannelRef = useRef<RTCDataChannel | null>(null)
  const transcriptionChannelRef = useRef<RTCDataChannel | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  // Cleanup function
  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }

    audioChannelRef.current = null
    transcriptionChannelRef.current = null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  // Connect to WebRTC backend
  const connect = useCallback(async () => {
    try {
      setConnectionState('connecting')
      setErrorMessage('')

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
      pcRef.current = pc

      // Create data channels
      const audioChannel = pc.createDataChannel('audio', {
        ordered: true
      })
      audioChannelRef.current = audioChannel

      const transcriptionChannel = pc.createDataChannel('transcription', {
        ordered: true
      })
      transcriptionChannelRef.current = transcriptionChannel

      // Handle audio channel events
      audioChannel.onopen = () => {
        console.log('Audio channel opened')
        setConnectionState('connected')
      }

      audioChannel.onerror = (error) => {
        console.error('Audio channel error:', error)
        setErrorMessage('Audio channel error occurred')
        setConnectionState('error')
      }

      audioChannel.onclose = () => {
        console.log('Audio channel closed')
        if (connectionState === 'recording') {
          stopRecording()
        }
      }

      // Handle transcription channel events
      transcriptionChannel.onopen = () => {
        console.log('Transcription channel opened')
      }

      transcriptionChannel.onmessage = (event) => {
        try {
          const data: TranscriptionMessage = JSON.parse(event.data)
          
          if (data.type === 'transcription' && data.text) {
            setTranscription(prev => prev + data.text + ' ')
          } else if (data.type === 'status' && data.message) {
            console.log('Status:', data.message)
          }
        } catch (error) {
          console.error('Failed to parse transcription message:', error)
        }
      }

      transcriptionChannel.onerror = (error) => {
        console.error('Transcription channel error:', error)
      }

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState)
        
        if (pc.connectionState === 'failed') {
          setErrorMessage('Connection failed')
          setConnectionState('error')
          cleanup()
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          setConnectionState('disconnected')
          cleanup()
        }
      }

      // Handle ICE connection state
      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState)
      }

      // Create offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Send offer to backend
      const response = await fetch('http://localhost:8080/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const answer = await response.json()
      await pc.setRemoteDescription(new RTCSessionDescription(answer))

    } catch (error) {
      console.error('Connection error:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to connect')
      setConnectionState('error')
      cleanup()
    }
  }, [cleanup, connectionState])

  // Resample audio from source sample rate to target sample rate (16000 Hz)
  const resampleAudio = useCallback((inputData: Float32Array, sourceSampleRate: number, targetSampleRate: number = 16000): Int16Array => {
    if (sourceSampleRate === targetSampleRate) {
      // No resampling needed
      const int16Data = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      return int16Data
    }

    // Linear interpolation resampling
    const ratio = sourceSampleRate / targetSampleRate
    const outputLength = Math.round(inputData.length / ratio)
    const outputData = new Float32Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio
      const srcIndexFloor = Math.floor(srcIndex)
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1)
      const t = srcIndex - srcIndexFloor

      // Linear interpolation
      outputData[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t
    }

    // Convert float32 to int16
    const int16Data = new Int16Array(outputData.length)
    for (let i = 0; i < outputData.length; i++) {
      const s = Math.max(-1, Math.min(1, outputData[i]))
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    return int16Data
  }, [])

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setTranscription('')
      setErrorMessage('')

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      mediaStreamRef.current = stream

      // Create audio context with default sample rate (matches MediaStream)
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      
      const source = audioContext.createMediaStreamSource(stream)

      // Create script processor for audio chunks
      const bufferSize = 4096
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)
      processorRef.current = processor

      const sourceSampleRate = audioContext.sampleRate
      const targetSampleRate = 16000

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        
        // Resample to 16000 Hz and convert to int16
        const int16Data = resampleAudio(inputData, sourceSampleRate, targetSampleRate)

        // Send audio chunk
        const audioChannel = audioChannelRef.current
        if (audioChannel && audioChannel.readyState === 'open') {
          try {
            // Create a new ArrayBuffer from the Int16Array
            const buffer = new ArrayBuffer(int16Data.byteLength)
            const view = new Int16Array(buffer)
            view.set(int16Data)
            audioChannel.send(buffer)
          } catch (error) {
            console.error('Failed to send audio chunk:', error)
          }
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      setConnectionState('recording')

    } catch (error) {
      console.error('Recording error:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start recording')
      setConnectionState('error')
      
      // Cleanup on error
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [resampleAudio])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setConnectionState('connected')
  }, [])

  // Disconnect
  const disconnect = useCallback(() => {
    cleanup()
    setConnectionState('disconnected')
    setTranscription('')
    setErrorMessage('')
  }, [cleanup])

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-100 text-green-800'
      case 'connecting': return 'bg-yellow-100 text-yellow-800'
      case 'recording': return 'bg-blue-100 text-blue-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = () => {
    switch (connectionState) {
      case 'connected': return 'Connected - Ready to record'
      case 'connecting': return 'Connecting...'
      case 'recording': return 'Recording...'
      case 'error': return `Error: ${errorMessage}`
      default: return 'Disconnected'
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Real-time Audio Transcription</h1>

      {/* Status */}
      <div className={`p-4 rounded-lg ${getStatusColor()}`}>
        <p className="font-semibold">{getStatusText()}</p>
      </div>

      {/* Controls */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={connect}
          disabled={connectionState !== 'disconnected'}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Connect
        </button>

        <button
          onClick={startRecording}
          disabled={connectionState !== 'connected'}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Start Recording
        </button>

        <button
          onClick={stopRecording}
          disabled={connectionState !== 'recording'}
          className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Stop Recording
        </button>

        <button
          onClick={disconnect}
          disabled={connectionState === 'disconnected'}
          className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* Transcription Output */}
      <div className="bg-gray-50 rounded-lg p-6 min-h-[200px]">
        <h2 className="text-xl font-semibold mb-3">Transcription:</h2>
        <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">
          {transcription || 'Waiting for audio...'}
        </div>
      </div>

      {/* Debug Info */}
      <details className="text-sm text-gray-600">
        <summary className="cursor-pointer font-semibold">Debug Info</summary>
        <div className="mt-2 space-y-1 bg-gray-50 p-3 rounded">
          <p>Connection State: {connectionState}</p>
          <p>Audio Channel: {audioChannelRef.current?.readyState || 'Not initialized'}</p>
          <p>Transcription Channel: {transcriptionChannelRef.current?.readyState || 'Not initialized'}</p>
          <p>Peer Connection: {pcRef.current?.connectionState || 'Not initialized'}</p>
        </div>
      </details>
    </div>
  )
}