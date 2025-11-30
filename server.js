const express = require('express');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const Onvif = require('node-onvif');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const DEFAULT_RTSP_PATH = '/Streaming/Channels/101';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cameraSession = {
  device: null,
  profileToken: null,
  rtspUrl: null,
  connectionParams: null,
};

let ffmpegProcess = null;

function broadcastWsClose(reason) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, reason);
    }
  });
}

function stopStream() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGINT');
    ffmpegProcess = null;
  }
}

function startStream() {
  if (ffmpegProcess || !cameraSession.rtspUrl) {
    return;
  }

  const args = [
    '-rtsp_transport',
    'tcp',
    '-i',
    cameraSession.rtspUrl,
    '-f',
    'mpegts',
    '-codec:v',
    'mpeg1video',
    '-r',
    '25',
    '-b:v',
    '800k',
    '-bf',
    '0',
    '-muxdelay',
    '0.001',
    'pipe:1',
  ];

  ffmpegProcess = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'inherit'] });

  ffmpegProcess.stdout.on('data', (chunk) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(chunk);
      }
    });
  });

  ffmpegProcess.on('close', () => {
    ffmpegProcess = null;
  });

  ffmpegProcess.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`FFmpeg error: ${err.message}`);
    broadcastWsClose('Stream encoder error');
    stopStream();
  });
}

async function connectToCamera({ ip, username, password, rtspPath }) {
  if (!ip || !username || !password) {
    throw new Error('IP, username, and password are required.');
  }

  const xaddr = `http://${ip}/onvif/device_service`;
  const device = new Onvif.OnvifDevice({ xaddr, user: username, pass: password });
  await device.init();

  const profile = device.getCurrentProfile?.() || device.getProfileList?.()?.[0];
  const profileToken = profile?.token || null;

  const fallbackRtsp = `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${ip}${rtspPath || DEFAULT_RTSP_PATH}`;
  let rtspUrl = fallbackRtsp;

  if (typeof device.getRtspUrl === 'function') {
    const derived = device.getRtspUrl();
    if (derived) {
      rtspUrl = derived;
    }
  }

  cameraSession = {
    device,
    profileToken,
    rtspUrl,
    connectionParams: { ip, username, password, rtspPath: rtspPath || DEFAULT_RTSP_PATH },
  };

  return { rtspUrl, profileToken };
}

async function handlePtzMove({ x = 0, y = 0, z = 0, speed = 0.5 }) {
  if (!cameraSession.device || !cameraSession.profileToken) {
    throw new Error('Camera is not connected.');
  }

  const velocity = {};
  if (x !== 0 || y !== 0) {
    velocity.PanTilt = { x: x * speed, y: y * speed };
  }
  if (z !== 0) {
    velocity.Zoom = { x: z * speed };
  }

  if (!velocity.PanTilt && !velocity.Zoom) {
    await cameraSession.device.services.ptz.stop({ ProfileToken: cameraSession.profileToken, PanTilt: true, Zoom: true });
    return;
  }

  await cameraSession.device.services.ptz.continuousMove({
    ProfileToken: cameraSession.profileToken,
    Velocity: velocity,
    Timeout: 1,
  });
}

app.post('/api/connect', async (req, res) => {
  try {
    stopStream();
    const { ip, username, password, rtspPath } = req.body;
    const { rtspUrl, profileToken } = await connectToCamera({ ip, username, password, rtspPath });
    res.json({ message: 'Camera connected', rtspUrl, profileToken });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/ptz/move', async (req, res) => {
  try {
    const { x = 0, y = 0, z = 0, speed = 0.5 } = req.body;
    await handlePtzMove({ x, y, z, speed });
    res.json({ message: 'PTZ command sent' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

wss.on('connection', (ws) => {
  if (!cameraSession.rtspUrl) {
    ws.close(1011, 'Camera not connected');
    return;
  }

  if (!ffmpegProcess) {
    startStream();
  }

  ws.on('close', () => {
    if (wss.clients.size === 0) {
      stopStream();
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
