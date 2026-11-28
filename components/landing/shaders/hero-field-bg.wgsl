struct FieldParams {
  width: f32,
  height: f32,
  fx: f32,
  fy: f32,
  spread: f32,
  time: f32,
  pulseAge: f32,
  pulseStrength: f32,
}

@group(0) @binding(0) var<uniform> params: FieldParams;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = uv.x * params.width;
  let py = uv.y * params.height;
  let fx = params.fx;
  let fy = params.fy;

  var col = vec3f(0.0431, 0.0431, 0.0392); // #0b0b0a

  // Left convergence funnel region (x <= fx)
  if (px <= fx) {
    let x0 = -0.14 * params.width;
    let cx = 0.18 * params.width;
    let a = x0 - 2.0 * cx + fx;
    let b = 2.0 * (cx - x0);
    let c = x0 - px;
    var t: f32;
    if (abs(a) < 0.001) {
      t = clamp(-c / max(b, 0.001), 0.0, 1.0);
    } else {
      let disc = max(b * b - 4.0 * a * c, 0.0);
      t = clamp((-b + sqrt(disc)) / (2.0 * a), 0.0, 1.0);
    }

    let inv = 1.0 - t;
    let yScale = inv * inv + 1.8 * inv * t;
    let halfSpan = 0.5 * params.spread * yScale;
    let relY = py - fy;

    if (abs(relY) <= halfSpan + 2.0 && halfSpan > 0.5) {
      let wedgeAlpha = 0.052 * (1.0 - clamp(px / max(fx, 1.0), 0.0, 1.0));
      col += vec3f(wedgeAlpha);

      let normStrand = (relY / max(halfSpan, 0.5)) * 0.5 + 0.5;
      let strandIdx = normStrand * 149.0;
      let distToStrand = abs(fract(strandIdx + 0.5) - 0.5);
      let pxPerStrand = max((2.0 * halfSpan) / 149.0, 0.65);
      let lineDistPx = distToStrand * pxPerStrand;
      let lineAA = 1.0 - smoothstep(0.0, 1.15, lineDistPx);
      let centerWeight = 0.16 - 0.10 * abs(normStrand * 2.0 - 1.0);
      let focusFade = smoothstep(0.0, 28.0, fx - px);
      col += vec3f(1.0) * (lineAA * centerWeight * focusFade);
    }
  }

  // Right horizontal output laser spine (x >= fx)
  if (px >= fx - 1.0) {
    let distY = abs(py - fy);
    let spineCore = 1.0 - smoothstep(0.0, 1.25, distY);
    let spineHalo = exp(-distY * 0.25) * 0.14;
    let rx = clamp((px - fx) / max(params.width - fx, 1.0), 0.0, 1.0);
    let spineAlpha = mix(0.85, 0.10, pow(max(rx, 0.0001), 0.75));
    col += vec3f(1.0) * (spineCore * spineAlpha) + vec3f(0.29, 0.69, 1.0) * (spineHalo * spineAlpha);
  }

  // Central convergence radial glow at (fx, fy)
  let dFocus = length(vec2f(px - fx, py - fy));
  if (dFocus < 110.0) {
    let g = clamp(1.0 - dFocus / 95.0, 0.0, 1.0);
    let g2 = g * g;
    col += vec3f(1.0) * (0.16 * g2) + vec3f(0.29, 0.69, 1.0) * (0.12 * g);
  }

  // Expanding surge ripple ring at (fx, fy)
  if (params.pulseStrength > 0.01 && params.pulseAge < 1.0) {
    let ringR = 6.0 + params.pulseAge * 38.0;
    let ringDist = abs(dFocus - ringR);
    let ringAA = 1.0 - smoothstep(0.0, 1.6, ringDist);
    let ringAlpha = 0.42 * (1.0 - params.pulseAge) * params.pulseStrength;
    col += vec3f(0.29, 0.69, 1.0) * (ringAA * ringAlpha);
  }

  return vec4f(col, 1.0);
}
