import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CURRENT_TABLE = import.meta.env.VITE_SUPABASE_CURRENT_TABLE ?? "diario_current";
const SNAPSHOT_TABLE = import.meta.env.VITE_SUPABASE_SNAPSHOT_TABLE ?? "diario_snapshots";

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

export function supabaseStatus() {
  return {
    configured: isSupabaseConfigured(),
    url: SUPABASE_URL
  };
}

function requireClient() {
  if (!supabase) {
    throw new Error("Supabase não está configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}

// --- Autenticação ---------------------------------------------------------

export async function signUpWithEmail(email, password, { teacherName, subjectName } = {}) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { data: { teacher_name: teacherName ?? "", subject_name: subjectName ?? "" } }
  });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe() {} } } };
  return supabase.auth.onAuthStateChange(callback);
}

export async function sendPasswordResetEmail(email) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await requireClient().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// --- Dados do diário (escopados por usuário) ------------------------------

export async function fetchCurrentState(userId) {
  const { data, error } = await requireClient()
    .from(CURRENT_TABLE)
    .select("payload,updated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCurrentState(userId, payload) {
  const { data, error } = await requireClient()
    .from(CURRENT_TABLE)
    .upsert({ id: userId, payload }, { onConflict: "id" })
    .select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchLatestSnapshots(userId, limit = 10) {
  const { data, error } = await requireClient()
    .from(SNAPSHOT_TABLE)
    .select("id,label,created_at,source_device,source_device_id,teacher_name,subject_name,sync_schema_version")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchSnapshotById(userId, snapshotId) {
  const { data, error } = await requireClient()
    .from(SNAPSHOT_TABLE)
    .select("payload,id,label,created_at")
    .eq("user_id", userId)
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSnapshot(userId, snapshot) {
  const { data, error } = await requireClient()
    .from(SNAPSHOT_TABLE)
    .insert([{ ...snapshot, user_id: userId }])
    .select();
  if (error) throw error;
  return data?.[0] ?? null;
}
