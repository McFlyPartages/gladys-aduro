# gladys-aduro

[English](README.md) · **Français**

Intégration externe [Gladys Assistant](https://gladysassistant.com/) pour les
poêles hybrides à granulés Aduro (H1 à H6). Tout se passe en local : Gladys
parle au poêle avec le protocole NBE de l'application Aduro Hybrid (UDP 8483).
Le relais cloud d'Aduro est un secours facultatif, désactivé par défaut.

Documentation utilisateur : [Français](docs/fr.md) · [English](docs/en.md).

C'est un portage JavaScript de l'intégration Home Assistant
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) et de
[pyduro](https://github.com/clementprevot/pyduro), voir [NOTICE.md](NOTICE.md).

## Fonctionnalités

- Marche/arrêt, puissance I/II/III, température de consigne, mode de
  fonctionnement, chaque changement étant renvoyé jusqu'à ce que le poêle
  l'applique.
- Températures (ambiante, fumées, conduit), puissance de chauffe, monoxyde de
  carbone, état et détail en clair, consommations, granulés restants, temps de
  fonctionnement.
- Arrêt automatique si granulés bas, retour automatique aux granulés après le
  bois, ventilateur et vis sans fin forcés.
- Prédiction de fin des granulés en mode puissance, apprise au fil de
  l'utilisation. Celle du mode température du module Home Assistant (cycles de
  chauffe, prévisions météo) n'est pas reprise.
- Déclencheurs de scène pour les alertes (fumées trop chaudes, feu de bois qui
  faiblit, granulés bas, défaut du poêle).
- Deux widgets de tableau de bord : le poêle avec sa flamme animée et ses
  boutons, et les statistiques.

## Essayer une version de test

1. Sur GitHub, **Actions → Build and publish image → Run workflow**, en
   choisissant la branche à essayer. L'image est publiée sous
   `ghcr.io/mcflypartages/gladys-aduro:<branche>`.
2. Le résumé du build affiche le **manifeste à coller**, avec `docker_image`
   pointant déjà sur cette image.
3. L'image doit être téléchargeable sans identifiants : rendez le package
   public (**Packages → gladys-aduro → Package settings → Change visibility**).
4. Dans Gladys (5.1.0 ou plus récent) : **Intégrations → Installer une
   intégration → Mode développeur**, collez le manifeste.
5. Configurez l'intégration en suivant la [documentation](docs/fr.md).

## Développement

```bash
npm install
npm test              # node --test, sans réseau
npm run lint
npm run format:check
```

Pour la lancer contre une instance Gladys, créez une intégration de
développement dans Gladys et démarrez avec les variables qu'elle fournit :

```bash
GLADYS_HOST_API_URL="http://<gladys>:1443" \
GLADYS_INTEGRATION_TOKEN=... \
GLADYS_INTEGRATION_SELECTOR=... \
DATA_DIR=./data LOG_LEVEL=debug npm start
```

Le numéro de série, le code PIN et l'adresse IP du poêle se saisissent dans
l'écran de configuration de l'intégration, pas dans des variables
d'environnement.

Les images du widget poêle (`assets/stove-*.webp`, WebP animés) sont dessinées
par `npm run render` (`scripts/render-stove.mjs`, SVG + sharp, une dépendance
de développement) et versionnées. Augmentez `ASSETS_VERSION` dans
`src/widgets.js` quand elles changent : Gladys garde une image en cache une
heure.

## Fonctionnement

| Fichier             | Rôle                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `src/protocol.js`   | Trames NBE : codage, décodage, réponses de découverte (portage pyduro) |
| `src/client.js`     | Échanges UDP avec le poêle, un à la fois, avec délai d'attente         |
| `src/readings.js`   | Valeurs à leur position dans les réponses, libellés d'état             |
| `src/stove.js`      | Joindre le poêle, suivi des commandes, granulés, alertes, mode bois    |
| `src/prediction.js` | Consommation apprise par puissance, prédiction de fin des granulés     |
| `src/widgets.js`    | Widgets du tableau de bord : le poêle animé et les statistiques        |
| `src/device.js`     | Le poêle comme appareil Gladys : fonctionnalités, états, commandes     |
| `src/bridge.js`     | Boucle de lecture, publications vers Gladys, événements de scène       |
| `src/store.js`      | Compteurs de granulés et interrupteurs conservés dans `/data`          |
| `index.js`          | Câblage du SDK                                                         |

Les conteneurs d'intégration sont sur un réseau bridge : la recherche par
diffusion est émise par le cœur de Gladys (`network_discovery`,
`udp-active-broadcast` sur le port 8483), tous les autres échanges sont en UDP
unicast depuis le conteneur.

## Licence

MIT, voir [LICENSE](LICENSE).

## Liens

- Code source : [github.com/McFlyPartages/gladys-aduro](https://github.com/McFlyPartages/gladys-aduro)
- Problèmes et suggestions : [issues GitHub](https://github.com/McFlyPartages/gladys-aduro/issues)
- Documentation utilisateur : [Français](docs/fr.md) · [English](docs/en.md)
- Gladys Assistant : [gladysassistant.com](https://gladysassistant.com/) ·
  [intégrations externes](https://gladysassistant.com/fr/docs/dev/external-integrations/)
- Intégration Home Assistant d'origine :
  [NewImproved/Aduro](https://github.com/NewImproved/Aduro)
- Bibliothèque du protocole NBE : [clementprevot/pyduro](https://github.com/clementprevot/pyduro)
