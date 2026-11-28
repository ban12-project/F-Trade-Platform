struct RenderParams {
  width: f32,
  height: f32,
  dpr: f32,
  pad: f32,
  accentColor: vec4f,
}

struct Particle {
  pos: vec2f,
  tail: vec2f,
  ctrl: vec2f,
  state: f32,
  prog: f32,
  pInfo: vec4f,
  seed: vec4f,
}

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) localUv: vec2f,
  @location(1) color: vec4f,
  @location(2) mode: f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32
) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let q = corners[vi];
  let p = particles[ii];

  var out: VertexOut;
  if (p.pos.x < -1000.0 || p.state > 4.5) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.localUv = vec2f(0.0);
    out.color = vec4f(0.0);
    out.mode = 0.0;
    return out;
  }

  let isEdge = p.pInfo.x > 0.5;
  let tintTier = p.pInfo.y;
  let baseRgb = select(vec3f(1.0, 1.0, 1.0), params.accentColor.rgb, tintTier > 0.5);

  var alpha = 0.85;
  var radiusPx = 1.2;
  var mode = 0.0;

  if (p.state < 0.5) {
    let baseA = select(0.42, 0.90, isEdge);
    alpha = select(baseA, min(1.0, baseA * 1.3), tintTier > 0.5);
    radiusPx = select(1.15, 1.45, isEdge || tintTier > 1.5);
    if (tintTier > 1.5) {
      radiusPx = 4.4;
      mode = 2.0;
    }
  } else if (p.state < 1.5) {
    alpha = 0.5 + 0.5 * p.prog;
    radiusPx = 1.4;
    mode = 1.0;
  } else if (p.state < 2.5) {
    alpha = 0.72 * min(p.prog / 0.03, 1.0) * min((1.02 - p.prog) / 0.1, 1.0);
    radiusPx = 1.35;
    mode = 1.0;
  } else if (p.state < 3.5) {
    let invP = 1.0 - max(0.0, p.prog);
    let eased = 1.0 - invP * invP * invP;
    alpha = 0.25 + eased * select(0.17, 0.65, isEdge);
    radiusPx = 1.3;
    mode = 1.0;
  } else {
    // Background HeroField funnel streamers with varied sizes & organic fade
    let fadeEnd = select(1.0, (1.0 - p.prog) / 0.14, p.prog > 0.86);
    let fadeIn = min(p.prog / 0.06, 1.0);
    alpha = (0.25 + 0.7 * p.seed.z) * fadeEnd * fadeIn;
    radiusPx = 0.95 + 0.75 * p.pInfo.w;
    mode = 1.0;
  }

  let seg = p.pos - p.tail;
  let segLen = length(seg);
  var screenPos: vec2f;

  if (mode > 0.5 && mode < 1.5 && segLen > 1.5) {
    let dir = seg / segLen;
    let normal = vec2f(-dir.y, dir.x);
    let along = mix(-radiusPx, segLen + radiusPx, q.x);
    screenPos = p.tail + dir * along + normal * (q.y * radiusPx * 1.25);
  } else {
    let local = vec2f(q.x * 2.0 - 1.0, q.y);
    screenPos = p.pos + local * radiusPx;
  }

  let clipX = (screenPos.x / max(params.width, 1.0)) * 2.0 - 1.0;
  let clipY = 1.0 - (screenPos.y / max(params.height, 1.0)) * 2.0;

  out.position = vec4f(clipX, clipY, 0.0, 1.0);
  out.localUv = q;
  out.color = vec4f(baseRgb, clamp(alpha, 0.0, 1.0));
  out.mode = mode;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (in.color.a <= 0.002) {
    discard;
  }

  if (in.mode > 1.5) {
    let p = vec2f(in.localUv.x * 2.0 - 1.0, in.localUv.y);
    let d = length(p);
    if (d > 1.0) { discard; }
    let core = 1.0 - smoothstep(0.22, 0.38, d);
    let halo = (1.0 - d * d) * 0.22;
    let a = clamp((core + halo) * in.color.a, 0.0, 1.0);
    return vec4f(in.color.rgb * a, a);
  }

  if (in.mode > 0.5) {
    let along = clamp(in.localUv.x, 0.0, 1.0);
    let across = abs(in.localUv.y);
    let lineMask = (1.0 - smoothstep(0.15, 1.0, across)) * pow(max(along, 0.0001), 1.4) * 0.65;
    let headDist = length(vec2f((along - 0.94) * 10.0, in.localUv.y));
    let headMask = 1.0 - smoothstep(0.2, 1.0, headDist);
    let a = clamp(max(lineMask, headMask) * in.color.a, 0.0, 1.0);
    return vec4f(in.color.rgb * a, a);
  }

  let p = vec2f(in.localUv.x * 2.0 - 1.0, in.localUv.y);
  let d = length(p);
  if (d > 1.0) { discard; }
  let aa = 1.0 - smoothstep(0.45, 1.0, d);
  let a = aa * in.color.a;
  return vec4f(in.color.rgb * a, a);
}
