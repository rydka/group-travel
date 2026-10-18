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
| `scripts/main.mjs` | Point d'entrée : hooks `init` (réglages, onglet, requête, API) et `ready` |
| `scripts/api.mjs` | `game.modules.get("group-travel").api` : opérations du MJ, jets, contexte de l'onglet, `core` (tests d'intégration, macros) |
| `scripts/core/` | Calculs purs, sans `game` ni `foundry` (testés par Vitest). Unités : nourriture en rations, eau en **pintes** dans l'inventaire et `planConsumption().intake` (une ration d'eau = `water.pintsPerWaterRation` pintes, 4 par défaut) ; `dailyPrivation` reçoit des rations d'eau (conversion par la couche Foundry) |
| `scripts/foundry/settings.mjs` | Réglages du monde (`DataField`), `getRules()` |
| `scripts/foundry/apps/rules-config.mjs` | Menu « Règles » (ApplicationV2, classe construite à la demande pour rester importable sans Foundry) |
| `scripts/foundry/apps/travel-config.mjs` | Fenêtre « Configurer le voyage » : étapes, paliers, table (glisser-déposer, import depuis un compendium), éditeur des effets des résultats, bouton « Créer la table d'exemple » |
| `scripts/foundry/sheet.mjs` | Onglet : `PARTS`/`TABS`, contexte synchrone (`buildTravelContext`), écouteurs délégués |
| `scripts/foundry/controller.mjs` | Côté client : contrôles de l'onglet → requêtes ou opérations du MJ ; jets des joueurs |
| `scripts/foundry/queries.mjs` | Requête `group-travel.request` (`CONFIG.queries` + `User#query`) ; vérification des droits et des messages de jet |
| `scripts/foundry/service.mjs` | Opérations du MJ (seul écrivain), en file série : voyage, lancement, allure, actions, clôture, jets, annulation |
| `scripts/foundry/read.mjs`, `state.mjs` | Documents → objets simples ; inventaire, autonomie, confort et palier calculés par le cœur |
| `scripts/foundry/rolls.mjs` | Enveloppes de `rollSkill`, `rollToolCheck`, `rollAbilityCheck` et `rollSavingThrow` |
| `scripts/foundry/snapshot.mjs` | Instantané au lancement et restauration (`keepId`) |
| `scripts/foundry/chat.mjs` | Carte d'étape |
| `scripts/foundry/example-table.mjs`, `data/example-events.json` | Table d'exemple créée dans le monde depuis le JSON (pas de compendium) |
| `styles/group-travel.css` | Styles, tous sous la classe `.group-travel` |
| `lang/` | Traductions `en` et `fr`, clés sous `group-travel.*` |
| `templates/` | `travel-tab.hbs`, `travel-config.hbs`, `rules-config.hbs`, `stage-card.hbs` |
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
npm run coverage   # M6, limité à scripts/core/
```

## Vérifications préalables (D0, 2026-10-16, Foundry 14.369, dnd5e 6.0.6)

Faites sur les instances de test 3 et 4 (`test-env/serve.mjs group-travel --instance=3|4`), arrêtées ensuite.

| # | Question | Résultat | Conséquence |
|---|---|---|---|
| a | Le pack LevelDB `packs/travel-events`, lié par jonction, peut-il être ouvert par 2 instances (`run-parallel`) ? | **Non.** L'instance 3 l'ouvre (lecture, écriture, tirage). L'instance 4 échoue au lancement du monde : `LEVEL_DATABASE_NOT_OPEN « Failed to connect to database "group-travel.travel-events" »` (`data-4/Logs/error.*.log`), tente une « database repair » **dans le dossier du dépôt**, puis échoue encore ; `game.packs.get("group-travel.travel-events")` vaut `undefined`. Foundry crée aussi le dossier LevelDB vide dans le dépôt dès qu'il charge un `module.json` qui déclare le pack. | Risque R1 avéré : un pack déclaré dans `module.json` produit une erreur serveur (M1) et un pack absent sur toute instance parallèle. **Décision (Q8) : pas de compendium.** Le bouton « Créer la table d'exemple » de la configuration du voyage crée une RollTable du monde depuis `data/example-events.json`. |
| b | `target` transmis par `rollSkill` / `rollToolCheck` ? | **Oui** : `rolls[0].options.target` = DD donné et `isSuccess` renseigné pour `rollSkill({ skill: "sur", target })`, `rollToolCheck({ tool: "tinker", target })`, `rollAbilityCheck({ ability, target })`, `rollSavingThrow({ ability: "con", target })`, avec `{ configure: false }, { create: false }`. **Mais** `rollToolCheck` avec `tool: null` ou sans `tool` lève `TypeError: Cannot read properties of null/undefined (reading 'split')` (`Trait.keyLabel`, avant le repli sur le test de caractéristique). | Une action « outil » sans outil choisi (réparer, `check.key: null`) doit appeler `rollAbilityCheck({ ability: check.ability })`, jamais `rollToolCheck`. Le champ `check.ability` est ajouté aux actions pour cela. |
| c | `always-interactive` sur un `<select>` de l'onglet pour un joueur OBSERVER du groupe ? | **Oui** : `sheet.isEditable === false` ; `<select>` sans la classe → `disabled` ; avec `always-interactive` → actif, y compris après un nouveau rendu (onglet `travel` resté actif). | Tous les contrôles joueur de l'onglet portent `always-interactive` (sans `name`). |
| d | `_replace` sur `flags.group-travel.travel` ? | **Oui** : une maj ordinaire fusionne (`{a:1,b:{c:1}}` puis `{a:2}` → `{a:2,b:{c:1}}`) ; `_replace({a:3})` remplace (`{a:3}`, source comprise) ; les tableaux sont remplacés ; un autre client (joueur) reçoit la valeur remplacée. | Écrire `travel` avec `_replace` comme prévu. |

## Écarts à la conception (acceptés le 2026-10-16)

1. **Tous les effets d'événement sont appliqués à la clôture**, parce que la garde n'est connue qu'après les actions : `planEvent` renvoie `immediate: []` et tous les effets dans `deferred`. Un objet abîmé par l'événement ne peut donc pas être réparé pendant la même étape.
2. **La garde ne réduit que les malus de confort** : un bonus de confort d'événement reste entier. Les pertes et le nombre d'objets abîmés sont réduits de moitié, arrondi à l'inférieur.
3. **Pas d'objet à abîmer** : l'entrée de `conditionChanges` a `itemId: null` ; elle est ignorée à l'application.
4. **`dailyPrivation`** renvoie aussi `clear: { malnutrition, dehydration }` (retrait de l'état ; en 2014, nourriture **et** eau couvertes). `statuses` ne vaut `true` que si un niveau automatique est ajouté ; une étape de jet porte `status`, posé seulement en cas d'échec. L'état final s'obtient en parcourant les jours dans l'ordre.
5. **Événement** : `losses.waterPints` (la quantité `loseWater` est en rations d'eau) et option `pintsPerWaterRation` de `planEvent`.

Autres choix de mise en œuvre :
- Les jets automatiques du MJ (« tout lancer », `closeStage({ autoRoll: true })`) ne créent pas de message ; la carte d'étape donne les totaux, sans jets joints.
- Le message de jet d'un joueur est retrouvé par un `nonce` dans ses flags ; le MJ vérifie l'auteur, les flags et `options.target` = DD attendu.
- L'onglet n'a qu'un gabarit (pas de partiels).
- La carte d'étape est committée avec le service (D4), qui l'appelle.
- dnd5e remet `disabled = false` sur tout `.always-interactive` : les contrôles indisponibles ne sont pas affichés plutôt que désactivés.
- L'état d'un objet de camp sans flag est restauré en supprimant le flag (`_del`), et l'espace de noms `group-travel` s'il ne contient rien d'autre, pour que les données soient identiques après l'annulation (M5). Le drapeau `undo` est supprimé de même après l'annulation.

## Points de contact avec d'autres modules

Liste maintenue par le développeur et lue par le vérificateur : hooks écoutés, méthodes remplacées, sélecteurs CSS globaux, modules tiers détectés ou adaptés.

| Point de contact | Détail |
|---|---|
| `dnd5e.applications.actor.GroupActorSheet.PARTS.travel` et `.TABS` (statiques, modifiés à `init`) | Ajout d'une part et d'un onglet `travel` (condition : réglage `enabled`). Aucune méthode remplacée ; fiches de véhicule et de rencontre non touchées. |
| Hook `dnd5e.prepareSheetContext` | `context.travel` pour la part `travel` seulement |
| Hook `renderGroupActorSheet` | Écouteurs délégués `click` / `change` sur `[data-application-part="travel"]` (`stopPropagation` sur `change`) |
| `CONFIG.queries["group-travel.request"]` | Requête joueur → MJ actif (pas de socket). Un MJ non actif y envoie aussi ses opérations : seul le MJ actif (`isActiveGM`) écrit. |
| États dnd5e `exhaustion`, `malnutrition`, `dehydration` | `actor.toggleStatusEffect` ; restaurés à l'identique à l'annulation |
| Objets des membres et du groupe | Mises à jour, suppressions et créations (consommation, chasse, annulation avec `keepId`) ; flags `group-travel.condition`, `group-travel.created` |
| Compendiums dnd5e lus | `dnd5e.items` (rations 2014), `dnd5e.equipment24` (rations et eau en pinte 2024) |
| `ChatMessage` | Carte d'étape (flag `group-travel.card`) ; jets des joueurs avec le flag `group-travel.roll` |
| `RollTable` | Tirage par `table.roll()` (la table n'est pas modifiée) ; table d'exemple créée dans le monde ; effets dans `TableResult.flags.group-travel.effects` |
| CSS | Tout sous `.group-travel` ; bannière d'annulation `.group-travel-undone`. Aucun sélecteur global. |
| Modules tiers | Aucun détecté ni adapté. |
