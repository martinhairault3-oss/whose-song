# Whose Song

Jeu de soirée multijoueur à distance. Chacun colle **un lien de playlist**, on
tire des morceaux qui n'appartiennent qu'à **un seul** joueur, une chanson passe,
et tout le monde devine de qui elle vient. Option **blind test** : bonus si tu
trouves aussi le titre.

- **Input** : liens de playlist Deezer (natif) ou Spotify (avec login OAuth).
- **Audio** : extraits 30s via l'API publique de Deezer (gratuite, sans clé), joués dans une balise `<audio>`.
- **Temps réel** : Socket.IO. Chacun sur son téléphone, dans son navigateur.

## Lancer en local

```bash
npm install
npm start
# ouvre http://localhost:3000 sur plusieurs onglets/appareils du même réseau
```

## Déployer (5 min, gratuit)

N'importe quel hébergeur Node marche. Le plus simple : **Railway** ou **Render**.

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur Railway/Render : *New → Deploy from repo*.
3. Commande de démarrage : `npm start`. Le port est lu via `process.env.PORT` (automatique).
4. Partage l'URL publique à tes potes. Chacun ouvre, crée/rejoint un salon avec le code.

## Import Spotify (OAuth)

Deezer marche sans rien configurer. Pour accepter aussi des **liens de playlist
Spotify**, il faut configurer une app Spotify :

1. Crée une app gratuite sur le
   [dashboard développeur Spotify](https://developer.spotify.com/dashboard).
2. Dans les **Redirect URIs** de l'app, ajoute :
   - En local : `http://localhost:3000/auth/spotify/callback`
   - En production : `https://ton-domaine.onrender.com/auth/spotify/callback`
3. Définis les variables d'environnement côté serveur :

```
SPOTIFY_CLIENT_ID=xxxx
SPOTIFY_CLIENT_SECRET=xxxx
```

Chaque joueur qui veut importer une playlist Spotify clique le bouton **Se
connecter à Spotify** dans le lobby. Il autorise l'app, revient automatiquement
dans le salon, puis colle son lien normalement. Les pistes Spotify sont
ensuite matchées sur Deezer (par ISRC, sinon par recherche) pour récupérer
l'extrait jouable.

> **Limite Development Mode** : en mode développement Spotify, seuls **25
> utilisateurs whitelistés** peuvent s'authentifier (tu les ajoutes dans le
> dashboard Spotify, section *User Management*). Pour ouvrir à tout le monde,
> il faut demander une **Extended Quota** à Spotify — c'est un process de
> review.

## Comment marche une partie

1. Un joueur **crée un salon**, les autres **rejoignent** avec le code à 4 lettres.
2. Chacun colle une ou plusieurs playlists dans le lobby (Deezer directement,
   Spotify après s'être connecté).
3. L'hôte règle le nombre de manches + le blind test, puis lance.
4. **Un seul tap "Je suis prêt"** par joueur (obligatoire pour débloquer le son
   sur mobile — voir Limites). Ensuite tout s'enchaîne.
5. À chaque manche : l'extrait joue, chacun devine le propriétaire (+ le titre si
   blind test), puis révélation et points.
6. Classement final. L'hôte peut relancer.

### Points

- Bon propriétaire trouvé : **+100**
- Titre correct (blind test) : **+50**
- Le propriétaire gagne **+20 par joueur piégé** (qui s'est trompé) → récompense
  les morceaux vraiment personnels.

## Limites honnêtes (v1)

- **Le tap de départ est incontournable.** Aucune API ne peut jouer du son sur
  mobile sans un premier geste utilisateur : c'est une règle des navigateurs.
  D'où le bouton « Je suis prêt ». Après ça, c'est automatique.
- **Couverture Deezer ~85-95 %** du grand public. Les morceaux sans extrait
  Deezer (obscurs, indispo dans ta région) sont ignorés silencieusement.
- **Règle d'exclusivité** : un morceau présent chez 2 joueurs devient
  inutilisable (impossible à attribuer). Avec des goûts très proches, le pool
  peut fondre — variez les playlists.
- **Synchro audio** entre téléphones à ~1-2 s près (horloges des appareils). Sans
  impact sur l'équité : la fenêtre de réponse est arbitrée par le serveur.
- **Blind test** : un joueur déterminé pourrait inspecter l'URL de l'extrait pour
  retrouver le titre. Acceptable entre amis ; à durcir si besoin.
- **Spotify Dev Mode** : 25 utilisateurs max. Au-delà, il faut demander Extended
  Quota.
- **Spotify → redirect** : la connexion Spotify fait un aller-retour navigateur
  (3–4 s). Le joueur est reconnecté automatiquement dans le salon ensuite.
- État **en mémoire** : un redémarrage du serveur vide les parties en cours.

## Idées pour la suite

- Résolution YouTube en secours quand Deezer n'a pas l'extrait.
- Refresh automatique du token Spotify (actuellement valide 1h, suffisant pour une soirée).
- Extrait qui démarre à un endroit aléatoire du morceau (plus dur).
- Petit indicateur privé « c'est ton morceau » pour le propriétaire du tour.
- Persistance (Redis) pour survivre aux redémarrages.

## Structure

```
server.js        serveur + Socket.IO + OAuth Spotify + machine à états du jeu
music.js         import playlists (Deezer natif, Spotify via token OAuth)
public/
  index.html     écrans (accueil, lobby, jeu, reveal, classement)
  app.js         logique client + audio synchronisé + flow Spotify
  style.css      thème
```
