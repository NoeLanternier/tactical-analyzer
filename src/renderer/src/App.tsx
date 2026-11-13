import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Activity,
  ClipboardCheck,
  Coins,
  Gauge,
  LoaderCircle,
  Pin,
  PinOff,
  Settings,
  Swords,
  X,
  Zap
} from 'lucide-react'
import { useTactique } from './hooks/useTactique'
import { BuildTab } from './components/BuildTab'
import { AnalysisTab } from './components/AnalysisTab'
import { SettingsTab } from './components/SettingsTab'
import { ReviewTab } from './components/ReviewTab'
import { itemIcon } from './engine/gameData'
import { tr } from '../../shared/i18n'
import { RIOT_COMPLIANT } from '../../shared/edition'

type Tab = 'build' | 'analyse' | 'review' | 'settings'

export default function App(): ReactElement {
  const t = useTactique()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tab, setTab] = useState<Tab>('build')
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expanded = hovered || pinned

  useEffect(() => window.api.onTogglePin(() => setPinned((p) => !p)), [])
  // Curseur sorti du panneau (suivi par le processus principal, plus fiable au-dessus du jeu).
  useEffect(
    () =>
      window.api.onOverlayLeave(() => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current)
        setHovered(false)
      }),
    []
  )
  // Écrire dans un champ : la fenêtre prend le clavier, puis le rend au jeu en quittant le champ.
  useEffect(() => {
    const isField = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement && !!el.closest('input, textarea, select')
    const down = (e: PointerEvent): void => {
      if (isField(e.target)) window.api.setKeyboard(true)
    }
    const out = (e: FocusEvent): void => {
      if (isField(e.target) && !isField(e.relatedTarget)) window.api.setKeyboard(false)
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('focusout', out, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('focusout', out, true)
    }
  }, [])

  // Titre de la fenêtre (barre des tâches) dans la langue de l'application.
  useEffect(() => {
    document.title = 'Tactical Analyzer'
  }, [t.lang])

  // Le panneau ouvert capte la souris ; fermé, les clics traversent vers le jeu. (Renvoyé aussi
  // quand le survol change pendant qu'il est épinglé, pour reprendre le suivi du curseur.)
  useEffect(() => {
    window.api.setOverlayMode(expanded)
  }, [expanded, hovered])

  const onEnter = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setHovered(true)
  }
  const onLeave = (): void => {
    leaveTimer.current = setTimeout(() => setHovered(false), 250)
  }

  const side = t.settings.side
  // Signal « adversaire en avance » : édition personnelle seulement.
  const fed = RIOT_COMPLIANT ? null : t.threat?.fed

  if (!expanded) {
    return (
      <div className="pointer-events-none relative h-screen w-screen">
        <div
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className={`pointer-events-auto absolute top-1/2 flex h-20 w-11 -translate-y-1/2 cursor-pointer items-center justify-center border border-white/20 bg-[#0a0d14]/90 shadow-[2px_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors hover:bg-[#0a0d14] ${side === 'left' ? 'left-0 rounded-r-2xl border-l-0' : 'right-0 rounded-l-2xl border-r-0'}`}
        >
          {!t.gd ? (
            <LoaderCircle size={18} className="animate-spin text-gold" />
          ) : t.review.fresh && !t.live ? (
            <ClipboardCheck
              size={22}
              className="animate-pulse text-gold drop-shadow-[0_0_8px_rgba(200,170,110,0.6)]"
            />
          ) : fed ? (
            <Activity
              size={22}
              className="animate-pulse text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            />
          ) : t.purchase ? (
            <Coins
              size={22}
              className="animate-pulse text-gold drop-shadow-[0_0_8px_rgba(200,170,110,0.7)]"
            />
          ) : (
            <Zap
              size={22}
              className={`${t.champ ? 'text-lolblue' : 'text-slate-500'} drop-shadow-[0_0_8px_rgba(10,200,185,0.6)]`}
            />
          )}
        </div>
        {/* Alerte d'achat visible panneau replié : l'objet à acheter maintenant. */}
        {t.purchase && t.gd && (
          <div
            className={`absolute top-1/2 flex max-w-[310px] -translate-y-1/2 items-center gap-2 rounded-lg border border-gold/50 bg-[#0a0d14]/90 px-2 py-1.5 shadow-lg ${side === 'left' ? 'left-14' : 'right-14'}`}
          >
            <img
              src={itemIcon(t.gd.version, t.purchase.item.id)}
              alt=""
              className="h-7 w-7 rounded border border-gold/60"
            />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[11px] font-semibold text-gold">
                {tr('Achète', 'Buy')} {t.purchase.item.label}
              </div>
              {t.purchase.target && (
                <div className="text-[10px] text-slate-400">
                  {tr('pour', 'for')} {t.purchase.target.label}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'build', label: 'Build', icon: <Swords size={13} /> },
    { id: 'analyse', label: tr('Analyse', 'Analysis'), icon: <Gauge size={13} /> },
    { id: 'review', label: tr('Bilan', 'Review'), icon: <ClipboardCheck size={13} /> },
    { id: 'settings', label: tr('Réglages', 'Settings'), icon: <Settings size={13} /> }
  ]

  return (
    <div className="h-screen w-screen p-0">
      <div
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-panel font-sans shadow-2xl"
      >
        <header className="flex h-11 shrink-0 items-center justify-between bg-[#0a0d14] px-3">
          <span className="flex items-center gap-2 font-cinzel text-sm font-bold tracking-widest text-gold">
            <Zap size={14} className={t.champ ? 'text-lolblue' : 'text-slate-600'} />{' '}
            {'Tactical Analyzer'}
          </span>
          <div className="flex items-center gap-2">
            <span
              title={`${tr('Client LoL', 'LoL client')}: ${t.lcuStatus}`}
              className={`h-2 w-2 rounded-full ${t.lcuStatus === 'connected' ? 'bg-emerald-400' : t.lcuStatus === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'}`}
            />
            <button
              title={tr('Épingler (Ctrl+Maj+T)', 'Pin (Ctrl+Shift+T)')}
              onClick={() => setPinned(!pinned)}
              className="text-slate-400 hover:text-lolblue"
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button
              title={tr('Quitter', 'Quit')}
              onClick={() => window.api.closeApp()}
              className="text-slate-400 hover:text-red-500"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <nav className="flex shrink-0 border-b border-white/5 bg-[#0a0d14]/60">
          {tabs.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                setTab(x.id)
                if (x.id === 'review') t.review.markSeen()
              }}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-semibold uppercase tracking-wide ${tab === x.id ? 'border-b-2 border-lolblue text-lolblue' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {x.icon} {x.label}
              {x.id === 'analyse' && fed && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
              {x.id === 'review' && t.review.fresh && (
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              )}
            </button>
          ))}
        </nav>

        <main className="flex flex-1 flex-col overflow-y-auto p-3">
          {t.metaStaleDays !== null && (
            <p className="mb-2 rounded bg-orange-500/10 px-2 py-1 text-[10px] leading-snug text-orange-200">
              {tr(
                `Méta vieille de ${t.metaStaleDays} jours : la collecte nocturne a peut-être échoué. Les conseils restent valables mais ne suivent plus le patch.`,
                `Meta is ${t.metaStaleDays} days old: the nightly collection may have failed. Advice still works but no longer follows the patch.`
              )}
            </p>
          )}
          {t.mode === null && (
            <p className="mb-2 rounded bg-orange-500/10 px-2 py-1 text-[10px] leading-snug text-orange-200">
              {tr(
                'Mode de jeu non pris en charge (Arène…) : les conseils affichés sont ceux de la Faille, à titre indicatif.',
                'Game mode not supported (Arena…): the advice shown is for Summoner’s Rift, for reference only.'
              )}
            </p>
          )}
          {!t.gd && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
              <LoaderCircle className="animate-spin text-gold" />
              {tr('Chargement des données Riot…', 'Loading Riot data…')}
              {t.loadError && (
                <span className="text-[11px] text-red-300">
                  {t.loadError} — {tr('nouvel essai dans 10 s', 'retrying in 10 s')}
                </span>
              )}
            </div>
          )}
          {t.gd && tab === 'build' && <BuildTab t={t} />}
          {t.gd && tab === 'analyse' && <AnalysisTab t={t} />}
          {t.gd && tab === 'review' && <ReviewTab t={t} />}
          {tab === 'settings' && <SettingsTab t={t} />}
        </main>
      </div>
    </div>
  )
}
