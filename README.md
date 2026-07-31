# ChessPrep

Aplicación web de preparación ajedrecística para torneos. Convierte partidas públicas de Lichess o archivos PGN en estadísticas trazables y permite recorrer cada partida jugada a jugada.

## Qué incluye este MVP

- Búsqueda de un usuario exacto de Lichess y consulta de sus partidas públicas.
- Dossier de jugador con score global, forma reciente y desglose por color.
- Repertorio por ECO, apertura, color, frecuencia y score.
- Selector `online / OTB / combinado` en todo el análisis.
- Lista de partidas con filtros por texto, color, resultado y apertura.
- Navegación desde una estadística hasta las partidas que la forman.
- Visor con posiciones FEN validadas, controles, reproducción y teclado.
- Importación PGN con validación, deduplicación y dataset temporal con TTL.
- Datos de muestra integrados para que el producto funcione sin red.
- API OpenAPI documentada en `/api/docs`.
- Sin cuentas, base de datos, Redis, colas ni IA generativa.

## Arquitectura

```text
web/                       SPA responsive (HTML, CSS y JavaScript)
api/app/main.py            Endpoints FastAPI y servidor local del frontend
api/app/services/pgn.py    Normalización PGN, SAN, UCI, FEN y deduplicación
api/app/services/stats.py  Filtros y estadísticas deterministas
api/app/services/store.py  Datasets en memoria con caducidad
api/app/providers/         Integración con Lichess
api/tests/                 Pruebas del contrato, parser y estadísticas
docker-compose.yml         Servicios web y api separados
```

El documento técnico proponía Next.js como una tecnología orientativa. Para este MVP se ha usado una SPA sin proceso de build: mantiene la separación `web/api`, reduce dependencias y permite ejecutar el producto con Python solamente. FastAPI también sirve los archivos web en desarrollo; en Docker, Nginx expone el frontend y redirige `/api` al servicio correspondiente.

## Arranque local en Windows

Requiere Python 3.12 o posterior.

```powershell
.\run.ps1
```

Después abre [http://localhost:8000](http://localhost:8000). La documentación interactiva está en [http://localhost:8000/api/docs](http://localhost:8000/api/docs).

Arranque manual:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r api\requirements.txt
.venv\Scripts\python -m uvicorn api.app.main:app --reload --port 8000
```

## Arranque con Docker

```bash
docker compose up --build
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)

## Pruebas

```powershell
.venv\Scripts\python -m pytest -q
```

Las pruebas comprueban el dataset de muestra, los totales estadísticos, los filtros online/OTB, la trazabilidad de una partida, las posiciones del visor y la deduplicación de PGN.

## API principal

```text
GET  /api/v1/players/search?q={usuario}
GET  /api/v1/players/{source}/{external_id}
POST /api/v1/players/{source}/{external_id}/refresh-games
GET  /api/v1/players/{source}/{external_id}/games
GET  /api/v1/players/{source}/{external_id}/stats
GET  /api/v1/players/{source}/{external_id}/stats/by-color
GET  /api/v1/players/{source}/{external_id}/stats/openings
GET  /api/v1/games/{source}/{game_id}
POST /api/v1/datasets
GET  /api/v1/datasets/{dataset_id}/games
GET  /api/v1/datasets/{dataset_id}/stats
```

Cada resultado estadístico declara su muestra, fuentes, modo y rango temporal. Los datasets importados se guardan únicamente en memoria y caducan por defecto a los 30 minutos.

## Configuración

Copia `.env.example` si quieres modificar:

- `CHESSPREP_DATASET_TTL_MINUTES`: duración del dataset temporal.
- `CHESSPREP_LICHESS_MAX_GAMES`: máximo de partidas por actualización.
- `CHESSPREP_CORS_ORIGINS`: orígenes admitidos por la API.

La disponibilidad de Lichess depende de su servicio público. Si la fuente no responde, el análisis de muestra y la importación PGN continúan funcionando.
