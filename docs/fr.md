# Aduro

Cette intégration pilote les poêles hybrides à granulés **Aduro H1, H2, H3 et
H5** (H4 et H6 probables, non confirmés) depuis Gladys, en local, avec le même
protocole que l'application Aduro Hybrid.

## Avant de commencer

- Le poêle doit être connecté à votre Wi-Fi (via l'application Aduro Hybrid).
- Relevez son **numéro de série** et son **code PIN** : ils figurent sur
  l'étiquette du poêle et sont ceux que demande l'application.
- Donnez de préférence au poêle une **adresse IP fixe** (réservation DHCP sur
  votre box ou votre routeur).

## Configuration

1. Dans Gladys, ouvrez **Intégrations → Aduro → Configuration**.
2. Renseignez le numéro de série et le code PIN.
3. **Adresse IP** : laissez vide pour que Gladys cherche le poêle sur le réseau
   local. Si le poêle est sur un autre réseau (VLAN) que Gladys, la recherche ne
   le trouvera pas : indiquez son adresse IP.
4. Choisissez le modèle et la langue des textes d'état.
5. Enregistrez, puis ouvrez l'onglet **Appareils** et ajoutez le poêle.

### Relais cloud Aduro

Si le poêle est injoignable en local, l'intégration passe par le relais
d'Aduro (`apprelay20.stokercloud.dk`), comme l'application. Le badge de
l'appareil indique alors « cloud ». Dans ce mode, le numéro de série et le code
PIN circulent **en clair** sur Internet : désactivez « Utiliser le relais cloud
Aduro » si vous ne le souhaitez pas. L'option « Préférer la connexion locale »
désactivée fait passer directement par le relais.

### Réseau

Le poêle écoute en UDP sur le port **8483**. Si un pare-feu sépare Gladys du
poêle, autorisez l'UDP de Gladys vers le poêle sur ce port (les réponses
reviennent par la même session).

## Ce que vous obtenez

**Commandes** : marche/arrêt, puissance (I, II, III), température de consigne
(5 à 35 °C), mode de fonctionnement (puissance, température, bois).
Une puissance ou une consigne fait passer le poêle dans le mode correspondant.
Si le poêle n'applique pas un changement, il est renvoyé jusqu'à trois fois.

**Mesures** : température ambiante, des fumées et du conduit, puissance de
chauffe, monoxyde de carbone, état et détail (avec compte à rebours pendant
l'allumage), consommation (aujourd'hui, hier, mois, année, totale), temps de
fonctionnement.

**Granulés** : le poêle ne mesure pas le contenu de sa trémie. L'intégration
le calcule à partir de la consommation : réglez la capacité de la trémie dans
la configuration et appuyez sur **Granulés rechargés** après chaque
remplissage, sur **Poêle nettoyé** après un nettoyage.

**Interrupteurs** :

- **Arrêt si granulés bas** : arrête le poêle au seuil d'arrêt automatique ;
- **Reprise après le bois** : en mode puissance, repasse aux granulés quand le
  feu de bois s'éteint (fumées sous 110 °C) ;
- **Ventilateur forcé** et **Vis sans fin forcée** : mode manuel, arrêtés
  après la durée configurée (et au-delà de 320 °C de fumées pour le
  ventilateur).

**Boutons** : granulés rechargés, poêle nettoyé, reprendre les granulés,
réarmer l'alarme.

## Scènes

Déclencheurs disponibles : **fumées trop chaudes**, **feu de bois qui
faiblit** (seuils et durées dans la configuration), **granulés bas**, **poêle
arrêté faute de granulés** et **défaut du poêle** (code et libellé de l'état).
Ils permettent par exemple d'envoyer un message quand le poêle s'arrête.

## Limites

- La prédiction de la date d'épuisement des granulés du module Home Assistant
  n'est pas reprise.
- Les poids sont affichés sans unité (Gladys n'a pas d'unité « kg ») : le nom
  de la fonctionnalité l'indique.

## Origine

Portage du module Home Assistant
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) et de la
bibliothèque [pyduro](https://github.com/clementprevot/pyduro), tous deux sous
licence MIT.
