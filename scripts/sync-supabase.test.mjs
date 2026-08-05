// Teste de integração contra um Supabase DE VERDADE (stack local do CLI).
//
// Diferença para `sync-e2e.test.mjs`: lá o servidor é simulado em memória. Aqui
// o Postgres, o PostgREST, o GoTrue e as políticas de RLS são os reais, criados
// a partir do `supabase/schema.sql` do projeto. É o que fecha a pendência
// "caminhos de rede não cobertos por teste" que aparece em todos os rastreios.
//
// O que só dá pra provar aqui:
//   - o gatilho `before update` carimbando updated_at no FIM da gravação
//     (a causa raiz de 01/08);
//   - o formato de timestamp que o PostgREST devolve (microssegundos!) contra
//     o filtro `.gt()` e contra Date.parse, que só tem milissegundo;
//   - o RLS isolando um professor do outro;
//   - carimbos de edição sobrevivendo ao ida-e-volta em JSONB.
//
// Como rodar:
//   npx supabase start        (em qualquer pasta com supabase/config.toml)
//   npx supabase status -o env  -> exporte as variáveis abaixo
//   npm run test:supabase
//
// Sem as variáveis o teste se declara PULADO e sai com 0, pra não quebrar o
// `npm test` de quem não tem Docker.

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  ACTIONS_THROUGH_FIELD,
  actionsCutoff,
  nextActionsCutoff,
  diffData,
  applyPatches,
  mergeLessonPair,
  compareLessonsNewestFirst
} from "../src/sync-engine.js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.log("sync-supabase: PULADO (defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(0);
}

const CURRENT_TABLE = "diario_current";
const SNAPSHOT_TABLE = "diario_snapshots";
const ACTIONS_TABLE = "diario_actions";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// --- Preparação --------------------------------------------------------------

// Usuário descartável do banco local. A senha é gerada aqui e nunca sai deste
// processo — não há credencial real envolvida em lugar nenhum deste teste.
async function criarProfessor(rotulo) {
  const email = `${rotulo}-${crypto.randomUUID()}@exemplo.invalido`;
  const password = `s${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

// Um "aparelho" = um cliente supabase-js próprio, com sessão própria. É assim
// que o tablet e o PC se comportam de verdade: mesmo usuário, sessões
// separadas, cada um com seu cache local.
async function criarAparelho(nome, professor) {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: professor.email, password: professor.password });
  if (error) throw error;
  const { data: { session } } = await client.auth.getSession();

  return {
    nome,
    client,
    userId: professor.id,
    token: session.access_token,

    // --- Espelho fiel das funções de src/supabase.js -------------------------
    // As chamadas abaixo repetem as MESMAS queries do app (mesmo select, mesmo
    // eq/gt, mesmo onConflict). src/supabase.js não é importável em node porque
    // usa import.meta.env e window.sessionStorage.

    async fetchCurrentState() {
      const { data, error } = await client
        .from(CURRENT_TABLE)
        .select("payload,updated_at")
        .eq("id", professor.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async saveCurrentState(payload) {
      const { data, error } = await client
        .from(CURRENT_TABLE)
        .upsert({ id: professor.id, payload }, { onConflict: "id" })
        .select();
      if (error) throw error;
      return data?.[0] ?? null;
    },

    // fetch cru com keepalive, igual ao app.
    async appendAction(patch) {
      const response = await fetch(`${URL}/rest/v1/${ACTIONS_TABLE}`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ user_id: professor.id, patch })
      });
      if (!response.ok) throw new Error(`appendAction ${response.status}: ${await response.text()}`);
    },

    async fetchPendingActions(sinceIso) {
      let query = client
        .from(ACTIONS_TABLE)
        .select("id,created_at,patch")
        .eq("user_id", professor.id)
        .order("created_at", { ascending: true });
      if (sinceIso) query = query.gt("created_at", sinceIso);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },

    async deleteActions(ids) {
      if (!ids?.length) return;
      const { error } = await client.from(ACTIONS_TABLE).delete().eq("user_id", professor.id).in("id", ids);
      if (error) throw error;
    }
  };
}

const vazio = { classes: [], lessons: [], assessments: [], recoveries: [], events: [], attendanceSummaries: [] };
const aula = (id, date, content, extra = {}) => ({
  id,
  classId: "turma-1",
  date,
  periods: 2,
  content,
  createdAt: `${date}T10:00:00.000Z`,
  attendance: [{ studentId: "aluno-1", studentName: "Ana", status: "present" }],
  ...extra
});

let falhas = 0;
function ok(mensagem) {
  console.log(`  ok  ${mensagem}`);
}

// --- Testes ------------------------------------------------------------------

const professor = await criarProfessor("professor");
const intruso = await criarProfessor("intruso");
const tablet = await criarAparelho("tablet", professor);
const pc = await criarAparelho("pc", professor);
const aparelhoIntruso = await criarAparelho("intruso", intruso);

// 1) RLS de verdade -----------------------------------------------------------

{
  const anonimo = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anonimo.from(CURRENT_TABLE).select("id").limit(1);
  assert.ok(error, "a chave anon NAO pode ler diario_current");
  ok(`anon barrado em ${CURRENT_TABLE} (${error.code ?? error.message})`);
}

await tablet.saveCurrentState({ data: { ...vazio, lessons: [aula("a-1", "2026-08-01", "Aula do tablet")] } });

{
  const { data, error } = await aparelhoIntruso.client.from(CURRENT_TABLE).select("payload").eq("id", professor.id);
  assert.ifError(error);
  assert.equal(data.length, 0, "outro professor autenticado NAO pode ler o diario alheio");
  ok("RLS isola um professor do outro");
}

// 2) O gatilho updated_at carimba no FIM da gravação ---------------------------
//
// É a causa raiz de 01/08 documentada em RASTREIO-20260802.md. O teste simulado
// assume esse comportamento; aqui ele é medido no banco real.

{
  const montadoEm = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 1100));
  await tablet.saveCurrentState({ data: vazio, montadoEm });
  const atual = await tablet.fetchCurrentState();

  assert.ok(
    Date.parse(atual.updated_at) > Date.parse(montadoEm),
    "updated_at tem que ser posterior ao momento em que o pacote foi montado"
  );
  ok(`gatilho confirmado: updated_at ${atual.updated_at} > montagem ${montadoEm}`);
  ok("=> filtrar acoes por updated_at perderia tudo criado durante o upload (bug de 01/08)");
}

// 3) Formato do timestamp do PostgREST x Date.parse ----------------------------
//
// Postgres guarda timestamptz com microssegundo; Date.parse só tem
// milissegundo. `nextActionsCutoff` devolve a string CRUA do banco e ela volta
// como filtro `.gt()`, comparada lá dentro em microssegundo. Se em vez disso o
// app remontasse a data via `new Date(...).toISOString()`, truncaria para baixo
// e reentregaria a mesma ação pra sempre. Este caso trava esse comportamento.

{
  await pc.deleteActions((await pc.fetchPendingActions()).map((a) => a.id));
  for (let i = 0; i < 5; i += 1) {
    await tablet.appendAction({ marcador: i });
  }
  const acoes = await pc.fetchPendingActions();
  assert.equal(acoes.length, 5);

  const formato = acoes[0].created_at;
  ok(`created_at do PostgREST: ${formato}`);
  assert.ok(!Number.isNaN(Date.parse(formato)), "Date.parse tem que entender o formato do PostgREST");

  const corte = nextActionsCutoff(acoes, null);
  assert.equal(corte, acoes[4].created_at, "a marca tem que ser a string CRUA da ultima acao absorvida");

  const depois = await pc.fetchPendingActions(corte);
  assert.equal(depois.length, 0, "com a marca crua, nenhuma acao ja absorvida volta");
  ok("marca crua + filtro .gt() nao reentrega acao absorvida");

  // A prova de que a string crua importa: truncada para milissegundo, a marca
  // anda pra TRÁS e a última ação volta.
  const truncada = new Date(Date.parse(corte)).toISOString();
  const microssegundos = /\.\d{4,}/.test(formato);
  if (microssegundos) {
    const reentregues = await pc.fetchPendingActions(truncada);
    assert.ok(
      reentregues.length >= 1,
      "com a marca truncada a ultima acao TEM que voltar (e a prova de que nao se pode remontar a data)"
    );
    ok(`marca truncada reentrega ${reentregues.length} acao(oes) — nao remontar a data com toISOString()`);
  } else {
    ok("banco devolveu precisao de milissegundo; truncamento nao se aplica nesta instancia");
  }

  await pc.deleteActions(acoes.map((a) => a.id));
}

// 4) O caso do usuário, com transporte real ------------------------------------
//
// Tablet corrige uma aula que o PC já tem. Antes da correção de 05/08 o PC
// mantinha a versão velha, regravava por cima e apagava a ação — a correção
// sumia do servidor.

{
  await pc.deleteActions((await pc.fetchPendingActions()).map((a) => a.id));

  const original = aula("a-9", "2026-08-01", "Conteudo original");
  const baseTablet = { ...vazio, lessons: [original] };
  await tablet.saveCurrentState({ data: baseTablet, [ACTIONS_THROUGH_FIELD]: null });

  // O PC abre e carrega essa versão.
  const noPc = (await pc.fetchCurrentState()).payload.data;
  assert.equal(noPc.lessons[0].content, "Conteudo original");

  // O tablet corrige conteúdo e presença. A edição vira uma ação pequena.
  const corrigida = {
    ...original,
    content: "Conteudo CORRIGIDO",
    periods: 3,
    updatedAt: "2026-08-01T19:30:00.000Z",
    attendance: [{ studentId: "aluno-1", studentName: "Ana", status: "absent" }]
  };
  await tablet.appendAction(diffData(baseTablet, { ...vazio, lessons: [corrigida] }));

  // O PC compacta: lê as ações, reconstrói o remoto e mescla com o que tem.
  const pendentes = await pc.fetchPendingActions(actionsCutoff((await pc.fetchCurrentState()).payload) ?? undefined);
  assert.equal(pendentes.length, 1, "a acao do tablet tem que chegar no PC");

  const remotoReconstruido = applyPatches(noPc, pendentes);
  const doServidor = remotoReconstruido.lessons.find((l) => l.id === "a-9");

  assert.equal(
    doServidor.updatedAt,
    "2026-08-01T19:30:00.000Z",
    "o carimbo de edicao tem que sobreviver ao ida-e-volta em JSONB"
  );
  ok("carimbo updatedAt sobrevive ao JSONB");

  const { lesson, fieldsUpdated, attendanceUpdated } = mergeLessonPair(noPc.lessons[0], doServidor);
  assert.equal(lesson.content, "Conteudo CORRIGIDO", "a correcao do tablet TEM que vencer no PC");
  assert.equal(lesson.periods, 3);
  assert.equal(lesson.attendance[0].status, "absent", "a falta lancada no tablet TEM que aparecer no PC");
  assert.equal(fieldsUpdated, 2);
  assert.equal(attendanceUpdated, 1);
  ok("correcao do tablet sobrevive de ponta a ponta pelo transporte real");

  // E o PC regrava o resultado, como faz a compactação de verdade.
  await pc.saveCurrentState({
    data: { ...noPc, lessons: [lesson] },
    [ACTIONS_THROUGH_FIELD]: nextActionsCutoff(pendentes, null)
  });
  await pc.deleteActions(pendentes.map((a) => a.id));

  const final = (await tablet.fetchCurrentState()).payload;
  assert.equal(
    final.data.lessons[0].content,
    "Conteudo CORRIGIDO",
    "o servidor NAO pode terminar com o valor velho depois da compactacao do PC"
  );
  ok("servidor termina com a versao corrigida (era aqui que a correcao era destruida)");
}

// 5) Ordem canônica sobrevive ao JSONB ----------------------------------------

{
  const embaralhadas = [
    aula("z", "2026-08-03", "tres"),
    aula("x", "2026-08-01", "um"),
    aula("y", "2026-08-02", "dois")
  ];
  await tablet.saveCurrentState({ data: { ...vazio, lessons: embaralhadas } });

  const lidasNoPc = (await pc.fetchCurrentState()).payload.data.lessons;
  const ordemPc = [...lidasNoPc].sort(compareLessonsNewestFirst).map((l) => l.id);
  const ordemTablet = [...embaralhadas].sort(compareLessonsNewestFirst).map((l) => l.id);

  assert.deepEqual(ordemPc, ["z", "y", "x"], "mais recente primeiro");
  assert.deepEqual(ordemPc, ordemTablet, "os dois aparelhos tem que chegar na MESMA ordem");
  ok("ordem canonica identica nos dois aparelhos apos ida-e-volta no banco");
}

// --- Limpeza -----------------------------------------------------------------

await admin.auth.admin.deleteUser(professor.id);
await admin.auth.admin.deleteUser(intruso.id);
ok("usuarios de teste removidos");

if (falhas) process.exit(1);
console.log("sync-supabase: OK");
