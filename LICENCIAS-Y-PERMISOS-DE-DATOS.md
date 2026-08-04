# Licencias y permisos de las fuentes de datos

**Última actualización:** 4 de agosto de 2026

## Finalidad de este documento

Este registro resume el estado de los contactos realizados para obtener partidas de ajedrez y deja claro qué usos están autorizados, cuáles requieren una aclaración y qué fuentes todavía no deben integrarse. No sustituye el texto completo de las licencias ni asesoramiento jurídico.

Los correos originales deben conservarse en formato `.eml`, con sus cabeceras completas, fuera del repositorio público. Este documento recoge únicamente el contenido operativo necesario para desarrollar ChessPrep y no reproduce la correspondencia completa.

## Resumen actualizado

| Fuente | Contacto | Estado | Uso en ChessPrep | Próximo paso |
|--------|----------|--------|------------------|--------------|
| [Lumbra's Gigabase](https://lumbrasgigabase.com/) | Michael Jansen | ✅ **AUTORIZADO** (CC BY-NC-SA 4.0) | Integrado | Confirmar atribución final |
| [ChessTempo](https://chesstempo.com/) | Richard (fundador) | ⚠️ API denegada, uso manual OK | Integrado (subida manual) | Mantener sin scraping |
| [Chess.com](https://chess.com/) | api@chess.com | 📧 Notificación enviada | Integrado | Esperar confirmación |
| [Lichess.org](https://lichess.org/) | contact@lichess.org | 📧 Notificación enviada | Integrado | Esperar respuesta |
| [PGN Mentor](https://www.pgnmentor.com/) | Equipo PGN Mentor | ✅ Autorizado (no comercial) | Pendiente | Aclarar automatización |
| [Info64/FEDA](https://info64.feda.org/) | feda@feda.org | ⏳ PENDIENTE RESPUESTA | ❌ NO integrar | Contactar de nuevo |
| [TWIC](https://theweekinchess.com/) | Mark Crowther | 💰 Comercial (30 GBP/mes) | No integrado | No usar sin acuerdo |
| [YottaChess](https://www.yottachess.com/) | Isaac | ❌ Sin respuesta | No integrado | Esperar respuesta |

---

## 1. Lumbra's Gigabase ✅

**Estado:** AUTORIZADO para proyecto no comercial bajo CC BY-NC-SA 4.0

**Condiciones:**
- Proyecto debe ser abierto, gratuito y estrictamente no comercial
- Sin publicidad, suscripciones o monetización
- Atribución requerida: "Lumbra's Gigabase" con enlace a lumbrasgigabase.com
- No redistribución de archivos PGN brutos
- Caché temporal de 30-60 minutos permitido

**Implementación:** Los usuarios pueden descargar su propia copia y ChessPrep la procesa localmente, o se mantiene una copia indexada en servidor sin exportación masiva.

---

## 2. ChessTempo ⚠️

**Estado:** API denegada explícitamente, pero uso manual permitido

**Respuesta de Richard (fundador):**
> "Sorry, we do not have a documented external API at the moment, and some of the searches are relatively heavy on our database, meaning at peak times we are only just keeping up with load right now, so we are not keen at the moment to offer an external API at the moment."

**Implementación permitida:**
- ❌ NO scraping automático
- ✅ Usuarios pueden subir manualmente PGN descargados desde ChessTempo
- ✅ Enlaces directos a ChessTempo para búsquedas avanzadas
- Atribución: "Partidas proporcionadas por el usuario desde ChessTempo"

---

## 3. Chess.com 📧

**Estado:** Notificación enviada, usando API pública bajo ToS

**Implementación actual:**
- Importación de historial de partidas de usuarios
- Consulta de perfiles públicos y estadísticas
- Respeto estricto de rate limits
- Atribución: "Datos proporcionados por Chess.com"

**Pendiente:** Confirmación o directrices adicionales del equipo de API.

---

## 4. Lichess.org 📧

**Estado:** Notificación enviada, API abierta y gratuita

**Características:**
- API completamente abierta sin restricciones significativas
- Sin límites estrictos de tasa (se pide sentido común)
- Filosofía open source

**Implementación actual:**
- Explorador de aperturas (masters y jugadores)
- Análisis de partidas con enlaces a juegos originales
- Atribución: "Data provided by Lichess.org"

---

## 5. PGN Mentor ✅

**Estado:** Autorizado para uso público no comercial

**Condiciones:**
- Prohibido monetizar los PGN
- Uso no comercial permitido

**Pendiente:** Aclarar automatización, almacenamiento y fórmula de atribución exacta.

---

## 6. Info64/FEDA ⏳

**Estado:** PENDIENTE DE RESPUESTA (solicitud enviada agosto 2026)

**⚠️ CRÍTICO:** ChessPrep NO debe desplegarse públicamente sin autorización escrita de FEDA/Info64.

**Argumentación enviada:**
- Proyecto 100% educativo y sin ánimo de lucro
- Precedente de Lumbra's Gigabase (CC BY-NC-SA 4.0)
- Compromiso de atribución clara con enlace a Info64
- Medidas técnicas para no sobrecargar servidores
- Beneficio mutuo: tráfico dirigido a Info64

**Próximo paso:** Contactar de nuevo si no hay respuesta en 2-3 semanas.

---

## 7. The Week in Chess (TWIC) 💰

**Estado:** Propuesta comercial - 30 GBP/mes

**Respuesta de Mark Crowther:** Acepta uso como referencia pero propone tarifa mensual para alimentar servicios como ChessPrep.

**Decisión:** No integrar hasta que haya acuerdo escrito y se asuma el coste (actualmente no viable para proyecto no comercial).

---

## 8. YottaChess ❌

**Estado:** Sin respuesta tras contacto inicial

**Contacto:** Isaac vía email y LinkedIn

**Decisión:** No integrar hasta recibir autorización escrita.

---

## Reglas internas antes de integrar una fuente nueva

Una fuente solo podrá activarse cuando estén registrados:

1. Identidad del proveedor y URL oficial
2. Licencia pública o permiso escrito del titular
3. Usos permitidos (local, web, caché, indexación)
4. Límites de descarga y frecuencia de consulta
5. Reglas de exportación de partidas individuales
6. Atribución exacta requerida en la interfaz
7. Consecuencias de añadir monetización en el futuro

---

## Notas sobre Stockfish y otros componentes

- **Stockfish:** Distribuido bajo GPLv3. Requiere atribución y disponibilidad del código fuente modificado.
- **PGN de usuarios:** La importación manual no concede derechos sobre el archivo. El usuario debe tener permiso para usarlo.

---

**Documentación mantenida por:** Alejandro Villarrubia, Gonzalo José Colina y Francisco Javier Juárez  
**Contacto:** [Ver README.md](README.md)
