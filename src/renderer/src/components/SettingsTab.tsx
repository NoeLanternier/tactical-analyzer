import { useEffect, useState, type ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import type { RuneSource, UpdateStatus } from '../../../shared/types'
import { fmtNumber, fmtPct, tr, type LanguageSetting } from '../../../shared/i18n'
import { Card, Toggle } from './ui'
import { TUNING_KEYS, type TuningKey } from '../engine/tuning'
import { ROLES, roleLabel } from '../engine/role'
import { RIOT_COMPLIANT } from '../../../shared/edition'

const TUNING_LABEL: Record<TuningKey, [string, string]> = {
  pick: ['Force du champion', 'Champion strength'],
  vs: ['Adversaire direct', 'Direct opponent'],
  pairs: ['Alliés et adversaires', 'Allies and enemies'],
  famBase: ['Famille de build', 'Build family'],
  famCtx: ['Famille selon l’adversaire', 'Family vs enemy team'],
  choiceBase: ['Runes, bottes, familier', 'Runes, boots, pet'],
  choiceCtx: ['… selon l’adversaire', '… vs enemy team'],
  counter: ['Objets face aux adversaires', 'Items vs enemies']
}

/** Backtest de la méta et poids du moteur réglés chaque nuit. */
function EngineCard({ t }: { t: TactiqueState }): ReactElement | null {
  const bt = t.catalog.backtest
  const tuning = t.catalog.tuning
  if (!bt && !tuning) return null
  const rate = (c: { games: number; winRate: number | null }): string =>
    c.winRate === null ? '—' : `${fmtPct(c.winRate, 1)} (${fmtNumber(c.games)})`
  return (
    <Card title={tr('Qualité du moteur', 'Engine quality')}>
      {bt && (
        <div className="mb-2 text-[10px] leading-snug text-slate-400">
          <p className="mb-1 text-slate-500">
            {tr(
              `Parties jugées avec la méta de la veille (${fmtNumber(bt.games)}) : taux de victoire des joueurs qui ont suivi la recommandation, ou non.`,
              `Games judged with the previous day’s meta (${fmtNumber(bt.games)}): win rate of players who followed the recommendation, or not.`
            )}
          </p>
          <p>
            {tr('Famille de build : suivie ', 'Build family: followed ')}
            <b className="text-slate-200">{rate(bt.variant.followed)}</b>
            {tr(' · autre ', ' · other ')}
            {rate(bt.variant.other)}
          </p>
          <p>
            {tr('Objets situationnels : suivis ', 'Situational items: followed ')}
            <b className="text-slate-200">{rate(bt.items.high)}</b>
            {tr(' · ignorés ', ' · ignored ')}
            {rate(bt.items.low)}
          </p>
        </div>
      )}
      {tuning && (
        <div className="text-[10px] leading-snug text-slate-400">
          <p className="mb-1 text-slate-500">
            {tr(
              `Poids des critères réglés sur ${fmtNumber(tuning.games)} parties (×1 = poids d’origine).`,
              `Criteria weights tuned on ${fmtNumber(tuning.games)} games (×1 = original weight).`
            )}
          </p>
          <ul className="grid grid-cols-2 gap-x-2">
            {TUNING_KEYS.map((k) => {
              const w = tuning.weights[k]
              const color =
                w < 0.8 ? 'text-orange-300' : w > 1.2 ? 'text-emerald-300' : 'text-slate-300'
              return (
                <li key={k} className="flex justify-between">
                  <span>{tr(...TUNING_LABEL[k])}</span>
                  <b className={color}>×{fmtNumber(w, 2)}</b>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}

function updateLabel(u: UpdateStatus): string {
  switch (u.state) {
    case 'checking':
      return tr('recherche de mise à jour…', 'checking for updates…')
    case 'available':
      return tr(
        `version ${u.version ?? ''} trouvée, téléchargement…`,
        `version ${u.version ?? ''} found, downloading…`
      )
    case 'downloading':
      return tr(`téléchargement ${u.percent ?? 0} %`, `downloading ${u.percent ?? 0}%`)
    case 'ready':
      return tr(`version ${u.version ?? ''} prête`, `version ${u.version ?? ''} ready`)
    case 'none':
      return tr('à jour', 'up to date')
    case 'error':
      return `${tr('erreur', 'error')}: ${u.message ?? ''}`
    case 'unsupported':
      return tr(
        `mises à jour automatiques indisponibles (${u.message ?? ''})`,
        `automatic updates unavailable (${u.message ?? ''})`
      )
    default:
      return '—'
  }
}

/** Version installée et état des mises à jour automatiques. */
function UpdateCard({
  token,
  onToken
}: {
  token: string
  onToken: (token: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(token)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void window.api.getAppInfo().then((info) => {
      setVersion(info.version)
      setUpdate(info.update)
    })
    return window.api.onUpdateStatus(setUpdate)
  }, [])
  return (
    <Card title={tr('Application', 'App')}>
      <p className="text-[11px] text-slate-300">
        Version {version} — {updateLabel(update)}
      </p>
      <div className="mt-2 flex gap-1.5">
        {update.state === 'ready' ? (
          <button
            className="rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/30"
            onClick={() => window.api.installUpdate()}
          >
            {tr('Redémarrer et mettre à jour', 'Restart and update')}
          </button>
        ) : (
          update.state !== 'unsupported' && (
            <button
              className="rounded bg-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/20"
              onClick={() => window.api.checkForUpdates()}
            >
              {tr('Vérifier maintenant', 'Check now')}
            </button>
          )
        )}
      </div>
      {/* Dépôt privé (édition personnelle) : jeton GitHub en lecture seule pour les mises à jour. */}
      {!RIOT_COMPLIANT && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] leading-snug text-slate-500">
            {tr(
              'Jeton GitHub (lecture seule, limité au dépôt de l’app) : nécessaire si le dépôt est privé. Gardé uniquement sur ce PC.',
              'GitHub token (read-only, limited to the app repository): needed if the repository is private. Kept on this PC only.'
            )}
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px]"
              placeholder="github_pat_…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className="rounded bg-lolblue/20 px-2 text-[11px] text-lolblue hover:bg-lolblue/30"
              onClick={() => onToken(draft.trim())}
            >
              {tr('Enregistrer', 'Save')}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

const selectClass = 'rounded border border-white/10 bg-slate-900 px-2 py-1 text-xs'
const rowClass = 'flex items-center justify-between gap-3 py-1.5 text-xs text-slate-200'

export function SettingsTab({ t }: { t: TactiqueState }): ReactElement {
  const s = t.settings
  const [metaUrl, setMetaUrl] = useState(s.metaUrl)
  const [showIssues, setShowIssues] = useState(false)
  const update = (patch: Partial<typeof s>): void => void t.saveSettings({ ...s, ...patch })

  return (
    <div className="flex flex-col gap-3">
      <Card title={tr('Langue', 'Language')}>
        <label className={rowClass}>
          {tr('Langue de l’application', 'App language')}
          <select
            className={selectClass}
            value={s.language}
            onChange={(e) => update({ language: e.target.value as LanguageSetting })}
          >
            <option value="auto">
              {tr('Auto (langue du client LoL)', 'Auto (LoL client language)')}
            </option>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
        <p className="text-[10px] leading-snug text-slate-500">
          {tr(
            'Textes, conseils et bilans, ainsi que les noms officiels des champions, objets et runes.',
            'Texts, advice and reviews, plus the official champion, item and rune names.'
          )}
        </p>
      </Card>

      <Card title={tr('Automatisation', 'Automation')}>
        <Toggle
          label={tr('Envoyer les runes automatiquement', 'Send runes automatically')}
          hint={tr(
            'Crée ou met à jour une page « Tactique » pendant la sélection.',
            'Creates or updates a “Tactique” page during champ select.'
          )}
          checked={s.autoRunes}
          onChange={(v) => update({ autoRunes: v })}
        />
        <Toggle
          label={tr('Remplacer la page active si plus de place', 'Replace the active page if full')}
          hint={tr(
            'Désactivé : vos pages ne sont jamais modifiées.',
            'Off: your own pages are never modified.'
          )}
          checked={s.replaceActivePageIfFull}
          onChange={(v) => update({ replaceActivePageIfFull: v })}
        />
        <Toggle
          label={tr('Set d’objets dans la boutique en jeu', 'Item set in the in-game shop')}
          hint={tr(
            'Ajoute un set « Tactique » ; vos propres sets sont conservés.',
            'Adds a “Tactique” item set; your own sets are kept.'
          )}
          checked={s.autoItemSet}
          onChange={(v) => update({ autoItemSet: v })}
        />
        <label className={rowClass}>
          {tr('Source des runes', 'Rune source')}
          <select
            className={selectClass}
            value={s.runeSource}
            onChange={(e) => update({ runeSource: e.target.value as RuneSource })}
          >
            <option value="auto">
              {tr('Auto (méta si à jour, sinon Riot)', 'Auto (meta if up to date, else Riot)')}
            </option>
            <option value="tactique">{tr('Base tactique', 'Tactical database')}</option>
            <option value="riot">{tr('Recommandations Riot', 'Riot recommendations')}</option>
          </select>
        </label>
      </Card>

      <Card title={tr('Bilan et apprentissage', 'Review & learning')}>
        <Toggle
          label={tr('Bilan automatique en fin de partie', 'Automatic post-game review')}
          hint={tr(
            'Analyse chaque partie, à tous les postes (farm, build, combats, objectifs, vision).',
            'Reviews every game, in every role (farm, build, fights, objectives, vision).'
          )}
          checked={s.autoReview}
          onChange={(v) => update({ autoReview: v })}
        />
        <Toggle
          label={tr('Adapter le build à mes résultats', 'Adapt the build to my results')}
          hint={tr(
            'Les objets qui vous réussissent remontent un peu dans le build (effet limité).',
            'Items that work for you move up a little in the build (limited effect).'
          )}
          checked={s.personalLearning}
          onChange={(v) => update({ personalLearning: v })}
        />
      </Card>

      <Card title={tr('Démarrage', 'Startup')}>
        <Toggle
          label={tr('Lancer avec Windows', 'Launch with Windows')}
          hint={tr(
            'L’overlay démarre tout seul à l’ouverture de session (app installée).',
            'The overlay starts on its own when you log in (installed app).'
          )}
          checked={s.launchAtStartup}
          onChange={(v) => update({ launchAtStartup: v })}
        />
      </Card>

      <Card title={tr('Affichage', 'Display')}>
        <label className={rowClass}>
          {tr('Côté de l’écran', 'Screen side')}
          <select
            className={selectClass}
            value={s.side}
            onChange={(e) => update({ side: e.target.value as 'left' | 'right' })}
          >
            <option value="left">{tr('Gauche', 'Left')}</option>
            <option value="right">{tr('Droite', 'Right')}</option>
          </select>
        </label>
        <p className="text-[10px] leading-snug text-slate-500">
          {tr('Raccourci', 'Shortcut')}{' '}
          <b className="text-slate-300">{tr('Ctrl + Maj + T', 'Ctrl + Shift + T')}</b>
          {tr(
            ' : épingler / masquer le panneau. En jeu, utilisez le mode d’affichage « Sans bordures » pour voir l’overlay.',
            ': pin / hide the panel. In game, use the “Borderless” window mode to see the overlay.'
          )}
        </p>
      </Card>

      <Card title={tr('Mise à jour de la méta', 'Meta updates')}>
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          {tr(
            'Méta recalculée chaque nuit à partir des parties Master+ et Or à Émeraude. Laisser vide pour la méta officielle ; une autre URL permet d’utiliser votre propre fichier.',
            'Meta recalculated every night from Master+ and Gold to Emerald games. Leave empty for the official meta; another URL lets you use your own file.'
          )}
        </p>
        <label className={rowClass}>
          {tr('Poste', 'Role')}
          <select
            className={selectClass}
            value={s.role}
            onChange={(e) => update({ role: e.target.value as typeof s.role })}
          >
            <option value="auto">
              {tr('Automatique', 'Automatic')} ({roleLabel(t.role)})
            </option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className={rowClass}>
          {tr('Niveau des données', 'Data level')}
          <select
            className={selectClass}
            value={s.metaLevel}
            onChange={(e) => update({ metaLevel: e.target.value as 'auto' | 'master' | 'gold' })}
          >
            <option value="auto">
              {tr('Selon mon rang', 'From my rank')}
              {t.rankTier ? ` (${t.rankTier.toLowerCase()})` : ''}
            </option>
            <option value="gold">{tr('Or à Émeraude', 'Gold to Emerald')}</option>
            <option value="master">Master+</option>
          </select>
        </label>
        <div className="flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px]"
            placeholder="https://…/meta.json"
            value={metaUrl}
            onChange={(e) => setMetaUrl(e.target.value)}
          />
          <button
            className="rounded bg-lolblue/20 px-2 text-[11px] text-lolblue hover:bg-lolblue/30"
            onClick={() => update({ metaUrl })}
          >
            {tr('Appliquer', 'Apply')}
          </button>
        </div>
        {t.catalogNote && <p className="mt-1.5 text-[10px] text-slate-400">{t.catalogNote}</p>}
      </Card>

      <EngineCard t={t} />

      <UpdateCard token={s.updateToken} onToken={(updateToken) => update({ updateToken })} />

      <Card title={tr('Diagnostic', 'Diagnostics')}>
        <ul className="flex flex-col gap-1 text-[11px] text-slate-300">
          <li>
            {tr('Client LoL', 'LoL client')}:{' '}
            {t.lcuStatus === 'connected'
              ? tr('connecté', 'connected')
              : t.lcuStatus === 'connecting'
                ? tr('recherche…', 'searching…')
                : tr('déconnecté', 'disconnected')}
          </li>
          <li>Phase: {t.phase}</li>
          <li>
            {tr('Données Riot', 'Riot data')}:{' '}
            {t.gd
              ? `version ${t.gd.version}`
              : t.loadError
                ? `${tr('erreur', 'error')} (${t.loadError})`
                : tr('chargement…', 'loading…')}
          </li>
          <li>
            {tr('Base de builds', 'Build database')}: patch {t.catalog.patch} (
            {t.catalog.builds.size} champions ({roleLabel(t.role)}),{' '}
            {t.catalog.origin === 'distante'
              ? tr('distante', 'remote')
              : tr('intégrée', 'built-in')}
            )
          </li>
          <li>
            {tr('Vérification', 'Validation')}:{' '}
            {t.validation.length === 0 ? (
              <span className="text-emerald-300">
                {tr('tous les noms sont valides', 'all names are valid')}
              </span>
            ) : (
              <button
                className="text-orange-300 underline"
                onClick={() => setShowIssues(!showIssues)}
              >
                {t.validation.length} {tr('point(s) à revoir', 'issue(s) to check')}
              </button>
            )}
          </li>
        </ul>
        {showIssues && (
          <ul className="mt-2 max-h-40 overflow-y-auto rounded bg-black/30 p-2 text-[10px] leading-snug text-orange-200">
            {t.validation.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <Toggle
          label={tr('Journal de debug', 'Debug log')}
          hint={tr(
            'Écrit tactique-debug.log dans le dossier de l’application.',
            'Writes tactique-debug.log in the app data folder.'
          )}
          checked={s.debug}
          onChange={(v) => update({ debug: v })}
        />
        {/* Mention exigée par Riot pour les applications tierces (« Legal Jibber Jabber »). */}
        <p className="mt-3 text-[9px] leading-snug text-slate-500">
          {tr(
            'Tactical Analyzer n’est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque participe officiellement à la production ou à la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.',
            "Tactical Analyzer isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."
          )}
        </p>
      </Card>
    </div>
  )
}
