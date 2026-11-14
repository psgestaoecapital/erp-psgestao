-- conserto-main (gilberto-esteira) — reverte o efeito do seed da PR #4932 que derrubou a main.
--
-- CAUSA (RD-38, provado no dado de produção em 2026-11-13):
--   A migration 20261115101548_demo005_rh_quadro_complemento (PR #4932) semeou 24 linhas em
--   public.rh_pessoa_complemento na DEMO de Indústria (company b0700000-0000-4000-a000-000000000005,
--   is_demo) com setor_id -> prod_setor. Essas linhas PERSISTEM ao reset (por desenho do seed).
--   Porém o fn_demo_reset recria o prod_setor dessa DEMO (delete/insert); com o complemento ainda
--   referenciando prod_setor, o reset passou a falhar com 23503:
--     "update or delete on table prod_setor violates foreign key constraint
--      rh_pessoa_complemento_setor_id_fkey on table rh_pessoa_complemento"
--     (setor 919389fb-fe85-4c3d-a312-1b8f4513371f = "Abate" ainda referenciado).
--   Resultado: o fn_demo_reset falhava no setup de 6 jornadas SST/EPI/LTCAT e o @pos-migration da
--   main ficou VERMELHO (run 43418578197), congelando toda a fila de migrations.
--
-- AÇÃO: remove o seed de complemento SÓ da DEMO 005 (is_demo; dado 100% fictício; nenhum cliente
--   real é tocado), devolvendo o estado anterior ao #4932 e liberando o fn_demo_reset. Idempotente.
--   A função fn_demo_seed_industria_rh_quadro é deixada inerte (só é chamada pela própria migration
--   #4932, que não re-roda); o dev dono (desenvolvedor_4_g) reimplementa o quadro de forma compatível
--   com o reset (ex.: fn_demo_reset limpar/renular o complemento antes do prod_setor, ou FK ON DELETE
--   SET NULL) antes de re-semear.
--
-- Prova RD-38 na PR: antes = 24 linhas (todas company 005); depois = 0 em company 005.
--
-- Nota: o corpo abaixo já foi aplicado à mão em produção (hotfix de main vermelha) via execute_sql;
--   esta migration o torna permanente e idempotente para qualquer rebuild do banco a partir das migrations.

DELETE FROM public.rh_pessoa_complemento
 WHERE company_id = 'b0700000-0000-4000-a000-000000000005';
