const form = document.getElementById('connect-form');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const refreshBtn = document.getElementById('refresh-btn');
const ptzStop = document.getElementById('ptz-stop');
const speedInput = document.getElementById('speed');
const speedValue = document.getElementById('speed-value');
const videoCanvas = document.getElementById('video-canvas');

let player = null;
let isConnected = false;

function setStatus(connected) {
  isConnected = connected;
  statusText.textContent = connected ? 'Подключено' : 'Отключено';
  statusDot.classList.toggle('dot--green', connected);
  statusDot.classList.toggle('dot--red', !connected);
}

function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/stream`;
}

function startPlayer() {
  if (player) {
    player.destroy();
  }
  const url = getWsUrl();
  player = new JSMpeg.Player(url, {
    canvas: videoCanvas,
    autoplay: true,
    audio: false,
  });
}

async function connectCamera(body) {
  const response = await fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error || 'Не удалось подключиться');
  }

  return response.json();
}

async function sendPtzCommand(payload) {
  const response = await fetch('/api/ptz/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error || 'Не удалось выполнить PTZ');
  }

  return response.json();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const button = document.getElementById('connect-btn');
  button.disabled = true;
  button.textContent = 'Подключение...';

  try {
    await connectCamera(data);
    setStatus(true);
    startPlayer();
  } catch (err) {
    alert(err.message);
    setStatus(false);
  } finally {
    button.disabled = false;
    button.textContent = 'Подключиться';
  }
});

refreshBtn.addEventListener('click', () => {
  if (!isConnected) {
    alert('Подключите камеру перед перезапуском потока');
    return;
  }
  startPlayer();
});

function handleControlClick(event) {
  const target = event.currentTarget;
  const x = Number(target.dataset.x || 0);
  const y = Number(target.dataset.y || 0);
  const z = Number(target.dataset.z || 0);
  const speed = Number(speedInput.value);

  sendPtzCommand({ x, y, z, speed }).catch((err) => alert(err.message));
}

document.querySelectorAll('.control:not(#ptz-stop)').forEach((btn) => {
  btn.addEventListener('click', handleControlClick);
});

ptzStop.addEventListener('click', () => {
  sendPtzCommand({ x: 0, y: 0, z: 0, speed: 0 }).catch((err) => alert(err.message));
});

speedInput.addEventListener('input', () => {
  speedValue.textContent = Number(speedInput.value).toFixed(1);
});

setStatus(false);
