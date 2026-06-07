-- Consultas de audio entrantes desde la landing pública de SAU

create table consulta_sau (
  id          uuid primary key default gen_random_uuid(),
  audio_url   text not null,
  nombre      text,
  telefono    text,
  estado      text default 'nueva'
                check (estado in ('nueva','en_proceso','resuelta')),
  notas_admin text,
  created_at  timestamptz default now()
);

-- Solo el sau admin puede ver y gestionar consultas
alter table consulta_sau enable row level security;

create policy consulta_admin on consulta_sau
  for all
  using (
    exists (
      select 1 from profile
      where id = auth.uid() and es_sau_admin = true
    )
  );

-- Insert público: cualquiera puede crear una consulta (sin auth)
create policy consulta_insert_publica on consulta_sau
  for insert
  with check (true);
