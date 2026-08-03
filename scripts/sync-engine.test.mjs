// Testes das regras de sincronização por ações (src/sync-engine.js).
//
// Cada caso aqui corresponde a uma perda de dados que já aconteceu de verdade
// com o usuário. Se alguém mexer no motor de sync e um destes quebrar, é perda
// silenciosa de diário — não é "teste chato", é o aviso.

import assert from "node:assert/strict";
import { actionsCutoff, nextActionsCutoff, resolveCompactionResult } from "../src/sync-engine.js";

// --- actionsCutoff --------------------------------------------------------

assert.equal(
  actionsCutoff({ actionsThrough: "2026-08-01T18:00:00.000+00:00" }),
  "2026-08-01T18:00:00.000+00:00",
  "com a marca gravada, a leitura filtra a partir dela"
);

assert.equal(
  actionsCutoff({ data: {} }),
  null,
  "pacote antigo sem a marca deve ler TODAS as acoes (null = sem filtro), nunca cair no updated_at"
);

assert.equal(actionsCutoff(null), null, "sem pacote nenhum, ler tudo");
assert.equal(actionsCutoff({ actionsThrough: "nao-e-data" }), null, "marca corrompida deve ler tudo");

// --- nextActionsCutoff ----------------------------------------------------

// O CASO DO TABLET: a compactação buscou as ações às 18:00:00, o upload de
// 500KB terminou às 18:00:09 e o banco carimbou updated_at = 18:00:09. A ação
// digitada às 18:00:04 NAO entrou no pacote. Se a marca virasse 18:00:09, essa
// ação sumiria da leitura pra sempre. Ela tem que parar na ultima ação
// realmente absorvida (18:00:00).
assert.equal(
  nextActionsCutoff(
    [
      { id: "a", created_at: "2026-08-01T17:59:58.000+00:00" },
      { id: "b", created_at: "2026-08-01T18:00:00.000+00:00" }
    ],
    "2026-08-01T17:00:00.000+00:00"
  ),
  "2026-08-01T18:00:00.000+00:00",
  "a marca avanca ate a ultima acao absorvida, nao ate o fim do upload"
);

{
  const cutoff = nextActionsCutoff(
    [{ id: "b", created_at: "2026-08-01T18:00:00.000+00:00" }],
    "2026-08-01T17:00:00.000+00:00"
  );
  const acaoDigitadaDuranteOUpload = "2026-08-01T18:00:04.000+00:00";
  assert.ok(
    Date.parse(acaoDigitadaDuranteOUpload) > Date.parse(cutoff),
    "acao criada durante o upload precisa continuar visivel para a proxima leitura"
  );
}

assert.equal(
  nextActionsCutoff([], "2026-08-01T17:00:00.000+00:00"),
  "2026-08-01T17:00:00.000+00:00",
  "sem acoes absorvidas, a marca anterior e mantida"
);

assert.equal(nextActionsCutoff([], null), null, "sem acoes e sem marca anterior, segue sem filtro");

assert.equal(
  nextActionsCutoff(
    [{ id: "a", created_at: "2026-08-01T10:00:00.000+00:00" }],
    "2026-08-01T17:00:00.000+00:00"
  ),
  "2026-08-01T17:00:00.000+00:00",
  "a marca nunca anda pra tras"
);

assert.equal(
  nextActionsCutoff([{ id: "a", created_at: null }], null),
  null,
  "acao sem created_at nao pode virar marca"
);

// --- resolveCompactionResult ----------------------------------------------

const merge = (local, remoto) => ({ merged: true, local, remoto });

{
  const baseline = { notas: 1 };
  const resultado = resolveCompactionResult({
    baseline,
    latest: baseline,
    saved: { notas: 1, vindoDaNuvem: true },
    merge
  });
  assert.deepEqual(
    resultado,
    { data: { notas: 1, vindoDaNuvem: true }, suppressAutoSave: true, hadConcurrentEdits: false },
    "sem digitacao concorrente, a tela recebe o que foi gravado e nao reenvia"
  );
}

{
  // O professor digitou enquanto a compactação subia. Sobrescrever a tela com
  // `saved` apagaria essa digitação — foi o que fazia o setData(merged) antigo.
  const baseline = { notas: 1 };
  const latest = { notas: 2 };
  const saved = { notas: 1, vindoDaNuvem: true };
  const resultado = resolveCompactionResult({ baseline, latest, saved, merge });

  assert.equal(resultado.hadConcurrentEdits, true);
  assert.equal(
    resultado.suppressAutoSave,
    false,
    "com digitacao concorrente o auto-save PRECISA rodar pra enviar a diferenca"
  );
  assert.equal(
    resultado.data.local,
    latest,
    "o estado da tela tem que vencer o conflito, senao a digitacao e descartada"
  );
  assert.notEqual(resultado.data, saved, "a tela nunca pode ser sobrescrita pelo pacote antigo");
}

console.log("sync-engine: OK");
