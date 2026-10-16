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

## Points de contact avec d'autres modules

Liste maintenue par le développeur et lue par le vérificateur : hooks écoutés, méthodes remplacées, sélecteurs CSS globaux, modules tiers détectés ou adaptés.

- Aucun pour l'instant.
