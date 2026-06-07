-- Certificados digitales ARCA por empresa.
-- La contadora sube el cert + clave privada de cada contribuyente.
-- El Edge Function los usa para firmar la solicitud de CAE.
-- NUNCA se exponen al frontend — acceso solo via service role.

create table certificado_arca (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references empresa(id) on delete cascade,
  cuit         text not null,
  cert_pem     text not null,          -- certificado X.509 en formato PEM
  key_pem      text not null,          -- clave privada RSA en formato PEM
  ambiente     text not null default 'homologacion'
                 check (ambiente in ('homologacion', 'produccion')),
  vigente_hasta date,                  -- fecha de vencimiento del cert
  activo       boolean default true,
  creado_por   uuid references auth.users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),

  -- Una empresa, un certificado activo
  unique (empresa_id)
);

comment on table certificado_arca is
  'Certificados digitales ARCA para emisión de CAE. Solo accesible via service_role.';

-- RLS: habilitado pero solo admin/contadora pueden ver/editar
alter table certificado_arca enable row level security;

create policy cert_select on certificado_arca
  for select using ( es_contadora_o_admin() );

create policy cert_insert on certificado_arca
  for insert with check ( es_contadora_o_admin() );

create policy cert_update on certificado_arca
  for update using ( es_contadora_o_admin() );

create policy cert_delete on certificado_arca
  for delete using ( es_contadora_o_admin() );
