import asyncio
import json
import numpy as np
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription
from faster_whisper import WhisperModel
import wave
import io
import threading
import queue

# Initialize Whisper model (runs on CPU or GPU)
# Options: "tiny", "base", "small", "medium", "large-v3"
model = WhisperModel("base", device="cpu", compute_type="int8")

pcs = set()

class AudioTranscriber:
    def __init__(self, sample_rate=16000):
        self.sample_rate = sample_rate
        self.audio_buffer = []
        self.buffer_duration = 0
        self.min_chunk_duration = 2.0  # Process every 2 seconds
        
    def add_audio_chunk(self, audio_bytes):
        """Add audio chunk to buffer"""
        # Convert bytes to numpy array (assuming 16-bit PCM)
        audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
        self.audio_buffer.extend(audio_data)
        
        # Calculate duration
        self.buffer_duration = len(self.audio_buffer) / self.sample_rate
        
    def should_transcribe(self):
        """Check if we have enough audio to transcribe"""
        return self.buffer_duration >= self.min_chunk_duration
    
    def transcribe_buffer(self):
        """Transcribe accumulated audio"""
        if not self.audio_buffer:
            return None
            
        # Convert to float32 normalized audio
        audio_np = np.array(self.audio_buffer, dtype=np.float32) / 32768.0
        
        # Transcribe
        segments, info = model.transcribe(
            audio_np,
            language="en",
            beam_size=5,
            vad_filter=True,  # Voice activity detection
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        # Collect transcription
        transcription = ""
        for segment in segments:
            transcription += segment.text + " "
        
        # Clear buffer after transcription
        self.audio_buffer = []
        self.buffer_duration = 0
        
        return transcription.strip()

async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)
    
    transcriber = AudioTranscriber()
    response_channel = None

    @pc.on("datachannel")
    def on_datachannel(channel):
        nonlocal response_channel
        print(f"Data channel created: {channel.label}")
        
        if channel.label == "audio":
            # Audio input channel
            @channel.on("message")
            def on_audio_message(message):
                if isinstance(message, bytes):
                    # Add audio chunk to buffer
                    transcriber.add_audio_chunk(message)
                    
                    # Transcribe if we have enough audio
                    if transcriber.should_transcribe():
                        transcription = transcriber.transcribe_buffer()
                        if transcription and response_channel:
                            # Send transcription back
                            response_data = json.dumps({
                                "type": "transcription",
                                "text": transcription,
                                "timestamp": asyncio.get_event_loop().time()
                            })
                            response_channel.send(response_data)
                            print(f"Sent transcription: {transcription}")
        
        elif channel.label == "transcription":
            # Transcription output channel
            response_channel = channel
            
            @channel.on("open")
            def on_open():
                print("Transcription channel opened")
                channel.send(json.dumps({
                    "type": "status",
                    "message": "Ready to transcribe"
                }))

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print(f"Connection state: {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc.close()
            pcs.discard(pc)

    # Set remote description and create answer
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps({
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type
        }),
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    )

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()

async def options_handler(request):
    """Handle CORS preflight requests"""
    return web.Response(
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    )

app = web.Application()
app.router.add_post("/offer", offer)
app.router.add_options("/offer", options_handler)
app.on_shutdown.append(on_shutdown)

if __name__ == "__main__":
    print("Starting transcription server on http://localhost:8080")
    web.run_app(app, host="0.0.0.0", port=8080)