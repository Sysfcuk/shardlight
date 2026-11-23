// Offline support: network first (so updates show straight away), cached copy when offline.
const CACHE = 'shardlight-v1';
const J = './vendor/three/examples/jsm/';
const CORE = ['./', './index.html', './main.js', './engine.js', './ai.worker.js', './scene.js', './models.js', './world.js', './swarm.js', './shardlight.wasm',
  './vendor/three/build/three.module.js', J + 'environments/RoomEnvironment.js', J + 'utils/BufferGeometryUtils.js',
  J + 'postprocessing/EffectComposer.js', J + 'postprocessing/Pass.js', J + 'postprocessing/RenderPass.js', J + 'postprocessing/ShaderPass.js',
  J + 'postprocessing/MaskPass.js', J + 'postprocessing/OutputPass.js', J + 'postprocessing/UnrealBloomPass.js', J + 'shaders/CopyShader.js', J + 'shaders/OutputShader.js', J + 'shaders/LuminosityHighPassShader.js',
  './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // 'no-cache' revalidates with the server, so a new deploy shows up at once instead of after
  // GitHub Pages' 10-minute browser cache runs out
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});
