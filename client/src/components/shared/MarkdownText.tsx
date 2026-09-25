/**
 * NOT WIRED UP IN TT.
 *
 * Upstream uses this to render a clamped one-line Markdown caption inside a
 * tappable list row, links stripped so the anchor cannot eat the tap. TT's
 * surfaces that show a description or note already render Markdown directly
 * through `JournalBody` (react-markdown + remark-gfm + remark-breaks) or
 * `markdownLinkComponents`, and the row variants use `stripMarkdown` for their
 * one-line previews — so adopting this would be a third way to do the same
 * thing rather than a consolidation. It is kept for the next surface that wants
 * a clamped caption; delete this note when one does.
 */
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { markdownLinkComponents } from './markdownLink';

/**
 * A clamped caption lives inside a tappable row, so an anchor there would eat
 * the tap that opens the row. The link text stays, the anchor goes.
 */
const clampedComponents: Components = {
  a: ({ children }) => <>{children}</>,
};

/**
 * A description or note, rendered (#2337). The field is Markdown wherever it is
 * written — the editors ship a formatting bar — so printing it raw anywhere
 * shows `# headings` and `**asterisks**` to the reader.
 *
 * `clamp` is the list-row variant: one line high, matching what the desktop
 * sidebar rows do with the same field. The height cap is inline because the row
 * itself sets a font size, and a Tailwind `leading-*` would race with it.
 */
export default function MarkdownText({
  children,
  className = '',
  clamp = false,
}: {
  children: string;
  className?: string;
  clamp?: boolean;
}) {
  return (
    <div
      className={`collab-note-md ${clamp ? 'truncate' : ''}${className}`}
      style={clamp ? { maxHeight: '1.2em', lineHeight: 1.2 } : undefined}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={clamp ? clampedComponents : markdownLinkComponents}
      >
        {children}
      </Markdown>
    </div>
  );
}
