# Thao, a short film

Un court-métrage interactif d'environ 4 minutes pour Thao, à ouvrir sur téléphone.
React + Vite + TypeScript, site statique déployé sur GitHub Pages.

Tout le film se passe dans un café, la nuit, éclairé seulement par des ampoules : une salle
brun espresso, la guirlande du café floue au-dessus des photos, et la lumière qui suit ses
gestes. Les couleurs sont dans `src/styles/tokens.css`. L'éclairage de chaque scène est à la
fin de `src/styles/film.css`.

| # | Scène | Ce qu'elle fait |
|---|-------|-----------------|
| 1 | `#lights` | Elle maintient une ampoule froide pour lancer le film. La lumière qu'elle a faite reste derrière le titre « THAO ». |
| 2 | `#sofas` | Elle rapproche vos deux photos d'enfance. On voit vos yeux d'enfants devenir les vôtres sur la photo du parasol, et les ampoules du café s'allument. |
| 3 | `#week` | Elle allume six ampoules, du lundi au samedi, et chaque jour a la sienne. Lundi tremble quand tu fais tomber ta viande, jeudi ne s'allume qu'à moitié, samedi vacille avant de tenir. |
| 4 | `#friday` | Retour au vendredi soir : elle fait la mise au point sur elle. « There you are. » |
| 5 | `#plane` | Samedi, l'aéroport puis l'avion. Une goutte coule sur « I cried ». Elle essuie la buée du hublot, et derrière il y a la nuit. |
| 6 | `#glued` | 10 000 km entre vous : elle essaie de séparer la photo, impossible. « Dính như sam. » Puis tout s'éteint, sauf l'ampoule du parasol. |
| 7 | `#light` | Elle rallume cette ampoule, le café revient autour et des lucioles sortent. Il le dit, ligne par ligne, jusqu'à « I love you. ». La pièce s'éteint doucement, puis « Anh yêu em. » |
| 8 | `#credits` | Générique, puis l'affiche du film à garder (un tap sur l'affiche cache tout le reste, pour une capture propre), et « Wink back ;) ». |

## Modifier les textes

Tout ce qu'elle lit est dans **`src/content.ts`**. En haut du fichier, `config` contient
les infos que toi seul connais. Laissées vides, le film reste vrai sans elles :

- `herName` : son prénom tel qu'elle l'écrit (`'Thảo'` si elle met l'accent : toutes les polices du film savent l'écrire)
- `director` / `me` : ton nom complet (titre, affiche) et ton prénom (générique)
- `city` : la ville où vous vous êtes rencontrés (sinon « Vietnam »)
- `distance` : la distance entre vous (« about 10,000 km »)
- `currentlyApart` : `true` tant que vous êtes loin l'un de l'autre (ajoute « I miss you. »)
- `replyUrl` : **le plus important**, le lien de votre conversation pour le bouton « Wink back ;) ».
  Instagram : `https://ig.me/m/<ton_pseudo>`, Messenger : `https://m.me/<ton_pseudo>`,
  WhatsApp : `https://wa.me/33…`. Sans lien, le bouton copie « ;) » et lui demande de te l'envoyer.
- `showIdiom` : « Dính như sam. » (collés comme des limules, se dit d'un couple inséparable)
- `accentsLine` : « Hope I got the accents right. » après « Anh yêu em. »

Plus bas, dans `copy.plane`, il y a aussi `herMessage` : si tu veux, colle une phrase courte
d'un de ses vrais messages, exactement comme elle l'a écrite. Elle apparaîtra en petit sur le
hublot, une fois la buée essuyée. Laissé vide, rien ne s'affiche.

Relis chaque phrase à voix haute : si tu ne la dirais pas comme ça, change-la.

## Le son

Une musique légère et originale, jouée par le navigateur lui-même : un piano électrique doux sur
un fond chaud, lent. Il n'y a aucun fichier audio et rien qui soit sous licence.

- Elle commence doucement quand elle lâche la première ampoule, parce que les navigateurs
  n'autorisent le son qu'après un geste.
- Elle suit le film : plus mince dans l'avion. Après « I love you. », elle s'éteint doucement avec la
  lumière, sans jamais s'arrêter net, et revient sur l'accord de ré avec « Anh yêu em. ».
  Chaque ampoule de la semaine a sa note.
- Un petit bouton en haut à droite coupe le son, et le téléphone se souvient de son choix.
- Sur iPhone, elle joue même en mode silencieux, comme le son d'une vidéo. Le volume est celui
  de son téléphone.
- Pour un film muet : `sound: false` dans `config`.

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvre l'adresse affichée. Ajoute `#glued`, `#friday`… à la fin de l'URL pour aller
directement à une scène. Pour tester sur ton téléphone : `npm run dev -- --host`, puis
ouvre l'adresse « Network » depuis le téléphone (même Wi-Fi).

## Mettre en ligne (GitHub Pages)

1. Crée un dépôt sur GitHub (un nom neutre, sans son prénom).
2. Dans ce dossier :
   ```bash
   git init && git add -A && git commit -m "Thao"
   git branch -M main
   git remote add origin https://github.com/<toi>/<depot>.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Source : GitHub Actions**.
4. Le workflow `.github/workflows/deploy.yml` construit et publie le site à chaque push.
   L'adresse sera `https://<toi>.github.io/<depot>/`.

Avant de lui envoyer le lien, envoie-le-toi une fois dans Messenger/Instagram pour vérifier
l'aperçu (ces applis gardent l'aperçu en cache).

Pendant le film, l'écran du téléphone reste allumé, même pendant le moment « I love you » où
elle n'a rien à toucher. Si son appli recharge la page en cours de route, le film lui propose
de reprendre là où elle s'était arrêtée.

Pour qu'elle le regarde dans de bonnes conditions : envoie-le en fin de journée pour elle (le
Vietnam a 6 h d'avance sur la France en hiver, 5 h en été), avec une phrase simple, par exemple
« Watch it when you have 4 quiet minutes ».

## Vie privée

- Avec un compte GitHub gratuit, le dépôt doit être **public** pour utiliser Pages :
  n'importe qui qui trouve le dépôt peut voir les photos. Un dépôt privé avec Pages
  demande GitHub Pro.
- Le site demande aux moteurs de recherche de ne pas l'indexer (`noindex` + `robots.txt`).
- Les photos du site sont des copies redimensionnées, sans métadonnées. Les originaux
  dans `ressources/` ne sont jamais envoyés sur GitHub (`.gitignore`).
- L'aperçu du lien ne montre aucun visage.
