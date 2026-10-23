import { useEffect, useRef, useState } from 'react';
import { renderStack } from '../lib/ascii-stack';

// Art-direction dials. Rendering is capped independently inside renderStack.
const ART = { columns: 96, rows: 68, rotation: 0.62, spread: 1, fps: 12, speed: 0.085 };

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
    let visible = false;
    let timer: number | undefined;
    let last = 0;
    const draw = () => {
      node.textContent = renderStack({
        ...ART,
        rotation: angle.current,
        spread: compact ? 0 : ART.spread,
      });
    };
    draw();
    if (paused || reducedMotion) return;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      if (!visible || document.hidden) {
        stop();
      } else if (timer === undefined) {
        last = performance.now();
        timer = window.setInterval(() => {
          const now = performance.now();
          angle.current += (Math.min(now - last, 150) / 1000) * ART.speed;
          last = now;
          draw();
        }, 1000 / ART.fps);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(region);
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
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
        <pre className="ascii-art" ref={output} aria-hidden="true" />
      </div>
      <figcaption className="ascii-caption">
        <span>
          Seven tiers.
          <br />
          <strong>Seven-layer study.</strong>
        </span>
        <div className="ascii-controls">
          <button type="button" onClick={() => setCompact((value) => !value)}>
            {compact ? '[ + ] Explode' : '[ − ] Assemble'}
          </button>
          {reducedMotion ? (
            <span>Still / reduced motion</span>
          ) : (
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? 'Resume animation' : 'Pause animation'}
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
