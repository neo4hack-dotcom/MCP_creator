# MCP_creator

`MCP_creator` est un sous-projet autonome qui permet de generer un squelette minimal pour un projet MCP.

## Usage

Depuis ce dossier:

```bash
npm run create demo-mcp
```

Ou directement:

```bash
node src/index.js demo-mcp
```

Le generateur cree un projet dans `generated/<nom-du-projet>/` avec:

- un `package.json`
- un `README.md`
- un `src/index.js`

## Exemple

```bash
cd /Users/mathieumasson/Documents/New\ project/MCP_creator
npm run create weather-mcp
```

## Suite possible

- ajouter des templates TypeScript
- ajouter un mode interactif
- publier le createur comme package CLI

