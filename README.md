# WebRTC Real-Time Transcription POC

## Overview

This project is a proof of concept demonstrating real-time audio transcription using WebRTC to establish direct peer-to-peer communication between a React frontend and a Python backend service. The system captures audio from the user's microphone, streams it to a Python transcription service via WebRTC data channels, and displays real-time transcriptions.

This POC showcases how real-time communication can be achieved over two separate services via WebRTC, enabling low-latency bidirectional data exchange without requiring a traditional signaling server infrastructure.

## Architecture

The project consists of two separate services:

1. **Frontend (`audioInterface/`)**: React application built with TanStack Start, initialized with Convex and shadcn UI components
2. **Backend (`transcriber/`)**: Python async web server using aiortc for WebRTC and faster-whisper for speech-to-text transcription

### Communication Flow

The system uses WebRTC to establish a direct peer connection between the frontend and backend:

1. **Connection Establishment**:
   - Frontend creates a WebRTC offer and sends it to the backend via HTTP POST (`http://localhost:8080/offer`)
   - Backend creates an answer and establishes the peer connection
   - Two data channels are created: `audio` (frontend → backend) and `transcription` (backend → frontend)

2. **Audio Streaming**:
   - Frontend captures microphone audio using the Web Audio API
   - Audio is resampled from the source sample rate to 16kHz (required by Whisper)
   - Audio chunks are converted to 16-bit PCM and sent via the `audio` data channel

3. **Transcription**:
   - Backend buffers incoming audio chunks
   - Every 2 seconds (or when buffer reaches minimum duration), the audio is transcribed using faster-whisper
   - Transcriptions are sent back to the frontend via the `transcription` data channel
   - Frontend displays transcriptions in real-time

## Project Structure

```
tsStart/
├── audioInterface/          # React frontend (TanStack Start)
│   ├── src/
│   │   ├── components/
│   │   │   └── audio.tsx    # Main WebRTC audio transcription component
│   │   └── routes/
│   │       └── app/
│   │           └── route.tsx
│   └── package.json
├── transcriber/              # Python backend
│   ├── main.py              # WebRTC server and transcription logic
│   └── pyproject.toml
└── README                   # This file
```

## Key Technologies

### Frontend
- **TanStack Start**: React framework with file-based routing
- **Convex**: Backend-as-a-service (initialized but not used in this POC)
- **shadcn/ui**: UI component library
- **WebRTC**: For peer-to-peer communication
- **Web Audio API**: For audio capture and processing

### Backend
- **aiohttp**: Async HTTP web framework
- **aiortc**: Python WebRTC implementation
- **faster-whisper**: Optimized Whisper model for speech transcription
- **numpy**: Audio processing

## Setup Instructions

### Prerequisites
- Node.js (for frontend)
- Python 3.11+ (for backend)
- Microphone access (for audio capture)

### Frontend Setup

```bash
cd audioInterface
pnpm install
pnpm dev
```

The frontend will run on `http://localhost:3000`

### Backend Setup

```bash
cd transcriber
# Using uv (recommended)
uv sync
uv run python main.py

# Or using pip
pip install -e .
python main.py
```

The backend will run on `http://localhost:8080`

## Usage

1. Start both services (frontend and backend)
2. Navigate to `http://localhost:3000/app` in your browser
3. Click "Connect" to establish the WebRTC connection
4. Click "Start Recording" to begin capturing and transcribing audio
5. Speak into your microphone - transcriptions will appear in real-time
6. Click "Stop Recording" to pause transcription
7. Click "Disconnect" to close the WebRTC connection

## Technical Details

### Audio Processing
- Frontend resamples audio to 16kHz (Whisper's required sample rate)
- Audio is converted to 16-bit PCM format before transmission
- Backend buffers audio chunks and processes them in 2-second intervals

### WebRTC Configuration
- Uses Google's public STUN server (`stun:stun.l.google.com:19302`) for NAT traversal
- Data channels are configured with ordered delivery
- Connection state is monitored and errors are handled gracefully

### Transcription Model
- Uses faster-whisper "base" model (can be changed in `main.py`)
- Runs on CPU with int8 quantization
- Supports voice activity detection (VAD) to filter silence

## Proof of Concept Notes

This project demonstrates:
- Real-time bidirectional communication between separate services using WebRTC
- Direct peer-to-peer data channel communication without intermediate servers
- Low-latency audio streaming and transcription
- Separation of concerns: frontend handles UI/audio capture, backend handles ML inference

**Limitations**:
- Currently uses a simple HTTP endpoint for signaling (offer/answer exchange)
- No authentication or security measures implemented
- Single client connection at a time
- Development/localhost only (no production deployment considerations)

## Future Enhancements

- Implement proper WebRTC signaling server (WebSocket-based)
- Add authentication and security
- Support multiple concurrent connections
- Add audio quality indicators
- Implement reconnection logic
- Add support for different languages
- Optimize for production deployment


