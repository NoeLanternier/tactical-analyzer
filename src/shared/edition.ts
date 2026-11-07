// Édition de l'app.
// - Personnelle (false) : toutes les alertes en partie (achat à faire, adversaire en avance,
//   rappels selon la partie, affrontement de junglers aussi en partie). Usage strictement privé.
// - Publique (true) : conforme aux règles de Riot pour les applications tierces : rien, pendant la
//   partie, qui dise au joueur quoi faire selon l'état de la partie (alertes, rappels, signaux).
//   Seuls restent le build conseillé et l'analyse de la composition adverse.
export const RIOT_COMPLIANT = true

/**
 * Dépôt GitHub des versions de l'app (mises à jour automatiques). Dépôt privé : l'app a besoin
 * d'un jeton GitHub en lecture seule (Réglages → Application).
 */
export const UPDATE_REPO = { owner: 'NoeLanternier', repo: 'tactical-analyzer' }
