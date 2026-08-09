# Base de aperturas

`openings.tsv` contiene los campos `eco`, `name` y `epd` derivados de
[`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings),
revisión `4b8622759e7ae6f93f011cc6c83a3823401ab45e`.

La base original se publica bajo la dedicación al dominio público CC0 1.0.
El texto de la licencia se conserva en `CC0-1.0.txt`.

Para generar este archivo se combinaron `a.tsv` a `e.tsv` con el generador
oficial del proyecto y se conservaron únicamente ECO, nombre y EPD. ChessPrep
usa el EPD para reconocer la posición alcanzada independientemente del orden
de jugadas.
