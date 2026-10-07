-- El operario saca fotos de su trabajo, y nada más.
--
-- Hasta acá, subir cualquier adjunto exigía taller.cargar, que el operario no
-- tiene y no debe tener: taller.cargar también da de alta vehículos y edita la
-- ficha (vehiculo_insert / vehiculo_update). El resultado era que el chapista
-- no podía dejar una foto de lo que hizo.
--
-- Se separa en un permiso propio, taller.fotos, que habilita exactamente un
-- tipo de adjunto —foto_proceso— y ninguna otra cosa:
--
--   * No da documentos: ni orden interna, ni orden de la compañía, ni recibo,
--     ni factura. Tampoco foto de ingreso ni foto de la entrega, que son actos
--     administrativos (recibir y entregar el auto), no el trabajo del taller.
--     Eso deja en pie la regla ya acordada de que el operario no adjunta nada
--     en un vehículo entregado.
--   * No da nada más: ni anular (taller.anular), ni borrar (taller.eliminar),
--     ni ver importes (taller.montos), ni editar el vehículo (taller.cargar).
--     Son policies y RPC aparte y ninguna se toca acá.
--
-- Quien ya tiene taller.cargar no cambia en nada: sigue subiendo fotos y
-- documentos como hasta ahora, con taller.montos para los que llevan importes.
--
-- Se cierra en los dos lados —la tabla y el bucket— por lo mismo que 0034: la
-- ruta del archivo lleva el tipo adelante, y sin cerrar el bucket alcanzaría
-- con nombrar bien el archivo para subir lo que fuera.

-- ── 1. Qué habilita el permiso ────────────────────────────────────
-- En una función para que la tabla y el bucket no se desincronicen, igual que
-- taller_tipos_economicos(). Si mañana se quiere ampliar, se amplía acá.

create or replace function taller_tipos_permiso_fotos()
returns text[] language sql immutable as $$
  select array['foto_proceso']
$$;

comment on function taller_tipos_permiso_fotos() is
  'Tipos de adjunto que habilita taller.fotos por sí solo. No incluye ningún tipo económico ni los de recepción y entrega.';

grant execute on function taller_tipos_permiso_fotos() to authenticated;

-- ── 2. La tabla ───────────────────────────────────────────────────
-- Dos caminos, no uno relajado: el de siempre (taller.cargar, con la reserva
-- de los económicos) y el nuevo, acotado a la lista de arriba. La condición de
-- "no es económico" se repite en la segunda rama a propósito: hoy es
-- redundante y mañana, si alguien amplía la lista sin mirar, sigue siendo
-- cierta.

drop policy if exists vehiculo_archivo_insert on vehiculo_archivo;
create policy vehiculo_archivo_insert on vehiculo_archivo
  for insert with check (
    exists (
      select 1 from vehiculo v
       where v.id = vehiculo_archivo.vehiculo_id
         and (
           (
             tiene_permiso_taller(v.empresa_id, 'taller.cargar')
             and (
               not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
               or tiene_permiso_taller(v.empresa_id, 'taller.montos')
             )
           )
           or (
             tiene_permiso_taller(v.empresa_id, 'taller.fotos')
             and vehiculo_archivo.tipo = any (taller_tipos_permiso_fotos())
             and not (vehiculo_archivo.tipo = any (taller_tipos_economicos()))
           )
         )
    )
  );

-- ── 3. El bucket ──────────────────────────────────────────────────

create or replace function taller_archivo_es_foto_permitida(p_name text)
returns boolean language sql stable as $$
  select exists (
    select 1 from unnest(taller_tipos_permiso_fotos()) t
     where storage.filename(p_name) like t || '-%'
  )
$$;

grant execute on function taller_archivo_es_foto_permitida(text) to authenticated;

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
        )
    )
  );

-- ── 4. Un cliente puede asignarlo ─────────────────────────────────
-- Va a la lista de asignables, no a la de reservados: es parte del perfil
-- Operario, que Completo administra dentro de su empresa. La lista se escribe
-- entera, como en 0038: es la copia de lo que hay vivo más el permiso nuevo.
-- La de reservados no se toca.

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
    'taller.montos', 'taller.fotos'
  ]
$$;

grant execute on function public.sau_permisos_asignables_por_cliente() to authenticated;

-- ── 5. Los operarios que ya existen ───────────────────────────────
-- El perfil Operario es "trabaja pero no carga". A esos se les suma el permiso
-- nuevo; a nadie más. Quien tiene taller.cargar no lo necesita y no se toca.

update membresia
   set permisos = permisos || 'taller.fotos'::text
 where 'taller.trabajar' = any (permisos)
   and not ('taller.cargar' = any (permisos))
   and not ('taller.fotos'  = any (permisos));

-- Control: ninguna membresía puede haber ganado otra cosa que taller.fotos.
select 'operarios con el permiso nuevo: ' || count(*) as resultado
  from membresia where 'taller.fotos' = any (permisos);
