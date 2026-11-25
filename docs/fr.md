# Aduro

Cette intégration pilote les poêles hybrides à granulés **Aduro H1, H2, H3 et
H5** (H4 et H6 probables, non confirmés) depuis Gladys. Elle parle **en local**
au poêle, avec le protocole de l'application Aduro Hybrid : rien ne passe par
Internet, sauf si vous activez vous-même le relais cloud d'Aduro.

## 1. Avant de commencer

- Le poêle est connecté à votre Wi-Fi (configuré avec l'application Aduro
  Hybrid).
- Relevez son **numéro de série** et son **code PIN** : ils sont sur
  l'étiquette du poêle, ce sont ceux que demande l'application.
- Donnez au poêle une **adresse IP fixe** (réservation DHCP sur votre box ou
  votre routeur). C'est indispensable si le poêle et Gladys ne sont pas sur le
  même réseau.
- Gladys 5.1.0 ou plus récent.

## 2. Réseau et pare-feu

Le poêle écoute en **UDP sur le port 8483**. L'intégration lui envoie ses
requêtes depuis le port **1901** et le poêle répond vers ce port.

| Sens    | Source            | Destination       | Protocole |
| ------- | ----------------- | ----------------- | --------- |
| Requête | Gladys, port 1901 | Poêle, port 8483  | UDP       |
| Réponse | Poêle, port 8483  | Gladys, port 1901 | UDP       |

- **Même réseau** : rien à faire.
- **Réseaux (VLAN) différents** : autorisez la requête de l'adresse IP de
  Gladys vers celle du poêle (UDP 8483). Un pare-feu à états laisse repasser la
  réponse. Si la vôtre est bloquée, ajoutez la règle de retour (poêle:8483 vers
  Gladys:1901). Les intégrations tournent dans un conteneur Docker : vu du
  pare-feu, la requête vient de l'adresse IP de la machine Gladys. Le port
  source 1901 est normalement conservé par le NAT de Docker.
- **Recherche automatique** : elle se fait par diffusion (broadcast) et ne
  traverse pas les VLAN. Entre deux réseaux, saisissez l'adresse IP du poêle.

## 3. Installation et configuration

1. Installez l'intégration **Aduro** depuis le catalogue des intégrations de
   Gladys.
2. Ouvrez **Configuration** et renseignez :

| Champ                            | Rôle                                                                         | Défaut    |
| -------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Numéro de série                  | Identifie le poêle (étiquette)                                               | —         |
| Code PIN                         | Mot de passe du poêle (étiquette)                                            | —         |
| Adresse IP                       | IP fixe du poêle ; vide = recherche sur le réseau local                      | vide      |
| Modèle                           | H1 à H6, utilisé pour le nom de l'appareil                                   | H2        |
| Utiliser le relais cloud Aduro   | Voir la section 7                                                            | désactivé |
| Langue des états                 | Langue des textes d'état et des noms de fonctionnalités d'un nouvel appareil | anglais   |
| Capacité de la trémie (kg)       | Contenu d'une trémie pleine                                                  | 9,5       |
| Alerte granulés bas (%)          | Niveau qui déclenche « Granulés du poêle bas »                               | 10        |
| Seuil d'arrêt automatique (%)    | Niveau d'arrêt quand « Arrêt si granulés bas » est activé                    | 5         |
| Fumées trop chaudes (°C / s)     | Seuil et durée de l'alerte de surchauffe                                     | 370 / 30  |
| Feu de bois qui faiblit (°C / s) | Seuil et durée de l'alerte en mode bois                                      | 175 / 300 |
| Ventilateur / vis forcés (s)     | Durée maximale des sorties forcées                                           | 60 / 15   |

3. Enregistrez. Le statut de l'intégration passe à « connecté » quand le poêle
   répond.
4. Dans l'onglet **Appareils**, ajoutez le poêle et rangez-le dans une pièce.

Les seuils, la capacité et la langue s'appliquent sans redémarrage. Changer le
numéro de série, le PIN ou l'adresse IP relance la connexion.

## 4. L'appareil

### Commandes

| Fonctionnalité          | Effet                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| Marche                  | Démarre ou arrête le poêle                                                    |
| Puissance               | I, II ou III ; passe le poêle en mode puissance                               |
| Température de consigne | 5 à 35 °C ; passe le poêle en mode température                                |
| Mode de fonctionnement  | Puissance, température ou bois                                                |
| Arrêt si granulés bas   | Arrête le poêle au seuil d'arrêt automatique                                  |
| Reprise après le bois   | En mode puissance, repasse aux granulés quand le feu de bois meurt (< 110 °C) |
| Ventilateur forcé       | Mode manuel ; s'arrête après sa durée ou au-delà de 320 °C de fumées          |
| Vis sans fin forcée     | Mode manuel ; s'arrête après sa durée                                         |
| Granulés rechargés      | Remet la trémie à pleine capacité                                             |
| Poêle nettoyé           | Remet à zéro « Brûlé depuis le nettoyage »                                    |
| Reprendre les granulés  | Quitte le mode bois avec les réglages d'avant                                 |
| Réarmer l'alarme        | Acquitte l'alarme du poêle                                                    |

Un changement de puissance, de consigne ou de mode est suivi jusqu'à ce que le
poêle l'applique : il est renvoyé jusqu'à trois fois, puis abandonné après
100 secondes ou si le poêle est arrêté par ailleurs (bouton, application). Les
changements faits depuis l'application Aduro apparaissent dans Gladys.

### Mesures

Températures (ambiante, fumées, conduit), puissance de chauffe (kW), monoxyde
de carbone (ppm), état et détail en texte (avec compte à rebours pendant
l'allumage), consommations (aujourd'hui, hier, mois, année, totale), granulés
restants (% et kg), autonomie et fin des granulés prévue, brûlé depuis le
nettoyage, temps de fonctionnement du
poêle, de la vis et de l'allumage.

Les valeurs sont relues toutes les 45 secondes, toutes les 5 secondes juste
après une commande. Les consommations et le réseau sont relus toutes les
5 minutes.

### Les granulés

Le poêle ne mesure pas sa trémie : l'intégration déduit le contenu restant de
la consommation qu'il remonte. Pour que le niveau reste juste :

1. réglez la **capacité de la trémie** ;
2. appuyez sur **Granulés rechargés** après chaque remplissage complet ;
3. appuyez sur **Poêle nettoyé** après un nettoyage.

Les compteurs et les interrupteurs sont conservés en cas de redémarrage.

### Prédiction de fin des granulés (mode puissance)

En mode puissance, deux fonctionnalités indiquent quand la trémie sera vide au
niveau en cours :

- **Autonomie en granulés** : heures restantes (utilisable dans les scènes) ;
- **Fin des granulés prévue** : date et heure, avec « estimation » ou
  « fiable ».

L'intégration apprend toute seule la consommation de chaque niveau (I, II, III)
pendant que le poêle brûle de façon stable : une mesure toutes les 30 minutes au
même niveau, ou au changement de niveau après au moins 15 minutes. Elle apprend
aussi ce que consomme un allumage, ajouté quand le poêle n'est pas encore en
marche. Si « Arrêt si granulés bas » est activé, la prédiction s'arrête au
seuil d'arrêt automatique.

- Tant que le niveau en cours a moins de **2 heures** apprises, la
  fonctionnalité affiche « Apprentissage (x h sur 2 h à la puissance II) ».
- Au-delà de **10 heures** apprises au niveau en cours, et des mesures de moins
  de 60 jours, la prédiction passe à « fiable ».
- En mode température ou bois, elle affiche « Non disponible ».

Ce qui est appris est conservé en cas de redémarrage. La prédiction repose sur
le niveau de la trémie : elle n'est juste que si « Granulés rechargés » est
utilisé à chaque remplissage.

## 5. Widgets du tableau de bord

Deux widgets s'ajoutent depuis l'éditeur du tableau de bord.

**Poêle Aduro** : un dessin du poêle dont le feu bouge au rythme de la
puissance (petite, moyenne ou grande flamme), avec des bûches qui brûlent en
mode bois et la vitre éteinte quand le poêle est arrêté. Dessous :

- la température du **foyer** (fumées) et la température **ambiante**, en
  direct ;
- l'état, le détail (compte à rebours d'allumage) et le mode ;
- quatre boutons : **Allumer / Éteindre** (l'arrêt demande confirmation),
  **Petite flamme**, **Flamme moyenne**, **Grande flamme**. Une flamme fait
  passer le poêle en mode puissance ; le bouton de la puissance en cours est
  mis en avant.

**Statistiques Aduro** : niveau de granulés (jauge), autonomie, consommations
du jour, du mois et de l'année, puissance de chauffe ; un graphique des
granulés brûlés **par jour** (31 derniers jours) ou **par mois** (12 derniers
mois), au choix dans les réglages du widget ; puis la fin des granulés prévue
(« ≈ » tant qu'elle n'est pas fiable), les températures des fumées et du
conduit, le monoxyde de carbone (orange ou rouge au-delà des seuils du poêle),
les temps de fonctionnement, les allumages et la consommation apprise par
puissance (kg/h), le brûlé depuis le nettoyage et le total.

## 6. Scènes

| Déclencheur                      | Variables                          |
| -------------------------------- | ---------------------------------- |
| Fumées du poêle trop chaudes     | température                        |
| Feu de bois du poêle qui faiblit | température                        |
| Granulés du poêle bas            | niveau (%), granulés restants (kg) |
| Poêle arrêté faute de granulés   | niveau (%), granulés restants (kg) |
| Défaut du poêle                  | code d'état, libellé               |

Chaque alerte ne se déclenche qu'une fois. Celle des fumées ne se réarme que
lorsque la température est redescendue de 20 °C sous le seuil.

Exemples :

- **Rappel de recharge** : « Granulés du poêle bas » → envoyer un message
  « Il reste {{triggerEvent.data.remaining_kg}} kg de granulés ».
- **Défaut** : « Défaut du poêle » → envoyer un message avec
  `{{triggerEvent.data.state_label}}`.
- **Chauffage programmé** : à 6 h 30 en semaine → régler la température de
  consigne à 21 °C ; à 22 h → éteindre.

## 7. Relais cloud Aduro (facultatif)

Désactivé par défaut. Si vous l'activez, un poêle injoignable en local est joint
par le relais d'Aduro (`apprelay20.stokercloud.dk`), comme le fait
l'application hors de chez vous. Le badge de l'appareil indique alors
« cloud », et l'intégration réessaie le local toutes les 15 minutes.

Dans ce mode, le numéro de série, le code PIN et les commandes circulent **en
clair** sur Internet (le protocole n'est pas chiffré). Avec le relais activé,
décocher « Préférer la connexion locale » fait toujours passer par le cloud.

## 8. Dépannage

| Symptôme                   | Piste                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| « Le poêle ne répond pas » | Vérifiez l'adresse IP, le numéro de série et le PIN, puis le pare-feu (section 2) |
| Aucun appareil à ajouter   | L'appareil n'apparaît qu'une fois que le poêle a répondu                          |
| Badge « injoignable »      | Trois lectures ont échoué ; l'intégration relance la recherche toute seule        |
| Badge « cloud » inattendu  | Le relais est activé et le local échoue : saisissez l'adresse IP                  |
| « État inconnu (NN) »      | Code d'état non répertorié : notez-le et signalez-le                              |
| Niveau de granulés faux    | Réglez la capacité, puis appuyez sur « Granulés rechargés » trémie pleine         |

Les journaux de l'intégration (écran de supervision des intégrations de Gladys)
détaillent chaque échec. Le code PIN n'y apparaît jamais.

## 9. Limites

- La prédiction de fin des granulés ne couvre que le mode puissance : celle du
  mode température (cycles chauffe / attente, prévisions météo) n'est pas
  reprise.
- Gladys n'a pas d'unité « kg » : les poids sont affichés sans unité, le nom de
  la fonctionnalité l'indique.
- Un seul poêle par intégration.

## Origine

Portage du module Home Assistant
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) et de la
bibliothèque [pyduro](https://github.com/clementprevot/pyduro), tous deux sous
licence MIT.
