import React from 'react'
import Html5QrcodePlugin from "./components/Html5QrcodePlugin";
import { match, P } from "ts-pattern";
import { MEDIA_STATE, MESSAGE_TYPES } from './constants/constants';
import { GoUnlink } from "react-icons/go";
import { useRemoteConnection } from './hooks/useRemoteConnection';
import GlowDot from './components/ui/glowDot';
import VolumeControl from './components/ui/VolumeControl';
import QuickLaunchGrid from './components/ui/QuickLaunch';
import { IoMdDesktop, IoMdPlay, IoMdPause, IoMdVolumeOff, IoMdBulb, IoMdGlobe } from "react-icons/io";

const REMOTE_VERSION = import.meta.env.VITE_REMOTE_VERSION;
const LEAST_EXTENSION_VERSION = import.meta.env.VITE_LEAST_EXTENSION_VERSION;

const STATUS_COLORS = {
    [MESSAGE_TYPES.PAIR_SUCCESS]: "bg-green-500",
    [MESSAGE_TYPES.CONNECTING]: "bg-yellow-500",
    [MESSAGE_TYPES.CONNECTED]: "bg-blue-500",
    [MESSAGE_TYPES.VERIFYING]: "bg-orange-500",
    [MESSAGE_TYPES.DISCONNECTED]: "bg-red-500",
    [MESSAGE_TYPES.WAITING]: "bg-zinc-500",
};


const App = () => {
    const {
        status,
        hostInfo,
        tabsById,
        activeTab,
        activeTabId,
        pair,
        updateTabState,
        selectTab,
        disconnect,
        openNewTab
    } = useRemoteConnection();

    // Handlers
    const handleTogglePlayback = () => {
        if (!activeTab) return;
        updateTabState(activeTabId, MEDIA_STATE.PLAYBACK, activeTab.playback === "PLAYING" ? "PAUSED" : "PLAYING");
    };

    const handleToggleMute = () => {
        if (!activeTab) return;
        updateTabState(activeTabId, MEDIA_STATE.MUTE, !activeTab.muted);
    };


    return (
        <div className='min-h-screen bg-black text-zinc-100 px-4 py-6 flex flex-col items-center justify-center gap-4'>
            <main className='max-w-md min-w-sm w-full border border-zinc-800 rounded-2xl'>
                <header className='p-4 space-y-3'>
                    {/* Main Header Row */}
                    <div className='flex items-center justify-between'>
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                                <IoMdDesktop className="text-zinc-400" size={18} />
                            </div>
                            <div className="leading-tight">
                                <h1 className='font-semibold text-sm text-zinc-100'>Media Remote</h1>
                                <p className="text-[10px] text-zinc-600">v{REMOTE_VERSION}</p>
                            </div>
                        </div>
                        <div className='flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/80 border border-zinc-800/60'>
                            <GlowDot colorClass={STATUS_COLORS[status]} />
                            <span className='text-[10px] font-medium text-zinc-400 uppercase tracking-wide'>{status}</span>
                        </div>
                    </div>

                    {hostInfo && (
                        <div className='flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40'>
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                <span className="text-zinc-400 capitalize">{hostInfo?.os}</span>
                                <span className="text-zinc-700">•</span>
                                <span className="capitalize">{hostInfo?.browser}</span>
                                <span className="text-zinc-700">•</span>
                                {hostInfo?.extensionVersion >= LEAST_EXTENSION_VERSION ? (
                                    <span className="text-zinc-600">v{hostInfo?.extensionVersion}</span>
                                ) : (
                                    <span className='text-amber-400 font-medium'>Update Extension</span>
                                )}
                            </div>
                            <button className='text-[10px] font-medium text-red-500 px-2 py-1 rounded hover:bg-red-500/10 cursor-pointer transition-colors duration-150 flex items-center gap-1' onClick={disconnect}>
                                <GoUnlink size={10} />
                                <span>Unpair</span>
                            </button>
                        </div>
                    )}
                </header>

                <div className="h-px bg-zinc-800/80 mx-4" />

                <div className="flex-1 p-4 md:px-4 md:pb-4 ">
                    {match(status)
                        .with(MESSAGE_TYPES.CONNECTED, () => (
                            <div className="flex flex-col gap-4" data-testid="scanner-container">
                                <Html5QrcodePlugin
                                    fps={10}
                                    qrbox={250}
                                    disableFlip={false}
                                    qrCodeSuccessCallback={pair}
                                />
                            </div>
                        ))
                        .with(P.union(MESSAGE_TYPES.CONNECTING, MESSAGE_TYPES.VERIFYING), () => (
                            <div className="py-20 flex flex-col items-center justify-center gap-4 text-zinc-500">
                                <div className="w-8 h-8 border-2 border-zinc-800 border-t-zinc-400 rounded-full animate-spin" />
                                <span className="text-sm">Establish connection...</span>
                            </div>
                        ))
                        .with(MESSAGE_TYPES.PAIR_SUCCESS, () => (
                            <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500 transition-all overflow-hidden">
                                <section className=''>
                                    <main className='flex flex-col items-center justify-center gap-2'>
                                        {activeTab ? (
                                            <div className='w-full px-4'>
                                                <div className='flex items-center gap-3'>
                                                    {
                                                        activeTab?.url ? (
                                                            <img key={activeTab?.url} src={`https://www.google.com/s2/favicons?sz=64&domain=${activeTab?.url}`} alt="" className="w-8 h-8 shadow-sm" />
                                                        ) : (
                                                            <div className="w-8 h-8 bg-zinc-800 flex items-center justify-center"><IoMdGlobe className="text-zinc-500" size={20} /></div>
                                                        )
                                                    }
                                                    <div className='flex-1 min-w-0 flex flex-col justify-center'>
                                                        <div className='truncate text-sm font-medium text-zinc-100 leading-tight block mb-0.5'>{activeTab?.title || "Unknown title"}</div>
                                                        <a href={activeTab?.url} target="_blank" rel="noreferrer" className='text-xs text-zinc-500 truncate hover:text-zinc-400 transition-colors block'>{activeTab?.url || "Unknown URL"}</a>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className='flex flex-col gap-2 p-6 w-full items-center justify-center text-center border border-dashed border-zinc-800 rounded-xl'>
                                                <span className='font-medium text-sm text-zinc-400'>
                                                    No Tab Selected
                                                </span>
                                                <small className='text-xs text-zinc-600'>
                                                    Select a media tab to view controls
                                                </small>
                                            </div>
                                        )}

                                        <div className="w-full overflow-hidden p-2 space-y-2">
                                            <div className="flex gap-2">
                                                <button disabled={!activeTab} onClick={handleTogglePlayback} className={`group py-2 flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-lg flex items-center justify-between px-4 transition-all duration-200 disabled:opacity-50 active:scale-[0.98] disabled:cursor-not-allowed cursor-pointer`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 ${activeTab?.playback === 'PLAYING' ? 'bg-green-500 text-zinc-950' : activeTab?.playback === 'PAUSED' ? 'bg-blue-600 text-zinc-50' : 'bg-zinc-800 text-zinc-50'}`}>
                                                            {activeTab?.playback === 'PLAYING' ? <IoMdPause size={20} /> : <IoMdPlay className="ml-0.5" size={20} />}
                                                        </div>
                                                        <div className="flex flex-col items-start gap-0.5">
                                                            <span className={`text-xs font-semibold uppercase tracking-wider 'text-zinc-100' `}>
                                                                {activeTab?.playback || 'Idle'}
                                                            </span>
                                                            <span className="text-[10px] text-zinc-500 font-medium">
                                                                {activeTab?.playback === 'PLAYING' ? 'Tap to pause' : 'Tap to play'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </button>

                                                <button disabled={!activeTab} onClick={handleToggleMute} className={`w-fit px-6 bg-zinc-900 hover:bg-zinc-800 rounded-lg flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98] ${activeTab?.muted ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20' : 'text-zinc-400 hover:text-zinc-200'}`}>
                                                    <IoMdVolumeOff size={24} />
                                                </button>
                                            </div>
                                            {
                                                Number.parseFloat(hostInfo?.extensionVersion) >= Number.parseFloat(LEAST_EXTENSION_VERSION) && (
                                                    <VolumeControl activeTab={activeTab} onVolumeChange={(value) => updateTabState(activeTabId, MEDIA_STATE.VOLUME, value)} />
                                                )
                                            }
                                        </div>
                                    </main>
                                </section>

                                <section>
                                    <div className="flex items-center justify-between mb-3 px-1">
                                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Open Media Tabs</h4>
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-500 border border-zinc-800">{Object.keys(tabsById).length}</span>
                                    </div>
                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                        {Object.values(tabsById).length === 0 ? (
                                            <div className="py-8 flex flex-col items-center justify-center text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/20">
                                                <p className="text-zinc-500 text-sm font-medium">No media tabs found</p>
                                                <p className="text-zinc-600 text-xs mt-1">Open a site like YouTube to get started</p>
                                            </div>
                                        ) : (
                                            Object.values(tabsById).map((tab) => (
                                                <button key={tab.tabId} onClick={() => selectTab(tab.tabId)} className={`group w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200 border ${activeTabId === tab.tabId ? "bg-zinc-900 border-zinc-700 shadow-sm" : "bg-zinc-900/50 border-transparent hover:bg-zinc-900/50 hover:border-zinc-800/50 text-zinc-400 hover:text-zinc-300"}`}>
                                                    <div className="relative shrink-0">
                                                        <img src={tab.url ? `https://www.google.com/s2/favicons?sz=64&domain=${tab.url}` : tab.favIconUrl} className={`w-8 h-8 shadow-sm transition-opacity ${activeTabId === tab.tabId ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`} alt="" />
                                                        {tab.playback === "PLAYING" && (
                                                            <div className="absolute -bottom-1 -right-1 flex gap-0.5 items-end h-3 w-3 justify-center bg-zinc-950 rounded-full p-0.5 ring-2 ring-zinc-950">
                                                                <div className="w-0.5 bg-green-500 animate-[music-bar_1s_ease-in-out_infinite] h-full" style={{ animationDelay: '0ms' }} />
                                                                <div className="w-0.5 bg-green-500 animate-[music-bar_1s_ease-in-out_infinite] h-2/3" style={{ animationDelay: '200ms' }} />
                                                                <div className="w-0.5 bg-green-500 animate-[music-bar_1s_ease-in-out_infinite] h-full" style={{ animationDelay: '400ms' }} />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className={`text-sm font-medium truncate ${activeTabId === tab.tabId ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                                                            {tab.title}
                                                        </div>
                                                        <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                                                            {tab.url ? new URL(tab.url).hostname.replace('www.', '') : 'Unknown Source'}
                                                        </div>
                                                    </div>

                                                    {activeTabId === tab.tabId && (
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                                                    )}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </section>

                                {
                                    Number.parseFloat(hostInfo?.extensionVersion) >= Number.parseFloat(LEAST_EXTENSION_VERSION) && (
                                        <section className=''>
                                            <div className="flex items-center gap-2 my-2">
                                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Quick Launch: One tap open</h4>
                                                <div className="h-px flex-1 bg-zinc-800/50"></div>
                                            </div>
                                            <QuickLaunchGrid onLaunch={openNewTab} />
                                        </section>
                                    )
                                }

                            </div>
                        ))
                        .with(MESSAGE_TYPES.WAITING, () => (
                            <div className="text-center py-12 space-y-4">
                                <div className="inline-block p-4 rounded-full bg-zinc-900 border border-zinc-800 animate-pulse">
                                    <IoMdBulb className="text-yellow-500 w-8 h-8" />
                                </div>
                                <div>
                                    <h3 className="text-white font-medium">Host Disconnected</h3>
                                    <p className="text-zinc-500 text-sm">Waiting for the extension to come back online...</p>
                                </div>
                            </div>
                        ))
                        .with(MESSAGE_TYPES.DISCONNECTED, () => (
                            <div className="text-center py-12">
                                <p className="text-zinc-500">Server connection lost.</p>
                                <button onClick={() => globalThis.location.reload()} className="mt-4 text-sm text-blue-400 hover:text-blue-300">Reload App</button>
                            </div>
                        ))
                        .otherwise(() => null)}
                </div>
            </main>
            <footer className='flex flex-col gap-4  items-center justify-center'>
                <a href="https://www.buymeacoffee.com/jadhavsharad" target="_blank" className="transform hover:scale-105 transition-transform">
                    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" className='w-36' />
                </a>
                <p className="text-xs">Made with ❤️ by <a href="https://github.com/jadhavsharad" className=" underline">Sharad Jadhav</a></p>
            </footer>
        </div>
    )
}

export default App