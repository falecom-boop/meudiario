-- Diário de Classe · Schema do Supabase (v2 — login real via Supabase Auth)
-- Como usar: Supabase Dashboard > SQL Editor > New query > cole tudo > Run.
--
-- ATENÇÃO: este script APAGA as tabelas antigas (diario_current/diario_snapshots)
-- e recria do zero, agora com uma linha por professor autenticado em vez de um
-- registro único compartilhado ("current"). Só rode isso se você já sabe que
-- pode perder o conteúdo de teste que estiver salvo hoje nessas tabelas.
--
-- Depois de rodar este script, vá em:
--   Authentication > Providers > Email > desligue "Confirm email"
--   Authentication > URL Configuration > Redirect URLs > adicione a URL do app
--     (ex.: http://localhost:5173 e a URL da Vercel quando publicar)

drop table if exists public.diario_snapshots;
drop table if exists public.diario_current;

-- 1) Estado atual do diário — uma linha por professor, id = id do usuário logado
create table public.diario_current (
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
create table public.diario_snapshots (
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

create index idx_diario_snapshots_user_created
  on public.diario_snapshots (user_id, created_at desc);

-- 3) RLS
-- Agora o app faz login de verdade com Supabase Auth, então cada professor só
-- pode ler/escrever a própria linha (id/user_id = auth.uid()). O papel "anon"
-- não tem mais acesso nenhum a essas tabelas.

alter table public.diario_current enable row level security;
alter table public.diario_snapshots enable row level security;

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

-- 4) Privilégios de tabela (RLS restringe linhas, mas o papel também precisa
-- da permissão básica sobre a tabela). Revoga do "anon" e concede só para
-- usuários autenticados.

revoke all on public.diario_current from anon;
revoke all on public.diario_snapshots from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.diario_current to authenticated;
grant select, insert, update, delete on public.diario_snapshots to authenticated;
