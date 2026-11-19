// Decorative facets behind the login card. The geometry is generated from a
// fixed seed rather than Math.random(), so the server and the client render
// byte-identical SVG and React does not report a hydration mismatch.

const COLS = 8;
const ROWS = 9;
const VIEW_W = 640;
const VIEW_H = 700;

/** Small deterministic PRNG (mulberry32), so the pattern is the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Facet = {
  points: string;
  fillOpacity: string;
  shimmer: boolean;
  duration: string;
  delay: string;
};

function buildFacets(): Facet[] {
  const rand = seeded(21);
  const cw = VIEW_W / (COLS - 1.4);
  const ch = VIEW_H / (ROWS - 1.4);

  // Jitter each grid vertex so the triangles are irregular rather than a
  // regular lattice. Generated row by row, in the same order as the original.
  const pts: [number, number][][] = [];
  for (let j = 0; j <= ROWS; j++) {
    pts[j] = [];
    for (let i = 0; i <= COLS; i++) {
      pts[j][i] = [
        (i - 0.3) * cw + (rand() - 0.5) * cw * 0.45,
        (j - 0.3) * ch + (rand() - 0.5) * ch * 0.45,
      ];
    }
  }

  const facets: Facet[] = [];
  const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
    const points = [a, b, c]
      .map((q) => `${q[0].toFixed(0)},${q[1].toFixed(0)}`)
      .join(" ");
    // Draw order matters: every rand() call advances the same sequence, so
    // fill opacity is read before the shimmer roll, exactly as in the original.
    const fillOpacity = (0.02 + rand() * 0.2).toFixed(2);
    const shimmer = rand() > 0.86;
    facets.push({
      points,
      fillOpacity,
      shimmer,
      duration: `${(4 + rand() * 4).toFixed(1)}s`,
      delay: `${(rand() * 4).toFixed(1)}s`,
    });
  };

  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = pts[j][i];
      const b = pts[j][i + 1];
      const c = pts[j + 1][i];
      const d = pts[j + 1][i + 1];
      tri(a, b, c);
      tri(b, d, c);
    }
  }
  return facets;
}

// Computed once at module load: the output is constant for a constant seed.
const FACETS = buildFacets();

export function LowPolyBackground() {
  return (
    <div className="login-bg" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMinYMid slice"
      >
        {FACETS.map((f, i) => (
          <polygon
            key={i}
            points={f.points}
            fill="currentColor"
            fillOpacity={f.fillOpacity}
            stroke="currentColor"
            strokeOpacity={0.16}
            strokeWidth={1}
            className={f.shimmer ? "shimmer" : undefined}
            style={
              f.shimmer
                ? ({
                    "--d": f.duration,
                    animationDelay: f.delay,
                  } as React.CSSProperties)
                : undefined
            }
          />
        ))}
      </svg>
    </div>
  );
}

/** The brand gear, drawn as a toothed path rather than shipped as an asset. */
function gearPath(cx: number, cy: number, ro: number, ri: number, n: number) {
  const step = (2 * Math.PI) / n;
  const d: string[] = [];
  const pt = (r: number, t: number) =>
    `${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const t = i * step;
    d.push(
      pt(ri, t),
      pt(ro, t + 0.18 * step),
      pt(ro, t + 0.44 * step),
      pt(ri, t + 0.62 * step),
    );
  }
  return `M${d.join("L")}Z`;
}

const GEAR_D = gearPath(20, 20, 17, 13, 8);

export function BrandGear() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="brand-gear">
      <path d={GEAR_D} />
      <circle cx="20" cy="20" r="5" />
    </svg>
  );
}
