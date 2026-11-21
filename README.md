# Premier · CloudyCat

Site privé de l'équipe Premier : strats par map, compos d'agents, matchs et debriefs. Hébergé sur Vercel, connexion avec Discord, données dans Firebase (même projet que CloudyBot).

## Accès

Connexion avec Discord. Le site vérifie, avec le token du bot, que le joueur a le rôle 🏆・Premier ou 🎙️・IGL sur CloudyCat. Tous les membres de l'équipe lisent et modifient. Une session dure 12 heures ; retirer le rôle sur Discord coupe l'accès à la connexion suivante.

## Essayer sans rien installer

Ouvrir `index.html` dans le navigateur (double-clic) : mode démo, les données restent dans ce navigateur. En ligne, ajouter `?demo` à l'adresse donne le même mode.

## Fichiers

| Dossier / fichier | Rôle |
|---|---|
| `index.html` | La page. |
| `css/styles.css` | Le style (sombre, clair si le système le demande). |
| `js/donnees.js` | Pool de maps et agents, à mettre à jour quand Riot change le pool. |
| `js/api.js` | Lecture et écriture des données (serveur, ou navigateur en mode démo). |
| `js/app.js` | L'interface : onglets Maps, Compos, Matchs. |
| `api/` | Fonctions Vercel : `login`, `callback`, `logout` (connexion Discord), `me`, `data` (lecture et écriture). |
| `lib/` | Code partagé par les fonctions : session signée, Firebase. |
| `.env.example` | Les variables à renseigner dans Vercel. |

## Mise en ligne

1. Pousser ce dossier sur un dépôt GitHub, puis l'importer dans Vercel (Add New > Project).
2. Dans Vercel > Settings > Environment Variables, renseigner les variables de `.env.example`.
3. Dans le portail développeur Discord, application CloudyBot > OAuth2 > Redirects, ajouter `https://<adresse-du-site>/api/callback`.
4. Redéployer.

## Données

Firestore, sous `premierStrats/{maps|compos|matchs}/items`. Chaque fiche garde qui l'a modifiée en dernier et quand.
