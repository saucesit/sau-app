-- Panel Admin SAU: flag de super-admin + datos de suscripción por empresa
-- NOTA: la tabla de perfiles se llama 'profile' (ver 0001_mvp_ventas_caja.sql)

-- ── Flag en profile ───────────────────────────────────────────────
alter table profile
  add column if not exists es_sau_admin boolean default false;

-- ── Info comercial en empresa ─────────────────────────────────────
alter table empresa
  add column if not exists estado_suscripcion text default 'gratuito'
    check (estado_suscripcion in ('gratuito','activo','atrasado','suspendido')),
  add column if not exists notas_admin text,
  add column if not exists fecha_alta_sau date default current_date;

-- ── Actualizar es_contadora_o_admin() para incluir sau admin ──────
create or replace function es_contadora_o_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profile
    where id = auth.uid()
      and es_sau_admin = true
  )
  or exists (
    select 1 from membresia
    where usuario_id = auth.uid()
      and rol in ('contadora', 'admin')
      and activa = true
  )
$$;

-- ── Política especial: sau admin ve TODAS las empresas ───────────
create policy empresa_sau_admin_all on empresa
  for all
  using (
    exists (
      select 1 from profile
      where id = auth.uid()
        and es_sau_admin = true
    )
  );

-- ── Política: sau admin ve TODOS los profiles ────────────────────
create policy profile_sau_admin on profile
  for select
  using (
    exists (
      select 1 from profile p2
      where p2.id = auth.uid()
        and p2.es_sau_admin = true
    )
  );

-- ── Política: sau admin ve TODAS las membresias ──────────────────
create policy membresia_sau_admin on membresia
  for select
  using (
    exists (
      select 1 from profile
      where id = auth.uid()
        and es_sau_admin = true
    )
  );

-- ────────────────────────────────────────────────────────────────
-- DESPUÉS DE APLICAR: activar tu usuario como admin
-- Corré esto en el SQL Editor de Supabase:
--
--   update profile
--   set es_sau_admin = true
--   where id = auth.uid();
--
-- ────────────────────────────────────────────────────────────────
