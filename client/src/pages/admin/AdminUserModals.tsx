import { AlertTriangle, ArrowUpCircle, Eye, EyeOff, Fingerprint, RefreshCw } from 'lucide-react';
import React from 'react';
import { adminApi } from '../../api/client';
import CustomSelect from '../../components/shared/CustomSelect';
import Modal from '../../components/shared/Modal';
import type { TranslationFn } from '../../types';
import type { UpdatePreparation } from './adminModel';
import type { useAdmin } from './useAdmin';

interface AdminUserModalsProps {
  admin: ReturnType<typeof useAdmin>;
  t: TranslationFn;
}

// The admin page's modal layer: create-user, edit-user, the "how to update"
// popup and the rotate-JWT confirmation. Pure layout around the useAdmin hook.
export default function AdminUserModals({ admin, t }: AdminUserModalsProps): React.ReactElement {
  const {
    logout,
    navigate,
    toast,
    editingUser,
    setEditingUser,
    editForm,
    setEditForm,
    showCreateUser,
    setShowCreateUser,
    createForm,
    setCreateForm,
    updateInfo,
    showUpdateModal,
    setShowUpdateModal,
    showRotateJwtModal,
    setShowRotateJwtModal,
    rotatingJwt,
    setRotatingJwt,
    handleCreateUser,
    handleSaveUser,
  } = admin;
  const [showCreatePw, setShowCreatePw] = React.useState(false);
  // The prepared update: null until asked for, so opening the dialog costs
  // nothing and no backup is written until the operator asks for one.
  const [prep, setPrep] = React.useState<UpdatePreparation | null>(null);
  const [prepBusy, setPrepBusy] = React.useState(false);
  const [prepError, setPrepError] = React.useState(false);
  const [copiedStep, setCopiedStep] = React.useState<number | null>(null);

  const runPrep = async (): Promise<void> => {
    setPrepBusy(true);
    setPrepError(false);
    try {
      setPrep(await adminApi.prepareUpdate());
    } catch {
      setPrepError(true);
    } finally {
      setPrepBusy(false);
    }
  };

  const copyStep = (index: number, command: string): void => {
    // Clipboard access can be refused (insecure origin, denied permission); the
    // command is on screen either way, so a failure needs no alarm.
    void navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopiedStep(index);
        window.setTimeout(() => setCopiedStep(null), 2000);
      })
      .catch(() => {});
  };
  const [showEditPw, setShowEditPw] = React.useState(false);

  return (
    <>
      {/* Create user modal */}
      <Modal
        isOpen={showCreateUser}
        onClose={() => setShowCreateUser(false)}
        title={t('admin.createUser')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreateUser(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreateUser}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
            >
              {t('admin.createUser')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.username')} *</label>
            <input
              type="text"
              value={createForm.username}
              onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
              placeholder={t('settings.username')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('common.email')} *</label>
            <input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              placeholder={t('common.email')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('common.password')} *</label>
            <div className="relative">
              <input
                type={showCreatePw ? 'text' : 'password'}
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={t('common.password')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowCreatePw((v) => !v)}
                tabIndex={-1}
                aria-label="Show or hide password"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                {showCreatePw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.role')}</label>
            <CustomSelect
              value={createForm.role}
              onChange={(value) => setCreateForm((f) => ({ ...f, role: String(value) }))}
              options={[
                { value: 'user', label: t('settings.roleUser') },
                { value: 'admin', label: t('settings.roleAdmin') },
              ]}
            />
          </div>
        </div>
      </Modal>

      {/* Edit user modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={t('admin.editUser')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveUser}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
            >
              {t('common.save')}
            </button>
          </div>
        }
      >
        {editingUser && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.username')}</label>
              <input
                type="text"
                value={editForm.username}
                onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('common.email')}</label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {t('admin.newPassword')}{' '}
                <span className="font-normal text-slate-400">({t('admin.newPasswordHint')})</span>
              </label>
              <div className="relative">
                <input
                  type={showEditPw ? 'text' : 'password'}
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={t('admin.newPasswordPlaceholder')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPw((v) => !v)}
                  tabIndex={-1}
                  aria-label="Show or hide password"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                >
                  {showEditPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.role')}</label>
              <CustomSelect
                value={editForm.role}
                onChange={(value) => setEditForm((f) => ({ ...f, role: String(value) }))}
                options={[
                  { value: 'user', label: t('settings.roleUser') },
                  { value: 'admin', label: t('settings.roleAdmin') },
                ]}
              />
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs text-slate-400">{t('admin.passkey.resetHint')}</p>
              <button
                type="button"
                onClick={async () => {
                  if (!editingUser) return;
                  if (!confirm(t('admin.passkey.resetConfirm', { name: editingUser.username }))) return;
                  try {
                    const r = await adminApi.resetUserPasskeys(editingUser.id);
                    toast.success(t('admin.passkey.resetDone', { count: r.deleted ?? 0 }));
                  } catch {
                    toast.error(t('common.error'));
                  }
                }}
                className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Fingerprint size={14} /> {t('admin.passkey.reset')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Update instructions popup */}
      {showUpdateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          role="presentation"
          onClick={() => setShowUpdateModal(false)}
        >
          <div
            role="presentation"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, borderRadius: 16, overflow: 'hidden' }}
            className="border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          >
            <div
              style={{
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                className="bg-[rgba(255,255,255,0.2)]"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ArrowUpCircle size={20} className="text-white" />
              </div>
              <div>
                <h3
                  className="text-white"
                  style={{ margin: 0, fontSize: 'calc(16px * var(--fs-scale-subtitle, 1))', fontWeight: 700 }}
                >
                  {t('admin.update.howTo')}
                </h3>
                <p
                  className="text-[rgba(255,255,255,0.8)]"
                  style={{ margin: '2px 0 0', fontSize: 'calc(12px * var(--fs-scale-body, 1))' }}
                >
                  v{updateInfo?.current} → v{updateInfo?.latest}
                </p>
              </div>
            </div>

            <div style={{ padding: '20px 24px' }}>
              {/* Prepare first, then hand over the command.
                  Nothing here performs the update: this process runs without the
                  privileges that would need, so the last step belongs to whoever
                  holds the server. */}
              {!prep && (
                <>
                  <p
                    className="text-gray-700 dark:text-gray-300"
                    style={{ fontSize: 'calc(13px * var(--fs-scale-body, 1))', lineHeight: 1.6, margin: 0 }}
                  >
                    {t('admin.update.prepareIntro')}
                  </p>
                  {prepError && (
                    <p className="text-red-600 dark:text-red-400" style={{ marginTop: 10, fontSize: 13 }} role="alert">
                      {t('admin.update.prepareError')}
                    </p>
                  )}
                </>
              )}

              {prep?.ready && (
                <>
                  <p
                    className="text-gray-700 dark:text-gray-300"
                    style={{ fontSize: 'calc(13px * var(--fs-scale-body, 1))', lineHeight: 1.6, margin: 0 }}
                  >
                    {t(`admin.update.deploy.${prep.deployment_reason ?? 'publishedImage'}`)}
                  </p>

                  {/* Whether a backup was actually written is stated plainly:
                      a failure here must not read as "backed up". */}
                  <div
                    style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 12 }}
                    className={
                      prep.backup?.created
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                    }
                    role={prep.backup?.created ? undefined : 'alert'}
                  >
                    {prep.backup?.created
                      ? t('admin.update.backupDone').replace('{filename}', prep.backup.filename ?? '')
                      : t('admin.update.backupFailed').replace('{error}', prep.backup?.error ?? '')}
                  </div>

                  <h4 style={{ marginTop: 18, marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                    {t('admin.update.stepsTitle')}
                  </h4>
                  <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(prep.steps ?? []).map((step, i) => (
                      <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                        <div className="text-gray-700 dark:text-gray-300" style={{ fontWeight: 600 }}>
                          {t(step.labelKey)}
                        </div>
                        {step.command && (
                          <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginTop: 6 }}>
                            <code
                              style={{
                                flex: 1,
                                padding: '8px 10px',
                                borderRadius: 8,
                                fontFamily: 'monospace',
                                fontSize: 12,
                                wordBreak: 'break-all',
                              }}
                              className="border border-gray-700 bg-gray-900 text-gray-100 dark:bg-gray-950"
                            >
                              {step.command}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyStep(i, step.command!)}
                              aria-label={t('admin.update.copy')}
                              className="border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                              style={{ padding: '0 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
                            >
                              {copiedStep === i ? t('admin.update.copied') : t('admin.update.copy')}
                            </button>
                          </div>
                        )}
                        {step.noteKey && (
                          <div className="text-gray-500 dark:text-gray-400" style={{ marginTop: 4, fontSize: 11.5 }}>
                            {t(step.noteKey)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>

                  <h4 style={{ marginTop: 18, marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                    {t('admin.update.afterTitle')}
                  </h4>
                  <p
                    className="text-gray-700 dark:text-gray-300"
                    style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}
                  >
                    {t('admin.update.afterText')}
                  </p>

                  {prep.release_url && (
                    <a
                      href={prep.release_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400"
                      style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 600 }}
                    >
                      {t('admin.update.releaseNotes')}
                    </a>
                  )}
                </>
              )}
            </div>

            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {!prep?.ready && (
                <button
                  type="button"
                  onClick={() => void runPrep()}
                  disabled={prepBusy}
                  className="bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-200"
                  style={{
                    padding: '9px 20px',
                    borderRadius: 10,
                    fontSize: 'calc(13px * var(--fs-scale-body, 1))',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {prepBusy ? t('admin.update.preparing') : t('admin.update.prepareRun')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowUpdateModal(false)}
                className="bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-200"
                style={{
                  padding: '9px 20px',
                  borderRadius: 10,
                  fontSize: 'calc(13px * var(--fs-scale-body, 1))',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate JWT Secret confirmation modal */}
      <Modal
        isOpen={showRotateJwtModal}
        onClose={() => setShowRotateJwtModal(false)}
        title="Rotate JWT Secret"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowRotateJwtModal(false)}
              disabled={rotatingJwt}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                setRotatingJwt(true);
                try {
                  await adminApi.rotateJwtSecret();
                  setShowRotateJwtModal(false);
                  logout();
                  navigate('/login', { state: { noRedirect: true } });
                } catch {
                  toast.error(t('common.error'));
                  setRotatingJwt(false);
                }
              }}
              disabled={rotatingJwt}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:bg-red-300"
            >
              {rotatingJwt ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Rotate &amp; Log out
            </button>
          </div>
        }
      >
        <div className="flex gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-900">
              Warning, this will invalidate all sessions and log you out.
            </p>
            <p className="text-xs text-slate-500">
              A new JWT secret will be generated immediately. Every logged-in user — including you — will be signed out
              and will need to log in again.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
