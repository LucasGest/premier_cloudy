# Premier · CloudyCat

Site privé de l'équipe Premier : strats par map, compos d'agents, matchs et debriefs. Hébergé sur Vercel, connexion avec Discord, données dans Firebase (même projet que CloudyBot).

## Accès

Connexion avec Discord. Le site vérifie, avec le token du bot, que le joueur a le rôle 🏆・Premier sur CloudyCat ; sans lui, pas d'accès (l'IGL doit donc aussi l'avoir). Tous les membres de l'équipe lisent et modifient. Une session dure 12 heures. Le rôle est revérifié auprès de Discord au moins toutes les 5 minutes : le retirer coupe l'accès au site dans ce délai.

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
| `api/` | Fonctions Vercel : `login`, `callback`, `logout` (connexion Discord), `me`, `data` (lecture et écriture), `ranks` (relit les rangs en jeu de plus de 6 heures, à chaque ouverture du site). |
| `lib/` | Code partagé par les fonctions : session signée, contrôle d'accès, Firebase, rang via HenrikDev. |
| `vercel.json` | En-têtes de sécurité envoyés avec chaque page. |
| `.env.example` | Les variables à renseigner dans Vercel. |

## Mise en ligne

1. Pousser ce dossier sur un dépôt GitHub, puis l'importer dans Vercel (Add New > Project).
2. Dans Vercel > Settings > Environment Variables, renseigner les variables de `.env.example`.
3. Dans le portail développeur Discord, application CloudyBot > OAuth2 > Redirects, ajouter `https://<adresse-du-site>/api/callback`.
4. Redéployer.

## Données

Firestore, sous `premierStrats/{joueurs|maps|strats|compos|matchs}/items`. Chaque fiche garde qui l'a modifiée en dernier et quand.

## Sécurité

- **Connexion** : Discord OAuth avec un `state` à usage unique ; aucun mot de passe stocké.
- **Session** : cookie `__Host-` signé (HMAC), `HttpOnly`, `Secure`, `SameSite=Lax`, 12 heures. Changer `SESSION_SECRET` déconnecte tout le monde.
- **Accès** : rôle Premier revérifié sur Discord à chaque requête (résultat gardé 5 minutes).
- **Écritures** : en-tête `X-Premier` obligatoire (bloque les formulaires piégés d'autres sites), champs validés et tronqués côté serveur, 30 Ko maximum par écriture, 40 écritures par minute et par joueur. Chacun ne modifie que sa propre fiche joueur.
- **Navigateur** : politique de sécurité du contenu stricte (scripts du site uniquement, images de Discord et du CDN Valorant seulement), site impossible à afficher dans un cadre, HTTPS forcé, non indexé par les moteurs de recherche.
- **Affichage** : tout le texte saisi est inséré comme texte, jamais comme HTML.
- **Firebase** : les règles Firestore refusent tout accès direct ; seuls le bot et ce site y accèdent, avec la clé de service.
- **Secrets** : uniquement dans les variables Vercel et le `.env` local (ignoré par git).
