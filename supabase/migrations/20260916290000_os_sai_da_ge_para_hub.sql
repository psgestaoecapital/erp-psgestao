-- OS SAI DA GE → HUB (decisão CEO + Rodrigo + Jordana + André, 16/09).
-- A GE é o núcleo financeiro; ordem de serviço é OPERAÇÃO da vertical. A OS passa a viver dentro de
-- cada vertical (Oficina já tinha a sua; agora o Hub também). Validado: a R.R tem o Hub ativo e a
-- OS-2026-0002 é TESTE, não operação real.
--
-- 🔒 REMOVER DO MENU, NÃO APAGAR: ge_ordens_servico vira ativo=false (registro preservado, reversível).
--    A rota /dashboard/os continua existindo e funcionando; as OS existentes (erp_os) NÃO são tocadas (RD-30).
-- 🔒 grupo 'hub' confirmado no dado (as 14 telas de /dashboard/projetos/* usam grupo='hub').

-- 1) tira a OS do menu da GE (era is_shared=true → aparecia no núcleo e amplo)
UPDATE public.module_catalog SET ativo=false WHERE id='ge_ordens_servico';

-- 2) cadastra a OS no Hub de Projetos (vertical-specific ['hub'], subgrupo de obras/execução)
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ordem, ativo, is_shared, vertical_specific, icone, layer, descricao)
VALUES ('hub_ordens_servico','Ordens de Serviço','/dashboard/os','hub','projetos_obras',132,true,false,ARRAY['hub']::text[],'🔧','2_svc',
        'Ordens de serviço da vertical (execução): abertura, escopo, andamento. Vive na vertical, não na GE (núcleo financeiro).')
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo,
  ordem=EXCLUDED.ordem, ativo=true, is_shared=false, vertical_specific=EXCLUDED.vertical_specific, descricao=EXCLUDED.descricao;

-- Oficina (oficina_os) permanece intacta. #81 (revelação progressiva da tela de OS) segue como próximo passo.
