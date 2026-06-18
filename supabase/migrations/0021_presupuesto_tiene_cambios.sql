-- Flag para alertar a Gonzalo cuando Fede modifica un presupuesto
alter table presupuesto
  add column if not exists tiene_cambios boolean not null default false;
