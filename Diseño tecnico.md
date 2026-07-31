# ChessPrep — Documento Técnico de Diseño (Web)

**Fecha:** 31 de julio de 2026  
**Producto:** aplicación web (navegador). Sin APIs de IA generativa. Sin empaquetado nativo (Capacitor / tiendas) en el alcance actual.
**Decisión de arquitectura MVP:** sin cuentas y sin persistencia; las partidas se consultan, procesan y mantienen temporalmente en memoria o en archivos temporales con caducidad.

---

## 1. Resumen del proyecto

ChessPrep es una **aplicación web de preparación ajedrecística** con dos funciones principales:

1. **Visor de partidas paso a paso** — abrir una partida del rival y recorrerla jugada a jugada sobre un tablero interactivo.
2. **Estadísticas del jugador** — ver datos agregados y objetivos sobre su juego (rendimiento con blancas/negras, aperturas, piezas relevantes, etc.), siempre trazables a un conjunto concreto de partidas.

El flujo típico: buscar un rival → ingerir/consultar sus partidas públicas → explorar estadísticas o abrir una partida y avanzar/retroceder en el tablero.

No hay redacción automática de informes ni llamadas a modelos de lenguaje. Toda la información que ve el usuario sale de datos de partidas (PGN) y de cálculos deterministas en el backend.

En el MVP no hay cuentas de usuario ni necesidad de conservar datos entre sesiones. El backend puede consultar una fuente externa, normalizar el PGN, calcular las estadísticas y descartar el conjunto de partidas al terminar. Para flujos de varias peticiones —por ejemplo, una importación PGN desde el navegador— se permite una caché temporal con TTL o un archivo temporal, sin convertirla en almacenamiento permanente.

Principios de diseño:

- **Dos pilares de producto.** Cualquier pantalla o endpoint debe servir al visor o a las estadísticas (o a ambas: p. ej. “abrir partidas de esta apertura”).
- **Nunca inventar datos.** Todo número mostrado debe ser trazable a una fuente y a un conjunto de partidas concreto.
- **Multi-fuente por diseño.** Ninguna fuente externa es obligatoria; el sistema degrada si una falla o no existe.
- **Separación online / OTB / combinado.** Estadísticas y listados de partidas se pueden acotar por tipo.
- **Sin IA generativa.** No hay LLM ni APIs de IA. El motor de ajedrez (Stockfish), si se usa, es evaluación numérica opcional sobre posiciones, no generación de texto.
- **Web-first.** UI en el navegador; lógica pesada (ingesta, agregaciones, evaluación) en el backend.

---

## 2. Funciones principales

### 2.1 Visor de partidas paso a paso

Objetivo: estudiar cómo juega el rival en partidas concretas.

| Capacidad | Detalle |
|---|---|
| Lista de partidas | Filtrable por color, apertura/ECO, resultado, fecha, modo (online/OTB/combinado), rival |
| Navegación jugada a jugada | Avanzar / retroceder / ir a jugada N; teclado y controles en pantalla |
| Tablero interactivo | `react-chessboard` + `chess.js` (o equivalente); FEN/PGN desde la API |
| Metadatos | Evento, fecha, resultado, ECO, fuente, Elo si existe |
| Enlace desde stats | Desde una apertura o un filtro estadístico, saltar a las partidas que lo componen |
| Evaluación de motor (opcional, v1.x) | Barra de evaluación / marcas de error vía Stockfish en servidor; no bloquea el MVP del visor |

El MVP del visor es **reproducir el PGN paso a paso**. Stockfish es una mejora posterior sobre la misma pantalla.

### 2.2 Estadísticas del jugador

Objetivo: preparar el enfrentamiento con números claros, sin texto generado.

Ejemplos de métricas (todas calculadas a partir de partidas etiquetadas):

| Área | Ejemplos |
|---|---|
| Color | % victoria / tablas / derrota con **blancas** vs **negras**; Elo medio de rivales por color |
| Aperturas | Repertorio por ECO/nombre, frecuencia, score por apertura y por color; líneas más jugadas |
| Resultado y ritmo | Score global, por control de tiempo (si hay dato), por periodo |
| Piezas | **Piezas más relevantes** del jugador: p. ej. qué pieza mueve más en medio juego, qué piezas suelen estar presentes en finales ganados/perdidos, actividad relativa (movimientos por tipo de pieza), piezas que más participan en capturas — métricas derivadas del PGN, no opiniones |
| Fase de partida | Longitud media de partida, resultados según partidas largas vs cortas (proxy de finales) |
| Muestra | Nº de partidas usadas, fuentes, rango de fechas, desglose online vs OTB |

Reglas de presentación:

- Cada bloque de stats declara **n**, rango temporal y modo (`online` / `otb` / `combined`).
- Si la muestra es pequeña, se muestra el número; no se inventan conclusiones en prosa.
- Las stats son el producto; no hay “informe IA” encima.

---

## 3. Stack tecnológico

| Capa | Elección | Motivo |
|---|---|---|
| Frontend web | **Next.js (App Router) + React + TypeScript + Tailwind CSS** | Rutas por jugador/partida, SSR opcional, ecosistema maduro para tableros (`react-chessboard`, `chess.js`) |
| Backend API | **FastAPI (Python)** | Ingesta PGN, agregaciones estadísticas y (opcional) Stockfish; ecosistema `python-chess` |
| Parsing PGN / lógica ajedrez | **python-chess** (servidor) + **chess.js** (cliente, visor) | Servidor normaliza y calcula stats; cliente anima el tablero jugada a jugada |
| Motor de evaluación (opcional) | **Stockfish** self-hosted vía UCI | Solo para overlay de evaluación en el visor / métricas de calidad; no es requisito del MVP |
| Persistencia (MVP) | **Ninguna** | Los datos se procesan en memoria; los PGN grandes pueden pasar por archivos temporales con TTL |
| Persistencia futura | **PostgreSQL** | Solo cuando haya cuentas, favoritos, histórico, grandes datasets OTB o necesidad de evitar reingestas |
| Cache / colas (MVP) | Caché TTL en memoria o temporal | Evita repetir una operación durante una sesión sin introducir Redis |
| Cache / colas futuras | **Redis** + **Celery** (o RQ) | Jobs de ingesta y recálculo cuando el tamaño o la duración lo justifiquen |
| Búsqueda (MVP) | Proveedor externo + filtrado en memoria | No requiere índice propio; `pg_trgm` queda para una futura persistencia |
| Auth (MVP) | Fuera de alcance | No hay cuentas ni datos privados en esta fase |
| Progreso (MVP) | Respuesta síncrona y estados de operación | SSE/polling solo cuando existan jobs asíncronos |
| Infra | **Docker Compose** en dev; servicios separados en prod | Frontend y API en el MVP; base de datos y workers son evoluciones posteriores |

**Fuera de alcance:** APIs de IA generativa (Claude, OpenAI, etc.), apps nativas / Capacitor / tiendas. PWA opcional más adelante sobre el mismo Next.js.

---

## 4. Arquitectura general

```
┌──────────────────────────────────────────┐
│  NAVEGADOR                               │
│  Next.js                                 │
│  · Buscador / ficha de jugador           │
│  · ESTADÍSTICAS (color, aperturas, …)    │
│  · VISOR (partida paso a paso)           │
│  · Selector modo online/OTB/combinado    │
└──────────────────┬───────────────────────┘
                   │ HTTPS (REST; SSE solo futuro)
┌──────────────────▼───────────────────────┐
│              API (FastAPI)                 │
│   Orquestación · normalización · stats    │
└──┬──────────────────┬────────────────────┘
   │                  │
┌──▼──────────┐  ┌────▼────┐  ┌──▼───────────┐
│ Procesado   │  │ Caché   │  │ Proceso PGN  │
│ en memoria  │  │ TTL     │  │ temporal     │
│ y stats     │  │ opcional│  │              │
└──┬──────────┘  └───┬─────┘  └──┬───────────┘
   │                 │           │
┌──▼─────────────────▼───────────▼───────────┐
│           CAPA DE PROVEEDORES              │
│  Online: Lichess · Chess.com               │
│  OTB: PGN manual · fuentes futuras         │
└────────────────────────────────────────────┘
```

**Contrato de fronteras:**

- El navegador reproduce partidas y pinta gráficos; no parsea dumps masivos ni ejecuta Stockfish en el flujo principal.
- Stats y listados de partidas salen de la API; el visor pide el PGN (o la lista de FENs/jugadas) usando una referencia externa o un identificador temporal.
- La API no necesita un `Game` persistente: puede devolver `source` + `source_game_id` o un `dataset_id` temporal con caducidad.
- Una instancia del MVP puede mantener una caché temporal local; si se escala a varias instancias habrá que introducir un almacenamiento compartido.
- Sin componente “Motor IA” ni cola de redacción de informes.

---

## 5. Capa de proveedores — patrón central

Interfaz común:

```python
class GameProvider(Protocol):
    name: str
    game_type: Literal["online", "otb"]
    reliability: Literal["official", "community", "user_upload"]

    def search_player(self, query: PlayerQuery) -> list[PlayerCandidate]: ...
    def fetch_games(self, player_id: PlayerRef, since: date | None) -> list[RawGame]: ...
    def is_available(self) -> bool: ...
```

Modelo común (`RawGame`):

```python
class RawGame(BaseModel):
    source: str
    game_type: Literal["online", "otb"]
    source_confidence: Literal["official", "community", "user_upload"]
    pgn: str
    white: PlayerRef
    black: PlayerRef
    result: Literal["1-0", "0-1", "1/2-1/2", "*"]
    date: date | None
    event: str | None
    eco: str | None
    time_control: str | None
    fetched_at: datetime
```

**Deduplicación:** hash normalizado sobre (jugadores, fecha, resultado, primeros N movimientos).

### 5.1 Proveedores

**Online:** Lichess API · Chess.com API  

**OTB:** Lumbra's Gigabase (bulk principal) · TWIC (actualidad) · YottaChess / 365chess / chessgames (fallback por nombre; scraping — revisar ToS) · Caissabase · chess-results (identidad, sin PGN) · FIDE (metadatos) · importación manual PGN desde el navegador  

**Alcance del MVP:** Lichess como proveedor online y PGN manual como entrada OTB/de prueba. No se hace ingesta masiva OTB en esta fase.

**Orden de prioridad futura:** Gigabase → TWIC → Lichess/Chess.com → fallbacks web → PGN manual.

Los proveedores OTB sin API pública se tratan como fallback de baja frecuencia, no como sync masivo.

---

## 6. Modelo de datos temporal (MVP)

El MVP no crea tablas ni requiere un ORM. Se utilizan modelos Pydantic o `dataclasses` para validar y transportar datos durante una operación.

- **PlayerRef** — identificador externo, nombre y fuente del jugador.
- **RawGame** — modelo común recibido de un proveedor o de un PGN subido.
- **NormalizedGame** — partida normalizada, con PGN validado, metadatos, jugadas y referencia externa si existe.
- **TemporaryDataset** — conjunto de partidas asociado a un `dataset_id` temporal, con fecha de caducidad y fuente.
- **StatsResult** — agregados calculados sobre un `TemporaryDataset` o sobre la respuesta actual del proveedor.
- **EngineEvaluation** (opcional, post-MVP) — evaluación temporal por jugada si se activa Stockfish.

Un `NormalizedGame` puede identificarse mediante `(source, source_game_id)` cuando el proveedor lo ofrece. Para PGN manual se utiliza `(dataset_id, game_index)` o un identificador temporal equivalente. No se necesita una clave primaria permanente.

La deduplicación del MVP se realiza dentro del conjunto procesado mediante el hash normalizado definido en la sección de proveedores. Si en el futuro se necesita conservar el resultado, estos modelos podrán migrarse a PostgreSQL.

No hay entidad de `User`, `PlayerStatsSnapshot` ni “informe generado por IA” en el MVP.

---

## 7. Modos: online / OTB / combinado

Filtro sobre datos ya etiquetados en la ingesta (`game_type` del proveedor). En el MVP el jugador se identifica por la fuente y su identificador externo; el conjunto temporal, si existe, se referencia mediante `dataset_id`.

```
GET /api/v1/players/{source}/{external_id}/stats?mode=online|otb|combined
GET /api/v1/players/{source}/{external_id}/openings?mode=...&color=white|black
GET /api/v1/players/{source}/{external_id}/games?mode=...
```

Por defecto: **combinado**, indicando siempre cuántas partidas de cada tipo entran en el cálculo.  
En la UI: selector de 3 estados en ficha de jugador, panel de stats y listado/visor.

---

## 8. Motor de estadísticas

Cálculos deterministas sobre el conjunto filtrado de `NormalizedGame`, cargado desde un proveedor o desde un `TemporaryDataset`. Se pueden implementar con Python puro y `python-chess`; pandas es opcional y SQL no forma parte del MVP. Alimenta la función 2 del producto.

El resultado debe incluir siempre el tamaño de la muestra, fuentes, rango temporal y modo. No se guardan snapshots: una nueva petición vuelve a calcular o utiliza una caché temporal con TTL.

### 8.1 Agregados prioritarios (MVP)

1. **Por color:** partidas, score, % W/D/L con blancas y con negras.
2. **Por apertura:** top ECO/nombres, frecuencia, score, desglose por color.
3. **Lista enlazable:** cada celda/stats debe poder abrir el listado de partidas subyacente → visor.
4. **Piezas (v1):** a partir del PGN parseado, métricas simples por tipo de pieza del jugador (frecuencia de movimientos, capturas realizadas/sufridas, presencia en el último tercio de la partida). Refinar definición en implementación; siempre con `n` visible.

### 8.2 Stockfish (post-MVP, opcional)

Solo si se quiere calidad de jugada en el visor o métricas de “errores por fase”:

- Worker UCI → `EngineEvaluation` por partida.
- Progreso vía SSE; no bloquea stats básicas ni la reproducción paso a paso.
- Sin texto generado: solo números (centipawns, clasificación de jugada).

---

## 9. Mapeo funcional → componentes

| Función / capacidad | Componente |
|---|---|
| Buscar rival | Página Next.js + `GET /players/search` + proveedores (metadatos) |
| Ingesta de partidas | Capa de proveedores + pipeline temporal |
| **Estadísticas** | Motor de Estadísticas + páginas `/players/[source]/[external_id]` (tabs/secciones) |
| **Visor paso a paso** | `GET /games/{source}/{external_id}` + React + `chess.js` + `react-chessboard` |
| De stats → partidas | Query `games?opening=…&color=…&dataset_id=…` → click → visor |
| Importación PGN | Upload web → mismo pipeline de normalización |
| Auth / preferencias (futuro) | `User` + cookies de sesión |

Módulos secundarios (comparador, calculadoras Elo, dashboard) solo si no distraen de los dos pilares; no son MVP.

---

## 10. API — endpoints principales (borrador)

Prefijo: `/api/v1`.

```
# Jugador y partidas
GET  /api/v1/players/search?q=...&source=...
GET  /api/v1/players/{source}/{external_id}
POST /api/v1/players/{source}/{external_id}/refresh-games
GET  /api/v1/players/{source}/{external_id}/games?mode=&color=&eco=&from=&to=
GET  /api/v1/games/{source}/{external_id}         # PGN + metadatos para el visor
GET  /api/v1/games/{source}/{external_id}/moves   # opcional: lista de SAN/FEN

# Estadísticas
GET  /api/v1/players/{source}/{external_id}/stats?mode=online|otb|combined
GET  /api/v1/players/{source}/{external_id}/stats/by-color
GET  /api/v1/players/{source}/{external_id}/stats/openings?color=white|black
GET  /api/v1/players/{source}/{external_id}/stats/pieces  # piezas relevantes / actividad

# PGN temporal
POST /api/v1/datasets                              # crea un dataset con TTL
GET  /api/v1/datasets/{dataset_id}/games
GET  /api/v1/datasets/{dataset_id}/stats

# Futuro, cuando existan trabajos asíncronos o cuentas
GET  /api/v1/jobs/{id}/events                      # SSE
POST /api/v1/auth/login | logout | me

# Opcional post-MVP
GET  /api/v1/games/{source}/{external_id}/engine-analysis
```

CORS: orígenes explícitos; ideal mismo sitio vía reverse proxy (`/api` detrás del mismo dominio). Las cookies de sesión quedan para una fase posterior con cuentas.

---

## 11. Despliegue web

```
Internet → CDN / reverse proxy (TLS)
              ├─ Next.js (UI: stats + visor)
              └─ FastAPI (/api/v1)
                     ├─ Proveedores externos
                     └─ Caché/archivos temporales con TTL
```

| Pieza | Opciones v1 |
|---|---|
| Frontend | Vercel, Cloudflare Pages, o contenedor + Nginx/Caddy |
| API | Fly.io, Railway, Render o VPS Docker |
| Almacenamiento temporal | Memoria del proceso o volumen temporal no persistente |
| Postgres / Redis / workers | No necesarios en el MVP; servicios gestionados o contenedores en una fase posterior |

Móvil: responsive; sin app store. PWA opcional más adelante.

---

## 12. Escalabilidad futura

- Más métricas de piezas / estructuras (sin IA: solo agregados sobre PGN).
- Overlay Stockfish en el visor.
- PostgreSQL para evitar reingestas, conservar históricos, soportar cuentas o almacenar grandes datasets OTB.
- Redis + Celery/RQ para ingestas y recálculos largos o despliegues con varias instancias.
- Comparador de dos jugadores reutilizando el Motor de Estadísticas.
- Export CSV/PDF de tablas de stats (plantillas, no texto generado).
- Preparación por torneo (filtro de rivales + fechas).
- PWA ligera para “añadir a inicio”.

---

## 13. Próximos pasos

1. Monorepo: `web/` (Next.js) + `api/` (FastAPI) + `docker-compose.yml`, sin servicio de base de datos.
2. Contratos API, modelos temporales y fixtures PGN compartidos.
3. Ingesta piloto: **Lichess** (online) + **PGN manual** (OTB o datos de prueba) → `NormalizedGame` válido.
4. **MVP UI #1 — Visor:** listado de partidas + tablero paso a paso.
5. **MVP UI #2 — Stats:** por color + aperturas + enlace a partidas filtradas.
6. Dataset temporal para importaciones PGN, con TTL y limpieza automática.
7. Selector online/OTB/combinado en ficha y en APIs.
8. Preview desplegado (URL) para probar en desktop y móvil.
9. Métricas de piezas sobre PGN parseado; afinar definición con datos reales.
10. (Futuro) PostgreSQL, Redis/Celery, autenticación, más proveedores OTB y Stockfish.

---

*Documento centrado en producto web con dos pilares (visor + estadísticas) y sin IA generativa.*
