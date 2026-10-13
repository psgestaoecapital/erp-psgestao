-- Backfill do NÚMERO do endereço dos clientes da PS quando embutido no logradouro ("Rua X 968" → 968).
-- Necessário pro layout NFSe Nacional (nro do tomador). O ViaCEP NÃO devolve número (é específico do endereço).
-- GO do CEO. Backup em rls2_backup.erp_clientes_numero_bkp_20260722. Idempotente (só numero NULL/'' + logradouro
-- terminando em número). Escopo: PS (empresa fiscal ativa). Demais tenants: o ClienteForm extrai sozinho ao salvar.
UPDATE public.erp_clientes
   SET numero = regexp_replace(logradouro, '^(.*\S)[\s,]+(\d{1,6}[A-Za-z]?)$', '\2'),
       logradouro = regexp_replace(logradouro, '^(.*\S)[\s,]+(\d{1,6}[A-Za-z]?)$', '\1'),
       updated_at = now()
 WHERE company_id='b26c19c0-bf6d-495b-b8d1-9fa8d6896725'
   AND (numero IS NULL OR numero='')
   AND logradouro ~ '[\s,]\d{1,6}[A-Za-z]?$';
