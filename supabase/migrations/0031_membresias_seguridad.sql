-- Cierre del alta de membresías desde el navegador.
--
-- Lo que había:
--
--   1. membresia INSERT tenía como única condición `usuario_id = auth.uid()`.
--      No miraba a qué empresa ni con qué rol. Cualquiera con una cuenta de SAU
--      podía agregarse como admin de cualquier empresa. Probado: un usuario de
--      otra empresa se auto-agregó a Forani y leyó sus 12 vehículos con montos.
--
--   2. empresa tenía una policy de SELECT con `using (true)`. Sin login siquiera
--      se listaban las 8 empresas con su codigo_invitacion, así que el código
--      nunca fue un secreto.
--
--   3. No había policy de DELETE en membresia: los borrados devolvían 200 sin
--      borrar nada.
--
--   4. membresia SELECT y UPDATE solo contemplaban a es_contadora_o_admin(), es
--      decir al personal de SAU. El dueño de un cliente no podía ni listar a su
--      equipo ni desactivar a nadie: la pantalla Equipo no le funcionaba.
--
-- A partir de acá las membresías las crean únicamente funciones del servidor, y
-- el alta de gente pasa por invitaciones de un solo uso con vencimiento.

-- ── Helper: ¿soy admin de esta empresa? ───────────────────────────
-- security definer para que no vuelva a pasar por la RLS de membresia.
create or replace function es_admin_de_empresa(p_empresa uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from membresia m
    where m.usuario_id = auth.uid()
      and m.empresa_id = p_empresa
      and m.activa
      and (m.rol in ('admin', 'contadora') or 'empresa.admin' = any(m.permisos))
  );
$$;

grant execute on function es_admin_de_empresa(uuid) to authenticated;

-- ── Membresía ─────────────────────────────────────────────────────

-- Nadie crea membresías desde el navegador. La contadora de SAU sigue pudiendo
-- porque da de alta empresas nuevas; el resto pasa por edge functions, que usan
-- service_role y no miran estas policies.
drop policy if exists membresia_insert on membresia;
create policy membresia_insert on membresia
  for insert with check (es_contadora_o_admin());

-- El dueño de una empresa tiene que poder ver a su equipo.
drop policy if exists membresia_select on membresia;
create policy membresia_select on membresia
  for select using (
    usuario_id = auth.uid()
    or es_contadora_o_admin()
    or es_admin_de_empresa(empresa_id)
  );

-- Y poder cambiarle permisos o desactivarlo, dentro de SU empresa.
drop policy if exists membresia_update on membresia;
create policy membresia_update on membresia
  for update using (es_contadora_o_admin() or es_admin_de_empresa(empresa_id))
  with check (es_contadora_o_admin() or es_admin_de_empresa(empresa_id));

-- Antes no existía: los borrados fallaban en silencio.
drop policy if exists membresia_delete on membresia;
create policy membresia_delete on membresia
  for delete using (es_contadora_o_admin() or es_admin_de_empresa(empresa_id));

-- ── Empresa ───────────────────────────────────────────────────────

-- Esta era la que filtraba todo el padrón de clientes sin login.
drop policy if exists empresa_invitacion on empresa;

-- Las páginas públicas (/pedir, /reservar) solo necesitan el nombre de UNA
-- empresa. Se lo damos por función, que devuelve un campo y no la fila entera.
create or replace function empresa_nombre_publico(p_empresa uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(nombre_fantasia, razon_social) from empresa where id = p_empresa;
$$;

grant execute on function empresa_nombre_publico(uuid) to anon, authenticated;

-- Cambiar módulos, tema o datos fiscales es cosa del dueño, no de un operario.
drop policy if exists empresa_update on empresa;
create policy empresa_update on empresa
  for update using (es_admin_de_empresa(id))
  with check (es_admin_de_empresa(id));

-- El código permanente se va: era público y no expiraba.
alter table empresa drop column if exists codigo_invitacion;

-- ── Invitaciones de un solo uso ───────────────────────────────────
create table if not exists invitacion (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresa(id) on delete cascade,
  nombre         text not null,
  email          text not null,
  rol            rol_empresa not null default 'empleado',
  -- Los permisos los decide quien invita y quedan guardados acá: el navegador
  -- de quien acepta no tiene forma de cambiarlos.
  permisos       text[] not null default '{}',
  taller_etapas  text[] not null default '{}',
  token          text not null unique,
  creada_por     uuid references auth.users(id) on delete set null,
  creada_en      timestamptz not null default now(),
  expira_en      timestamptz not null default now() + interval '7 days',
  usada_en       timestamptz,
  usada_por      uuid references auth.users(id) on delete set null
);

create index if not exists idx_invitacion_empresa on invitacion (empresa_id, creada_en desc);

alter table invitacion enable row level security;

-- El token nunca se lee desde el navegador de quien acepta: eso lo resuelve una
-- edge function con service_role. Acá solo miran los admins de la empresa.
drop policy if exists invitacion_select on invitacion;
create policy invitacion_select on invitacion
  for select using (es_contadora_o_admin() or es_admin_de_empresa(empresa_id));
drop policy if exists invitacion_delete on invitacion;
create policy invitacion_delete on invitacion
  for delete using (es_contadora_o_admin() or es_admin_de_empresa(empresa_id));

-- Un admin puede revocar o ajustar las invitaciones de su empresa.
drop policy if exists invitacion_update on invitacion;
create policy invitacion_update on invitacion
  for update using (es_contadora_o_admin() or es_admin_de_empresa(empresa_id))
  with check (es_contadora_o_admin() or es_admin_de_empresa(empresa_id));
