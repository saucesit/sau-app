create table if not exists reserva (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresa(id) on delete cascade,
  pasajero_nombre     text not null,
  pasajero_tel        text not null,
  servicio            text,
  fecha               date not null,
  hora                time,
  pasajeros_cantidad  int not null default 1,
  origen              text,
  destino             text,
  notas               text,
  estado              text not null default 'nueva'
                      check (estado in ('nueva','confirmada','en_camino','completada','cancelada')),
  seña_pagada         numeric not null default 0,
  monto_total         numeric,
  created_at          timestamptz not null default now()
);

create index if not exists idx_reserva_empresa_fecha
  on reserva (empresa_id, fecha desc);

alter table reserva enable row level security;

-- Cualquiera puede crear una reserva (formulario público)
create policy reserva_anon_insert on reserva
  for insert
  with check (true);

-- Los miembros de la empresa ven sus propias reservas
create policy reserva_select_empresa on reserva
  for select
  using (empresa_id in (select empresa_id from membresia where usuario_id = auth.uid()));

-- La contadora/admin pueden ver todo y modificar
create policy reserva_admin on reserva
  for all
  using (
    exists (select 1 from profile where id = auth.uid() and (es_sau_admin = true or es_sau_contadora = true))
  )
  with check (
    exists (select 1 from profile where id = auth.uid() and (es_sau_admin = true or es_sau_contadora = true))
  );

-- Los miembros pueden actualizar el estado de sus reservas
create policy reserva_update_empresa on reserva
  for update
  using (empresa_id in (select empresa_id from membresia where usuario_id = auth.uid()));
