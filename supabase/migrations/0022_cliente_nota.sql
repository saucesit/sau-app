-- Caja de contexto por cliente: notas estructuradas para que Facundo (admin SAU)
-- entienda cómo trabaja cada cliente, más allá de los módulos que tenga activos.
-- No es config funcional (eso vive en empresa.modulos_activos / presupuesto_modo, etc.)
-- y no es visible para el cliente — es memoria de negocio, exclusiva del admin.

create table if not exists cliente_nota (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  titulo      text not null,
  contenido   text not null,
  tipo        text not null default 'general'
              check (tipo in ('negocio','pricing','operativo','general')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_cliente_nota_empresa on cliente_nota (empresa_id, created_at desc);

alter table cliente_nota enable row level security;

-- Solo el admin de SAU (Facundo) puede ver/escribir. Ni el cliente ni la contadora.
create policy cliente_nota_admin on cliente_nota
  for all
  using (
    exists (select 1 from profile where id = auth.uid() and es_sau_admin = true)
  )
  with check (
    exists (select 1 from profile where id = auth.uid() and es_sau_admin = true)
  );
