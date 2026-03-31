# MCP_creator

`MCP_creator` est une application full-stack qui aide a concevoir, cadrer et generer des serveurs MCP Python bases sur `FastMCP`.

L'objectif est simple: partir d'un besoin metier, guider la conception du MCP dans une interface React, enrichir le blueprint avec un LLM local compatible OpenAI, puis produire un projet Python reutilisable dans `generated/<slug>/`.

## Ce que fait l'application

- interface React + TypeScript guidee
- backend FastAPI pour la logique de generation
- connexion a un LLM local compatible OpenAI
- test de connexion LLM et recuperation de la liste des modeles
- sauvegarde de templates reutilisables de MCP
- generation de blueprints MCP avec fallback deterministe si le LLM echoue
- generation de projets Python `FastMCP`
- support de scaffolds ClickHouse et Oracle Database

## Parcours utilisateur

1. configurer le LLM local
2. tester la connexion et charger les modeles exposes
3. cadrer le MCP: nom, objectif, contexte, garde-fous, dependances
4. ajouter des integrations DB si besoin
5. sauvegarder le cadrage comme template reutilisable
6. decrire les tools, ressources et prompts
7. generer un blueprint
8. generer le projet Python final dans `generated/`

## Stack

- frontend: React 19, TypeScript, Vite
- backend: FastAPI, Pydantic, httpx
- runtime Python genere: `FastMCP`
- support DB genere:
  - ClickHouse via `clickhouse-connect`
  - Oracle Database via `oracledb`

## Prerequis

- Node.js 18+
- npm
- Python 3.10+ recommande
- un serveur LLM local compatible OpenAI si tu veux profiter de la generation assistee

Exemples de serveurs locaux compatibles:

- LM Studio avec API OpenAI-compatible
- vLLM expose derriere `/v1`
- toute passerelle locale exposant `/v1/chat/completions`

## Installation rapide

### Windows PowerShell

```powershell
cd "C:\path\to\MCP_creator"
npm install
npm run setup:python
npm run dev
```

Le script `setup:python` detecte automatiquement:

- `PYTHON_BIN` si defini
- `.venv\Scripts\python.exe`
- `venv\Scripts\python.exe`
- `py -3`
- `python`
- `python3`

### macOS / Linux

```bash
cd /path/to/MCP_creator
npm install
npm run setup:python
npm run dev
```

Le script `setup:python` detecte automatiquement:

- `PYTHON_BIN` si defini
- `.venv/bin/python`
- `venv/bin/python`
- `python3`
- `python`
- `py -3`

## Lancement manuel

### Frontend seulement

```bash
npm run dev:web
```

Frontend disponible sur `http://127.0.0.1:3000`

### Backend seulement

```bash
npm run dev:api
```

Backend disponible sur `http://127.0.0.1:8000`

### Backend sans reload

```bash
npm run start:api
```

## Scripts disponibles

- `npm run setup`
  - alias de `npm run setup:python`
- `npm run setup:python`
  - cree `.venv` si besoin et installe les dependances Python backend
- `npm run dev`
  - lance frontend et backend en parallele
- `npm run dev:web`
  - lance Vite
- `npm run dev:api`
  - lance FastAPI via un script Node multiplateforme
- `npm run start:api`
  - lance l'API sans reload
- `npm run lint`
  - verification TypeScript
- `npm run build`
  - build frontend de production
- `npm run preview`
  - sert le build frontend
- `npm run check:backend`
  - compile le backend Python pour un smoke check rapide

## Configuration du LLM local

L'application permet de renseigner:

- `baseUrl`
- `apiKey`
- `model`
- `temperature`

Fonctionnalites disponibles dans l'UI:

- test de connexion au serveur local
- chargement de la liste des modeles via `/models`
- selection rapide d'un modele detecte

Comportement de fallback:

- si `/models` est disponible, l'app liste les modeles et verifie le modele selectionne
- si `/models` n'est pas exploitable mais qu'un modele est saisi, l'app peut tester un appel chat minimal
- si le LLM ne repond pas correctement lors de la generation du blueprint, l'app repasse sur une generation fallback interne

Les settings LLM sont stockes localement dans:

- `backend/data/settings.json`

Ce fichier est ignore par Git.

## Templates reutilisables

Les templates servent a sauvegarder un cadrage complet de MCP pour le reutiliser plus tard.

Un template peut contenir:

- le nom et la description du projet
- le contexte metier
- les garde-fous
- les dependances externes
- les scenarios de test
- les integrations ClickHouse / Oracle
- les tools
- les ressources
- les prompts

Fonctionnalites disponibles:

- enregistrer le MCP courant comme template
- reappliquer un template en un clic
- mettre a jour un template existant
- supprimer un template obsolet

Les templates sont stockes localement dans:

- `backend/data/templates.json`

Ce fichier est ignore par Git.

## Generation de MCP

Quand tu lances un preview ou une generation:

1. le frontend envoie le `ProjectSpec` au backend
2. le backend charge les settings LLM
3. il tente une generation de blueprint via le LLM local
4. si le LLM echoue ou renvoie un JSON inexploitable, un fallback deterministe prend le relais
5. le backend normalise le blueprint
6. lors de la generation finale, les fichiers du MCP sont ecrits dans `generated/<package_name>/`

Les fichiers generes contiennent typiquement:

- `server.py`
- `README.md`
- `requirements.txt`
- `.env.example`
- `pyproject.toml`

## ClickHouse et Oracle

Quand une integration DB est activee dans le cadrage, le MCP genere peut inclure:

- dependances Python adaptees
- variables d'environnement dans `.env.example`
- helper de connexion
- tool de `ping`
- tool de `schema`
- tool de `query` en lecture seule

### ClickHouse

Le scaffold ClickHouse:

- utilise `clickhouse-connect`
- s'appuie sur des variables d'environnement
- genere un acces read-only base sur `SELECT`

Variables d'environnement typiques:

- `CLICKHOUSE_HOST`
- `CLICKHOUSE_PORT`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_SECURE`

### Oracle Database

Le scaffold Oracle:

- utilise `python-oracledb`
- fonctionne en mode Thin par defaut
- ne demande pas Oracle Client pour les cas standards
- limite les requetes scaffold a `SELECT` et `WITH`

Variables d'environnement typiques:

- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_DSN`
- `ORACLE_HOST`
- `ORACLE_PORT`
- `ORACLE_SERVICE_NAME`

## Structure du projet

```text
MCP_creator/
├── backend/
│   ├── app.py
│   ├── generator.py
│   ├── llm_client.py
│   ├── models.py
│   ├── requirements.txt
│   ├── storage.py
│   └── data/
├── scripts/
│   ├── check-backend.mjs
│   ├── python-runtime.mjs
│   ├── run-api.mjs
│   └── setup-python.mjs
├── src/
│   ├── App.tsx
│   ├── api.ts
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── generated/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Architecture resumee

### Frontend

Le frontend:

- pilote le wizard de creation
- gere les settings LLM
- affiche la liste des modeles disponibles
- permet de gerer les templates
- affiche le preview du blueprint
- declenche la generation finale

Fichiers principaux:

- `src/App.tsx`
- `src/api.ts`
- `src/types.ts`

### Backend

Le backend:

- expose l'API FastAPI
- persiste settings et templates
- interroge le LLM local
- construit et normalise le blueprint
- genere les projets Python

Fichiers principaux:

- `backend/app.py`
- `backend/storage.py`
- `backend/llm_client.py`
- `backend/generator.py`

## API principale

Routes exposees actuellement:

- `GET /api/health`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/llm/models`
- `POST /api/llm/test`
- `GET /api/templates`
- `POST /api/templates`
- `PUT /api/templates/{template_id}`
- `DELETE /api/templates/{template_id}`
- `POST /api/preview`
- `POST /api/generate`

## Exemple de workflow

1. ouvrir l'app
2. configurer le LLM local
3. tester la connexion
4. charger les modeles puis en choisir un
5. decrire le MCP
6. activer ClickHouse ou Oracle si necessaire
7. enregistrer le cadrage comme template
8. ajouter les tools, ressources et prompts
9. generer un blueprint
10. generer le projet final

## Validation

Verification recommandee apres modification du code:

```bash
npm run check:backend
npm run lint
npm run build
```

## Notes sur les MCPs generes

Les serveurs generes suivent le pattern `FastMCP` avec:

- `FastMCP(...)`
- `@mcp.tool`
- `@mcp.resource(...)`
- `@mcp.prompt`

Le scaffold ajoute aussi:

- `ResourcesAsTools`
- `PromptsAsTools`

pour ameliorer la compatibilite avec les clients qui ne supportent que les tools.

## Limites actuelles

- la qualite du blueprint depend en partie de la qualite du prompt et du LLM local
- les integrations DB generees sont des scaffolds read-only, pas une couche metier finale
- les credentials DB et LLM restent volontairement locaux et hors Git
- les MCPs generes demandent encore un travail metier pour brancher la vraie logique applicative

## Prochaines evolutions possibles

- templates systeme precharges
- presets par type de MCP
- export / import de templates
- tests automatiques sur les projets generes
- generation de scaffolds plus specialises par domaine
