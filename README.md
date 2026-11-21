# Premier · CloudyCat

Site privé de l'équipe Premier : strats par map, compos d'agents, matchs et debriefs. Hébergé sur Vercel, connexion avec Discord, données dans Firebase (même projet que CloudyBot).

## Accès

Connexion avec Discord. Le site vérifie, avec le token du bot, que le joueur a le rôle 🏆・Premier sur CloudyCat ; sans lui, pas d'accès (l'IGL doit donc aussi l'avoir). Toute l'équipe lit tout.

| Qui modifie | Quoi |
|---|---|
| Chaque joueur | Sa propre fiche, les notes générales des maps |
| L'IGL (rôle 🎙️・IGL) | Les strats, les compos, la map de la semaine |
| L'administrateur du site | Tout, dont les matchs |

Le rôle IGL et l'administrateur sont définis dans `lib/access.js`. Le serveur applique ces droits ; l'interface masque seulement les boutons inutiles. Une session dure 12 heures. Le rôle est revérifié auprès de Discord au moins toutes les 5 minutes : le retirer coupe l'accès au site dans ce délai.

## Essayer sans rien installer

Ouvrir `index.html` dans le navigateur (double-clic) : mode démo, les données restent dans ce navigateur. En ligne, ajouter `?demo` à l'adresse donne le même mode.

## Fichiers

| Dossier / fichier | Rôle |
|---|---|
| `index.html` | La page. |
| `css/styles.css` | Le style (sombre, clair si le système le demande). |
| `js/donnees.js` | Pool de maps et agents avec leurs visuels officiels, généré depuis valorant-api.com ; à régénérer quand Riot change le pool. |
| `js/api.js` | Lecture et écriture des données (serveur, ou navigateur en mode démo). |
| `js/app.js` | L'interface : onglets Équipe, Maps, Compos, Matchs. |
| `js/tableau.js` | Le tableau tactique : aperçu avec lecture animée, éditeur plein écran. |
| `api/` | Fonctions Vercel : `login`, `callback`, `logout` (connexion Discord), `me`, `data` (lecture et écriture), `ranks` (relit les rangs en jeu de plus de 6 heures, à chaque ouverture du site), `import` (importe les matchs Premier de l'équipe, au plus toutes les 30 minutes). |
| `lib/` | Code partagé par les fonctions : session signée, contrôle d'accès, Firebase, rang et matchs via HenrikDev. |
| `vercel.json` | En-têtes de sécurité envoyés avec chaque page. |
| `.env.example` | Les variables à renseigner dans Vercel. |

## Mise en ligne

1. Pousser ce dossier sur un dépôt GitHub, puis l'importer dans Vercel (Add New > Project).
2. Dans Vercel > Settings > Environment Variables, renseigner les variables de `.env.example`.
3. Dans le portail développeur Discord, application CloudyBot > OAuth2 > Redirects, ajouter `https://<adresse-du-site>/api/callback`.
4. Redéployer.

## Matchs importés

À l'ouverture du site (au plus toutes les 30 minutes), les historiques Premier des joueurs sont lus sur HenrikDev. Un match est retenu si au moins 3 joueurs du site étaient dans la même équipe : les matchs joués avec une ancienne équipe ne remontent pas. Score, map, adversaire et stats (K/D/A, % de headshots, ACS) viennent du jeu ; le debrief s'écrit à la main et n'est jamais écrasé. L'onglet Matchs affiche aussi le taux de victoire par map, repris sur chaque fiche de map, et chaque card joueur ses moyennes (ACS, K/D, % de headshots, agent le plus joué). Un nouveau match récent (moins de 3 jours) est annoncé par le bot dans 📊・résultats.

## Tableau tactique

Chaque strat peut avoir un tableau dessiné sur la minimap officielle, en plusieurs étapes (setup, exec, post-plant…) : agents (cercle rouge en attaque, bleu en défense), compétences avec leurs icônes, flèches et traits à main levée, zones, textes. « + Étape » copie les agents de l'étape en cours ; il ne reste qu'à les déplacer, et la lecture les fait glisser d'une étape à l'autre. Réservé à l'IGL, comme les strats. Côté serveur, chaque élément est revalidé (coordonnées bornées, 8 étapes et 120 éléments par étape au plus).

## Map de la semaine

L'IGL la choisit dans le bandeau en haut du site ; elle s'affiche sur tous les onglets et l'onglet Maps s'ouvre dessus.

## Données

Firestore, sous `premierStrats/{joueurs|reglages|maps|strats|compos|matchs}/items`. Chaque fiche garde qui l'a modifiée en dernier et quand.

## Sécurité

- **Connexion** : Discord OAuth avec un `state` à usage unique ; aucun mot de passe stocké.
- **Session** : cookie `__Host-` signé (HMAC), `HttpOnly`, `Secure`, `SameSite=Lax`, 12 heures. Changer `SESSION_SECRET` déconnecte tout le monde.
- **Accès** : rôle Premier revérifié sur Discord à chaque requête (résultat gardé 5 minutes).
- **Écritures** : en-tête `X-Premier` obligatoire (bloque les formulaires piégés d'autres sites), champs validés et tronqués côté serveur, 80 Ko maximum par écriture, 40 écritures par minute et par joueur. Chacun ne modifie que sa propre fiche joueur.
- **Navigateur** : politique de sécurité du contenu stricte (scripts du site uniquement, images de Discord et du CDN Valorant seulement), site impossible à afficher dans un cadre, HTTPS forcé, non indexé par les moteurs de recherche.
- **Affichage** : tout le texte saisi est inséré comme texte, jamais comme HTML.
- **Firebase** : les règles Firestore refusent tout accès direct ; seuls le bot et ce site y accèdent, avec la clé de service.
- **Secrets** : uniquement dans les variables Vercel et le `.env` local (ignoré par git).
