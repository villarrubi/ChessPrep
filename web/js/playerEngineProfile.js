"use strict";

(function (global) {
  const PROFILE_NODES = 30000;
  const PROFILE_MULTIPV = 5;
  const EQUIVALENT_WIN_LOSS = 3;
  const PHASE_ORDER = ["opening", "middlegame", "endgame"];
  const STYLE_DEFINITIONS = [
    {
      id: "initiative",
      name: "Presión inmediata al rey",
      description: "Elige una continuación que crea presión directa cuando también había una alternativa tranquila de calidad similar.",
      predicate: (candidate) => candidate.pressure,
    },
    {
      id: "improvement",
      name: "Mejora tranquila de piezas",
      description: "Elige desarrollo, enroque o centralización sin jaque ni captura cuando había una alternativa equivalente de otro tipo.",
      predicate: (candidate) => candidate.quietImprovement,
    },
    {
      id: "forcing",
      name: "Continuación forzante",
      description: "Prefiere un jaque o una captura no rutinaria cuando podía mantener la calidad con una jugada no forzante.",
      predicate: (candidate) => candidate.forcing,
    },
    {
      id: "simplification",
      name: "Simplificación de material",
      description: "Entra en un cambio relevante de material cuando Stockfish ofrece también una continuación equivalente sin ese cambio.",
      predicate: (candidate) => candidate.simplification,
    },
    {
      id: "investment",
      name: "Inversión material compensada",
      description: "Acepta una concesión material respaldada por el motor cuando existía una alternativa equivalente sin esa inversión.",
      predicate: (candidate) => candidate.materialInvestment,
    },
    {
      id: "counterplay",
      name: "Contrajuego bajo presión",
      description: "Responde con presión, jaque o captura precisa cuando el rival tenía la iniciativa, incluso si la posición seguía igualada.",
      context: (position) => position.defensive,
      predicate: (candidate) => candidate.pressure || candidate.forcing,
    },
  ];

  /**
   * Progressive browser-only analysis. Games and conclusions live only in
   * memory: changing the sample, reloading or closing the tab discards them.
   */
  class PlayerEngineProfileController {
    constructor({ loadGame }) {
      this.loadGame = loadGame;
      this.engine = new global.StockfishEngine();
      this.summaries = [];
      this.sampleKey = "";
      this.generation = 0;
      this.running = false;
      this.pauseRequested = false;
      this.autoPaused = false;
      this.onUpdate = null;
      this.lastOptions = null;
      this._resetState();
      document.addEventListener("visibilitychange", () => this._handleVisibility());
    }

    setSample(games, sampleKey = "") {
      const nextKey = String(sampleKey || "");
      if (nextKey === this.sampleKey && this.summaries.length === (games || []).length) return;
      this.generation += 1;
      this.pauseRequested = true;
      this.running = false;
      try { this.engine.terminate(); } catch { /* ignore */ }
      this.engine = new global.StockfishEngine();
      this.summaries = (games || []).filter((game) => game?.source && game?.id && game.ply_count);
      this.sampleKey = nextKey;
      this._resetState();
      this._emit();
    }

    _resetState() {
      this.status = "idle";
      this.error = "";
      this.gameCursor = 0;
      this.moveCursor = 0;
      this.currentGame = null;
      this.gamesDone = 0;
      this.movesDone = 0;
      this.totalMoves = this.summaries.reduce((sum, game) => {
        const plies = Number(game.ply_count) || 0;
        return sum + (game.player_color === "black" ? Math.floor(plies / 2) : Math.ceil(plies / 2));
      }, 0);
      this.phases = Object.fromEntries(PHASE_ORDER.map((id) => [id, phaseBucket(id)]));
      this.contexts = {
        defensive: contextBucket(),
        counterattack: contextBucket(),
        forcing: contextBucket(),
        quiet: contextBucket(),
      };
      this.preferences = Object.fromEntries(STYLE_DEFINITIONS.map((item) => [item.id, preferenceBucket(item.id)]));
      this.styleDiagnostics = { evaluated: 0, comparable: 0, noChoice: 0, excludedByQuality: 0 };
      this.conversion = { opportunities: 0, converted: 0, evidence: [] };
      this.resistance = { opportunities: 0, saved: 0, evidence: [] };
      this.currentOpportunities = null;
    }

    getSnapshot() {
      return {
        status: this.status,
        error: this.error,
        running: this.running,
        gamesDone: this.gamesDone,
        gamesTotal: this.summaries.length,
        movesDone: this.movesDone,
        movesTotal: this.totalMoves,
        progress: this.totalMoves ? Math.round(this.movesDone / this.totalMoves * 100) : 0,
        nodes: PROFILE_NODES,
        multipv: PROFILE_MULTIPV,
        report: buildReport(this),
      };
    }

    async start({ onUpdate } = {}) {
      if (this.running || this.status === "complete" || !this.summaries.length) return this.getSnapshot();
      this.onUpdate = onUpdate || this.onUpdate;
      this.lastOptions = { onUpdate: this.onUpdate };
      this.pauseRequested = false;
      this.autoPaused = false;
      this.running = true;
      this.status = "running";
      this.error = "";
      const generation = this.generation;
      this._emit();

      try {
        await global.loadChessScript();
        await this.engine.init();
        while (this.gameCursor < this.summaries.length && !this.pauseRequested) {
          if (generation !== this.generation) break;
          const summary = this.summaries[this.gameCursor];
          if (!this.currentGame) {
            this.currentGame = await this.loadGame(summary);
            if (generation !== this.generation || this.pauseRequested) break;
            this.currentOpportunities = { conversion: false, resistance: false };
          }
          await this._analyseCurrentGame(generation);
          if (this.pauseRequested || generation !== this.generation) break;
          this._finishCurrentGame();
          this.gameCursor += 1;
          this.moveCursor = 0;
          this.currentGame = null;
          this.currentOpportunities = null;
          this.gamesDone = this.gameCursor;
          this._emit();
        }
        if (generation === this.generation) {
          this.status = this.gameCursor >= this.summaries.length ? "complete" : "paused";
        }
      } catch (error) {
        if (generation === this.generation) {
          if (this.pauseRequested) this.status = "paused";
          else {
            this.status = "error";
            this.error = error?.message || String(error);
          }
        }
      } finally {
        if (generation === this.generation) {
          this.running = false;
          this._emit();
        }
      }
      return this.getSnapshot();
    }

    pause({ automatic = false } = {}) {
      if (!this.running) return;
      this.pauseRequested = true;
      this.autoPaused = automatic;
      this.status = "paused";
      this.engine.stop().catch(() => {});
      this._emit();
    }

    async _analyseCurrentGame(generation) {
      const game = this.currentGame;
      const ownParity = game.player_color === "black" ? 1 : 0;
      for (let index = this.moveCursor; index < game.moves_uci.length; index += 1) {
        if (this.pauseRequested || generation !== this.generation) return;
        this.moveCursor = index;
        if (index % 2 !== ownParity) continue;
        const fen = game.fens[index];
        const playedUci = game.moves_uci[index];
        if (!fen || !playedUci) continue;

        const search = await this.engine.analyzeFen(fen, {
          nodes: PROFILE_NODES,
          multipv: PROFILE_MULTIPV,
        });
        if (this.pauseRequested || generation !== this.generation) return;

        const previousUci = game.moves_uci[index - 1] || "";
        const lineCandidates = (search.lines || [])
          .map((line) => classifyCandidate(fen, line, previousUci))
          .filter(Boolean);
        let playedCandidate = lineCandidates.find((candidate) => candidate.uci === playedUci);
        let playedAnalysis = playedCandidate ? { score: playedCandidate.score, pv: [] } : null;
        if (!playedAnalysis && playedUci === search.bestMove) {
          playedAnalysis = { score: search.score, pv: search.pv || [playedUci] };
        } else if (!playedAnalysis) {
          playedAnalysis = await this.engine.analyzeMove(fen, playedUci, { nodes: PROFILE_NODES });
        }
        if (this.pauseRequested || generation !== this.generation) return;
        const playedScore = playedAnalysis.score;
        if (!playedCandidate) {
          playedCandidate = classifyCandidate(fen, {
            pv: playedAnalysis.pv?.length ? playedAnalysis.pv : [playedUci],
            score: playedScore,
          }, previousUci);
        }

        const winLoss = global.MoveQuality.winChanceLoss(search.score, playedScore);
        const cpl = global.MoveQuality.centipawnLoss(search.score, playedScore);
        const judgment = global.MoveQuality.classifyWinLoss(winLoss, {
          isBest: playedUci === search.bestMove,
          missedMate: typeof search.score?.mate === "number" && search.score.mate > 0 &&
            !(typeof playedScore?.mate === "number" && playedScore.mate > 0),
          allowedMate: typeof playedScore?.mate === "number" && playedScore.mate < 0,
        });
        const san = game.moves[index] || playedCandidate?.san || playedUci;
        const previousSan = game.moves[index - 1] || "";
        const rawForcing = Boolean(playedCandidate?.capture || playedCandidate?.check) || /[x+#]/.test(san);
        const quiet = !rawForcing;
        const opponentForced = /[x+#]/.test(previousSan);
        const evalBefore = scoreCp(search.score);
        const evidence = {
          source: game.source,
          gameId: game.id,
          ply: index + 1,
          san,
          bestSan: global.uciToSan(fen, search.bestMove),
          winLoss: Math.round(winLoss * 10) / 10,
          cpl: Math.round(cpl),
          judgment,
        };

        const phase = phaseFor(fen, index + 1);
        addDecision(this.phases[phase], winLoss, judgment, evidence);
        addDecision(this.contexts[quiet ? "quiet" : "forcing"], winLoss, judgment, evidence);

        // Equal positions under concrete pressure are defensive contexts too;
        // being objectively worse is not a prerequisite.
        const defensive = evalBefore >= -250 && evalBefore <= 30 && (opponentForced || evalBefore <= -35);
        if (defensive) addDecision(this.contexts.defensive, winLoss, judgment, evidence);
        if (defensive && rawForcing) {
          addDecision(this.contexts.counterattack, winLoss, judgment, evidence);
        }
        if (evalBefore >= 150) this.currentOpportunities.conversion = true;
        if (evalBefore <= -150) this.currentOpportunities.resistance = true;

        this._recordStyleChoice(search, lineCandidates, playedCandidate, winLoss, evidence, { defensive });
        this.movesDone += 1;
        this.moveCursor = index + 1;
        this._emit();
      }
    }

    _recordStyleChoice(search, lineCandidates, playedCandidate, playedWinLoss, evidence, positionContext) {
      this.styleDiagnostics.evaluated += 1;
      if (!playedCandidate || playedWinLoss > EQUIVALENT_WIN_LOSS) {
        this.styleDiagnostics.excludedByQuality += 1;
        return;
      }
      if (playedCandidate.routineRecapture) {
        this.styleDiagnostics.noChoice += 1;
        return;
      }

      const sound = lineCandidates.filter((candidate) =>
        !candidate.routineRecapture &&
        global.MoveQuality.winChanceLoss(search.score, candidate.score) <= EQUIVALENT_WIN_LOSS);
      if (!sound.some((candidate) => candidate.uci === playedCandidate.uci)) sound.push(playedCandidate);
      const candidates = uniqueCandidates(sound);
      if (candidates.length < 2) {
        this.styleDiagnostics.noChoice += 1;
        return;
      }

      let comparableDimensions = 0;
      for (const definition of STYLE_DEFINITIONS) {
        if (definition.context && !definition.context(positionContext || {})) continue;
        const choices = candidates.map(definition.predicate);
        if (!choices.includes(true) || !choices.includes(false)) continue;
        const bucket = this.preferences[definition.id];
        const chosen = Boolean(definition.predicate(playedCandidate));
        bucket.opportunities += 1;
        bucket.chosen += Number(chosen);
        pushPreferenceEvidence(bucket.evidence, {
          ...evidence,
          chosen,
          alternatives: candidates.map((candidate) => candidate.san || candidate.uci).slice(0, PROFILE_MULTIPV),
        });
        comparableDimensions += 1;
      }
      if (comparableDimensions) this.styleDiagnostics.comparable += 1;
      else this.styleDiagnostics.noChoice += 1;
    }

    _finishCurrentGame() {
      const result = playerOutcome(this.currentGame);
      const summary = this.summaries[this.gameCursor];
      const evidence = { source: summary.source, gameId: summary.id, ply: 0 };
      if (this.currentOpportunities?.conversion) {
        this.conversion.opportunities += 1;
        if (result === "win") this.conversion.converted += 1;
        else pushEvidence(this.conversion.evidence, evidence);
      }
      if (this.currentOpportunities?.resistance) {
        this.resistance.opportunities += 1;
        if (result !== "loss") this.resistance.saved += 1;
        else pushEvidence(this.resistance.evidence, evidence);
      }
    }

    _handleVisibility() {
      if (document.hidden && this.running) this.pause({ automatic: true });
      else if (!document.hidden && this.autoPaused && this.status !== "complete") {
        this.start(this.lastOptions || {});
      }
    }

    _emit() {
      if (typeof this.onUpdate === "function") this.onUpdate(this.getSnapshot());
    }
  }

  function phaseBucket(id) {
    return { id, moves: 0, winLosses: [], errors: 0, blunders: 0, evidence: [] };
  }

  function contextBucket() {
    return { moves: 0, winLosses: [], good: 0, errors: 0, evidence: [] };
  }

  function preferenceBucket(id) {
    return { id, chosen: 0, opportunities: 0, evidence: [] };
  }

  function addDecision(bucket, winLoss, judgment, evidence) {
    bucket.moves += 1;
    bucket.winLosses.push(winLoss);
    if (winLoss <= 5) bucket.good = (bucket.good || 0) + 1;
    if (["mistake", "blunder"].includes(judgment)) {
      bucket.errors += 1;
      pushEvidence(bucket.evidence, evidence);
    }
    if (judgment === "blunder") bucket.blunders = (bucket.blunders || 0) + 1;
  }

  function pushEvidence(target, item, limit = 8) {
    target.push(item);
    target.sort((a, b) => (b.winLoss || 0) - (a.winLoss || 0));
    if (target.length > limit) target.length = limit;
  }

  function pushPreferenceEvidence(target, item, limit = 8) {
    if (target.length >= limit) return;
    target.push(item);
  }

  function uniqueCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (!candidate?.uci || seen.has(candidate.uci)) return false;
      seen.add(candidate.uci);
      return true;
    });
  }

  function classifyCandidate(fen, line, previousUci = "") {
    const uci = line?.pv?.[0];
    if (!uci || typeof global.Chess !== "function") return null;
    try {
      const chess = new global.Chess(fen);
      const moverColor = chess.turn();
      const movingPiece = chess.get(uci.slice(0, 2));
      const beforeBalance = materialBalance(chess, moverColor);
      const beforeNonPawn = totalNonPawnMaterial(chess);
      const beforeQueens = countPieces(chess, "q");
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) return null;

      const check = /[+#]/.test(move.san || "");
      const capture = Boolean(move.captured) || /x/.test(move.san || "");
      const routineRecapture = capture && previousUci.slice(2, 4) === uci.slice(2, 4);
      const enemyKing = findKing(chess, moverColor === "w" ? "b" : "w");
      const pressure = check || attacksKingZone(chess, move.to, moverColor, enemyKing);
      const castling = /^O-O/.test(move.san || "");
      const development = Boolean(movingPiece) && ["n", "b"].includes(movingPiece.type) &&
        ["b1", "g1", "c1", "f1", "b8", "g8", "c8", "f8"].includes(move.from);
      const centralizes = Boolean(movingPiece) && ["n", "b", "r", "q"].includes(movingPiece.type) &&
        centreDistance(move.to) < centreDistance(move.from);

      for (const reply of (line.pv || []).slice(1, 4)) {
        const next = chess.move({
          from: reply.slice(0, 2),
          to: reply.slice(2, 4),
          promotion: reply.length > 4 ? reply[4] : undefined,
        });
        if (!next) break;
      }
      const materialChange = materialBalance(chess, moverColor) - beforeBalance;
      const nonPawnReduction = beforeNonPawn - totalNonPawnMaterial(chess);
      const queenExchange = beforeQueens >= 2 && countPieces(chess, "q") === 0;

      return {
        uci,
        san: move.san || uci,
        score: line.score || { cp: 0 },
        capture,
        check,
        pressure,
        routineRecapture,
        quietImprovement: !capture && !check && (castling || development || centralizes),
        forcing: !routineRecapture && (capture || check),
        simplification: !routineRecapture && (queenExchange || nonPawnReduction >= 6),
        materialInvestment: materialChange <= -2,
      };
    } catch {
      return null;
    }
  }

  function attacksKingZone(chess, from, color, kingSquare) {
    if (!kingSquare) return false;
    const piece = chess.get(from);
    if (!piece || piece.color !== color || piece.type === "k") return false;
    const king = squareCoordinates(kingSquare);
    return attackedSquares(chess, from, piece).some((square) => {
      const target = squareCoordinates(square);
      return Math.max(Math.abs(target.file - king.file), Math.abs(target.rank - king.rank)) <= 1;
    });
  }

  function attackedSquares(chess, from, piece) {
    const origin = squareCoordinates(from);
    const results = [];
    const add = (file, rank) => {
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return false;
      const square = coordinatesSquare(file, rank);
      results.push(square);
      return !chess.get(square);
    };
    const rays = (directions) => {
      for (const [df, dr] of directions) {
        for (let step = 1; step < 8; step += 1) {
          if (!add(origin.file + df * step, origin.rank + dr * step)) break;
        }
      }
    };

    if (piece.type === "p") {
      const dr = piece.color === "w" ? 1 : -1;
      add(origin.file - 1, origin.rank + dr);
      add(origin.file + 1, origin.rank + dr);
    } else if (piece.type === "n") {
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        add(origin.file + df, origin.rank + dr);
      }
    } else if (piece.type === "b") {
      rays([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    } else if (piece.type === "r") {
      rays([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    } else if (piece.type === "q") {
      rays([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]);
    }
    return results;
  }

  function squareCoordinates(square) {
    return { file: square.charCodeAt(0) - 97, rank: Number(square[1]) - 1 };
  }

  function coordinatesSquare(file, rank) {
    return `${String.fromCharCode(97 + file)}${rank + 1}`;
  }

  function centreDistance(square) {
    const point = squareCoordinates(square);
    return Math.min(...[[3, 3], [4, 3], [3, 4], [4, 4]].map(([file, rank]) =>
      Math.abs(point.file - file) + Math.abs(point.rank - rank)));
  }

  function findKing(chess, color) {
    for (const row of chess.board()) {
      for (const piece of row) {
        if (piece?.type === "k" && piece.color === color) return piece.square;
      }
    }
    return "";
  }

  function materialBalance(chess, color) {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    return chess.board().flat().filter(Boolean).reduce((sum, piece) =>
      sum + (piece.color === color ? 1 : -1) * (values[piece.type] || 0), 0);
  }

  function totalNonPawnMaterial(chess) {
    const values = { n: 3, b: 3, r: 5, q: 9 };
    return chess.board().flat().filter(Boolean).reduce((sum, piece) => sum + (values[piece.type] || 0), 0);
  }

  function countPieces(chess, type) {
    return chess.board().flat().filter((piece) => piece?.type === type).length;
  }

  function phaseFor(fen, ply) {
    if (ply <= 20) return "opening";
    const placement = String(fen).split(" ")[0];
    const noQueens = !/[qQ]/.test(placement);
    const values = { r: 5, b: 3, n: 3 };
    const nonPawn = [...placement.toLowerCase()].reduce((sum, piece) => sum + (values[piece] || 0), 0);
    return noQueens && nonPawn <= 20 ? "endgame" : "middlegame";
  }

  function scoreCp(score) {
    return global.MoveQuality.scoreToCpWhite(score);
  }

  function playerOutcome(game) {
    if (game.result === "1/2-1/2" || game.result === "*") return "draw";
    const won = (game.player_color === "white" && game.result === "1-0") ||
      (game.player_color === "black" && game.result === "0-1");
    return won ? "win" : "loss";
  }

  function metric(bucket) {
    const stability = bucket.moves ? Math.round(((bucket.good || 0) / bucket.moves * 100) * 10) / 10 : null;
    return {
      id: bucket.id,
      moves: bucket.moves,
      stability,
      errors: bucket.errors || 0,
      blunders: bucket.blunders || 0,
      evidence: bucket.evidence || [],
    };
  }

  function wilsonInterval(chosen, opportunities) {
    if (!opportunities) return [0, 0];
    const z = 1.96;
    const p = chosen / opportunities;
    const denominator = 1 + z * z / opportunities;
    const centre = (p + z * z / (2 * opportunities)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * opportunities)) / opportunities) / denominator;
    return [Math.max(0, (centre - margin) * 100), Math.min(100, (centre + margin) * 100)];
  }

  function preferenceMetric(definition, bucket) {
    const opportunities = bucket.opportunities;
    const percentage = opportunities ? bucket.chosen / opportunities * 100 : 0;
    const interval = wilsonInterval(bucket.chosen, opportunities).map((value) => Math.round(value));
    const confidence = opportunities >= 50 ? "alta" : opportunities >= 20 ? "media" :
      opportunities >= 8 ? "baja" : "insuficiente";
    const status = opportunities < 8 ? "Sin evidencia suficiente" : percentage >= 65 ?
      "Preferencia visible" : percentage <= 35 ? "Suele elegir la alternativa" : "Elección equilibrada";
    const summaries = {
      initiative: percentage >= 65 ?
        "Cuando dispone de varias continuaciones buenas, suele escoger la que crea presión inmediata sobre el rey." :
        "Aunque exista una opción de presión directa, suele preferir una continuación menos inmediata.",
      improvement: percentage >= 65 ?
        "Suele mejorar, desarrollar o centralizar sus piezas antes de iniciar acciones concretas." :
        "Cuando puede mejorar una pieza con calma, a menudo elige una continuación más concreta.",
      forcing: percentage >= 65 ?
        "Ante alternativas de calidad parecida, se inclina por jaques o capturas que obligan al rival a responder." :
        "No fuerza la posición por sistema: suele conservar opciones cuando el jaque o la captura no son necesarios.",
      simplification: percentage >= 65 ?
        "Acepta cambios relevantes cuando puede simplificar sin empeorar su posición." :
        "Suele mantener más piezas en el tablero cuando el cambio y la continuación compleja son igualmente buenos.",
      investment: percentage >= 65 ?
        "Acepta entregar material si obtiene actividad o compensación suficiente a cambio." :
        "Prefiere conservar el material antes que entrar en sacrificios cuya compensación es principalmente dinámica.",
      counterplay: percentage >= 65 ?
        "Cuando el rival toma la iniciativa, busca respuestas activas sin necesidad de estar objetivamente peor." :
        "Bajo presión, suele estabilizar la posición antes que responder con contrajuego inmediato.",
    };
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      chosen: bucket.chosen,
      opportunities,
      percentage: Math.round(percentage * 10) / 10,
      interval,
      confidence,
      status,
      summary: opportunities >= 8 ? summaries[definition.id] : "",
      evidence: bucket.evidence,
    };
  }

  function finding(kind, title, text, evidence, confidence = "media") {
    const summaries = {
      phase: title.startsWith("Más estable") ?
        "Es la fase en la que mantiene la calidad de sus posiciones con mayor regularidad." :
        "En esta fase pierde el control de la posición con más frecuencia que en el resto.",
      defence: title.startsWith("Responde") ?
        "Suele encontrar recursos fiables cuando el rival toma la iniciativa." :
        "La presión sostenida le obliga a tomar decisiones menos fiables.",
      counterattack: title.startsWith("Respuestas activas precisas") ?
        "Su contrajuego es un recurso real: responde activamente sin comprometer la posición." :
        "Las respuestas activas bajo presión tienden a conceder más de lo que generan.",
      conversion: title.startsWith("Buenos") ?
        "Cuando consigue una ventaja clara, suele llevarla hasta un buen resultado." :
        "Concederle una ventaja no siempre decide la partida: su conversión deja opciones prácticas.",
      resistance: title.startsWith("Salva") ?
        "Mantiene recursos prácticos incluso después de quedar objetivamente inferior." :
        "Cuando queda inferior, le cuesta cambiar el rumbo de la partida.",
    };
    return { kind, title, text, summary: summaries[kind] || text, evidence: evidence || [], confidence };
  }

  function styleSynthesis(styleChoices, diagnostics) {
    const usable = styleChoices.filter((choice) => choice.opportunities >= 8);
    if (!usable.length) {
      return {
        headline: diagnostics.evaluated ? "Todavía no hay suficientes decisiones comparables" :
          "La evidencia aparecerá durante el análisis",
        narrative: [
          diagnostics.evaluated ?
            "La muestra no repite suficientes decisiones del mismo tipo como para definir un estilo estable." :
            "Inicia Stockfish para comparar la jugada elegida con alternativas de calidad similar. El perfil inmediato solo contiene hechos del PGN.",
        ],
      };
    }

    const byId = Object.fromEntries(usable.map((choice) => [choice.id, choice]));
    const preferred = usable.filter((choice) => choice.percentage >= 65);
    const avoided = usable.filter((choice) => choice.percentage <= 35);
    let headline = "Un jugador adaptable, sin una preferencia dominante";
    if (byId.initiative?.percentage >= 65 && byId.improvement?.percentage >= 65) {
      headline = "La presión y la mejora tranquila de piezas coexisten";
    } else if (byId.counterplay?.percentage >= 65) {
      headline = "Busca contrajuego cuando recibe presión";
    } else if (byId.simplification?.percentage >= 65) {
      headline = "Tiende a simplificar cuando ambas rutas son sanas";
    } else if (byId.initiative?.percentage >= 65) {
      headline = "Prefiere crear presión inmediata cuando puede";
    } else if (byId.improvement?.percentage >= 65) {
      headline = "Prefiere mejorar las piezas antes de forzar";
    } else if (byId.investment?.percentage <= 35) {
      headline = "Prefiere conservar el material antes que especular";
    } else if (byId.forcing?.percentage <= 35) {
      headline = "Suele mantener opciones antes que forzar la posición";
    }

    const narrative = [];
    if (preferred.length) {
      narrative.push(preferred.slice(0, 2).map((choice) => choice.summary).join(" "));
    }
    if (avoided.length) {
      narrative.push(avoided.slice(0, 2).map((choice) => choice.summary).join(" "));
    }
    if (!preferred.length && !avoided.length) {
      narrative.push("No muestra una inclinación estable hacia forzar, simplificar o jugar con calma. Su elección cambia con las necesidades de la posición.");
    }
    if (byId.initiative?.percentage >= 65 && byId.improvement?.percentage >= 65) {
      narrative.push("Puede construir la posición con calma y pasar a la presión directa cuando la posición lo justifica; ambos rasgos conviven en su juego.");
    }
    return { headline, narrative };
  }

  function buildReport(controller) {
    const phases = PHASE_ORDER.map((id) => metric(controller.phases[id]));
    const styleChoices = STYLE_DEFINITIONS.map((definition) =>
      preferenceMetric(definition, controller.preferences[definition.id]));
    const synthesis = styleSynthesis(styleChoices, controller.styleDiagnostics);
    const usable = phases.filter((phase) => phase.moves >= 5 && phase.stability != null);
    const strengths = [];
    const watchouts = [];
    if (usable.length) {
      const ordered = [...usable].sort((a, b) => b.stability - a.stability);
      const best = ordered[0];
      const worst = ordered[ordered.length - 1];
      strengths.push(finding(
        "phase",
        `Más estable en ${phaseName(best.id).toLowerCase()}`,
        `${best.stability.toFixed(1)}% de decisiones estables en ${best.moves} jugadas analizadas.`,
        best.evidence,
        best.moves >= 20 ? "alta" : "media",
      ));
      if (worst.id !== best.id && best.stability - worst.stability >= 4) {
        watchouts.push(finding(
          "phase",
          `${phaseName(worst.id)} por debajo de sus otras fases`,
          `${worst.stability.toFixed(1)}% de decisiones estables en ${worst.moves} jugadas analizadas.`,
          worst.evidence,
          worst.moves >= 20 ? "alta" : "media",
        ));
      }
    }

    const defensive = controller.contexts.defensive;
    if (defensive.moves >= 5) {
      const rate = defensive.good / defensive.moves * 100;
      const target = rate >= 72 ? strengths : rate <= 52 ? watchouts : null;
      target?.push(finding(
        "defence",
        rate >= 72 ? "Responde con precisión ante presión" : "Respuestas bajo presión a revisar",
        `${rate.toFixed(1)}% de ${defensive.moves} decisiones tras presión rival perdieron menos de cinco puntos de expectativa. Incluye posiciones igualadas.`,
        defensive.evidence,
      ));
    }

    const counter = controller.contexts.counterattack;
    if (counter.moves >= 3) {
      const rate = counter.good / counter.moves * 100;
      (rate >= 65 ? strengths : watchouts).push(finding(
        "counterattack",
        rate >= 65 ? "Respuestas activas precisas" : "Respuestas activas que ceden demasiado",
        `${rate.toFixed(1)}% de ${counter.moves} jaques o capturas precisos llegaron tras presión rival. No se exige estar peor.`,
        counter.evidence,
        counter.moves >= 8 ? "alta" : "baja",
      ));
    }

    if (controller.conversion.opportunities >= 3) {
      const rate = controller.conversion.converted / controller.conversion.opportunities * 100;
      (rate >= 70 ? strengths : watchouts).push(finding(
        "conversion",
        rate >= 70 ? "Buenos resultados tras obtener ventaja" : "Ventajas que no siempre acabaron en victoria",
        `Ganó ${controller.conversion.converted} de ${controller.conversion.opportunities} partidas donde llegó a tener al menos +1,5. Es resultado posterior, no una nota de técnica.`,
        controller.conversion.evidence,
      ));
    }

    if (controller.resistance.opportunities >= 3) {
      const rate = controller.resistance.saved / controller.resistance.opportunities * 100;
      (rate >= 45 ? strengths : watchouts).push(finding(
        "resistance",
        rate >= 45 ? "Salva resultados desde posiciones inferiores" : "Poca recuperación tras quedar inferior",
        `Evitó la derrota en ${controller.resistance.saved} de ${controller.resistance.opportunities} partidas donde llegó a −1,5.`,
        controller.resistance.evidence,
      ));
    }

    const forcing = metric(controller.contexts.forcing);
    const quiet = metric(controller.contexts.quiet);
    const plan = [];
    const weakest = [...usable].sort((a, b) => a.stability - b.stability)[0];
    if (weakest) plan.push({
      title: `Entrenar ${phaseName(weakest.id).toLowerCase()}`,
      text: "Revisa primero sus errores más relevantes de esta fase y prepara posiciones del mismo tipo.",
      evidence: weakest.evidence,
    });
    if (forcing.stability != null && quiet.stability != null) {
      const weaker = forcing.stability < quiet.stability ? forcing : quiet;
      plan.push({
        title: forcing.stability < quiet.stability ? "Forzarle a calcular" : "Negarle objetivos inmediatos",
        text: `Las decisiones ${weaker === forcing ? "forzantes" : "tranquilas"} son el contexto comparativamente más incómodo de la muestra analizada.`,
        evidence: weaker.evidence,
      });
    }
    const pronounced = styleChoices
      .filter((choice) => choice.opportunities >= 8 && (choice.percentage >= 65 || choice.percentage <= 35))
      .sort((a, b) => b.opportunities - a.opportunities)[0];
    if (pronounced) plan.push({
      title: `Preparar la elección: ${pronounced.name.toLowerCase()}`,
      text: "Esta elección se repite con evidencia suficiente. Practica ambas ramas, no solo la más frecuente.",
      evidence: pronounced.evidence,
    });
    if (watchouts[0]) plan.push({
      title: "Convertir el patrón en preparación",
      text: `Busca posiciones que repitan «${watchouts[0].title.toLowerCase()}» y comprueba una respuesta concreta antes de la partida.`,
      evidence: watchouts[0].evidence,
    });

    return {
      phases,
      styleChoices,
      styleHeadline: synthesis.headline,
      styleNarrative: synthesis.narrative,
      styleDiagnostics: { ...controller.styleDiagnostics },
      strengths,
      watchouts,
      plan,
    };
  }

  function phaseName(id) {
    return ({ opening: "Apertura", middlegame: "Medio juego", endgame: "Final" })[id] || id;
  }

  global.PlayerEngineProfileController = PlayerEngineProfileController;
})(window);
