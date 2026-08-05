// Regras puras da sincronização por ações.
//
// Ficam fora do main.jsx de propósito: é a parte do app onde um erro apaga
// trabalho do professor, e só separada assim dá pra testar de verdade em node
// (scripts/sync-engine.test.mjs). Nada aqui pode tocar em React, localStorage,
// rede ou Date.now() — funções puras, entrada e saída.

// Marca gravada dentro do pacote consolidado dizendo até onde as ações já
// foram absorvidas. Ver actionsCutoff() para o motivo de ela existir.
export const ACTIONS_THROUGH_FIELD = "actionsThrough";

// --- Texto e comparação -----------------------------------------------------

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Serialização com chaves ordenadas: dois objetos iguais viram a mesma string
// independentemente da ordem em que os campos foram criados. É a base da
// comparação do diff e do hash de integridade.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalize(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeHeader(text) {
  return normalize(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeKey(text) {
  return normalizeHeader(text).replace(/[^a-z0-9]/g, "");
}

// --- Motor de patch ---------------------------------------------------------

// Cada coleção do diário é comparada por uma chave estável. É isso que torna o
// diff idempotente: reaplicar o mesmo patch reescreve o item com o mesmo id.
export const DIFF_FIELD_KEYS = {
  classes: (item) => item.id,
  events: (item) => item.id ?? stableStringify(item),
  lessons: (item) => item.id,
  assessments: (item) => item.id,
  recoveries: (item) => item.id,
  attendanceSummaries: (item) =>
    `${item.classId}|${item.studentId}|${item.periodId}|${normalizeKey(item.source ?? "")}`
};

export function diffData(previous, next) {
  const patch = {};
  if (stableStringify(previous?.schoolYear) !== stableStringify(next?.schoolYear)) {
    patch.schoolYear = next.schoolYear;
  }
  for (const [field, keyOf] of Object.entries(DIFF_FIELD_KEYS)) {
    const prevItems = Array.isArray(previous?.[field]) ? previous[field] : [];
    const nextItems = Array.isArray(next?.[field]) ? next[field] : [];
    const prevMap = new Map(prevItems.map((item) => [keyOf(item), item]));
    const nextMap = new Map(nextItems.map((item) => [keyOf(item), item]));
    const added = [];
    const updated = [];
    const removed = [];
    for (const [key, item] of nextMap) {
      const prevItem = prevMap.get(key);
      if (!prevItem) added.push(item);
      else if (stableStringify(prevItem) !== stableStringify(item)) updated.push(item);
    }
    for (const key of prevMap.keys()) {
      if (!nextMap.has(key)) removed.push(key);
    }
    if (added.length || updated.length || removed.length) {
      patch[field] = { added, updated, removed };
    }
  }
  return patch;
}

export function isPatchEmpty(patch) {
  return !patch || Object.keys(patch).length === 0;
}

function applyFieldPatch(items, keyOf, fieldPatch) {
  if (!fieldPatch) return items;
  const map = new Map(items.map((item) => [keyOf(item), item]));
  for (const key of fieldPatch.removed ?? []) map.delete(key);
  for (const item of [...(fieldPatch.added ?? []), ...(fieldPatch.updated ?? [])]) map.set(keyOf(item), item);
  return [...map.values()];
}

// `migrate` é injetado (migrateData no app) pra este módulo continuar puro e
// testável em node sem arrastar o resto do main.jsx junto.
export function applyPatch(base, patch, migrate = (value) => value) {
  if (isPatchEmpty(patch)) return base;
  const result = { ...base };
  if (patch.schoolYear !== undefined) result.schoolYear = patch.schoolYear;
  for (const [field, keyOf] of Object.entries(DIFF_FIELD_KEYS)) {
    if (patch[field]) {
      result[field] = applyFieldPatch(Array.isArray(base[field]) ? base[field] : [], keyOf, patch[field]);
    }
  }
  return migrate(result);
}

export function applyPatches(base, patches, migrate) {
  return patches.reduce((acc, { patch }) => applyPatch(acc, patch, migrate), base);
}

function toTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? null : time;
}

// Até que momento as ações já estão dentro do pacote consolidado — ou seja, a
// partir de onde a leitura deve buscar ações pendentes.
//
// REGRA DE OURO: nunca usar o updated_at do banco pra isso. Ele é carimbado
// quando a gravação TERMINA, mas o pacote gravado foi montado antes do upload
// começar. O diário passa de 500KB, então o envio leva segundos — e toda ação
// criada nesse meio tempo fica com created_at menor que o updated_at novo.
// Filtrar por updated_at faz essas ações sumirem da leitura pra sempre: foi
// exatamente assim que o tablet gravou tudo e o celular abriu sem sábado.
export function actionsCutoff(payload) {
  const stored = payload?.[ACTIONS_THROUGH_FIELD];
  if (typeof stored === "string" && toTime(stored) !== null) return stored;
  // Pacote gravado por uma versão antiga do app, sem a marca. Aqui a escolha é
  // deliberada: ler TODAS as ações em vez de filtrar por data. Reaplicar uma
  // ação já absorvida reescreve o item com o mesmo valor (o motor de patch é
  // por id), enquanto filtrar demais some com edição real. Na dúvida, repetir.
  return null;
}

// Nova marca a gravar depois de absorver um lote de ações. Só avança até a
// ação mais recente que REALMENTE entrou no pacote — nunca até "agora".
export function nextActionsCutoff(appliedActions, previousCutoff) {
  let latest = null;
  let latestTime = null;
  for (const action of appliedActions ?? []) {
    const time = toTime(action?.created_at);
    if (time === null) continue;
    if (latestTime === null || time > latestTime) {
      latestTime = time;
      latest = action.created_at;
    }
  }
  if (latest === null) return previousCutoff ?? null;
  const previousTime = toTime(previousCutoff);
  // A marca nunca anda pra trás: se o pacote anterior já cobria mais, mantém.
  if (previousTime !== null && previousTime > latestTime) return previousCutoff;
  return latest;
}

// Decide o que fazer com a tela quando a compactação termina.
//
// A compactação monta o pacote a partir do estado do momento em que começou
// (`baseline`) e leva segundos pra subir. Se o professor digitou durante esse
// tempo, `latest` já é diferente — e sobrescrever a tela com o que foi gravado
// apaga o que ele acabou de digitar, sem aviso nenhum. Nesse caso mesclamos ao
// contrário (o estado da tela vence os conflitos) e deixamos o auto-save rodar
// pra mandar a diferença como uma ação nova.
export function resolveCompactionResult({ baseline, latest, saved, merge }) {
  if (latest === baseline || latest === undefined) {
    return { data: saved, suppressAutoSave: true, hadConcurrentEdits: false };
  }
  return { data: merge(latest, saved), suppressAutoSave: false, hadConcurrentEdits: true };
}

// --- Conflito entre dois aparelhos ------------------------------------------
//
// A mesclagem só sabia ADICIONAR o que faltava: item que já existia dos dois
// lados era mantido como está. Corrigir uma aula no tablet, portanto, não
// chegava no PC — e era pior que isso, porque a compactação do PC mescla o
// estado local com o que veio do servidor, grava o resultado e APAGA as ações
// já lidas. A correção do tablet sumia do servidor também. Daí "o que vejo no
// tablet é diferente do que vejo no PC".
//
// A regra agora é: quem foi alterado por último vence. Empate ou carimbo
// ausente mantém o que está na tela — na dúvida, não mexer.

// Momento da última alteração de um item. `updatedAt` só existe depois de uma
// edição; antes disso vale a criação.
export function recordStamp(item) {
  return toTime(item?.updatedAt) ?? toTime(item?.createdAt);
}

export function incomingIsNewer(current, incoming) {
  const incomingTime = recordStamp(incoming);
  if (incomingTime === null) return false;
  const currentTime = recordStamp(current);
  if (currentTime === null) return true;
  return incomingTime > currentTime;
}

const REAL_ATTENDANCE_STATUSES = new Set(["present", "absent", "excused"]);

export function isRealAttendanceStatus(status) {
  return REAL_ATTENDANCE_STATUSES.has(status);
}

// Une as duas listas de chamada de uma mesma aula.
//
// Nunca perde aluno: quem existe só de um lado entra. Para quem existe nos
// dois, chamada feita ganha de chamada não feita — só entre dois status reais
// é que a data decide.
//
// A prioridade do status real vem ANTES da data de propósito, e isso tem um
// preço conhecido: marcar de volta "Não chamada" num aparelho não apaga a
// chamada no outro. É o lado seguro do erro. O carimbo é da AULA inteira, não
// de cada aluno — então uma edição de conteúdo feita depois, em um aparelho
// que nunca recebeu a chamada, apagaria faltas já lançadas se a data mandasse
// aqui. Perder falta lançada é estrago em documento oficial; sobrar uma
// chamada que o professor quis limpar é visível na tela e ele refaz.
export function mergeAttendance(currentList, incomingList, incomingWins) {
  const attendance = (currentList ?? []).map((record) => ({ ...record }));
  const byStudent = new Map(attendance.map((record) => [record.studentId, record]));
  let added = 0;
  let updated = 0;

  for (const incoming of incomingList ?? []) {
    const existing = byStudent.get(incoming.studentId);
    if (!existing) {
      const copy = { ...incoming };
      attendance.push(copy);
      byStudent.set(copy.studentId, copy);
      added += 1;
      continue;
    }
    if (existing.status === incoming.status) continue;
    const currentIsReal = isRealAttendanceStatus(existing.status);
    const incomingIsReal = isRealAttendanceStatus(incoming.status);
    if (currentIsReal && !incomingIsReal) continue;
    if (!currentIsReal || incomingWins) {
      existing.status = incoming.status;
      if (incoming.studentName) existing.studentName = incoming.studentName;
      updated += 1;
    }
  }

  return { attendance, added, updated };
}

// `className` fica de fora de propósito: o nome da turma é resolvido pelo
// mapeamento de turmas de quem chama, não copiado do outro aparelho.
export const LESSON_SCALAR_FIELDS = ["date", "periodId", "periods", "content"];

export function mergeLessonPair(current, incoming) {
  const incomingWins = incomingIsNewer(current, incoming);
  const lesson = { ...current };
  let fieldsUpdated = 0;

  if (incomingWins) {
    for (const field of LESSON_SCALAR_FIELDS) {
      if (incoming[field] === undefined) continue;
      if (stableStringify(lesson[field]) === stableStringify(incoming[field])) continue;
      lesson[field] = incoming[field];
      fieldsUpdated += 1;
    }
    if (incoming.updatedAt) lesson.updatedAt = incoming.updatedAt;
  }

  const merged = mergeAttendance(current.attendance, incoming.attendance, incomingWins);
  lesson.attendance = merged.attendance;

  return {
    lesson,
    fieldsUpdated,
    attendanceAdded: merged.added,
    attendanceUpdated: merged.updated
  };
}

// Ordem canônica das aulas — a mesma em qualquer aparelho.
//
// Sem isto a ordem do array era só o histórico de como cada aparelho montou os
// dados: aula criada aqui entra no topo (saveLesson), aula que chega pela
// sincronização entra no fim (applyPatch e mergeBackupData empilham). Dois
// aparelhos com exatamente os mesmos dados listavam as aulas em ordens
// diferentes, e a lista "Registros", que mostra só as primeiras, chegava a
// esconder aula que aparecia no outro aparelho.
export function compareLessonsNewestFirst(left, right) {
  const byDate = String(right?.date ?? "").localeCompare(String(left?.date ?? ""));
  if (byDate) return byDate;
  const byCreatedAt = String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? ""));
  if (byCreatedAt) return byCreatedAt;
  // Desempate final por id: sem ele, duas aulas do mesmo dia sem carimbo
  // ficariam na ordem em que cada aparelho por acaso as tinha.
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}
