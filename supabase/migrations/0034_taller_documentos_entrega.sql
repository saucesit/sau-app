-- Documentos posteriores a la entrega, y adjuntos con plata adentro.
--
-- NO APLICADA TODAVÍA.
--
-- Forani necesita seguir agregando papeles a un vehículo después de entregarlo:
-- la orden firmada por el cliente, el recibo y la factura. Eso es archivo, no
-- flujo: agregar un documento NO reactiva el vehículo ni lo devuelve a la
-- pizarra, porque nada de esto toca `vehiculo`. Su etapa sigue en 'entregado' y
-- por lo tanto sus importes siguen fuera de los totales del tablero.
--
-- Los tres tipos nuevos muestran importes, así que dejan de ser visibles para
-- quien no tiene taller.montos. Un operario ve las fotos del auto, no la
-- factura. Se cierra en los dos lados: en la tabla y en el bucket, porque la
-- ruta del archivo lleva el tipo adelante y sin cerrar el bucket alcanzaría con
-- conocer la ruta para pedir la URL firmada.

-- ── 1. Tipos nuevos ───────────────────────────────────────────────

alter table vehiculo_archivo drop constraint if exists vehiculo_archivo_tipo_check;
alter table vehiculo_archivo add constraint vehiculo_archivo_tipo_check
  check (tipo in ('foto_ingreso', 'foto_proceso', 'foto_entrega',
                  'orden_interna', 'orden_compania',
                  'orden_firmada', 'recibo', 'factura'));

comment on column vehiculo_archivo.tipo is
  'Tipo de adjunto. orden_firmada, recibo y factura son documentos económicos: solo los ve quien tiene taller.montos.';

-- ── 2. Qué es un documento económico ──────────────────────────────
-- En una sola función para que la tabla y el bucket no se desincronicen.

create or replace function taller_tipos_economicos()
returns text[] language sql immutable as $$
  select array['orden_firmada', 'recibo', 'factura']
$$;

grant execute on function taller_tipos_economicos() to authenticated;

-- ── 3. Policies de la tabla ───────────────────────────────────────

drop policy if exists vehiculo_archivo_select on vehiculo_archivo;
create policy vehiculo_archivo_select on vehiculo_archivo
  for select using (
    exists (
      select 1 from vehiculo v
       where v.id = vehiculo_archivo.vehiculo_id
         and tiene_permiso_taller(v.empresa_id, 'taller.ver')
         and (
           not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
           or tiene_permiso_taller(v.empresa_id, 'taller.montos')
         )
    )
  );

-- Subir un papel con importes exige ver importes. Las fotos siguen igual.
drop policy if exists vehiculo_archivo_insert on vehiculo_archivo;
create policy vehiculo_archivo_insert on vehiculo_archivo
  for insert with check (
    exists (
      select 1 from vehiculo v
       where v.id = vehiculo_archivo.vehiculo_id
         and tiene_permiso_taller(v.empresa_id, 'taller.cargar')
         and (
           not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
           or tiene_permiso_taller(v.empresa_id, 'taller.montos')
         )
    )
  );

-- ── 4. Lo mismo en el bucket ──────────────────────────────────────
-- La ruta es {empresa}/{vehiculo}/{tipo}-{marca}-{azar}.{ext}, así que el tipo
-- se lee del nombre del archivo. Si esto no estuviera, el operario no vería la
-- factura en la ficha pero podría pedir su URL firmada conociendo la ruta.

create or replace function taller_archivo_es_economico(p_name text)
returns boolean language sql stable as $$
  select exists (
    select 1 from unnest(taller_tipos_economicos()) t
     where storage.filename(p_name) like t || '-%'
  )
$$;

grant execute on function taller_archivo_es_economico(text) to authenticated;

drop policy if exists taller_archivos_leer on storage.objects;
create policy taller_archivos_leer on storage.objects
  for select using (
    bucket_id = 'taller'
    and exists (
      select 1 from empresa e
      where e.id::text = (storage.foldername(name))[1]
        and tiene_permiso_taller(e.id, 'taller.ver')
        and (
          not taller_archivo_es_economico(name)
          or tiene_permiso_taller(e.id, 'taller.montos')
        )
    )
  );

drop policy if exists taller_archivos_subir on storage.objects;
create policy taller_archivos_subir on storage.objects
  for insert with check (
    bucket_id = 'taller'
    and exists (
      select 1 from empresa e
      where e.id::text = (storage.foldername(name))[1]
        and tiene_permiso_taller(e.id, 'taller.cargar')
        and (
          not taller_archivo_es_economico(name)
          or tiene_permiso_taller(e.id, 'taller.montos')
        )
    )
  );

-- ── 5. El autor ya se registra solo ───────────────────────────────
-- vehiculo_archivo.autor_id lo pone trg_taller_archivo_autor desde 0026, y
-- created_at tiene default. No hace falta nada nuevo: solo faltaba mostrarlo.
