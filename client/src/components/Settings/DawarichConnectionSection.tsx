import type { LucideIcon } from 'lucide-react';
import { Check, Copy, KeyRound, Plug, RefreshCw, Save, Unplug } from 'lucide-react';
import React from 'react';
import { useDawarichConnection } from '../../hooks/useDawarichConnection';
import { useTranslation } from '../../i18n';
import { useAddonStore } from '../../store/addonStore';
import { copyText } from '../../utils/clipboard';
import DawarichIcon from '../shared/DawarichIcon';
import Section from './Section';
import ToggleSwitch from './ToggleSwitch';

/**
 * Settings → Integrations → Dawarich.
 *
 * All of the behaviour is in `useDawarichConnection`, shared with the phone
 * twin; this file is markup. The layout follows the AirTrail and LLM sections
 * so the three read as one shelf, but the classes are the semantic tokens
 * rather than the raw `slate-*` those two still carry — a new surface has to
 * follow the user's accent and colour scheme.
 *
 * The status block below the fields is the part that earns its space: a
 * connection to somebody else's server fails in ways they can act on — a wrong
 * key, a certificate, an instance that is simply off — and "not connected" with
 * no reason is the version of this card that generates support questions.
 *
 * The card opens with the source choice, because everything below it depends on
 * the answer: an external instance wants an address and a key, the builtin
 * engine wants an ingest token for the phone instead — and shows none of the
 * fields that do not apply.
 */
/**
 * Renders Dawarich's own mark through the `LucideIcon` shape Section expects.
 * The cast is the seam: Section's prop is typed for line glyphs that take
 * lucide's props, and this is a brand image that takes `size`/`className`.
 */
const DawarichSectionIcon: LucideIcon = ((props: { size?: number; className?: string }) => (
  <DawarichIcon size={props.size ?? 18} className={props.className} />
)) as unknown as LucideIcon;

export default function DawarichConnectionSection(): React.ReactElement {
  const { t, locale } = useTranslation();
  const S = useDawarichConnection();

  return (
    <Section
      title={t('dawarich.title')}
      // Section takes a lucide icon and renders it as `<Icon />`. Dawarich's own
      // mark is a brand image rather than a line glyph, so it is adapted here
      // instead of widening the shared Section type for one caller.
      icon={DawarichSectionIcon}
    >
      <div className="space-y-3">
        <p className="text-caption text-content-secondary">{t('dawarich.intro')}</p>

        <div>
          <p className="mb-1.5 text-caption font-medium text-content-secondary">{t('dawarich.source.label')}</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('dawarich.source.label')}>
            <SourceOption
              selected={S.source !== 'builtin'}
              onSelect={() => S.setSource('external')}
              title={t('dawarich.source.external')}
              hint={t('dawarich.source.externalHint')}
            />
            <SourceOption
              selected={S.source === 'builtin'}
              onSelect={() => S.setSource('builtin')}
              title={t('dawarich.source.builtin')}
              hint={t('dawarich.source.builtinHint')}
            />
          </div>
        </div>

        {S.source === 'builtin' ? (
          <FootprintIngestCard state={S} />
        ) : (
          <>
            <div>
              <label htmlFor="dawarich-url" className="mb-1.5 block text-caption font-medium text-content-secondary">
                {t('dawarich.url')}
              </label>
              <input
                id="dawarich-url"
                type="url"
                value={S.url}
                onChange={(e) => S.setUrl(e.target.value)}
                placeholder="https://dawarich.example.com"
                className="w-full rounded-lg border border-edge bg-surface-input px-3 py-2.5 text-body text-content ring-accent focus:outline-none focus:ring-2"
              />
            </div>

            <div>
              <label htmlFor="dawarich-key" className="mb-1.5 block text-caption font-medium text-content-secondary">
                {t('dawarich.apiKey')}
              </label>
              <input
                id="dawarich-key"
                type="password"
                value={S.apiKey}
                onChange={(e) => S.setApiKey(e.target.value)}
                autoComplete="off"
                placeholder={S.connected && !S.apiKey ? '••••••••' : t('dawarich.apiKeyPlaceholder')}
                className="w-full rounded-lg border border-edge bg-surface-input px-3 py-2.5 text-body text-content ring-accent focus:outline-none focus:ring-2"
              />
              <p className="mt-1 text-caption text-content-muted">{t('dawarich.apiKeyHint')}</p>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <ToggleSwitch
                  on={S.allowInsecureTls}
                  onToggle={S.toggleInsecureTls}
                  label={t('dawarich.allowInsecureTls')}
                />
                <span className="text-body font-medium text-content-secondary">{t('dawarich.allowInsecureTls')}</span>
              </div>
              <p className="mt-1 text-caption text-content-muted">{t('dawarich.allowInsecureTlsHint')}</p>
            </div>
          </>
        )}

        <div>
          <div className="flex items-center gap-3">
            <ToggleSwitch on={S.syncEnabled} onToggle={S.toggleSync} label={t('dawarich.syncEnabled')} />
            <span className="text-body font-medium text-content-secondary">{t('dawarich.syncEnabled')}</span>
          </div>
          <p className="mt-1 text-caption text-content-muted">{t('dawarich.syncEnabledHint')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={S.save}
            disabled={S.saving || S.loading || !S.canSave}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {t('common.save')}
          </button>

          <button
            type="button"
            onClick={S.test}
            disabled={S.testing || S.loading || !S.canTest}
            className="flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-body text-content-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            {S.testing ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-transparent" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            {t('dawarich.test.button')}
          </button>

          {S.connected && (
            <button
              type="button"
              onClick={S.syncNow}
              disabled={S.syncing}
              className="flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-body text-content-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${S.syncing ? 'animate-spin' : ''}`} />
              {t('dawarich.syncNow')}
            </button>
          )}

          <span className="flex basis-full items-center gap-1.5 text-caption font-medium sm:basis-auto">
            <span className={`h-2 w-2 rounded-full ${S.connected ? 'bg-success' : 'bg-surface-tertiary'}`} />
            <span className={S.connected ? 'text-success' : 'text-content-muted'}>
              {S.connected ? t('dawarich.connected') : t('dawarich.notConnected')}
            </span>
          </span>

          {S.connected && (
            <button
              type="button"
              onClick={S.disconnect}
              disabled={S.saving}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              <Unplug className="h-3.5 w-3.5" /> {t('dawarich.disconnect')}
            </button>
          )}
        </div>

        <DawarichConnectionStatus state={S} locale={locale} />
      </div>
    </Section>
  );
}

/**
 * One half of the source choice — a selectable card, the same shape the map's
 * base-layer picker uses: the whole card is the hit target, selection is the
 * accent ring, and the hint says what choosing it will ask of you.
 */
function SourceOption({
  selected,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent-soft ring-1 ring-accent'
          : 'border-edge bg-surface-input hover:bg-surface-hover'
      }`}
    >
      <span className={`block text-body font-medium ${selected ? 'text-content' : 'text-content-secondary'}`}>
        {title}
      </span>
      <span className="mt-0.5 block text-caption text-content-muted">{hint}</span>
    </button>
  );
}

/**
 * The builtin credential: what the archive holds, the token a phone reports
 * with, and the address it reports to. The token itself is shown exactly once
 * per mint — the server stores only its hash — so the copy affordance sits
 * directly under the fresh value and the card keeps saying so.
 */
function FootprintIngestCard({ state }: { state: ReturnType<typeof useDawarichConnection> }): React.ReactElement {
  const { t, locale } = useTranslation();
  const addonEnabled = useAddonStore((s) => s.isEnabled);
  const footprintAddonOn = addonEnabled('footprint');
  const [copied, setCopied] = React.useState(false);

  const status = state.footprintStatus;
  const token = status?.token;

  const copyFresh = async () => {
    if (!state.freshIngestToken) return;
    await copyText(state.freshIngestToken);
    setCopied(true);
  };

  return (
    <div className="space-y-3 rounded-lg border border-edge bg-surface-secondary p-3">
      {!footprintAddonOn && <p className="text-caption text-warning">{t('dawarich.footprint.addonHint')}</p>}

      <p className="text-caption text-content-secondary">
        {status && status.pointCount > 0
          ? t('dawarich.footprint.points', { count: status.pointCount })
          : t('dawarich.footprint.empty')}
        {status?.latestPointAt &&
          ' · ' + t('dawarich.footprint.latest', { when: new Date(status.latestPointAt * 1000).toLocaleString(locale) })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={state.mintIngestToken}
          disabled={state.minting}
          className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-body text-content-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          <KeyRound className="h-4 w-4" />
          {token?.configured ? t('dawarich.footprint.rotate') : t('dawarich.footprint.mint')}
        </button>

        {token?.configured && (
          <span className="text-caption text-content-muted">
            {t('dawarich.footprint.tokenPrefix', { prefix: token.tokenPrefix ?? '' })}
            {token.lastUsedAt
              ? ' · ' + t('dawarich.footprint.tokenLastUsed', { when: new Date(token.lastUsedAt).toLocaleString(locale) })
              : token.createdAt
                ? ' · ' + t('dawarich.footprint.tokenNeverUsed')
                : ''}
          </span>
        )}
      </div>

      {state.freshIngestToken && (
        <div className="space-y-1.5 rounded-lg border border-accent bg-surface-input p-3">
          <code className="block break-all text-caption text-content select-all">{state.freshIngestToken}</code>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyFresh}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-caption text-content-secondary hover:bg-surface-hover"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('dawarich.footprint.copied') : t('dawarich.footprint.copy')}
            </button>
            <span className="text-caption text-content-muted">{t('dawarich.footprint.fresh')}</span>
          </div>
        </div>
      )}

      <p className="text-caption text-content-muted">{t('dawarich.footprint.ingestUrl')}</p>
      <code className="block break-all rounded-lg border border-edge bg-surface-input px-3 py-2 text-caption text-content">
        {ingestUrl()}
      </code>
    </div>
  );
}

/** The address a phone tracker posts to, derived from where this page was served from. */
function ingestUrl(): string {
  return `${window.location.origin}/api/v1/points/ingest`;
}

/**
 * Where the connection stands, in the place where it helps someone decide what
 * to do next: what the last sync did, and which parts of their instance TREK
 * could actually reach.
 *
 * Its own component because the phone twin renders the same three facts in a
 * different frame, and because it is the bit that keeps growing.
 */
function DawarichConnectionStatus({
  state,
  locale,
}: {
  state: ReturnType<typeof useDawarichConnection>;
  locale: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!state.connected && !state.probeMessage) return null;

  const missing: string[] = [];
  if (state.capabilities) {
    if (!state.capabilities.visits) missing.push(t('dawarich.capability.visits'));
    if (!state.capabilities.tracks && !state.capabilities.points) missing.push(t('dawarich.capability.track'));
    if (!state.capabilities.locations) missing.push(t('dawarich.capability.locations'));
    if (!state.capabilities.visitedCities) missing.push(t('dawarich.capability.visitedCities'));
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-edge bg-surface-secondary p-3">
      {state.probeMessage && <p className="text-caption text-content">{state.probeMessage}</p>}

      {state.connected && (
        <p className="text-caption text-content-secondary">
          {state.lastSyncAt
            ? t('dawarich.lastSync', { when: new Date(state.lastSyncAt).toLocaleString(locale) })
            : t('dawarich.neverSynced')}
          {state.lastSyncState === 'partial' && ` · ${t('dawarich.syncPartial')}`}
        </p>
      )}

      {state.lastSyncError && <p className="text-caption text-danger">{state.lastSyncError}</p>}

      {state.capabilities?.serverVersion && (
        <p className="text-caption text-content-muted">
          {t('dawarich.serverVersion', { version: state.capabilities.serverVersion })}
        </p>
      )}

      {missing.length > 0 && (
        <p className="text-caption text-content-muted">
          {t('dawarich.capability.missing', { features: missing.join(', ') })}
        </p>
      )}
    </div>
  );
}
