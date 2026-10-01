-- Hasta dónde llega un cliente administrando su propio equipo.
--
-- Reglas:
--   * El perfil Completo lo asigna, retira o desactiva SOLO SAU.
--   * Completo gestiona usuarios dentro de SU empresa: asigna Administrador u
--     Operario y habilita etapas, y nada más.
--   * Los permisos asignables son una lista explícita. Lo que no está, se
--     rechaza — incluido cualquier permiso que se invente más adelante.
--   * taller.eliminar queda reservado a SAU mientras borrar un vehículo siga
--     llevándose su historial completo.
--
-- Dónde se aplica: en el servidor, con un trigger sobre `membresia`. RLS no
-- alcanza, porque no puede limitar columnas ni comparar contra el valor
-- anterior, y acá hay que mirar justamente de qué a qué cambia cada cosa.
--
-- A quién alcanza: a TODA llamada hecha con el rol `authenticated`, venga del
-- navegador o de una llamada directa a la API con un JWT de usuario. No es una
-- validación de pantalla.
--
-- A quién NO alcanza: a las edge functions, que corren con service_role. El
-- control de esas va en su propio código, por decisión tomada: son nuestras y
-- el agujero real era el del navegador. Queda anotado como riesgo residual.

-- ── 1. Las dos listas, explícitas ─────────────────────────────────

create or replace function public.sau_permisos_reservados()
returns text[] language sql immutable as $$
  select array['empresa.admin', 'empresa.rrhh', 'taller.eliminar']
$$;

comment on function public.sau_permisos_reservados() is
  'Permisos que solo asigna SAU. empresa.admin es el perfil Completo; taller.eliminar borra el historial del vehículo junto con el vehículo.';

-- Lista cerrada, no "todo menos tres". Si mañana aparece un permiso nuevo,
-- queda fuera hasta que alguien lo agregue acá a propósito.
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
    'taller.ver', 'taller.cargar', 'taller.trabajar', 'taller.validar', 'taller.montos'
  ]
$$;

grant execute on function public.sau_permisos_reservados()            to authenticated;
grant execute on function public.sau_permisos_asignables_por_cliente() to authenticated;

-- Las etapas ya estaban acotadas por constraint desde 0028:
--   membresia_taller_etapas_validas: chapa, preparacion, pintura, pre_entrega.
-- No hace falta una lista aparte.

-- ── 2. El guardián ────────────────────────────────────────────────

-- OJO con security definer acá: adentro de una función definer, current_user
-- pasa a ser el dueño de la función y no el rol que llamó, así que preguntarle
-- "¿sos authenticated?" siempre daba que no y la guardia no validaba nada.
-- Se usa auth.role(), que lee el JWT y no cambia por el contexto, y la función
-- queda como invoker.
create or replace function public.sau_guardia_membresia()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_reservados  text[] := public.sau_permisos_reservados();
  v_asignables  text[] := public.sau_permisos_asignables_por_cliente();
  v_sobrantes   text[];
begin
  -- SAU hace lo que necesita. Las edge functions (service_role) también: su
  -- control está en su código. Sin JWT (SQL directo) se deja pasar.
  if public.es_admin_sau() or coalesce(auth.role(), 'postgres') <> 'authenticated' then
    return coalesce(new, old);
  end if;

  -- Una membresía Completo no se toca desde el cliente: ni para sacarle el
  -- perfil, ni para desactivarla, ni para cambiarle los permisos. Tampoco la
  -- propia. Eso incluye borrarla.
  if old is not null and old.permisos && v_reservados then
    raise exception 'El perfil Completo lo administra SAU. Pedinos el cambio y lo hacemos nosotros.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- No se otorgan permisos reservados a nadie.
  if new.permisos && v_reservados then
    raise exception 'Estos permisos los asigna SAU: %',
      array_to_string(array(select unnest(new.permisos) intersect select unnest(v_reservados)), ', ');
  end if;

  -- Ni nada que no esté en la lista de asignables.
  v_sobrantes := array(select unnest(coalesce(new.permisos, '{}')) except select unnest(v_asignables));
  if array_length(v_sobrantes, 1) > 0 then
    raise exception 'Permisos no autorizados para una empresa: %', array_to_string(v_sobrantes, ', ');
  end if;

  -- El rol admin/contadora es de SAU, aunque dentro de la empresa ya no abra
  -- otras: sigue equivaliendo a Completo por es_admin_de_empresa().
  if new.rol::text not in ('empleado', 'dueno') then
    raise exception 'El rol "%" lo asigna SAU', new.rol;
  end if;

  -- Y la membresía no se muda ni cambia de dueño.
  if old is not null then
    if new.empresa_id is distinct from old.empresa_id then
      raise exception 'Una membresía no se mueve de empresa';
    end if;
    if new.usuario_id is distinct from old.usuario_id then
      raise exception 'Una membresía no cambia de persona';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sau_guardia_membresia on membresia;
create trigger trg_sau_guardia_membresia
  before insert or update or delete on membresia
  for each row execute function public.sau_guardia_membresia();
