"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// VidMind as light through a prism: video frames stream in along a white beam, the glass play-prism splits it into
// three channels (what was heard, seen and proven) and note cards ride out along them. On launch the camera dives
// into the prism at warp speed. Beams, sparks, stars and the floor are drawn by small shaders from time alone, so the
// CPU does almost nothing per frame and every glow stays sharp at any size.
const RAYS = [
  { color: "#3ee8ff", angle: 0.42, label: "Heard", by: "Muse Voice", time: "0:22" },
  { color: "#8b7bff", angle: 0, label: "Seen", by: "SAM 3.1 + Spark", time: "1:24" },
  { color: "#ff5cc8", angle: -0.42, label: "Proven", by: "Evidence check", time: "3:07" },
];
// Light additive glows vanish on a white page, so the light theme draws with deeper colours and normal blending.
const INK = {
  dark: { rays: ["#3ee8ff", "#8b7bff", "#ff5cc8"], beam: "#ffffff", core: 0.75, star: [0.78, 0.8, 1.0, 0.75], glow: "#a99cff", glowAlpha: 0.5,
    floor: "#8b7bff", by: "rgba(230,232,255,0.82)", blending: THREE.AdditiveBlending },
  light: { rays: ["#0891b2", "#5b45f0", "#db2777"], beam: "#4b4f86", core: 0.12, star: [0.3, 0.32, 0.58, 0.45], glow: "#8b7bff", glowAlpha: 0.32,
    floor: "#5b45f0", by: "rgba(27,22,64,0.78)", blending: THREE.NormalBlending },
};
const STARS = 1400;
const SPARKS = 480;
const FRAMES = 7;
const CARDS = 3; // per ray
const R = 1.05; // prism radius: the tip sits at x = R
export const LAUNCH_S = 1.25;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const backOut = (t: number) => (t >= 1 ? 1 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);
const fade = (u: number, edge = 0.15) => smooth(u / edge) * (1 - smooth((u - (1 - edge)) / edge));
const rand = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }; // seeded: same sky every render
// Shaders here work in display (sRGB) values and skip tone mapping, so colours match the CSS tokens exactly.
const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();

// These shaders are written in display (sRGB) values. Effects always run, so the scene renders into a linear buffer:
// decode to linear here, then three.js's own output chunk (a no-op into a render target, an sRGB encode straight to
// the screen), so the colours come out the same either way.
const linearOut = (frag: string) =>
  frag.replace(/}\s*$/, "  gl_FragColor = sRGBTransferEOTF(gl_FragColor);\n  #include <colorspace_fragment>\n}");

const BEAM_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime, uReveal, uGain, uInward, uCore;
varying vec2 vUv;
void main() {
  float along = mix(vUv.x, 1.0 - vUv.x, uInward);           // 0 at the prism, 1 far away
  float across = abs(vUv.y - 0.5) * 2.0;
  float core = exp(-across * across * 140.0);
  float halo = exp(-across * across * 9.0) * 0.32;
  float falloff = pow(1.0 - along, 1.3);
  float travel = along + mix(-1.0, 1.0, uInward) * uTime * 0.32;  // pulses run with the light
  // Pulses read as light on a dark page and as smudges on a white one, so they follow the core brightness.
  float pulse = 0.72 + 0.5 * smoothstep(0.8, 1.0, sin(travel * 24.0)) * smoothstep(0.3, 0.6, uCore);
  // Rays leaving the tip fade in over a short distance, so three cores don't stack into one blown-out spot.
  falloff *= mix(smoothstep(0.0, 0.07, along), 1.0, uInward);
  float drawn = mix(along, 1.0 - along, uInward);            // what the intro has drawn so far
  float shown = 1.0 - smoothstep(uReveal - 0.08, uReveal, drawn);
  vec3 col = mix(uColor, vec3(1.0), core * uCore);
  gl_FragColor = vec4(col, (core + halo) * falloff * pulse * shown * uGain);
}`;

const PRISM_VERT = /* glsl */ `
varying vec3 vN, vV, vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const PRISM_FRAG = /* glsl */ `
uniform float uTime, uGlow;
varying vec3 vN, vV, vP;
void main() {
  vec3 n = normalize(vN), v = normalize(vV);
  float fres = pow(1.0 - abs(dot(n, v)), 2.2);
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 0.9 + vP.y * 0.35 + vP.x * 0.2 + uTime * 0.06));
  vec3 h = normalize(normalize(vec3(-0.5, 0.7, 0.6)) + v);
  float spec = pow(max(dot(n, h), 0.0), 70.0);
  float sheen = smoothstep(0.92, 1.0, sin(vP.x * 2.4 - vP.y * 1.6 + uTime * 0.9)) * 0.35;  // a glint sweeping the glass
  vec3 col = vec3(0.13, 0.07, 0.42) + iri * (0.14 + fres * 0.95) + spec * 1.4 + sheen + vec3(0.6, 0.5, 1.0) * uGlow;
  gl_FragColor = vec4(col, clamp(0.62 + fres * 0.35 + spec + sheen, 0.0, 1.0));
}`;

const SPARK_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aAngle, aPhase, aSize, aInward; attribute vec2 aOff;
uniform float uTime, uPx, uR, uGain;
varying vec3 vColor; varying float vAlpha;
void main() {
  float u; vec3 p;
  if (aInward > 0.5) {   // dust drawn along the incoming beam into the prism
    u = fract(aPhase + uTime * 0.11);
    p = vec3(mix(-6.5, -0.55, u), aOff.x * 0.6 * (1.0 - u), aOff.y * 0.6 * (1.0 - u));
  } else {               // sparks spreading out along a ray
    u = fract(aPhase + uTime * 0.09);
    vec2 dir = vec2(cos(aAngle), sin(aAngle));
    vec2 side = vec2(-dir.y, dir.x);
    p = vec3(vec2(uR, 0.0) + dir * (0.1 + u * 6.5) + side * aOff.x * (0.03 + u * 0.4), aOff.y * u * 0.9);
  }
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * (1.0 - u * 0.45) * (6.0 / -mv.z);
  vAlpha = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.7, 1.0, u)) * (0.55 + 0.45 * sin(uTime * 5.0 + aPhase * 60.0)) * uGain;
}`;
const SPARK_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.0, 0.5, d);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), a * a * 0.6), a * a * vAlpha);
}`;

const STAR_VERT = /* glsl */ `
attribute float aTail;
uniform float uTravel, uLen;
varying float vA;
void main() {
  float z = mod(position.z + uTravel + 20.0, 26.0) - 20.0 - aTail * uLen;
  vA = (1.0 - aTail * 0.92) * smoothstep(-20.0, -13.0, z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.0);
}`;
const STAR_FRAG = /* glsl */ `uniform vec4 uInk; varying float vA; void main() { gl_FragColor = vec4(uInk.rgb, vA * uInk.a); }`;

const FLOOR_VERT = /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLOOR_FRAG = /* glsl */ `
uniform float uTravel; uniform vec3 uColor, uGlowAt;
varying vec3 vW;
void main() {
  vec2 g = vW.xz * 0.9 + vec2(0.0, uTravel * 0.9);
  vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);        // antialiased lines at any distance
  float line = 1.0 - min(min(grid.x, grid.y), 1.0);
  float far = exp(-length(vW.xz - uGlowAt.xz) * 0.11) * (1.0 - smoothstep(1.0, 6.0, vW.z));
  float pool = exp(-length(vW.xz - uGlowAt.xz) * 0.6) * 0.18;  // the prism's light on the floor
  gl_FragColor = vec4(uColor, line * far * 0.5 + pool);
}`;

function texture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  draw(canvas.getContext("2d")!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const font = (weight: number, px: number, mono = false) => {
  const css = getComputedStyle(document.documentElement);
  return `${weight} ${px}px ${css.getPropertyValue(mono ? "--font-jetbrains" : "--font-grotesk") || "system-ui"}`;
};
const glowMap = () => texture(256, 256, (c) => {
  const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
});
const glass = (c: CanvasRenderingContext2D, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(4, 4, w - 8, h - 8, r);
  const fill = c.createLinearGradient(0, 0, w, h);
  fill.addColorStop(0, "rgba(34,30,84,0.94)");
  fill.addColorStop(1, "rgba(12,12,36,0.94)");
  c.fillStyle = fill;
  c.fill();
  const edge = c.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, "#3ee8ff");
  edge.addColorStop(0.5, "#8b7bff");
  edge.addColorStop(1, "#ff5cc8");
  c.lineWidth = 4;
  c.strokeStyle = edge;
  c.stroke();
};
const cardMap = (accent: string, time: string) => texture(512, 288, (c) => { // a checked note with its timestamp
  glass(c, 512, 288, 26);
  c.fillStyle = accent;
  c.fillRect(36, 40, 8, 8);
  c.fillStyle = "rgba(255,255,255,0.95)";
  c.beginPath(); c.roundRect(56, 34, 300, 20, 10); c.fill();
  c.fillStyle = "rgba(255,255,255,0.45)";
  for (const [y, w] of [[82, 400], [114, 360], [146, 250]]) { c.beginPath(); c.roundRect(36, y, w, 14, 7); c.fill(); }
  c.fillStyle = "rgba(139,123,255,0.3)";
  c.beginPath(); c.roundRect(36, 196, 132, 52, 26); c.fill();
  c.fillStyle = "#ffffff";
  c.font = font(600, 30, true);
  c.fillText(`▶ ${time}`, 56, 232);
  c.fillStyle = "#34d399";
  c.beginPath(); c.arc(440, 222, 30, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#04050d"; c.lineWidth = 8; c.lineCap = "round"; c.lineJoin = "round";
  c.beginPath(); c.moveTo(426, 222); c.lineTo(437, 233); c.lineTo(455, 212); c.stroke();
});
const frameMap = (i: number) => texture(384, 216, (c) => { // a video frame: a slide with a small diagram, a playhead
  glass(c, 384, 216, 18);
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.beginPath(); c.roundRect(28, 26, 170, 14, 7); c.fill();
  const hues = ["#3ee8ff", "#8b7bff", "#ff5cc8"];
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = hues[(k + i) % 3]; c.lineWidth = 4;
    c.beginPath(); c.roundRect(28 + k * 112, 70, 82, 54, 10); c.stroke();
    if (k < 2) { c.beginPath(); c.moveTo(112 + k * 112, 97); c.lineTo(138 + k * 112, 97); c.stroke(); }
  }
  c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(28, 172, 328, 6);
  c.fillStyle = "#8b7bff"; c.fillRect(28, 172, 60 + i * 38, 6);
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(88 + i * 38, 175, 9, 0, Math.PI * 2); c.fill();
});
const labelMap = (label: string, by: string, color: string, byColor: string) => texture(1024, 200, (c) => {
  c.fillStyle = color;
  c.font = font(600, 84);
  c.fillText(label, 8, 92);
  c.fillStyle = byColor;
  c.font = font(500, 46, true);
  c.fillText(by, 10, 168);
});

const blend = { transparent: true, depthWrite: false, toneMapped: false } as const;

// The values the frame loop animates, shared by every material that reads them. Module-level: only one hero scene is
// ever mounted, and the loop can then update them without touching anything React rendered.
const U = {
  time: { value: 0 }, revealIn: { value: 0 }, revealOut: { value: 0 }, gainIn: { value: 1 }, gainOut: { value: 1 },
  glow: { value: 0 }, px: { value: 1 }, sparkGain: { value: 0 }, travel: { value: 0 }, len: { value: 0.04 },
  floorTravel: { value: 0 }, glowAt: { value: new THREE.Vector3() },
};

function Scene({ launch, light }: { launch: boolean; light: boolean }) {
  const { size, gl } = useThree();
  // Effects after the scene: real bloom on the dark page (the bright cores of the beams, sparks and prism spill light;
  // on a white page a glow adds nothing), then SMAA. Bloom wipes the image when the scene buffer is multisampled
  // (three r186 on Metal: the canvas read back empty), so the canvas has no MSAA and SMAA smooths the edges instead.
  useEffect(() => {
    const smaa = new SMAAPass();
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.32, 0.72); // strength, radius, luminance threshold
    gl.setEffects(light ? [smaa] : [bloom, smaa]); // sized by the renderer, and resized with it
    return () => {
      gl.setEffects(null);
      bloom.dispose();
      smaa.dispose();
    };
  }, [gl, light]);
  const wide = size.width >= 900;
  const home = useMemo(() => (wide ? new THREE.Vector3(1.25, 0.15, 0) : new THREE.Vector3(0, -2.6, -1.8)), [wide]);

  const rig = useRef<THREE.Group>(null);
  const prism = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Sprite>(null);
  const frames = useRef<THREE.Mesh[]>([]);
  const cards = useRef<THREE.Mesh[]>([]);
  const labels = useRef<THREE.Mesh[]>([]);
  const clock = useRef({ start: -1, launchAt: -1, travel: 0 });

  const maps = useMemo(() => ({
    glow: glowMap(),
    cards: RAYS.map((r) => cardMap(r.color, r.time)),
    frames: [0, 1, 2].map(frameMap),
    labels: RAYS.map((r, i) => labelMap(r.label, r.by, INK[light ? "light" : "dark"].rays[i], INK[light ? "light" : "dark"].by)),
  }), [light]);
  const prismGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(R, R, 1.2, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).toNonIndexed();
    g.computeVertexNormals(); // flat facets
    return g;
  }, []);
  const edges = useMemo(() => new THREE.EdgesGeometry(prismGeometry), [prismGeometry]);
  const mats = useMemo(() => {
    const ink = INK[light ? "light" : "dark"];
    const beam = (color: string, inward: number, reveal: { value: number }, gain: { value: number }) => new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: linearOut(BEAM_FRAG), ...blend, blending: ink.blending,
      uniforms: { uColor: { value: srgb(color) }, uTime: U.time, uReveal: reveal, uGain: gain, uInward: { value: inward }, uCore: { value: ink.core } },
    });
    return {
      in: beam(ink.beam, 1, U.revealIn, U.gainIn),
      rays: RAYS.map((_, i) => beam(ink.rays[i], 0, U.revealOut, U.gainOut)),
      fan: RAYS.map((_, i) => beam(ink.rays[i], 0, U.revealIn, U.gainIn)),
      prism: new THREE.ShaderMaterial({ vertexShader: PRISM_VERT, fragmentShader: linearOut(PRISM_FRAG), ...blend, side: THREE.DoubleSide, uniforms: { uTime: U.time, uGlow: U.glow } }),
      sparks: new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: linearOut(SPARK_FRAG), ...blend, blending: ink.blending,
        uniforms: { uTime: U.time, uPx: U.px, uR: { value: R }, uGain: U.sparkGain } }),
      stars: new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: linearOut(STAR_FRAG), ...blend, uniforms: { uTravel: U.travel, uLen: U.len, uInk: { value: new THREE.Vector4(...ink.star) } } }),
      floor: new THREE.ShaderMaterial({ vertexShader: FLOOR_VERT, fragmentShader: linearOut(FLOOR_FRAG), ...blend,
        uniforms: { uTravel: U.floorTravel, uColor: { value: srgb(ink.floor) }, uGlowAt: U.glowAt } }),
    };
  }, [light]);
  const sparks = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = SPARKS;
    const inward = (i: number) => (i % 4 === 3 ? 1 : 0);
    const ray = (i: number) => RAYS[i % 4 === 3 ? 1 : i % 4];
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // placed by the shader
    g.setAttribute("aColor", new THREE.BufferAttribute(Float32Array.from({ length: n * 3 }, (_, k) => {
      const i = Math.floor(k / 3);
      const ink = INK[light ? "light" : "dark"];
      const c = srgb(inward(i) ? ink.beam : ink.rays[RAYS.indexOf(ray(i))]);
      return [c.r, c.g, c.b][k % 3];
    }), 3));
    g.setAttribute("aAngle", new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => ray(i).angle), 1));
    g.setAttribute("aInward", new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => inward(i)), 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => rand(i + 7)), 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => 3 + rand(i + 3) * 7), 1));
    g.setAttribute("aOff", new THREE.BufferAttribute(Float32Array.from({ length: n * 2 }, (_, k) => (rand(k + 11) - 0.5) * 2), 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20); // positions live in the shader
    return g;
  }, [light]);
  const sky = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(STARS * 6);
    for (let i = 0; i < STARS; i++) {
      const p = [(rand(i) - 0.5) * 30, (rand(i + 0.5) - 0.5) * 18, -20 + rand(i + 0.25) * 26];
      pos.set(p, i * 6);
      pos.set(p, i * 6 + 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aTail", new THREE.BufferAttribute(Float32Array.from({ length: STARS * 2 }, (_, k) => k % 2), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -7), 30);
    return g;
  }, []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const c = clock.current;
    if (c.start < 0) c.start = t;
    if (launch && c.launchAt < 0) c.launchAt = t;
    if (!launch) c.launchAt = -1; // back on the home page after a launch: the scene is whole again
    const age = t - c.start;
    const p = c.launchAt < 0 ? 0 : Math.min(1, (t - c.launchAt) / LAUNCH_S);
    const dive = smooth(p) * p;

    // Intro: the beam draws in, the prism assembles, then the rays and their cargo spread out.
    const beamIn = smooth(age / 0.9);
    const raysOut = smooth((age - 0.7) / 1.1);
    const speed = 0.4 + 80 * dive;
    c.travel += speed * dt;

    U.time.value = t;
    U.revealIn.value = beamIn * 1.08;
    U.gainIn.value = 1 + dive * 2;
    U.revealOut.value = raysOut * 1.08;
    U.gainOut.value = 0.9 + dive * 3;
    U.glow.value = dive * 2.5 + 0.08 * Math.sin(t * 2);
    U.px.value = state.gl.getPixelRatio();
    U.sparkGain.value = raysOut * (1 - p * 0.5);
    U.travel.value = c.travel;
    U.len.value = 0.04 + speed * 0.04;
    U.floorTravel.value = c.travel * 0.25;
    U.glowAt.value.set(home.x, 0, home.z);

    if (rig.current) {
      rig.current.position.copy(home);
      rig.current.scale.setScalar(wide ? 1 : 0.8);
      rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, state.pointer.x * 0.25, 3, dt);
      rig.current.rotation.x = THREE.MathUtils.damp(rig.current.rotation.x, -state.pointer.y * 0.15, 3, dt);
    }
    if (prism.current) {
      prism.current.scale.setScalar(Math.max(0.001, backOut(smooth((age - 0.3) / 0.9))));
      prism.current.rotation.x = Math.sin(t * 0.5) * 0.28 + dive * 7;
      prism.current.rotation.y = -0.55 + Math.sin(t * 0.35) * 0.25;
    }
    core.current?.scale.setScalar((2.4 + Math.sin(t * 2) * 0.2) * beamIn + dive * 16);

    frames.current.forEach((m, i) => {
      const u = (t * 0.2 + i / FRAMES) % 1;
      const far = (1 - u) ** 1.5;
      m.position.set(THREE.MathUtils.lerp(-6.8, -0.7, u), Math.sin(i * 2.3) * 1.4 * far, Math.cos(i * 1.7) * 1.1 * far);
      m.rotation.set(0, 0.55 * far, Math.sin(i) * 0.12 * far);
      m.scale.setScalar(1 - u * 0.8);
      (m.material as THREE.MeshBasicMaterial).opacity = fade(u) * beamIn * (1 - p);
    });
    cards.current.forEach((m, k) => {
      const ray = RAYS[Math.floor(k / CARDS)];
      const u = (t * 0.15 + (k % CARDS) / CARDS + Math.floor(k / CARDS) * 0.13) % 1;
      const d = 0.9 + u * 5.5;
      m.position.set(R + Math.cos(ray.angle) * d, Math.sin(ray.angle) * d, u * 1.4);
      m.rotation.set(0, -0.4 + u * 0.25, Math.sin(t + k) * 0.04);
      m.scale.setScalar(0.4 + u * 0.7);
      (m.material as THREE.MeshBasicMaterial).opacity = fade(u, 0.2) * raysOut * (1 - p);
    });
    labels.current.forEach((m) => { (m.material as THREE.MeshBasicMaterial).opacity = smooth((age - 1.4) / 0.8) * (1 - p) * 0.95; });

    // The dive: the camera flies into the prism while the view widens.
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.position.set(home.x * dive, 0.7 + (home.y - 0.7) * dive, 7 - 6.3 * dive);
    cam.lookAt(home.x * dive, home.y * dive, home.z * dive);
    cam.fov = 40 + 55 * dive;
    cam.updateProjectionMatrix();
  });

  return (
    <>
      <lineSegments geometry={sky} material={mats.stars} frustumCulled={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.3, -8]} material={mats.floor}>
        <planeGeometry args={[60, 34]} />
      </mesh>
      <group ref={rig}>
        <mesh position={[-3.7, 0, 0]} material={mats.in}>
          <planeGeometry args={[6.3, 0.9]} />
        </mesh>
        {Array.from({ length: FRAMES }, (_, i) => (
          <mesh key={i} ref={(m) => { if (m) frames.current[i] = m; }}>
            <planeGeometry args={[0.8, 0.45]} />
            <meshBasicMaterial map={maps.frames[i % 3]} {...blend} />
          </mesh>
        ))}
        <points geometry={sparks} material={mats.sparks} frustumCulled={false} />
        <mesh ref={prism} geometry={prismGeometry} material={mats.prism}>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color="#e6e9ff" transparent opacity={0.55} toneMapped={false} />
          </lineSegments>
        </mesh>
        <sprite ref={core}>
          <spriteMaterial map={maps.glow} color={INK[light ? "light" : "dark"].glow} opacity={INK[light ? "light" : "dark"].glowAlpha} blending={INK[light ? "light" : "dark"].blending} {...blend} />
        </sprite>
        {/* inside the glass: the white light splits into the spectrum on its way from the entry face to the tip */}
        {RAYS.map(({ angle }, i) => {
          const from = new THREE.Vector2(-R / 2, 0);
          const to = new THREE.Vector2(R * 0.92, Math.sin(angle) * 0.18);
          const span = to.clone().sub(from);
          return (
            <mesh key={`fan${angle}`} material={mats.fan[i]} position={[(from.x + to.x) / 2, (from.y + to.y) / 2, 0.02]} rotation={[0, 0, span.angle()]}>
              <planeGeometry args={[span.length(), 0.5]} />
            </mesh>
          );
        })}
        <group position={[R, 0, 0]}>
          {RAYS.map(({ angle }, i) => (
            <group key={angle} rotation={[0, 0, angle]}>
              <mesh position={[3.6, 0, 0]} material={mats.rays[i]}>
                <planeGeometry args={[7.2, 1]} />
              </mesh>
              <mesh ref={(m) => { if (m) labels.current[i] = m; }} position={angle === 0 ? [1.5, -0.2, 0.05] : [1.05, angle > 0 ? 0.24 : -0.24, 0.05]}>
                <planeGeometry args={[1.2, 0.234]} />
                <meshBasicMaterial map={maps.labels[i]} {...blend} />
              </mesh>
            </group>
          ))}
        </group>
        {RAYS.flatMap((_, r) => Array.from({ length: CARDS }, (_, j) => (
          <mesh key={`${r}-${j}`} ref={(m) => { if (m) cards.current[r * CARDS + j] = m; }}>
            <planeGeometry args={[0.96, 0.54]} />
            <meshBasicMaterial map={maps.cards[r]} {...blend} />
          </mesh>
        )))}
      </group>
    </>
  );
}

export default function HeroScene({ active, launch, light }: { active: boolean; launch: boolean; light: boolean }) {
  return (
    // Bloom's full-screen high-precision buffers cost 60 fps at Retina density on an M2 (22 ms a frame); at 1.25x it
    // holds 16.7 ms, and the glow softens edges anyway. The light theme has no bloom and stays sharp at 1.75x.
    <Canvas flat frameloop={active || launch ? "always" : "never"} dpr={light ? [1, 1.75] : [1, 1.25]} camera={{ position: [0, 0.7, 7], fov: 40 }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance", outputBufferType: THREE.HalfFloatType }}
      // Development only: lets the performance check read draw calls and frame cost from the page.
      onCreated={({ gl }) => { if (process.env.NODE_ENV === "development") Object.assign(window, { __vidmindGl: gl }); }}>
      <Scene launch={launch} light={light} />
    </Canvas>
  );
}
