import { ArrowDownToLine } from '@gravity-ui/icons';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { httpErrorToHuman } from '@/api/http';
import pullFile from '@/api/server/files/pullFile';
import {
    getMarketplacePackVersions,
    type MarketplaceProject,
    type MarketplaceVersion,
    resolveMarketplacePackInstall,
} from '@/api/server/marketplace';
import { Dialog } from '@/components/elements/dialog';
import Spinner from '@/components/elements/Spinner';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/I18nProvider';
import type { TranslationKey } from '@/i18n/types';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface ModpackVersionPickerProps {
    open: boolean;
    onClose: () => void;
    uuid: string;
    source: string;
    loader: string | null;
    gameVersion: string | null;
    project: MarketplaceProject | null;
    /** Called after a pack archive is downloaded so the UI can react. */
    onInstalled?: (filename: string, directory: string) => void;
}

const formatBytes = (bytes: number | null | undefined, locale: string): string => {
    if (!bytes) return '—';
    if (bytes >= 1_000_000) {
        return `${formatNumber(bytes / 1_000_000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
    }
    if (bytes >= 1_000) {
        return `${formatNumber(bytes / 1_000, locale, { maximumFractionDigits: 0 })} KB`;
    }

    return `${bytes} B`;
};

const TYPE_BADGE: Record<string, { label: TranslationKey; className: string }> = {
    release: { label: 'server.installer.version_type_release', className: 'bg-brand-400/20 text-brand-400' },
    beta: { label: 'server.installer.version_type_beta', className: 'bg-amber-500/20 text-amber-400' },
    alpha: { label: 'server.installer.version_type_alpha', className: 'bg-red-500/20 text-red-400' },
};

const BADGE_FALLBACK: { label: TranslationKey; className: string } = {
    label: 'server.installer.version_type_other',
    className: 'bg-mocha-300/40 text-cream-400/60',
};

const ModpackVersionPicker = ({
    open,
    onClose,
    uuid,
    source,
    loader,
    gameVersion,
    project,
    onInstalled,
}: ModpackVersionPickerProps) => {
    const { t, locale } = useTranslation();
    const [versions, setVersions] = useState<MarketplaceVersion[]>([]);
    const [loading, setLoading] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !project) return;

        let cancelled = false;
        setLoading(true);
        setError(null);
        setVersions([]);

        getMarketplacePackVersions(uuid, {
            source,
            projectId: project.id,
            loader,
            gameVersion,
        })
            .then((data) => {
                if (!cancelled) setVersions(data);
            })
            .catch((err) => {
                if (!cancelled) setError(httpErrorToHuman(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, project, uuid, source, loader, gameVersion]);

    const install = async (version: MarketplaceVersion) => {
        if (!project) return;
        setInstallingId(version.id);
        try {
            const resolved = await resolveMarketplacePackInstall(uuid, {
                source,
                projectId: project.id,
                versionId: version.id,
            });

            const targetDirectory = resolved.directory || 'modpacks';

            // Download the .mrpack / .zip archive into the modpacks/ staging
            // folder on the daemon (server-to-server, no browser bandwidth).
            //
            // TODO(modpack-installer): a full install is more than a download —
            // a .mrpack is a zip whose `modrinth.index.json` lists each mod file
            // to fetch plus an `overrides/` tree that must be applied to the
            // server root. The extraction step belongs in a dedicated backend
            // service (queued job) so it can resolve + pull each listed mod and
            // merge overrides, then update the server startup JAR. Until then we
            // stage the archive here so it is available on the server.
            await pullFile(uuid, {
                url: resolved.url,
                directory: targetDirectory,
                filename: resolved.filename,
            });

            toast.success(t('server.modpack.install_success', { filename: resolved.filename }));
            onInstalled?.(resolved.filename, targetDirectory);
            onClose();
        } catch (err) {
            toast.error(httpErrorToHuman(err) || t('server.modpack.error_install'));
        } finally {
            setInstallingId(null);
        }
    };

    if (!project) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={`${t('server.modpack.install')} ${project.title}`}
            description={`${source} · ${project.author || t('server.installer.unknown_author')}`}
        >
            <div className='space-y-3'>
                {loading && (
                    <div className='flex items-center justify-center gap-2 py-10 text-cream-400/70'>
                        <Spinner size='small' />
                        <span className='text-sm'>{t('server.modpack.loading_versions')}</span>
                    </div>
                )}

                {error && <p className='rounded-lg bg-red-500/10 p-3 text-sm text-red-400'>{error}</p>}

                {!loading && !error && versions.length === 0 && (
                    <p className='py-10 text-center text-sm text-cream-400/60'>{t('server.modpack.no_versions')}</p>
                )}

                {!loading && versions.length > 0 && (
                    <div className='max-h-[60vh] space-y-2 overflow-y-auto pr-1'>
                        {versions.map((version) => {
                            const badge = TYPE_BADGE[version.type] ?? BADGE_FALLBACK;
                            const installing = installingId === version.id;
                            return (
                                <div
                                    key={version.id}
                                    className='flex items-center justify-between gap-3 rounded-xl border border-mocha-300/50 bg-mocha-400/50 p-3'
                                >
                                    <div className='min-w-0'>
                                        <div className='flex flex-wrap items-center gap-2'>
                                            <span className='truncate text-sm font-medium text-cream-400'>
                                                {version.name}
                                            </span>
                                            <span className={cn('rounded px-1.5 py-0.5 text-[10px]', badge.className)}>
                                                {t(badge.label)}
                                            </span>
                                        </div>
                                        <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-cream-400/50'>
                                            {version.game_versions.length > 0 && (
                                                <span className='truncate'>
                                                    {version.game_versions.slice(0, 4).join(', ')}
                                                    {version.game_versions.length > 4 ? '…' : ''}
                                                </span>
                                            )}
                                            {version.loaders.length > 0 && <span>{version.loaders.join(', ')}</span>}
                                            <span>{formatBytes(version.size, locale)}</span>
                                        </div>
                                    </div>
                                    <Button
                                        size='sm'
                                        variant='attention'
                                        disabled={installing}
                                        onClick={() => install(version)}
                                        className='flex-shrink-0 gap-1.5'
                                    >
                                        {installing ? (
                                            <Spinner size='small' />
                                        ) : (
                                            <ArrowDownToLine width={16} height={16} fill='currentColor' />
                                        )}
                                        {installing ? t('server.modpack.installing') : t('server.modpack.install')}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Dialog>
    );
};

export default ModpackVersionPicker;
