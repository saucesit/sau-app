-- Tema visual del módulo Taller, por empresa.
--
-- El rediseño de pizarra de control se hizo para Forani y está pensado sobre
-- cómo trabaja ese taller. El próximo cliente del rubro se queda con la
-- interfaz clásica de SAU hasta que decidamos si le sirve la misma.
--
-- Va en la base y no en el código a propósito: así no hay ids de empresas
-- repartidos por el front, y cambiar el tema de un cliente es un UPDATE.

alter table empresa
  add column if not exists tema_taller text not null default 'clasico'
  check (tema_taller in ('clasico', 'control_board'));

comment on column empresa.tema_taller is
  'Interfaz del módulo Taller: clasico (la de SAU) o control_board (pizarra de producción).';

update empresa
   set tema_taller = 'control_board'
 where nombre_fantasia = 'TALLER FORANI' or razon_social = 'TALLER FORANI';
