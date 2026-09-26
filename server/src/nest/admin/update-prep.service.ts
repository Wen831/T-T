import { BackupService } from '../backup/backup.service';
import type { VersionInfo } from './admin.helpers';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Preparing an update, without performing one.
 *
 * This application cannot update itself, and that is a deliberate consequence of
 * how it is deployed rather than a gap: the container runs `read_only` with
 * `cap_drop: ALL` and no Docker socket, so the process inside it has no way to
 * pull an image or replace its own container — and giving it one would hand every
 * request path the ability to run privileged containers on the host.
 *
 * What the browser *can* usefully do is everything up to the command: confirm the
 * release is real, take a backup first, work out which deployment this is, and
 * hand back the exact line to paste. That is the difference this service makes.
 * The last step stays with the operator, on the host, where the authority already
 * is.
 *
 * Nothing here is destructive and nothing here runs a shell. It writes one backup
 * file and reads settings.
 */
@Injectable()
export class UpdatePrepService {
  private readonly logger = new Logger(UpdatePrepService.name);

  /**
   * Whether this process is inside a container, as an overridable seam.
   *
   * A field rather than a constructor parameter: Nest does not fill in default
   * values, so a second parameter would be one it insists on resolving, and
   * "is this a container" is not a provider. Tests assign it directly.
   */
  inContainer: () => boolean = isDockerInstance;

  constructor(private readonly backupService: BackupService) {}

  /**
   * How this instance was deployed, which decides what the update command is.
   *
   * `is_docker` comes from the same probe the version check already publishes, so
   * the browser and the server never disagree about which instructions apply.
   * `source_build` is the operator's own declaration (`SOURCE_BUILD` in the
   * compose file): an instance built from a checkout must be rebuilt from that
   * checkout, while one following the published image is pulled. Guessing from
   * the version string would be wrong exactly when it matters — a source build
   * reports whatever `APP_VERSION` was baked in, which looks like any other
   * version.
   */
  private deployment(): { kind: 'docker-image' | 'docker-source' | 'manual'; reasonKey: string } {
    if (!this.inContainer()) return { kind: 'manual', reasonKey: 'notDocker' };
    // The compose file sets SOURCE_BUILD for a checkout build; a published image
    // leaves it unset. Absent means "follow the image", which is the default.
    if (process.env.SOURCE_BUILD === 'true') return { kind: 'docker-source', reasonKey: 'sourceBuild' };
    return { kind: 'docker-image', reasonKey: 'publishedImage' };
  }

  /**
   * Everything the browser needs to walk an operator through the update.
   *
   * `version` is passed in rather than fetched here, so the browser shows the same
   * answer it already has: a second check could resolve a *newer* release between
   * the two calls and produce instructions for a version the reader never saw.
   */
  async prepare(version: VersionInfo): Promise<UpdatePreparation> {
    if (!version.update_available) {
      return {
        ready: false,
        reason: 'up-to-date',
        current: version.current,
        latest: version.latest,
      };
    }

    const deployment = this.deployment();
    const backup = await this.backup();

    return {
      ready: true,
      current: version.current,
      latest: version.latest,
      release_url: version.release_url ?? null,
      deployment: deployment.kind,
      deployment_reason: deployment.reasonKey,
      backup: backup,
      steps: this.steps(deployment.kind, version.latest),
    };
  }

  /**
   * Take the backup the update is about to make worth having.
   *
   * A failure here is reported rather than swallowed, and it does not stop the
   * preparation: an operator who can reach their own data directory may still
   * want the command. What must not happen is the browser saying "backed up"
   * when nothing was written.
   */
  private async backup(): Promise<{ created: boolean; filename: string | null; error: string | null }> {
    try {
      const result = await this.backupService.createBackup('backup');
      const filename = typeof result?.filename === 'string' ? result.filename : null;
      if (!filename) return { created: false, filename: null, error: 'backup returned no filename' };
      return { created: true, filename, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Logged, because the reason is operational and the browser only shows a
      // sentence: "ENOSPC" and "the storage backend is unreachable" want
      // different answers from whoever reads it.
      this.logger.warn(`Update preparation could not take a backup: ${message}`);
      return { created: false, filename: null, error: message };
    }
  }

  /**
   * The command, as a list of lines rather than one blob.
   *
   * A list so the browser can put a copy button beside each line and highlight the
   * one that carries the version: an operator reading three lines of shell wants
   * to know which of them pins the release they are moving to. None of this is
   * executed here — it is text.
   */
  private steps(kind: DeploymentKind, latest: string): UpdateStep[] {
    if (kind === 'manual') {
      return [
        {
          labelKey: 'admin.update.step.reinstall',
          command: null,
          noteKey: 'admin.update.step.reinstallNote',
        },
      ];
    }
    if (kind === 'docker-source') {
      return [
        { labelKey: 'admin.update.step.pull', command: 'git pull', noteKey: 'admin.update.step.pullNote' },
        {
          labelKey: 'admin.update.step.rebuild',
          command: 'docker compose up -d --build',
          noteKey: 'admin.update.step.rebuildNote',
        },
      ];
    }
    return [
      {
        labelKey: 'admin.update.step.pull',
        command: `docker pull ${this.imageRef(latest)}`,
        noteKey: 'admin.update.step.pullImageNote',
      },
      { labelKey: 'admin.update.step.composePull', command: 'docker compose pull', noteKey: null },
      { labelKey: 'admin.update.step.composeUp', command: 'docker compose up -d', noteKey: null },
    ];
  }

  /**
   * The image to pull.
   *
   * `IMAGE_NAME` is operator-configurable in the compose file, and the server
   * cannot see it — that variable lives in the shell that runs compose. So when
   * the operator has set one, this cannot know it and must not invent a
   * default that would quietly pull *someone else's* image: it emits a
   * placeholder they fill in, which is honest about what is unknown.
   */
  private imageRef(latest: string): string {
    const configured = process.env.IMAGE_NAME;
    const base = configured && configured.trim() ? configured.trim() : '<your-image>';
    const tag = process.env.IMAGE_TAG?.trim() || latest.replace(/^v/, '');
    return `${base}:${tag}`;
  }
}

/** Which set of instructions applies. */
export type DeploymentKind = 'docker-image' | 'docker-source' | 'manual';

export interface UpdateStep {
  labelKey: string;
  /** Absent when the step is prose rather than a command. */
  command: string | null;
  noteKey: string | null;
}

export interface UpdatePreparation {
  ready: boolean;
  /** Why not, when `ready` is false. */
  reason?: 'up-to-date';
  current: string;
  latest: string;
  release_url?: string | null;
  deployment?: DeploymentKind;
  /** Which fact decided the deployment, for the reader to check against reality. */
  deployment_reason?: string;
  backup?: { created: boolean; filename: string | null; error: string | null };
  steps?: UpdateStep[];
}

/**
 * The Docker probe, duplicated from admin.helpers on purpose.
 *
 * That one is evaluated once at module load, and its comment explains why it must
 * stay that way (a suite's `vi.mock` timing would shift `is_docker` in version
 * payloads). Importing it here would couple this service to that evaluation
 * order for no gain: this is a two-line filesystem read.
 */
export function isDockerInstance(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return (
      fs.existsSync('/.dockerenv') ||
      (fs.existsSync('/proc/1/cgroup') && fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'))
    );
  } catch {
    return false;
  }
}
