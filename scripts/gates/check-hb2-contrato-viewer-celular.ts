// Gate · Contrato de preços (auditoria 24/10): perfil consulta só lê (tela + banco) e a grade cabe no celular 390px.
// Sem rede: lê a tela e a migration.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const pg = readFileSync('src/app/dashboard/projetos/tabelas-preco/page.tsx', 'utf8')
const med = readFileSync('src/app/dashboard/projetos/tabelas-preco/_componentes/MedicaoContrato.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261025160054_hb2_contrato_precos_viewer_somente_leitura.sql', 'utf8')
ok(/fn_tabela_preco_pode_gravar/.test(pg) && /tabelaSel && podeGravar/.test(pg) && /!erro && podeGravar/.test(pg), 'tela: Arquivar e Editar contrato só para quem pode gravar')
ok(/podeGravar=\{podeGravar\}/.test(pg) && /podeGravar && <div[^>]*>\s*<button[^>]*med-salvar/.test(med) && /podeGravar && <button type="button" onClick=\{\(\) => excluir/.test(med), 'medição: Salvar e Excluir só para quem pode gravar')
ok(['erp_tabela_preco_cliente', 'erp_tabela_preco_item', 'erp_tabela_preco_condicao', 'erp_tabela_preco_codigo', 'erp_medicao_cliente', 'erp_medicao_cliente_item'].every((t) => new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON public\\.${t}\\s`).test(mig)), 'banco: gatilho de consulta nas 6 tabelas do contrato e da medição')
ok(/NOT IN \('viewer', 'visualizador'\)/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_tabela_preco_pode_gravar\(uuid\) FROM PUBLIC, anon/.test(mig) && !/CREATE OR REPLACE (VIEW|FUNCTION public\.fn_(tabela_preco|medicao)_(salvar|arquivar|faixa|condicao|codigo|medir|calcular|excluir))/.test(mig), 'banco: viewer barrado, REVOKE anon, nenhuma função de gravação existente reescrita')
ok(/tp-grade/.test(pg) && /max-width:480px/.test(pg) && /position:sticky/.test(pg), 'celular: grade compacta com a coluna de faixa fixa (cabe até domingo_feriado)')
if (falhas) process.exit(1)
