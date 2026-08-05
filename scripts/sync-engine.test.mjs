// Testes das regras de sincronização por ações (src/sync-engine.js).
//
// Cada caso aqui corresponde a uma perda de dados que já aconteceu de verdade
// com o usuário. Se alguém mexer no motor de sync e um destes quebrar, é perda
// silenciosa de diário — não é "teste chato", é o aviso.

import assert from "node:assert/strict";
import {
  actionsCutoff,
  nextActionsCutoff,
  resolveCompactionResult,
  incomingIsNewer,
  mergeAttendance,
  mergeLessonPair,
  compareLessonsNewestFirst
} from "../src/sync-engine.js";

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

// --- incomingIsNewer --------------------------------------------------------

assert.equal(
  incomingIsNewer({ createdAt: "2026-08-01T10:00:00Z" }, { createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-02T10:00:00Z" }),
  true,
  "edicao feita depois tem que vencer"
);

assert.equal(
  incomingIsNewer({ createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-03T10:00:00Z" }, { createdAt: "2026-08-01T10:00:00Z" }),
  false,
  "versao antiga do outro aparelho nao pode desfazer edicao mais nova"
);

assert.equal(
  incomingIsNewer({ createdAt: "2026-08-01T10:00:00Z" }, { createdAt: "2026-08-01T10:00:00Z" }),
  false,
  "empate mantem o que esta na tela"
);

assert.equal(
  incomingIsNewer({ createdAt: "2026-08-01T10:00:00Z" }, {}),
  false,
  "sem carimbo nenhum, nao mexer"
);

// --- mergeAttendance --------------------------------------------------------

{
  // Aluno que só existe de um lado NUNCA pode sumir.
  const { attendance, added } = mergeAttendance(
    [{ studentId: "a", status: "present" }],
    [{ studentId: "b", status: "absent", studentName: "Bruna" }],
    false
  );
  assert.equal(added, 1);
  assert.deepEqual(
    attendance.map((r) => r.studentId).sort(),
    ["a", "b"],
    "a uniao da chamada nao pode perder aluno"
  );
}

{
  // Chamada feita ganha de chamada não feita, mesmo com o carimbo contra.
  const { attendance, updated } = mergeAttendance(
    [{ studentId: "a", status: "not-taken" }],
    [{ studentId: "a", status: "absent" }],
    false
  );
  assert.equal(updated, 1);
  assert.equal(attendance[0].status, "absent", "chamada feita nao pode ser apagada por 'nao feita'");
}

{
  const { attendance, updated } = mergeAttendance(
    [{ studentId: "a", status: "present" }],
    [{ studentId: "a", status: "not-taken" }],
    true
  );
  assert.equal(updated, 0);
  assert.equal(attendance[0].status, "present", "'nao feita' nunca sobrescreve uma chamada ja feita");
}

{
  // ESTE é o caso do usuário: presença trocada no tablet, PC com o valor velho.
  const { attendance, updated } = mergeAttendance(
    [{ studentId: "a", status: "present" }],
    [{ studentId: "a", status: "absent" }],
    true
  );
  assert.equal(updated, 1);
  assert.equal(attendance[0].status, "absent", "a chamada corrigida por ultimo tem que vencer");
}

{
  const { attendance } = mergeAttendance(
    [{ studentId: "a", status: "present" }],
    [{ studentId: "a", status: "absent" }],
    false
  );
  assert.equal(attendance[0].status, "present", "sem ser mais nova, a versao que chega nao troca a chamada");
}

{
  const original = [{ studentId: "a", status: "present" }];
  mergeAttendance(original, [{ studentId: "a", status: "absent" }], true);
  assert.equal(original[0].status, "present", "mergeAttendance nao pode mutar a lista recebida");
}

// --- mergeLessonPair --------------------------------------------------------

{
  // O bug relatado: o conteudo corrigido no tablet nao chegava no PC porque a
  // aula ja existia dos dois lados e a mesclagem so sabia ADICIONAR.
  const noPc = {
    id: "aula-1",
    date: "2026-08-01",
    periods: 2,
    content: "Conteudo antigo",
    createdAt: "2026-08-01T10:00:00Z",
    attendance: [{ studentId: "a", status: "present" }]
  };
  const doTablet = {
    id: "aula-1",
    date: "2026-08-01",
    periods: 3,
    content: "Conteudo corrigido",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T19:00:00Z",
    attendance: [{ studentId: "a", status: "absent" }]
  };

  const { lesson, fieldsUpdated, attendanceUpdated } = mergeLessonPair(noPc, doTablet);
  assert.equal(lesson.content, "Conteudo corrigido", "conteudo corrigido em outro aparelho tem que aparecer aqui");
  assert.equal(lesson.periods, 3, "numero de aulas corrigido tem que aparecer aqui");
  assert.equal(lesson.attendance[0].status, "absent", "a falta lancada depois tem que aparecer aqui");
  assert.equal(lesson.updatedAt, "2026-08-01T19:00:00Z", "o carimbo tem que andar junto, senao o proximo merge desfaz");
  assert.equal(fieldsUpdated, 2);
  assert.equal(attendanceUpdated, 1);
  assert.equal(noPc.content, "Conteudo antigo", "mergeLessonPair nao pode mutar a aula recebida");
}

{
  // Direção contrária: o que chega é mais velho e nao pode desfazer nada.
  const local = {
    id: "aula-1",
    content: "Corrigido agora",
    periods: 1,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-02T09:00:00Z",
    attendance: [{ studentId: "a", status: "absent" }]
  };
  const remoto = {
    id: "aula-1",
    content: "Versao antiga",
    periods: 5,
    createdAt: "2026-08-01T10:00:00Z",
    attendance: [{ studentId: "a", status: "present" }, { studentId: "b", status: "present" }]
  };

  const { lesson, fieldsUpdated } = mergeLessonPair(local, remoto);
  assert.equal(fieldsUpdated, 0);
  assert.equal(lesson.content, "Corrigido agora", "versao antiga nao pode reverter a edicao mais nova");
  assert.equal(lesson.periods, 1);
  assert.equal(lesson.attendance.find((r) => r.studentId === "a").status, "absent");
  assert.equal(
    lesson.attendance.find((r) => r.studentId === "b").status,
    "present",
    "mesmo perdendo o conflito, aluno que so existe do outro lado entra"
  );
}

// --- compareLessonsNewestFirst ----------------------------------------------

{
  // Mesmos dados, ordens de chegada diferentes: aula criada no proprio aparelho
  // entra no topo do array, aula que chega pela sincronizacao entra no fim.
  const a = { id: "a", date: "2026-08-01", createdAt: "2026-08-01T10:00:00Z" };
  const b = { id: "b", date: "2026-08-03", createdAt: "2026-08-03T10:00:00Z" };
  const c = { id: "c", date: "2026-08-02", createdAt: "2026-08-02T10:00:00Z" };

  const tablet = [b, c, a].slice().sort(compareLessonsNewestFirst);
  const pc = [a, c, b].slice().sort(compareLessonsNewestFirst);

  assert.deepEqual(tablet.map((l) => l.id), ["b", "c", "a"], "a mais recente vem primeiro");
  assert.deepEqual(
    tablet.map((l) => l.id),
    pc.map((l) => l.id),
    "os dois aparelhos precisam listar as aulas na MESMA ordem"
  );
}

{
  // Duas aulas no mesmo dia sem carimbo: sem o desempate por id cada aparelho
  // mantinha a ordem que por acaso tinha, e "Registros" cortava aulas
  // diferentes em cada um.
  const x = { id: "x", date: "2026-08-01" };
  const y = { id: "y", date: "2026-08-01" };
  assert.deepEqual(
    [y, x].slice().sort(compareLessonsNewestFirst).map((l) => l.id),
    [x, y].slice().sort(compareLessonsNewestFirst).map((l) => l.id),
    "ordem tem que ser estavel mesmo sem data de criacao"
  );
}

console.log("sync-engine: OK");
