# ChessPrep — Documento Técnico de Diseño (Web)

**Fecha:** 3 de agosto de 2026
**Producto:** aplicación web (navegador). Sin APIs de IA generativa. Sin empaquetado nativo (Capacitor / tiendas) en el alcance actual.
**Decisión de arquitectura MVP:** sin cuentas y sin persistencia; las partidas se consultan, procesan y mantienen temporalmente en memoria o en archivos temporales con caducidad.

---

## 1. Resumen del proyecto

ChessPrep es una **aplicación web de preparación ajedrecística** con dos funciones principales y dos vías de entrada independientes:

1. **Visor de partidas paso a paso** — abrir una partida del rival y recorrerla jugada a jugada sobre un tablero interactivo.
2. **Estadísticas del jugador** — ver datos agregados y objetivos sobre su juego (rendimiento con blancas/negras, aperturas, piezas relevantes, etc.), siempre trazables a un conjunto concreto de partidas.

Las vías de entrada son: buscar un jugador online u OTB para consultar fuentes públicas, o importar directamente un archivo PGN sin vincularlo a una identidad FIDE. Ambos caminos terminan en el mismo visor y motor estadístico temporal.

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
| Frontend web | **SPA estática con HTML, CSS y JavaScript** | Sin proceso de build; FastAPI puede servirla directamente y Nginx hacerlo en Docker |
| Backend API | **FastAPI (Python)** | Ingesta PGN, agregaciones estadísticas y (opcional) Stockfish; ecosistema `python-chess` |
| Parsing PGN / lógica ajedrez | **python-chess** (servidor) + **chess.js** (cliente, visor) | Servidor normaliza y calcula stats; cliente anima el tablero jugada a jugada |
| Motor de evaluación | **Stockfish WASM/JS en Web Worker** | Análisis progresivo en el navegador, MultiPV y modo explorar sin cargar la API |
| Persistencia (MVP) | **Ninguna** | Los datos se procesan en memoria; los PGN grandes pueden pasar por archivos temporales con TTL |
| Persistencia futura | **PostgreSQL** | Solo cuando haya cuentas, favoritos, histórico, grandes datasets OTB o necesidad de evitar reingestas |
| Cache / colas (MVP) | Caché TTL en memoria o temporal | Evita repetir una operación durante una sesión sin introducir Redis |
| Cache / colas futuras | **Redis** + **Celery** (o RQ) | Jobs de ingesta y recálculo cuando el tamaño o la duración lo justifiquen |
| Búsqueda (MVP) | Proveedor externo + filtrado en memoria | No requiere índice propio; `pg_trgm` queda para una futura persistencia |
| Auth (MVP) | Fuera de alcance | No hay cuentas ni datos privados en esta fase |
| Progreso (MVP) | Respuesta síncrona y estados de operación | SSE/polling solo cuando existan jobs asíncronos |
| Infra | **Docker Compose** en dev; servicios separados en prod | Frontend y API en el MVP; base de datos y workers son evoluciones posteriores |

**Fuera de alcance:** APIs de IA generativa (Claude, OpenAI, etc.), apps nativas / Capacitor / tiendas. PWA opcional más adelante sobre la misma SPA.

---

## 4. Arquitectura general

```
┌──────────────────────────────────────────┐
│  NAVEGADOR                               │
│  SPA HTML/CSS/JavaScript                 │
│  · Búsqueda Online o FIDE/Info64         │
│  · Importación PGN independiente         │
│  · ESTADÍSTICAS (color, aperturas, …)    │
│  · VISOR (partida paso a paso)           │
│  · Stockfish en Web Worker               │
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
│  OTB: FIDE · Info64                         │
│  Archivo: PGN subido por el usuario         │
└────────────────────────────────────────────┘
```

**Contrato de fronteras:**

- El navegador reproduce partidas, pinta gráficos y ejecuta Stockfish bajo demanda en un Worker; no parsea dumps masivos.
- Stats y listados de partidas salen de la API; el visor pide el PGN (o la lista de FENs/jugadas) usando una referencia externa o un identificador temporal.
- La API no necesita un `Game` persistente: puede devolver `source` + `source_game_id` o un `dataset_id` temporal con caducidad.
- Una instancia del MVP puede mantener una caché temporal local; si se escala a varias instancias habrá que introducir un almacenamiento compartido.
- Sin componente “Motor IA” ni cola de redacción de informes.

### 4.1 Organización implementada

El backend aplica una arquitectura por capas deliberadamente ligera:

1. `main.py` actúa como **raíz de composición** y conecta implementaciones concretas de proveedores, almacén y servicios.
2. `app_factory.py`, `config.py` y `security.py` construyen la aplicación y resuelven preocupaciones transversales sin mezclarlas con casos de uso.
3. `routers/` adapta HTTP a llamadas de aplicación; no contiene scraping, cálculos ni persistencia.
4. `services/` coordina los casos de uso y las reglas deterministas. Recibe sus dependencias mediante el constructor para poder probarlas de forma aislada.
5. `providers/` encapsula cada servicio externo y convierte sus respuestas a modelos comunes.

En el frontend, `app.js` es la raíz de composición de la SPA. Los controladores `DossierController`, `GameViewerController`, `OtbController`, `PgnImportController` y `EloCalculatorController` encapsulan los eventos y el renderizado de cada capacidad. El motor, el análisis y el modo explorar permanecen como módulos especializados y reutilizables. Las utilidades de formato, traducción, peticiones y diálogos se inyectan desde `app.js`, evitando dependencias implícitas entre capacidades.

Esta separación sigue SOLID sin añadir una clase por cada operación: una clase representa un caso de uso o una frontera con estado; los cálculos puros y parsers permanecen como funciones cuando no necesitan identidad ni ciclo de vida.

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

**OTB:** FIDE para identidad, ratings actuales e historial mensual · Info64 para participaciones y resultados · importación manual PGN desde el navegador como flujo separado

**Alcance implementado del MVP:** Lichess y Chess.com como proveedores online. La búsqueda OTB exige un ID FIDE válido, muestra las tres curvas Elo de los últimos tres años y solo acepta participaciones de Info64 que enlacen al mismo ID. La importación PGN no exige FIDE, crea un dossier independiente e infiere como perspectiva estadística el nombre más frecuente de las cabeceras.

**Ejemplo integrado:** la pantalla inicial no precarga ningún dossier. Mediante una acción explícita se puede abrir un conjunto sintético de 12 partidas atribuido a «Jugador de muestra»; tanto la interfaz como la API lo identifican como ficticio (`source="demo"`, `source_confidence="synthetic"`) y nunca lo presentan como información de un jugador real.

**Regla de modalidad:** solo se normaliza ajedrez estándar. Lichess se limita a ritmos estándar, Chess.com exige `rules="chess"` y el parser PGN descarta variantes o posiciones iniciales no estándar. Bullet se conserva como ritmo, no como variante.

**Orden de prioridad futura para ampliar OTB:** fuentes con API o licencia clara → bases públicas descargables → fallbacks web revisados jurídicamente.

Los proveedores OTB sin API pública se tratan como fallback de baja frecuencia, no como sync masivo.

---

## 6. Modelo de datos temporal (MVP)

El MVP no crea tablas ni requiere un ORM. Se utilizan modelos Pydantic o `dataclasses` para validar y transportar datos durante una operación.

- **PlayerRef** — identificador externo, nombre y fuente del jugador.
- **FideRatingPoint** — mes y Elo lento, rápido y blitz validados para la mini gráfica de la ficha oficial.
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
2. **Por apertura:** top ECO/nombres, frecuencia, score y desglose por color. Un ECO ausente permanece como `null`; `—` es únicamente su representación visual y el enlace filtra por ECO, nombre y color.
3. **Lista enlazable:** cada celda/stats debe poder abrir el listado de partidas subyacente → visor.
4. **Piezas (v1):** a partir del PGN parseado, métricas simples por tipo de pieza del jugador (frecuencia de movimientos, capturas realizadas/sufridas, presencia en el último tercio de la partida). Refinar definición en implementación; siempre con `n` visible.

### 8.2 Stockfish (implementado en el cliente)

El visor ejecuta **Stockfish 18 Lite** en Web Workers del navegador, sin bloquear la API ni enviar posiciones a servicios externos. Se distribuye la compilación WebAssembly de `nmrugg/stockfish.js`, de un solo hilo y con la red NNUE ligera integrada (`stockfish@18.0.8`); funciona con el alojamiento actual y no necesita `SharedArrayBuffer`, cabeceras COOP/COEP ni un servicio de motor:

- Superficie de trabajo a pantalla completa: tablero y navegación permanecen juntos; jugadas y análisis ocupan paneles con desplazamiento independiente.
- Metadatos en orden blancas–negras y curva de evaluación bicolor con relleno respecto a la igualdad para distinguir de un vistazo qué bando tiene ventaja.
- Reproducción automática a 1,1 segundos por jugada y nodo visual independiente para cada pieza, de modo que el arrastre no copie el fondo de la casilla.
- Worker UCI principal → evaluación progresiva, líneas MultiPV, calidad de jugada y momentos clave.
- Worker UCI independiente para las variantes manuales → permite arrastrar o seleccionar jugadas legales y valorar inmediatamente la última sin esperar al análisis completo.
- La recomendación autoritativa usa siempre `MultiPV 1`; las líneas MultiPV adicionales son alternativas y no sustituyen a la mejor jugada. Los dos Workers comparten una caché LRU de resultados terminados por versión de motor, FEN, presupuesto de nodos y número de líneas.
- Cada búsqueda recibe un presupuesto fijo entre 10.000 y 2.000.000 nodos (150.000 por defecto) y comienza con `Clear Hash`. Así, recomendación y jugada probada consumen el mismo trabajo y el orden de consultas no contamina la comparación.
- Una jugada elegida se valora con `searchmoves` desde el mismo FEN raíz y el mismo presupuesto. `searchmoves` se emite al final del comando UCI para que no absorba el límite `nodes`; no se añade artificialmente un ply analizando la posición resultante.
- El tablero admite movimientos legales por defecto desde cualquier posición, sin un botón de activación. El primer movimiento manual abre el análisis automáticamente; una jugada nueva, deshacer o volver a la partida cancela únicamente la evaluación manual obsoleta.
- Las estadísticas básicas y la reproducción paso a paso no dependen del motor.
- Los binarios JS/WASM se sirven localmente desde `web/vendor/stockfish`; la procedencia, integridad y licencia GPL-3.0 están registradas junto a ellos.
- La calidad de jugada se obtiene de la pérdida de probabilidad de resultado derivada de la evaluación, conservando los centipawns como dato explicativo. La precisión agregada usa una media armónica transparente para que un error grave no quede oculto entre jugadas sencillas.
- Sin texto generado: solo evaluaciones y clasificaciones deterministas.

---

## 9. Mapeo funcional → componentes

| Función / capacidad | Componente |
|---|---|
| Buscar rival online | `DossierController` + `OnlinePlayerService` + proveedores Lichess/Chess.com |
| Buscar rival OTB | `OtbController` + `OtbLookupService` + proveedores FIDE/Info64 |
| Ingesta de partidas | `DatasetService` / `OnlinePlayerService` + parser PGN + `DatasetStore` |
| **Estadísticas** | `services/stats.py` + rutas de jugadores/datasets + `DossierController` |
| **Visor paso a paso** | `GameViewerController` + `GET /games/{source}/{game_id}` + `chess.js` |
| De stats → partidas | Filtros del dossier → lista cronológica → `GameViewerController` |
| Importación PGN | `PgnImportController` + `DatasetService` → dataset temporal independiente |
| Calculadora Elo | `EloCalculatorController` + `EloCalculatorService` + reglas puras de `services/elo.py` |
| Seguridad HTTP | `security.py` + configuración tipada en `config.py` |
| Auth / preferencias (futuro) | `User` + cookies de sesión |

La calculadora Elo ya forma parte del MVP. Comparadores adicionales y dashboard continúan fuera de alcance mientras no aporten al flujo de preparación.

---

## 10. API — endpoints principales

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

# PGN temporal
POST /api/v1/datasets                              # crea un dossier PGN independiente con TTL
GET  /api/v1/datasets/{dataset_id}/games
GET  /api/v1/datasets/{dataset_id}/stats

# FIDE e Info64
GET  /api/v1/fide/players/{fide_id}                # identidad, ratings e historial mensual
GET  /api/v1/fide/players/{fide_id}/info64-results?from=&to=

# Calculadora FIDE
POST /api/v1/elo/head-to-head                       # variación con lista mensual actual
POST /api/v1/elo/initial                            # Elo inicial con periodo por rival

# Futuro, cuando existan trabajos asíncronos o cuentas
GET  /api/v1/jobs/{id}/events                      # SSE
POST /api/v1/auth/login | logout | me

# Opcional post-MVP
GET  /api/v1/players/{source}/{external_id}/stats/pieces
GET  /api/v1/games/{source}/{external_id}/engine-analysis
```

CORS: orígenes explícitos; ideal mismo sitio vía reverse proxy (`/api` detrás del mismo dominio). Las cookies de sesión quedan para una fase posterior con cuentas.

---

## 11. Despliegue web

```
Internet → CDN / reverse proxy (TLS)
              ├─ Nginx o FastAPI (SPA: búsqueda + stats + visor)
              └─ FastAPI (/api/v1)
                     ├─ Proveedores externos
                     └─ Caché/archivos temporales con TTL
```

| Pieza | Opciones v1 |
|---|---|
| Frontend | Archivos estáticos en CDN, o contenedor + Nginx/Caddy |
| API | Fly.io, Railway, Render o VPS Docker |
| Almacenamiento temporal | Memoria del proceso o volumen temporal no persistente |
| Postgres / Redis / workers | No necesarios en el MVP; servicios gestionados o contenedores en una fase posterior |

Móvil: responsive; sin app store. PWA opcional más adelante.

### 11.1 Estado de validación del despliegue

Tras la separación del backend y los controladores del frontend se han validado 53 pruebas automatizadas, la compilación de todos los módulos Python, la sintaxis de los 11 archivos JavaScript y la entrega HTTP de todos los recursos declarados en `index.html`. El contrato OpenAPI conserva los 18 endpoints públicos existentes antes de la refactorización.

Los archivos Docker también se han adaptado: la imagen de API incluye `web/js` y `web/vendor`, mientras que la imagen Nginx continúa publicando esos directorios y redirigiendo `/api`. Sin embargo, el equipo donde se realizó esta revisión no dispone del ejecutable Docker. Por ello, la siguiente comprobación sigue pendiente y debe hacerse en un entorno con Docker instalado:

```bash
docker compose up --build
```

Lista de comprobación posterior al arranque:

1. `GET http://localhost:8000/api/v1/health` responde con `status: ok`.
2. `http://localhost:3000` carga sin recursos JavaScript o WASM con error 404.
3. El ejemplo ficticio abre el dossier y una partida en el visor.
4. Stockfish carga al activar **Analizar** y puede iniciar el modo **Explorar**.
5. Las consultas externas muestran errores controlados si un proveedor no está disponible.

Este pendiente es de validación del empaquetado, no un defecto funcional conocido. El arranque directo con Python y el contrato HTTP sí están cubiertos por la batería automatizada.

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

1. Construir y arrancar las imágenes Docker, completando la lista de comprobación de la sección 11.1.
2. Desplegar una preview HTTPS y validar el flujo completo en escritorio y móvil.
3. Añadir observabilidad de errores y tiempos de respuesta de Lichess, Chess.com, FIDE e Info64.
4. Evaluar caché temporal del perfil e historial FIDE para reducir consultas repetidas sin introducir persistencia permanente.
5. Ampliar las fuentes OTB únicamente cuando exista una API, descarga o permiso de uso claro.
6. Refinar métricas deterministas y exportaciones reutilizando los datasets ya normalizados.
7. Considerar PostgreSQL, Redis/trabajos asíncronos y cuentas solo cuando aparezca una necesidad real de persistencia o escala.

---

*Documento centrado en producto web con dos pilares (visor + estadísticas) y sin IA generativa.*
