import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Cinematic post-processing and the procedural textures / materials that give
 * nodes their "energy artifact" read. Everything here is presentation-only —
 * no runtime meaning is encoded, it is the film grade laid over the scene.
 */

/**
 * Full-frame cinematic grade applied after bloom: edge-weighted chromatic
 * aberration (anamorphic lens fringing), a soft vignette that pulls the eye
 * to frame centre, faint rolling scanlines, and animated film grain. Kept
 * deliberately subtle — it should read as "shot on a lens", never as a filter.
 */
export function createCinematicPass(): ShaderPass {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAberration: { value: 0.55 },
      uVignette: { value: 1.05 },
      uGrain: { value: 0.05 },
      uScanline: { value: 0.035 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uAberration;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uScanline;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 uv = vUv;
        vec2 center = uv - 0.5;
        float d2 = dot(center, center);

        // Chromatic aberration: channels splay apart toward the frame edge.
        vec2 offset = center * uAberration * d2;
        float r = texture2D(tDiffuse, uv + offset).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - offset).b;
        vec3 color = vec3(r, g, b);

        // Vignette — quadratic falloff, gentle so cores stay dominant.
        color *= clamp(1.0 - d2 * uVignette, 0.0, 1.0);

        // Rolling scanlines: very low amplitude, slow vertical crawl.
        float scan = sin((uv.y + uTime * 0.02) * 1600.0) * 0.5 + 0.5;
        color *= 1.0 - uScanline * scan;

        // Animated film grain, luminance-only so it doesn't tint.
        float grain = hash(uv * 1024.0 + fract(uTime) * 640.0) - 0.5;
        color += grain * uGrain;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  return pass;
}

/**
 * Soft radial-gradient sprite, the workhorse texture for glows, halos,
 * nebulae, particles, and packets.
 */
export function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Anamorphic star flare: a bright core with a long horizontal streak and a
 * shorter vertical one — the signature "capital ship / bright star" lens
 * artifact from Interstellar / Blade Runner. Worn by high-reputation nodes.
 */
export function makeStarFlareTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;

  // Central soft glow.
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.16);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";

  // Horizontal streak (the anamorphic one — long and bright).
  const hStreak = ctx.createLinearGradient(0, c, size, c);
  hStreak.addColorStop(0, "rgba(120,190,255,0)");
  hStreak.addColorStop(0.5, "rgba(180,220,255,0.9)");
  hStreak.addColorStop(1, "rgba(120,190,255,0)");
  ctx.fillStyle = hStreak;
  ctx.fillRect(0, c - 2, size, 4);
  ctx.fillStyle = "rgba(200,230,255,0.35)";
  ctx.fillRect(0, c - 6, size, 12);

  // Vertical streak (shorter, fainter).
  const vStreak = ctx.createLinearGradient(c, size * 0.18, c, size * 0.82);
  vStreak.addColorStop(0, "rgba(160,200,255,0)");
  vStreak.addColorStop(0.5, "rgba(200,225,255,0.7)");
  vStreak.addColorStop(1, "rgba(160,200,255,0)");
  ctx.fillStyle = vStreak;
  ctx.fillRect(c - 2, size * 0.18, 4, size * 0.64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Additive fresnel "energy skin": transparent everywhere it faces the camera,
 * blazing at the silhouette. Layered just outside the physical shell it turns
 * a solid artifact into a glowing hologram. `uIntensity` is driven per frame
 * from live activity / selection.
 */
export function createRimMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: 2.6 },
      uIntensity: { value: 0.4 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float fresnel = pow(1.0 - max(dot(vNormal, vView), 0.0), uPower);
        float a = fresnel * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Live escape-time Mandelbrot rendered onto a node's shell. Worn only by the
 * Fractal Oracle: the fragment shader iterates z=z²+c per pixel over a slowly
 * panning/zooming window, colours by escape time (bounded/in-set points glow
 * gold — the "robust islands"), and modulates brightness by the agent's live
 * activity. Additive so it reads as an internal fractal glow, not a texture.
 */
export function createFractalMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.5 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vPos;
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      void main() {
        // The explored window breathes around the seahorse valley (uTime,
        // pure animation for continuity) but its depth and drift target are
        // pulled by uActivity, the real live swarm-activity field (SSE via
        // OmokodaGraphEngine, see GalaxyScene.ts). Idle/bounded swarms settle
        // shallow near the gold in-set islands; active/chaotic swarms zoom
        // deeper into denser escape-time detail -- the fractal's explored
        // region is no longer a self-contained local computation.
        float depth = mix(1.9, 0.85, uActivity);
        float zoom = depth + 0.35 * sin(uTime * 0.05);
        vec2 restCenter = vec2(-0.75, 0.11);
        vec2 activeCenter = vec2(-0.745, 0.113);
        vec2 driftCenter = mix(restCenter, activeCenter, uActivity);
        vec2 center = driftCenter + vec2(0.14 * sin(uTime * 0.03), 0.11 * cos(uTime * 0.045)) * mix(1.0, 0.4, uActivity);
        vec2 c = center + vPos.xy * zoom;
        vec2 z = vec2(0.0);
        const int MAX = 72;
        int it = MAX;
        for (int i = 0; i < MAX; i++) {
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          if (dot(z, z) > 4.0) { it = i; break; }
        }
        bool bounded = dot(z, z) <= 4.0;
        float t = float(it) / float(MAX);
        // Smooth escape-time band → accent gradient; in-set points blaze gold.
        vec3 col = mix(uColorA, uColorB, pow(t, 0.6));
        if (bounded) col = uColorB * 1.5;
        float glow = (0.22 + 0.78 * uActivity) * (bounded ? 1.0 : 0.25 + 0.75 * t);
        gl_FragColor = vec4(col * glow, glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Inside-out gradient sphere that sits behind everything: a not-quite-black
 * void with a faint warm-cool vertical wash, so the frame reads as deep space
 * with atmosphere rather than a flat black card. Rendered on the back faces
 * with depthWrite off so it never occludes the swarm.
 */
export function createVoidBackdrop(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x0a0720) },
      uBottom: { value: new THREE.Color(0x04060f) },
      uGlow: { value: new THREE.Color(0x1b2a5c) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uGlow;
      varying vec3 vDir;
      void main() {
        float h = vDir.y * 0.5 + 0.5;
        vec3 base = mix(uBottom, uTop, h);
        // Faint central nebular brightening toward the -Z horizon.
        float glow = pow(max(-vDir.z, 0.0), 3.0) * 0.5;
        gl_FragColor = vec4(base + uGlow * glow, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 24), material);
  return mesh;
}
