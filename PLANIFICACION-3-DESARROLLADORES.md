# ChessPrep — Desglose de tareas para 3 desarrolladores

> **Documento histórico.** Este archivo conserva la planificación inicial y no describe necesariamente la implementación actual. En particular, la propuesta de Next.js, TypeScript y Tailwind se sustituyó por una SPA sin proceso de build. La arquitectura vigente se documenta en [README.md](./README.md) y [Diseño tecnico.md](./Diseño%20tecnico.md).

## Estado actual de la implementación

- Frontend estático con controladores independientes para dossier, visor, OTB, PGN y calculadora Elo.
- Backend FastAPI separado en configuración, seguridad, routers, servicios y proveedores con dependencias explícitas.
- Lichess, Chess.com, FIDE, Info64, importación PGN y Stockfish en cliente implementados.
- 51 pruebas automatizadas superadas tras la refactorización y la corrección del visor.
- Arranque directo con Python validado.
- Dockerfiles y Compose actualizados; la construcción de las imágenes queda pendiente de verificación en un equipo con Docker instalado.

Las secciones siguientes deben leerse como reparto y alcance propuestos al inicio del proyecto, no como lista de trabajo pendiente ni como inventario del código actual.

## 1. Objetivo del MVP

Construir una aplicación web que permita:

1. Buscar un jugador en una fuente externa.
2. Consultar sus partidas públicas o importar un PGN manualmente.
3. Ver una partida jugada a jugada en un tablero interactivo.
4. Calcular estadísticas deterministas por color y apertura.
5. Filtrar por `online`, `otb` y `combined`.
6. Acceder desde una estadística a las partidas que la originan.

El MVP no tendrá cuentas, base de datos, Redis, Celery ni persistencia permanente. Las partidas se procesan en memoria. Los PGN subidos que necesiten varias peticiones se guardan únicamente en memoria o en un archivo temporal con TTL.

## 2. Reparto de responsabilidades

| Responsable | Área | Resultado principal |
|---|---|---|
| Desarrollador 1 | Datos, PGN e integraciones | Partidas normalizadas y trazables |
| Desarrollador 2 | Frontend y UX | Visor y pantallas utilizables |
| Desarrollador 3 | API, estadísticas e infraestructura | API funcional, cálculos y despliegue |

Cada tarea tiene un responsable principal, pero las interfaces entre áreas se revisan conjuntamente.

## 3. Desarrollador 1 — Datos, PGN e integraciones

### Tareas

- Crear los modelos temporales `PlayerRef`, `RawGame`, `NormalizedGame` y `TemporaryDataset`.
- Definir el protocolo `GameProvider`.
- Implementar validación y normalización de PGN con `python-chess`.
- Extraer jugadores, colores, resultado, fecha, evento, ECO y control de tiempo.
- Generar SAN, FEN o posiciones necesarias para el visor.
- Implementar deduplicación dentro de un dataset mediante hash normalizado.
- Implementar el importador de PGN manual.
- Implementar el primer proveedor real: Lichess.
- Crear fixtures PGN pequeños para desarrollo y tests.
- Diseñar el mecanismo de almacenamiento temporal con TTL.
- Documentar límites, errores y campos no disponibles de cada proveedor.

### Entregables

- Un PGN válido produce uno o varios `NormalizedGame`.
- Un PGN inválido devuelve errores comprensibles.
- Las partidas conservan fuente, confianza y referencia externa.
- El mismo PGN no se duplica dentro de un dataset.
- El proveedor Lichess puede buscar jugadores y devolver partidas.

## 4. Desarrollador 2 — Frontend y experiencia de usuario

### Tareas

- Crear la aplicación Next.js con TypeScript y Tailwind.
- Crear el layout general y la navegación.
- Implementar búsqueda de jugadores.
- Implementar ficha del jugador.
- Implementar listado de partidas con paginación o carga progresiva.
- Añadir filtros por color, ECO, resultado, fecha y modo.
- Implementar el tablero con `react-chessboard` y `chess.js`.
- Añadir controles de primera jugada, anterior, siguiente y última jugada.
- Añadir navegación con teclado.
- Mostrar metadatos de la partida: evento, fecha, resultado, ECO, fuente y Elo.
- Crear paneles de estadísticas por color y apertura.
- Hacer clicables las estadísticas para abrir las partidas subyacentes.
- Añadir selector `online / otb / combinado`.
- Resolver estados de carga, error, vacío y datos insuficientes.
- Comprobar responsive y accesibilidad básica.

### Entregables

- El usuario puede buscar un jugador y abrir una partida.
- El visor reproduce todas las jugadas correctamente.
- Las estadísticas muestran su muestra (`n`), fuente, modo y rango temporal.
- Desde una apertura o filtro se llega al listado de partidas correspondiente.

## 5. Desarrollador 3 — API, estadísticas e infraestructura

### Tareas

- Crear la estructura FastAPI y el prefijo `/api/v1`.
- Publicar el contrato OpenAPI desde el inicio.
- Implementar endpoints de búsqueda, jugadores y partidas.
- Implementar endpoints de datasets temporales.
- Implementar filtros comunes de partidas.
- Implementar estadísticas por color: partidas, victorias, tablas, derrotas y score.
- Implementar estadísticas por apertura: frecuencia, ECO, score y color.
- Garantizar que todos los resultados incluyen muestra, fuente, modo y rango temporal.
- Añadir caché TTL en memoria o almacenamiento temporal local.
- Añadir limpieza de datasets caducados.
- Crear Docker Compose para `web` y `api` sin PostgreSQL.
- Configurar variables de entorno y gestión de errores.
- Crear tests de API e integración.
- Configurar CI y despliegue de una primera preview.

### Entregables

- El frontend puede consumir la API sin conocer los detalles del proveedor.
- Los filtros devuelven resultados coherentes.
- Los cálculos estadísticos están cubiertos por tests.
- El proyecto se ejecuta localmente con Docker Compose.
- Existe una URL de preview para validar el MVP.

## 6. Contrato común que deben acordar los tres

Antes de trabajar en paralelo deben fijarse estos puntos:

- Formato exacto de `RawGame` y `NormalizedGame`.
- Valores permitidos para `game_type`: `online` y `otb`.
- Forma de representar `combined` — es un filtro, no un tercer tipo de partida.
- Formato de resultados ajedrecísticos.
- Identificador externo: combinación de `source` y `source_game_id`.
- Identificador temporal: `dataset_id` con fecha de caducidad.
- Esquema de errores de la API.
- Paginación y límites máximos por consulta.
- Campos obligatorios de trazabilidad: fuente, confianza, muestra y fechas.
- Fixtures PGN compartidos por frontend, backend y tests.

El frontend debe consumir el contrato OpenAPI o tipos generados, nunca acceder directamente a la lógica del proveedor.

## 7. Plan por fases

### Fase 0 — Diseño y arranque

Duración estimada: 2-3 días.

- Crear `web/`, `api/` y `docker-compose.yml`.
- Acordar los modelos y endpoints.
- Añadir fixtures PGN.
- Configurar linting, formato y tests básicos.
- Crear ramas de trabajo y plantilla de pull request.

Resultado: todos pueden arrancar el proyecto y trabajar contra el mismo contrato.

### Sprint 1 — Base técnica

Duración estimada: 2 semanas.

- Desarrollador 1: modelos temporales, parser y fixtures.
- Desarrollador 2: layout, rutas y componentes base.
- Desarrollador 3: FastAPI, Docker y endpoints simulados.

Resultado: proyecto ejecutable con datos de prueba.

### Sprint 2 — Primer flujo completo

Duración estimada: 2 semanas.

- Desarrollador 1: proveedor Lichess e importación PGN.
- Desarrollador 2: listado, tablero y controles de navegación.
- Desarrollador 3: endpoints reales de jugadores y partidas.

Resultado: buscar jugador → obtener partidas → abrir partida → reproducir jugadas.

### Sprint 3 — Estadísticas y filtros

Duración estimada: 2 semanas.

- Desarrollador 1: normalización de ECO, color, resultado y fuentes.
- Desarrollador 2: panel de estadísticas y enlaces a partidas.
- Desarrollador 3: motor estadístico, filtros y datasets temporales.

Resultado: visor y estadísticas funcionan sobre el mismo conjunto trazable de partidas.

### Sprint 4 — Calidad y entrega

Duración estimada: 1-2 semanas.

- Integración completa de frontend y API.
- Pruebas con PGN válidos, inválidos, duplicados y partidas incompletas.
- Selector online/OTB/combinado.
- Responsive, accesibilidad y estados de error.
- Limpieza de datasets caducados.
- CI, despliegue y documentación de instalación.

Resultado: MVP desplegado y demostrable.

## 8. Dependencias críticas

```text
Modelos y contrato
        ↓
Parser PGN ───────────┐
                      ├─ API de partidas ── Frontend visor
Proveedor Lichess ───┘

Partidas normalizadas
        ↓
Motor de estadísticas ── API de stats ── Frontend de estadísticas
```

Para evitar bloqueos, el Desarrollador 2 puede comenzar con mocks mientras los Desarrolladores 1 y 3 terminan la integración real.

## 9. Criterios de aceptación del MVP

- `docker compose up` inicia la aplicación localmente.
- Se puede buscar un jugador mediante el proveedor configurado.
- Se pueden consultar e importar partidas PGN.
- El visor reproduce correctamente las jugadas.
- Las estadísticas de color y apertura coinciden con los fixtures conocidos.
- Los filtros por modo, color y apertura funcionan.
- Cada bloque estadístico muestra `n`, fuente, modo y rango temporal.
- Una estadística permite abrir las partidas que la componen.
- Los errores del proveedor no rompen toda la interfaz.
- Los datasets temporales caducan y se limpian.
- No se introducen cuentas, base de datos ni servicios de cola en el MVP.

## 10. Fuera del MVP

Se dejan para una fase posterior:

- PostgreSQL y persistencia de partidas.
- Redis, Celery/RQ y trabajos asíncronos.
- Cuentas, autenticación y preferencias.
- Stockfish.
- Scraping de fuentes OTB sin API pública.
- Métricas avanzadas de piezas.
- Comparador de jugadores.
- Exportación PDF/CSV.
- PWA y aplicaciones móviles.

## 11. Flujo de trabajo recomendado

- Una rama por tarea: `feat/ID-descripcion`.
- Pull request pequeño y revisable.
- Al menos una revisión cruzada antes de integrar.
- Tests obligatorios para parser, deduplicación, estadísticas y endpoints.
- Integración frecuente con `main`.
- No modificar el contrato de datos sin avisar a los otros dos desarrolladores.
- Registrar decisiones de arquitectura en el documento técnico.
