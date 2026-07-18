import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileUp,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Users
} from "lucide-react";
import {
  fetchCurrentState,
  saveCurrentState,
  fetchLatestSnapshots,
  fetchSnapshotById,
  createSnapshot,
  pruneOldSnapshots,
  supabaseStatus,
  signUpWithEmail,
  signInWithEmail,
  signOut as supabaseSignOut,
  getSession,
  onAuthStateChange,
  sendPasswordResetEmail,
  updatePassword
} from "./supabase";
import "./styles.css";

const STORAGE_KEY = "checkout-turmas:v3";
const STORAGE_KEYS = ["checkout-turmas:v3", "checkout-turmas:v2", "checkout-turmas:v1"];
const TEACHER_KEY = "checkout-turmas:teacher";
const SUBJECT_KEY = "checkout-turmas:subject";
const GRADE_DECIMALS_KEY = "checkout-turmas:grade-decimals";
const DEVICE_ID_KEY = "checkout-turmas:device-id";
const SYNC_HISTORY_KEY = "checkout-turmas:sync-history";
const LAST_SYNCED_HASH_KEY = "checkout-turmas:last-synced-hash";
const LAST_SNAPSHOT_AT_KEY = "checkout-turmas:last-snapshot-at";
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60 * 1000;
const SNAPSHOT_KEEP_LIMIT = 30;
const APP_LOCK_PIN_HASH_KEY = "checkout-turmas:app-lock-pin-hash";
const SYNC_SCHEMA_VERSION = 2;
const SYNC_HISTORY_LIMIT = 4;
const AUTO_SYNC_DELAY_MS = 8000;
const SCHOOL_NAME = "CAp UFRJ";
const APP_TITLE = "Diário de Classe";
const APP_VERSION = "1.2";
const SCHOOL_LOGO_SRC = "cap-ufrj-logo.svg";
// Guardamos apenas o hash SHA-256 dessa senha (não o texto puro) para que ela não
// fique legível dentro do app instalado/compilado. Gere o hash com
// supabase/gerar-hash-senha.html e cole o resultado no .env.
const ADMIN_PASSWORD_HASH = (import.meta.env.VITE_ADMIN_PASSWORD_HASH ?? "").trim().toLowerCase();
const ATTENDANCE_NOT_TAKEN = "not-taken";
const DEFAULT_GRADE_DECIMALS = 1;
let activeGradeDecimals = DEFAULT_GRADE_DECIMALS;
const PERIODS = [
  { id: "t1", label: "1º trimestre" },
  { id: "t2", label: "2º trimestre" },
  { id: "t3", label: "3º trimestre" }
];
const ANNUAL_PERIOD = "annual";
const ASSESSMENT_KINDS = [
  {
    id: "formal",
    title: "Avaliação formal",
    description: "Teste ou prova. Permite segunda chamada.",
    enabled: true
  },
  {
    id: "informal",
    title: "Avaliação não formal",
    description: "Trabalho, dinâmica ou lista. Não permite segunda chamada.",
    enabled: true
  },
  {
    id: "makeup",
    title: "Segunda chamada",
    description: "Lançamento vinculado a uma avaliação formal.",
    enabled: false
  },
  {
    id: "recovery",
    title: "Recuperação",
    description: "Lançamento para alunos abaixo da média no período.",
    enabled: false
  }
];
const REPORT_PRESETS = [
  {
    id: "complete",
    title: "Relatório completo",
    description: "Arquivo para fechamento, coordenação ou arquivo geral do diário."
  },
  {
    id: "grades",
    title: "Todas as notas",
    description: "Notas registradas, médias por avaliação e situação dos alunos."
  },
  {
    id: "finals",
    title: "Notas finais e faltas",
    description: "Resumo direto com resultado final, aulas dadas e faltas."
  },
  {
    id: "attendance",
    title: "Frequência",
    description: "Faltas por aluno no período escolhido."
  },
  {
    id: "pending",
    title: "Pendências",
    description: "Todas as avaliações com falta ou entrega pendente."
  },
  {
    id: "makeup",
    title: "Segunda chamada",
    description: "Alunos que faltaram a avaliação formal e precisam de segunda chamada."
  },
  {
    id: "recovery",
    title: "Recuperação",
    description: "Alunos abaixo da média no período selecionado."
  }
];
const DEFAULT_SCHOOL_YEAR = {
  year: 2026,
  terms: {
    t1: { id: "t1", label: "1º trimestre", start: "2026-01-01", end: "2026-05-18" },
    t2: { id: "t2", label: "2º trimestre", start: "2026-05-19", end: "2026-09-26" },
    t3: { id: "t3", label: "3º trimestre", start: "2026-09-27", end: "2026-12-19" }
  },
  milestones: {
    upat: {
      t1: { start: "2026-05-09", end: "2026-05-14" },
      t2: { start: "2026-08-17", end: "2026-08-22" },
      t3: { start: "2026-12-12", end: "2026-12-18" }
    },
    vacation: { label: "Férias/recesso", start: "2026-07-13", end: "2026-07-27" }
  }
};

const exampleClassId = crypto.randomUUID();
const exampleStudents = [
  { id: crypto.randomUUID(), name: "Ana Souza", status: "active" },
  { id: crypto.randomUUID(), name: "Bruno Lima", status: "active" }
];

const initialData = {
  schoolYear: DEFAULT_SCHOOL_YEAR,
  classes: [],
  events: [],
  lessons: [],
  attendanceSummaries: [],
  assessments: [],
  recoveries: []
};

function resolveSchoolYear(data) {
  const storedTerms = data?.schoolYear?.terms ?? {};
  const storedMilestones = data?.schoolYear?.milestones ?? {};
  return {
    year: Number(data?.schoolYear?.year) || DEFAULT_SCHOOL_YEAR.year,
    terms: Object.fromEntries(
      PERIODS.map((period) => [
        period.id,
        {
          ...DEFAULT_SCHOOL_YEAR.terms[period.id],
          ...storedTerms[period.id],
          id: period.id
        }
      ])
    ),
    milestones: {
      upat: Object.fromEntries(
        PERIODS.map((period) => [
          period.id,
          {
            ...DEFAULT_SCHOOL_YEAR.milestones.upat[period.id],
            ...storedMilestones.upat?.[period.id]
          }
        ])
      ),
      vacation: {
        ...DEFAULT_SCHOOL_YEAR.milestones.vacation,
        ...storedMilestones.vacation
      }
    }
  };
}

function periodForDate(date, schoolYear = DEFAULT_SCHOOL_YEAR) {
  const value = String(date ?? "").slice(0, 10);
  const found = PERIODS.find((period) => {
    const term = schoolYear.terms?.[period.id];
    return term?.start && term?.end && value >= term.start && value <= term.end;
  });
  return found?.id ?? "t1";
}

function periodLabel(periodId) {
  if (periodId === ANNUAL_PERIOD) return "Anual";
  return PERIODS.find((period) => period.id === periodId)?.label ?? "Trimestre";
}

function isAnnualClosed(schoolYear = DEFAULT_SCHOOL_YEAR) {
  const end = schoolYear.terms?.t3?.end;
  return !!end && today() > end;
}

function isTermClosed(periodId, schoolYear = DEFAULT_SCHOOL_YEAR) {
  if (periodId === ANNUAL_PERIOD) return false;
  const end = schoolYear.terms?.[periodId]?.end;
  return !!end && today() > end;
}

function dateAtNoon(date) {
  return new Date(`${String(date).slice(0, 10)}T12:00:00`);
}

function formatShortDate(date) {
  if (!date) return "Não definido";
  return new Intl.DateTimeFormat("pt-BR").format(dateAtNoon(date));
}

function formatDateRange(start, end) {
  if (!start && !end) return "Não definido";
  if (start === end || !end) return formatShortDate(start);
  return `${formatShortDate(start)} a ${formatShortDate(end)}`;
}

function formatMonthKey(monthKey) {
  if (!monthKey) return "Mês não definido";
  const [year, month] = monthKey.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(dateAtNoon(`${year}-${month}-01`));
}

function daysUntil(date) {
  if (!date) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((dateAtNoon(date) - dateAtNoon(today())) / msPerDay);
}

function daysUntilLabel(date, label) {
  const days = daysUntil(date);
  if (days === null) return "Data não definida";
  if (days < 0) return `${label} ja passou`;
  if (days === 0) return `${label} hoje`;
  if (days === 1) return `Falta 1 dia para ${label.toLowerCase()}`;
  return `Faltam ${days} dias para ${label.toLowerCase()}`;
}

function assessmentPeriod(assessment, schoolYear) {
  return assessment.periodId ?? assessment.termId ?? periodForDate(assessment.createdAt ?? today(), schoolYear);
}

function lessonPeriod(lesson, schoolYear) {
  return lesson.periodId ?? lesson.termId ?? periodForDate(lesson.date, schoolYear);
}

function normalizeAssessmentGrades(grades) {
  return grades && typeof grades === "object" && !Array.isArray(grades) ? grades : {};
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNativePlatform() {
  return !!window.Capacitor?.isNativePlatform?.();
}


function validateBackupData(data) {
  if (!isPlainObject(data)) return { valid: false, message: "Os dados do backup não têm o formato esperado." };
  const collections = ["classes", "events", "lessons", "assessments", "recoveries"];
  for (const name of collections) {
    if (!Array.isArray(data[name])) return { valid: false, message: `O backup está incompleto: "${name}" não é uma lista válida.` };
  }

  const classIds = new Set();
  for (const classItem of data.classes) {
    if (!isPlainObject(classItem) || !normalize(classItem.id) || !normalize(classItem.name) || !Array.isArray(classItem.students)) {
      return { valid: false, message: "Encontrei uma turma inválida no backup." };
    }
    if (classIds.has(classItem.id)) return { valid: false, message: "O backup tem turmas com identificadores duplicados." };
    classIds.add(classItem.id);
    for (const student of classItem.students) {
      if (!isPlainObject(student) || !normalize(student.id) || !normalize(student.name)) {
        return { valid: false, message: "Encontrei um aluno inválido no backup." };
      }
    }
  }

  for (const item of [...data.lessons, ...data.assessments, ...data.recoveries]) {
    if (!isPlainObject(item) || !normalize(item.id) || !classIds.has(item.classId)) {
      return { valid: false, message: "O backup contêm registros ligados a uma turma inexistente." };
    }
  }
  return { valid: true, message: "" };
}

function normalizeAttendanceSummaries(summaries, classes, schoolYear) {
  if (!Array.isArray(summaries)) return [];
  return summaries
    .map((summary) => {
      const classItem = classes.find((item) => item.id === summary.classId) ??
        classes.find((item) => normalizeKey(item.name) === normalizeKey(summary.className));
      const student = classItem?.students.find((item) => item.id === summary.studentId) ??
        classItem?.students.find((item) => normalizeKey(item.name) === normalizeKey(summary.studentName));
      if (!classItem || !student) return null;
      return {
        ...summary,
        id: summary.id || crypto.randomUUID(),
        classId: classItem.id,
        className: classItem.name,
        studentId: student.id,
        studentName: student.name,
        monthKey: summary.monthKey ?? "",
        periodId: summary.periodId ?? periodForDate(summary.monthKey ? `${summary.monthKey}-01` : summary.date ?? today(), schoolYear),
        lessonTotal: Math.max(0, Math.round(numberValue(summary.lessonTotal, 0))),
        absences: Math.max(0, Math.round(numberValue(summary.absences, 0))),
        excused: Math.max(0, Math.round(numberValue(summary.excused, 0))),
        source: summary.source ?? "Importação de frequência",
        createdAt: summary.createdAt || new Date().toISOString()
      };
    })
    .filter(Boolean);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text ?? "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkAdminPassword(candidate) {
  if (!ADMIN_PASSWORD_HASH) return false;
  return (await sha256Hex(candidate ?? "")) === ADMIN_PASSWORD_HASH;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function dataIntegrity(data) {
  const source = new TextEncoder().encode(stableStringify(data));
  const hash = await crypto.subtle.digest("SHA-256", source);
  return {
    algorithm: "SHA-256",
    hash: Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    bytes: source.byteLength
  };
}

async function attachSnapshotIntegrity(snapshot) {
  return { ...snapshot, integrity: await dataIntegrity(snapshot.data) };
}

async function verifySnapshotIntegrity(snapshot) {
  if (!snapshot.integrity?.hash) return { ...snapshot, integrityStatus: "legacy" };
  if (snapshot.integrity.algorithm !== "SHA-256") return { ...snapshot, integrityStatus: "invalid" };
  const calculated = await dataIntegrity(snapshot.data);
  if (calculated.hash === snapshot.integrity.hash) return { ...snapshot, integrityStatus: "verified" };
  const migrated = await dataIntegrity(migrateData(snapshot.data));
  if (migrated.hash === snapshot.integrity.hash) return { ...snapshot, integrityStatus: "verified-legacy" };
  return { ...snapshot, integrityStatus: "invalid" };
}

function migrateData(data) {
  const schoolYear = resolveSchoolYear(data);
  const rawClasses = Array.isArray(data?.classes)
    ? data.classes.map((item) => ({
        ...item,
        id: item.id || crypto.randomUUID(),
        name: normalize(item.name) || "Turma sem nome",
        gradingMode: item.gradingMode ?? "sum",
        students: Array.isArray(item.students)
          ? item.students.map((student) => ({
              ...student,
              id: student.id || crypto.randomUUID(),
              name: normalize(student.name) || "Aluno sem nome",
              photo: student.photo ?? "",
              status: student.status === "left" ? "left" : "active"
            }))
          : []
      }))
    : initialData.classes;
  const removedClassIds = new Set(rawClasses.filter(isLikelyStudentNamedClass).map((item) => item.id));
  const classes = rawClasses.filter((item) => !removedClassIds.has(item.id));
  const assessments = Array.isArray(data?.assessments)
    ? data.assessments.filter((item) => !removedClassIds.has(item.classId)).map((item) => {
        const assessmentClass = classes.find((classItem) => classItem.id === item.classId);
        return {
          ...item,
          id: item.id || crypto.randomUUID(),
          className: item.className ?? assessmentClass?.name ?? "",
          name: normalize(item.name) || "Avaliação sem nome",
          description: item.description ?? "",
          maxScore: item.maxScore ?? 10,
          weight: item.weight ?? 1,
          grades: normalizeAssessmentGrades(item.grades),
          makeupGrades: normalizeAssessmentGrades(item.makeupGrades),
          kind: assessmentKindFromData(item),
          allowsMakeup: assessmentKindFromData(item) === "formal",
          periodId: assessmentPeriod(item, schoolYear),
          calculationType:
            item.calculationType ??
            (item.gradingMode === "weightedAverage" || assessmentClass?.gradingMode === "weightedAverage" ? "average" : "sum")
        };
      })
    : [];

  return {
    schoolYear,
    classes,
    events: Array.isArray(data?.events) ? data.events.filter((event) => !removedClassIds.has(event.classId)) : [],
    lessons: Array.isArray(data?.lessons)
      ? data.lessons
          .filter((lesson) => !removedClassIds.has(lesson.classId))
          .map((lesson) => ({
            ...lesson,
            id: lesson.id || crypto.randomUUID(),
            className: lesson.className ?? classes.find((classItem) => classItem.id === lesson.classId)?.name ?? "",
            date: lesson.date || today(),
            content: lesson.content ?? "Aula registrada",
            periods: lessonPeriods(lesson),
            attendance: Array.isArray(lesson.attendance) ? lesson.attendance : [],
            periodId: lessonPeriod(lesson, schoolYear)
          }))
      : [],
    attendanceSummaries: normalizeAttendanceSummaries(data?.attendanceSummaries, classes, schoolYear),
    assessments,
    recoveries: Array.isArray(data?.recoveries)
      ? data.recoveries
          .filter((recovery) => !removedClassIds.has(recovery.classId))
          .map((recovery) => ({
            ...recovery,
            id: recovery.id || crypto.randomUUID(),
            className: recovery.className ?? classes.find((classItem) => classItem.id === recovery.classId)?.name ?? "",
            periodId: recovery.periodId ?? "t1",
            grades: normalizeAssessmentGrades(recovery.grades)
          }))
      : []
  };
}

function loadData() {
  try {
    for (const key of STORAGE_KEYS) {
      const stored = localStorage.getItem(key);
      if (!stored) continue;
      try {
        return migrateData(JSON.parse(stored));
      } catch {
        // Tenta a versao anterior se uma chave local estiver corrompida.
      }
    }
    return initialData;
  } catch {
    return initialData;
  }
}

function loadTeacherName() {
  try {
    return localStorage.getItem(TEACHER_KEY) ?? "";
  } catch {
    return "";
  }
}

function loadSubjectName() {
  try {
    return localStorage.getItem(SUBJECT_KEY) ?? "";
  } catch {
    return "";
  }
}

function loadGradeDecimals() {
  try {
    const stored = Number(localStorage.getItem(GRADE_DECIMALS_KEY));
    return [0, 1, 2].includes(stored) ? stored : DEFAULT_GRADE_DECIMALS;
  } catch {
    return DEFAULT_GRADE_DECIMALS;
  }
}

function loadAppLockPinHash() {
  try {
    return localStorage.getItem(APP_LOCK_PIN_HASH_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveAppLockPinHash(hash) {
  try {
    localStorage.setItem(APP_LOCK_PIN_HASH_KEY, hash);
  } catch {
    // Ignorar falha ao gravar o PIN local
  }
}

function loadLastSyncedHash() {
  try {
    return localStorage.getItem(LAST_SYNCED_HASH_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastSyncedHash(hash) {
  if (!hash) return;
  try {
    localStorage.setItem(LAST_SYNCED_HASH_KEY, hash);
  } catch {
    // Ignorar falha ao gravar o marcador de sincronização
  }
}

function shouldCreateSnapshot() {
  try {
    const lastAt = Number(localStorage.getItem(LAST_SNAPSHOT_AT_KEY) ?? 0);
    return Date.now() - lastAt >= SNAPSHOT_MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markSnapshotCreated() {
  try {
    localStorage.setItem(LAST_SNAPSHOT_AT_KEY, String(Date.now()));
  } catch {
    // Ignorar falha ao gravar o marcador de snapshot
  }
}

function loadDeviceId() {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const next = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function syncDeviceLabel() {
  if (isNativePlatform()) return "Android";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi/i.test(ua)) return "Celular";
  return "Computador";
}

async function loadRemoteState(userId) {
  if (!supabaseStatus().configured || !userId) return null;
  try {
    const current = await fetchCurrentState(userId);
    return current?.payload ?? null;
  } catch (error) {
    console.warn("Supabase load failed:", error);
    return null;
  }
}

async function saveRemoteState(userId, payload, { forceSnapshot = false } = {}) {
  if (!supabaseStatus().configured) throw new Error("Supabase não está configurado.");
  if (!userId) throw new Error("Nenhum professor autenticado.");
  await saveCurrentState(userId, payload);
  if (!forceSnapshot && !shouldCreateSnapshot()) return;
  try {
    await createSnapshot(userId, {
      id: payload.snapshotId,
      label: payload.label ?? `Backup ${syncSnapshotLabel(payload.exportedAt)}`,
      created_at: payload.exportedAt,
      source_device: payload.sourceDevice,
      source_device_id: payload.sourceDeviceId,
      teacher_name: payload.teacherName,
      subject_name: payload.subjectName,
      sync_schema_version: payload.syncSchemaVersion,
      payload
    });
    markSnapshotCreated();
    await pruneOldSnapshots(userId, SNAPSHOT_KEEP_LIMIT);
  } catch (error) {
    console.warn("Não foi possível salvar snapshot no Supabase:", error);
  }
}

function createSyncSnapshot({ data, teacherName, subjectName, gradeDecimals, deviceId, deviceLabel = "", reason = "Sincronização" }) {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt,
    label: `${reason} - ${syncSnapshotLabel(createdAt)}`,
    sourceDeviceId: deviceId,
    sourceDevice: deviceLabel,
    teacherName,
    subjectName,
    gradeDecimals,
    data: migrateData(data)
  };
}

function sanitizeSyncSnapshot(snapshot) {
  if (!snapshot?.data) return null;
  const createdAt = snapshot.createdAt || snapshot.exportedAt || new Date().toISOString();
  return {
    id: snapshot.id || crypto.randomUUID(),
    createdAt,
    label: snapshot.label || `Sincronização - ${syncSnapshotLabel(createdAt)}`,
    sourceDeviceId: snapshot.sourceDeviceId ?? "",
    sourceDevice: snapshot.sourceDevice ?? snapshot.deviceLabel ?? "",
    teacherName: snapshot.teacherName ?? snapshot.settings?.teacherName ?? "",
    subjectName: snapshot.subjectName ?? snapshot.settings?.subjectName ?? "",
    gradeDecimals: [0, 1, 2].includes(Number(snapshot.gradeDecimals ?? snapshot.settings?.gradeDecimals))
      ? Number(snapshot.gradeDecimals ?? snapshot.settings?.gradeDecimals)
      : DEFAULT_GRADE_DECIMALS,
    integrity: snapshot.integrity ?? null,
    data: snapshot.data
  };
}

function dedupeSyncSnapshots(snapshots) {
  const seen = new Set();
  return snapshots
    .map(sanitizeSyncSnapshot)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter((snapshot) => {
      const key = `${snapshot.createdAt}|${snapshot.sourceDeviceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SYNC_HISTORY_LIMIT);
}

function loadSyncHistory() {
  try {
    return dedupeSyncSnapshots(JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveSyncHistory(snapshots) {
  const next = dedupeSyncSnapshots(snapshots);
  try {
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Se o armazenamento local estiver cheio, o arquivo exportado ainda carrega o histórico.
  }
  return next;
}

function snapshotFromPayload(payload) {
  if (!payload?.data) return null;
  if (!validateBackupData(payload.data).valid) return null;
  return sanitizeSyncSnapshot({
    id: payload.snapshotId,
    createdAt: payload.exportedAt,
    label: `Arquivo principal - ${syncSnapshotLabel(payload.exportedAt ?? new Date().toISOString())}`,
    sourceDeviceId: payload.sourceDeviceId,
    sourceDevice: payload.sourceDevice,
    teacherName: payload.teacherName ?? payload.settings?.teacherName,
    subjectName: payload.subjectName ?? payload.settings?.subjectName,
    gradeDecimals: payload.settings?.gradeDecimals,
    integrity: payload.integrity ?? null,
    data: payload.data
  });
}

function snapshotsFromPayload(payload) {
  return dedupeSyncSnapshots([
    snapshotFromPayload(payload),
    ...(Array.isArray(payload?.syncHistory) ? payload.syncHistory.filter((snapshot) => validateBackupData(snapshot?.data).valid) : [])
  ]);
}

function countGradeEntries(assessments = [], recoveries = []) {
  const assessmentGrades = assessments.reduce(
    (total, assessment) =>
      total +
      Object.values(assessment.grades ?? {}).filter((value) => normalize(value) || isMissingGrade(value)).length +
      Object.values(assessment.makeupGrades ?? {}).filter((value) => normalize(value) || isMissingGrade(value)).length,
    0
  );
  const recoveryGrades = recoveries.reduce(
    (total, recovery) => total + Object.values(recovery.grades ?? {}).filter((value) => normalize(value) || isMissingGrade(value)).length,
    0
  );
  return assessmentGrades + recoveryGrades;
}

function summarizeSyncSnapshot(snapshot) {
  const data = migrateData(snapshot?.data ?? initialData);
  const students = data.classes.reduce((total, classItem) => total + classItem.students.length, 0);
  const activeStudents = data.classes.reduce((total, classItem) => total + classItem.students.filter(isActiveStudent).length, 0);
  const gradeEntries = countGradeEntries(data.assessments, data.recoveries);
  const classSummaries = data.classes.map((classItem) => {
    const lessons = data.lessons.filter((lesson) => lesson.classId === classItem.id);
    const assessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
    const recoveries = data.recoveries.filter((recovery) => recovery.classId === classItem.id);
    return {
      id: classItem.id,
      name: classItem.name,
      students: classItem.students.length,
      lessons: lessons.length,
      lessonPeriods: totalLessonPeriods(lessons),
      assessments: assessments.length,
      gradeEntries: countGradeEntries(assessments, recoveries),
      recoveries: recoveries.length
    };
  });

  return {
    data,
    students,
    activeStudents,
    classes: data.classes.length,
    lessons: data.lessons.length,
    lessonPeriods: totalLessonPeriods(data.lessons),
    assessments: data.assessments.length,
    recoveries: data.recoveries.length,
    gradeEntries,
    classSummaries
  };
}

function restoreWouldRemoveData(currentData, incomingData) {
  const current = summarizeSyncSnapshot({ data: currentData });
  const incoming = summarizeSyncSnapshot({ data: incomingData });
  return ["classes", "activeStudents", "lessons", "assessments", "gradeEntries", "recoveries"].some(
    (key) => current[key] > 0 && incoming[key] < current[key]
  );
}

function summarizeSyncImpact(currentData, incomingData, mode = "merge") {
  const current = migrateData(currentData);
  const incoming = migrateData(incomingData);
  const currentSummary = summarizeSyncSnapshot({ data: current });
  const incomingSummary = summarizeSyncSnapshot({ data: incoming });

  if (mode === "restore") {
    return { mode, currentSummary, incomingSummary };
  }

  const classIdMap = new Map();
  const studentIdMap = new Map();
  const conflictDetails = [];
  let classesAdded = 0;
  let studentsAdded = 0;
  let lessonsAdded = 0;
  let assessmentsAdded = 0;
  let recoveriesAdded = 0;
  let attendanceRecordsMerged = 0;
  let gradeValuesMerged = 0;
  let gradeConflicts = 0;

  for (const importedClass of incoming.classes) {
    let targetClass = current.classes.find((classItem) => classItem.id === importedClass.id);
    if (!targetClass) {
      targetClass = current.classes.find((classItem) => normalizeKey(classItem.name) === normalizeKey(importedClass.name));
    }

    if (!targetClass) {
      classesAdded += 1;
      studentsAdded += importedClass.students.length;
      classIdMap.set(importedClass.id, importedClass.id);
      for (const student of importedClass.students) {
        studentIdMap.set(student.id, student.id);
      }
      continue;
    }

    classIdMap.set(importedClass.id, targetClass.id);
    for (const importedStudent of importedClass.students) {
      let targetStudent = targetClass.students.find((student) => student.id === importedStudent.id);
      if (!targetStudent) {
        targetStudent = targetClass.students.find((student) => normalizeKey(student.name) === normalizeKey(importedStudent.name));
      }
      if (!targetStudent) {
        studentsAdded += 1;
        studentIdMap.set(importedStudent.id, importedStudent.id);
      } else {
        studentIdMap.set(importedStudent.id, targetStudent.id);
      }
    }
  }

  for (const importedLesson of incoming.lessons) {
    const classId = classIdMap.get(importedLesson.classId) ?? importedLesson.classId;
    const targetLesson = current.lessons.find((lesson) => lesson.id === importedLesson.id) ?? current.lessons.find(
      (lesson) =>
        lesson.classId === classId &&
        lesson.date === importedLesson.date &&
        lessonPeriods(lesson) === lessonPeriods(importedLesson) &&
        normalizeKey(lesson.content) === normalizeKey(importedLesson.content)
    );
    if (!targetLesson) {
      lessonsAdded += 1;
    } else {
      const existingStudents = new Set((targetLesson.attendance ?? []).map((record) => record.studentId));
      attendanceRecordsMerged += (importedLesson.attendance ?? []).filter((record) => !existingStudents.has(studentIdMap.get(record.studentId) ?? record.studentId)).length;
    }
  }

  function findStudentName(classId, studentId) {
    const classItem = current.classes.find((item) => item.id === classId);
    return classItem?.students.find((student) => student.id === studentId)?.name ?? "Aluno não localizado";
  }

  function addGradePreview({ classId, studentId, label, currentValue, incomingValue }) {
    const merged = mergeGradeValueDetailed(currentValue, incomingValue);
    if (merged.changed) gradeValuesMerged += 1;
    if (merged.conflict) {
      gradeConflicts += 1;
      if (conflictDetails.length < 8) {
        conflictDetails.push({
          className: current.classes.find((classItem) => classItem.id === classId)?.name ?? "Turma",
          studentName: findStudentName(classId, studentId),
          label,
          currentValue: normalize(currentValue) || missingAssessmentLabel({ kind: "informal" }),
          incomingValue: normalize(incomingValue) || missingAssessmentLabel({ kind: "informal" })
        });
      }
    }
  }

  for (const importedAssessment of incoming.assessments) {
    const classId = classIdMap.get(importedAssessment.classId) ?? importedAssessment.classId;
    const targetAssessment = current.assessments.find((assessment) => assessment.id === importedAssessment.id) ?? current.assessments.find(
      (assessment) =>
        assessment.classId === classId &&
        assessment.periodId === importedAssessment.periodId &&
        normalizeKey(assessment.name) === normalizeKey(importedAssessment.name)
    );
    if (!targetAssessment) {
      assessmentsAdded += 1;
      continue;
    }

    for (const [studentId, grade] of Object.entries(importedAssessment.grades ?? {})) {
      const targetStudentId = studentIdMap.get(studentId) ?? studentId;
      addGradePreview({
        classId,
        studentId: targetStudentId,
        label: targetAssessment.name,
        currentValue: targetAssessment.grades?.[targetStudentId],
        incomingValue: grade
      });
    }
    for (const [studentId, grade] of Object.entries(importedAssessment.makeupGrades ?? {})) {
      const targetStudentId = studentIdMap.get(studentId) ?? studentId;
      addGradePreview({
        classId,
        studentId: targetStudentId,
        label: `${targetAssessment.name} - 2ª chamada`,
        currentValue: targetAssessment.makeupGrades?.[targetStudentId],
        incomingValue: grade
      });
    }
  }

  for (const importedRecovery of incoming.recoveries ?? []) {
    const classId = classIdMap.get(importedRecovery.classId) ?? importedRecovery.classId;
    const targetRecovery = current.recoveries.find((recovery) => recovery.id === importedRecovery.id) ?? current.recoveries.find(
      (recovery) => recovery.classId === classId && recovery.periodId === importedRecovery.periodId
    );
    if (!targetRecovery) {
      recoveriesAdded += 1;
      continue;
    }

    for (const [studentId, grade] of Object.entries(importedRecovery.grades ?? {})) {
      const targetStudentId = studentIdMap.get(studentId) ?? studentId;
      addGradePreview({
        classId,
        studentId: targetStudentId,
        label: `Recuperação - ${periodLabel(importedRecovery.periodId)}`,
        currentValue: targetRecovery.grades?.[targetStudentId],
        incomingValue: grade
      });
    }
  }

  return {
    mode,
    currentSummary,
    incomingSummary,
    summary: { classesAdded, studentsAdded, lessonsAdded, assessmentsAdded, recoveriesAdded, attendanceRecordsMerged, gradeValuesMerged, gradeConflicts },
    conflictDetails
  };
}

function mergeGradeValue(currentValue, incomingValue) {
  const currentFilled = normalize(currentValue) || isMissingGrade(currentValue);
  const incomingFilled = normalize(incomingValue) || isMissingGrade(incomingValue);
  if (!incomingFilled) return currentValue;
  if (!currentFilled || isMissingGrade(currentValue)) return incomingValue;
  return currentValue;
}

function mergeGradeValueDetailed(currentValue, incomingValue) {
  const currentFilled = normalize(currentValue) || isMissingGrade(currentValue);
  const incomingFilled = normalize(incomingValue) || isMissingGrade(incomingValue);
  if (!incomingFilled) return { value: currentValue, changed: false, conflict: false };
  if (!currentFilled || isMissingGrade(currentValue)) {
    return { value: incomingValue, changed: normalize(currentValue) !== normalize(incomingValue), conflict: false };
  }
  const conflict = normalize(currentValue) !== normalize(incomingValue) && !isMissingGrade(incomingValue);
  return { value: currentValue, changed: false, conflict };
}

function mergeBackupData(currentData, importedData) {
  const current = migrateData(currentData);
  const incoming = migrateData(importedData);
  const classes = current.classes.map((classItem) => ({
    ...classItem,
    students: [...classItem.students]
  }));
  const classIdMap = new Map();
  const studentIdMap = new Map();
  let classesAdded = 0;
  let studentsAdded = 0;
  let lessonsAdded = 0;
  let assessmentsAdded = 0;
  let recoveriesAdded = 0;
  let attendanceRecordsMerged = 0;
  let gradeValuesMerged = 0;
  let gradeConflicts = 0;

  for (const importedClass of incoming.classes) {
    let targetClass = classes.find((classItem) => classItem.id === importedClass.id);
    if (!targetClass) {
      targetClass = classes.find((classItem) => normalizeKey(classItem.name) === normalizeKey(importedClass.name));
    }
    if (!targetClass) {
      targetClass = {
        ...importedClass,
        id: importedClass.id || crypto.randomUUID(),
        students: [...importedClass.students]
      };
      classes.push(targetClass);
      classesAdded += 1;
      studentsAdded += targetClass.students.length;
      for (const student of importedClass.students) {
        studentIdMap.set(student.id, student.id);
      }
    } else {
      for (const importedStudent of importedClass.students) {
        let targetStudent = targetClass.students.find((student) => student.id === importedStudent.id);
        if (!targetStudent) {
          targetStudent = targetClass.students.find((student) => normalizeKey(student.name) === normalizeKey(importedStudent.name));
        }
        if (!targetStudent) {
          targetStudent = { ...importedStudent, id: importedStudent.id || crypto.randomUUID() };
          targetClass.students.push(targetStudent);
          studentsAdded += 1;
        } else if (!targetStudent.photo && importedStudent.photo) {
          targetStudent.photo = importedStudent.photo;
        }
        studentIdMap.set(importedStudent.id, targetStudent.id);
      }
    }
    classIdMap.set(importedClass.id, targetClass.id);
  }

  const lessons = current.lessons.map((lesson) => ({
    ...lesson,
    attendance: Array.isArray(lesson.attendance) ? [...lesson.attendance] : []
  }));
  for (const importedLesson of incoming.lessons) {
    const classId = classIdMap.get(importedLesson.classId) ?? importedLesson.classId;
    const remappedAttendance = (importedLesson.attendance ?? []).map((record) => ({
      ...record,
      studentId: studentIdMap.get(record.studentId) ?? record.studentId
    }));
    let targetLesson = lessons.find((lesson) => lesson.id === importedLesson.id);
    if (!targetLesson) {
      targetLesson = lessons.find(
        (lesson) =>
          lesson.classId === classId &&
          lesson.date === importedLesson.date &&
          lessonPeriods(lesson) === lessonPeriods(importedLesson) &&
          normalizeKey(lesson.content) === normalizeKey(importedLesson.content)
      );
    }
    if (!targetLesson) {
      lessons.push({
        ...importedLesson,
        classId,
        className: classes.find((classItem) => classItem.id === classId)?.name ?? importedLesson.className,
        attendance: remappedAttendance
      });
      lessonsAdded += 1;
    } else {
      const existingStudents = new Set(targetLesson.attendance.map((record) => record.studentId));
      for (const record of remappedAttendance) {
        if (!existingStudents.has(record.studentId)) {
          targetLesson.attendance.push(record);
          attendanceRecordsMerged += 1;
        }
      }
    }
  }

  const assessments = current.assessments.map((assessment) => ({
    ...assessment,
    grades: { ...(assessment.grades ?? {}) },
    makeupGrades: { ...(assessment.makeupGrades ?? {}) }
  }));
  for (const importedAssessment of incoming.assessments) {
    const classId = classIdMap.get(importedAssessment.classId) ?? importedAssessment.classId;
    let targetAssessment = assessments.find((assessment) => assessment.id === importedAssessment.id);
    if (!targetAssessment) {
      targetAssessment = assessments.find(
        (assessment) =>
          assessment.classId === classId &&
          assessment.periodId === importedAssessment.periodId &&
          normalizeKey(assessment.name) === normalizeKey(importedAssessment.name)
      );
    }
    const remappedGrades = Object.fromEntries(
      Object.entries(importedAssessment.grades ?? {}).map(([studentId, grade]) => [studentIdMap.get(studentId) ?? studentId, grade])
    );
    const remappedMakeupGrades = Object.fromEntries(
      Object.entries(importedAssessment.makeupGrades ?? {}).map(([studentId, grade]) => [studentIdMap.get(studentId) ?? studentId, grade])
    );
    if (!targetAssessment) {
      assessments.push({
        ...importedAssessment,
        classId,
        className: classes.find((classItem) => classItem.id === classId)?.name ?? importedAssessment.className,
        grades: remappedGrades,
        makeupGrades: remappedMakeupGrades
      });
      assessmentsAdded += 1;
    } else {
      for (const [studentId, grade] of Object.entries(remappedGrades)) {
        const merged = mergeGradeValueDetailed(targetAssessment.grades[studentId], grade);
        targetAssessment.grades[studentId] = merged.value;
        if (merged.changed) gradeValuesMerged += 1;
        if (merged.conflict) gradeConflicts += 1;
      }
      for (const [studentId, grade] of Object.entries(remappedMakeupGrades)) {
        const merged = mergeGradeValueDetailed(targetAssessment.makeupGrades[studentId], grade);
        targetAssessment.makeupGrades[studentId] = merged.value;
        if (merged.changed) gradeValuesMerged += 1;
        if (merged.conflict) gradeConflicts += 1;
      }
      targetAssessment.description = targetAssessment.description || importedAssessment.description || "";
      targetAssessment.maxScore = targetAssessment.maxScore ?? importedAssessment.maxScore ?? 10;
      targetAssessment.weight = targetAssessment.weight ?? importedAssessment.weight ?? 1;
      targetAssessment.calculationType = targetAssessment.calculationType ?? importedAssessment.calculationType ?? "average";
      targetAssessment.kind = targetAssessment.kind ?? importedAssessment.kind ?? assessmentKindFromData(importedAssessment);
      targetAssessment.allowsMakeup = assessmentAllowsMakeup(targetAssessment);
    }
  }

  const eventKeys = new Set(current.events.map((event) => event.id || JSON.stringify(event)));
  const events = [
    ...current.events,
    ...incoming.events.filter((event) => {
      const key = event.id || JSON.stringify(event);
      if (eventKeys.has(key)) return false;
      eventKeys.add(key);
      return true;
    })
  ];

  const recoveries = current.recoveries.map((recovery) => ({
    ...recovery,
    grades: { ...(recovery.grades ?? {}) }
  }));
  for (const importedRecovery of incoming.recoveries ?? []) {
    const classId = classIdMap.get(importedRecovery.classId) ?? importedRecovery.classId;
    let targetRecovery = recoveries.find((recovery) => recovery.id === importedRecovery.id);
    if (!targetRecovery) {
      targetRecovery = recoveries.find(
        (recovery) => recovery.classId === classId && recovery.periodId === importedRecovery.periodId
      );
    }
    const remappedGrades = Object.fromEntries(
      Object.entries(importedRecovery.grades ?? {}).map(([studentId, grade]) => [studentIdMap.get(studentId) ?? studentId, grade])
    );
    if (!targetRecovery) {
      recoveries.push({
        ...importedRecovery,
        classId,
        className: classes.find((classItem) => classItem.id === classId)?.name ?? importedRecovery.className,
        grades: remappedGrades
      });
      recoveriesAdded += 1;
    } else {
      for (const [studentId, grade] of Object.entries(remappedGrades)) {
        const merged = mergeGradeValueDetailed(targetRecovery.grades[studentId], grade);
        targetRecovery.grades[studentId] = merged.value;
        if (merged.changed) gradeValuesMerged += 1;
        if (merged.conflict) gradeConflicts += 1;
      }
    }
  }

  const attendanceSummaries = [...(current.attendanceSummaries ?? [])];
  for (const importedSummary of incoming.attendanceSummaries ?? []) {
    const classId = classIdMap.get(importedSummary.classId) ?? importedSummary.classId;
    const studentId = studentIdMap.get(importedSummary.studentId) ?? importedSummary.studentId;
    const existingIndex = attendanceSummaries.findIndex(
      (summary) =>
        summary.classId === classId &&
        summary.studentId === studentId &&
        summary.periodId === importedSummary.periodId &&
        normalizeKey(summary.source) === normalizeKey(importedSummary.source)
    );
    const remappedSummary = {
      ...importedSummary,
      classId,
      className: classes.find((classItem) => classItem.id === classId)?.name ?? importedSummary.className,
      studentId,
      studentName:
        classes.find((classItem) => classItem.id === classId)?.students.find((student) => student.id === studentId)?.name ??
        importedSummary.studentName
    };
    if (existingIndex >= 0) attendanceSummaries[existingIndex] = { ...attendanceSummaries[existingIndex], ...remappedSummary };
    else attendanceSummaries.push(remappedSummary);
  }

  return {
    data: migrateData({
      schoolYear: incoming.schoolYear ?? current.schoolYear,
      classes,
      events,
      lessons,
      attendanceSummaries,
      assessments,
      recoveries
    }),
    summary: { classesAdded, studentsAdded, lessonsAdded, assessmentsAdded, recoveriesAdded, attendanceRecordsMerged, gradeValuesMerged, gradeConflicts }
  };
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function syncSnapshotLabel(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

function fileSafeName(text) {
  return normalize(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDelimiter(line) {
  const options = [";", ",", "\t"];
  return options.reduce((best, option) => (line.split(option).length > line.split(best).length ? option : best), ";");
}

function splitRow(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseStudentList(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => splitRow(line, delimiter));
  return rowsToStudents(rows);
}

function normalizeHeader(text) {
  return normalize(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(text) {
  return normalizeHeader(text).replace(/[^a-z0-9]/g, "");
}

function nameTokens(text) {
  return normalizeHeader(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function levenshteinDistance(left, right) {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function nameSimilarity(importedName, storedName) {
  const importedKey = normalizeKey(importedName);
  const storedKey = normalizeKey(storedName);
  if (!importedKey || !storedKey) return 0;
  if (importedKey === storedKey) return 1;

  const importedTokens = [...new Set(nameTokens(importedName))];
  const storedTokens = [...new Set(nameTokens(storedName))];
  const overlap = importedTokens.filter((token) => storedTokens.includes(token)).length;
  const tokenScore = importedTokens.length && storedTokens.length
    ? (2 * overlap) / (importedTokens.length + storedTokens.length)
    : 0;
  const containsScore = storedKey.includes(importedKey) || importedKey.includes(storedKey) ? 0.82 : 0;
  const maxLength = Math.max(importedKey.length, storedKey.length);
  const editScore = maxLength ? 1 - levenshteinDistance(importedKey, storedKey) / maxLength : 0;

  return Math.max(tokenScore, containsScore, editScore);
}

function possibleNameMatches(importedName, students) {
  return students
    .map((student) => ({
      studentId: student.id,
      name: student.name,
      score: nameSimilarity(importedName, student.name)
    }))
    .filter((candidate) => candidate.score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function isNameHeader(text) {
  const header = normalizeHeader(text);
  return header === "nome" ||
    header.includes("nome") ||
    header.includes("aluno") ||
    header.includes("estudante") ||
    header.includes("discente");
}

function isClassHeader(text) {
  const header = normalizeHeader(text);
  return header === "turma" ||
    header.includes("turma") ||
    header.includes("classe") ||
    header.includes("sala") ||
    header.includes("serie") ||
    header.includes("ano");
}

function isLikelyClassName(text) {
  const key = normalizeKey(text).toUpperCase();
  const header = normalizeHeader(text);
  return /^[0-9]{1,3}[A-Z]$/.test(key) || header.includes("turma");
}

function isLikelyStudentNamedClass(classItem) {
  if (isLikelyClassName(classItem.name)) return false;
  if (!Array.isArray(classItem.students) || classItem.students.length !== 1) return false;
  return normalizeKey(classItem.name) === normalizeKey(classItem.students[0]?.name);
}

function findHeaderMapping(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const row = rows[rowIndex];
    const nameIndex = row.findIndex(isNameHeader);
    const classIndex = row.findIndex(isClassHeader);
    if (nameIndex >= 0 && classIndex >= 0 && nameIndex !== classIndex) {
      return { rowIndex, nameIndex, classIndex };
    }
  }
  return null;
}

function firstFilledColumnPair(rows) {
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const scores = Array.from({ length: maxColumns }, (_, index) => ({
    index,
    filled: rows.filter((row) => normalize(row[index])).length
  })).filter((column) => column.filled > 0);

  if (scores.length < 2) return null;
  return {
    rowIndex: -1,
    nameIndex: scores[0].index,
    classIndex: scores[1].index
  };
}

function rowsToStudents(rows) {
  const cleanRows = rows.filter((row) => row.some((cell) => normalize(cell)));
  if (!cleanRows.length) return [];

  const mapping = findHeaderMapping(cleanRows) ?? firstFilledColumnPair(cleanRows);
  if (!mapping) return [];

  const dataRows = mapping.rowIndex >= 0 ? cleanRows.slice(mapping.rowIndex + 1) : cleanRows;
  return dataRows
    .map((row) => ({ name: normalize(row[mapping.nameIndex]), className: normalize(row[mapping.classIndex]) }))
    .filter((row) => row.name && row.className && !isNameHeader(row.name) && !isClassHeader(row.className));
}

function getPdfClassName(textItems, fileName) {
  const text = textItems.map((item) => item.str).join(" ");
  const textMatch = text.match(/Turma:\s*([A-Za-z0-9]+)/i);
  if (textMatch) return textMatch[1].toUpperCase();

  const fileMatch = fileName.match(/(?:^|[\s_-])([0-9]{1,3}[A-Za-z])(?:[\s_.-]|$)/);
  return fileMatch ? fileMatch[1].toUpperCase() : normalize(fileName.replace(/\.pdf$/i, ""));
}

function clusterValues(values, threshold) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [];

  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(last.center - value) > threshold) {
      clusters.push({ center: value, values: [value] });
      continue;
    }

    last.values.push(value);
    last.center = last.values.reduce((total, current) => total + current, 0) / last.values.length;
  }

  return clusters.map((cluster) => cluster.center);
}

function closestIndex(values, target) {
  return values.reduce(
    (best, value, index) => (Math.abs(value - target) < Math.abs(values[best] - target) ? index : best),
    0
  );
}

function groupPdfStudents(textItems) {
  const items = textItems
    .map((item) => ({
      text: normalize(item.str),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
      centerX: item.transform[4] + item.width / 2
    }))
    .filter((item) =>
      item.text &&
      item.height <= 9 &&
      item.y < 650 &&
      !/^turma:/i.test(item.text) &&
      !/^ano:/i.test(item.text)
    );

  if (!items.length) return [];

  const columns = clusterValues(items.map((item) => item.centerX), 38);
  const rowCenters = clusterValues(items.map((item) => item.y), 34);
  const groups = new Map();

  for (const item of items) {
    const col = closestIndex(columns, item.centerX);
    const row = closestIndex(rowCenters, item.y);
    const key = `${row}:${col}`;
    const group = groups.get(key) ?? { row, col, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const lines = group.items
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text);
      const name = normalize(lines.join(" "));
      const xCenter = group.items.reduce((total, item) => total + item.centerX, 0) / group.items.length;
      const topY = Math.max(...group.items.map((item) => item.y));
      return { name, xCenter, topY, row: group.row, col: group.col };
    })
    .filter((student) => student.name.length > 2)
    .sort((a, b) => b.row - a.row || a.col - b.col);
}

function cropPdfPhoto(pageCanvas, viewport, student) {
  const scale = pageCanvas.width / viewport.width;
  const photoWidth = 58;
  const photoHeight = 78;
  const photoGap = 8;
  const sourceX = Math.max(0, (student.xCenter - photoWidth / 2) * scale);
  const sourceY = Math.max(0, (viewport.height - (student.topY + photoGap + photoHeight)) * scale);
  const sourceWidth = Math.min(photoWidth * scale, pageCanvas.width - sourceX);
  const sourceHeight = Math.min(photoHeight * scale, pageCanvas.height - sourceY);

  if (sourceWidth <= 0 || sourceHeight <= 0) return "";

  const output = document.createElement("canvas");
  output.width = 96;
  output.height = 120;
  const context = output.getContext("2d");
  context.drawImage(pageCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  return output.toDataURL("image/jpeg", 0.72);
}

async function parsePdfRoster(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const students = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const className = getPdfClassName(textContent.items, file.name);
    const pageStudents = groupPdfStudents(textContent.items);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    for (const student of pageStudents) {
      students.push({
        name: student.name,
        className,
        photo: cropPdfPhoto(canvas, page.getViewport({ scale: 1 }), student)
      });
    }
  }

  return students;
}

async function parseSpreadsheet(buffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return rowsToStudents(rows);
}

async function readImportedStudents(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") {
    return await parsePdfRoster(file);
  }
  if (extension === "xlsx" || extension === "xls" || extension === "xlse") {
    return await parseSpreadsheet(await file.arrayBuffer());
  }
  return parseStudentList(await file.text());
}

async function readImportedGrades(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
  const blocks = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const nameColumn = row.findIndex((cell) => normalizeHeader(cell) === "nome");
    if (nameColumn < 0) continue;

    const assessments = [];
    for (let col = nameColumn + 1; col < row.length; col += 1) {
      const header = normalize(row[col]);
      const normalizedHeader = normalizeHeader(header);
      if (!header || normalizedHeader === "media" || normalizedHeader === "total") break;
      assessments.push({ name: header, column: col });
    }

    if (!assessments.length) continue;

    const students = [];
    let className = "";
    for (let nextRowIndex = rowIndex + 1; nextRowIndex < rows.length; nextRowIndex += 1) {
      const nextRow = rows[nextRowIndex];
      if (nextRow.findIndex((cell) => normalizeHeader(cell) === "nome") >= 0) break;

      const rowClassName = normalize(nextRow[0]);
      const studentName = normalize(nextRow[nameColumn]);
      if (rowClassName) className = rowClassName;
      if (!studentName || !className) continue;

      const grades = Object.fromEntries(
        assessments.map((assessment) => {
          const rawValue = nextRow[assessment.column];
          const value = typeof rawValue === "number" ? String(rawValue).replace(".", ",") : normalize(rawValue);
          return [assessment.name, value || "missing"];
        })
      );

      students.push({ className, studentName, grades });
    }

    if (className && students.length) {
      blocks.push({ className, assessments: assessments.map((assessment) => assessment.name), students });
    }
  }

  return blocks;
}

function parseImportedDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  const text = normalize(value);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (br) {
    const day = br[1].padStart(2, "0");
    const month = br[2].padStart(2, "0");
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${month}-${day}`;
  }
  return "";
}

const MONTH_ALIASES = {
  jan: "01",
  janeiro: "01",
  fev: "02",
  fevereiro: "02",
  mar: "03",
  marco: "03",
  março: "03",
  abr: "04",
  abril: "04",
  mai: "05",
  maio: "05",
  jun: "06",
  junho: "06",
  jul: "07",
  julho: "07",
  ago: "08",
  agosto: "08",
  set: "09",
  setembro: "09",
  out: "10",
  outubro: "10",
  nov: "11",
  novembro: "11",
  dez: "12",
  dezembro: "12"
};

function monthKeyFromHeader(value, fallbackYear = DEFAULT_SCHOOL_YEAR.year) {
  const text = normalizeHeader(value).replace(/[—–-]/g, " ");
  const tokens = text.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (MONTH_ALIASES[token]) return `${fallbackYear}-${MONTH_ALIASES[token]}`;
  }
  const numeric = text.match(/(?:^|\D)(\d{1,2})[\/\-\.](\d{2,4})(?:\D|$)/);
  if (numeric) {
    const month = numeric[1].padStart(2, "0");
    const year = numeric[2].length === 2 ? `20${numeric[2]}` : numeric[2];
    if (Number(month) >= 1 && Number(month) <= 12) return `${year}-${month}`;
  }
  return "";
}

function importedAttendanceStatus(value) {
  const text = normalizeHeader(value);
  if (!text) return "";
  const key = normalizeKey(text);
  if (["p", "presente", "presenca", "compareceu", "1"].includes(key)) return "present";
  if (["f", "falta", "faltou", "ausente", "0"].includes(key)) return "absent";
  if (["j", "justificada", "justificado", "faltajustificada", "fj"].includes(key)) return "excused";
  if (["n", "nc", "naochamada", "chamadanaofeita", "naofezchamada", "naoregistrado", "naolancado"].includes(key)) return ATTENDANCE_NOT_TAKEN;
  if (key.includes("presente") || key.includes("presenca")) return "present";
  if (key.includes("justific")) return "excused";
  if (key.includes("falta") || key.includes("ausente")) return "absent";
  if (key.includes("naochamada") || key.includes("naofeita")) return ATTENDANCE_NOT_TAKEN;
  return "";
}

function columnIndexByHeader(row, names) {
  const keys = names.map(normalizeKey);
  return row.findIndex((cell) => keys.includes(normalizeKey(cell)));
}

function rowsToAttendanceRecords(rows, fallbackClassName = "") {
  const records = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const header = rows[rowIndex];
    const dateColumn = columnIndexByHeader(header, ["data", "dia"]);
    const classColumn = columnIndexByHeader(header, ["turma", "classe"]);
    const studentColumn = columnIndexByHeader(header, ["aluno", "nome", "estudante"]);
    const statusColumn = columnIndexByHeader(header, ["frequencia", "frequência", "status", "chamada", "presenca", "presença"]);
    const periodsColumn = columnIndexByHeader(header, ["aulas", "tempos", "periodos", "períodos"]);
    const contentColumn = columnIndexByHeader(header, ["conteudo", "conteúdo", "assunto", "aula"]);

    if (dateColumn >= 0 && studentColumn >= 0 && statusColumn >= 0) {
      for (let nextRowIndex = rowIndex + 1; nextRowIndex < rows.length; nextRowIndex += 1) {
        const row = rows[nextRowIndex];
        if (columnIndexByHeader(row, ["data", "dia"]) >= 0 && columnIndexByHeader(row, ["aluno", "nome", "estudante"]) >= 0) break;
        const date = parseImportedDate(row[dateColumn]);
        const studentName = normalize(row[studentColumn]);
        const status = importedAttendanceStatus(row[statusColumn]);
        const className = normalize(classColumn >= 0 ? row[classColumn] : fallbackClassName);
        if (!date || !studentName || !status) continue;
        records.push({
          date,
          className,
          studentName,
          status,
          periods: periodsColumn >= 0 ? numberValue(row[periodsColumn], 1) : 1,
          content: normalize(contentColumn >= 0 ? row[contentColumn] : "")
        });
      }
      return records;
    }

    if (studentColumn >= 0) {
      const classNameFromHeader = classColumn >= 0;
      const dateColumns = header
        .map((cell, column) => ({ column, date: parseImportedDate(cell) }))
        .filter((item) => item.date);
      if (!dateColumns.length) continue;

      for (let nextRowIndex = rowIndex + 1; nextRowIndex < rows.length; nextRowIndex += 1) {
        const row = rows[nextRowIndex];
        if (columnIndexByHeader(row, ["aluno", "nome", "estudante"]) >= 0) break;
        const studentName = normalize(row[studentColumn]);
        const className = normalize(classNameFromHeader ? row[classColumn] : fallbackClassName);
        if (!studentName || !className) continue;
        for (const dateColumnInfo of dateColumns) {
          const status = importedAttendanceStatus(row[dateColumnInfo.column]);
          if (!status) continue;
          records.push({
            date: dateColumnInfo.date,
            className,
            studentName,
            status,
            periods: 1,
            content: ""
          });
        }
      }
      return records;
    }
  }
  return records;
}

function rowsToAttendanceSummaryRecords(rows, fallbackClassName = "") {
  const records = [];
  let sheetLessonTotal = 0;
  const monthlyLessonTotals = new Map();

  for (let lessonRowIndex = 0; lessonRowIndex < rows.length; lessonRowIndex += 1) {
    const row = rows[lessonRowIndex];
    const firstCell = normalizeHeader(row[0]);
    if (firstCell === "aulas dadas" || firstCell === "total de aulas") {
      const previousRow = rows[Math.max(0, lessonRowIndex - 1)] ?? [];
      row.forEach((cell, column) => {
        const monthKey = monthKeyFromHeader(previousRow[column], DEFAULT_SCHOOL_YEAR.year);
        if (!monthKey) return;
        const value = numberValue(cell, NaN);
        if (Number.isFinite(value)) monthlyLessonTotals.set(monthKey, value);
      });
      const numericValues = row.slice(1).map((cell) => numberValue(cell, NaN)).filter(Number.isFinite);
      if (numericValues.length) sheetLessonTotal = Math.max(...numericValues);
    }
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const header = rows[rowIndex];
    const studentColumn = header.findIndex((cell) => {
      const key = normalizeKey(cell);
      return key === "nomecivil" || key === "nomesocial" || key === "nome" || key === "aluno" || key === "estudante";
    });
    const classColumn = columnIndexByHeader(header, ["turma", "classe"]);
    const absencesColumn = header.findIndex((cell) => {
      const key = normalizeKey(cell);
      return key === "totaldefaltas" || key === "faltas" || key === "faltastotal";
    });
    const lessonsColumn = header.findIndex((cell) => {
      const key = normalizeKey(cell);
      return key === "aulasconsideradas" || key === "aulasdadas" || key === "totaldeaulas" || key === "aulastotal";
    });
    const excusedColumn = header.findIndex((cell) => {
      const key = normalizeKey(cell);
      return key === "justificadas" || key === "faltasjustificadas";
    });
    const monthlyAbsenceColumns = header
      .map((cell, column) => ({ column, monthKey: monthKeyFromHeader(cell, DEFAULT_SCHOOL_YEAR.year), key: normalizeKey(cell) }))
      .filter((item) => item.monthKey && (item.key.includes("falta") || item.key.includes("ausencia") || item.key.includes("ausente")));

    if (studentColumn < 0 || (absencesColumn < 0 && !monthlyAbsenceColumns.length) || (lessonsColumn < 0 && !sheetLessonTotal && !monthlyAbsenceColumns.length)) continue;

    for (let nextRowIndex = rowIndex + 1; nextRowIndex < rows.length; nextRowIndex += 1) {
      const row = rows[nextRowIndex];
      const studentName = normalize(row[studentColumn]);
      if (!studentName) continue;
      if (row.findIndex((cell) => normalizeKey(cell) === "nomecivil" || normalizeKey(cell) === "aluno") >= 0) break;
      const className = normalize(classColumn >= 0 ? row[classColumn] : fallbackClassName);

      if (monthlyAbsenceColumns.length) {
        for (const item of monthlyAbsenceColumns) {
          const absences = numberValue(row[item.column], NaN);
          if (!Number.isFinite(absences)) continue;
          const lessonTotal = monthlyLessonTotals.get(item.monthKey);
          if (!Number.isFinite(lessonTotal)) continue;
          records.push({
            className,
            studentName,
            monthKey: item.monthKey,
            periodId: periodForDate(`${item.monthKey}-01`),
            lessonTotal,
            absences,
            excused: 0
          });
        }
        continue;
      }

      const absences = numberValue(row[absencesColumn], NaN);
      const lessonTotal = lessonsColumn >= 0 ? numberValue(row[lessonsColumn], NaN) : sheetLessonTotal;
      if (!Number.isFinite(absences) || !Number.isFinite(lessonTotal)) continue;
      records.push({
        className,
        studentName,
        lessonTotal,
        absences,
        excused: excusedColumn >= 0 ? numberValue(row[excusedColumn], 0) : 0
      });
    }
    return records;
  }

  return records;
}

async function readImportedAttendance(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const lessonRecords = [];
  const summaryRecords = [];

  if (extension === "xlsx" || extension === "xls" || extension === "xlse") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      lessonRecords.push(...rowsToAttendanceRecords(rows, sheetName));
      summaryRecords.push(...rowsToAttendanceSummaryRecords(rows, sheetName));
    }
    return { lessonRecords, summaryRecords };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { lessonRecords: [], summaryRecords: [] };
  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => splitRow(line, delimiter));
  return {
    lessonRecords: rowsToAttendanceRecords(rows, ""),
    summaryRecords: rowsToAttendanceSummaryRecords(rows, "")
  };
}

function csvDownload(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function setSheetWidths(sheet, widths) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

function sheetSafeName(text, fallback = "Planilha") {
  const name = normalize(text)
    .replace(/[\[\]\*\/\\\?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (name || fallback).slice(0, 31);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function lessonRecordForStudent(lesson, student) {
  return lesson.attendance.find((record) => record.studentId === student.id || record.studentName === student.name);
}

function attendanceStatusLabel(status) {
  if (status === "present") return "Presente";
  if (status === "absent") return "Falta";
  if (status === "excused") return "Justificada";
  return "Chamada não feita";
}

function lessonAttendanceTaken(lesson) {
  return lesson.attendance.some((record) => ["present", "absent", "excused"].includes(record.status));
}

function isActiveStudent(student) {
  return student?.status !== "left";
}

function studentStatusLabel(student) {
  return isActiveStudent(student) ? "Ativo" : "Saiu da escola";
}

function lessonPeriods(lesson) {
  return Math.max(1, Math.round(numberValue(lesson?.periods, 1)));
}

function totalLessonPeriods(lessons) {
  return lessons.reduce((total, lesson) => total + lessonPeriods(lesson), 0);
}

function matchingAttendanceSummaries(summaries, classId, student, periodId = null, monthKey = null) {
  return (summaries ?? []).filter(
    (summary) =>
      summary.classId === classId &&
      (summary.studentId === student.id || normalizeKey(summary.studentName) === normalizeKey(student.name)) &&
      (!periodId || periodId === ANNUAL_PERIOD || summary.periodId === periodId) &&
      (!monthKey || summary.monthKey === monthKey)
  );
}

function studentImportedAttendancePeriods(summaries, classId, student, periodId = null, monthKey = null) {
  return matchingAttendanceSummaries(summaries, classId, student, periodId, monthKey).reduce(
    (total, summary) => total + Math.max(0, Math.round(numberValue(summary.lessonTotal, 0))),
    0
  );
}

function studentImportedAbsences(summaries, classId, student, periodId = null, monthKey = null) {
  return matchingAttendanceSummaries(summaries, classId, student, periodId, monthKey).reduce(
    (total, summary) => total + Math.max(0, Math.round(numberValue(summary.absences, 0))),
    0
  );
}

function studentImportedExcused(summaries, classId, student, periodId = null, monthKey = null) {
  return matchingAttendanceSummaries(summaries, classId, student, periodId, monthKey).reduce(
    (total, summary) => total + Math.max(0, Math.round(numberValue(summary.excused, 0))),
    0
  );
}

function classImportedAbsences(summaries, classId, periodId = null) {
  return (summaries ?? [])
    .filter((summary) => summary.classId === classId && (!periodId || periodId === ANNUAL_PERIOD || summary.periodId === periodId))
    .reduce((total, summary) => total + Math.max(0, Math.round(numberValue(summary.absences, 0))), 0);
}

function classImportedLessonPeriods(summaries, classId, periodId = null) {
  const groups = new Map();
  for (const summary of summaries ?? []) {
    if (summary.classId !== classId) continue;
    if (periodId && periodId !== ANNUAL_PERIOD && summary.periodId !== periodId) continue;
    const key = summary.monthKey || `${summary.periodId || ""}|${normalizeKey(summary.source)}`;
    const lessonTotal = Math.max(0, Math.round(numberValue(summary.lessonTotal, 0)));
    groups.set(key, Math.max(groups.get(key) ?? 0, lessonTotal));
  }
  return [...groups.values()].reduce((total, value) => total + value, 0);
}

function studentAttendancePeriodsInLessons(lessons, student) {
  return lessons.reduce((total, lesson) => {
    const record = lessonRecordForStudent(lesson, student);
    return ["present", "absent", "excused"].includes(record?.status) ? total + lessonPeriods(lesson) : total;
  }, 0);
}

function studentAbsencesInLessons(lessons, student) {
  return lessons.reduce((total, lesson) => {
    const record = lessonRecordForStudent(lesson, student);
    return total + (record?.status === "absent" ? lessonPeriods(lesson) : 0);
  }, 0);
}

function studentExcusedInLessons(lessons, student) {
  return lessons.reduce((total, lesson) => {
    const record = lessonRecordForStudent(lesson, student);
    return total + (record?.status === "excused" ? lessonPeriods(lesson) : 0);
  }, 0);
}

function studentAttendanceTotal(lessons, summaries, classId, student, periodId = null, monthKey = null) {
  return studentAttendancePeriodsInLessons(lessons, student) + studentImportedAttendancePeriods(summaries, classId, student, periodId, monthKey);
}

function studentAbsenceTotal(lessons, summaries, classId, student, periodId = null, monthKey = null) {
  return studentAbsencesInLessons(lessons, student) + studentImportedAbsences(summaries, classId, student, periodId, monthKey);
}

function studentExcusedTotal(lessons, summaries, classId, student, periodId = null, monthKey = null) {
  return studentExcusedInLessons(lessons, student) + studentImportedExcused(summaries, classId, student, periodId, monthKey);
}

async function saveWorkbook(workbook, filename, XLSX) {
  const isNative = !!window.Capacitor?.isNativePlatform?.();

  if (!isNative) {
    XLSX.writeFile(workbook, filename);
    return { message: `Arquivo ${filename} gerado.` };
  }

  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const base64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });

  const saved = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Documents,
    recursive: true
  });

  await Share.share({
    title: "Exportar diário de classe",
    text: "Arquivo XLSX do Diário de Classe",
    url: saved.uri,
    dialogTitle: "Salvar ou compartilhar arquivo"
  });

  return { message: `Arquivo ${filename} salvo em Documentos.` };
}

async function saveTextFile(filename, text, title = "Exportar arquivo") {
  const isNative = !!window.Capacitor?.isNativePlatform?.();

  if (!isNative) {
    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Backup do Diário de Classe", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { message: `Backup salvo em ${handle.name}.` };
    }
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return { message: `Arquivo ${filename} gerado.` };
  }

  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const data = btoa(unescape(encodeURIComponent(text)));
  const saved = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Documents,
    recursive: true
  });

  await Share.share({
    title,
    text: filename,
    url: saved.uri,
    dialogTitle: "Salvar ou compartilhar arquivo"
  });

  return { message: `Arquivo ${filename} salvo em Documentos.` };
}

function numberValue(value, fallback = 0) {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatGrade(value, decimals = activeGradeDecimals) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function isMissingGrade(value) {
  if (value === true) return true;
  if (value && typeof value === "object") return value.status === "missing";
  const normalized = normalizeHeader(value);
  return normalized === "missing" || normalized === "nao entregou" || normalized === "nao-entregou" || normalized === "não entregou" || normalized === "não-entregou";
}

function gradeValue(value) {
  return isMissingGrade(value) ? 0 : numberValue(value, 0);
}

function assessmentTypeLabel(type) {
  return type === "average" ? "Média" : "Soma";
}

function assessmentKindFromData(assessment) {
  if (assessment?.kind) return assessment.kind;
  return assessment?.allowsMakeup === true ? "formal" : "informal";
}

function assessmentKindLabel(kind) {
  return ASSESSMENT_KINDS.find((item) => item.id === kind)?.title ?? "Avaliação";
}

function assessmentAllowsMakeup(assessment) {
  return assessmentKindFromData(assessment) === "formal";
}

function hasMakeupGrade(assessment, studentId) {
  const value = assessment?.makeupGrades?.[studentId];
  return !!normalize(value) || isMissingGrade(value);
}

function needsMakeup(assessment, student) {
  return assessmentAllowsMakeup(assessment) && isActiveStudent(student) && isMissingGrade(assessment?.grades?.[student.id]) && !hasMakeupGrade(assessment, student.id);
}

function effectiveGradeValue(assessment, studentId) {
  const makeupGrade = assessment?.makeupGrades?.[studentId];
  return normalize(makeupGrade) ? makeupGrade : assessment?.grades?.[studentId];
}

function makeupDisplayValue(value, emptyValue = "-") {
  if (isMissingGrade(value)) return "Não fez";
  return normalize(value) ? value : emptyValue;
}

function makeupResolutionLabel(value) {
  if (isMissingGrade(value)) return "Não fez a 2ª chamada";
  return normalize(value) ? "Resolvida na 2ª chamada" : "Lançada";
}

function missingAssessmentLabel(assessment) {
  return assessmentAllowsMakeup(assessment) ? "Faltou" : "Não entregou";
}

function assessmentDisplayValue(assessment, studentId) {
  const makeupGrade = assessment?.makeupGrades?.[studentId];
  if (isMissingGrade(makeupGrade)) return "Não fez";
  const value = effectiveGradeValue(assessment, studentId);
  if (isMissingGrade(value)) return missingAssessmentLabel(assessment);
  return normalize(value) ? value : "0";
}

function pendingAssessmentSummary(assessments) {
  const formal = assessments.filter(assessmentAllowsMakeup).map((assessment) => assessment.name);
  const informal = assessments.filter((assessment) => !assessmentAllowsMakeup(assessment)).map((assessment) => assessment.name);
  return [
    formal.length ? `Faltou: ${formal.join("; ")}` : "",
    informal.length ? `Não entregou: ${informal.join("; ")}` : ""
  ].filter(Boolean).join(" | ");
}

function isPendingGrade(assessment, studentId) {
  return isMissingGrade(assessment?.grades?.[studentId]) && !hasMakeupGrade(assessment, studentId);
}

function calculateFinalGrade(studentId, assessments) {
  if (!assessments.length) return 0;

  const averageAssessments = assessments.filter((assessment) => assessment.calculationType === "average");
  const sumAssessments = assessments.filter((assessment) => assessment.calculationType !== "average");
  const totalWeight = averageAssessments.reduce((total, assessment) => total + numberValue(assessment.weight, 1), 0);
  const weightedAverage = totalWeight
    ? averageAssessments.reduce((total, assessment) => {
        const score = gradeValue(effectiveGradeValue(assessment, studentId));
        const maxScore = numberValue(assessment.maxScore, 10);
        const weight = numberValue(assessment.weight, 1);
        const normalizedScore = maxScore > 0 ? (score / maxScore) * 10 : 0;
        return total + normalizedScore * weight;
      }, 0) / totalWeight
    : 0;
  const summedPoints = sumAssessments.reduce((total, assessment) => total + gradeValue(effectiveGradeValue(assessment, studentId)), 0);

  return weightedAverage + summedPoints;
}

function assessmentsForPeriod(assessments, periodId) {
  if (periodId === ANNUAL_PERIOD) return assessments;
  return assessments.filter((assessment) => assessment.periodId === periodId);
}

function calculateAnnualGrade(studentId, assessments) {
  const termGrades = PERIODS.map((period) => {
    const termAssessments = assessmentsForPeriod(assessments, period.id);
    return termAssessments.length ? calculateFinalGrade(studentId, termAssessments) : null;
  }).filter((grade) => grade !== null);

  if (!termGrades.length) return 0;
  return termGrades.reduce((total, grade) => total + grade, 0) / termGrades.length;
}

function calculateAnnualGradeWithRecovery(studentId, assessments, recoveries, classId) {
  const termGrades = PERIODS.map((period) => {
    const termAssessments = assessmentsForPeriod(assessments, period.id);
    if (!termAssessments.length) return null;
    const baseGrade = calculateFinalGrade(studentId, termAssessments);
    return applyRecoveryGrade(baseGrade, recoveryGradeForStudent(recoveries, classId, period.id, studentId));
  }).filter((grade) => grade !== null);

  if (!termGrades.length) return 0;
  return termGrades.reduce((total, grade) => total + grade, 0) / termGrades.length;
}

function recoveryGradeForStudent(recoveries, classId, periodId, studentId) {
  const recovery = recoveries.find((item) => item.classId === classId && item.periodId === periodId);
  return recovery?.grades?.[studentId];
}

function applyRecoveryGrade(baseGrade, recoveryGrade) {
  if (!normalize(recoveryGrade)) return baseGrade;
  const recovered = (baseGrade + numberValue(recoveryGrade, 0)) / 2;
  return recovered > baseGrade ? recovered : baseGrade;
}

function calculateDisplayedGrade(studentId, assessments, periodId, schoolYear = DEFAULT_SCHOOL_YEAR, recoveries = [], classId = "") {
  if (periodId === ANNUAL_PERIOD) return isAnnualClosed(schoolYear) ? calculateAnnualGradeWithRecovery(studentId, assessments, recoveries, classId) : null;
  const baseGrade = calculateFinalGrade(studentId, assessmentsForPeriod(assessments, periodId));
  return applyRecoveryGrade(baseGrade, recoveryGradeForStudent(recoveries, classId, periodId, studentId));
}

function calculateAssessmentClassAverage(assessment, students) {
  if (!students.length) return 0;

  const total = students.reduce((sum, student) => {
    const score = gradeValue(effectiveGradeValue(assessment, student.id));
    if (assessment.calculationType === "average") {
      const maxScore = numberValue(assessment.maxScore, 10);
      return sum + (maxScore > 0 ? (score / maxScore) * 10 : 0);
    }
    return sum + score;
  }, 0);

  return total / students.length;
}

function App() {
  const [data, setData] = useState(loadData);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordError, setPasswordError] = useState("");
  const [authTab, setAuthTab] = useState("login");
  const [signupEmailDraft, setSignupEmailDraft] = useState("");
  const [signupPasswordDraft, setSignupPasswordDraft] = useState("");
  const [signupConfirmDraft, setSignupConfirmDraft] = useState("");
  const [loginEmailDraft, setLoginEmailDraft] = useState("");
  const [loginPasswordDraft, setLoginPasswordDraft] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(() => window.location.hash.includes("type=recovery"));
  const [recoveryPasswordDraft, setRecoveryPasswordDraft] = useState("");
  const [recoveryConfirmDraft, setRecoveryConfirmDraft] = useState("");
  const [appLockPinHash, setAppLockPinHash] = useState(loadAppLockPinHash);
  const [pinDraft, setPinDraft] = useState("");
  const [pinConfirmDraft, setPinConfirmDraft] = useState("");
  const [pinError, setPinError] = useState("");
  const [appLockUnlocked, setAppLockUnlocked] = useState(false);
  const appUnlocked = !!session;
  const userId = session?.user?.id ?? null;
  const [pendingGradeImport, setPendingGradeImport] = useState(null);
  const [pendingAttendanceImport, setPendingAttendanceImport] = useState(null);
  const [teacherName, setTeacherName] = useState(loadTeacherName);
  const [teacherDraft, setTeacherDraft] = useState(loadTeacherName);
  const [subjectName, setSubjectName] = useState(loadSubjectName);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTeacherDraft, setSettingsTeacherDraft] = useState(loadTeacherName);
  const [settingsSubjectDraft, setSettingsSubjectDraft] = useState(loadSubjectName);
  const [settingsDecimalsDraft, setSettingsDecimalsDraft] = useState(loadGradeDecimals);
  const [setupTeacherDraft, setSetupTeacherDraft] = useState(loadTeacherName);
  const [setupSubjectDraft, setSetupSubjectDraft] = useState(loadSubjectName);
  const [setupDecimalsDraft, setSetupDecimalsDraft] = useState(loadGradeDecimals);
  const [selectedPeriod, setSelectedPeriod] = useState(periodForDate(today(), data.schoolYear ?? DEFAULT_SCHOOL_YEAR));
  const [showTermEditor, setShowTermEditor] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(data.classes[0]?.id ?? "");
  const [view, setView] = useState("students");
  const [className, setClassName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [query, setQuery] = useState("");
  const [lessonDate, setLessonDate] = useState(today);
  const [lessonPeriodsCount, setLessonPeriodsCount] = useState("1");
  const [lessonContent, setLessonContent] = useState("");
  const [attendance, setAttendance] = useState({});
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [lessonStatusMessage, setLessonStatusMessage] = useState("");
  const [editingLessonId, setEditingLessonId] = useState("");
  const [assessmentName, setAssessmentName] = useState("");
  const [assessmentDescription, setAssessmentDescription] = useState("");
  const [assessmentMax, setAssessmentMax] = useState("10");
  const [assessmentWeight, setAssessmentWeight] = useState("1");
  const [assessmentType, setAssessmentType] = useState("average");
  const [assessmentKind, setAssessmentKind] = useState("");
  const [editingAssessmentId, setEditingAssessmentId] = useState("");
  const [makeupDrafts, setMakeupDrafts] = useState({});
  const [recoveryDrafts, setRecoveryDrafts] = useState({});
  const [includeOtherClassesInMakeup, setIncludeOtherClassesInMakeup] = useState(false);
  const [includeOtherClassesInRecovery, setIncludeOtherClassesInRecovery] = useState(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState("");
  const [pendingFocusAssessmentId, setPendingFocusAssessmentId] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importUndo, setImportUndo] = useState(null);
  const [isReportPanelOpen, setIsReportPanelOpen] = useState(false);
  const [reportPreset, setReportPreset] = useState("complete");
  const [reportFormat, setReportFormat] = useState("xlsx");
  const [reportPeriod, setReportPeriod] = useState(selectedPeriod);
  const [reportAttendanceScope, setReportAttendanceScope] = useState("period");
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [studentInfoId, setStudentInfoId] = useState("");
  const [supabaseInfo, setSupabaseInfo] = useState(supabaseStatus());
  const [remoteSyncLoading, setRemoteSyncLoading] = useState(false);
  const [remoteSnapshots, setRemoteSnapshots] = useState([]);
  const [syncReview, setSyncReview] = useState(null);
  const [selectedSyncSnapshotId, setSelectedSyncSnapshotId] = useState("");
  const [autoSaveMessage, setAutoSaveMessage] = useState("");
  const [gradeDecimals, setGradeDecimals] = useState(loadGradeDecimals);
  const [deviceId] = useState(loadDeviceId);
  const [draggingClassId, setDraggingClassId] = useState("");
  const autoSaveReadyRef = useRef(false);

  async function refreshRemoteSnapshots() {
    if (!supabaseStatus().configured || !userId) {
      setRemoteSnapshots([]);
      return [];
    }
    try {
      const snapshots = await fetchLatestSnapshots(userId, SYNC_HISTORY_LIMIT + 1);
      setRemoteSnapshots(snapshots);
      return snapshots;
    } catch (error) {
      console.warn("Não foi possível atualizar o histórico do Supabase:", error);
      setRemoteSnapshots([]);
      return [];
    }
  }

  async function loadLatestFromSupabase({ silent = false } = {}) {
    if (!supabaseStatus().configured) {
      if (!silent) setImportMessage("Supabase não está configurado. Configure as variáveis de ambiente e tente novamente.");
      setAutoSaveMessage("Supabase não configurado. Os dados são salvos localmente.");
      return false;
    }
    setRemoteSyncLoading(true);
    setSupabaseInfo(supabaseStatus());
    try {
      setAutoSaveMessage("Carregando dados do Supabase...");
      const payload = await loadRemoteState(userId);
      if (!payload?.data) {
        if (!silent) setImportMessage("Nenhuma versão remota encontrada no Supabase.");
        setAutoSaveMessage("Nenhuma versão remota encontrada no Supabase.");
        await refreshRemoteSnapshots();
        return false;
      }

      const validation = validateBackupData(payload.data);
      if (!validation.valid) throw new Error(validation.message);

      const remoteHash = payload.integrity?.hash || (await dataIntegrity(migrateData(payload.data))).hash;
      const localHash = (await dataIntegrity(migrateData(data))).hash;
      const lastSyncedHash = loadLastSyncedHash();

      if (remoteHash === localHash) {
        saveLastSyncedHash(remoteHash);
        setAutoSaveMessage("Dados já sincronizados com o Supabase.");
        await refreshRemoteSnapshots();
        return true;
      }

      if (!lastSyncedHash || localHash === lastSyncedHash) {
        // Não há alterações locais pendentes de envio: seguro aplicar a versão remota direto.
        const loadedData = migrateData(payload.data);
        suppressNextAutoSaveRef.current = true;
        setData(loadedData);
        setSelectedClassId(loadedData.classes[0]?.id ?? "");
        if (typeof payload.teacherName === "string") {
          setTeacherName(payload.teacherName);
        }
        if (typeof payload.subjectName === "string") {
          setSubjectName(payload.subjectName);
        }
        const decimals = Number(payload.settings?.gradeDecimals ?? payload.gradeDecimals);
        if ([0, 1, 2].includes(decimals)) {
          setGradeDecimals(decimals);
        }
        saveLastSyncedHash(remoteHash);

        const loadedAt = payload.exportedAt ?? payload.createdAt ?? new Date().toISOString();
        setAutoSaveMessage(`Dados carregados do Supabase. Último backup ${new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }).format(new Date(loadedAt))}.`);
        await refreshRemoteSnapshots();
        return true;
      }

      // Há alterações locais ainda não enviadas e o Supabase tem uma versão diferente:
      // provavelmente uma edição feita em outro aparelho. Pedir revisão antes de aplicar.
      const remoteSnapshot = await verifySnapshotIntegrity(snapshotFromPayload(payload));
      if (!remoteSnapshot?.data) throw new Error("Não foi possível interpretar os dados do Supabase.");
      setSyncReview({
        mode: "merge",
        fileName: `Supabase${payload.sourceDevice ? ` (${payload.sourceDevice})` : ""}`,
        incomingSettings: {
          teacherName: payload.teacherName ?? payload.settings?.teacherName,
          subjectName: payload.subjectName ?? payload.settings?.subjectName,
          gradeDecimals: payload.settings?.gradeDecimals
        },
        snapshots: [remoteSnapshot]
      });
      setSelectedSyncSnapshotId(remoteSnapshot.id);
      if (!silent) {
        setImportMessage("Encontramos dados diferentes no Supabase (provavelmente editados em outro aparelho). Revise antes de aplicar.");
      }
      setAutoSaveMessage("Alterações remotas aguardando sua revisão.");
      await refreshRemoteSnapshots();
      return false;
    } catch (error) {
      if (!silent) setImportMessage(`Não foi possível carregar do Supabase: ${error?.message ?? "erro desconhecido"}`);
      return false;
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  async function openRemoteSnapshotReview(snapshotId) {
    if (!supabaseStatus().configured) return;
    setRemoteSyncLoading(true);
    try {
      const record = await fetchSnapshotById(userId, snapshotId);
      if (!record?.payload?.data) {
        setImportMessage("Não foi possível carregar essa versão do Supabase.");
        return;
      }
      const validation = validateBackupData(record.payload.data);
      if (!validation.valid) {
        setImportMessage(`Versão inválida: ${validation.message}`);
        return;
      }
      const remoteSnapshot = await verifySnapshotIntegrity(snapshotFromPayload(record.payload));
      if (!remoteSnapshot?.data) {
        setImportMessage("Não foi possível interpretar essa versão do Supabase.");
        return;
      }
      setSyncReview({
        mode: "restore",
        fileName: `Supabase - ${record.label ?? "versão selecionada"}`,
        incomingSettings: {
          teacherName: record.payload.teacherName ?? record.payload.settings?.teacherName,
          subjectName: record.payload.subjectName ?? record.payload.settings?.subjectName,
          gradeDecimals: record.payload.settings?.gradeDecimals
        },
        snapshots: [remoteSnapshot]
      });
      setSelectedSyncSnapshotId(remoteSnapshot.id);
      setImportMessage("Revise a versão selecionada antes de restaurar.");
    } catch (error) {
      setImportMessage(`Não foi possível carregar essa versão do Supabase: ${error?.message ?? "erro desconhecido"}`);
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  async function readLatestBackupFileFromDirectoryHandle(directoryHandle) {
    try {
      let latest = null;

      for await (const [name, handle] of directoryHandle) {
        if (handle.kind !== "file") continue;
        const extension = name.split(".").pop()?.toLowerCase();
        if (!["json", "backup", "txt"].includes(extension)) continue;

        const file = await handle.getFile();
        const text = await file.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          continue;
        }

        const validation = validateBackupData(payload?.data ?? payload);
        if (!validation.valid) continue;

        const modified = file.lastModified || 0;
        if (!latest || modified > latest.modified) {
          latest = { payload, modified, name };
        }
      }

      if (!latest) {
        setImportMessage("Nenhum backup válido encontrado na pasta selecionada.");
        return null;
      }

      setImportMessage(`Arquivo mais recente encontrado: ${latest.name}`);
      return latest.payload;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw error;
    }
  }

  async function saveToSupabase() {
    if (!supabaseStatus().configured) {
      setImportMessage("Supabase não está configurado. Configure as variáveis de ambiente para sincronização remota.");
      return;
    }
    if (!userId) {
      setImportMessage("Nenhum professor autenticado.");
      return;
    }

    // O showDirectoryPicker exige gesto do usuário: precisa ser chamado antes
    // de qualquer await, senão o navegador recusa com "Must be handling a
    // user gesture" mesmo em uso real.
    let directoryHandle = null;
    if (typeof window.showDirectoryPicker === "function") {
      const chooseDirectory = window.confirm(
        "O caminho mais seguro é salvar primeiro localmente. Deseja ainda assim usar um backup existente de pasta para enviar ao Supabase? Clique em Cancelar para enviar o estado atual do aplicativo."
      );
      if (chooseDirectory) {
        try {
          directoryHandle = await window.showDirectoryPicker();
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
          setImportMessage("Envio cancelado. Nenhuma pasta foi selecionada.");
          return;
        }
      }
    }

    setRemoteSyncLoading(true);
    try {
      let payload = await buildBackupPayload(true);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn("Falha ao salvar backup local antes do envio remoto:", error);
      }

      if (directoryHandle) {
        const directoryPayload = await readLatestBackupFileFromDirectoryHandle(directoryHandle);
        if (!directoryPayload) {
          setImportMessage("Envio cancelado. Nenhum backup válido foi encontrado na pasta.");
          return;
        }
        payload = directoryPayload;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
          // Ignorar falha de backup local
        }
      }

      await saveRemoteState(userId, payload, { forceSnapshot: true });
      saveLastSyncedHash(payload.integrity?.hash);
      await refreshRemoteSnapshots();
      setAutoSaveMessage("Dados salvos no Supabase com sucesso.");
      setImportMessage("Dados salvos com sucesso no Supabase.");
    } catch (error) {
      setImportMessage(`Não foi possível salvar no Supabase: ${error?.message ?? "erro desconhecido"}`);
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  async function restoreLocalBackup() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setImportMessage("Nenhum backup local encontrado.");
        return false;
      }

      const confirmation = window.confirm(
        "Atenção: esta ação substituirá os dados atuais. Deseja restaurar o backup local?"
      );
      if (!confirmation) {
        setImportMessage("Restauração local cancelada.");
        return false;
      }

      const payload = JSON.parse(raw);
      const validation = validateBackupData(payload?.data ?? payload);
      if (!validation.valid) {
        setImportMessage(`Backup local inválido: ${validation.message}`);
        return false;
      }

      const loadedData = migrateData(payload.data ?? payload);
      suppressNextAutoSaveRef.current = true;
      setData(loadedData);
      setSelectedClassId(loadedData.classes[0]?.id ?? "");
      if (typeof payload.teacherName === "string") {
        setTeacherName(payload.teacherName);
      }
      if (typeof payload.subjectName === "string") {
        setSubjectName(payload.subjectName);
      }
      const decimals = Number(payload.settings?.gradeDecimals ?? payload.gradeDecimals);
      if ([0, 1, 2].includes(decimals)) {
        setGradeDecimals(decimals);
      }

      setAutoSaveMessage("Dados restaurados do backup local.");
      setImportMessage("Backup local restaurado com sucesso.");
      return true;
    } catch (error) {
      setImportMessage(`Falha ao restaurar backup local: ${error?.message ?? "erro desconhecido"}`);
      return false;
    }
  }

  async function autoSaveToSupabase() {
    if (!supabaseStatus().configured || !userId) return;
    if (autoSaveInFlightRef.current) return;
    autoSaveInFlightRef.current = true;
    try {
      const payload = await buildBackupPayload(true);
      await saveRemoteState(userId, payload);
      saveLastSyncedHash(payload.integrity?.hash);
      await refreshRemoteSnapshots();
      setAutoSaveMessage("Alteração salva no Supabase.");
    } catch (error) {
      setAutoSaveMessage(`Não foi possível salvar no Supabase: ${error?.message ?? "erro desconhecido"}`);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(await buildBackupPayload(true)));
      } catch {
        // Ignorar fallback local
      }
    } finally {
      autoSaveInFlightRef.current = false;
    }
  }
  const autoSaveTimerRef = useRef(0);
  const autoSaveInFlightRef = useRef(false);
  const suppressNextAutoSaveRef = useRef(false);
  activeGradeDecimals = gradeDecimals;

  useEffect(() => {
    if (supabaseStatus().configured) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      setImportMessage(`Atenção: não foi possível salvar neste aparelho. Faça um backup agora. ${error?.message ?? ""}`);
    }
  }, [data]);

  useEffect(() => {
    if (!appUnlocked) return undefined;
    if (!autoSaveReadyRef.current) {
      autoSaveReadyRef.current = true;
      return undefined;
    }
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      setAutoSaveMessage("Dados carregados do Supabase.");
      return undefined;
    }

    window.clearTimeout(autoSaveTimerRef.current);
    if (!supabaseStatus().configured) {
      setAutoSaveMessage("Salvo automaticamente neste aparelho. Configure o Supabase para sincronização remota.");
      return undefined;
    }

    setAutoSaveMessage("Alteração salva neste aparelho. Sincronização remota agendada...");
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveToSupabase();
    }, AUTO_SYNC_DELAY_MS);

    return () => window.clearTimeout(autoSaveTimerRef.current);
  }, [data, teacherName, subjectName, gradeDecimals, appUnlocked]);

  useEffect(() => {
    if (teacherName) {
      localStorage.setItem(TEACHER_KEY, teacherName);
    }
  }, [teacherName]);

  useEffect(() => {
    localStorage.setItem(SUBJECT_KEY, subjectName);
  }, [subjectName]);

  useEffect(() => {
    localStorage.setItem(GRADE_DECIMALS_KEY, String(gradeDecimals));
    activeGradeDecimals = gradeDecimals;
  }, [gradeDecimals]);

  useEffect(() => {
    if (!data.classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(data.classes[0]?.id ?? "");
    }
  }, [data.classes, selectedClassId]);

  useEffect(() => {
    setReportPeriod(selectedPeriod);
  }, [selectedPeriod]);

  useEffect(() => {
    if (appUnlocked) loadLatestFromSupabase({ silent: false });
  }, [appUnlocked]);

  useEffect(() => {
    let active = true;
    getSession()
      .then((current) => {
        if (!active) return;
        setSession(current);
      })
      .catch((error) => {
        console.warn("Não foi possível recuperar a sessão do Supabase:", error);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    const { data: authSubscription } = onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      authSubscription?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!appUnlocked) setAppLockUnlocked(false);
  }, [appUnlocked]);

  const appLockRequired = appUnlocked && isNativePlatform() && !appLockUnlocked;

  async function handleAppLockSignOut() {
    setPinDraft("");
    setPinConfirmDraft("");
    setPinError("");
    try {
      await supabaseSignOut();
    } catch (error) {
      console.warn("Falha ao sair:", error);
    }
  }

  function submitCreatePin(event) {
    event.preventDefault();
    const pin = pinDraft.trim();
    if (pin.length < 4) {
      setPinError("Crie um PIN com pelo menos 4 dígitos.");
      return;
    }
    if (pin !== pinConfirmDraft.trim()) {
      setPinError("Os PINs não conferem.");
      return;
    }
    sha256Hex(pin).then((hash) => {
      saveAppLockPinHash(hash);
      setAppLockPinHash(hash);
      setAppLockUnlocked(true);
      setPinDraft("");
      setPinConfirmDraft("");
      setPinError("");
    });
  }

  async function submitCheckPin(event) {
    event.preventDefault();
    const hash = await sha256Hex(pinDraft.trim());
    if (hash === appLockPinHash) {
      setAppLockUnlocked(true);
      setPinDraft("");
      setPinError("");
      return;
    }
    setPinError("PIN incorreto.");
  }

  const selectedClass = data.classes.find((item) => item.id === selectedClassId);
  const schoolYear = data.schoolYear ?? DEFAULT_SCHOOL_YEAR;
  const studentInfo = selectedClass?.students.find((student) => student.id === studentInfoId);
  const selectedActiveStudents = useMemo(
    () => selectedClass?.students.filter(isActiveStudent) ?? [],
    [selectedClass]
  );

  useEffect(() => {
    if (!selectedClass) return;
    setAttendance(
      Object.fromEntries(selectedActiveStudents.map((student) => [student.id, attendance[student.id] ?? "present"]))
    );
  }, [selectedClassId, selectedActiveStudents.length]);

  const filteredStudents = useMemo(() => {
    const needle = query.toLowerCase();
    const students = selectedClass?.students ?? [];
    return students
      .filter((student) => student.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(!isActiveStudent(a)) - Number(!isActiveStudent(b)) || a.name.localeCompare(b.name));
  }, [query, selectedClass]);

  const allClassLessons = useMemo(
    () => data.lessons.filter((lesson) => lesson.classId === selectedClassId),
    [data.lessons, selectedClassId]
  );

  const allClassAssessments = useMemo(
    () => data.assessments.filter((assessment) => assessment.classId === selectedClassId),
    [data.assessments, selectedClassId]
  );

  const classLessons = useMemo(
    () =>
      selectedPeriod === ANNUAL_PERIOD
        ? allClassLessons
        : allClassLessons.filter((lesson) => lesson.periodId === selectedPeriod),
    [allClassLessons, selectedPeriod]
  );

  const classAssessments = useMemo(
    () =>
      selectedPeriod === ANNUAL_PERIOD
        ? allClassAssessments
        : allClassAssessments.filter((assessment) => assessment.periodId === selectedPeriod),
    [allClassAssessments, selectedPeriod]
  );

  const stats = useMemo(() => {
    const students = selectedActiveStudents;
    const absences = classLessons.reduce(
      (total, lesson) => total + lesson.attendance.filter((item) => item.status === "absent").length * lessonPeriods(lesson),
      0
    ) + classImportedAbsences(data.attendanceSummaries, selectedClassId, selectedPeriod);
    return {
      total: students.length,
      absences,
      lessons: totalLessonPeriods(classLessons) + classImportedLessonPeriods(data.attendanceSummaries, selectedClassId, selectedPeriod),
      assessments: classAssessments.length
    };
  }, [selectedActiveStudents, classLessons, classAssessments.length, data.attendanceSummaries, selectedClassId, selectedPeriod]);

  const gradeRows = useMemo(() => {
    const students = selectedActiveStudents;
    return students.map((student) => {
      const finalGrade = calculateDisplayedGrade(student.id, allClassAssessments, selectedPeriod, schoolYear, data.recoveries ?? [], selectedClassId);
      return { student, finalGrade, approved: finalGrade !== null && finalGrade >= 6 };
    });
  }, [selectedClass, allClassAssessments, selectedPeriod, schoolYear, data.recoveries, selectedClassId]);

  const activeAssessment = classAssessments.find((assessment) => assessment.id === activeAssessmentId);
  const hasMixedAssessmentTypes =
    classAssessments.some((assessment) => assessment.calculationType === "average") &&
    classAssessments.some((assessment) => assessment.calculationType !== "average");
  const displayedTerm = selectedPeriod === ANNUAL_PERIOD ? periodForDate(today(), schoolYear) : selectedPeriod;
  const displayedTermInfo = schoolYear.terms?.[displayedTerm] ?? DEFAULT_SCHOOL_YEAR.terms[displayedTerm];
  const displayedUpat = schoolYear.milestones?.upat?.[displayedTerm] ?? DEFAULT_SCHOOL_YEAR.milestones.upat[displayedTerm];
  const vacationInfo = schoolYear.milestones?.vacation ?? DEFAULT_SCHOOL_YEAR.milestones.vacation;
  const pendingNameMatches = pendingGradeImport?.nameMatches ?? [];
  const visibleNameMatches = pendingNameMatches.filter((match) => !match.confirmed);
  const confirmedNameMatchesCount = pendingNameMatches.length - visibleNameMatches.length;
  const hasUnconfirmedNameMatches = visibleNameMatches.length > 0;
  const hasMissingGradeImportClasses = (pendingGradeImport?.missingClasses?.length ?? 0) > 0;
  const pendingAttendanceNameMatches = pendingAttendanceImport?.nameMatches ?? [];
  const visibleAttendanceNameMatches = pendingAttendanceNameMatches.filter((match) => !match.confirmed);
  const confirmedAttendanceNameMatchesCount = pendingAttendanceNameMatches.length - visibleAttendanceNameMatches.length;
  const hasUnconfirmedAttendanceNameMatches = visibleAttendanceNameMatches.length > 0;
  const hasMissingAttendanceImportClasses = (pendingAttendanceImport?.missingClasses?.length ?? 0) > 0;
  const selectedReportPreset = REPORT_PRESETS.find((preset) => preset.id === reportPreset) ?? REPORT_PRESETS[0];
  const reportMonthOptions = useMemo(
    () => [
      ...new Set([
        ...data.lessons.map((lesson) => lesson.date?.slice(0, 7)).filter(Boolean),
        ...(data.attendanceSummaries ?? []).map((summary) => summary.monthKey).filter(Boolean)
      ])
    ].sort().reverse(),
    [data.lessons, data.attendanceSummaries]
  );
  const allMakeupGroups = useMemo(
    () =>
      data.assessments
        .filter((assessment) => selectedPeriod === ANNUAL_PERIOD || assessment.periodId === selectedPeriod)
        .filter(assessmentAllowsMakeup)
        .map((assessment) => {
          const classItem = data.classes.find((item) => item.id === assessment.classId);
          const students = (classItem?.students ?? []).filter(isActiveStudent).filter((student) => needsMakeup(assessment, student));
          return { assessment, classItem, students };
        })
        .filter((group) => group.students.length),
    [data.assessments, data.classes, selectedPeriod]
  );
  const selectedMakeupGroups = useMemo(
    () => allMakeupGroups.filter((group) => group.assessment.classId === selectedClassId),
    [allMakeupGroups, selectedClassId]
  );
  const makeupGroups = includeOtherClassesInMakeup ? allMakeupGroups : selectedMakeupGroups;
  const selectedMakeupStudentCount = selectedMakeupGroups.reduce((total, group) => total + group.students.length, 0);
  const allMakeupStudentCount = allMakeupGroups.reduce((total, group) => total + group.students.length, 0);
  const canLaunchMakeup = selectedMakeupGroups.length > 0 || allMakeupGroups.length > 0;
  const selectedTermClosed = isTermClosed(selectedPeriod, schoolYear);
  const selectedTermEnd = selectedPeriod === ANNUAL_PERIOD ? "" : schoolYear.terms?.[selectedPeriod]?.end;
  const firstTermClosed = isTermClosed("t1", schoolYear);
  const firstTermEnd = schoolYear.terms?.t1?.end;
  const allRecoveryStudents = useMemo(
    () =>
      selectedPeriod === ANNUAL_PERIOD
        ? []
        : data.classes.flatMap((classItem) => {
            const assessments = data.assessments.filter((assessment) => assessment.classId === classItem.id && assessment.periodId === selectedPeriod);
            if (!assessments.length) return [];
            return classItem.students
              .filter(isActiveStudent)
              .map((student) => {
                const baseGrade = calculateFinalGrade(student.id, assessments);
                const recoveryGrade = recoveryGradeForStudent(data.recoveries ?? [], classItem.id, selectedPeriod, student.id);
                const finalGrade = applyRecoveryGrade(baseGrade, recoveryGrade);
                return { classItem, student, baseGrade, recoveryGrade, finalGrade };
              })
              .filter((row) => row.baseGrade !== null && row.baseGrade < 6);
          }),
    [selectedPeriod, data.classes, data.assessments, data.recoveries]
  );
  const selectedRecoveryStudents = useMemo(
    () => allRecoveryStudents.filter((row) => row.classItem.id === selectedClassId),
    [allRecoveryStudents, selectedClassId]
  );
  const recoveryStudents = includeOtherClassesInRecovery ? allRecoveryStudents : selectedRecoveryStudents;
  const selectedRecoveryStudentCount = selectedRecoveryStudents.length;
  const allRecoveryStudentCount = allRecoveryStudents.length;
  const firstTermRecoveryCount = useMemo(() => {
    const firstTermAssessments = allClassAssessments.filter((assessment) => assessment.periodId === "t1");
    return selectedActiveStudents.filter((student) => {
      const baseGrade = calculateFinalGrade(student.id, firstTermAssessments);
      return baseGrade !== null && baseGrade < 6;
    }).length;
  }, [allClassAssessments, selectedActiveStudents]);
  const canLaunchRecovery = selectedTermClosed && (selectedRecoveryStudents.length > 0 || allRecoveryStudents.length > 0);
  const showAssessmentForm = editingAssessmentId || assessmentKind === "formal" || assessmentKind === "informal";

  useEffect(() => {
    if (reportMonthOptions.length && !reportMonthOptions.includes(reportMonth)) {
      setReportMonth(reportMonthOptions[0]);
    }
  }, [reportMonth, reportMonthOptions]);

  useEffect(() => {
    if (assessmentKind !== "recovery" || selectedTermClosed) return;
    setAssessmentKind("");
    setRecoveryDrafts({});
    setIncludeOtherClassesInRecovery(false);
    if (selectedPeriod === ANNUAL_PERIOD) {
      setImportMessage("Selecione um trimestre encerrado para lançar recuperação.");
      return;
    }
    setImportMessage(`A recuperação do ${periodLabel(selectedPeriod)} fica disponível após ${formatShortDate(selectedTermEnd)}.`);
  }, [assessmentKind, selectedPeriod, selectedTermClosed, selectedTermEnd]);

  const periodInsights = [
    {
      label: "UPAT",
      value: formatDateRange(displayedUpat.start, displayedUpat.end),
      detail: daysUntilLabel(displayedUpat.start, "UPAT")
    },
    {
      label: "Fim do trimestre",
      value: formatShortDate(displayedTermInfo?.end),
      detail: daysUntilLabel(displayedTermInfo?.end, `fim do ${periodLabel(displayedTerm)}`)
    },
    {
      label: vacationInfo?.label ?? "Férias/recesso",
      value: formatDateRange(vacationInfo?.start, vacationInfo?.end),
      detail: daysUntilLabel(vacationInfo?.start, vacationInfo?.label ?? "férias/recesso")
    }
  ];

  useEffect(() => {
    if (!pendingFocusAssessmentId) return;
    const timer = window.setTimeout(() => {
      const input = document.querySelector(`[data-assessment-id="${pendingFocusAssessmentId}"][data-grade-input]`);
      input?.closest(".grades-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
      input?.focus();
      input?.select();
      setPendingFocusAssessmentId("");
    }, 50);

    return () => window.clearTimeout(timer);
  }, [pendingFocusAssessmentId, classAssessments.length]);

  function updateClass(classId, updater) {
    setData((current) => ({
      ...current,
      classes: current.classes.map((item) => (item.id === classId ? updater(item) : item))
    }));
  }

  function addClass(event) {
    event.preventDefault();
    const name = normalize(className);
    if (!name) return;

    const newClass = { id: crypto.randomUUID(), name, gradingMode: "sum", students: [] };
    setData((current) => ({ ...current, classes: [...current.classes, newClass] }));
    setSelectedClassId(newClass.id);
    setClassName("");
  }

  function moveClass(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setData((current) => {
      const fromIndex = current.classes.findIndex((item) => item.id === draggedId);
      const toIndex = current.classes.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current;
      const classes = [...current.classes];
      const [moved] = classes.splice(fromIndex, 1);
      classes.splice(toIndex, 0, moved);
      return { ...current, classes };
    });
  }

  function addStudent(event) {
    event.preventDefault();
    if (!selectedClass) return;
    const name = normalize(studentName);
    if (!name) return;

    updateClass(selectedClass.id, (item) => ({
      ...item,
      students: item.students.some((student) => student.name.toLowerCase() === name.toLowerCase())
        ? item.students
        : [...item.students, { id: crypto.randomUUID(), name, status: "active" }]
    }));
    setStudentName("");
  }

  async function removeClass() {
    if (!selectedClass) return;
    const ok = window.confirm(`Remover "${selectedClass.name}" e todos os alunos dessa turma?`);
    if (!ok) return;
    if (!ADMIN_PASSWORD_HASH) {
      setImportMessage("Senha de administrador não configurada (defina VITE_ADMIN_PASSWORD_HASH no .env). Turma mantida.");
      return;
    }
    const password = window.prompt("Digite a senha de administrador para remover a turma:");
    if (!(await checkAdminPassword(password))) {
      setImportMessage("Senha de administrador incorreta. Turma mantida.");
      return;
    }
    setData((current) => ({
      ...current,
      classes: current.classes.filter((item) => item.id !== selectedClass.id),
      events: current.events.filter((event) => event.classId !== selectedClass.id),
      lessons: current.lessons.filter((lesson) => lesson.classId !== selectedClass.id),
      assessments: current.assessments.filter((assessment) => assessment.classId !== selectedClass.id)
    }));
  }

  async function importStudents(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;

    const rows = [];
    for (const file of files) {
      rows.push(...(await readImportedStudents(file)));
    }
    if (!rows.length) {
      setImportMessage("Não encontrei linhas com nome e turma.");
      return;
    }

    setData((current) => {
      const undoState = {
        type: "students",
        label: "Remover importação",
        description: `Importação de turma/alunos de ${files.map((file) => file.name).join(", ")}`,
        classes: current.classes.map((classItem) => ({
          ...classItem,
          students: classItem.students.map((student) => ({ ...student }))
        }))
      };
      const classes = current.classes.map((classItem) => ({
        ...classItem,
        students: classItem.students.map((student) => ({ ...student }))
      }));
      let added = 0;

      for (const row of rows) {
        let target = classes.find((item) => item.name.toLowerCase() === row.className.toLowerCase());
        if (!target) {
          target = { id: crypto.randomUUID(), name: row.className, gradingMode: "sum", students: [] };
          classes.push(target);
        }

        const existing = target.students.find((student) => student.name.toLowerCase() === row.name.toLowerCase());
        if (existing) {
          if (row.photo && !existing.photo) {
            existing.photo = row.photo;
          }
        } else {
          target.students.push({ id: crypto.randomUUID(), name: row.name, photo: row.photo ?? "", status: "active" });
          added += 1;
        }
      }

      const message = `${added} aluno(s) importado(s) em ${new Set(rows.map((row) => row.className)).size} turma(s).`;
      setImportUndo({ ...undoState, message });
      setImportMessage(message);
      return { ...current, classes };
    });
  }

  async function importGrades(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (selectedPeriod === ANNUAL_PERIOD) {
      setImportMessage("Selecione um trimestre antes de importar notas.");
      return;
    }

    try {
      const blocks = await readImportedGrades(file);
      if (!blocks.length) {
        setImportMessage("Não encontrei notas para importar nesta planilha.");
        return;
      }

      const missingItems = [];
      const nameMatches = [];
      const missingClasses = blocks
        .filter((block) => !data.classes.some((classItem) => normalizeKey(classItem.name) === normalizeKey(block.className)))
        .map((block) => block.className);
      const uniqueMissingClasses = [...new Set(missingClasses)];
      const reviewedNames = new Set();

      for (const block of blocks) {
        const classItem = data.classes.find((item) => normalizeKey(item.name) === normalizeKey(block.className));
        for (const row of block.students) {
          const exactStudent = classItem?.students.some((student) => normalizeKey(student.name) === normalizeKey(row.studentName));
          if (!classItem || !exactStudent) {
            const reviewKey = `${normalizeKey(block.className)}|${normalizeKey(row.studentName)}`;
            if (reviewedNames.has(reviewKey)) continue;
            reviewedNames.add(reviewKey);
            const withGrades = Object.entries(row.grades)
              .filter(([, grade]) => !isMissingGrade(grade))
              .map(([assessmentName, grade]) => `${assessmentName}: ${grade}`);
            const missingGrades = Object.entries(row.grades)
              .filter(([, grade]) => isMissingGrade(grade))
              .map(([assessmentName]) => assessmentName);
            const candidates = classItem ? possibleNameMatches(row.studentName, classItem.students) : [];
            if (candidates.length) {
              nameMatches.push({
                importKey: reviewKey,
                className: block.className,
                studentName: row.studentName,
                withGrades,
                missingGrades,
                candidates,
                selectedStudentId: candidates[0].studentId,
                confirmed: false
              });
              continue;
            }
            missingItems.push({
              importKey: reviewKey,
              className: block.className,
              studentName: row.studentName,
              withGrades,
              missingGrades
            });
          }
        }
      }

      const existingAssessments = [];
      for (const block of blocks) {
        const classItem = data.classes.find((item) => normalizeKey(item.name) === normalizeKey(block.className));
        if (!classItem) continue;
        for (const assessmentName of block.assessments) {
          const exists = data.assessments.some(
            (assessment) =>
              assessment.classId === classItem.id &&
              assessment.periodId === selectedPeriod &&
              normalizeKey(assessment.name) === normalizeKey(assessmentName)
          );
          if (exists) existingAssessments.push(`${block.className} - ${assessmentName}`);
        }
      }
      const updateExistingAssessments = existingAssessments.length
        ? window.confirm(
            `${existingAssessments.length} avaliação(ões) já existem em ${periodLabel(selectedPeriod)}.\n\nDeseja atualizar as notas dessas avaliações com os dados da planilha?`
          )
        : true;

      if (uniqueMissingClasses.length || missingItems.length) {
        setPendingGradeImport({
          blocks,
          fileName: file.name,
          periodId: selectedPeriod,
          updateExistingAssessments,
          missingClasses: uniqueMissingClasses,
          missingItems,
          nameMatches
        });
        return;
      }

      if (nameMatches.length) {
        setPendingGradeImport({
          blocks,
          fileName: file.name,
          periodId: selectedPeriod,
          updateExistingAssessments,
          missingClasses: [],
          missingItems: [],
          nameMatches
        });
        return;
      }

      applyGradeImport({ blocks, fileName: file.name, periodId: selectedPeriod, updateExistingAssessments, createMissingStatus: "active", nameResolutions: {} });
    } catch (error) {
      setImportMessage(`Não foi possível importar as notas: ${error?.message ?? "arquivo inválido"}`);
    }
  }

  async function importAttendance(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const { lessonRecords, summaryRecords } = await readImportedAttendance(file);
      if (!lessonRecords.length && !summaryRecords.length) {
        setImportMessage("Não encontrei registros de frequência nesta planilha.");
        return;
      }
      if (summaryRecords.some((record) => !record.periodId && !record.monthKey) && selectedPeriod === ANNUAL_PERIOD) {
        setImportMessage("Selecione um trimestre antes de importar um relatório geral de faltas.");
        return;
      }

      const allRecords = [
        ...lessonRecords.map((record) => ({ ...record, kind: "lesson" })),
        ...summaryRecords.map((record) => ({ ...record, kind: "summary" }))
      ];
      const missingClasses = [];
      const missingItems = [];
      const nameMatches = [];
      const reviewedNames = new Set();

      for (const record of allRecords) {
        const classItem = data.classes.find((item) => normalizeKey(item.name) === normalizeKey(record.className));
        if (!classItem) {
          missingClasses.push(record.className);
          continue;
        }
        const exactStudent = classItem.students.some((student) => normalizeKey(student.name) === normalizeKey(record.studentName));
        if (exactStudent) continue;
        const reviewKey = `${normalizeKey(record.className)}|${normalizeKey(record.studentName)}`;
        if (reviewedNames.has(reviewKey)) continue;
        reviewedNames.add(reviewKey);
        const candidates = possibleNameMatches(record.studentName, classItem.students);
        const related = allRecords.filter(
          (item) => normalizeKey(item.className) === normalizeKey(record.className) && normalizeKey(item.studentName) === normalizeKey(record.studentName)
        );
        const preview = related.slice(0, 6).map(describeAttendanceImportRecord);
        if (candidates.length) {
          nameMatches.push({
            importKey: reviewKey,
            className: record.className,
            studentName: record.studentName,
            preview,
            candidates,
            selectedStudentId: candidates[0].studentId,
            confirmed: false
          });
        } else {
          missingItems.push({
            importKey: reviewKey,
            className: record.className,
            studentName: record.studentName,
            preview
          });
        }
      }

      const uniqueMissingClasses = [...new Set(missingClasses.filter(Boolean))];
      if (uniqueMissingClasses.length || missingItems.length || nameMatches.length) {
        setPendingAttendanceImport({
          lessonRecords,
          summaryRecords,
          fileName: file.name,
          missingClasses: uniqueMissingClasses,
          missingItems,
          nameMatches
        });
        return;
      }

      applyAttendanceImport({ lessonRecords, summaryRecords, fileName: file.name, nameResolutions: {} });
    } catch (error) {
      setImportMessage(`Não foi possível importar a frequência: ${error?.message ?? "arquivo inválido"}`);
    }
  }

  function describeAttendanceImportRecord(record) {
    if (record.kind === "lesson") {
      return `${record.date}: ${attendanceStatusLabel(record.status)} (${record.periods ?? 1} aula(s))`;
    }
    const label = record.monthKey ? formatMonthKey(record.monthKey) : periodLabel(record.periodId ?? selectedPeriod);
    return `${label}: ${record.absences} falta(s) em ${record.lessonTotal} aula(s)`;
  }

  function attendanceImportResolutions(importState) {
    return Object.fromEntries(
      (importState?.nameMatches ?? [])
        .filter((match) => match.confirmed && match.selectedStudentId)
        .map((match) => [match.importKey, match.selectedStudentId])
    );
  }

  function updateAttendanceImportNameResolution(importKey, selectedStudentId) {
    setPendingAttendanceImport((current) => {
      if (!current) return current;
      return {
        ...current,
        nameMatches: current.nameMatches.map((match) =>
          match.importKey === importKey ? { ...match, selectedStudentId, confirmed: false } : match
        )
      };
    });
  }

  function confirmAttendanceImportName(importKey) {
    setPendingAttendanceImport((current) => {
      if (!current) return current;
      return {
        ...current,
        nameMatches: current.nameMatches.map((match) =>
          match.importKey === importKey ? { ...match, confirmed: true } : match
        )
      };
    });
  }

  function applyAttendanceImport({ lessonRecords, summaryRecords, fileName, nameResolutions = {} }) {
    setData((current) => {
        const undoState = {
          type: "attendance",
          label: "Remover importação",
          description: `Importação de frequência de ${fileName}`,
          lessons: current.lessons,
          attendanceSummaries: current.attendanceSummaries ?? []
        };
        const classes = current.classes.map((classItem) => ({
          ...classItem,
          students: [...classItem.students]
        }));
        const lessons = current.lessons.map((lesson) => ({
          ...lesson,
          attendance: [...(lesson.attendance ?? [])]
        }));
        const attendanceSummaries = [...(current.attendanceSummaries ?? [])];

        let imported = 0;
        let summariesImported = 0;
        let lessonsCreated = 0;
        let skippedClasses = 0;
        let skippedStudents = 0;

        for (const record of lessonRecords) {
          const classItem = classes.find((item) => normalizeKey(item.name) === normalizeKey(record.className));
          if (!classItem) {
            skippedClasses += 1;
            continue;
          }

          const student = classItem.students.find((item) => normalizeKey(item.name) === normalizeKey(record.studentName));
          const resolvedStudent = student ?? classItem.students.find((item) => item.id === nameResolutions[`${normalizeKey(record.className)}|${normalizeKey(record.studentName)}`]);
          if (!resolvedStudent) {
            skippedStudents += 1;
            continue;
          }

          const sameDayLessons = lessons.filter((lesson) => lesson.classId === classItem.id && lesson.date === record.date);
          const normalizedContent = normalizeKey(record.content);
          let lesson = sameDayLessons.find((item) => normalizedContent && normalizeKey(item.content) === normalizedContent);
          if (!lesson && !normalizedContent && sameDayLessons.length === 1) lesson = sameDayLessons[0];

          if (!lesson) {
            lesson = {
              id: crypto.randomUUID(),
              classId: classItem.id,
              className: classItem.name,
              date: record.date,
              periods: Math.max(1, Math.round(numberValue(record.periods, 1))),
              content: record.content || `Importado de ${fileName}`,
              periodId: periodForDate(record.date, current.schoolYear ?? DEFAULT_SCHOOL_YEAR),
              attendance: [],
              createdAt: new Date().toISOString()
            };
            lessons.push(lesson);
            lessonsCreated += 1;
          }

          const existingIndex = lesson.attendance.findIndex((item) => item.studentId === resolvedStudent.id || normalizeKey(item.studentName) === normalizeKey(resolvedStudent.name));
          const importedRecord = {
            studentId: resolvedStudent.id,
            studentName: resolvedStudent.name,
            status: record.status
          };
          if (existingIndex >= 0) lesson.attendance[existingIndex] = importedRecord;
          else lesson.attendance.push(importedRecord);
          imported += 1;
        }

        for (const record of summaryRecords) {
          const classItem = classes.find((item) => normalizeKey(item.name) === normalizeKey(record.className));
          if (!classItem) {
            skippedClasses += 1;
            continue;
          }

          const student = classItem.students.find((item) => normalizeKey(item.name) === normalizeKey(record.studentName));
          const resolvedStudent = student ?? classItem.students.find((item) => item.id === nameResolutions[`${normalizeKey(record.className)}|${normalizeKey(record.studentName)}`]);
          if (!resolvedStudent) {
            skippedStudents += 1;
            continue;
          }

          const periodId = record.periodId ?? (record.monthKey ? periodForDate(`${record.monthKey}-01`, current.schoolYear ?? DEFAULT_SCHOOL_YEAR) : selectedPeriod);
          const existingIndex = attendanceSummaries.findIndex(
            (item) =>
              item.classId === classItem.id &&
              item.studentId === resolvedStudent.id &&
              item.periodId === periodId &&
              (item.monthKey ?? "") === (record.monthKey ?? "") &&
              normalizeKey(item.source) === normalizeKey(fileName)
          );
          const summary = {
            id: existingIndex >= 0 ? attendanceSummaries[existingIndex].id : crypto.randomUUID(),
            classId: classItem.id,
            className: classItem.name,
            studentId: resolvedStudent.id,
            studentName: resolvedStudent.name,
            periodId,
            monthKey: record.monthKey ?? "",
            lessonTotal: Math.max(0, Math.round(numberValue(record.lessonTotal, 0))),
            absences: Math.max(0, Math.round(numberValue(record.absences, 0))),
            excused: Math.max(0, Math.round(numberValue(record.excused, 0))),
            source: fileName,
            createdAt: existingIndex >= 0 ? attendanceSummaries[existingIndex].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          if (existingIndex >= 0) attendanceSummaries[existingIndex] = summary;
          else attendanceSummaries.push(summary);
          summariesImported += 1;
        }

        const ignored = skippedClasses + skippedStudents;
        const monthlySummaryCount = summaryRecords.filter((record) => record.monthKey).length;
        const summaryPeriodLabels = [
          ...new Set(summaryRecords.map((record) => periodLabel(record.periodId ?? (record.monthKey ? periodForDate(`${record.monthKey}-01`, current.schoolYear ?? DEFAULT_SCHOOL_YEAR) : selectedPeriod))))
        ].join(", ");
        const message = `${imported} registro(s) por aula e ${summariesImported} saldo(s) de frequência importado(s). ${lessonsCreated} aula(s) criada(s).${monthlySummaryCount ? ` ${monthlySummaryCount} saldo(s) mensal(is) distribuído(s) por mês/trimestre.` : summaryRecords.length ? ` Saldos gerais aplicados em ${summaryPeriodLabels || periodLabel(selectedPeriod)}.` : ""}${ignored ? ` ${ignored} linha(s) ignorada(s): ${skippedClasses} sem turma e ${skippedStudents} sem aluno.` : ""}`;
        setImportUndo({ ...undoState, message });
        setImportMessage(message);
        setPendingAttendanceImport(null);
        return { ...current, classes, lessons, attendanceSummaries };
      });
  }

  function removeLastImport() {
    if (!importUndo) return;
    const ok = window.confirm(`Remover a última importação?\n\n${importUndo.description}\n\nIsso desfaz apenas os dados alterados por essa importação.`);
    if (!ok) return;
    if (importUndo.type === "attendance") {
      setData((current) => ({
        ...current,
        lessons: importUndo.lessons,
        attendanceSummaries: importUndo.attendanceSummaries
      }));
      setImportMessage("Importação de frequência removida. As chamadas e saldos anteriores foram restaurados.");
      setImportUndo(null);
    }
    if (importUndo.type === "grades") {
      setData((current) => ({
        ...current,
        classes: importUndo.classes,
        assessments: importUndo.assessments
      }));
      setPendingGradeImport(null);
      setImportMessage("Importação de notas removida. Avaliações, notas e alunos criados por essa importação foram restaurados ao estado anterior.");
      setImportUndo(null);
    }
    if (importUndo.type === "students") {
      setData((current) => ({
        ...current,
        classes: importUndo.classes
      }));
      setImportMessage("Importação de alunos removida. As turmas e alunos voltaram ao estado anterior.");
      setImportUndo(null);
    }
  }

  function updateImportNameResolution(importKey, selectedStudentId) {
    setPendingGradeImport((current) => {
      if (!current) return current;
      return {
        ...current,
        nameMatches: current.nameMatches.map((match) =>
          match.importKey === importKey ? { ...match, selectedStudentId, confirmed: false } : match
        )
      };
    });
  }

  function confirmImportName(importKey) {
    setPendingGradeImport((current) => {
      if (!current) return current;
      return {
        ...current,
        nameMatches: current.nameMatches.map((match) =>
          match.importKey === importKey ? { ...match, confirmed: true } : match
        )
      };
    });
  }

  function gradeImportResolutions(importState) {
    return Object.fromEntries(
      (importState?.nameMatches ?? [])
        .filter((match) => match.confirmed && match.selectedStudentId)
        .map((match) => [match.importKey, match.selectedStudentId])
    );
  }

  function applyGradeImport({ blocks, fileName, periodId, updateExistingAssessments, createMissingStatus, nameResolutions = {} }) {
    setData((current) => {
      const undoState = {
        type: "grades",
        label: "Remover importação",
        description: `Importação de notas de ${fileName}`,
        classes: current.classes.map((classItem) => ({
          ...classItem,
          students: classItem.students.map((student) => ({ ...student }))
        })),
        assessments: current.assessments.map((assessment) => ({
          ...assessment,
          grades: { ...(assessment.grades ?? {}) },
          makeupGrades: { ...(assessment.makeupGrades ?? {}) }
        }))
      };
      const classes = current.classes.map((classItem) => ({
        ...classItem,
        students: classItem.students.map((student) => ({ ...student }))
      }));
      const assessments = current.assessments.map((assessment) => ({
        ...assessment,
        grades: { ...(assessment.grades ?? {}) },
        makeupGrades: { ...(assessment.makeupGrades ?? {}) }
      }));
      let studentsCreated = 0;
      let assessmentsCreated = 0;
      let gradesImported = 0;
      const skippedClasses = new Set();

      for (const block of blocks) {
        let classItem = classes.find((item) => normalizeKey(item.name) === normalizeKey(block.className));
        if (!classItem) {
          skippedClasses.add(block.className);
          continue;
        }

        const assessmentByName = new Map();
        for (const assessmentName of block.assessments) {
          let assessment = assessments.find(
            (item) =>
              item.classId === classItem.id &&
              item.periodId === periodId &&
              normalizeKey(item.name) === normalizeKey(assessmentName)
          );
          if (assessment && !updateExistingAssessments) continue;
          if (!assessment) {
            assessment = {
              id: crypto.randomUUID(),
              classId: classItem.id,
              className: classItem.name,
              name: assessmentName,
              description: `Importado de ${fileName}`,
              maxScore: 10,
              weight: 1,
              calculationType: "average",
              kind: "formal",
              allowsMakeup: true,
              periodId,
              createdAt: new Date().toISOString(),
              grades: {},
              makeupGrades: {}
            };
            assessments.push(assessment);
            assessmentsCreated += 1;
          }
          assessmentByName.set(assessmentName, assessment);
        }

        for (const row of block.students) {
          const importKey = `${normalizeKey(block.className)}|${normalizeKey(row.studentName)}`;
          let student = classItem.students.find((item) => normalizeKey(item.name) === normalizeKey(row.studentName));
          if (!student && nameResolutions[importKey]) {
            student = classItem.students.find((item) => item.id === nameResolutions[importKey]);
          }
          if (!student) {
            if (!createMissingStatus) continue;
            student = { id: crypto.randomUUID(), name: row.studentName, status: createMissingStatus };
            classItem.students.push(student);
            studentsCreated += 1;
          }

          for (const [assessmentName, grade] of Object.entries(row.grades)) {
            const assessment = assessmentByName.get(assessmentName);
            if (!assessment) continue;
            assessment.grades[student.id] = grade;
            gradesImported += 1;
          }
        }
      }

      setPendingGradeImport(null);
      const message = `${gradesImported} nota(s) importada(s) para ${periodLabel(periodId)}. ${assessmentsCreated} avaliação(ões) criada(s), ${studentsCreated} aluno(s) novo(s). Células vazias foram marcadas como sem nota.${skippedClasses.size ? ` Turma(s) ignorada(s) por não existirem no diário: ${[...skippedClasses].join(", ")}.` : ""}`;
      setImportUndo({ ...undoState, message });
      setImportMessage(message);
      return { ...current, classes, assessments };
    });
  }

  async function buildBackupPayload(includeHistory = false) {
    const currentSnapshot = await attachSnapshotIntegrity(createSyncSnapshot({
      data,
      teacherName,
      subjectName,
      gradeDecimals,
      deviceId,
      deviceLabel: syncDeviceLabel(),
      reason: "Backup"
    }));
    const syncHistory = includeHistory
      ? await Promise.all(saveSyncHistory([currentSnapshot, ...loadSyncHistory()]).map(attachSnapshotIntegrity))
      : [];
    if (includeHistory) saveSyncHistory(syncHistory);
    return {
      type: "checkout-turmas-sync",
      syncSchemaVersion: SYNC_SCHEMA_VERSION,
      appVersion: "1.0.0",
      snapshotId: currentSnapshot.id,
      exportedAt: currentSnapshot.createdAt,
      sourceDeviceId: deviceId,
      sourceDevice: syncDeviceLabel(),
      teacherName,
      subjectName,
      settings: {
        teacherName,
        subjectName,
        gradeDecimals
      },
      integrity: currentSnapshot.integrity,
      data: currentSnapshot.data,
      syncHistory
    };
  }


  function applySyncReview() {
    if (!syncReview) return;
    const selectedSnapshot = syncReview.snapshots.find((snapshot) => snapshot.id === selectedSyncSnapshotId) ?? syncReview.snapshots[0];
    if (!selectedSnapshot) {
      setImportMessage("Escolha uma versão antes de continuar.");
      return;
    }
    const validation = validateBackupData(selectedSnapshot.data);
    if (!validation.valid || selectedSnapshot.integrityStatus === "invalid") {
      setImportMessage("Esta versão falhou na verificação de segurança e não foi aplicada.");
      return;
    }
    if (syncReview.mode === "restore" && restoreWouldRemoveData(data, selectedSnapshot.data)) {
      const confirmation = window.prompt(
        "Atenção: esta restauração reduzirá a quantidade de dados deste aparelho. Para confirmar, digite RESTAURAR.",
        ""
      );
      if (confirmation !== "RESTAURAR") {
        setImportMessage("Restauração cancelada. Os dados atuais foram preservados.");
        return;
      }
    }

    const incomingSettings = {
      ...(syncReview.incomingSettings ?? {}),
      teacherName: selectedSnapshot.teacherName || syncReview.incomingSettings?.teacherName,
      subjectName: selectedSnapshot.subjectName || syncReview.incomingSettings?.subjectName,
      gradeDecimals: selectedSnapshot.gradeDecimals ?? syncReview.incomingSettings?.gradeDecimals
    };
    const localSafetySnapshot = createSyncSnapshot({
      data,
      teacherName,
      subjectName,
      gradeDecimals,
      deviceId,
      reason: syncReview.mode === "merge" ? "Antes de atualizar" : "Antes de restaurar"
    });
    saveSyncHistory([localSafetySnapshot, ...syncReview.snapshots, ...loadSyncHistory()]);

    if (syncReview.mode === "merge") {
      const result = mergeBackupData(data, selectedSnapshot.data);
      setData(result.data);
      if (!teacherName && incomingSettings.teacherName) {
        setTeacherName(incomingSettings.teacherName);
        setTeacherDraft(incomingSettings.teacherName);
      }
      if (!subjectName && incomingSettings.subjectName) {
        setSubjectName(incomingSettings.subjectName);
      }
      if ([0, 1, 2].includes(Number(incomingSettings.gradeDecimals))) {
        setGradeDecimals(Number(incomingSettings.gradeDecimals));
      }
      setSelectedClassId(result.data.classes[0]?.id ?? "");
      const addedTotal =
        result.summary.classesAdded +
        result.summary.studentsAdded +
        result.summary.lessonsAdded +
        result.summary.assessmentsAdded +
        (result.summary.recoveriesAdded ?? 0) +
        (result.summary.attendanceRecordsMerged ?? 0) +
        (result.summary.gradeValuesMerged ?? 0);
      setSyncReview(null);
      setImportMessage(
        addedTotal
          ? `Dados atualizados com "${selectedSnapshot.label}". Novos itens: ${result.summary.classesAdded} turma(s), ${result.summary.studentsAdded} aluno(s), ${result.summary.lessonsAdded} aula(s), ${result.summary.assessmentsAdded} avaliação(ões), ${result.summary.recoveriesAdded ?? 0} recuperação(ões), ${result.summary.attendanceRecordsMerged ?? 0} registro(s) de chamada e ${result.summary.gradeValuesMerged ?? 0} nota(s).${result.summary.gradeConflicts ? ` Atenção: ${result.summary.gradeConflicts} conflito(s) de nota foram mantidos com o valor deste aparelho.` : ""}`
          : `Dados atualizados com "${selectedSnapshot.label}". Nenhum dado novo foi encontrado.${result.summary.gradeConflicts ? ` Atenção: ${result.summary.gradeConflicts} conflito(s) de nota foram mantidos com o valor deste aparelho.` : ""}`
      );
      return;
    }

    const restoreData = migrateData(selectedSnapshot.data);
    setData(restoreData);
    if (incomingSettings.teacherName) {
      setTeacherName(incomingSettings.teacherName);
      setTeacherDraft(incomingSettings.teacherName);
    }
    if (incomingSettings.subjectName) {
      setSubjectName(incomingSettings.subjectName);
    }
    if ([0, 1, 2].includes(Number(incomingSettings.gradeDecimals))) {
      setGradeDecimals(Number(incomingSettings.gradeDecimals));
    }
    setSelectedClassId(restoreData.classes[0]?.id ?? "");
    setSyncReview(null);
    setImportMessage(`Backup restaurado: ${selectedSnapshot.label}. Uma cópia de segurança anterior foi guardada no histórico local.`);
  }

  async function importBackup(event, mode = "restore") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const backupData = migrateData(payload.data ?? payload);
      const incomingSettings = payload.settings ?? payload;
      const localSafetySnapshot = createSyncSnapshot({
        data,
        teacherName,
        subjectName,
        gradeDecimals,
        deviceId,
        reason: mode === "merge" ? "Antes de sincronizar" : "Antes de restaurar"
      });
      const incomingSnapshots = snapshotsFromPayload(payload);
      if (mode === "merge") {
        const ok = window.confirm("Sincronizar este arquivo com os dados atuais? O app vai juntar turmas, alunos, aulas, avaliações e notas sem apagar o que já existe neste aparelho.");
        if (!ok) return;
        saveSyncHistory([localSafetySnapshot, ...incomingSnapshots, ...loadSyncHistory()]);
        const result = mergeBackupData(data, backupData);
        setData(result.data);
        if (!teacherName && incomingSettings.teacherName) {
          setTeacherName(incomingSettings.teacherName);
          setTeacherDraft(incomingSettings.teacherName);
        }
        if (!subjectName && incomingSettings.subjectName) {
          setSubjectName(incomingSettings.subjectName);
        }
        if ([0, 1, 2].includes(Number(incomingSettings.gradeDecimals))) {
          setGradeDecimals(Number(incomingSettings.gradeDecimals));
        }
        setSelectedClassId(result.data.classes[0]?.id ?? "");
        const addedTotal =
          result.summary.classesAdded +
          result.summary.studentsAdded +
          result.summary.lessonsAdded +
          result.summary.assessmentsAdded +
          (result.summary.recoveriesAdded ?? 0) +
          (result.summary.attendanceRecordsMerged ?? 0) +
          (result.summary.gradeValuesMerged ?? 0);
        setImportMessage(
          addedTotal
            ? `Sincronização concluída. Novos itens: ${result.summary.classesAdded} turma(s), ${result.summary.studentsAdded} aluno(s), ${result.summary.lessonsAdded} aula(s), ${result.summary.assessmentsAdded} avaliação(ões), ${result.summary.recoveriesAdded ?? 0} recuperação(ões), ${result.summary.attendanceRecordsMerged ?? 0} registro(s) de chamada e ${result.summary.gradeValuesMerged ?? 0} nota(s). Histórico preservado com até ${SYNC_HISTORY_LIMIT} versões.${result.summary.gradeConflicts ? ` Atenção: ${result.summary.gradeConflicts} conflito(s) de nota foram mantidos com o valor deste aparelho.` : ""}`
            : `Sincronização concluída. Nenhum dado novo foi encontrado nesse arquivo. Histórico preservado com até ${SYNC_HISTORY_LIMIT} versões.${result.summary.gradeConflicts ? ` Atenção: ${result.summary.gradeConflicts} conflito(s) de nota foram mantidos com o valor deste aparelho.` : ""}`
        );
        return;
      }

      let restoreSnapshot = incomingSnapshots[0] ?? snapshotFromPayload(payload);
      if (incomingSnapshots.length > 1) {
        const options = incomingSnapshots.map((snapshot, index) => `${index + 1}. ${snapshot.label}`).join("\n");
        const choice = window.prompt(`Este arquivo tem ${incomingSnapshots.length} versões salvas.\nEscolha qual deseja restaurar:\n\n${options}`, "1");
        if (choice === null) return;
        const selectedIndex = Number(choice) - 1;
        if (!incomingSnapshots[selectedIndex]) {
          setImportMessage("Restauração cancelada: opção inválida.");
          return;
        }
        restoreSnapshot = incomingSnapshots[selectedIndex];
      }

      const ok = window.confirm(`Restaurar "${restoreSnapshot?.label ?? "arquivo escolhido"}"? Isso substitui os dados atuais deste aparelho. Use apenas se quiser voltar exatamente à versão escolhida.`);
      if (!ok) return;
      saveSyncHistory([localSafetySnapshot, ...incomingSnapshots, ...loadSyncHistory()]);
      const restoreData = migrateData(restoreSnapshot?.data ?? backupData);
      setData(restoreData);
      if (restoreSnapshot?.teacherName || incomingSettings.teacherName) {
        setTeacherName(restoreSnapshot?.teacherName || incomingSettings.teacherName);
        setTeacherDraft(restoreSnapshot?.teacherName || incomingSettings.teacherName);
      }
      if (restoreSnapshot?.subjectName || incomingSettings.subjectName) {
        setSubjectName(restoreSnapshot?.subjectName || incomingSettings.subjectName);
      }
      const restoredDecimals = Number(restoreSnapshot?.gradeDecimals ?? incomingSettings.gradeDecimals);
      if ([0, 1, 2].includes(restoredDecimals)) {
        setGradeDecimals(restoredDecimals);
      }
      setSelectedClassId(restoreData.classes[0]?.id ?? "");
      setImportMessage(`Backup restaurado neste aparelho: ${restoreSnapshot?.label ?? "arquivo escolhido"}. Uma cópia de segurança anterior foi guardada no histórico local.`);
    } catch (error) {
      setImportMessage(`Não foi possível importar o backup: ${error?.message ?? "arquivo inválido"}`);
    }
  }

  function saveLesson(event) {
    event.preventDefault();
    if (!selectedClass || !lessonDate) return;
    const periods = Math.max(1, Math.round(numberValue(lessonPeriodsCount, 1)));

    const lesson = {
      id: editingLessonId || crypto.randomUUID(),
      classId: selectedClass.id,
      className: selectedClass.name,
      date: lessonDate,
      periodId: periodForDate(lessonDate, schoolYear),
      periods,
      content: normalize(lessonContent) || "Aula registrada",
      attendance: selectedActiveStudents.map((student) => ({
        studentId: student.id,
        studentName: student.name,
        status: attendance[student.id] ?? ATTENDANCE_NOT_TAKEN
      })),
      createdAt: new Date().toISOString()
    };

    setData((current) => ({
      ...current,
      lessons: editingLessonId
        ? current.lessons.map((item) =>
            item.id === editingLessonId ? { ...lesson, createdAt: item.createdAt, updatedAt: new Date().toISOString() } : item
          )
        : [lesson, ...current.lessons]
    }));
    setLessonContent("");
    setLessonPeriodsCount("1");
    setEditingLessonId("");
    setIsAttendanceOpen(false);
    setLessonStatusMessage(editingLessonId ? "Correção salva. Tarefa concluída." : "Aula salva. Tarefa concluída.");
  }

  function startLessonAttendance() {
    if (!selectedClass || !lessonDate) return;
    setLessonStatusMessage("");
    setIsAttendanceOpen(true);
    setAttendance(Object.fromEntries(selectedActiveStudents.map((student) => [student.id, attendance[student.id] ?? ATTENDANCE_NOT_TAKEN])));
  }

  function removeLesson(lessonId) {
    setData((current) => ({ ...current, lessons: current.lessons.filter((lesson) => lesson.id !== lessonId) }));
    if (editingLessonId === lessonId) {
      setEditingLessonId("");
      setLessonContent("");
      setLessonDate(today());
      setIsAttendanceOpen(false);
    }
  }

  function editLesson(lesson) {
    const lessonAttendance = Object.fromEntries(lesson.attendance.map((record) => [record.studentId, record.status]));
    const fallbackByName = Object.fromEntries(lesson.attendance.map((record) => [record.studentName, record.status]));

    setSelectedClassId(lesson.classId);
    setView("diary");
    setEditingLessonId(lesson.id);
    setIsAttendanceOpen(true);
    setLessonStatusMessage("");
    setLessonDate(lesson.date);
    setLessonPeriodsCount(String(lessonPeriods(lesson)));
    setLessonContent(lesson.content);
    setAttendance(
      Object.fromEntries(
        (selectedClass?.id === lesson.classId ? selectedClass.students : data.classes.find((item) => item.id === lesson.classId)?.students ?? [])
          .filter(isActiveStudent)
          .map((student) => [student.id, lessonAttendance[student.id] ?? fallbackByName[student.name] ?? ATTENDANCE_NOT_TAKEN])
      )
    );
  }

  function cancelLessonEdit() {
    setEditingLessonId("");
    setLessonContent("");
    setLessonPeriodsCount("1");
    setLessonDate(today());
    setIsAttendanceOpen(false);
    setLessonStatusMessage("");
    if (selectedClass) {
      setAttendance(Object.fromEntries(selectedActiveStudents.map((student) => [student.id, ATTENDANCE_NOT_TAKEN])));
    }
  }

  function addAssessment(event) {
    event.preventDefault();
    if (!selectedClass) return;
    if (!assessmentKind) {
      setImportMessage("Escolha o tipo de lançamento antes de preencher a avaliação.");
      return;
    }
    const name = normalize(assessmentName);
    const maxScore = numberValue(assessmentMax, 10);
    const weight = numberValue(assessmentWeight, 1);
    if (!name || maxScore <= 0 || weight <= 0) return;

    const action = event.nativeEvent.submitter?.value ?? "launch";
    const assessmentId = editingAssessmentId || crypto.randomUUID();
    const assessment = {
      id: assessmentId,
      classId: selectedClass.id,
      className: selectedClass.name,
      name,
      description: normalize(assessmentDescription),
      maxScore,
      weight,
      calculationType: assessmentType,
      kind: assessmentKind,
      allowsMakeup: assessmentKind === "formal",
      periodId: selectedPeriod === ANNUAL_PERIOD ? periodForDate(today(), schoolYear) : selectedPeriod,
      createdAt: new Date().toISOString()
    };

    setData((current) => ({
      ...current,
      assessments: editingAssessmentId
        ? current.assessments.map((item) =>
            item.id === editingAssessmentId
              ? { ...item, ...assessment, grades: item.grades ?? {}, makeupGrades: item.makeupGrades ?? {}, createdAt: item.createdAt, updatedAt: new Date().toISOString() }
              : item
          )
        : [...current.assessments, { ...assessment, grades: {}, makeupGrades: {} }]
    }));
    setAssessmentName("");
    setAssessmentDescription("");
    setAssessmentMax("10");
    setAssessmentWeight("1");
    setAssessmentType("average");
    setAssessmentKind("");
    setEditingAssessmentId("");
    setImportMessage(
      editingAssessmentId
        ? "Avaliação atualizada."
        : action === "later"
          ? "Avaliação criada para lançar notas depois."
          : "Avaliação criada. Lance as notas na tabela."
    );
    if (action === "launch") {
      setActiveAssessmentId(assessmentId);
      setPendingFocusAssessmentId(assessmentId);
    } else {
      setActiveAssessmentId("");
    }
  }

  function editAssessment(assessment) {
    setAssessmentName(assessment.name);
    setAssessmentDescription(assessment.description ?? "");
    setAssessmentMax(String(assessment.maxScore ?? 10));
    setAssessmentWeight(String(assessment.weight ?? 1));
    setAssessmentType(assessment.calculationType ?? "sum");
    setAssessmentKind(assessmentKindFromData(assessment));
    setEditingAssessmentId(assessment.id);
    setImportMessage("Editando avaliação. Ajuste os campos e salve.");
  }

  function cancelAssessmentEdit() {
    setAssessmentName("");
    setAssessmentDescription("");
    setAssessmentMax("10");
    setAssessmentWeight("1");
    setAssessmentType("average");
    setAssessmentKind("");
    setEditingAssessmentId("");
  }

  function removeAssessment(assessmentId) {
    setData((current) => ({
      ...current,
      assessments: current.assessments.filter((assessment) => assessment.id !== assessmentId)
    }));
    if (activeAssessmentId === assessmentId) {
      setActiveAssessmentId("");
    }
  }

  function updateGrade(assessmentId, studentId, value) {
    setData((current) => ({
      ...current,
      assessments: current.assessments.map((assessment) =>
        assessment.id === assessmentId
          ? { ...assessment, grades: { ...assessment.grades, [studentId]: value } }
          : assessment
      )
    }));
  }

  function updateMakeupDraft(assessmentId, studentId, value) {
    setMakeupDrafts((current) => ({
      ...current,
      [`${assessmentId}:${studentId}`]: value
    }));
  }

  function saveMakeupGrades(event) {
    event.preventDefault();
    const visibleKeys = new Set(makeupGroups.flatMap(({ assessment, students }) => students.map((student) => `${assessment.id}:${student.id}`)));
    const entries = Object.entries(makeupDrafts)
      .filter(([key]) => visibleKeys.has(key))
      .map(([key, value]) => {
        const [assessmentId, studentId] = key.split(":");
        return { assessmentId, studentId, value: normalize(value) };
      })
      .filter((entry) => entry.value !== "");

    if (!entries.length) {
      setImportMessage("Digite pelo menos uma nota de segunda chamada antes de salvar.");
      return;
    }

    setData((current) => ({
      ...current,
      assessments: current.assessments.map((assessment) => {
        const assessmentEntries = entries.filter((entry) => entry.assessmentId === assessment.id);
        if (!assessmentEntries.length) return assessment;
        return {
          ...assessment,
          makeupGrades: {
            ...(assessment.makeupGrades ?? {}),
            ...Object.fromEntries(assessmentEntries.map((entry) => [entry.studentId, entry.value]))
          },
          updatedAt: new Date().toISOString()
        };
      })
    }));
    setMakeupDrafts({});
    setIncludeOtherClassesInMakeup(false);
    setAssessmentKind("");
    setImportMessage(`${entries.length} nota(s) de segunda chamada salva(s).`);
  }

  function cancelMakeupEntry() {
    setMakeupDrafts({});
    setIncludeOtherClassesInMakeup(false);
    setAssessmentKind("");
  }

  function launchFirstTermRecovery() {
    if (!selectedClass) {
      setImportMessage("Selecione uma turma antes de lançar recuperação.");
      return;
    }

    if (!firstTermClosed) {
      setImportMessage(`A recuperação do 1º trimestre fica disponível após ${formatShortDate(firstTermEnd)}.`);
      return;
    }

    setSelectedPeriod("t1");
    setView("assessments");
    setEditingAssessmentId(null);
    setActiveAssessmentId("");
    setAssessmentKind("");
    setMakeupDrafts({});
    setRecoveryDrafts({});
    setIncludeOtherClassesInRecovery(false);

    if (!firstTermRecoveryCount) {
      setImportMessage("Não há alunos abaixo da média no 1º trimestre desta turma.");
      return;
    }

    setAssessmentKind("recovery");
    setImportMessage(`Recuperação do 1º trimestre pronta para lançamento: ${firstTermRecoveryCount} aluno(s).`);
  }

  function updateRecoveryDraft(classId, studentId, value) {
    setRecoveryDrafts((current) => ({ ...current, [`${classId}:${studentId}`]: value }));
  }

  function saveRecoveryGrades(event) {
    event.preventDefault();
    if (selectedPeriod === ANNUAL_PERIOD) return;
    const visibleKeys = new Set(recoveryStudents.map(({ classItem, student }) => `${classItem.id}:${student.id}`));
    const entries = Object.entries(recoveryDrafts)
      .filter(([key]) => visibleKeys.has(key))
      .map(([key, value]) => {
        const [classId, studentId] = key.includes(":") ? key.split(":") : [selectedClassId, key];
        return { classId, studentId, value: normalize(value) };
      })
      .filter((entry) => entry.value !== "");

    if (!entries.length) {
      setImportMessage("Digite pelo menos uma nota de recuperação antes de salvar.");
      return;
    }

    setData((current) => {
      let recoveries = [...(current.recoveries ?? [])];
      const entriesByClass = new Map();
      for (const entry of entries) {
        if (!entriesByClass.has(entry.classId)) entriesByClass.set(entry.classId, []);
        entriesByClass.get(entry.classId).push(entry);
      }

      for (const [classId, classEntries] of entriesByClass.entries()) {
        const classItem = current.classes.find((item) => item.id === classId);
        if (!classItem) continue;
        const recovery = recoveries.find((item) => item.classId === classId && item.periodId === selectedPeriod);
        const recoveryRecord = {
          id: recovery?.id || crypto.randomUUID(),
          classId,
          className: classItem.name,
          periodId: selectedPeriod,
          grades: {
            ...(recovery?.grades ?? {}),
            ...Object.fromEntries(classEntries.map((entry) => [entry.studentId, entry.value]))
          },
          createdAt: recovery?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        recoveries = recovery
          ? recoveries.map((item) => (item.id === recovery.id ? recoveryRecord : item))
          : [...recoveries, recoveryRecord];
      }

      return { ...current, recoveries };
    });
    setRecoveryDrafts({});
    setIncludeOtherClassesInRecovery(false);
    setAssessmentKind("");
    setImportMessage(`${entries.length} nota(s) de recuperação salva(s).`);
  }

  function cancelRecoveryEntry() {
    setRecoveryDrafts({});
    setIncludeOtherClassesInRecovery(false);
    setAssessmentKind("");
  }

  function focusAssessmentColumn(assessmentId) {
    setActiveAssessmentId(assessmentId);
    setPendingFocusAssessmentId(assessmentId);
  }

  function focusActiveAssessmentColumn(assessmentId) {
    const input = document.querySelector(`[data-assessment-id="${assessmentId}"][data-grade-input]`);
    input?.focus();
    input?.select();
  }

  function moveToNextGrade(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const inputs = [...document.querySelectorAll("[data-grade-input]")].filter((input) => !input.disabled);
    const currentIndex = inputs.indexOf(event.currentTarget);
    const nextInput = inputs[currentIndex + 1];
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    }
  }

  function handleGradeKeyDown(event, assessmentId, studentId) {
    if (event.key.toLowerCase() === "j") {
      event.preventDefault();
      updateGrade(assessmentId, studentId, "missing");
      window.setTimeout(() => {
        const inputs = [...document.querySelectorAll("[data-grade-input]")].filter((input) => !input.disabled);
        const currentIndex = inputs.indexOf(event.currentTarget);
        const nextInput = inputs[currentIndex + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 0);
      return;
    }

    moveToNextGrade(event);
  }

  function finishGradeEntry() {
    if (!activeAssessment || !selectedClass) return;

    setData((current) => ({
      ...current,
      assessments: current.assessments.map((assessment) => {
        if (assessment.id !== activeAssessment.id) return assessment;

        const grades = { ...assessment.grades };
        for (const student of selectedActiveStudents) {
          if (isMissingGrade(grades[student.id])) continue;
          if (!normalize(grades[student.id])) {
            grades[student.id] = "0";
          }
        }

        return { ...assessment, grades, updatedAt: new Date().toISOString() };
      })
    }));

    document.activeElement?.blur();
    setActiveAssessmentId("");
    setImportMessage(`Lançamento de "${activeAssessment.name}" finalizado e salvo neste aparelho.`);
  }

  async function exportXlsx(exportPeriod = ANNUAL_PERIOD) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const dateFormatter = new Intl.DateTimeFormat("pt-BR");
    const usedSheetNames = new Set();
    const isAnnualExport = exportPeriod === ANNUAL_PERIOD;
    const exportLabel = periodLabel(exportPeriod);
    const closedAnnual = isAnnualClosed(schoolYear);

    function appendSheet(rows, name, widths) {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      if (widths?.length) {
        setSheetWidths(sheet, widths);
      }
      sheet["!margins"] = { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };

      const baseName = sheetSafeName(name);
      let sheetName = baseName;
      let index = 2;
      while (usedSheetNames.has(sheetName)) {
        const suffix = ` ${index}`;
        sheetName = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
        index += 1;
      }
      usedSheetNames.add(sheetName);
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    }

    const resumoRows = [
      ["Escola", SCHOOL_NAME],
      ["Professor", teacherName || ""],
      ["Disciplina", subjectName || ""],
      ["Período", exportLabel],
      ["Gerado em", dateFormatter.format(new Date())],
      [],
      ["Turma", "Alunos ativos", "Alunos inativos", "Aulas dadas", "Avaliações", "Aprovados", "Recuperação", "Com pendências", "Faltas totais"]
    ];
    for (const classItem of data.classes) {
      const allAssessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
      const activeStudents = classItem.students.filter(isActiveStudent);
      const inactiveStudents = classItem.students.filter((student) => !isActiveStudent(student));
      const lessons = data.lessons.filter((lesson) => lesson.classId === classItem.id && (isAnnualExport || lesson.periodId === exportPeriod));
      const assessments = allAssessments.filter((assessment) => isAnnualExport || assessment.periodId === exportPeriod);
      const lessonTotal = totalLessonPeriods(lessons) + classImportedLessonPeriods(data.attendanceSummaries, classItem.id, isAnnualExport ? ANNUAL_PERIOD : exportPeriod);
      const absences = lessons.reduce(
        (total, lesson) => total + lesson.attendance.filter((record) => record.status === "absent").length * lessonPeriods(lesson),
        0
      );
      const approved = isAnnualExport && !closedAnnual
        ? 0
        : activeStudents.filter((student) =>
            (isAnnualExport
              ? calculateAnnualGradeWithRecovery(student.id, allAssessments, data.recoveries ?? [], classItem.id)
              : applyRecoveryGrade(calculateFinalGrade(student.id, assessments), recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id))) >= 6
          ).length;
      const recovery = isAnnualExport && !closedAnnual ? 0 : activeStudents.length - approved;
      const withPending = activeStudents.filter((student) =>
        assessments.some((assessment) => isPendingGrade(assessment, student.id))
      ).length;
      resumoRows.push([classItem.name, activeStudents.length, inactiveStudents.length, lessonTotal, assessments.length, approved, recovery, withPending, absences]);
    }
    appendSheet(resumoRows, "Resumo", [18, 14, 14, 14, 14, 12, 14, 16, 14]);

    const recuperacaoRows = [["Turma", "Aluno", "Nota final", "Faltas", "% faltas", "Pendências"]];
    const segundaChamadaRows = [["Turma", "Aluno", "Avaliação formal", "Situação", "Descrição", "Tipo", "Nota máxima", "Peso"]];
    const frequenciaMensalRows = [["Turma", "Aluno", "Mês", "Aulas dadas", "Faltas", "% faltas"]];
    const frequenciaTrimestralRows = [["Turma", "Aluno", "Trimestre", "Aulas dadas", "Faltas", "% faltas"]];

    for (const classItem of data.classes) {
      const allAssessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
      const allClassLessons = data.lessons.filter((lesson) => lesson.classId === classItem.id);
      const lessons = data.lessons.filter((lesson) => lesson.classId === classItem.id && (isAnnualExport || lesson.periodId === exportPeriod));
      const assessments = allAssessments.filter((assessment) => isAnnualExport || assessment.periodId === exportPeriod);
      const notesRows = [
        [`Turma ${classItem.name}`],
        ["Aluno", "Status", ...assessments.map((assessment) => `${assessment.name} (${assessmentTypeLabel(assessment.calculationType)})`), "Nota final", "Situação"]
      ];
      const councilRows = [
        [`Conselho de classe - Turma ${classItem.name}`],
        [
          "Aluno",
          "Status",
          ...(isAnnualExport ? ["Média 1º tri", "Recup. 1º tri", "Média 2º tri", "Recup. 2º tri", "Média 3º tri", "Recup. 3º tri", "Média anual"] : ["Média do período", "Recuperação"]),
          "Situação",
          "Aulas",
          "Faltas",
          "% faltas",
          "Pendências",
          "Segunda chamada pendente",
          ...assessments.map((assessment) => `${periodLabel(assessment.periodId)} - ${assessment.name}`)
        ]
      ];
      const frequencyRows = [["Aluno", "Status", "Aulas dadas", "Faltas", "% faltas"]];
      const consolidatedRows = [
        [`Consolidado anual - ${classItem.name}`],
        [
          "Aluno",
          "1º trimestre",
          "Faltas 1º tri",
          "% faltas 1º tri",
          "2º trimestre",
          "Faltas 2º tri",
          "% faltas 2º tri",
          "3º trimestre",
          "Faltas 3º tri",
          "% faltas 3º tri",
          "Média anual",
          "Situação anual",
          "Faltas anuais",
          "% faltas anual"
        ]
      ];
      const monthKeys = [
        ...new Set([
          ...lessons.map((lesson) => lesson.date.slice(0, 7)),
          ...(data.attendanceSummaries ?? [])
            .filter((summary) => summary.classId === classItem.id && (isAnnualExport || summary.periodId === exportPeriod))
            .map((summary) => summary.monthKey)
            .filter(Boolean)
        ])
      ].sort();
      const periodsToExport = isAnnualExport ? PERIODS : PERIODS.filter((period) => period.id === exportPeriod);

      for (const student of classItem.students) {
        const lessonTotal = studentAttendanceTotal(lessons, data.attendanceSummaries, classItem.id, student, isAnnualExport ? ANNUAL_PERIOD : exportPeriod);
        const absences = studentAbsenceTotal(lessons, data.attendanceSummaries, classItem.id, student, isAnnualExport ? ANNUAL_PERIOD : exportPeriod);
        const absencePercent = lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%";
        const missingAssessments = assessments.filter((assessment) => isPendingGrade(assessment, student.id));
        const pendingMakeupAssessments = missingAssessments.filter(assessmentAllowsMakeup);
        const baseFinalGrade = calculateFinalGrade(student.id, assessments);
        const finalGrade = isAnnualExport
          ? (closedAnnual ? calculateAnnualGradeWithRecovery(student.id, allAssessments, data.recoveries ?? [], classItem.id) : null)
          : applyRecoveryGrade(baseFinalGrade, recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id));
        const assessmentGradeCells = assessments.map((assessment) => assessmentDisplayValue(assessment, student.id));
        const periodGradeCells = isAnnualExport
          ? PERIODS.flatMap((period) => {
              const termAssessments = allAssessments.filter((assessment) => assessment.periodId === period.id);
              if (!termAssessments.length) return ["", recoveryGradeForStudent(data.recoveries ?? [], classItem.id, period.id, student.id) ?? ""];
              return [
                formatGrade(calculateFinalGrade(student.id, termAssessments)),
                recoveryGradeForStudent(data.recoveries ?? [], classItem.id, period.id, student.id) ?? ""
              ];
            })
          : [
              formatGrade(baseFinalGrade),
              recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id) ?? ""
            ];

        notesRows.push([
          student.name,
          studentStatusLabel(student),
          ...assessments.map((assessment) =>
            assessmentDisplayValue(assessment, student.id)
          ),
          finalGrade === null ? "Em aberto" : formatGrade(finalGrade),
          finalGrade === null ? "Em aberto" : finalGrade >= 6 ? "Aprovado" : "Recuperação"
        ]);

        frequencyRows.push([student.name, studentStatusLabel(student), lessonTotal, absences, absencePercent]);
        councilRows.push([
          student.name,
          studentStatusLabel(student),
          ...periodGradeCells,
          finalGrade === null ? "Em aberto" : finalGrade >= 6 ? "Aprovado" : "Recuperação",
          lessonTotal,
          absences,
          absencePercent,
          pendingAssessmentSummary(missingAssessments),
          pendingMakeupAssessments.map((assessment) => assessment.name).join("; "),
          ...assessmentGradeCells
        ]);

        for (const monthKey of monthKeys) {
          const monthLessons = lessons.filter((lesson) => lesson.date.startsWith(monthKey));
          const monthTotal = studentAttendanceTotal(monthLessons, data.attendanceSummaries, classItem.id, student, null, monthKey);
          const monthAbsences = studentAbsenceTotal(monthLessons, data.attendanceSummaries, classItem.id, student, null, monthKey);
          const [year, month] = monthKey.split("-");
          frequenciaMensalRows.push([
            classItem.name,
            student.name,
            `${month}/${year}`,
            monthTotal,
            monthAbsences,
            monthTotal ? formatPercent((monthAbsences / monthTotal) * 100) : "0%"
          ]);
        }

        for (const period of periodsToExport) {
          const termLessons = allClassLessons.filter((lesson) => lesson.periodId === period.id);
          if (!isAnnualExport && period.id !== exportPeriod) continue;
          const termTotal = studentAttendanceTotal(termLessons, data.attendanceSummaries, classItem.id, student, period.id);
          const termAbsences = studentAbsenceTotal(termLessons, data.attendanceSummaries, classItem.id, student, period.id);
          frequenciaTrimestralRows.push([
            classItem.name,
            student.name,
            period.label,
            termTotal,
            termAbsences,
            termTotal ? formatPercent((termAbsences / termTotal) * 100) : "0%"
          ]);
        }

        if (isActiveStudent(student) && finalGrade !== null && finalGrade < 6) {
          recuperacaoRows.push([
            classItem.name,
            student.name,
            formatGrade(finalGrade),
            absences,
            absencePercent,
            pendingAssessmentSummary(missingAssessments)
          ]);
        }

        for (const assessment of isActiveStudent(student) ? missingAssessments.filter(assessmentAllowsMakeup) : []) {
          segundaChamadaRows.push([
            classItem.name,
            student.name,
            assessment.name,
            missingAssessmentLabel(assessment),
            assessment.description ?? "",
            assessmentTypeLabel(assessment.calculationType),
            formatGrade(assessment.maxScore),
            formatGrade(assessment.weight)
          ]);
        }

        if (isAnnualExport) {
          const annualLessons = data.lessons.filter((lesson) => lesson.classId === classItem.id);
          const annualTotal = studentAttendanceTotal(annualLessons, data.attendanceSummaries, classItem.id, student, ANNUAL_PERIOD);
          const annualAbsences = studentAbsenceTotal(annualLessons, data.attendanceSummaries, classItem.id, student, ANNUAL_PERIOD);
          const termAttendanceCells = PERIODS.flatMap((period) => {
            const termAssessments = allAssessments.filter((assessment) => assessment.periodId === period.id);
            const termLessons = annualLessons.filter((lesson) => lesson.periodId === period.id);
            const termTotal = studentAttendanceTotal(termLessons, data.attendanceSummaries, classItem.id, student, period.id);
            const termAbsences = studentAbsenceTotal(termLessons, data.attendanceSummaries, classItem.id, student, period.id);
            return [
              termAssessments.length
                ? formatGrade(applyRecoveryGrade(calculateFinalGrade(student.id, termAssessments), recoveryGradeForStudent(data.recoveries ?? [], classItem.id, period.id, student.id)))
                : "",
              termAbsences,
              termTotal ? formatPercent((termAbsences / termTotal) * 100) : "0%"
            ];
          });
          consolidatedRows.push([
            student.name,
            ...termAttendanceCells,
            finalGrade === null ? "Em aberto" : formatGrade(finalGrade),
            finalGrade === null ? "Em aberto" : finalGrade >= 6 ? "Aprovado" : "Recuperação",
            annualAbsences,
            annualTotal ? formatPercent((annualAbsences / annualTotal) * 100) : "0%"
          ]);
        }
      }

      appendSheet(notesRows, `Notas ${classItem.name}`, [34, 16, ...assessments.map(() => 18), 12, 14]);
      appendSheet(
        councilRows,
        `Conselho ${classItem.name}`,
        [
          34,
          16,
          ...(isAnnualExport ? [12, 12, 12, 12, 12, 12, 12] : [14, 12]),
          14,
          10,
          10,
          12,
          36,
          36,
          ...assessments.map(() => 18)
        ]
      );
      appendSheet(frequencyRows, `Frequência ${classItem.name}`, [34, 16, 12, 10, 12]);
      if (isAnnualExport) {
        appendSheet(consolidatedRows, `Consolidado ${classItem.name}`, [34, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 16, 12, 12]);
      }
    }

    appendSheet(
      frequenciaMensalRows.length > 1 ? frequenciaMensalRows : [["Turma", "Aluno", "Mês", "Aulas dadas", "Faltas", "% faltas"], ["Sem aulas registradas"]],
      "Frequência mensal",
      [14, 34, 12, 12, 10, 12]
    );

    appendSheet(
      frequenciaTrimestralRows.length > 1
        ? frequenciaTrimestralRows
        : [["Turma", "Aluno", "Trimestre", "Aulas dadas", "Faltas", "% faltas"], ["Sem aulas registradas"]],
      "Frequência trimestral",
      [14, 34, 16, 12, 10, 12]
    );

    appendSheet(
      recuperacaoRows.length > 1 ? recuperacaoRows : [["Turma", "Aluno", "Nota final", "Faltas", "% faltas", "Pendências"], ["Sem alunos em recuperação"]],
      "Recuperação",
      [14, 34, 12, 10, 12, 42]
    );

    appendSheet(
      segundaChamadaRows.length > 1
        ? segundaChamadaRows
        : [["Turma", "Aluno", "Avaliação formal", "Situação", "Descrição", "Tipo", "Nota máxima", "Peso"], ["Sem alunos em segunda chamada"]],
      "Segunda chamada",
      [14, 34, 28, 12, 42, 12, 12, 10]
    );

    const diarioRows = [["Data", "Turma", "Aulas", "Conteúdo", "Aluno", "Frequência"]];
    for (const lesson of data.lessons.filter((item) => isAnnualExport || item.periodId === exportPeriod)) {
      for (const record of lesson.attendance) {
        diarioRows.push([
          dateFormatter.format(new Date(`${lesson.date}T12:00:00`)),
          lesson.className,
          lessonPeriods(lesson),
          lesson.content,
          record.studentName,
          attendanceStatusLabel(record.status)
        ]);
      }
    }
    appendSheet(diarioRows, "Diário", [12, 14, 10, 48, 34, 14]);

    const resumoAvaliacoesRows = [["Turma", "Avaliação", "Tipo", "Descrição", "Nota máxima", "Peso", "Média da turma", "Com nota", "Pendências"]];
    for (const classItem of data.classes) {
      const assessments = data.assessments.filter((assessment) => assessment.classId === classItem.id && (isAnnualExport || assessment.periodId === exportPeriod));
      const activeStudents = classItem.students.filter(isActiveStudent);
      for (const assessment of assessments) {
        const launched = activeStudents.filter(
          (student) => normalize(assessment.grades?.[student.id]) || isMissingGrade(assessment.grades?.[student.id])
        ).length;
        const missing = activeStudents.filter((student) => isPendingGrade(assessment, student.id)).length;
        resumoAvaliacoesRows.push([
          classItem.name,
          assessment.name,
          assessmentTypeLabel(assessment.calculationType),
          assessment.description ?? "",
          assessment.maxScore,
          assessment.weight,
          formatGrade(calculateAssessmentClassAverage(assessment, activeStudents)),
          `${launched}/${activeStudents.length}`,
          `${missing} ${assessmentAllowsMakeup(assessment) ? "faltou" : "não entregou"}`
        ]);
      }
    }
    appendSheet(resumoAvaliacoesRows, "Avaliações", [14, 24, 12, 42, 12, 10, 14, 12, 14]);

    try {
      const teacherFileName = fileSafeName(teacherName) || "professor";
      const periodFileName = isAnnualExport ? "anual" : fileSafeName(exportLabel);
      const result = await saveWorkbook(workbook, `exportacao ${teacherFileName} ${periodFileName}.xlsx`, XLSX);
      setImportMessage(result.message);
    } catch (error) {
      setImportMessage(`Não foi possível exportar o arquivo: ${error?.message ?? "erro desconhecido"}`);
    }
  }

  function reportAssessmentsForClass(classItem, exportPeriod) {
    const allAssessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
    return exportPeriod === ANNUAL_PERIOD
      ? allAssessments
      : allAssessments.filter((assessment) => assessment.periodId === exportPeriod);
  }

  function reportLessonsForClass(classItem, exportPeriod, options = {}) {
    if (options.attendanceScope === "month" && options.month) {
      return data.lessons.filter((lesson) => lesson.classId === classItem.id && lesson.date?.startsWith(options.month));
    }
    return data.lessons.filter((lesson) => lesson.classId === classItem.id && (exportPeriod === ANNUAL_PERIOD || lesson.periodId === exportPeriod));
  }

  function reportFinalGrade(student, classItem, assessments, exportPeriod) {
    const allAssessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
    if (exportPeriod === ANNUAL_PERIOD) {
      return isAnnualClosed(schoolYear) ? calculateAnnualGradeWithRecovery(student.id, allAssessments, data.recoveries ?? [], classItem.id) : null;
    }
    const baseGrade = calculateFinalGrade(student.id, assessments);
    return applyRecoveryGrade(baseGrade, recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id));
  }

  function reportSituation(grade) {
    if (grade === null) return "Em aberto";
    return grade >= 6 ? "Aprovado" : "Recuperação";
  }

  function buildConfiguredReportRows(presetId, exportPeriod, options = {}) {
    const reportLabel = presetId === "attendance" && options.attendanceScope === "month" ? formatMonthKey(options.month) : periodLabel(exportPeriod);
    const baseRows = [
      ["Escola", SCHOOL_NAME],
      ["Professor", teacherName || ""],
      ["Disciplina", subjectName || ""],
      ["Período", reportLabel],
      ["Gerado em", new Intl.DateTimeFormat("pt-BR").format(new Date())],
      []
    ];

    if (presetId === "grades") {
      const rows = [
        ...baseRows,
        ["Turma", "Aluno", "Status", "Avaliação", "Nota original", "Segunda chamada", "Nota considerada", "Tipo", "Nota máxima", "Peso", "Nota final", "Situação"]
      ];
      for (const classItem of data.classes) {
        const assessments = reportAssessmentsForClass(classItem, exportPeriod);
        for (const student of classItem.students) {
          const grade = reportFinalGrade(student, classItem, assessments, exportPeriod);
          if (!assessments.length) {
            rows.push([classItem.name, student.name, studentStatusLabel(student), "Sem avaliações", "", "", "", "", "", "", grade === null ? "Em aberto" : formatGrade(grade), reportSituation(grade)]);
          }
          for (const assessment of assessments) {
            const value = assessment.grades?.[student.id];
            const makeupValue = assessment.makeupGrades?.[student.id];
            rows.push([
              classItem.name,
              student.name,
              studentStatusLabel(student),
              assessment.name,
              isMissingGrade(value) ? missingAssessmentLabel(assessment) : value || "0",
              makeupDisplayValue(makeupValue, ""),
              assessmentDisplayValue(assessment, student.id),
              assessmentTypeLabel(assessment.calculationType),
              assessment.maxScore,
              assessment.weight,
              grade === null ? "Em aberto" : formatGrade(grade),
              reportSituation(grade)
            ]);
          }
        }
      }
      return { title: "Todas as notas", rows, widths: [14, 34, 14, 28, 14, 16, 16, 12, 12, 10, 12, 14] };
    }

    if (presetId === "attendance") {
      const rows = [
        ...baseRows,
        ["Turma", "Aluno", "Status", "Aulas dadas", "Faltas", "Justificadas", "% faltas"]
      ];
      for (const classItem of data.classes) {
        const lessons = reportLessonsForClass(classItem, exportPeriod, options);
        const summaryPeriod = options.attendanceScope === "month" ? null : exportPeriod;
        const summaryMonth = options.attendanceScope === "month" ? options.month : null;
        for (const student of classItem.students) {
          const lessonTotal = options.attendanceScope === "month"
            ? studentAttendanceTotal(lessons, data.attendanceSummaries, classItem.id, student, null, summaryMonth)
            : studentAttendanceTotal(lessons, data.attendanceSummaries, classItem.id, student, summaryPeriod);
          const absences = options.attendanceScope === "month"
            ? studentAbsenceTotal(lessons, data.attendanceSummaries, classItem.id, student, null, summaryMonth)
            : studentAbsenceTotal(lessons, data.attendanceSummaries, classItem.id, student, summaryPeriod);
          const excused = options.attendanceScope === "month"
            ? studentExcusedTotal(lessons, data.attendanceSummaries, classItem.id, student, null, summaryMonth)
            : studentExcusedTotal(lessons, data.attendanceSummaries, classItem.id, student, summaryPeriod);
          rows.push([
            classItem.name,
            student.name,
            studentStatusLabel(student),
            lessonTotal,
            absences,
            excused,
            lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%"
          ]);
        }
      }
      return { title: "Frequência", rows, widths: [14, 34, 14, 12, 10, 12, 12] };
    }

    if (presetId === "pending") {
      const rows = [
        ...baseRows,
        ["Turma", "Aluno", "Avaliação", "Pendência", "Permite 2ª chamada", "Descrição", "Tipo", "Nota máxima", "Peso"]
      ];
      for (const classItem of data.classes) {
        const assessments = reportAssessmentsForClass(classItem, exportPeriod);
        for (const student of classItem.students.filter(isActiveStudent)) {
          for (const assessment of assessments.filter((item) => isPendingGrade(item, student.id))) {
            rows.push([
              classItem.name,
              student.name,
              assessment.name,
              missingAssessmentLabel(assessment),
              assessmentAllowsMakeup(assessment) ? "Sim" : "Não",
              assessment.description ?? "",
              assessmentTypeLabel(assessment.calculationType),
              assessment.maxScore,
              assessment.weight
            ]);
          }
        }
      }
      if (rows.length === baseRows.length + 1) rows.push(["Sem pendências de entrega"]);
      return { title: "Pendências", rows, widths: [14, 34, 30, 14, 14, 42, 12, 12, 10] };
    }

    if (presetId === "makeup") {
      const rows = [
        ...baseRows,
        ["Turma", "Aluno", "Avaliação formal", "Situação", "Descrição", "Tipo", "Nota máxima", "Peso"]
      ];
      for (const classItem of data.classes) {
        const assessments = reportAssessmentsForClass(classItem, exportPeriod).filter(assessmentAllowsMakeup);
        for (const student of classItem.students.filter(isActiveStudent)) {
          for (const assessment of assessments.filter((item) => needsMakeup(item, student))) {
            rows.push([
              classItem.name,
              student.name,
              assessment.name,
              missingAssessmentLabel(assessment),
              assessment.description ?? "",
              assessmentTypeLabel(assessment.calculationType),
              assessment.maxScore,
              assessment.weight
            ]);
          }
        }
      }
      if (rows.length === baseRows.length + 1) rows.push(["Sem alunos em segunda chamada"]);
      return { title: "Segunda chamada", rows, widths: [14, 34, 30, 12, 42, 12, 12, 10] };
    }

    const isRecovery = presetId === "recovery";
    const rows = [
      ...baseRows,
      isRecovery
        ? ["Turma", "Aluno", "Status", "Média trimestral", "Nota recuperação", "Nota considerada", "Situação", "Aulas dadas", "Faltas", "% faltas", "Pendências"]
        : ["Turma", "Aluno", "Status", "Nota final", "Situação", "Aulas dadas", "Faltas", "% faltas", "Pendências"]
    ];
    for (const classItem of data.classes) {
      const assessments = reportAssessmentsForClass(classItem, exportPeriod);
      const lessons = reportLessonsForClass(classItem, exportPeriod, options);
      for (const student of classItem.students) {
        const baseGrade = exportPeriod === ANNUAL_PERIOD ? null : calculateFinalGrade(student.id, assessments);
        const recoveryGrade = exportPeriod === ANNUAL_PERIOD ? "" : recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id);
        const grade = reportFinalGrade(student, classItem, assessments, exportPeriod);
        const lessonTotal = studentAttendanceTotal(lessons, data.attendanceSummaries, classItem.id, student, exportPeriod);
        const absences = studentAbsenceTotal(lessons, data.attendanceSummaries, classItem.id, student, exportPeriod);
        const missingAssessments = assessments.filter((assessment) => isPendingGrade(assessment, student.id));
        if (isRecovery && (!isActiveStudent(student) || baseGrade === null || baseGrade >= 6)) continue;
        rows.push(
          isRecovery
            ? [
                classItem.name,
                student.name,
                studentStatusLabel(student),
                formatGrade(baseGrade),
                normalize(recoveryGrade) ? recoveryGrade : "",
                grade === null ? "Em aberto" : formatGrade(grade),
                reportSituation(grade),
                lessonTotal,
                absences,
                lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%",
                pendingAssessmentSummary(missingAssessments)
              ]
            : [
                classItem.name,
                student.name,
                studentStatusLabel(student),
                grade === null ? "Em aberto" : formatGrade(grade),
                reportSituation(grade),
                lessonTotal,
                absences,
                lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%",
                pendingAssessmentSummary(missingAssessments)
              ]
        );
      }
    }
    if (rows.length === baseRows.length + 1) rows.push([isRecovery ? "Sem alunos em recuperação" : "Sem alunos"]);
    return {
      title: isRecovery ? "Recuperação" : "Notas finais e faltas",
      rows,
      widths: isRecovery ? [14, 34, 14, 14, 14, 14, 14, 12, 10, 12, 42] : [14, 34, 14, 12, 14, 12, 10, 12, 42]
    };
  }

  async function exportConfiguredXlsx(presetId, exportPeriod, options = {}) {
    if (presetId === "complete") {
      await exportXlsx(exportPeriod);
      return;
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const report = buildConfiguredReportRows(presetId, exportPeriod, options);
    const sheet = XLSX.utils.aoa_to_sheet(report.rows);
    setSheetWidths(sheet, report.widths);
    sheet["!margins"] = { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
    XLSX.utils.book_append_sheet(workbook, sheet, sheetSafeName(report.title));

    try {
      const teacherFileName = fileSafeName(teacherName) || "professor";
      const periodFileName =
        presetId === "attendance" && options.attendanceScope === "month"
          ? fileSafeName(formatMonthKey(options.month))
          : exportPeriod === ANNUAL_PERIOD
            ? "anual"
            : fileSafeName(periodLabel(exportPeriod));
      const reportFileName = fileSafeName(report.title);
      const result = await saveWorkbook(workbook, `relatório ${reportFileName} ${teacherFileName} ${periodFileName}.xlsx`, XLSX);
      setImportMessage(result.message);
    } catch (error) {
      setImportMessage(`Não foi possível exportar o relatório: ${error?.message ?? "erro desconhecido"}`);
    }
  }

  function buildPrintableReport(exportPeriod = selectedPeriod) {
    const isAnnualReport = exportPeriod === ANNUAL_PERIOD;
    const reportLabel = periodLabel(exportPeriod);
    const closedAnnual = isAnnualClosed(schoolYear);
    const sections = data.classes.map((classItem) => {
      const allAssessments = data.assessments.filter((assessment) => assessment.classId === classItem.id);
      const assessments = allAssessments.filter((assessment) => isAnnualReport || assessment.periodId === exportPeriod);
      const lessons = data.lessons.filter((lesson) => lesson.classId === classItem.id && (isAnnualReport || lesson.periodId === exportPeriod));
      const assessmentHeaders = assessments
        .map((assessment) => `<th>${escapeHtml(assessment.name)}<small>${escapeHtml(periodLabel(assessment.periodId))} | ${escapeHtml(assessmentTypeLabel(assessment.calculationType))}</small></th>`)
        .join("");
      const rows = classItem.students
        .map((student) => {
          const lessonTotal = studentAttendanceTotal(lessons, data.attendanceSummaries, classItem.id, student, isAnnualReport ? ANNUAL_PERIOD : exportPeriod);
          const absences = studentAbsenceTotal(lessons, data.attendanceSummaries, classItem.id, student, isAnnualReport ? ANNUAL_PERIOD : exportPeriod);
          const absencePercent = lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%";
          const missingAssessments = assessments.filter((assessment) => isPendingGrade(assessment, student.id));
          const pendingMakeupAssessments = missingAssessments.filter(assessmentAllowsMakeup);
          const grade = isAnnualReport
            ? closedAnnual
              ? calculateAnnualGradeWithRecovery(student.id, allAssessments, data.recoveries ?? [], classItem.id)
              : null
            : applyRecoveryGrade(calculateFinalGrade(student.id, assessments), recoveryGradeForStudent(data.recoveries ?? [], classItem.id, exportPeriod, student.id));
          const assessmentCells = assessments
            .map((assessment) => {
              return `<td>${escapeHtml(assessmentDisplayValue(assessment, student.id))}</td>`;
            })
            .join("");
          return `
            <tr>
              <td>${escapeHtml(student.name)}</td>
              <td>${grade === null ? "Em aberto" : formatGrade(grade)}</td>
              <td>${grade === null ? "Em aberto" : grade >= 6 ? "Aprovado" : "Recuperação"}</td>
              <td>${lessonTotal}</td>
              <td>${absences}</td>
              <td>${absencePercent}</td>
              <td>${escapeHtml(pendingAssessmentSummary(missingAssessments))}</td>
              <td>${escapeHtml(pendingMakeupAssessments.map((assessment) => assessment.name).join("; "))}</td>
              ${assessmentCells}
            </tr>
          `;
        })
        .join("");

      return `
        <section class="print-section">
          <h2>Turma ${escapeHtml(classItem.name)}</h2>
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>${isAnnualReport ? "Média anual" : "Nota final"}</th>
                <th>Situação</th>
                <th>Aulas</th>
                <th>Faltas</th>
                <th>% faltas</th>
                <th>Pendências</th>
                <th>2ª chamada pendente</th>
                ${assessmentHeaders}
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="${8 + assessments.length}">Sem alunos</td></tr>`}</tbody>
          </table>
        </section>
      `;
    }).join("");

    return `<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Relatório ${reportLabel}</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { color: #102f1a; font-family: Arial, sans-serif; margin: 0; }
            header { align-items: center; border-bottom: 4px solid #f2a900; display: flex; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; }
            .report-logo { height: 58px; object-fit: contain; width: 58px; }
            .report-heading { min-width: 0; }
            h1 { color: #0b3f1c; font-size: 22px; margin: 0 0 6px; }
            h2 { color: #0b3f1c; font-size: 16px; margin: 0 0 8px; }
            p { margin: 2px 0; }
            table { border-collapse: collapse; font-size: 10px; margin-bottom: 18px; width: 100%; }
            th { background: #0b3f1c; color: white; text-align: left; }
            th, td { border: 1px solid #cbd5d0; padding: 5px 6px; }
            th small { color: #d9f2dd; display: block; font-size: 8px; font-weight: 400; margin-top: 2px; }
            tr:nth-child(even) td { background: #f5f8f3; }
            .print-section { break-inside: avoid; page-break-inside: avoid; }
            .meta { color: #365642; font-size: 12px; }
            .print-actions { margin: 0 0 14px; }
            .print-actions button { background: #0b3f1c; border: 0; border-radius: 8px; color: white; cursor: pointer; font-weight: 700; padding: 10px 14px; }
            @media print { .print-actions { display: none; } }
          </style>
        </head>
        <body>
          <header>
            <img class="report-logo" alt="CAp UFRJ" src="${SCHOOL_LOGO_SRC}" />
            <div class="report-heading">
              <h1>${SCHOOL_NAME} - ${APP_TITLE}</h1>
              <p class="meta">Professor: ${escapeHtml(teacherName || "Não informado")}</p>
              <p class="meta">Disciplina: ${escapeHtml(subjectName || "Não informada")}</p>
              <p class="meta">Período: ${reportLabel}</p>
              <p class="meta">Gerado em: ${new Intl.DateTimeFormat("pt-BR").format(new Date())}</p>
              ${isAnnualReport && !closedAnnual ? `<p class="meta">Média anual em aberto até o encerramento do 3º trimestre.</p>` : ""}
            </div>
          </header>
          <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / salvar PDF</button></div>
          ${sections || "<p>Sem turmas cadastradas.</p>"}
        </body>
      </html>`;
  }

  function buildConfiguredPrintableReport(presetId, exportPeriod, options = {}) {
    if (presetId === "complete") return buildPrintableReport(exportPeriod);

    const report = buildConfiguredReportRows(presetId, exportPeriod, options);
    const metadataRows = report.rows.slice(0, 5);
    const header = report.rows[6] ?? [];
    const bodyRows = report.rows.slice(7);
    const title = `${report.title} - ${periodLabel(exportPeriod)}`;
    const tableRows = bodyRows
      .map((row) => `
        <tr>
          ${header.map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}
        </tr>
      `)
      .join("");

    return `<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { box-sizing: border-box; }
            body { color: #102f1a; font-family: Arial, sans-serif; margin: 0; }
            header { align-items: center; border-bottom: 4px solid #f2a900; display: flex; gap: 12px; margin-bottom: 14px; padding-bottom: 10px; }
            .report-logo { height: 54px; object-fit: contain; width: 54px; }
            .report-heading { min-width: 0; }
            h1 { color: #0b3f1c; font-size: 22px; margin: 0 0 6px; }
            p { margin: 2px 0; }
            table { border-collapse: collapse; font-size: 10px; width: 100%; }
            th { background: #0b3f1c; color: white; text-align: left; }
            th, td { border: 1px solid #cbd5d0; padding: 4px 5px; vertical-align: top; }
            tr:nth-child(even) td { background: #f5f8f3; }
            .meta { color: #365642; font-size: 12px; }
            .print-actions { margin: 0 0 14px; }
            .print-actions button { background: #0b3f1c; border: 0; border-radius: 8px; color: white; cursor: pointer; font-weight: 700; padding: 10px 14px; }
            @media print { .print-actions { display: none; } }
          </style>
        </head>
        <body>
          <header>
            <img class="report-logo" alt="CAp UFRJ" src="${SCHOOL_LOGO_SRC}" />
            <div class="report-heading">
              <h1>${escapeHtml(report.title)}</h1>
              ${metadataRows.map(([label, value]) => `<p class="meta">${escapeHtml(label)}: ${escapeHtml(value || (label === "Professor" ? "Não informado" : label === "Disciplina" ? "Não informada" : ""))}</p>`).join("")}
            </div>
          </header>
          <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / salvar PDF</button></div>
          <table>
            <thead>
              <tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
            </thead>
            <tbody>${tableRows || `<tr><td colspan="${header.length || 1}">Sem dados para este relatório.</td></tr>`}</tbody>
          </table>
        </body>
      </html>`;
  }

  function openPdfReport(exportPeriod = selectedPeriod, presetId = "complete", options = {}) {
    const popup = window.open("", "_blank");
    if (!popup) {
      setImportMessage("Não foi possível abrir o relatório. Libere pop-ups para gerar PDF.");
      return;
    }
    popup.document.open();
    popup.document.write(buildConfiguredPrintableReport(presetId, exportPeriod, options));
    popup.document.close();
  }

  function generateConfiguredReport() {
    setIsReportPanelOpen(false);
    const preset = REPORT_PRESETS.find((item) => item.id === reportPreset) ?? REPORT_PRESETS[0];
    const reportOptions = {
      attendanceScope: reportPreset === "attendance" ? reportAttendanceScope : "period",
      month: reportMonthOptions.includes(reportMonth) ? reportMonth : reportMonthOptions[0] ?? today().slice(0, 7)
    };
    if (reportFormat === "pdf") {
      openPdfReport(reportPeriod, reportPreset, reportOptions);
      setImportMessage(`${preset.title} aberto para impressão ou salvamento em PDF.`);
      return;
    }
    exportConfiguredXlsx(reportPreset, reportPeriod, reportOptions);
  }

  function openSettings() {
    setSettingsTeacherDraft(teacherName);
    setSettingsSubjectDraft(subjectName);
    setSettingsDecimalsDraft(gradeDecimals);
    setSettingsOpen(true);
  }

  function saveSettings(event) {
    event.preventDefault();
    const teacher = normalize(settingsTeacherDraft);
    setTeacherName(teacher);
    setTeacherDraft(teacher);
    setSubjectName(normalize(settingsSubjectDraft));
    setGradeDecimals(Number(settingsDecimalsDraft));
    setSettingsOpen(false);
    setImportMessage("Configurações salvas.");
  }

  async function handleSignUp(event) {
    event.preventDefault();
    const email = normalize(signupEmailDraft).toLowerCase();
    const teacher = normalize(setupTeacherDraft);
    const subject = normalize(setupSubjectDraft);
    const password = signupPasswordDraft.trim();
    if (!email || !teacher || !subject) {
      setPasswordError("Informe e-mail, nome e disciplina para começar.");
      return;
    }
    if (password.length < 6) {
      setPasswordError("Crie uma senha com pelo menos 6 caracteres.");
      return;
    }
    if (password !== signupConfirmDraft.trim()) {
      setPasswordError("A confirmação da senha não confere.");
      return;
    }
    setPasswordError("");
    try {
      const result = await signUpWithEmail(email, password, { teacherName: teacher, subjectName: subject });
      setTeacherName(teacher);
      setTeacherDraft(teacher);
      setSubjectName(subject);
      setGradeDecimals(Number(setupDecimalsDraft));
      setSignupPasswordDraft("");
      setSignupConfirmDraft("");
      if (result.session) {
        setSession(result.session);
      } else {
        setAuthMessage("Conta criada. Verifique seu e-mail para confirmar o acesso antes de entrar.");
      }
    } catch (error) {
      setPasswordError(
        error?.message === "User already registered"
          ? "Já existe uma conta com esse e-mail. Use a aba \"Entrar\"."
          : `Não foi possível criar a conta: ${error?.message ?? "erro desconhecido"}`
      );
    }
  }

  async function handleSignIn(event) {
    event.preventDefault();
    const email = normalize(loginEmailDraft).toLowerCase();
    const password = loginPasswordDraft;
    if (!email || !password) {
      setPasswordError("Informe e-mail e senha.");
      return;
    }
    setPasswordError("");
    try {
      const result = await signInWithEmail(email, password);
      const metadata = result.user?.user_metadata ?? {};
      if (metadata.teacher_name) {
        setTeacherName(metadata.teacher_name);
        setTeacherDraft(metadata.teacher_name);
      }
      if (metadata.subject_name) setSubjectName(metadata.subject_name);
      setSession(result.session);
      setLoginPasswordDraft("");
    } catch (error) {
      setPasswordError(
        error?.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : `Não foi possível entrar: ${error?.message ?? "erro desconhecido"}`
      );
    }
  }

  async function handleForgotPassword() {
    const email = normalize(loginEmailDraft).toLowerCase();
    if (!email) {
      setPasswordError("Informe seu e-mail para receber o link de redefinição.");
      return;
    }
    setPasswordError("");
    try {
      await sendPasswordResetEmail(email);
      setAuthMessage(`Enviamos um link de redefinição de senha para ${email}.`);
    } catch (error) {
      setPasswordError(`Não foi possível enviar o e-mail: ${error?.message ?? "erro desconhecido"}`);
    }
  }

  async function handleUpdateRecoveryPassword(event) {
    event.preventDefault();
    const password = recoveryPasswordDraft.trim();
    if (password.length < 6) {
      setPasswordError("Crie uma senha com pelo menos 6 caracteres.");
      return;
    }
    if (password !== recoveryConfirmDraft.trim()) {
      setPasswordError("A confirmação da senha não confere.");
      return;
    }
    try {
      await updatePassword(password);
      setRecoveryMode(false);
      setRecoveryPasswordDraft("");
      setRecoveryConfirmDraft("");
      setPasswordError("");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setImportMessage("Senha redefinida com sucesso.");
    } catch (error) {
      setPasswordError(`Não foi possível redefinir a senha: ${error?.message ?? "erro desconhecido"}`);
    }
  }

  function updateTermDate(periodId, field, value) {
    setData((current) => ({
      ...current,
      schoolYear: {
        ...(current.schoolYear ?? DEFAULT_SCHOOL_YEAR),
        terms: {
          ...(current.schoolYear?.terms ?? DEFAULT_SCHOOL_YEAR.terms),
          [periodId]: {
            ...(current.schoolYear?.terms?.[periodId] ?? DEFAULT_SCHOOL_YEAR.terms[periodId]),
            [field]: value
          }
        }
      },
      lessons: current.lessons.map((lesson) => ({
        ...lesson,
        periodId: periodForDate(lesson.date, {
          ...(current.schoolYear ?? DEFAULT_SCHOOL_YEAR),
          terms: {
            ...(current.schoolYear?.terms ?? DEFAULT_SCHOOL_YEAR.terms),
            [periodId]: {
              ...(current.schoolYear?.terms?.[periodId] ?? DEFAULT_SCHOOL_YEAR.terms[periodId]),
              [field]: value
            }
          }
        })
      }))
    }));
  }

  function updateUpatDate(periodId, field, value) {
    setData((current) => ({
      ...current,
      schoolYear: {
        ...(current.schoolYear ?? DEFAULT_SCHOOL_YEAR),
        milestones: {
          ...(current.schoolYear?.milestones ?? DEFAULT_SCHOOL_YEAR.milestones),
          upat: {
            ...(current.schoolYear?.milestones?.upat ?? DEFAULT_SCHOOL_YEAR.milestones.upat),
            [periodId]: {
              ...(current.schoolYear?.milestones?.upat?.[periodId] ?? DEFAULT_SCHOOL_YEAR.milestones.upat[periodId]),
              [field]: value
            }
          }
        }
      }
    }));
  }

  function updateVacationDate(field, value) {
    setData((current) => ({
      ...current,
      schoolYear: {
        ...(current.schoolYear ?? DEFAULT_SCHOOL_YEAR),
        milestones: {
          ...(current.schoolYear?.milestones ?? DEFAULT_SCHOOL_YEAR.milestones),
          vacation: {
            ...(current.schoolYear?.milestones?.vacation ?? DEFAULT_SCHOOL_YEAR.milestones.vacation),
            [field]: value
          }
        }
      }
    }));
  }

  const selectedSyncSnapshot = syncReview?.snapshots.find((snapshot) => snapshot.id === selectedSyncSnapshotId) ?? syncReview?.snapshots[0];
  const selectedSyncSummary = selectedSyncSnapshot ? summarizeSyncSnapshot(selectedSyncSnapshot) : null;
  const selectedSyncImpact = useMemo(
    () => (syncReview && selectedSyncSnapshot ? summarizeSyncImpact(data, selectedSyncSnapshot.data, syncReview.mode) : null),
    [data, selectedSyncSnapshot, syncReview]
  );

  return (
    <main className="app-shell">
      {authLoading && (
        <section className="auth-shell auth-shell-quick" aria-label="Carregando">
          <div className="auth-quick-card">
            <img className="auth-quick-logo" alt={SCHOOL_NAME} src={SCHOOL_LOGO_SRC} />
            <p className="eyebrow">{APP_TITLE}</p>
            <h1>Carregando...</h1>
          </div>
        </section>
      )}
      {!authLoading && recoveryMode && (
        <section className="auth-shell auth-shell-quick" aria-label="Redefinir senha">
          <form className="auth-quick-card" onSubmit={handleUpdateRecoveryPassword}>
            <img className="auth-quick-logo" alt={SCHOOL_NAME} src={SCHOOL_LOGO_SRC} />
            <p className="eyebrow">Recuperação de acesso</p>
            <h1>Definir nova senha</h1>
            <label>
              Nova senha
              <input
                autoFocus
                type="password"
                value={recoveryPasswordDraft}
                onChange={(event) => {
                  setRecoveryPasswordDraft(event.target.value);
                  setPasswordError("");
                }}
                placeholder="Nova senha"
                aria-label="Nova senha"
              />
            </label>
            <label>
              Confirmar nova senha
              <input
                type="password"
                value={recoveryConfirmDraft}
                onChange={(event) => {
                  setRecoveryConfirmDraft(event.target.value);
                  setPasswordError("");
                }}
                placeholder="Confirmar nova senha"
                aria-label="Confirmar nova senha"
              />
            </label>
            {passwordError && <p className="form-error">{passwordError}</p>}
            <button className="success" disabled={!recoveryPasswordDraft || !recoveryConfirmDraft}>
              Salvar nova senha
            </button>
          </form>
        </section>
      )}
      {!authLoading && !recoveryMode && !appUnlocked && (
        <section className="auth-shell" aria-label={authTab === "signup" ? "Cadastro do diário" : "Login do diário"}>
          <div className="auth-visual">
            <img className="auth-visual-logo" alt={SCHOOL_NAME} src={SCHOOL_LOGO_SRC} />
            <p className="auth-visual-eyebrow">{SCHOOL_NAME}</p>
            <h1>{APP_TITLE}</h1>
            <p className="auth-visual-subtitle">Turmas, notas, frequência e recuperação em um só lugar.</p>
            <ul className="auth-visual-bullets">
              <li><CheckCircle2 size={18} /><span>Notas, faltas e recuperação organizadas por trimestre</span></li>
              <li><CheckCircle2 size={18} /><span>Sincronização entre dispositivos via Supabase</span></li>
              <li><CheckCircle2 size={18} /><span>Backup automático com histórico de versões</span></li>
            </ul>
            <p className="auth-visual-footer">Login com e-mail e senha via Supabase Auth. Cada professor vê só o próprio diário.</p>
          </div>
          <div className="auth-panel">
            <div className="auth-panel-inner">
              <div className="auth-tabs" role="tablist" aria-label="Acesso">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === "login"}
                  className={authTab === "login" ? "active" : ""}
                  onClick={() => {
                    setAuthTab("login");
                    setPasswordError("");
                    setAuthMessage("");
                  }}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === "signup"}
                  className={authTab === "signup" ? "active" : ""}
                  onClick={() => {
                    setAuthTab("signup");
                    setPasswordError("");
                    setAuthMessage("");
                  }}
                >
                  Criar conta
                </button>
              </div>

              {authTab === "signup" ? (
                <form className="teacher-card auth-card setup-card" onSubmit={handleSignUp}>
                  <p className="eyebrow">Cadastro</p>
                  <h1>Crie sua conta</h1>
                  <label>
                    E-mail
                    <input
                      autoFocus
                      type="email"
                      value={signupEmailDraft}
                      onChange={(event) => {
                        setSignupEmailDraft(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="seu.email@exemplo.com"
                      aria-label="E-mail"
                    />
                  </label>
                  <label>
                    Nome
                    <input
                      value={setupTeacherDraft}
                      onChange={(event) => setSetupTeacherDraft(event.target.value)}
                      placeholder="Digite seu nome"
                    />
                  </label>
                  <label>
                    Disciplina
                    <input
                      value={setupSubjectDraft}
                      onChange={(event) => setSetupSubjectDraft(event.target.value)}
                      placeholder="Ex.: Matemática"
                    />
                  </label>
                  <label>
                    Casas decimais
                    <select value={setupDecimalsDraft} onChange={(event) => setSetupDecimalsDraft(Number(event.target.value))}>
                      <option value={0}>0 casas</option>
                      <option value={1}>1 casa</option>
                      <option value={2}>2 casas</option>
                    </select>
                  </label>
                  <label>
                    Senha
                    <input
                      type="password"
                      value={signupPasswordDraft}
                      onChange={(event) => {
                        setSignupPasswordDraft(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="Crie uma senha"
                    />
                  </label>
                  <label>
                    Confirmar senha
                    <input
                      type="password"
                      value={signupConfirmDraft}
                      onChange={(event) => {
                        setSignupConfirmDraft(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="Digite a senha novamente"
                    />
                  </label>
                  {passwordError && <p className="form-error">{passwordError}</p>}
                  {authMessage && <p className="auth-note">{authMessage}</p>}
                  <button className="success" disabled={!normalize(signupEmailDraft) || !normalize(setupTeacherDraft) || !normalize(setupSubjectDraft) || !signupPasswordDraft || !signupConfirmDraft}>
                    Cadastrar
                  </button>
                </form>
              ) : (
                <form className="teacher-card auth-card" onSubmit={handleSignIn}>
                  <p className="eyebrow">Login</p>
                  <h1>Entre na sua conta</h1>
                  <label>
                    E-mail
                    <input
                      autoFocus
                      type="email"
                      value={loginEmailDraft}
                      onChange={(event) => {
                        setLoginEmailDraft(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="seu.email@exemplo.com"
                      aria-label="E-mail"
                    />
                  </label>
                  <label>
                    Senha
                    <input
                      type="password"
                      value={loginPasswordDraft}
                      onChange={(event) => {
                        setLoginPasswordDraft(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="Senha de acesso"
                      aria-label="Senha de acesso"
                    />
                  </label>
                  {passwordError && <p className="form-error">{passwordError}</p>}
                  {authMessage && <p className="auth-note">{authMessage}</p>}
                  <button className="success" disabled={!loginEmailDraft || !loginPasswordDraft}>
                    Entrar
                  </button>
                  <button className="secondary" type="button" onClick={handleForgotPassword}>
                    Esqueci minha senha
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      )}
      {!authLoading && appUnlocked && appLockRequired && (
        <section className="auth-shell auth-shell-quick" aria-label="Desbloqueio rápido">
          {!appLockPinHash ? (
            <form className="auth-quick-card" onSubmit={submitCreatePin}>
              <img className="auth-quick-logo" alt={SCHOOL_NAME} src={SCHOOL_LOGO_SRC} />
              <p className="eyebrow">{APP_TITLE}</p>
              <h1>Criar PIN de desbloqueio</h1>
              <p className="helper-text">Esse PIN fica só neste aparelho e permite abrir o app rapidamente, mesmo sem internet.</p>
              <label>
                Novo PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  value={pinDraft}
                  onChange={(event) => {
                    setPinDraft(event.target.value);
                    setPinError("");
                  }}
                  placeholder="Mínimo 4 dígitos"
                  aria-label="Novo PIN"
                />
              </label>
              <label>
                Confirmar PIN
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinConfirmDraft}
                  onChange={(event) => {
                    setPinConfirmDraft(event.target.value);
                    setPinError("");
                  }}
                  placeholder="Digite o PIN novamente"
                  aria-label="Confirmar PIN"
                />
              </label>
              {pinError && <p className="form-error">{pinError}</p>}
              <button className="success" disabled={!pinDraft || !pinConfirmDraft}>
                Criar PIN
              </button>
              <div className="auth-quick-links">
                <button className="link-button" type="button" onClick={handleAppLockSignOut}>
                  Sair
                </button>
              </div>
            </form>
          ) : (
            <form className="auth-quick-card" onSubmit={submitCheckPin}>
              <img className="auth-quick-logo" alt={SCHOOL_NAME} src={SCHOOL_LOGO_SRC} />
              <p className="eyebrow">{APP_TITLE}</p>
              <h1>Bem-vindo(a) de volta{teacherName ? `, ${teacherName}` : ""}</h1>
              <label>
                PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  value={pinDraft}
                  onChange={(event) => {
                    setPinDraft(event.target.value);
                    setPinError("");
                  }}
                  placeholder="Digite seu PIN"
                  aria-label="PIN"
                />
              </label>
              {pinError && <p className="form-error">{pinError}</p>}
              <button className="success" disabled={!pinDraft}>
                Entrar
              </button>
              <div className="auth-quick-links">
                <button className="link-button" type="button" onClick={handleAppLockSignOut}>
                  Sair
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      {pendingGradeImport && (
        <section className="teacher-gate" aria-label="Revisão da importação de notas">
          <div className="import-review-card">
            <div className="import-review-header">
              <div>
                <p className="eyebrow">Importar notas</p>
                <h1>Conferencia critica</h1>
              </div>
              <button className="secondary" type="button" onClick={() => setPendingGradeImport(null)}>
                Cancelar
              </button>
            </div>
            <div className="import-review-body">
              <p>
                Encontramos pequenas divergências em alguns nomes da importação. Confirme com muita atenção se são os mesmos alunos antes de gravar, porque uma importação errada altera registros oficiais de notas.
              </p>
              <div className="import-review-counts">
                <span>{visibleNameMatches.length} nome(s) ainda sem confirmacao</span>
                <span>{confirmedNameMatchesCount} nome(s) conferido(s)</span>
                <span>{pendingGradeImport.missingItems.length} aluno(s) não encontrado(s)</span>
                <span>{pendingGradeImport.missingClasses.length} turma(s) não encontrada(s)</span>
              </div>
              {pendingGradeImport.nameMatches?.length > 0 && (
                <section className="import-review-section">
                  <h2>1. Conferir nomes parecidos</h2>
                  <p>
                    Escolha o aluno correto e marque "Conferido". O item sai da lista para voce seguir conferindo os proximos.
                  </p>
                  <div className="import-review-list">
                    {visibleNameMatches.map((student) => (
                      <article className="import-review-item danger" key={student.importKey}>
                        <strong>{student.className} - {student.studentName}</strong>
                        <span>{student.withGrades.length ? `Com nota: ${student.withGrades.join("; ")}` : "Com nota: nenhuma"}</span>
                        <span>{student.missingGrades.length ? `Sem nota: ${student.missingGrades.join(", ")}` : "Sem nota: nenhuma"}</span>
                        <label>
                          Confirmar se corresponde a:
                          <select
                            value={student.selectedStudentId}
                            onChange={(event) => updateImportNameResolution(student.importKey, event.target.value)}
                          >
                            {student.candidates.map((candidate) => (
                              <option key={candidate.studentId} value={candidate.studentId}>
                                {candidate.name}
                              </option>
                            ))}
                            <option value="">Não ? nenhum destes</option>
                          </select>
                        </label>
                        <label className="match-confirm-check">
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => confirmImportName(student.importKey)}
                          />
                          Conferido
                        </label>
                      </article>
                    ))}
                    {!visibleNameMatches.length && (
                      <p className="empty success-empty">Todos os nomes parecidos foram conferidos.</p>
                    )}
                  </div>
                </section>
              )}
              <section className="import-review-section">
                <h2>2. Decidir alunos não encontrados</h2>
                {pendingGradeImport.missingClasses.length > 0 && (
                  <p className="notice warning">
                    Turma(s) não encontrada(s): {pendingGradeImport.missingClasses.join(", ")}. Por segurança, a importação de notas não cria turmas automaticamente. Crie ou importe essas turmas antes de continuar.
                  </p>
                )}
                <div className="import-review-list compact">
                  {pendingGradeImport.missingItems.map((student, index) => (
                    <article className="import-review-item" key={`${student.className}-${student.studentName}-${index}`}>
                      <strong>{student.className} - {student.studentName}</strong>
                      <span>{student.withGrades.length ? `Com nota: ${student.withGrades.join("; ")}` : "Com nota: nenhuma"}</span>
                      <span>{student.missingGrades.length ? `Sem nota: ${student.missingGrades.join(", ")}` : "Sem nota: nenhuma"}</span>
                    </article>
                  ))}
                  {!pendingGradeImport.missingItems.length && <p className="empty">Não há outros alunos novos nesta etapa.</p>}
                </div>
              </section>
              <p className="notice warning">
                Primeiro conclua os nomes parecidos. Depois escolha o destino dos alunos realmente não encontrados. Itens marcados como "Não ? nenhum destes" também entram nessa decisão.
              </p>
            </div>
            <div className="import-review-actions">
              {hasUnconfirmedNameMatches && (
                <span className="import-review-lock">Confira todos os nomes parecidos para liberar a importação.</span>
              )}
              {hasMissingGradeImportClasses && !hasUnconfirmedNameMatches && (
                <span className="import-review-lock">Há turma não cadastrada. Cancele, importe/crie a turma e tente novamente.</span>
              )}
              <button
                type="button"
                disabled={hasUnconfirmedNameMatches || hasMissingGradeImportClasses}
                onClick={() =>
                  applyGradeImport({
                    blocks: pendingGradeImport.blocks,
                    fileName: pendingGradeImport.fileName,
                    periodId: pendingGradeImport.periodId,
                    updateExistingAssessments: pendingGradeImport.updateExistingAssessments,
                    createMissingStatus: "active",
                    nameResolutions: gradeImportResolutions(pendingGradeImport)
                  })
                }
              >
                Criar não encontrados como ativos
              </button>
              <button
                type="button"
                disabled={hasUnconfirmedNameMatches || hasMissingGradeImportClasses}
                onClick={() =>
                  applyGradeImport({
                    blocks: pendingGradeImport.blocks,
                    fileName: pendingGradeImport.fileName,
                    periodId: pendingGradeImport.periodId,
                    updateExistingAssessments: pendingGradeImport.updateExistingAssessments,
                    createMissingStatus: "left",
                    nameResolutions: gradeImportResolutions(pendingGradeImport)
                  })
                }
              >
                Registrar não encontrados como saiu da escola
              </button>
              <button
                className="secondary"
                type="button"
                disabled={hasUnconfirmedNameMatches || hasMissingGradeImportClasses}
                onClick={() =>
                  applyGradeImport({
                    blocks: pendingGradeImport.blocks,
                    fileName: pendingGradeImport.fileName,
                    periodId: pendingGradeImport.periodId,
                    updateExistingAssessments: pendingGradeImport.updateExistingAssessments,
                    createMissingStatus: "",
                    nameResolutions: gradeImportResolutions(pendingGradeImport)
                  })
                }
              >
                Ignorar não encontrados
              </button>
              <button className="secondary" type="button" onClick={() => setPendingGradeImport(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}
      {pendingAttendanceImport && (
        <section className="teacher-gate" aria-label="Revisão da importação de frequência">
          <div className="import-review-card">
            <div className="import-review-header">
              <div>
                <p className="eyebrow">Importar frequência</p>
                <h1>Conferência crítica</h1>
              </div>
              <button className="secondary" type="button" onClick={() => setPendingAttendanceImport(null)}>
                Cancelar
              </button>
            </div>
            <div className="import-review-body">
              <p>
                Encontramos divergências em nomes da importação de frequência. Confirme com cuidado antes de gravar, porque faltas lançadas no aluno errado alteram relatórios oficiais.
              </p>
              <div className="import-review-counts">
                <span>{visibleAttendanceNameMatches.length} nome(s) ainda sem confirmação</span>
                <span>{confirmedAttendanceNameMatchesCount} nome(s) conferido(s)</span>
                <span>{pendingAttendanceImport.missingItems.length} aluno(s) não encontrado(s)</span>
                <span>{pendingAttendanceImport.missingClasses.length} turma(s) não encontrada(s)</span>
              </div>
              {pendingAttendanceImport.nameMatches?.length > 0 && (
                <section className="import-review-section">
                  <h2>1. Conferir nomes parecidos</h2>
                  <p>Escolha o aluno correto e marque "Conferido".</p>
                  <div className="import-review-list">
                    {visibleAttendanceNameMatches.map((student) => (
                      <article className="import-review-item danger" key={student.importKey}>
                        <strong>{student.className} - {student.studentName}</strong>
                        {student.preview.map((item, index) => <span key={index}>{item}</span>)}
                        <label>
                          Confirmar se corresponde a:
                          <select
                            value={student.selectedStudentId}
                            onChange={(event) => updateAttendanceImportNameResolution(student.importKey, event.target.value)}
                          >
                            {student.candidates.map((candidate) => (
                              <option key={candidate.studentId} value={candidate.studentId}>
                                {candidate.name}
                              </option>
                            ))}
                            <option value="">Não é nenhum destes</option>
                          </select>
                        </label>
                        <label className="match-confirm-check">
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => confirmAttendanceImportName(student.importKey)}
                          />
                          Conferido
                        </label>
                      </article>
                    ))}
                    {!visibleAttendanceNameMatches.length && (
                      <p className="empty success-empty">Todos os nomes parecidos foram conferidos.</p>
                    )}
                  </div>
                </section>
              )}
              <section className="import-review-section">
                <h2>2. Conferir itens não encontrados</h2>
                {pendingAttendanceImport.missingClasses.length > 0 && (
                  <p className="notice warning">
                    Turma(s) não encontrada(s): {pendingAttendanceImport.missingClasses.join(", ")}. Por segurança, a importação de frequência não cria turmas automaticamente.
                  </p>
                )}
                <div className="import-review-list compact">
                  {pendingAttendanceImport.missingItems.map((student, index) => (
                    <article className="import-review-item" key={`${student.className}-${student.studentName}-${index}`}>
                      <strong>{student.className} - {student.studentName}</strong>
                      {student.preview.map((item, previewIndex) => <span key={previewIndex}>{item}</span>)}
                    </article>
                  ))}
                  {!pendingAttendanceImport.missingItems.length && <p className="empty">Não há outros alunos não encontrados nesta etapa.</p>}
                </div>
              </section>
              <p className="notice warning">
                Nomes marcados como "Não é nenhum destes" serão ignorados. Turmas inexistentes bloqueiam a importação até serem corrigidas.
              </p>
            </div>
            <div className="import-review-actions">
              {hasUnconfirmedAttendanceNameMatches && (
                <span className="import-review-lock">Confira todos os nomes parecidos para liberar a importação.</span>
              )}
              {hasMissingAttendanceImportClasses && !hasUnconfirmedAttendanceNameMatches && (
                <span className="import-review-lock">Há turma não cadastrada. Cancele, importe/crie a turma e tente novamente.</span>
              )}
              <button
                type="button"
                disabled={hasUnconfirmedAttendanceNameMatches || hasMissingAttendanceImportClasses}
                onClick={() =>
                  applyAttendanceImport({
                    lessonRecords: pendingAttendanceImport.lessonRecords,
                    summaryRecords: pendingAttendanceImport.summaryRecords,
                    fileName: pendingAttendanceImport.fileName,
                    nameResolutions: attendanceImportResolutions(pendingAttendanceImport)
                  })
                }
              >
                Importar e ignorar não encontrados
              </button>
              <button className="secondary" type="button" onClick={() => setPendingAttendanceImport(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}
      {isReportPanelOpen && (
        <section className="teacher-gate" aria-label="Gerar relatório">
          <div className="import-review-card report-card">
            <div className="import-review-header">
              <div>
                <p className="eyebrow">Relatórios</p>
                <h1>Gerar relatório</h1>
              </div>
              <button className="secondary" type="button" onClick={() => setIsReportPanelOpen(false)}>
                Cancelar
              </button>
            </div>
            <div className="import-review-body report-body">
              <section className="import-review-section">
                <h2>1. Escolha o tipo</h2>
                <div className="report-preset-grid">
                  {REPORT_PRESETS.map((preset) => (
                    <button
                      className={reportPreset === preset.id ? "report-preset selected" : "report-preset"}
                      key={preset.id}
                      type="button"
                      onClick={() => setReportPreset(preset.id)}
                    >
                      <strong>{preset.title}</strong>
                      <span>{preset.description}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="report-options">
                <label>
                  Formato
                  <select value={reportFormat} onChange={(event) => setReportFormat(event.target.value)}>
                    <option value="xlsx">Excel</option>
                    <option value="pdf">PDF</option>
                  </select>
                </label>
                <label>
                  Período
                  <select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}>
                    {PERIODS.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.label}
                      </option>
                    ))}
                    <option value={ANNUAL_PERIOD}>Anual</option>
                  </select>
                </label>
                {reportPreset === "attendance" && (
                  <>
                    <label>
                      Recorte da frequência
                      <select value={reportAttendanceScope} onChange={(event) => setReportAttendanceScope(event.target.value)}>
                        <option value="period">Período selecionado</option>
                        <option value="month">Mês específico</option>
                      </select>
                    </label>
                    {reportAttendanceScope === "month" && (
                      <label>
                        Mês
                        <select value={reportMonth} onChange={(event) => setReportMonth(event.target.value)}>
                          {(reportMonthOptions.length ? reportMonthOptions : [today().slice(0, 7)]).map((month) => (
                            <option key={month} value={month}>
                              {formatMonthKey(month)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </section>

              <p className="report-note">
                Cada tipo gera um relatório próprio. Use "Relatório completo" quando precisar do arquivo geral com todas as abas do diário.
              </p>
            </div>
            <div className="import-review-actions">
              <span className="import-review-lock">
                {selectedReportPreset.title} | {reportFormat === "pdf" ? "PDF" : "Excel"} |{" "}
                {reportPreset === "attendance" && reportAttendanceScope === "month" ? formatMonthKey(reportMonth) : periodLabel(reportPeriod)}
              </span>
              <button className="success" type="button" onClick={generateConfiguredReport}>
                <Download size={18} />
                Gerar relatório
              </button>
            </div>
          </div>
        </section>
      )}
      {syncReview && selectedSyncSummary && (
        <section className="teacher-gate" aria-label="Revisar sincronização">
          <div className="import-review-card sync-review-card">
            <div className="import-review-header">
              <div>
                <p className="eyebrow">{syncReview.mode === "merge" ? "Atualizar dados" : "Restaurar"}</p>
                <h1>Revisar arquivo</h1>
                <p>{syncReview.fileName}</p>
              </div>
              <button className="secondary" type="button" onClick={() => setSyncReview(null)}>
                Cancelar
              </button>
            </div>
            <div className="import-review-body sync-review-body">
              <section className="import-review-section">
                <h2>Versões disponíveis</h2>
                <div className="sync-version-list">
                  {syncReview.snapshots.map((snapshot) => {
                    const summary = summarizeSyncSnapshot(snapshot);
                    return (
                      <button
                        className={snapshot.id === selectedSyncSnapshot.id ? "sync-version selected" : "sync-version"}
                        key={snapshot.id}
                        type="button"
                        onClick={() => setSelectedSyncSnapshotId(snapshot.id)}
                      >
                        <strong>{snapshot.label}</strong>
                        <span>
                          {summary.classes} turma(s), {summary.students} aluno(s), {summary.assessments} avaliação(ões), {summary.gradeEntries} nota(s)
                        </span>
                        <small className={snapshot.integrityStatus === "verified" ? "integrity-ok" : "integrity-legacy"}>
                          {snapshot.integrityStatus === "verified" ? "Integridade verificada" : "Backup legado ? confirme a origem"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="import-review-section">
                <h2>O que existe nesta versão</h2>
                <div className="sync-summary-grid">
                  <span><strong>{selectedSyncSummary.classes}</strong> turma(s)</span>
                  <span><strong>{selectedSyncSummary.activeStudents}</strong> aluno(s) ativo(s)</span>
                  <span><strong>{selectedSyncSummary.lessons}</strong> aula(s)</span>
                  <span><strong>{selectedSyncSummary.lessonPeriods}</strong> tempo(s)</span>
                  <span><strong>{selectedSyncSummary.assessments}</strong> avaliação(ões)</span>
                  <span><strong>{selectedSyncSummary.gradeEntries}</strong> nota(s)</span>
                  <span><strong>{selectedSyncSummary.recoveries}</strong> recuperação(ões)</span>
                </div>
              </section>
              <section className="import-review-section">
                <h2>Turmas nesta versão</h2>
                <div className="sync-class-list">
                  {selectedSyncSummary.classSummaries.map((classItem) => (
                    <article className="sync-class-item" key={classItem.id}>
                      <strong>{classItem.name}</strong>
                      <span>{classItem.students} aluno(s)</span>
                      <span>{classItem.lessons} aula(s) / {classItem.lessonPeriods} tempo(s)</span>
                      <span>{classItem.assessments} avaliação(ões)</span>
                      <span>{classItem.gradeEntries} nota(s)</span>
                    </article>
                  ))}
                  {!selectedSyncSummary.classSummaries.length && <p className="empty">Esta versão não tem turmas.</p>}
                </div>
              </section>
              {selectedSyncImpact && (
                <section className="import-review-section sync-impact-section">
                  <h2>Impacto se continuar</h2>
                  {selectedSyncImpact.mode === "merge" ? (
                    <>
                      <div className="sync-impact-grid">
                        <span><strong>{selectedSyncImpact.summary.classesAdded}</strong> turma(s) nova(s)</span>
                        <span><strong>{selectedSyncImpact.summary.studentsAdded}</strong> aluno(s) novo(s)</span>
                        <span><strong>{selectedSyncImpact.summary.lessonsAdded}</strong> aula(s) nova(s)</span>
                        <span><strong>{selectedSyncImpact.summary.assessmentsAdded}</strong> avaliação(ões) nova(s)</span>
                        <span><strong>{selectedSyncImpact.summary.recoveriesAdded}</strong> recuperação(ões) nova(s)</span>
                        <span><strong>{selectedSyncImpact.summary.attendanceRecordsMerged}</strong> registro(s) de chamada</span>
                        <span><strong>{selectedSyncImpact.summary.gradeValuesMerged}</strong> nota(s) preenchida(s)</span>
                        <span className={selectedSyncImpact.summary.gradeConflicts ? "danger-stat" : ""}>
                          <strong>{selectedSyncImpact.summary.gradeConflicts}</strong> conflito(s) de nota
                        </span>
                      </div>
                      {selectedSyncImpact.conflictDetails.length > 0 && (
                        <div className="sync-conflict-list">
                          <strong>Conflitos encontrados</strong>
                          {selectedSyncImpact.conflictDetails.map((conflict, index) => (
                            <span key={`${conflict.className}-${conflict.studentName}-${conflict.label}-${index}`}>
                              {conflict.className} | {conflict.studentName} | {conflict.label}: fica {conflict.currentValue}, arquivo tem {conflict.incomingValue}
                            </span>
                          ))}
                          {selectedSyncImpact.summary.gradeConflicts > selectedSyncImpact.conflictDetails.length && (
                            <span>Mais {selectedSyncImpact.summary.gradeConflicts - selectedSyncImpact.conflictDetails.length} conflito(s) além destes.</span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="sync-restore-compare">
                      <article>
                        <strong>Dados atuais deste aparelho</strong>
                        <span>{selectedSyncImpact.currentSummary.classes} turma(s)</span>
                        <span>{selectedSyncImpact.currentSummary.activeStudents} aluno(s) ativo(s)</span>
                        <span>{selectedSyncImpact.currentSummary.lessons} aula(s)</span>
                        <span>{selectedSyncImpact.currentSummary.assessments} avaliação(ões)</span>
                        <span>{selectedSyncImpact.currentSummary.gradeEntries} nota(s)</span>
                      </article>
                      <article>
                        <strong>Versão escolhida</strong>
                        <span>{selectedSyncImpact.incomingSummary.classes} turma(s)</span>
                        <span>{selectedSyncImpact.incomingSummary.activeStudents} aluno(s) ativo(s)</span>
                        <span>{selectedSyncImpact.incomingSummary.lessons} aula(s)</span>
                        <span>{selectedSyncImpact.incomingSummary.assessments} avaliação(ões)</span>
                        <span>{selectedSyncImpact.incomingSummary.gradeEntries} nota(s)</span>
                      </article>
                    </div>
                  )}
                </section>
              )}
              <p className="notice warning">
                {syncReview.mode === "merge"
                  ? "Atualizar junta os dados desta versão aos dados atuais. Conflitos de nota mantêm o valor deste aparelho e são avisados no final."
                  : "Restaurar substitui os dados atuais por esta versão. Antes disso, o app guarda uma cópia de segurança local."}
              </p>
            </div>
            <div className="import-review-actions">
              <span className="import-review-lock">Versão escolhida: {selectedSyncSnapshot.label}</span>
              {syncReview.mode === "merge" ? (
                <>
                  <button className="secondary" type="button" onClick={() => setSyncReview((current) => ({ ...current, mode: "restore" }))}>
                    Restaurar esta versão
                  </button>
                  <button className="success" type="button" onClick={applySyncReview}>
                    Atualizar este dispositivo
                  </button>
                </>
              ) : (
                <>
                  <button className="secondary" type="button" onClick={() => setSyncReview((current) => ({ ...current, mode: "merge" }))}>
                    Voltar para atualizar dados
                  </button>
                  <button className="danger" type="button" onClick={applySyncReview}>
                    Restaurar esta versão
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      )}
      {settingsOpen && (
        <section className="teacher-gate" aria-label="Configurações">
          <form className="teacher-card settings-card" onSubmit={saveSettings}>
            <div className="import-review-header settings-header">
              <div>
                <p className="eyebrow">Configurações</p>
                <h1>Preferências do diário</h1>
              </div>
              <button className="secondary" type="button" onClick={() => setSettingsOpen(false)}>
                Cancelar
              </button>
            </div>
            <div className="settings-body">
              <label>
                Nome
                <input value={settingsTeacherDraft} onChange={(event) => setSettingsTeacherDraft(event.target.value)} />
              </label>
              <label>
                Disciplina
                <input value={settingsSubjectDraft} onChange={(event) => setSettingsSubjectDraft(event.target.value)} placeholder="Ex.: Matemática" />
              </label>
              <label>
                Casas decimais
                <select value={settingsDecimalsDraft} onChange={(event) => setSettingsDecimalsDraft(Number(event.target.value))}>
                  <option value={0}>0 casas</option>
                  <option value={1}>1 casa</option>
                  <option value={2}>2 casas</option>
                </select>
              </label>
              <section className="settings-backup" aria-label="Backup e sincronização">
                <div>
                  <p className="eyebrow">Salvar entre dispositivos</p>
                  <h2>Backup remoto</h2>
                  <p>
                    {supabaseInfo.configured
                      ? `Sincronização remota ativa no Supabase: ${supabaseInfo.url}`
                      : "Supabase não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar sincronização remota."}
                  </p>
                  <small>
                    Os dados do diário são salvos no Supabase e podem ser carregados de outros dispositivos com a mesma configuração.
                  </small>
                </div>
                <div className="settings-backup-actions">
                  <button className="secondary" type="button" disabled={remoteSyncLoading || !supabaseInfo.configured} onClick={() => loadLatestFromSupabase({ silent: false })}>
                    Atualizar do Supabase
                  </button>
                  <button className="secondary" type="button" disabled={remoteSyncLoading || !supabaseInfo.configured} onClick={() => saveToSupabase()}>
                    Salvar no Supabase
                  </button>
                </div>
                {remoteSnapshots.length > 0 && (
                  <div className="sync-folder-version-list">
                    <strong>Últimas versões no Supabase</strong>
                    {remoteSnapshots.slice(0, SYNC_HISTORY_LIMIT + 1).map((snapshot) => (
                      <div className="sync-version-row" key={snapshot.id}>
                        <span>
                          {new Intl.DateTimeFormat("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          }).format(new Date(snapshot.created_at))}
                          <small>{snapshot.label}</small>
                        </span>
                        <button
                          className="secondary"
                          type="button"
                          disabled={remoteSyncLoading}
                          onClick={() => openRemoteSnapshotReview(snapshot.id)}
                        >
                          Revisar e restaurar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <div className="import-review-actions settings-actions">
              <button className="secondary" type="button" onClick={() => setSettingsOpen(false)}>
                Fechar
              </button>
              <button className="success" type="submit">
                Salvar configurações
              </button>
            </div>
          </form>
        </section>
      )}
      {studentInfo && selectedClass && (
        <StudentInfoModalAnnual
          attendanceSummaries={data.attendanceSummaries ?? []}
          assessments={allClassAssessments}
          classItem={selectedClass}
          lessons={allClassLessons}
          onClose={() => setStudentInfoId("")}
          recoveries={data.recoveries ?? []}
          student={studentInfo}
        />
      )}
      <header className="topbar">
        <div className="brand-heading">
          <img className="school-logo" alt="CAp UFRJ" src={SCHOOL_LOGO_SRC} />
          <div>
          <p className="eyebrow">Sincronização remota via Supabase</p>
          <h1>{APP_TITLE}</h1>
          <p className="app-version">Versão {APP_VERSION}</p>
          <p className="teacher-name">Professor: {teacherName || "Não informado"}</p>
          <p className="teacher-name">Disciplina: {subjectName || "Não informada"}</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="primary-action" type="button" onClick={() => setIsReportPanelOpen(true)}>
            <ClipboardList size={18} />
            Relatórios
          </button>
          <details className="action-menu">
            <summary>
              <FileUp size={18} />
              Importar
            </summary>
            <div className="action-menu-panel">
              <label className="menu-file-button">
                Turma
                <span>CSV, Excel, texto ou PDF</span>
                <input accept=".csv,.txt,.xlsx,.xls,.xlse,.pdf" multiple type="file" onChange={importStudents} />
              </label>
              <label className="menu-file-button">
                Notas
                <span>Planilha Excel</span>
                <input accept=".xlsx,.xls,.xlse" type="file" onChange={importGrades} />
              </label>
              <label className="menu-file-button">
                Frequência
                <span>Excel ou CSV</span>
                <input accept=".xlsx,.xls,.xlse,.csv,.txt" type="file" onChange={importAttendance} />
              </label>
              <label className="menu-file-button">
                Backup (.json) — Mesclar
                <span>Junta com o que já está aqui, sem apagar nada</span>
                <input accept=".json" type="file" onChange={(event) => importBackup(event, "merge")} />
              </label>
              <label className="menu-file-button">
                Backup (.json) — Restaurar
                <span>Substitui os dados atuais pelo arquivo escolhido</span>
                <input accept=".json" type="file" onChange={(event) => importBackup(event, "restore")} />
              </label>
            </div>
          </details>
          <button className="primary-action save-action" type="button" disabled={remoteSyncLoading} onClick={() => saveToSupabase()}>
            <Download size={18} />
            {remoteSyncLoading ? "Salvando..." : "Salvar"}
          </button>
          <button className="primary-action" type="button" disabled={remoteSyncLoading} onClick={() => loadLatestFromSupabase({ silent: false })}>
            <RefreshCw size={18} />
            Atualizar
          </button>
          <button className="primary-action" type="button" disabled={remoteSyncLoading} onClick={() => restoreLocalBackup()}>
            <Share2 size={18} />
            Restaurar backup local
          </button>
          <button className="icon-settings" type="button" onClick={openSettings} aria-label="Configurações">
            <Pencil size={18} />
          </button>
        </div>
      </header>

      {importMessage && (
        <div className="notice notice-dismissible" role="status">
          <span>{importMessage}</span>
          {importUndo && importUndo.message === importMessage && (
            <button className="secondary" type="button" onClick={removeLastImport}>
              {importUndo.label}
            </button>
          )}
          <button className="secondary" type="button" onClick={() => { setImportMessage(""); setImportUndo(null); }}>Fechar</button>
        </div>
      )}

      <section className={showTermEditor ? "period-panel editing" : "period-panel"} aria-label="Período do diário">
        {autoSaveMessage && !importMessage && (
          <div className="notice autosave-notice" role="status">
            {autoSaveMessage}
          </div>
        )}
        <div className="period-main">
          <label>
            Período em exibição
            <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>
              {PERIODS.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label}
                </option>
              ))}
              <option value={ANNUAL_PERIOD}>Anual</option>
            </select>
          </label>
          <button className="secondary" type="button" onClick={() => setShowTermEditor((current) => !current)}>
            {showTermEditor ? "Ocultar períodos letivos" : "Editar períodos letivos"}
          </button>
          <small>
            No modo anual, as notas finais usam a média simples dos trimestres com avaliação lançada.
          </small>
        </div>
        <div className="period-insights" aria-label="Informações do período">
          {periodInsights.map((item) => (
            <article className="period-insight" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
          <button className="period-insight period-action" type="button" onClick={launchFirstTermRecovery}>
            <span>Lançar recuperação</span>
            <strong>1º trimestre</strong>
            <small>
              {!firstTermClosed
                ? `Disponível após ${formatShortDate(firstTermEnd)}`
                : firstTermRecoveryCount
                ? `${firstTermRecoveryCount} aluno(s) abaixo da média`
                : "Sem alunos abaixo da média"}
            </small>
          </button>
        </div>
        {showTermEditor && (
          <div className="term-editor">
            <div className="term-dates">
              {PERIODS.map((period) => {
                const term = schoolYear.terms?.[period.id] ?? DEFAULT_SCHOOL_YEAR.terms[period.id];
                const upat = schoolYear.milestones?.upat?.[period.id] ?? DEFAULT_SCHOOL_YEAR.milestones.upat[period.id];
                return (
                  <div className="term-date-card" key={period.id}>
                    <strong>{period.label}</strong>
                    <label>
                      Início do trimestre
                      <input type="date" value={term.start} onChange={(event) => updateTermDate(period.id, "start", event.target.value)} />
                    </label>
                    <label>
                      Fim do trimestre
                      <input type="date" value={term.end} onChange={(event) => updateTermDate(period.id, "end", event.target.value)} />
                    </label>
                    <label>
                      Inicio da UPAT
                      <input type="date" value={upat.start} onChange={(event) => updateUpatDate(period.id, "start", event.target.value)} />
                    </label>
                    <label>
                      Fim da UPAT
                      <input type="date" value={upat.end} onChange={(event) => updateUpatDate(period.id, "end", event.target.value)} />
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="term-date-card vacation-card">
              <strong>{vacationInfo?.label ?? "Férias/recesso"}</strong>
              <label>
                Inicio
                <input type="date" value={vacationInfo?.start ?? ""} onChange={(event) => updateVacationDate("start", event.target.value)} />
              </label>
              <label>
                Fim
                <input type="date" value={vacationInfo?.end ?? ""} onChange={(event) => updateVacationDate("end", event.target.value)} />
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="summary-grid">
        <div className="metric">
          <Users size={20} />
          <span>{stats.total}</span>
          <small>Alunos</small>
        </div>
        <div className="metric">
          <BookOpen size={20} />
          <span>{stats.lessons}</span>
          <small>Aulas</small>
        </div>
        <div className="metric active">
          <ClipboardList size={20} />
          <span>{stats.absences}</span>
          <small>Faltas</small>
        </div>
        <div className="metric">
          <Calculator size={20} />
          <span>{stats.assessments}</span>
          <small>Avaliações</small>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="section-title">
            <h2>Turmas</h2>
          </div>

          <form className="inline-form" onSubmit={addClass}>
            <input
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="Nova turma"
              aria-label="Nome da nova turma"
            />
            <button aria-label="Adicionar turma">
              <Plus size={18} />
            </button>
          </form>

          <div className="class-list">
            {data.classes.map((item) => (
              <button
                key={item.id}
                data-class-id={item.id}
                className={[
                  "class-item",
                  item.id === selectedClassId ? "selected" : "",
                  item.id === draggingClassId ? "dragging" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  if (!draggingClassId) setSelectedClassId(item.id);
                }}
                onPointerCancel={() => setDraggingClassId("")}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setDraggingClassId(item.id);
                }}
                onPointerMove={(event) => {
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-class-id]");
                  const targetId = target?.getAttribute("data-class-id") ?? "";
                  moveClass(draggingClassId || item.id, targetId);
                }}
                onPointerUp={() => setDraggingClassId("")}
              >
                <span>{item.name}</span>
                <small>{item.students.length}</small>
              </button>
            ))}
            {!data.classes.length && <p className="empty">Crie uma turma para comecar.</p>}
          </div>
        </aside>

        <section className="panel">
          <div className="section-title">
            <div>
              <h2>{selectedClass?.name ?? "Nenhuma turma"}</h2>
              <p>
                {view === "students"
                  ? "Lista de alunos da turma."
                  : view === "diary"
                    ? "Frequência e conteúdo da aula."
                    : "Notas, pesos e média final."}
              </p>
            </div>
            {selectedClass && (
              <button className="icon-button danger" onClick={removeClass} aria-label="Remover turma">
                <Trash2 size={18} />
              </button>
            )}
          </div>

          <div className="tabs" role="tablist" aria-label="Modo de trabalho">
            <button className={view === "students" ? "tab selected" : "tab"} onClick={() => setView("students")}>
              <Users size={17} />
              Alunos
            </button>
            <button className={view === "diary" ? "tab selected" : "tab"} onClick={() => setView("diary")}>
              <ClipboardList size={17} />
              Diário
            </button>
            <button className={view === "assessments" ? "tab selected" : "tab"} onClick={() => setView("assessments")}>
              <Calculator size={17} />
              Avaliações
            </button>
          </div>

          {selectedClass && view === "students" && (
            <>
              <form className="add-student" onSubmit={addStudent}>
                <input
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  placeholder="Nome do aluno"
                  aria-label="Nome do aluno"
                />
                <button>
                  <Plus size={18} />
                  Adicionar
                </button>
              </form>

              <label className="search-box">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aluno" />
              </label>

              <StudentList
                attendanceSummaries={data.attendanceSummaries ?? []}
                classAssessments={classAssessments}
                classId={selectedClassId}
                classLessons={classLessons}
                onShowInfo={(student) => setStudentInfoId(student.id)}
                periodId={selectedPeriod}
                recoveries={data.recoveries ?? []}
                students={filteredStudents}
              />
            </>
          )}

          {selectedClass && view === "diary" && (
            <form className="diary-form" onSubmit={saveLesson}>
              <div className="lesson-meta-grid">
                <label>
                  Data da aula
                  <input type="date" value={lessonDate} onChange={(event) => setLessonDate(event.target.value)} />
                </label>
                <label>
                  Aulas dadas
                  <input
                    inputMode="numeric"
                    min="1"
                    type="number"
                    value={lessonPeriodsCount}
                    onChange={(event) => setLessonPeriodsCount(event.target.value)}
                    placeholder="1"
                  />
                </label>
              </div>
              <label>
                Conteúdo ministrado
                <textarea
                  value={lessonContent}
                  onChange={(event) => setLessonContent(event.target.value)}
                  placeholder="Ex.: Revisão de equações do 1º grau e exercícios em sala"
                />
              </label>

              {lessonStatusMessage && <p className="notice success-notice">{lessonStatusMessage}</p>}

              {!isAttendanceOpen && (
                <div className="lesson-start-actions">
                  {editingLessonId && (
                    <button type="button" className="secondary" onClick={cancelLessonEdit}>
                      Cancelar edição
                    </button>
                  )}
                  <button type="button" className="success" disabled={!selectedActiveStudents.length} onClick={startLessonAttendance}>
                    <Plus size={18} />
                    Criar aula
                  </button>
                </div>
              )}

              {isAttendanceOpen && (
                <>
                  <div className="attendance-header">
                    <div>
                      <h3>Chamada da aula</h3>
                      {editingLessonId && <p>Editando aula salva</p>}
                    </div>
                    <div className="attendance-tools">
                      {editingLessonId && (
                        <button type="button" className="secondary" onClick={cancelLessonEdit}>
                          Cancelar edição
                        </button>
                      )}
                      <button type="button" className="secondary" onClick={() => setAttendance(Object.fromEntries(selectedActiveStudents.map((student) => [student.id, "present"])))}>
                        Marcar todos presentes
                      </button>
                      <button type="button" className="secondary" onClick={() => setAttendance(Object.fromEntries(selectedActiveStudents.map((student) => [student.id, ATTENDANCE_NOT_TAKEN])))}>
                        Não fiz chamada
                      </button>
                    </div>
                  </div>

                  <div className="attendance-list">
                    {selectedActiveStudents.map((student) => (
                      <article className="attendance-card" key={student.id}>
                        <StudentIdentity student={student} />
                        <div className="attendance-options" role="group" aria-label={`Frequência de ${student.name}`}>
                          {[
                            [ATTENDANCE_NOT_TAKEN, "Não chamada"],
                            ["present", "Presente"],
                            ["absent", "Falta"],
                            ["excused", "Justificada"]
                          ].map(([value, label]) => (
                            <button
                              className={(attendance[student.id] ?? ATTENDANCE_NOT_TAKEN) === value ? `attendance-option ${value} selected` : `attendance-option ${value}`}
                              key={value}
                              type="button"
                              onClick={() => setAttendance((current) => ({ ...current, [student.id]: value }))}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                    {!selectedClass.students.length && <p className="empty">Adicione ou importe alunos para fazer a chamada.</p>}
                    {selectedClass.students.length > 0 && !selectedActiveStudents.length && <p className="empty">Esta turma não tem alunos ativos para chamada.</p>}
                  </div>

                  <button className="success" disabled={!selectedActiveStudents.length}>
                    <CheckCircle2 size={18} />
                    {editingLessonId ? "Salvar correcao" : "Salvar aula"}
                  </button>
                </>
              )}
            </form>
          )}

          {selectedClass && view === "assessments" && (
            <section className="assessments-panel">
              {hasMixedAssessmentTypes && (
                <p className="notice warning">
                  Atenção: esta turma tem avaliações de Média e Soma. O sistema calcula a média ponderada das avaliações marcadas como Média e soma os pontos das avaliações marcadas como Soma.
                </p>
              )}

              {!assessmentKind && !editingAssessmentId && (
                <section className="assessment-kind-start" aria-label="Escolha do tipo de lançamento">
                  <h3>Escolha o tipo de lançamento</h3>
                  <div className="assessment-kind-grid">
                    {ASSESSMENT_KINDS.map((kind) => {
                      const enabled = kind.id === "makeup" ? canLaunchMakeup : kind.id === "recovery" ? canLaunchRecovery : kind.enabled;
                      const description =
                        kind.id === "makeup" && !canLaunchMakeup
                          ? "Sem alunos pendentes de segunda chamada neste período."
                          : kind.id === "recovery" && !canLaunchRecovery
                            ? selectedPeriod === ANNUAL_PERIOD
                              ? "Selecione um trimestre para lançar recuperação."
                              : !selectedTermClosed
                                ? `Disponível após ${formatShortDate(selectedTermEnd)}.`
                                : "Sem alunos em recuperação neste período."
                          : kind.description;
                      return (
                        <button
                          className={["assessment-kind-option", !enabled ? "disabled" : ""].filter(Boolean).join(" ")}
                          disabled={!enabled}
                          key={kind.id}
                          type="button"
                          onClick={() => setAssessmentKind(kind.id)}
                        >
                          <strong>{kind.title}</strong>
                          <small>{description}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {showAssessmentForm && (
              <form className="assessment-form" onSubmit={addAssessment}>
                <div className="assessment-form-heading">
                  <div>
                    <span>Tipo de lançamento</span>
                    <strong>{assessmentKindLabel(assessmentKind)}</strong>
                  </div>
                  {!editingAssessmentId && (
                    <button className="secondary" type="button" onClick={() => setAssessmentKind("")}>
                      Trocar tipo
                    </button>
                  )}
                </div>
                <label>
                  Nome da avaliação
                  <input
                    value={assessmentName}
                    onChange={(event) => setAssessmentName(event.target.value)}
                    placeholder="Ex.: Trabalho sobre frações"
                  />
                </label>
                <label className="assessment-description">
                  Descrição
                  <textarea
                    value={assessmentDescription}
                    onChange={(event) => setAssessmentDescription(event.target.value)}
                    placeholder="Orientações, tema, critérios ou data combinada"
                  />
                </label>
                <label>
                  Nota máxima
                  <input
                    inputMode="decimal"
                    value={assessmentMax}
                    onChange={(event) => setAssessmentMax(event.target.value)}
                    placeholder="10"
                  />
                </label>
                <label>
                  Peso
                  <input
                    inputMode="decimal"
                    value={assessmentWeight}
                    onChange={(event) => setAssessmentWeight(event.target.value)}
                    placeholder="1"
                  />
                </label>
                <label className="assessment-type-field">
                  Tipo de calculo
                  <div className="mode-options">
                    <button
                      className={assessmentType === "average" ? "mode-option selected" : "mode-option"}
                      type="button"
                      onClick={() => setAssessmentType("average")}
                    >
                      Média
                    </button>
                    <button
                      className={assessmentType === "sum" ? "mode-option selected" : "mode-option"}
                      type="button"
                      onClick={() => setAssessmentType("sum")}
                    >
                      Soma
                    </button>
                  </div>
                </label>
                <div className="assessment-actions">
                  <button type="submit" value="launch">
                    <Plus size={18} />
                    {editingAssessmentId ? "Salvar e lançar notas" : "Criar e lançar notas"}
                  </button>
                  {editingAssessmentId && (
                    <button className="secondary" type="button" onClick={cancelAssessmentEdit}>
                      Cancelar edição
                    </button>
                  )}
                  <button className="secondary" type="submit" value="later">
                    {editingAssessmentId ? "Salvar alterações" : "Lançar depois"}
                  </button>
                </div>
              </form>
              )}

              {assessmentKind === "makeup" && (
                <form className="makeup-panel" onSubmit={saveMakeupGrades}>
                  <div className="assessment-form-heading">
                    <div>
                      <span>Tipo de lançamento</span>
                      <strong>Segunda chamada</strong>
                    </div>
                    <button className="secondary" type="button" onClick={cancelMakeupEntry}>
                      Voltar
                    </button>
                  </div>
                  <label className="cross-class-toggle">
                    <input
                      type="checkbox"
                      checked={includeOtherClassesInMakeup}
                      onChange={(event) => setIncludeOtherClassesInMakeup(event.target.checked)}
                    />
                    <span>
                      Incluir alunos de outras turmas
                      <small>
                        {selectedMakeupStudentCount} nesta turma | {allMakeupStudentCount} em todas as turmas
                      </small>
                    </span>
                  </label>
                  {makeupGroups.map(({ assessment, classItem, students }) => (
                    <section className="makeup-group" key={assessment.id}>
                      <div className="makeup-group-header">
                        <div>
                          <strong>{assessment.name}</strong>
                          {includeOtherClassesInMakeup && <span>Turma {classItem?.name ?? assessment.className}</span>}
                          {assessment.description && <span>{assessment.description}</span>}
                        </div>
                        <small>
                          max {formatGrade(assessment.maxScore)} | peso {formatGrade(assessment.weight)}
                        </small>
                      </div>
                      <div className="makeup-list">
                        {students.map((student) => {
                          const key = `${assessment.id}:${student.id}`;
                          const draftValue = makeupDrafts[key] ?? "";
                          const markedMissing = isMissingGrade(draftValue);
                          return (
                            <label className="makeup-row" key={key}>
                              <StudentIdentity student={student} />
                              <input
                                inputMode="decimal"
                                placeholder="Nota da 2a chamada"
                                value={markedMissing ? "" : draftValue}
                                onChange={(event) => updateMakeupDraft(assessment.id, student.id, event.target.value)}
                              />
                              <button
                                type="button"
                                className={markedMissing ? "secondary no-show-button selected" : "secondary no-show-button"}
                                onClick={() => updateMakeupDraft(assessment.id, student.id, markedMissing ? "" : "missing")}
                              >
                                Não fez
                              </button>
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  <div className="assessment-actions">
                    <button type="submit">
                      <CheckCircle2 size={18} />
                      Salvar segunda chamada
                    </button>
                    <button className="secondary" type="button" onClick={cancelMakeupEntry}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {assessmentKind === "recovery" && (
                <form className="makeup-panel" onSubmit={saveRecoveryGrades}>
                  <div className="assessment-form-heading">
                    <div>
                      <span>Tipo de lançamento</span>
                      <strong>Recuperação - {periodLabel(selectedPeriod)}</strong>
                    </div>
                    <button className="secondary" type="button" onClick={cancelRecoveryEntry}>
                      Voltar
                    </button>
                  </div>
                  <label className="cross-class-toggle">
                    <input
                      type="checkbox"
                      checked={includeOtherClassesInRecovery}
                      onChange={(event) => setIncludeOtherClassesInRecovery(event.target.checked)}
                    />
                    <span>
                      Incluir alunos de outras turmas
                      <small>
                        {selectedRecoveryStudentCount} nesta turma | {allRecoveryStudentCount} em todas as turmas
                      </small>
                    </span>
                  </label>
                  <section className="makeup-group">
                    <div className="makeup-group-header">
                      <div>
                        <strong>Alunos abaixo da média</strong>
                        <span>Fórmula: (média trimestral + nota de recuperação) / 2. Se o resultado for menor, permanece a média atual.</span>
                      </div>
                    </div>
                    <div className="makeup-list">
                      {recoveryStudents.map(({ classItem, student, baseGrade, recoveryGrade }) => {
                        const draftKey = `${classItem.id}:${student.id}`;
                        const draftValue = recoveryDrafts[draftKey] ?? recoveryGrade ?? "";
                        const markedMissing = isMissingGrade(draftValue);
                        const previewGrade = applyRecoveryGrade(baseGrade, draftValue);
                        return (
                          <label className="recovery-row" key={draftKey}>
                            <StudentIdentity student={student} />
                            <span className="class-pill">Turma {classItem.name}</span>
                            <span>Média atual: {formatGrade(baseGrade)}</span>
                            <input
                              inputMode="decimal"
                              placeholder="Nota da recuperação"
                              value={markedMissing ? "" : draftValue}
                              onChange={(event) => updateRecoveryDraft(classItem.id, student.id, event.target.value)}
                            />
                            <button
                              type="button"
                              className={markedMissing ? "secondary no-show-button selected" : "secondary no-show-button"}
                              onClick={() => updateRecoveryDraft(classItem.id, student.id, markedMissing ? "" : "missing")}
                            >
                              Não fez
                            </button>
                            <span>Final: {formatGrade(previewGrade)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                  <div className="assessment-actions">
                    <button type="submit">
                      <CheckCircle2 size={18} />
                      Salvar recuperação
                    </button>
                    <button className="secondary" type="button" onClick={cancelRecoveryEntry}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {classAssessments.length ? (
                <>
                  <div className="assessment-summary">
                    {classAssessments.map((assessment) => {
                      const launched = selectedActiveStudents.filter(
                        (student) => normalize(assessment.grades?.[student.id]) || isMissingGrade(assessment.grades?.[student.id]) || hasMakeupGrade(assessment, student.id)
                      ).length;
                      const missing = selectedActiveStudents.filter((student) => isPendingGrade(assessment, student.id)).length;
                      const classAverage = calculateAssessmentClassAverage(assessment, selectedActiveStudents);
                      return (
                        <article className="assessment-card" key={assessment.id}>
                          <div>
                            <div className="assessment-title-line">
                              <strong>{assessment.name}</strong>
                              <span className={assessment.calculationType === "average" ? "calc-badge average" : "calc-badge sum"}>
                                {assessmentTypeLabel(assessment.calculationType)}
                              </span>
                              <span className="calc-badge kind">{assessmentKindLabel(assessmentKindFromData(assessment))}</span>
                              {assessmentAllowsMakeup(assessment) && <span className="calc-badge makeup">2a chamada</span>}
                            </div>
                            {assessment.description && <span>{assessment.description}</span>}
                            <small>
                              máx. {formatGrade(assessment.maxScore)} | peso {formatGrade(assessment.weight)} | {launched}/{selectedActiveStudents.length} com nota
                            </small>
                            <div className="assessment-stats">
                              <span>Média da turma: {formatGrade(classAverage)}</span>
                              <span className={missing > 0 ? "attention-text" : ""}>{missing} {assessmentAllowsMakeup(assessment) ? "faltaram" : "não entregaram"}</span>
                            </div>
                          </div>
                          <div className="assessment-card-actions">
                            <button type="button" className="secondary" onClick={() => focusAssessmentColumn(assessment.id)}>
                              Lançar notas
                            </button>
                            <button type="button" className="secondary" onClick={() => editAssessment(assessment)}>
                              Editar
                            </button>
                            <button type="button" className="mini-danger" onClick={() => removeAssessment(assessment.id)}>
                              Remover
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {activeAssessment && (
                  <div className="grades-wrap">
                    <div className="active-assessment-title">
                      <div>
                        <strong>
                          Lançamento: {activeAssessment.name} <span className={activeAssessment.calculationType === "average" ? "calc-badge average" : "calc-badge sum"}>{assessmentTypeLabel(activeAssessment.calculationType)}</span>
                          <span className="calc-badge kind">{assessmentKindLabel(assessmentKindFromData(activeAssessment))}</span>
                          {assessmentAllowsMakeup(activeAssessment) && <span className="calc-badge makeup">2a chamada</span>}
                        </strong>
                        {activeAssessment.description && <span>{activeAssessment.description}</span>}
                      </div>
                      <button type="button" className="secondary" onClick={() => setActiveAssessmentId("")}>
                        Fechar lançamento
                      </button>
                    </div>
                    <div className="grades-scroll">
                      <table className="grades-table">
                        <thead>
                          <tr>
                            <th>Aluno</th>
                            <th>
                                <div className="assessment-head">
                                  <strong>{activeAssessment.name}</strong>
                                  <span className={activeAssessment.calculationType === "average" ? "calc-badge average" : "calc-badge sum"}>
                                    {assessmentTypeLabel(activeAssessment.calculationType)}
                                  </span>
                                  <span className="calc-badge kind">{assessmentKindLabel(assessmentKindFromData(activeAssessment))}</span>
                                  {assessmentAllowsMakeup(activeAssessment) && <span className="calc-badge makeup">2a chamada</span>}
                                  {activeAssessment.description && <span>{activeAssessment.description}</span>}
                                  <small>
                                    max {formatGrade(activeAssessment.maxScore)} | peso {formatGrade(activeAssessment.weight)}
                                  </small>
                                </div>
                            </th>
                            <th>Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gradeRows.map((row) => (
                            <tr key={row.student.id}>
                              <td>
                                <StudentIdentity student={row.student} />
                              </td>
                                <td>
                                  <div className="grade-entry">
                                    <input
                                      data-assessment-id={activeAssessment.id}
                                      data-grade-input
                                      disabled={isMissingGrade(activeAssessment.grades?.[row.student.id])}
                                      inputMode="decimal"
                                      max={activeAssessment.maxScore}
                                      min="0"
                                      value={isMissingGrade(activeAssessment.grades?.[row.student.id]) ? "" : activeAssessment.grades?.[row.student.id] ?? ""}
                                      onChange={(event) => updateGrade(activeAssessment.id, row.student.id, event.target.value)}
                                      onKeyDown={(event) => handleGradeKeyDown(event, activeAssessment.id, row.student.id)}
                                      placeholder={`0-${formatGrade(activeAssessment.maxScore)}`}
                                    />
                                    <button
                                      className={isMissingGrade(activeAssessment.grades?.[row.student.id]) ? "missing-toggle selected" : "missing-toggle"}
                                      type="button"
                                      onClick={() =>
                                        updateGrade(
                                          activeAssessment.id,
                                          row.student.id,
                                          isMissingGrade(activeAssessment.grades?.[row.student.id]) ? "" : "missing"
                                        )
                                      }
                                    >
                                      {missingAssessmentLabel(activeAssessment)}
                                    </button>
                                  </div>
                              </td>
                              <td>
                                <strong className={row.finalGrade === null ? "grade-open" : row.approved ? "grade-ok" : "grade-low"}>
                                  {row.finalGrade === null ? "Em aberto" : formatGrade(row.finalGrade)}
                                </strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="grades-mobile-list">
                      {gradeRows.map((row) => {
                        const currentValue = activeAssessment.grades?.[row.student.id];
                        const markedMissing = isMissingGrade(currentValue);
                        return (
                          <article className="grade-mobile-card" key={row.student.id}>
                            <StudentIdentity student={row.student} />
                            <div className="grade-mobile-fields">
                              <label>
                                Nota
                                <input
                                  data-assessment-id={activeAssessment.id}
                                  data-grade-input
                                  disabled={markedMissing}
                                  inputMode="decimal"
                                  max={activeAssessment.maxScore}
                                  min="0"
                                  value={markedMissing ? "" : currentValue ?? ""}
                                  onChange={(event) => updateGrade(activeAssessment.id, row.student.id, event.target.value)}
                                  onKeyDown={(event) => handleGradeKeyDown(event, activeAssessment.id, row.student.id)}
                                  placeholder={`0-${formatGrade(activeAssessment.maxScore)}`}
                                />
                              </label>
                              <button
                                className={markedMissing ? "missing-toggle selected" : "missing-toggle"}
                                type="button"
                                onClick={() =>
                                  updateGrade(
                                    activeAssessment.id,
                                    row.student.id,
                                    markedMissing ? "" : "missing"
                                  )
                                }
                              >
                                Não fez
                                <small>{missingAssessmentLabel(activeAssessment)}</small>
                              </button>
                            </div>
                            <div className="grade-mobile-final">
                              <span>Final</span>
                              <strong className={row.finalGrade === null ? "grade-open" : row.approved ? "grade-ok" : "grade-low"}>
                                {row.finalGrade === null ? "Em aberto" : formatGrade(row.finalGrade)}
                              </strong>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <div className="grades-footer">
                      <p>Notas em branco contam como 0. Use vírgula para decimais, por exemplo 9,5. Digite j para marcar {missingAssessmentLabel(activeAssessment)}.</p>
                      <button className="success" type="button" onClick={finishGradeEntry}>
                        <CheckCircle2 size={18} />
                        Finalizar lançamento
                      </button>
                    </div>
                  </div>
                  )}
                </>
              ) : (
                <p className="empty">Crie uma avaliação para lançar notas.</p>
              )}
            </section>
          )}

          {!selectedClass && <p className="empty">Adicione uma turma para liberar o controle.</p>}
        </section>

        <section className="history">
          <div className="section-title">
            <h2>Registros</h2>
            <Clock3 size={18} />
          </div>
          <div className="history-list">
            {classLessons.slice(0, 8).map((lesson) => (
              <article className="lesson-item" key={lesson.id}>
                <div>
                  <strong>{new Intl.DateTimeFormat("pt-BR").format(new Date(`${lesson.date}T12:00:00`))}</strong>
                  <span>{lesson.content}</span>
                  <small>
                    {lessonAttendanceTaken(lesson)
                      ? `${lesson.attendance.filter((item) => item.status === "present").length} presentes de ${lesson.attendance.length}`
                      : "Chamada não feita"}{" "}
                    | {lesson.attendance.filter((item) => item.status === "absent").length * lessonPeriods(lesson)} falta(s) |{" "}
                    {lessonPeriods(lesson)} aula(s)
                  </small>
                </div>
                <div className="lesson-actions">
                  <button className="icon-button secondary" onClick={() => editLesson(lesson)} aria-label="Editar aula">
                    <Pencil size={17} />
                  </button>
                  <button className="icon-button danger" onClick={() => removeLesson(lesson.id)} aria-label="Remover aula">
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}

            {!classLessons.length && <p className="empty">Os registros aparecem aqui.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function StudentList({ students, classLessons = [], classAssessments = [], classId = "", periodId = "", recoveries = [], attendanceSummaries = [], onShowInfo }) {
  return (
    <div className="student-list">
      {students.map((student) => (
        <article className={isActiveStudent(student) ? "student-card" : "student-card inactive"} key={student.id}>
          <div className="student-card-content">
            <StudentIdentity student={student} size="large" />
            <StudentTags
              assessments={classAssessments}
              attendanceSummaries={attendanceSummaries}
              classId={classId}
              lessons={classLessons}
              periodId={periodId}
              recoveries={recoveries}
              student={student}
            />
          </div>
          <div className="student-card-actions compact">
            <button className="secondary info-button" type="button" onClick={() => onShowInfo?.(student)}>
              <Info size={17} />
              Informações
            </button>
          </div>
        </article>
      ))}
      {!students.length && <p className="empty">Nenhum aluno encontrado.</p>}
    </div>
  );
}

function StudentInfoModalAnnual({ student, classItem, lessons, assessments, recoveries, attendanceSummaries = [], onClose }) {
  const reportRef = useRef(null);
  const [shareMessage, setShareMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const termSummaries = PERIODS.map((period) => {
    const termLessons = lessons.filter((lesson) => lesson.periodId === period.id);
    const termAssessments = assessments.filter((assessment) => assessment.periodId === period.id);
    const lessonTotal = studentAttendanceTotal(termLessons, attendanceSummaries, classItem.id, student, period.id);
    const absences = studentAbsenceTotal(termLessons, attendanceSummaries, classItem.id, student, period.id);
    const excused = studentExcusedTotal(termLessons, attendanceSummaries, classItem.id, student, period.id);
    const absencePercent = lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%";
    const baseGrade = termAssessments.length ? calculateFinalGrade(student.id, termAssessments) : null;
    const recoveryGrade = recoveryGradeForStudent(recoveries, classItem.id, period.id, student.id);
    const finalGrade = baseGrade === null ? null : applyRecoveryGrade(baseGrade, recoveryGrade);
    const pendingAssessments = termAssessments.filter((assessment) => isPendingGrade(assessment, student.id));
    const absentLessons = termLessons.filter((lesson) => lessonRecordForStudent(lesson, student)?.status === "absent");
    const excusedLessons = termLessons.filter((lesson) => lessonRecordForStudent(lesson, student)?.status === "excused");
    const importedSummaries = matchingAttendanceSummaries(attendanceSummaries, classItem.id, student, period.id);

    return {
      period,
      assessments: termAssessments,
      lessonTotal,
      absences,
      excused,
      absencePercent,
      baseGrade,
      recoveryGrade,
      finalGrade,
      pendingAssessments,
      absentLessons,
      excusedLessons,
      importedSummaries
    };
  });
  const gradedTerms = termSummaries.filter((summary) => summary.finalGrade !== null);
  const annualGrade = gradedTerms.length
    ? gradedTerms.reduce((total, summary) => total + summary.finalGrade, 0) / gradedTerms.length
    : null;
  const totalLessons = studentAttendanceTotal(lessons, attendanceSummaries, classItem.id, student, ANNUAL_PERIOD);
  const totalAbsences = studentAbsenceTotal(lessons, attendanceSummaries, classItem.id, student, ANNUAL_PERIOD);
  const totalPending = termSummaries.reduce((total, summary) => total + summary.pendingAssessments.length, 0);
  async function shareStudentInfo() {
    const report = reportRef.current;
    if (!report) return;
    const body = report.querySelector(".student-info-body");
    const originalStyles = {
      reportMaxHeight: report.style.maxHeight,
      reportOverflow: report.style.overflow,
      bodyMaxHeight: body?.style.maxHeight ?? "",
      bodyHeight: body?.style.height ?? "",
      bodyOverflow: body?.style.overflow ?? ""
    };
    setIsSharing(true);
    try {
      report.style.maxHeight = "none";
      report.style.overflow = "visible";
      if (body) {
        body.style.maxHeight = "none";
        body.style.height = "auto";
        body.style.overflow = "visible";
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(report, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const margin = 10;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;
      const image = canvas.toDataURL("image/png");
      let remainingHeight = imageHeight;
      let imageTop = margin;
      pdf.addImage(image, "PNG", margin, imageTop, printableWidth, imageHeight);
      remainingHeight -= printableHeight;
      while (remainingHeight > 0) {
        imageTop -= printableHeight;
        pdf.addPage();
        pdf.addImage(image, "PNG", margin, imageTop, printableWidth, imageHeight);
        remainingHeight -= printableHeight;
      }
      const blob = pdf.output("blob");
      const filename = `relatorio ${fileSafeName(student.name) || "aluno"}.pdf`;
      const nativeShare = window.Capacitor?.Plugins?.Share;
      if (isNativePlatform() && nativeShare) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const saved = await Filesystem.writeFile({
          path: filename,
          data: String(dataUrl).split(",")[1],
          directory: Directory.Cache,
          recursive: true
        });
        await nativeShare.share({ title: `Informações de ${student.name}`, text: `Relatório de ${student.name}`, url: saved.uri, dialogTitle: "Compartilhar relatório do aluno" });
        setShareMessage("PDF pronto para compartilhar.");
        return;
      }
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "Relatório em PDF", accept: { "application/pdf": [".pdf"] } }]
        });
        const writer = await handle.createWritable();
        await writer.write(blob);
        await writer.close();
        setShareMessage(`PDF salvo em ${handle.name}.`);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        setShareMessage("PDF exportado.");
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      setShareMessage("Não foi possível gerar o relatório visual.");
    } finally {
      report.style.maxHeight = originalStyles.reportMaxHeight;
      report.style.overflow = originalStyles.reportOverflow;
      if (body) {
        body.style.maxHeight = originalStyles.bodyMaxHeight;
        body.style.height = originalStyles.bodyHeight;
        body.style.overflow = originalStyles.bodyOverflow;
      }
      setIsSharing(false);
    }
  }

  return (
    <section className="teacher-gate student-info-gate" aria-label={`Informações de ${student.name}`}>
      <article className="student-info-card" ref={reportRef}>
        <div className="student-info-header">
          <StudentIdentity student={student} />
          <div>
            <p className="eyebrow">Informações do aluno</p>
            <h1>{student.name}</h1>
            <span>Turma {classItem.name} | Resumo anual por trimestre</span>
            {!isActiveStudent(student) && <strong className="status out">Saiu da escola</strong>}
          </div>
          <div className="student-info-actions">
            <button className="secondary" type="button" disabled={isSharing} onClick={shareStudentInfo}>
              <Share2 size={17} />
              {isSharing ? "Gerando PDF..." : "Compartilhar PDF"}
            </button>
            <button className="secondary" type="button" onClick={onClose}>
              Fechar
            </button>
            {shareMessage && <small>{shareMessage}</small>}
          </div>
        </div>

        <div className="student-info-body">
          <section className="student-info-grid">
            <article>
              <span>Média anual parcial</span>
              <strong className={annualGrade !== null && annualGrade < 6 ? "grade-low" : "grade-ok"}>
                {annualGrade === null ? "Em aberto" : formatGrade(annualGrade)}
              </strong>
              <small>Calculada com trimestres que têm avaliação</small>
            </article>
            <article>
              <span>Faltas no ano</span>
              <strong>{totalAbsences}/{totalLessons}</strong>
              <small>{totalLessons ? formatPercent((totalAbsences / totalLessons) * 100) : "0%"} de faltas registradas</small>
            </article>
            <article>
              <span>Avaliações</span>
              <strong>{assessments.length}</strong>
              <small>Registradas em todos os trimestres</small>
            </article>
            <article>
              <span>Pendências</span>
              <strong>{totalPending}</strong>
              <small>{totalPending ? "Há pendências em pelo menos um trimestre" : "Sem pendências"}</small>
            </article>
          </section>

          {termSummaries.map((summary) => (
            <section className="student-info-section term-info-section" key={summary.period.id}>
              <div className="term-info-header">
                <h2>{summary.period.label}</h2>
                <div>
                  <span className={summary.finalGrade !== null && summary.finalGrade < 6 ? "grade-low" : "grade-ok"}>
                    Média: {summary.finalGrade === null ? "Em aberto" : formatGrade(summary.finalGrade)}
                  </span>
                  {normalize(summary.recoveryGrade) && <span>Recuperação: {summary.recoveryGrade}</span>}
                  <span>Faltas: {summary.absences}/{summary.lessonTotal} ({summary.absencePercent})</span>
                  <span>Pendências: {summary.pendingAssessments.length ? pendingAssessmentSummary(summary.pendingAssessments) : "nenhuma"}</span>
                </div>
              </div>

              <div className="student-info-table-wrap">
                <table className="student-info-table">
                  <thead>
                    <tr>
                      <th>Avaliação</th>
                      <th>Tipo</th>
                      <th>Nota</th>
                      <th>2ª chamada</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.assessments.map((assessment) => {
                      const originalValue = assessment.grades?.[student.id];
                      const makeupValue = assessment.makeupGrades?.[student.id];
                      const hasMakeup = hasMakeupGrade(assessment, student.id) && !isMissingGrade(makeupValue);
                      const pending = isPendingGrade(assessment, student.id);
                      return (
                        <tr key={assessment.id}>
                          <td>
                            <strong>{assessment.name}</strong>
                            {assessment.description && <small>{assessment.description}</small>}
                          </td>
                          <td>{assessmentKindLabel(assessmentKindFromData(assessment))}</td>
                          <td>{isMissingGrade(originalValue) ? missingAssessmentLabel(assessment) : normalize(originalValue) ? originalValue : "0"}</td>
                          <td>{makeupDisplayValue(makeupValue)}</td>
                          <td>{pending ? "Pendente" : hasMakeup ? "Resolvida na 2ª chamada" : "Lançada"}</td>
                        </tr>
                      );
                    })}
                    {!summary.assessments.length && (
                      <tr>
                        <td colSpan="5">Nenhuma avaliação lançada neste trimestre.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="student-info-list">
                {summary.absentLessons.map((lesson) => (
                  <span key={lesson.id}>
                    Falta em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${lesson.date}T12:00:00`))}: {lesson.content || "Aula registrada"} ({lessonPeriods(lesson)} aula(s))
                  </span>
                ))}
                {summary.excusedLessons.map((lesson) => (
                  <span key={`excused-${lesson.id}`}>
                    Justificada em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${lesson.date}T12:00:00`))}: {lesson.content || "Aula registrada"} ({lessonPeriods(lesson)} aula(s))
                  </span>
                ))}
                {summary.importedSummaries.map((item) => (
                  <span key={item.id}>
                    Saldo importado ({item.source}): {item.absences} falta(s) em {item.lessonTotal} aula(s) consideradas.
                  </span>
                ))}
                {!summary.absentLessons.length && !summary.excusedLessons.length && !summary.importedSummaries.length && <span>Sem faltas registradas neste trimestre.</span>}
              </div>
            </section>
          ))}
        </div>
      </article>
    </section>
  );
}

function StudentInfoModal({ student, classItem, lessons, assessments, recoveries, attendanceSummaries = [], periodId, onClose }) {
  const lessonTotal = studentAttendanceTotal(lessons, attendanceSummaries, classItem.id, student, periodId);
  const absences = studentAbsenceTotal(lessons, attendanceSummaries, classItem.id, student, periodId);
  const excused = studentExcusedTotal(lessons, attendanceSummaries, classItem.id, student, periodId);
  const absencePercent = lessonTotal ? formatPercent((absences / lessonTotal) * 100) : "0%";
  const baseGrade = assessments.length ? calculateFinalGrade(student.id, assessments) : null;
  const recoveryGrade = periodId === ANNUAL_PERIOD ? "" : recoveryGradeForStudent(recoveries, classItem.id, periodId, student.id);
  const finalGrade = baseGrade === null ? null : periodId === ANNUAL_PERIOD ? baseGrade : applyRecoveryGrade(baseGrade, recoveryGrade);
  const pendingAssessments = assessments.filter((assessment) => isPendingGrade(assessment, student.id));
  const absentLessons = lessons.filter((lesson) => lessonRecordForStudent(lesson, student)?.status === "absent");
  const excusedLessons = lessons.filter((lesson) => lessonRecordForStudent(lesson, student)?.status === "excused");
  const importedSummaries = matchingAttendanceSummaries(attendanceSummaries, classItem.id, student, periodId);

  return (
    <section className="teacher-gate student-info-gate" aria-label={`Informações de ${student.name}`}>
      <article className="student-info-card">
        <div className="student-info-header">
          <StudentIdentity student={student} />
          <div>
            <p className="eyebrow">Informações do aluno</p>
            <h1>{student.name}</h1>
            <span>Turma {classItem.name} | {periodId === ANNUAL_PERIOD ? "Ano letivo" : periodLabel(periodId)}</span>
            {!isActiveStudent(student) && <strong className="status out">Saiu da escola</strong>}
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="student-info-body">
          <section className="student-info-grid">
            <article>
              <span>Média atual</span>
              <strong className={finalGrade !== null && finalGrade < 6 ? "grade-low" : "grade-ok"}>
                {finalGrade === null ? "Em aberto" : formatGrade(finalGrade)}
              </strong>
              {normalize(recoveryGrade) && <small>Recuperação lançada: {recoveryGrade}</small>}
            </article>
            <article>
              <span>Faltas</span>
              <strong>{absences}/{lessonTotal}</strong>
              <small>{absencePercent} de faltas no período</small>
            </article>
            <article>
              <span>Justificadas</span>
              <strong>{excused}</strong>
              <small>{excusedLessons.length} registro(s) justificado(s)</small>
            </article>
            <article>
              <span>Pendências</span>
              <strong>{pendingAssessments.length}</strong>
              <small>{pendingAssessments.length ? pendingAssessmentSummary(pendingAssessments) : "Sem pendências"}</small>
            </article>
          </section>

          <section className="student-info-section">
            <h2>Notas e avaliações</h2>
            <div className="student-info-table-wrap">
              <table className="student-info-table">
                <thead>
                  <tr>
                    <th>Avaliação</th>
                    <th>Tipo</th>
                    <th>Nota</th>
                    <th>2ª chamada</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((assessment) => {
                    const originalValue = assessment.grades?.[student.id];
                    const makeupValue = assessment.makeupGrades?.[student.id];
                    const hasMakeup = hasMakeupGrade(assessment, student.id) && !isMissingGrade(makeupValue);
                    const pending = isPendingGrade(assessment, student.id);
                    return (
                      <tr key={assessment.id}>
                        <td>
                          <strong>{assessment.name}</strong>
                          {assessment.description && <small>{assessment.description}</small>}
                        </td>
                        <td>{assessmentKindLabel(assessmentKindFromData(assessment))}</td>
                        <td>{isMissingGrade(originalValue) ? missingAssessmentLabel(assessment) : normalize(originalValue) ? originalValue : "0"}</td>
                        <td>{makeupDisplayValue(makeupValue)}</td>
                        <td>{pending ? "Pendente" : hasMakeup ? "Resolvida na 2ª chamada" : "Lançada"}</td>
                      </tr>
                    );
                  })}
                  {!assessments.length && (
                    <tr>
                      <td colSpan="5">Nenhuma avaliação lançada neste período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="student-info-section">
            <h2>Frequência</h2>
            <div className="student-info-list">
              {absentLessons.map((lesson) => (
                <span key={lesson.id}>
                  Falta em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${lesson.date}T12:00:00`))}: {lesson.content || "Aula registrada"} ({lessonPeriods(lesson)} aula(s))
                </span>
              ))}
              {excusedLessons.map((lesson) => (
                <span key={`excused-${lesson.id}`}>
                  Justificada em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${lesson.date}T12:00:00`))}: {lesson.content || "Aula registrada"} ({lessonPeriods(lesson)} aula(s))
                </span>
              ))}
              {importedSummaries.map((item) => (
                <span key={item.id}>
                  Saldo importado ({item.source}): {item.absences} falta(s) em {item.lessonTotal} aula(s) consideradas.
                </span>
              ))}
              {!absentLessons.length && !excusedLessons.length && !importedSummaries.length && <span>Sem faltas registradas neste período.</span>}
            </div>
          </section>
        </div>
      </article>
    </section>
  );
}

function StudentTags({ student, lessons, assessments, classId, periodId, recoveries, attendanceSummaries = [] }) {
  const lessonTotal = studentAttendanceTotal(lessons, attendanceSummaries, classId, student, periodId);
  const absences = studentAbsenceTotal(lessons, attendanceSummaries, classId, student, periodId);
  const excused = studentExcusedTotal(lessons, attendanceSummaries, classId, student, periodId);
  const absencePercent = lessonTotal ? Math.round((absences / lessonTotal) * 100) : 0;
  const launchedAssessments = assessments.filter((assessment) => !isPendingGrade(assessment, student.id));
  const missingAssessments = assessments.filter((assessment) => isPendingGrade(assessment, student.id));
  const baseGrade = assessments.length ? calculateFinalGrade(student.id, assessments) : null;
  const recoveryGrade = periodId && periodId !== ANNUAL_PERIOD
    ? recoveryGradeForStudent(recoveries, classId, periodId, student.id)
    : null;
  const finalGrade = baseGrade === null ? null : applyRecoveryGrade(baseGrade, recoveryGrade);
  const launchedSummary = launchedAssessments.slice(0, 3).map((assessment) => {
    const value = effectiveGradeValue(assessment, student.id);
    const grade = isMissingGrade(value) ? "0" : value || "0";
    return `${assessment.name}: ${grade}`;
  });
  const missingPreview = pendingAssessmentSummary(missingAssessments.slice(0, 2));

  return (
    <div className="student-tags">
      <span className={absencePercent >= 25 ? "tag warn" : "tag"}>Faltas: {absences}/{lessonTotal} ({absencePercent}%)</span>
      {excused > 0 && <span className="tag">Justificadas: {excused}</span>}
      {baseGrade !== null && <span className={baseGrade < 6 ? "tag warn" : "tag ok"}>Média: {formatGrade(baseGrade)}</span>}
      {normalize(recoveryGrade) && (
        <span className={finalGrade < 6 ? "tag recovery-result warn" : "tag recovery-result ok"}>
          Após rec.: {formatGrade(finalGrade)}
        </span>
      )}
      {launchedSummary.length > 0 && <span className="tag wide">Notas registradas: {launchedSummary.join("; ")}</span>}
      {missingAssessments.length > 0 && (
        <span className="tag warn wide">
          {missingPreview}
          {missingAssessments.length > 2 ? ` +${missingAssessments.length - 2}` : ""}
        </span>
      )}
      {!isActiveStudent(student) && <span className="tag inactive">Saiu da escola</span>}
    </div>
  );
}

function StudentIdentity({ student, size = "default" }) {
  const initials = normalize(student.name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className={size === "large" ? "student-identity large" : "student-identity"}>
      {student.photo && isActiveStudent(student) ? <img alt="" src={student.photo} /> : <span>{initials}</span>}
      <strong>{student.name}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (import.meta.env.DEV || window.Capacitor?.isNativePlatform?.()) {
      navigator.serviceWorker.getRegistrations?.().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js");
  });
}

