-- El agente necesita guardar su "cerebro" conversacional (lo que antes vivía
-- en los YAML: tono, preguntas_clave, accion). Lo guardamos como JSONB para
-- que el webhook reconstruya el agente desde la base, sin archivos hardcodeados.

alter table agente_config
  add column if not exists config jsonb,                  -- equivalente al YAML (tono, preguntas_clave, accion...)
  add column if not exists modelo text default 'claude-haiku-4-5';
