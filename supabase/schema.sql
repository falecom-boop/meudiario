-- Diário de Classe · Schema do Supabase (v3 — salvamento por ação)
-- Como usar: Supabase Dashboard > SQL Editor > New query > cole tudo > Run.
--
-- Este script é seguro pra rodar de novo (usa IF NOT EXISTS / OR REPLACE) —
-- não apaga as tabelas existentes nem os dados reais já salvos.

-- 1) Estado atual do diário — uma linha por professor, id = id do usuário logado
create table if not exists public.diario_current (
  id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Mantém updated_at sempre atualizado em cada UPDATE/upsert
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_diario_current_updated_at on public.diario_current;
create trigger trg_diario_current_updated_at
  before update on public.diario_current
  for each row execute function public.set_updated_at();

-- 2) Histórico de snapshots/backups — várias linhas por professor
create table if not exists public.diario_snapshots (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  source_device text,
  source_device_id text,
  teacher_name text,
  subject_name text,
  sync_schema_version integer,
  payload jsonb not null
);

create index if not exists idx_diario_snapshots_user_created
  on public.diario_snapshots (user_id, created_at desc);

-- 3) Ações — cada edição (uma nota, uma falta, uma turma) grava só o que
-- mudou aqui, em vez do diário inteiro. Linhas pequenas de propósito, pra
-- caber com folga na garantia do navegador de enviar mesmo se a aba fechar
-- na hora. Periodicamente essas linhas são compactadas dentro de
-- diario_current e apagadas daqui (ver compactToSnapshot no app).
create table if not exists public.diario_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  patch jsonb not null
);

create index if not exists idx_diario_actions_user_created
  on public.diario_actions (user_id, created_at asc);

-- 4) RLS
-- Cada professor só pode ler/escrever a própria linha (id/user_id =
-- auth.uid()). O papel "anon" não tem acesso nenhum a essas tabelas.

alter table public.diario_current enable row level security;
alter table public.diario_snapshots enable row level security;
alter table public.diario_actions enable row level security;

drop policy if exists "anon full access" on public.diario_current;
drop policy if exists "own current" on public.diario_current;
create policy "own current" on public.diario_current
  for all
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "anon full access" on public.diario_snapshots;
drop policy if exists "own snapshots" on public.diario_snapshots;
create policy "own snapshots" on public.diario_snapshots
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own actions" on public.diario_actions;
create policy "own actions" on public.diario_actions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 5) Privilégios de tabela (RLS restringe linhas, mas o papel também precisa
-- da permissão básica sobre a tabela). Revoga do "anon" e concede só para
-- usuários autenticados.

revoke all on public.diario_current from anon;
revoke all on public.diario_snapshots from anon;
revoke all on public.diario_actions from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.diario_current to authenticated;
grant select, insert, update, delete on public.diario_snapshots to authenticated;
grant select, insert, delete on public.diario_actions to authenticated;
