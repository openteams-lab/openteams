import { useEffect, useRef } from 'react';
import { Command, X } from 'lucide-react';
import {
  useCommandHandler,
  useShortcuts,
} from '@/shortcuts/ShortcutProvider';

type CommandPaletteHintCardProps = {
  t: (
    key: string,
    replacements?: Record<string, string | number>,
  ) => string;
  onDismiss: () => void;
};

export function CommandPaletteHintCard({
  t,
  onDismiss,
}: CommandPaletteHintCardProps) {
  const { paletteOpen, presentationFor, runtime, setPaletteOpen } = useShortcuts();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const palettePresentation = presentationFor('commandPalette.open');
  const helpPresentation = presentationFor('shortcuts.help.open');
  const shortcutTokens = (palettePresentation.sequence[0] ?? '')
    .split('+')
    .filter(Boolean);
  const keyLabels = (shortcutTokens.length > 0 ? shortcutTokens : ['?']).map(
    (token) => {
      if (runtime.platform === 'macos') {
        if (token === 'meta') return '⌘';
        if (token === 'ctrl') return '⌃';
        if (token === 'alt') return '⌥';
        if (token === 'shift') return '⇧';
      }
      if (token === 'meta') return 'Meta';
      if (token === 'ctrl') return 'Ctrl';
      if (token === 'alt') return 'Alt';
      if (token === 'shift') return 'Shift';
      return token.toUpperCase();
    },
  );

  useCommandHandler('commandPalette.open', {
    scope: 'modal-menu',
    contexts: ['global'],
    enabled: true,
    execute: () => undefined,
  });

  useEffect(() => {
    queueMicrotask(() => openButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (paletteOpen) onDismiss();
  }, [onDismiss, paletteOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const openPalette = () => {
    onDismiss();
    setPaletteOpen(true);
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px] animate-fade-in"
      role="presentation"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        aria-label={t('onboarding.commandPaletteHint.dismiss')}
        onClick={onDismiss}
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="command-palette-hint-title"
        aria-describedby="command-palette-hint-description"
        className="relative w-full max-w-[460px] overflow-hidden rounded-[12px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_28px_90px_rgba(0,0,0,0.34)] animate-fade-in-up"
      >
        <button
          type="button"
          className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          aria-label={t('onboarding.commandPaletteHint.dismiss')}
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>

        <div className="px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-tertiary)]">
            <span className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)]">
              <Command aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
            </span>
            {t('onboarding.commandPaletteHint.eyebrow')}
          </div>

          <h2
            id="command-palette-hint-title"
            className="max-w-[340px] text-[19px] font-semibold leading-[1.25] tracking-[-0.015em]"
          >
            {t('onboarding.commandPaletteHint.title')}
          </h2>
          <p
            id="command-palette-hint-description"
            className="mt-2.5 max-w-[390px] text-[13px] leading-[1.6] text-[var(--ink-subtle)]"
          >
            {t('onboarding.commandPaletteHint.description', {
              shortcut: palettePresentation.label,
              helpShortcut: helpPresentation.label,
            })}
          </p>

          <div className="mt-5 overflow-hidden rounded-[9px] border border-[var(--hairline)] bg-[var(--surface-2)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--ink)_3%,transparent)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 480 210"
              className="block h-auto w-full text-[var(--ink-tertiary)]"
            >
              <defs>
                <pattern
                  id="command-hint-grid"
                  width="16"
                  height="16"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M16 0H0v16"
                    fill="none"
                    stroke="var(--hairline)"
                    strokeWidth="0.65"
                    opacity="0.55"
                  />
                </pattern>
                <linearGradient
                  id="command-hint-glow"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0" stopColor="var(--primary)" stopOpacity="0.18" />
                  <stop offset="0.52" stopColor="var(--primary)" stopOpacity="0.035" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
                <clipPath id="command-hint-console-clip">
                  <rect x="214" y="32" width="236" height="146" rx="10" />
                </clipPath>
              </defs>
              <rect width="480" height="210" fill="var(--surface-2)" />
              <rect width="480" height="210" fill="url(#command-hint-grid)" />
              <ellipse
                cx="260"
                cy="102"
                rx="205"
                ry="104"
                fill="url(#command-hint-glow)"
              />

              <g
                fill="var(--ink-tertiary)"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize="7"
                fontWeight="700"
                letterSpacing="1.15"
              >
                <text x="24" y="23">KEY CHORD // INPUT</text>
                <text x="374" y="23" fill="var(--primary)">READY_</text>
              </g>
              <circle
                className="command-palette-hint-status"
                cx="363"
                cy="20.5"
                r="3"
                fill="var(--primary)"
              />

              <g opacity="0.48" stroke="var(--hairline-strong)" fill="none">
                <path d="M24 39h126l12 12h23" />
                <path d="M24 179h102l10-10h52" />
                <path d="M400 188h51" />
              </g>

              <g>
                <rect
                  x="23"
                  y="59"
                  width="166"
                  height="91"
                  rx="10"
                  fill="var(--surface-1)"
                  stroke="var(--hairline-strong)"
                />
                <path
                  d="M33 72h38"
                  stroke="var(--hairline-strong)"
                  strokeLinecap="round"
                />
                <text
                  x="33"
                  y="139"
                  fill="var(--ink-tertiary)"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize="6.5"
                  fontWeight="600"
                  letterSpacing="0.8"
                >
                  HOLD TO EXECUTE
                </text>
                {keyLabels.slice(0, 4).map((label, index) => {
                  const keyWidth = keyLabels.length === 1 ? 78 : 38;
                  const gap = 7;
                  const totalWidth =
                    Math.min(keyLabels.length, 4) * keyWidth +
                    (Math.min(keyLabels.length, 4) - 1) * gap;
                  const x = 106 - totalWidth / 2 + index * (keyWidth + gap);
                  return (
                    <g
                      key={`${label}-${index}`}
                      className="command-palette-hint-key"
                      style={{ animationDelay: `${index * 110}ms` }}
                    >
                      <rect
                        x={x}
                        y="88"
                        width={keyWidth}
                        height="34"
                        rx="6"
                        fill="color-mix(in srgb, var(--ink) 4%, var(--surface-3))"
                        stroke="var(--hairline-strong)"
                      />
                      <path
                        d={`M${x + 7} 116h${keyWidth - 14}`}
                        stroke="var(--hairline)"
                        strokeLinecap="round"
                      />
                      <text
                        x={x + keyWidth / 2}
                        y="109"
                        textAnchor="middle"
                        fill="var(--ink)"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontSize={label.length > 4 ? 7.5 : 10}
                        fontWeight="700"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>

              <path
                className="command-palette-hint-trace"
                d="M189 104h10c9 0 8-19 16-19h12"
                fill="none"
                stroke="var(--primary)"
                strokeLinecap="round"
                strokeWidth="1.6"
              />
              <circle
                className="command-palette-hint-packet"
                cx="0"
                cy="0"
                r="3.5"
                fill="var(--primary)"
              />

              <g clipPath="url(#command-hint-console-clip)">
                <rect
                  x="214"
                  y="32"
                  width="236"
                  height="146"
                  rx="10"
                  fill="var(--surface-1)"
                  stroke="var(--hairline-strong)"
                />
                <rect
                  x="214"
                  y="32"
                  width="236"
                  height="25"
                  fill="var(--surface-3)"
                />
                <path d="M214 57h236" stroke="var(--hairline)" />
                <circle cx="228" cy="44.5" r="2.5" fill="var(--ink-tertiary)" opacity="0.55" />
                <circle cx="237" cy="44.5" r="2.5" fill="var(--ink-tertiary)" opacity="0.32" />
                <circle cx="246" cy="44.5" r="2.5" fill="var(--ink-tertiary)" opacity="0.18" />
                <text
                  x="332"
                  y="47"
                  textAnchor="middle"
                  fill="var(--ink-tertiary)"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize="6.5"
                  fontWeight="600"
                  letterSpacing="0.9"
                >
                  COMMAND // PALETTE
                </text>

                <rect
                  x="226"
                  y="67"
                  width="212"
                  height="27"
                  rx="6"
                  fill="var(--surface-2)"
                  stroke="var(--hairline)"
                />
                <path
                  d="m237 77.5 4 3.5-4 3.5"
                  fill="none"
                  stroke="var(--primary)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <text
                  x="249"
                  y="84"
                  fill="var(--ink)"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize="7.5"
                  fontWeight="600"
                >
                  command.palette
                </text>
                <rect
                  className="command-palette-hint-caret"
                  x="319"
                  y="76.5"
                  width="1.5"
                  height="10"
                  rx="0.75"
                  fill="var(--primary)"
                />

                {[0, 1, 2].map((row) => (
                  <g
                    key={row}
                    className="command-palette-hint-result"
                    style={{ animationDelay: `${420 + row * 120}ms` }}
                  >
                    {row === 0 && (
                      <rect
                        x="226"
                        y="102"
                        width="212"
                        height="20"
                        rx="5"
                        fill="var(--primary-tint)"
                        stroke="color-mix(in srgb, var(--primary) 20%, transparent)"
                      />
                    )}
                    <rect
                      x="236"
                      y={109 + row * 23}
                      width={row === 0 ? 68 : 52 + row * 15}
                      height="3.5"
                      rx="1.75"
                      fill={row === 0 ? 'var(--primary)' : 'var(--ink-tertiary)'}
                      opacity={row === 0 ? 0.78 : 0.28}
                    />
                    <rect
                      x="393"
                      y={107 + row * 23}
                      width="34"
                      height="8"
                      rx="3"
                      fill="var(--surface-3)"
                      stroke="var(--hairline)"
                    />
                  </g>
                ))}

                <rect
                  className="command-palette-hint-scan"
                  x="215"
                  y="57"
                  width="234"
                  height="1"
                  fill="var(--primary)"
                  opacity="0.35"
                />
              </g>

              <g
                fill="var(--ink-tertiary)"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize="6.5"
                fontWeight="600"
                letterSpacing="0.7"
              >
                <text x="24" y="194">01 / CAPTURE</text>
                <text x="126" y="194">02 / RESOLVE</text>
                <text x="237" y="194" fill="var(--primary)">03 / EXECUTE</text>
              </g>
              {[103, 215, 327].map((x, index) => (
                <g key={x}>
                  <path
                    d={`M${x - 20} 188h13`}
                    stroke={index === 2 ? 'var(--primary)' : 'var(--hairline-strong)'}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={x}
                    cy="188"
                    r="2.25"
                    fill={index === 2 ? 'var(--primary)' : 'var(--ink-tertiary)'}
                    opacity={index === 2 ? 1 : 0.45}
                  />
                </g>
              ))}
            </svg>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] bg-[var(--surface-2)] px-6 py-4 sm:px-7">
          <button
            type="button"
            className="h-8 rounded-[7px] px-2 text-[12px] font-medium text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            onClick={onDismiss}
          >
            {t('onboarding.commandPaletteHint.later')}
          </button>
          <button
            ref={openButtonRef}
            type="button"
            aria-keyshortcuts={palettePresentation.ariaKeyShortcuts || undefined}
            className="inline-flex h-9 items-center gap-2.5 rounded-[7px] border border-[var(--primary)] bg-[var(--primary)] px-3.5 text-[12px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            onClick={openPalette}
          >
            {t('onboarding.commandPaletteHint.open')}
            <kbd className="rounded-[4px] border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/90">
              {palettePresentation.label}
            </kbd>
          </button>
        </footer>
      </section>
    </div>
  );
}
