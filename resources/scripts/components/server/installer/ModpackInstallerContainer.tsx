import { Magnifier } from '@gravity-ui/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { httpErrorToHuman } from '@/api/http';
import type { GameVersions, MarketplaceProject } from '@/api/server/marketplace';
import {
    getMarketplaceGameVersions,
    getMarketplaceLoaders,
    searchMarketplacePacks,
} from '@/api/server/marketplace';
import Dropdown from '@/components/elements/Dropdown';
import { MainPageHeader } from '@/components/elements/MainPageHeader';
import ServerContentBlock from '@/components/elements/ServerContentBlock';
import Spinner from '@/components/elements/Spinner';
import ServerHeader from '@/components/server/header/ServerHeader';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/I18nProvider';
import type { TranslationKey } from '@/i18n/types';
import { ServerContext } from '@/state/server';
import { loadersFor } from './eggFeatures';
import ModpackCard from './ModpackCard';
import ModpackVersionPicker from './ModpackVersionPicker';

const PAGE_SIZE = 24;

const versionTypeLabel = (t: (key: TranslationKey) => string, type: string) => {
    const key = `server.installer.version_type_${type}`;
    const translated = t(key as TranslationKey);

    return translated === key ? type.charAt(0).toUpperCase() + type.slice(1) : translated;
};

interface PickerCtx {
    project: MarketplaceProject;
}

/**
 * Modpack installer — browses Minecraft modpacks from Modrinth, following the
 * same search → versions → resolve flow as the plugin/mod installer. Selecting
 * a version downloads the pack archive into a `modpacks/` staging folder on the
 * daemon; the full extract-and-apply step (see ModpackVersionPicker) is the
 * next piece of this feature.
 */
const ModpackInstallerContainer = () => {
    const { t } = useTranslation();
    const uuid = ServerContext.useStoreState((state) => state.server.data?.uuid);
    const eggFeatures = ServerContext.useStoreState((state) => state.server.data?.eggFeatures ?? []);

    const [query, setQuery] = useState('');
    const [loader, setLoader] = useState<string | null>(null);
    const [results, setResults] = useState<MarketplaceProject[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [picker, setPicker] = useState<PickerCtx | null>(null);
    const [installed, setInstalled] = useState<Set<string>>(new Set());

    const [knownLoaders, setKnownLoaders] = useState<string[]>([]);
    const [gameVersions, setGameVersions] = useState<GameVersions>({});
    const [releaseType, setReleaseType] = useState<string>('');
    const [gameVersion, setGameVersion] = useState<string | null>(null);

    // Live Modrinth loader list so the mod-loader filter only offers loaders
    // the marketplace actually recognizes.
    useEffect(() => {
        if (!uuid) return;
        getMarketplaceLoaders(uuid)
            .then(setKnownLoaders)
            .catch(() => setKnownLoaders([]));
    }, [uuid]);

    useEffect(() => {
        if (!uuid) return;
        getMarketplaceGameVersions(uuid)
            .then((versions) => {
                setGameVersions(versions);
                const types = Object.keys(versions);
                if (types.length > 0) {
                    setReleaseType(types[0]);
                    setGameVersion(versions[types[0]][0] ?? null);
                }
            })
            .catch(() => setGameVersions({}));
    }, [uuid]);

    // Default the loader filter to the first mod loader the egg advertises.
    useEffect(() => {
        setLoader(loadersFor(eggFeatures, 'mod', knownLoaders)[0] ?? null);
    }, [eggFeatures, knownLoaders]);

    const requestId = useRef(0);
    useEffect(() => {
        if (!uuid) return;

        const id = ++requestId.current;
        const handle = setTimeout(() => {
            setLoading(true);
            setError(null);
            searchMarketplacePacks(uuid, {
                source: 'modrinth',
                query: query.trim() || undefined,
                loader,
                game_version: gameVersion,
                limit: PAGE_SIZE,
            })
                .then((data) => {
                    if (id !== requestId.current) return;
                    setResults(data.results);
                    setHasMore(data.results.length >= PAGE_SIZE);
                })
                .catch((err) => {
                    if (id !== requestId.current) return;
                    setError(httpErrorToHuman(err) || t('server.modpack.error_search'));
                    setResults([]);
                    setHasMore(false);
                })
                .finally(() => {
                    if (id === requestId.current) setLoading(false);
                });
        }, 350);

        return () => clearTimeout(handle);
    }, [uuid, query, loader, gameVersion, t]);

    const loadMore = useCallback(() => {
        if (!uuid || loadingMore || !hasMore) return;
        setLoadingMore(true);
        searchMarketplacePacks(uuid, {
            source: 'modrinth',
            query: query.trim() || undefined,
            loader,
            game_version: gameVersion,
            limit: PAGE_SIZE,
            offset: results.length,
        })
            .then((data) => {
                const seen = new Set(results.map((r) => `${r.source}:${r.id}`));
                const fresh = data.results.filter((r) => !seen.has(`${r.source}:${r.id}`));
                setResults((prev) => [...prev, ...fresh]);
                setHasMore(fresh.length >= PAGE_SIZE);
            })
            .catch((err) => toast.error(httpErrorToHuman(err) || t('server.modpack.error_load_more')))
            .finally(() => setLoadingMore(false));
    }, [uuid, loadingMore, hasMore, results, query, loader, gameVersion, t]);

    const onInstalled = useCallback(
        (project: MarketplaceProject) => {
            setInstalled((prev) => new Set(prev).add(`${project.source}:${project.id}`));
        },
        [],
    );

    const modLoaders = loadersFor(eggFeatures, 'mod', knownLoaders);

    return (
        <ServerContentBlock title={t('server.modpack.title')}>
            <ServerHeader />
            <div className='space-y-6'>
                <MainPageHeader direction='column' title={t('server.modpack.title')}>
                    <p className='text-cream-400/60'>{t('server.modpack.description')}</p>
                </MainPageHeader>

                <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
                    <div className='relative flex-1'>
                        <Magnifier
                            width={18}
                            height={18}
                            fill='currentColor'
                            className='pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-400/40'
                        />
                        <input
                            type='text'
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('server.modpack.search_placeholder')}
                            className='w-full rounded-xl border border-mocha-300/50 bg-mocha-400/50 py-3 pl-11 pr-4 text-sm text-cream-400 placeholder:text-cream-400/40 focus:border-brand-400/60 focus:outline-none'
                        />
                    </div>

                    {modLoaders.length > 1 && (
                        <Dropdown
                            value={loader ?? ''}
                            onChange={(value) => setLoader(value || null)}
                            triggerClassName='w-auto rounded-xl border border-mocha-300/50 bg-mocha-400/50 px-3 py-3 hover:bg-mocha-400/50'
                            options={modLoaders.map((l) => ({ value: l, label: l }))}
                        />
                    )}

                    {Object.keys(gameVersions).length > 0 && (
                        <>
                            <Dropdown
                                value={releaseType}
                                onChange={(type) => {
                                    setReleaseType(type);
                                    setGameVersion((gameVersions[type] ?? [])[0] ?? null);
                                }}
                                triggerClassName='w-auto rounded-xl border border-mocha-300/50 bg-mocha-400/50 px-3 py-3 hover:bg-mocha-400/50'
                                options={['release', 'snapshot', 'beta', 'alpha']
                                    .filter((type) => gameVersions[type])
                                    .map((type) => ({ value: type, label: versionTypeLabel(t, type) }))}
                            />
                            <Dropdown
                                value={gameVersion ?? ''}
                                onChange={(value) => setGameVersion(value || null)}
                                triggerClassName='w-auto rounded-xl border border-mocha-300/50 bg-mocha-400/50 px-3 py-3 hover:bg-mocha-400/50'
                                options={(gameVersions[releaseType] ?? []).map((v) => ({ value: v, label: v }))}
                            />
                        </>
                    )}
                </div>

                {error && (
                    <div className='rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400'>
                        {error}
                    </div>
                )}

                {loading && results.length === 0 ? (
                    <div className='flex items-center justify-center gap-2 py-20 text-cream-400/60'>
                        <Spinner size='small' />
                        <span className='text-sm'>{t('server.modpack.loading')}</span>
                    </div>
                ) : results.length === 0 && !error ? (
                    <div className='rounded-2xl border border-mocha-300/50 bg-mocha-400/50 py-20 text-center text-cream-400/60'>
                        {query.trim() ? t('server.installer.no_results') : t('server.installer.nothing_to_show')}
                    </div>
                ) : (
                    <>
                        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                            {results.map((project) => (
                                <ModpackCard
                                    key={`${project.source}:${project.id}`}
                                    project={project}
                                    installed={installed.has(`${project.source}:${project.id}`)}
                                    onInstall={(p) => setPicker({ project: p })}
                                />
                            ))}
                        </div>

                        {hasMore && (
                            <div className='flex justify-center pt-2'>
                                <Button variant='secondary' onClick={loadMore} disabled={loadingMore} className='gap-2'>
                                    {loadingMore && <Spinner size='small' />}
                                    {loadingMore ? t('server.modpack.loading') : t('server.installer.load_more')}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <ModpackVersionPicker
                open={picker !== null}
                onClose={() => setPicker(null)}
                uuid={uuid ?? ''}
                source='modrinth'
                loader={loader}
                gameVersion={gameVersion}
                project={picker?.project ?? null}
                onInstalled={() => {
                    if (picker) onInstalled(picker.project);
                }}
            />
        </ServerContentBlock>
    );
};

export default ModpackInstallerContainer;
