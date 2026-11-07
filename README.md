# Tactical Analyzer

A free desktop companion for League of Legends, for every role (top, jungle, mid, bot, support).

- **Champion select**: pick and ban suggestions ranked for the current draft (champion strength this
  patch, direct opponent, synergy with allies and matchups against picked enemies, enemy team
  composition, your mastery and your own results), and the usual early game of the enemy jungler.
- **Runes and items**: a rune page and an item order adapted to the enemy team, sent to the client as
  the app's own rune page and item set. During the game, the suggested build keeps adapting to the
  enemy items and to your inventory (build suggestions only).
- **Post-game review**: farm, gold and level against your direct opponent, build compared with the
  suggestion at each purchase, deaths, objectives and vision, against benchmarks of your role and rank.

Statistics come from a nightly job ([tactique-meta](https://github.com/NoeLanternier/tactique-meta))
that reads ranked solo games of Master+ and Gold to Emerald players through the official Riot API
(League-V4, Match-V5) and publishes aggregated, anonymous statistics. The Riot API key is only used by
that job (GitHub Actions secret); this app never contains or uses an API key.

## Riot policies

This edition follows the [Riot Games third-party policies](https://developer.riotgames.com/policies/general):

- No timers (abilities, summoner spells, objectives), no power-spike notifications.
- No alert or message during the game that tells the player what to do based on the game state; the
  in-game panel only shows the suggested build and the enemy team composition analysis.
- No automation of gameplay; nothing is read from or written to the game process. The app uses the
  local client API (rune page, item set, champion select) and the Live Client Data API.
- Only information that players can see in the client or the game is used; no hidden information
  about other players.
- Free, no ads, no paid feature.

The source of truth for the edition is `src/shared/edition.ts` (`RIOT_COMPLIANT = true`).

## Privacy

Everything stays on your computer: settings, post-game reviews (one small JSON file per game) and the
cached meta files. Nothing is sent anywhere; the app only downloads the public meta files and its own
updates from GitHub.

## Development

```
npm ci
npm run dev        # development
npm run build:win  # Windows installer (dist/)
```

Each push to `main` builds and publishes a new version in the GitHub Releases (see
`.github/workflows/release.yml`); installed apps update automatically.

## Legal

Tactical Analyzer isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot
Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and
all associated properties are trademarks or registered trademarks of Riot Games, Inc.
