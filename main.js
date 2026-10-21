import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* =========================================================
   1. SOUND (synthesized with Web Audio — no audio files)
   ========================================================= */
const Sound = (() => {
  let ctx, master, enabled = false;
  const toggleLabel = document.querySelector("#sound-toggle b");

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Ambient space drone: two detuned oscillators through a lowpass
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.connect(master);
    [55, 55.7, 82.4].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 2 ? "sine" : "sawtooth";
      o.frequency.value = f;
      g.gain.value = i === 2 ? 0.12 : 0.07;
      o.connect(g).connect(filter);
      o.start();
    });
    // Slow filter sweep
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  function set(on) {
    enabled = on;
    if (on) { init(); ctx.resume(); }
    if (master) master.gain.setTargetAtTime(on ? 0.35 : 0, ctx.currentTime, 0.4);
    toggleLabel.textContent = on ? "on" : "off";
  }

  function blip(freq = 880, dur = 0.12, type = "sine", vol = 0.08) {
    if (!enabled || !ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  return {
    set,
    toggle: () => set(!enabled),
    hover: () => blip(660, 0.08, "sine", 0.05),
    click: () => blip(220, 0.25, "triangle", 0.12),
    whoosh: () => blip(120, 0.6, "sawtooth", 0.03),
    get on() { return enabled; },
  };
})();


/* =========================================================
   2. HERO INTRO + SOUND TOGGLE
   ========================================================= */
document.querySelectorAll(".hero .reveal").forEach((el, i) =>
  setTimeout(() => el.classList.add("in"), 400 + i * 150));

document.getElementById("sound-toggle").addEventListener("click", () => {
  Sound.toggle();
  Sound.click();
});

// Browsers only allow audio after a user gesture, so turn sound on at the first one
function autoEnableSound(e) {
  removeEventListener("pointerdown", autoEnableSound);
  removeEventListener("keydown", autoEnableSound);
  if (e.target.closest && e.target.closest("#sound-toggle")) return;
  Sound.set(true);
}
addEventListener("pointerdown", autoEnableSound);
addEventListener("keydown", autoEnableSound);

/* =========================================================
   3. CUSTOM CURSOR
   ========================================================= */
const dot = document.getElementById("cursor-dot");
const ring = document.getElementById("cursor-ring");
const mouse = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2 };

addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  dot.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%)`;
});
addEventListener("mousedown", () => { ring.classList.add("down"); Sound.click(); });
addEventListener("mouseup", () => ring.classList.remove("down"));
document.querySelectorAll("a,button,[data-hover]").forEach((el) => {
  el.addEventListener("mouseenter", () => { ring.classList.add("hover"); Sound.hover(); });
  el.addEventListener("mouseleave", () => ring.classList.remove("hover"));
});

/* =========================================================
   4. THREE.JS 3D SCENE
   ========================================================= */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060b, 0.035);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 14);

// Particle field with gravity-well shader
const COUNT = 4000;
const pos = new Float32Array(COUNT * 3);
const seed = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const r = 5 + Math.random() * 18;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
  pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.6;
  pos[i * 3 + 2] = r * Math.cos(ph);
  seed[i] = Math.random();
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

const pMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uWell: { value: new THREE.Vector3(0, 0, 0) },
    uPR: { value: renderer.getPixelRatio() },
  },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform vec3 uWell; uniform float uPR;
    attribute float aSeed; varying float vA; varying float vMix;
    void main(){
      vec3 p = position;
      float a = uTime * (0.05 + aSeed * 0.1);
      float c = cos(a), s = sin(a);
      p.xz = mat2(c, -s, s, c) * p.xz;
      vec3 d = uWell - p;
      float dist = length(d);
      p += normalize(d) * (6.0 / (dist + 2.0)) * 1.4;   // pulled toward the cursor
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (2.5 + aSeed * 3.0) * uPR * (24.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vA = 0.35 + aSeed * 0.65; vMix = aSeed;
    }`,
  fragmentShader: /* glsl */ `
    varying float vA; varying float vMix;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      if(d > 0.5) discard;
      vec3 col = mix(vec3(0.49,0.36,1.0), vec3(0.0,0.83,1.0), vMix);
      gl_FragColor = vec4(col, vA * smoothstep(0.5, 0.0, d));
    }`,
});
const points = new THREE.Points(pGeo, pMat);
scene.add(points);

// Central object: wireframe icosahedron + inner core + orbit rings
const hero = new THREE.Group();
scene.add(hero);
const shell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(2.6, 1),
  new THREE.MeshBasicMaterial({ color: 0x7c5cff, wireframe: true, transparent: true, opacity: 0.55 })
);
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 3),
  new THREE.MeshStandardMaterial({ color: 0x0a0c20, metalness: 0.9, roughness: 0.25, emissive: 0x1b1260, emissiveIntensity: 0.9 })
);
hero.add(shell, core);
const rings = [];
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.6 + i * 0.7, 0.012, 8, 160),
    new THREE.MeshBasicMaterial({ color: i % 2 ? 0x00d4ff : 0x7c5cff, transparent: true, opacity: 0.7 })
  );
  ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  rings.push(ring);
  hero.add(ring);
}
scene.add(new THREE.AmbientLight(0x6670ff, 0.6));
const pl = new THREE.PointLight(0x00d4ff, 40, 30);
pl.position.set(5, 4, 6);
scene.add(pl);

// Input + scroll state
const ndc = new THREE.Vector2();
let scrollT = 0;
addEventListener("mousemove", (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
addEventListener("scroll", () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollT = max > 0 ? scrollY / max : 0;
}, { passive: true });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
const wellTarget = new THREE.Vector3();
let smoothScroll = 0;

function animate() {
  const t = clock.getElapsedTime();
  pMat.uniforms.uTime.value = t;

  // Cursor ring follows with lag
  mouse.rx += (mouse.x - mouse.rx) * 0.15;
  mouse.ry += (mouse.y - mouse.ry) * 0.15;
  ring.style.transform = `translate(${mouse.rx}px,${mouse.ry}px) translate(-50%,-50%)`;

  // Gravity well follows cursor in world space
  wellTarget.set(ndc.x * 9, ndc.y * 5, 2);
  pMat.uniforms.uWell.value.lerp(wellTarget, 0.06);

  // Scroll-driven camera + object choreography
  smoothScroll += (scrollT - smoothScroll) * 0.06;
  camera.position.z = 14 - smoothScroll * 6;
  camera.position.x = Math.sin(smoothScroll * Math.PI * 2) * 3;
  camera.position.y = ndc.y * 0.6 - smoothScroll * 2;
  camera.lookAt(0, -smoothScroll * 1.5, 0);

  hero.rotation.y = t * 0.18 + ndc.x * 0.6 + smoothScroll * 4;
  hero.rotation.x = Math.sin(t * 0.3) * 0.15 + ndc.y * 0.35;
  hero.position.y = Math.sin(t * 0.8) * 0.2 - smoothScroll * 1.5;
  const s = 1 + Math.sin(t * 1.4) * 0.025 + smoothScroll * 0.4;
  hero.scale.setScalar(s);
  rings.forEach((r, i) => { r.rotation.z += 0.002 * (i + 1); r.rotation.x += 0.0012; });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

/* =========================================================
   5. SCROLL REVEAL, COUNTERS, CARD TILT
   ========================================================= */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (!e.target.closest(".hero")) Sound.whoosh();
    const b = e.target.querySelector("[data-count]");
    if (b) countUp(b);
    io.unobserve(e.target);
  });
}, { threshold: 0.2 });
document.querySelectorAll(".reveal:not(.hero .reveal)").forEach((el) => io.observe(el));

function countUp(el) {
  const end = +el.dataset.count, start = performance.now(), dur = 1600;
  (function step(now) {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = Math.floor(end * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-4px)`;
  });
  card.addEventListener("mouseleave", () => (card.style.transform = ""));
});