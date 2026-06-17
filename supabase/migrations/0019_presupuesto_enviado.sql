-- Para el flujo de Gonzalo: saber si un presupuesto ya se envió al cliente.
-- Estados que ve el empleado:
--   aprobado=false            → "Esperando que Fede apruebe"
--   aprobado=true, enviado=false → "Aprobado, tocá para enviar"
--   enviado=true              → "Enviado al cliente"
alter table presupuesto
  add column if not exists enviado boolean not null default false;
