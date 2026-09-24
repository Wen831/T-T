import type { CSSProperties, ReactNode } from 'react';
import MDancingTT, { type TTMood, type TTScene } from '../../mobile/components/MDancingTT';

/**
 * TT 项目的空状态组件 - 使用 TT 吉祥物展示各种场景
 *
 * 吉祥物采用扁平化、现代化的设计风格，与 TT logo 保持一致。
 * 支持多种场景和心情状态，提供友好的用户反馈。
 *
 * `layout="row"` 将吉祥物放在标题旁边，适用于窄小面板。
 */
export default function EmptyState({
  scene = 'idle',
  mood,
  title,
  size = 104,
  surface = 'var(--bg-card)',
  layout = 'stack',
  compact = false,
  fill = false,
  className = '',
  action,
}: {
  scene?: TTScene;
  mood?: TTMood;
  title: string;
  size?: number;
  surface?: string;
  layout?: 'stack' | 'row';
  /**
   * Quieter type for a state inside a narrow column rather than on a page.
   *
   * The sidebar's empty state sits under its own controls, so a line at the page size
   * competes with them for the eye; at the caption tier it reads as what it is, a note
   * about why the list below is blank.
   */
  compact?: boolean;
  /**
   * Fill the parent and sit in the middle of it.
   *
   * The stack already centres what it contains, but with no height of its own
   * `justify-center` has nothing to centre inside, so the state lands under
   * whatever sits above it. A state that stands for a whole empty column wants
   * the middle of that column; one that sits inline in a page does not, which is
   * why this is a choice rather than the default. The parent has to be the one
   * with the height, which every scroll container here already is.
   */
  fill?: boolean;
  className?: string;
  /** Optional call to action under the title, for states that have an obvious next step. */
  action?: ReactNode;
}) {
  const layoutClasses =
    layout === 'row'
      ? 'flex flex-row items-center justify-center gap-3 px-6 py-3'
      : `flex flex-col items-center justify-center gap-3 px-6 text-center ${fill ? 'min-h-full pt-4 pb-14' : 'py-12'}`;
  return (
    <div
      className={`${layoutClasses} ${className}`}
      style={{ '--m-ink': 'var(--text-primary)', '--m-bg': surface } as CSSProperties}
    >
      <MDancingTT scene={scene} mood={mood} size={size} />
      <p className={compact ? 'text-caption text-content-muted' : 'text-[15px] font-semibold text-content-secondary'}>{title}</p>
      {action}
    </div>
  );
}
