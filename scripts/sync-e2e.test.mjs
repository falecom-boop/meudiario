// Teste end-to-end do protocolo de sincronização, por linha do tempo.
//
// Encena tablet + celular contra um servidor simulado (as tabelas
// diario_current e diario_actions em memória), usando o MOTOR REAL do app —
// diffData/applyPatches/actionsCutoff/nextActionsCutoff vêm de
// src/sync-engine.js, não são reimplementados aqui. Só o transporte é falso.
//
// O caso central é o que aconteceu de verdade em 01/08/2026: o tablet gravou
// tudo, o app disse "salvo" (e era verdade), e o celular abriu sem as aulas.

import assert from "node:assert/strict";
import {
  ACTIONS_THROUGH_FIELD,
  actionsCutoff,
  nextActionsCutoff,
  diffData,
  applyPatches
} from "../src/sync-engine.js";

// --- Servidor simulado ------------------------------------------------------

function criarServidor() {
  return {
    current: null, // { payload, updated_at }
    actions: [], // { id, created_at, patch }
    proximoId: 1,

    // POST /diario_actions
    appendAction(patch, created_at) {
      this.actions.push({ id: `acao-${this.proximoId++}`, created_at, patch });
    },

    // GET /diario_actions?created_at=gt.<cutoff>
    fetchPendingActions(cutoff) {
      const lista = cutoff
        ? this.actions.filter((a) => Date.parse(a.created_at) > Date.parse(cutoff))
        : this.actions;
      return [...lista].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    },

    // upsert /diario_current — o updated_at é carimbado pelo BANCO no momento
    // em que a gravação termina. É esse carimbo que envenenava a leitura.
    saveCurrentState(payload, agora) {
      this.current = { payload, updated_at: agora };
    },

    deleteActions(ids) {
      this.actions = this.actions.filter((a) => !ids.includes(a.id));
    }
  };
}

const vazio = { classes: [], lessons: [], assessments: [], recoveries: [], events: [], attendanceSummaries: [] };
const aula = (id, date, content) => ({ id, classId: "turma-1", date, content, attendance: [] });

// --- Aparelho (só o essencial do fluxo do app) ------------------------------

function criarAparelho(nome, servidor) {
  return {
    nome,
    data: structuredClone(vazio),
    ultimoEnviado: structuredClone(vazio),

    editar(mutacao) {
      const proximo = structuredClone(this.data);
      mutacao(proximo);
      this.data = proximo;
    },

    // appendActionToSupabase()
    salvarAcao(agora) {
      const patch = diffData(this.ultimoEnviado, this.data);
      if (Object.keys(patch).length === 0) return;
      servidor.appendAction(patch, agora);
      this.ultimoEnviado = structuredClone(this.data);
    },

    // loadRemoteState() + adoção da versão remota
    lerDaNuvem() {
      const cutoff = servidor.current ? actionsCutoff(servidor.current.payload) : null;
      const pendentes = servidor.fetchPendingActions(cutoff ?? undefined);
      const base = servidor.current?.payload?.data ?? structuredClone(vazio);
      this.data = pendentes.length ? applyPatches(base, pendentes) : structuredClone(base);
      this.ultimoEnviado = structuredClone(this.data);
      return this.data;
    },

    // compactToSnapshot(): busca tudo, mescla, grava, apaga o que absorveu.
    // `duranteOUpload` simula o professor digitando enquanto o pacote sobe.
    compactar({ inicio, fim, duranteOUpload }) {
      const cutoffAnterior = servidor.current ? actionsCutoff(servidor.current.payload) : null;
      const pendentes = servidor.fetchPendingActions(); // sem filtro: varre órfãs
      const base = servidor.current?.payload?.data ?? structuredClone(vazio);
      const reconstruido = applyPatches(base, pendentes);

      // O pacote é montado AGORA, com o estado deste instante.
      const pacote = {
        data: mesclar(this.data, reconstruido),
        [ACTIONS_THROUGH_FIELD]: nextActionsCutoff(pendentes, cutoffAnterior)
      };

      // ...e o upload leva tempo. É aqui que o professor continua digitando.
      if (duranteOUpload) duranteOUpload(inicio);

      servidor.saveCurrentState(pacote, fim);
      servidor.deleteActions(pendentes.map((a) => a.id));
      this.ultimoEnviado = structuredClone(pacote.data);
      return pacote;
    }
  };
}

// União simples por id, no espírito do mergeBackupData (nunca apaga).
function mesclar(local, remoto) {
  const saida = structuredClone(local);
  for (const campo of ["classes", "lessons", "assessments", "recoveries"]) {
    const porId = new Map((remoto[campo] ?? []).map((item) => [item.id, item]));
    for (const item of saida[campo] ?? []) porId.set(item.id, item);
    saida[campo] = [...porId.values()];
  }
  return saida;
}

// --- Caso 1: a perda do dia 01/08 ------------------------------------------

{
  const servidor = criarServidor();
  const tablet = criarAparelho("tablet", servidor);
  const celular = criarAparelho("celular", servidor);

  // Sábado de manhã: o professor lança três aulas no tablet.
  tablet.editar((d) => d.lessons.push(aula("aula-1", "2026-08-01", "Revisão")));
  tablet.salvarAcao("2026-08-01T17:59:50.000+00:00");
  tablet.editar((d) => d.lessons.push(aula("aula-2", "2026-08-01", "Exercícios")));
  tablet.salvarAcao("2026-08-01T18:00:00.000+00:00");

  // Passa do limite de ações: dispara a compactação. O pacote de 500KB leva
  // 9 segundos subindo — e às 18:00:04 o professor lança a terceira aula.
  tablet.compactar({
    inicio: "2026-08-01T18:00:00.500+00:00",
    fim: "2026-08-01T18:00:09.000+00:00",
    duranteOUpload: () => {
      tablet.editar((d) => d.lessons.push(aula("aula-3", "2026-08-01", "Prova bimestral")));
      tablet.salvarAcao("2026-08-01T18:00:04.000+00:00");
    }
  });

  // O tablet mostra as três aulas e diz "Tudo salvo" — e está falando a verdade:
  // a aula-3 está gravada no servidor como ação.
  assert.equal(tablet.data.lessons.length, 3, "o tablet tem as tres aulas na tela");
  assert.ok(
    servidor.actions.some((a) => a.patch.lessons?.added?.some((l) => l.id === "aula-3")),
    "a aula-3 esta gravada no servidor como acao"
  );

  // Domingo: o professor abre no celular. ESTE é o assert que reproduz o bug.
  const noCelular = celular.lerDaNuvem();
  const idsNoCelular = noCelular.lessons.map((l) => l.id).sort();

  assert.deepEqual(
    idsNoCelular,
    ["aula-1", "aula-2", "aula-3"],
    "o celular precisa abrir com as TRES aulas — a digitada durante o upload inclusive"
  );
  console.log("  caso 1: celular abriu com", idsNoCelular.length, "aulas (tablet tinha 3)");
}

// --- Caso 2: dois aparelhos editando, nada se perde -------------------------

{
  const servidor = criarServidor();
  const tablet = criarAparelho("tablet", servidor);
  const celular = criarAparelho("celular", servidor);

  tablet.editar((d) => d.lessons.push(aula("aula-tablet", "2026-08-01", "Aula do tablet")));
  tablet.salvarAcao("2026-08-01T10:00:00.000+00:00");

  celular.editar((d) => d.lessons.push(aula("aula-celular", "2026-08-01", "Aula do celular")));
  celular.salvarAcao("2026-08-01T10:00:05.000+00:00");

  tablet.compactar({ inicio: "2026-08-01T10:01:00.000+00:00", fim: "2026-08-01T10:01:03.000+00:00" });

  const visto = celular.lerDaNuvem().lessons.map((l) => l.id).sort();
  assert.deepEqual(visto, ["aula-celular", "aula-tablet"], "a compactacao junta o que veio dos dois aparelhos");
  console.log("  caso 2: os dois aparelhos convergiram em", visto.length, "aulas");
}

// --- Caso 3: a fila de ações realmente esvazia ------------------------------

{
  const servidor = criarServidor();
  const tablet = criarAparelho("tablet", servidor);

  for (let i = 1; i <= 5; i += 1) {
    tablet.editar((d) => d.lessons.push(aula(`aula-${i}`, "2026-08-01", `Aula ${i}`)));
    tablet.salvarAcao(`2026-08-01T09:0${i}:00.000+00:00`);
  }
  tablet.compactar({ inicio: "2026-08-01T09:06:00.000+00:00", fim: "2026-08-01T09:06:02.000+00:00" });

  assert.equal(servidor.actions.length, 0, "acoes absorvidas precisam sair da fila, senao voltam por cima depois");
  assert.equal(servidor.current.payload.data.lessons.length, 5, "as 5 aulas ficaram no pacote consolidado");
  console.log("  caso 3: fila zerada, 5 aulas consolidadas");
}

console.log("sync-e2e: OK");
