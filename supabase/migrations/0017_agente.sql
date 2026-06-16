-- Módulo Agente IA de WhatsApp.
-- Cada empresa puede tener su propio agente (nombre propio, número de WhatsApp)
-- que atiende a sus clientes y opera dentro de SAU.
--
-- Dos tablas a propósito:
--   agente_config       → la cara visible (nombre, número, acciones). El cliente la ve/edita.
--   agente_credenciales → el cofre de secretos (tokens). Solo el service_role del edge function.

-- ── Config visible del agente (1 por empresa) ─────────────────────
create table if not exists agente_config (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null unique references empresa(id) on delete cascade,
  nombre              text not null default 'Asistente',     -- ej: "Antonella"
  activo              boolean not null default false,        -- prendido / pausado
  whatsapp_numero     text,                                  -- E.164 visible: +5493875551234
  whatsapp_phone_id   text,                                  -- id estable del proveedor (lookup webhook)
  proveedor           text not null default 'meta'
                       check (proveedor in ('meta','twilio')),
  acciones_permitidas text[] not null default '{}',          -- {'crear_presupuesto','registrar_pedido'}
  personalidad        text,                                  -- tono / instrucciones extra
  estado              text not null default 'pendiente'
                       check (estado in ('pendiente','conectado','desconectado','error')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Lookup del webhook: número/identificador del proveedor -> empresa
create unique index if not exists idx_agente_phone_id
  on agente_config (whatsapp_phone_id)
  where whatsapp_phone_id is not null;

-- ── Cofre de credenciales (1 por empresa) ─────────────────────────
create table if not exists agente_credenciales (
  empresa_id    uuid primary key references empresa(id) on delete cascade,
  proveedor     text not null default 'meta',
  access_token  text,
  app_secret    text,
  webhook_token text,
  extra         jsonb,
  updated_at    timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────
alter table agente_config       enable row level security;
alter table agente_credenciales enable row level security;

-- Config: el cliente ve/edita la de SU empresa; admin/contadora todo.
create policy agente_cfg_select on agente_config
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy agente_cfg_write on agente_config
  for all using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin())
  with check (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());

-- Credenciales: RLS habilitada y SIN policies => cerrada para anon/authenticated.
-- Solo el service_role (edge function) la puede leer/escribir, porque bypassea RLS.
