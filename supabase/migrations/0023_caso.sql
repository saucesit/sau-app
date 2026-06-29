-- Casos: la "card" que genera una charla con el agente (Matías, Antonella, etc.)
-- y su transcript completo. Separado en dos tablas a propósito:
--   caso          → el registro estructurado (estado, datos extraídos) — la card del kanban.
--   caso_mensaje  → la charla cruda, mensaje por mensaje, para cuando el dato
--                   resumido no alcanza y hay que ver el matiz real de la conversación.

create table if not exists caso (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  titulo      text,
  datos       jsonb not null default '{}'::jsonb,
  estado      text not null default 'nuevo'
              check (estado in ('nuevo','pendiente_revision','propuesta_enviada','agendado','cerrado')),
  canal       text not null default 'chat_prueba'
              check (canal in ('chat_prueba','whatsapp')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_caso_empresa on caso (empresa_id, created_at desc);

create table if not exists caso_mensaje (
  id          uuid primary key default gen_random_uuid(),
  caso_id     uuid not null references caso(id) on delete cascade,
  role        text not null check (role in ('user','assistant','admin')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_caso_mensaje_caso on caso_mensaje (caso_id, created_at);

alter table caso         enable row level security;
alter table caso_mensaje enable row level security;

-- Mismo criterio que presupuesto: lo ve la empresa dueña del caso, o admin/contadora.
create policy caso_select on caso
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy caso_write on caso
  for all using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin())
  with check (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());

create policy caso_mensaje_select on caso_mensaje
  for select using (
    caso_id in (select id from caso where empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin())
  );
create policy caso_mensaje_write on caso_mensaje
  for all using (
    caso_id in (select id from caso where empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin())
  )
  with check (
    caso_id in (select id from caso where empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin())
  );
