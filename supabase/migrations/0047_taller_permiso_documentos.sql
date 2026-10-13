-- El contador sube facturas, y nada más.
--
-- Forani suma un usuario para el contador, "así él va subiendo todo lo que es
-- facturas". Con los permisos de hoy la única forma de que alguien adjunte un
-- documento es taller.cargar, que además da de alta vehículos y edita los
-- trece campos de la ficha: para un contador es de más.
--
-- Se separa en un permiso propio, igual que se hizo con taller.fotos en 0043.
-- La regla es de una línea:
--
--   taller.documentos = puede subir documentos.
--   Si el documento es económico, además necesita taller.montos.
--
-- Documentos son los cinco tipos que no son foto, incluida la orden de trabajo
-- interna. Dejarla afuera obligaría a recordar para siempre que el permiso
-- "documentos" no puede subir uno de los documentos.
--
-- Lo que este permiso NO da:
--   * Ver. Mirar un adjunto sigue pidiendo taller.ver, y los económicos
--     taller.montos. Quien suba una factura sin montos no la vería ni él.
--   * Anular. Sigue siendo taller.anular, reservado a SAU.
--   * Alta de vehículos ni edición de la ficha. Eso es taller.cargar y no se
--     toca.
--
-- Quien ya tiene taller.cargar no cambia en nada: la rama que se agrega es un
-- camino más, no una restricción.

-- ── 1. Qué habilita el permiso ────────────────────────────────────
-- En una función, como taller_tipos_economicos() y taller_tipos_permiso_fotos(),
-- para que la tabla y el bucket no se desincronicen.

create or replace function taller_tipos_permiso_documentos()
returns text[] language sql immutable as $$
  select array['orden_interna', 'orden_compania', 'orden_firmada', 'recibo', 'factura']
$$;

comment on function taller_tipos_permiso_documentos() is
  'Tipos de adjunto que habilita taller.documentos: los cinco que no son foto. Los económicos siguen exigiendo taller.montos.';

grant execute on function taller_tipos_permiso_documentos() to authenticated;

create or replace function taller_archivo_es_documento_permitido(p_name text)
returns boolean language sql stable as $$
  select exists (
    select 1 from unnest(taller_tipos_permiso_documentos()) t
     where storage.filename(p_name) like t || '-%'
  )
$$;

grant execute on function taller_archivo_es_documento_permitido(text) to authenticated;

-- ── 2. La tabla ───────────────────────────────────────────────────
-- Tres ramas, una por permiso. Las tres comparten el mismo portón económico:
-- es lo que mantiene la policy leíble a pesar de haber crecido.

drop policy if exists vehiculo_archivo_insert on vehiculo_archivo;
create policy vehiculo_archivo_insert on vehiculo_archivo
  for insert with check (
    exists (
      select 1 from vehiculo v
       where v.id = vehiculo_archivo.vehiculo_id
         and (
           -- Quien carga: todo, con la reserva de los económicos.
           (
             tiene_permiso_taller(v.empresa_id, 'taller.cargar')
             and (
               not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
               or tiene_permiso_taller(v.empresa_id, 'taller.montos')
             )
           )
           -- Quien solo saca fotos: nada más que la foto del trabajo.
           or (
             tiene_permiso_taller(v.empresa_id, 'taller.fotos')
             and vehiculo_archivo.tipo = any (taller_tipos_permiso_fotos())
             and not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
           )
           -- Quien solo adjunta documentos: los cinco que no son foto, y los
           -- que llevan importes solo si además puede ver importes.
           or (
             tiene_permiso_taller(v.empresa_id, 'taller.documentos')
             and vehiculo_archivo.tipo = any (taller_tipos_permiso_documentos())
             and (
               not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
               or tiene_permiso_taller(v.empresa_id, 'taller.montos')
             )
           )
         )
    )
  );

-- ── 3. El bucket ──────────────────────────────────────────────────
-- La ruta lleva el tipo adelante, así que el bucket lo lee del nombre. Sin
-- esto alcanzaría con nombrar bien el archivo para subir lo que fuera.

drop policy if exists taller_archivos_subir on storage.objects;
create policy taller_archivos_subir on storage.objects
  for insert with check (
    bucket_id = 'taller'
    and exists (
      select 1 from empresa e
      where e.id::text = (storage.foldername(name))[1]
        and (
          (
            tiene_permiso_taller(e.id, 'taller.cargar')
            and (
              not taller_archivo_es_economico(name)
              or tiene_permiso_taller(e.id, 'taller.montos')
            )
          )
          or (
            tiene_permiso_taller(e.id, 'taller.fotos')
            and taller_archivo_es_foto_permitida(name)
            and not taller_archivo_es_economico(name)
          )
          or (
            tiene_permiso_taller(e.id, 'taller.documentos')
            and taller_archivo_es_documento_permitido(name)
            and (
              not taller_archivo_es_economico(name)
              or tiene_permiso_taller(e.id, 'taller.montos')
            )
          )
        )
    )
  );

-- ── 4. Un cliente puede asignarlo ─────────────────────────────────
-- Va a la lista de asignables, no a la de reservados: es parte de un perfil
-- que Completo administra dentro de su empresa. La lista se escribe entera,
-- como en 0038 y 0043.

create or replace function public.sau_permisos_asignables_por_cliente()
returns text[] language sql immutable as $$
  select array[
    'ventas.ver', 'ventas.crear', 'ventas.confirmar',
    'caja.ver',   'caja.crear',   'caja.operar',
    'compras.ver','compras.crear',
    'stock.ver',
    'fiado.ver',  'fiado.crear',
    'reportes.ver',
    'equipo.ver',
    'taller.ver', 'taller.cargar', 'taller.trabajar', 'taller.validar',
    'taller.montos', 'taller.fotos', 'taller.documentos'
  ]
$$;

grant execute on function public.sau_permisos_asignables_por_cliente() to authenticated;

-- Nada de membresías: este cambio no le da el permiso a nadie todavía.
select json_build_object(
  'tipos_que_habilita', (select taller_tipos_permiso_documentos()),
  'en_asignables', (select 'taller.documentos' = any (sau_permisos_asignables_por_cliente())),
  'en_reservados', (select 'taller.documentos' = any (sau_permisos_reservados())),
  'ramas_en_la_policy', (select
     (case when with_check like '%taller.cargar%' then 1 else 0 end) +
     (case when with_check like '%taller.fotos%' then 1 else 0 end) +
     (case when with_check like '%taller.documentos%' then 1 else 0 end)
     from pg_policies where tablename = 'vehiculo_archivo' and policyname = 'vehiculo_archivo_insert'),
  'membresias_con_el_permiso', (select count(*) from membresia
     where 'taller.documentos' = any (permisos))
) as resultado;
