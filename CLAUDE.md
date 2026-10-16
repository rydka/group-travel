# Group Travel (`group-travel`)

Module Foundry VTT de l'atelier (voir le `CLAUDE.md` de l'atelier, deux niveaux au-dessus, pour les règles communes). Ce fichier fait foi pour ce module.

## Objectif

Long journeys on the dnd5e group sheet: stages, provisions, camp comfort, events and fatigue saves.

## Cibles

Foundry v14, dnd5e 6.x. Toute API utilisée doit exister dans ces versions. Consulter les sources en lecture seule :
- Foundry : `C:/Users/Shadow/AppData/Local/Programs/Foundry Virtual Tabletop/resources/app`
- dnd5e : `C:/Users/Shadow/AppData/Local/FoundryVTT/Data/systems/dnd5e`

## Structure

| Chemin | Contenu |
|---|---|
| `module.json` | Manifeste. `version` est réécrite par le workflow de release. |
| `scripts/main.mjs` | Point d'entrée : hooks `init` et `ready` |
| `styles/group-travel.css` | Styles, tous sous la classe `.group-travel` |
| `lang/` | Traductions `en` et `fr`, clés sous `group-travel.*` |
| `templates/` | Templates Handlebars |
| `tests/unit/` | Tests Vitest avec les faux globaux Foundry de `tests/setup/` |
| `tests/integration/` | Tests dans un vrai Foundry, servent de preuve de fonctionnement |

## Conventions

- Tout ce que le module ajoute est préfixé par l'identifiant `group-travel` : réglages, flags, sockets, clés de traduction, classes CSS, hooks personnalisés (`group-travel.<nom>`).
- Pas de modification directe des prototypes de Foundry ou de dnd5e. Préférer les hooks et l'API publique. Si c'est impossible, le documenter ici dans « Points de contact avec d'autres modules ».
- Toute logique testable est exportée depuis un fichier sans effet de bord à l'import (sauf l'enregistrement de hooks dans `main.mjs`).

## Commandes

```
npm install
npm test
npm run lint
```

## Vérifications préalables (D0, 2026-10-16, Foundry 14.369, dnd5e 6.0.6)

Faites sur les instances de test 3 et 4 (`test-env/serve.mjs group-travel --instance=3|4`), arrêtées ensuite.

| # | Question | Résultat | Conséquence |
|---|---|---|---|
| a | Le pack LevelDB `packs/travel-events`, lié par jonction, peut-il être ouvert par 2 instances (`run-parallel`) ? | **Non.** L'instance 3 l'ouvre (lecture, écriture, tirage). L'instance 4 échoue au lancement du monde : `LEVEL_DATABASE_NOT_OPEN « Failed to connect to database "group-travel.travel-events" »` (`data-4/Logs/error.*.log`), tente une « database repair » **dans le dossier du dépôt**, puis échoue encore ; `game.packs.get("group-travel.travel-events")` vaut `undefined`. Foundry crée aussi le dossier LevelDB vide dans le dépôt dès qu'il charge un `module.json` qui déclare le pack. | Risque R1 avéré : un pack déclaré dans `module.json` produit une erreur serveur (M1) et un pack absent sur toute instance parallèle. Repli Q8 recommandé (bouton « Créer la table d'exemple » depuis un JSON du module), ou tests du pack sur une seule instance. **La déclaration `packs` n'est pas committée** en attendant la décision (diff gardé hors dépôt). `packs/*/` reste ignoré par git. |
| b | `target` transmis par `rollSkill` / `rollToolCheck` ? | **Oui** : `rolls[0].options.target` = DD donné et `isSuccess` renseigné pour `rollSkill({ skill: "sur", target })`, `rollToolCheck({ tool: "tinker", target })`, `rollAbilityCheck({ ability, target })`, `rollSavingThrow({ ability: "con", target })`, avec `{ configure: false }, { create: false }`. **Mais** `rollToolCheck` avec `tool: null` ou sans `tool` lève `TypeError: Cannot read properties of null/undefined (reading 'split')` (`Trait.keyLabel`, avant le repli sur le test de caractéristique). | Une action « outil » sans outil choisi (réparer, `check.key: null`) doit appeler `rollAbilityCheck({ ability: check.ability })`, jamais `rollToolCheck`. Le champ `check.ability` est ajouté aux actions pour cela. |
| c | `always-interactive` sur un `<select>` de l'onglet pour un joueur OBSERVER du groupe ? | **Oui** : `sheet.isEditable === false` ; `<select>` sans la classe → `disabled` ; avec `always-interactive` → actif, y compris après un nouveau rendu (onglet `travel` resté actif). | Tous les contrôles joueur de l'onglet portent `always-interactive` (sans `name`). |
| d | `_replace` sur `flags.group-travel.travel` ? | **Oui** : une maj ordinaire fusionne (`{a:1,b:{c:1}}` puis `{a:2}` → `{a:2,b:{c:1}}`) ; `_replace({a:3})` remplace (`{a:3}`, source comprise) ; les tableaux sont remplacés ; un autre client (joueur) reçoit la valeur remplacée. | Écrire `travel` avec `_replace` comme prévu. |

## Points de contact avec d'autres modules

Liste maintenue par le développeur et lue par le vérificateur : hooks écoutés, méthodes remplacées, sélecteurs CSS globaux, modules tiers détectés ou adaptés.

- Aucun pour l'instant.
