# ChessPrep

Aplicación web de preparación ajedrecística para torneos. Convierte partidas públicas de Lichess y Chess.com, resultados OTB de Info64 o archivos PGN en estadísticas trazables y permite recorrer las partidas que incluyen jugadas.

## Qué incluye este MVP

- Búsqueda de usuarios exactos de Lichess y Chess.com.
- Dossier combinado para unir ambas plataformas aunque los alias sean distintos.
- Dossier de jugador con score global, forma reciente y desglose por color.
- Repertorio por ECO, apertura, color, frecuencia y score.
- Selector de ritmo `global / bullet / blitz / rápida / lenta` aplicado a partidas y estadísticas; global incluye todos los ritmos estándar.
- Solo se analizan partidas de ajedrez estándar; Chess960, pasapiezas, Crazyhouse y demás variantes se excluyen tanto desde los proveedores como al importar PGN.
- Lista de partidas con filtros por texto, color, resultado y apertura.
- Navegación desde una estadística hasta las partidas que la forman.
- Visor con posiciones FEN validadas, controles, reproducción y teclado.
- Análisis Stockfish en el cliente (Web Worker): calidad de jugadas, barra y curva de evaluación, mejor jugada, precisión, momentos clave y modo explorar.
- Búsqueda OTB por ID FIDE: ficha oficial, participaciones de Info64 contrastadas por el mismo ID, rivales, resultados, rondas, fechas y balance con filtro temporal.
- Importación PGN OTB opcional, con verificación de identidad, deduplicación y dataset temporal con TTL para reproducir las jugadas.
- Datos de muestra integrados para que el producto funcione sin red.
- API OpenAPI documentada en `/api/docs`.
- Sin cuentas, base de datos, Redis, colas ni IA generativa.

## Arquitectura

```text
web/                       SPA responsive (HTML, CSS y JavaScript)
web/js/                    Motor Stockfish (cliente), calidad de jugadas y modo explorar
web/vendor/                chess.js y Stockfish WASM/JS (ver vendor/NOTICE.md)
api/app/main.py            Endpoints FastAPI y servidor local del frontend
api/app/services/pgn.py    Normalización PGN, SAN, UCI, FEN y deduplicación
api/app/services/stats.py  Filtros y estadísticas deterministas
api/app/services/store.py  Datasets en memoria con caducidad
api/app/providers/         Integraciones con Lichess, Chess.com, FIDE e Info64
api/tests/                 Pruebas del contrato, parser y estadísticas
docker-compose.yml         Servicios web y api separados
```

### Análisis Stockfish (cliente)

El visor puede activar **Analizar** (tecla `A`) para evaluar la partida en el navegador con Stockfish. No hay endpoint de motor en la API: el Worker carga `/vendor/stockfish/stockfish.js` y clasifica cada jugada por pérdida en centipawns. En el panel puedes ajustar **profundidad (5–30)** y **líneas MultiPV (1–30)**; por defecto usa profundidad 14 y 3 líneas. El modo **Explorar** (tecla `E`) permite probar jugadas en la posición actual. El tiempo depende de la CPU del dispositivo; partidas largas se rellenan de forma progresiva.

El documento técnico proponía Next.js como una tecnología orientativa. Para este MVP se ha usado una SPA sin proceso de build: mantiene la separación `web/api`, reduce dependencias y permite ejecutar el producto con Python solamente. FastAPI también sirve los archivos web en desarrollo; en Docker, Nginx expone el frontend y redirige `/api` al servicio correspondiente.

### Muestras, ritmos y variantes

La interfaz solicita como máximo las 100 partidas estándar más recientes de cada proveedor. El ritmo **Global** no aplica un filtro temporal; **Bullet**, **Blitz**, **Rápida** y **Lenta** muestran únicamente su categoría.

Lichess se consulta solo con sus modalidades estándar (`ultraBullet`, `bullet`, `blitz`, `rapid`, `classical` y `correspondence`). En Chess.com se aceptan exclusivamente partidas con `rules="chess"`. La misma regla se aplica a los PGN importados: se omiten Chess960, pasapiezas, Crazyhouse, atómico, antiajedrez y cualquier partida declarada como variante o con una posición inicial no estándar. Cuando el proveedor permite contabilizarlas, la respuesta incluye un aviso con el número de partidas descartadas.

Un ECO ausente se conserva como valor nulo y se representa visualmente con `—`. Al pulsar una fila de aperturas, el listado se filtra por ECO, nombre y color; por tanto, el total mostrado corresponde exactamente al grupo seleccionado, incluso en aperturas sin ECO.

### Resultados OTB de Info64

La búsqueda OTB parte siempre de un ID FIDE numérico. ChessPrep obtiene primero el nombre de la [ficha oficial de FIDE](https://ratings.fide.com/), lo busca en el [buscador público de jugadores de Info64](https://info64.org/search-player) y abre cada participación candidata. Una participación solo cuenta si su ficha de torneo enlaza exactamente al mismo ID FIDE; una coincidencia de nombre por sí sola no se acepta.

Para cada emparejamiento se muestran rival, rating e ID FIDE cuando constan, color, resultado, torneo, ronda, mesa y fecha. También se conservan los rivales sin ficha FIDE y se puede alternar entre todos, federados y no federados; aquí «federado» significa que Info64 publica un ID FIDE, aunque el jugador no tenga Elo. El buscador de rival acepta fragmentos del nombre o el ID FIDE, ignora mayúsculas y acentos, y actualiza el balance al instante sobre el grupo visible. La fecha procede del calendario de rondas de Info64; si un torneo solo publica su intervalo general, se marca con `≈` y el filtro temporal compara ese intervalo. La interfaz acepta fechas en formato español `dd/mm/aaaa` y ofrece periodos rápidos sin depender del calendario nativo del navegador.

Info64 publica resultados y estadísticas de torneos, pero no garantiza que incluya el PGN. Por eso estos resultados no abren el visor de jugadas. La importación manual permanece como opción secundaria para quien tenga un PGN y quiera reproducir o analizar las posiciones. La disponibilidad y el histórico dependen de los torneos publicados en Info64; no es una base exhaustiva de todas las partidas OTB del jugador.

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

Las pruebas comprueban el dataset de muestra, los totales estadísticos, los filtros por ritmo y apertura, la exclusión de variantes, la trazabilidad de una partida, las posiciones del visor, las integraciones de proveedor y la deduplicación de PGN.

## API principal

```text
GET  /api/v1/players/search?q={usuario}
POST /api/v1/players/combined
GET  /api/v1/players/{source}/{external_id}
POST /api/v1/players/{source}/{external_id}/refresh-games
GET  /api/v1/players/{source}/{external_id}/games
GET  /api/v1/players/{source}/{external_id}/stats
GET  /api/v1/players/{source}/{external_id}/stats/by-color
GET  /api/v1/players/{source}/{external_id}/stats/openings
GET  /api/v1/games/{source}/{game_id}
GET  /api/v1/fide/players/{fide_id}
GET  /api/v1/fide/players/{fide_id}/info64-results?from={YYYY-MM-DD}&to={YYYY-MM-DD}
POST /api/v1/datasets
GET  /api/v1/datasets/{dataset_id}/games
GET  /api/v1/datasets/{dataset_id}/stats
```

Cada resultado estadístico declara su muestra, fuentes, ritmo y rango temporal. Los datasets importados se guardan únicamente en memoria y caducan por defecto a los 30 minutos.

## Configuración

Copia `.env.example` si quieres modificar:

- `CHESSPREP_DATASET_TTL_MINUTES`: duración del dataset temporal.
- `CHESSPREP_LICHESS_MAX_GAMES`: límite predeterminado de Lichess cuando la llamada no indica uno explícito.
- `CHESSPREP_CHESSCOM_MAX_GAMES`: límite predeterminado de Chess.com cuando la llamada no indica uno explícito.
- `CHESSPREP_INFO64_MAX_TOURNAMENTS`: máximo de participaciones recientes de Info64 verificadas en cada consulta OTB (1–100; 30 por defecto).
- `CHESSPREP_CORS_ORIGINS`: orígenes admitidos por la API.
- `CHESSPREP_ALLOWED_HOSTS`: nombres de host admitidos, sin protocolo ni puerto.
- `CHESSPREP_ENABLE_DOCS`: activa o desactiva `/api/docs` y el esquema OpenAPI.

## Seguridad al desplegar

La aplicación trata nombres, eventos y cabeceras PGN como texto, aplica codificación contextual en el navegador y normaliza los campos externos antes de guardarlos temporalmente. También limita los PGN a 5 MB y 500 partidas, restringe las URLs consultadas a los proveedores previstos y envía CSP, anti-framing, `nosniff`, política de permisos y otras cabeceras defensivas. El Nginx incluido añade además límite de cuerpo y limitación básica de peticiones a la API.

Antes de publicar, configura `CHESSPREP_ALLOWED_HOSTS` con el dominio exacto y `CHESSPREP_CORS_ORIGINS` con el origen HTTPS real. Si no necesitas la documentación interactiva, usa `CHESSPREP_ENABLE_DOCS=false`. Termina TLS en el proxy o plataforma de despliegue y configura HSTS allí; no se incluye HSTS en el contenedor porque el entorno local funciona por HTTP.

La disponibilidad de Lichess, Chess.com, FIDE e Info64 depende de sus respectivos servicios. Si una plataforma online no responde, el dossier combinado utiliza las demás que estén disponibles. Para consultar resultados OTB se exige un ID FIDE válido y cada participación de Info64 se vuelve a comprobar contra él. El ID y los resultados no proporcionan por sí solos las jugadas; el PGN solo es necesario para reproducir y analizar posiciones.
