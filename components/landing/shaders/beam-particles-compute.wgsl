struct SimParams {
  width: f32,
  height: f32,
  fx: f32,
  fy: f32,
  markX: f32,
  markY: f32,
  markR: f32,
  spread: f32,
  dt: f32,
  time: f32,
  pointerX: f32,
  pointerY: f32,
  pointerInMark: f32,
  autoSweep: f32,
  logoCount: f32,
  totalCount: f32,
  accentColor: vec4f,
  switchPhase: f32,   // 0=normal hold/hover, 1=drain out to right edge, 2=gather new logo from left
  switchElapsed: f32,
  pad1: f32,
  pad2: f32,
}

// 64 bytes per particle
// state: 0=rest in logo, 1=bezier to focus, 2=right laser shot offscreen, 3=gather from left funnel into logo, 4=funnel streamer, 5=parked offscreen
struct Particle {
  pos: vec2f,
  tail: vec2f,
  ctrl: vec2f,
  state: f32,
  prog: f32,
  pInfo: vec4f, // x=isEdge, y=tintTier, z=cooldown, w=speedMul
  seed: vec4f,  // x=rand1, y=rand2, z=spreadY/alpha, w=strandIdx
}

struct LogoTarget {
  data: vec4f,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> targets: array<LogoTarget>;

fn hash11(p: f32) -> f32 {
  let x = sin(p * 12.9898 + 78.233) * 43758.5453;
  return fract(x);
}

fn evalQuadBezier(p0: vec2f, c: vec2f, p2: vec2f, t: f32) -> vec2f {
  let inv = 1.0 - t;
  return inv * inv * p0 + 2.0 * inv * t * c + t * t * p2;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let total = u32(params.totalCount);
  if (idx >= total) {
    return;
  }

  var p = particles[idx];
  let dt = clamp(params.dt, 0.004, 0.05);
  let logoCount = u32(params.logoCount);

  // Dense, stochastic background HeroField funnel streamers (260 particles flowing left -> center)
  if (idx >= logoCount) {
    let speedBase = (0.0008 + 0.0036 * p.seed.x) * 60.0;
    var t = p.prog + speedBase * dt;
    if (t > 1.0) {
      t = fract(t) * 0.08;
      let salt = f32(idx) * 1.317 + params.time * 17.93;
      p.seed.x = hash11(salt + 1.1);
      p.seed.y = hash11(salt + 2.7);
      p.seed.z = 0.22 + 0.78 * hash11(salt + 4.3);
      p.seed.w = floor(hash11(salt + 6.9) * 150.0);
      p.pInfo.y = select(0.0, 1.0, hash11(salt + 9.1) < 0.28);
      p.pInfo.w = 0.75 + 0.9 * hash11(salt + 11.3);
    }
    p.prog = t;

    let strand = p.seed.w;
    let len = 0.025 + 0.115 * p.seed.y;
    let tTail = max(0.0, t - len);

    let jitterY = (p.seed.y - 0.5) * 4.5;
    let y0 = params.fy + (strand / 149.0 - 0.5) * params.spread + jitterY;
    let p0 = vec2f(-0.14 * params.width, y0);
    let ctrl = vec2f(0.18 * params.width, y0 + (params.fy - y0) * 0.1);
    let p2 = vec2f(params.fx, params.fy);

    p.pos = evalQuadBezier(p0, ctrl, p2, t);
    p.tail = evalQuadBezier(p0, ctrl, p2, tTail);
    p.state = 4.0;
    particles[idx] = p;
    return;
  }

  // Logo MarkStream particles
  let tgt = targets[idx].data;
  let home = vec2f(params.markX + tgt.x * params.markR, params.markY + tgt.y * params.markR);
  let focus = vec2f(params.fx, params.fy);
  // Left-side funnel entry origin matching the random background particles
  let leftStart = vec2f(
    -0.14 * params.width - p.seed.x * 140.0,
    params.fy + (p.seed.y - 0.5) * params.spread
  );
  p.pInfo.x = tgt.z;
  p.pInfo.y = tgt.w;

  // Phase 2 (Gather New Logo from Left): wake up offscreen particles to stream in from the LEFT like random funnel dots
  if (params.switchPhase > 1.5 && p.state > 4.5) {
    p.state = 3.0;
    p.prog = -(0.02 + 0.65 * p.seed.x) / 1.5;
    p.ctrl = vec2f(
      mix(leftStart.x, home.x, 0.52),
      mix(leftStart.y, home.y, 0.24) + p.seed.z * params.height * 0.045
    );
    p.pos = vec2f(-9999.0, -9999.0);
    p.tail = p.pos;
    particles[idx] = p;
    return;
  }

  // State 5: Parked offscreen while waiting for the rest of the old logo to drain out
  if (p.state > 4.5) {
    p.pos = vec2f(-9999.0, -9999.0);
    p.tail = p.pos;
    particles[idx] = p;
    return;
  }

  // Phase 1 (Drain Out): release resting logo particles smoothly toward the center outlet -> right edge
  if (params.switchPhase > 0.5 && params.switchPhase < 1.5 && p.state < 0.5) {
    let releaseAt = clamp((1.0 - (tgt.x * 0.5 + 0.5)) * 0.42 + p.seed.x * 0.34, 0.0, 0.75);
    if (params.switchElapsed >= releaseAt) {
      p.state = 1.0;
      p.prog = 0.0;
      p.ctrl = vec2f(
        home.x + (focus.x - home.x) * (0.45 + 0.2 * p.seed.x),
        home.y + (focus.y - home.y) * (0.1 + 0.2 * p.seed.y) + p.seed.z * params.height * 0.045
      );
      p.pos = home;
      p.tail = home;
      particles[idx] = p;
      return;
    }
  }

  // State 0: Resting crisply in the Logo (interactive mouse hover peel)
  if (p.state < 0.5) {
    if (p.pInfo.z > 0.0) {
      p.pInfo.z = max(0.0, p.pInfo.z - dt);
    }
    let radius = 0.30 * params.markR * select(1.0, 0.72, params.autoSweep > 0.5);
    let distPtr = length(vec2f(params.pointerX, params.pointerY) - home);
    let prob = select(0.095, 0.0055, params.autoSweep > 0.5);
    let rFrame = hash11(f32(idx) * 0.137 + params.time * 61.7);

    if (params.pointerInMark > 0.5 && p.pInfo.z <= 0.0 && distPtr < radius && rFrame < prob) {
      p.state = 1.0;
      p.prog = 0.0;
      p.ctrl = vec2f(
        home.x + (focus.x - home.x) * (0.45 + 0.2 * hash11(f32(idx) + params.time)),
        home.y + (focus.y - home.y) * (0.1 + 0.2 * hash11(f32(idx) * 2.1 + params.time)) + p.seed.z * params.height * 0.04
      );
      p.pos = home;
      p.tail = home;
    } else {
      p.pos = mix(p.pos, home, min(1.0, dt * 16.0));
      p.tail = p.pos;
    }
    particles[idx] = p;
    return;
  }

  // State 1: Smooth monotonic pull from Logo -> Focus Outlet (fx, fy)
  if (p.state < 1.5) {
    let g = p.prog;
    let drainMul = select(1.0, 1.25, params.switchPhase > 0.5 && params.switchPhase < 1.5);
    let nextG = min(1.0, g + dt * drainMul * (0.42 + 1.15 * g));
    p.prog = nextG;
    p.pos = evalQuadBezier(home, p.ctrl, focus, nextG);
    p.tail = evalQuadBezier(home, p.ctrl, focus, max(0.0, nextG - 0.055 - 0.04 * nextG));
    if (nextG >= 1.0) {
      p.state = 2.0;
      p.prog = 0.0;
    }
    particles[idx] = p;
    return;
  }

  // State 2: Continuous constant-momentum glide from Focus (fx, fy) -> off right edge
  if (p.state < 2.5) {
    let g = p.prog;
    let drainMul = select(1.0, 1.32, params.switchPhase > 0.5 && params.switchPhase < 1.5);
    let velocity = (0.72 + 0.28 * p.pInfo.w) * drainMul;
    let nextG = g + dt * velocity;
    p.prog = nextG;
    let spanR = max(params.width - params.fx, 1.0) + 48.0;
    let sx = params.fx + spanR * nextG;
    let sy = params.fy + p.seed.z * min(24.0 * nextG, 6.0);
    let tailG = max(0.0, nextG - 0.055);
    p.pos = vec2f(sx, sy);
    p.tail = vec2f(params.fx + spanR * tailG, params.fy + p.seed.z * min(24.0 * tailG, 6.0));
    if (nextG >= 1.0) {
      if (params.switchPhase > 0.5 && params.switchPhase < 1.5) {
        p.state = 5.0;
        p.prog = 0.0;
        p.pos = vec2f(-9999.0, -9999.0);
        p.tail = p.pos;
      } else {
        // Hover-peeled particle re-enters seamlessly from the LEFT funnel to refill the logo
        p.state = 3.0;
        p.prog = -(0.12 + 0.8 * p.seed.y) / 2.0;
        p.ctrl = vec2f(
          mix(leftStart.x, home.x, 0.52),
          mix(leftStart.y, home.y, 0.24) + p.seed.z * params.height * 0.045
        );
      }
    }
    particles[idx] = p;
    return;
  }

  // State 3: Always gathers in from the LEFT side like random background funnel particles coalescing into the Logo
  let nextG = min(1.0, p.prog + dt / 1.75);
  p.prog = nextG;
  if (nextG >= 0.0) {
    let inv1 = 1.0 - nextG;
    let eased = 1.0 - inv1 * inv1 * inv1;
    let inv2 = 1.0 - max(0.0, nextG - 0.045);
    let prevEased = 1.0 - inv2 * inv2 * inv2;
    p.pos = evalQuadBezier(leftStart, p.ctrl, home, eased);
    p.tail = evalQuadBezier(leftStart, p.ctrl, home, prevEased);
  } else {
    p.pos = vec2f(-9999.0, -9999.0);
    p.tail = p.pos;
  }
  if (nextG >= 1.0) {
    p.state = 0.0;
    p.prog = 0.0;
    p.pInfo.z = 1.0;
    p.pos = home;
    p.tail = home;
  }
  particles[idx] = p;
}
