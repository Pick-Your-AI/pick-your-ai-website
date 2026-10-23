import { useEffect, useRef, useState } from 'react';
import { renderStack } from '../lib/ascii-stack';

// Art-direction dials. Rendering is capped independently inside renderStack.
const ART = { columns: 96, rows: 68, rotation: 0.62, spread: 1, fps: 12, speed: 0.085 };
const STILL = renderStack(ART);

export function AsciiStack() {
  const output = useRef<HTMLPreElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const angle = useRef(ART.rotation);
  const [paused, setPaused] = useState(false);
  const [compact, setCompact] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const node = output.current;
    const region = stage.current;
    if (!node || !region) return;
    let visible = true;
    let timer = 0;
    let last = 0;
    let rotation = angle.current;
    const draw = () => {
      angle.current = rotation;
      node.textContent = renderStack({ ...ART, rotation, spread: compact ? 0 : ART.spread });
    };
    draw();
    if (paused || reducedMotion) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    observer.observe(region);
    const tick = (time: number) => {
      if (time - last >= 1000 / ART.fps) {
        if (visible && !document.hidden) {
          rotation += (Math.min(time - last, 150) / 1000) * ART.speed;
          draw();
        }
        last = time;
      }
      timer = requestAnimationFrame(tick);
    };
    timer = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(timer);
      observer.disconnect();
    };
  }, [paused, compact, reducedMotion]);

  return (
    <figure className="ascii-figure">
      <div className="ascii-figure-top" aria-hidden="true">
        <span>FIG. 01 / A SYSTEM IN PARTS</span>
        <span>[ X · Y · Z ]</span>
      </div>
      <div className="ascii-stage" ref={stage}>
        <span className="ascii-cross ascii-cross-tl" aria-hidden="true">
          +
        </span>
        <span className="ascii-cross ascii-cross-br" aria-hidden="true">
          +
        </span>
        <pre className="ascii-art" ref={output} aria-hidden="true">
          {STILL}
        </pre>
      </div>
      <figcaption className="ascii-caption">
        <span>
          Seven tiers.
          <br />
          <strong>One connected stack.</strong>
        </span>
        <div className="ascii-controls">
          <button
            type="button"
            onClick={() => setCompact((value) => !value)}
            aria-pressed={compact}
          >
            {compact ? '[ + ] Explode' : '[ − ] Assemble'}
          </button>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused || reducedMotion}
            disabled={reducedMotion}
          >
            {reducedMotion
              ? 'Still / reduced motion'
              : paused
                ? 'Resume animation'
                : 'Pause animation'}
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
