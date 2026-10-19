# Group Travel

Long journeys on the dnd5e group sheet: stages, provisions, camp comfort, events and fatigue saves.

Module Foundry VTT v14 pour le système dnd5e 6.x.

## Installation

Dans Foundry : **Add-on Modules → Install Module**, puis coller l'adresse du manifeste :

```
https://github.com/rydka/group-travel/releases/latest/download/module.json
```

## Utilisation

1. Activer le module (réglage « Enable Group Travel ») et, au besoin, ajuster les règles maison dans **Configure rules** : valeurs de confort, paliers, actions, allure, eau, reconnaissance des objets, règles officielles.
2. Sur une fiche de groupe dnd5e, l'onglet **Travel** affiche les provisions, l'autonomie, le confort du camp et l'étape en cours. Le MJ configure le voyage (étapes, paliers, table d'événements, ou la table d'exemple), lance l'étape, puis la termine.
3. Pendant l'étape, chaque joueur choisit une action pour son personnage et lance lui-même le test, puis le jet de fatigue de fin d'étape. Le MJ peut lancer à leur place (« Lancer tous les jets en attente », ou terminer l'étape avec les jets automatiques) et annuler la dernière étape.

## Limites connues

- **Jets des joueurs.** Un jet de joueur est prouvé par le message de chat que son client a créé. Le MJ vérifie l'auteur, le DD, les dés (un seul d20 entre 1 et 20) et le total, et refuse un message déjà utilisé. Un joueur qui passe par la console peut malgré tout forger un message cohérent (par exemple `1d20+99`) ou lancer plusieurs fois à l'avance et ne transmettre que le meilleur résultat, pour réussir **sa propre** action ou **sa propre** sauvegarde. Ce risque est accepté : le module s'adresse à des tables de confiance. Un MJ qui veut une certitude lance lui-même les jets.
- **Effets d'événement.** Tous les effets de l'événement s'appliquent à la clôture de l'étape ; un objet abîmé par l'événement ne peut pas être réparé pendant la même étape.

## Développement

```
npm install
npm test        # tests unitaires
npm run lint
```
