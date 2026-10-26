// Pong the turtle — design reference for Claude Code (save as docs/design/Pong.tsx).
// One SVG, six moods. The head slides in and out of the shell with a CSS transition.

import type { CSSProperties } from 'react';

export type PongMood = 'sleep' | 'peek' | 'ask' | 'listen' | 'happy' | 'snooze';

type Props = {
  mood?: PongMood;
  size?: number;
  flower?: boolean;
};

const COLORS = {
  shell: '#5E9E6E',
  plate: '#7DB88A',
  rim: '#3F7350',
  skin: '#A9D69B',
  skinDark: '#8CBF7E',
  muzzle: '#BEE2B1',
  ink: '#22301F',
  cheek: '#F09A8A',
  flower: '#F5B83D',
  flowerCenter: '#E09A1E',
  teal: '#2F7F7A',
};

// Head position per mood, in SVG user units (viewBox 0 0 120 120).
const HEAD: Record<PongMood, string> = {
  sleep: 'translate(-34px, 8px)',
  snooze: 'translate(-13px, 5px)',
  peek: 'translate(-10px, 4px)',
  ask: 'translate(2px, -4px)',
  listen: 'translate(0px, -2px) rotate(-9deg)',
  happy: 'translate(0px, -3px)',
};

const LABEL: Record<PongMood, string> = {
  sleep: 'Pong napping in his shell',
  peek: 'Pong peeking out of his shell',
  ask: 'Pong asking what you are up to',
  listen: 'Pong listening',
  happy: 'Pong happy',
  snooze: 'Pong drowsy',
};

const fade: CSSProperties = { transition: 'opacity .2s ease' };

export default function Pong({ mood = 'sleep', size = 160, flower = true }: Props) {
  const on = (...moods: PongMood[]) => (moods.includes(mood) ? 1 : 0);

  const headStyle: CSSProperties = {
    transform: HEAD[mood],
    transformOrigin: '98px 60px',
    transformBox: 'view-box',
    transition: 'transform .45s cubic-bezier(.3, 1.45, .5, 1)',
  };

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={LABEL[mood]}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* tail and feet */}
      <ellipse cx="9" cy="90" rx="7" ry="3.6" fill={COLORS.skinDark} transform="rotate(-25 9 90)" />
      <ellipse cx="24" cy="97" rx="10" ry="6.5" fill={COLORS.skinDark} />
      <ellipse cx="74" cy="97" rx="10" ry="6.5" fill={COLORS.skinDark} />

      {/* head + neck: drawn before the shell so it tucks behind it */}
      <g style={headStyle}>
        <path d="M68 88 C74 78 82 71 90 68 L101 77 C93 83 85 89 79 96 Z" fill={COLORS.skin} />
        <circle cx="98" cy="60" r="18" fill={COLORS.skin} />
        <ellipse cx="98" cy="68" rx="11" ry="6.5" fill={COLORS.muzzle} />

        {/* open eyes */}
        <g opacity={on('peek', 'ask', 'listen')} style={fade}>
          <ellipse cx="91" cy="57" rx="3.6" ry="4.4" fill={COLORS.ink} />
          <ellipse cx="105" cy="57" rx="3.6" ry="4.4" fill={COLORS.ink} />
          <circle cx="92.2" cy="55.4" r="1.3" fill="#FFFFFF" />
          <circle cx="106.2" cy="55.4" r="1.3" fill="#FFFFFF" />
        </g>
        {/* closed eyes */}
        <g opacity={on('sleep')} style={fade} stroke={COLORS.ink} strokeWidth="2.3" fill="none" strokeLinecap="round">
          <path d="M87 57 Q91 61 95 57" />
          <path d="M101 57 Q105 61 109 57" />
        </g>
        {/* happy eyes */}
        <g opacity={on('happy')} style={fade} stroke={COLORS.ink} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M87 59 Q91 53 95 59" />
          <path d="M101 59 Q105 53 109 59" />
        </g>
        {/* drowsy eyes */}
        <g opacity={on('snooze')} style={fade}>
          <ellipse cx="91" cy="58.5" rx="3.6" ry="1.9" fill={COLORS.ink} />
          <ellipse cx="105" cy="58.5" rx="3.6" ry="1.9" fill={COLORS.ink} />
          <path d="M86.5 56.6 H95.5 M100.5 56.6 H109.5" stroke="#6E9E62" strokeWidth="2.3" strokeLinecap="round" />
        </g>

        <ellipse cx="85.5" cy="65" rx="5" ry="3.2" fill={COLORS.cheek} opacity="0.6" />
        <ellipse cx="110.5" cy="65" rx="5" ry="3.2" fill={COLORS.cheek} opacity="0.6" />

        {/* mouth: smile, or open while asking */}
        <path
          d="M94 68 Q98 72.5 102 68"
          stroke={COLORS.ink}
          strokeWidth="2.1"
          fill="none"
          strokeLinecap="round"
          opacity={on('sleep', 'peek', 'listen', 'happy', 'snooze')}
          style={fade}
        />
        <ellipse cx="98" cy="69.5" rx="3.6" ry="3" fill="#4A2A24" opacity={on('ask')} style={fade} />
      </g>

      {/* shell */}
      <path d="M6 90 C6 58 27 40 50 40 C73 40 94 58 94 90 Z" fill={COLORS.shell} />
      <ellipse cx="50" cy="63" rx="15" ry="12" fill={COLORS.plate} />
      <ellipse cx="24" cy="79" rx="9" ry="8" fill={COLORS.plate} />
      <ellipse cx="76" cy="79" rx="9" ry="8" fill={COLORS.plate} />
      <ellipse cx="50" cy="84" rx="8" ry="4.5" fill={COLORS.plate} />
      <path d="M20 62 C24 53 32 47 40 45" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.35" />
      <rect x="2" y="86" width="96" height="10" rx="5" fill={COLORS.rim} />

      {/* flower on the shell */}
      {flower && (
        <g>
          <circle cx="50" cy="31" r="3.4" fill={COLORS.flower} />
          <circle cx="54.8" cy="34.5" r="3.4" fill={COLORS.flower} />
          <circle cx="53" cy="40" r="3.4" fill={COLORS.flower} />
          <circle cx="47" cy="40" r="3.4" fill={COLORS.flower} />
          <circle cx="45.2" cy="34.5" r="3.4" fill={COLORS.flower} />
          <circle cx="50" cy="36" r="2.6" fill={COLORS.flowerCenter} />
        </g>
      )}

      {/* extras */}
      <g opacity={on('sleep', 'snooze')} style={fade} fill={COLORS.teal} fontFamily="Fredoka, Nunito, sans-serif" fontWeight={700}>
        <text x="66" y="32" fontSize="13">z</text>
        <text x="77" y="21" fontSize="9">z</text>
      </g>
      <g opacity={on('happy')} style={fade} fill={COLORS.flower}>
        <path d="M12 30 L14.6 36.4 L21 39 L14.6 41.6 L12 48 L9.4 41.6 L3 39 L9.4 36.4 Z" />
        <path d="M78 22 L80 26.8 L84.8 28.8 L80 30.8 L78 35.6 L76 30.8 L71.2 28.8 L76 26.8 Z" />
        <path d="M114 26 L115.2 29 L118.2 30.2 L115.2 31.4 L114 34.4 L112.8 31.4 L109.8 30.2 L112.8 29 Z" />
      </g>
      <g opacity={on('peek', 'ask')} style={fade} stroke={COLORS.flowerCenter} strokeWidth="3" strokeLinecap="round">
        <path d="M110 38 L115 31" />
        <path d="M116 46 L121 44" />
        <path d="M86 36 L82 29" />
      </g>
      <g opacity={on('listen')} style={fade} fill={COLORS.teal}>
        <circle cx="104" cy="34" r="2.5" />
        <circle cx="111" cy="29" r="2.5" />
        <circle cx="118" cy="24" r="2.5" />
      </g>
    </svg>
  );
}
