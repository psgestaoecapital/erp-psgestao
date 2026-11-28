// Gate (chamados #6726 Vianz e #11084) — Emitir NF-e avulsa: o campo Cliente/Fornecedor é uma caixa de busca que consulta o
// SERVIDOR pela função canônica (fn_cliente_buscar / fn_fornecedor_buscar: nome fantasia OU razão social OU documento),
// não filtra uma lista pré-carregada. Antes (#6726) a lista vinha cortada em 500 cadastros ordenados por razão social
// (NULL por último), então pessoa física — que guarda o nome só em nome_fantasia — ficava depois do corte e sumia da busca
// ("nenhum cadastro encontrado") em empresa com mais de 500 clientes. Não escolhe o 1º cadastro sozinho.
import { readFileSync } from 'node:fs'
import { buscarDestinatarios, opcoesDaResposta, termoValido, textoOpcao, FUNCAO_BUSCA, type ChamarRpc } from '../../src/lib/fiscal/destinatarioBusca'
import { orFiltroClienteBusca } from '../../src/lib/clienteBusca'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const src = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261126110030_fn_fornecedor_buscar_11084.sql', 'utf8')

// ---- tela ----
ok(/data-testid="nfe-avulsa-destinatario"/.test(src), 'campo de destinatário é caixa de busca (input), não lista fixa')
ok(/buscarDestinatarios\(/.test(src) && /termoValido\(/.test(src), 'a busca é feita no servidor (buscarDestinatarios), com mínimo de 2 caracteres')
ok(FUNCAO_BUSCA.erp_clientes === 'fn_cliente_buscar' && FUNCAO_BUSCA.erp_fornecedores === 'fn_fornecedor_buscar', 'cliente → fn_cliente_buscar (canônica); fornecedor → fn_fornecedor_buscar')
ok(!/\.order\('razao_social'\)/.test(src) && !/pessoasFiltradas/.test(src) && !/setPessoas/.test(src), 'sem lista pré-carregada ordenada por razão social (era cortada em 500 e escondia pessoa física)')
ok(!/\.limit\(500\)/.test(src), 'sem corte de 500 cadastros no destinatário')
ok(/onMouseDown=\{\(\) => \{ setDestinatarioId\(o\.id\)/.test(src), 'cadastro só é escolhido por clique do usuário na lista')
ok(/\.eq\('id', destinatarioId\)\.eq\('company_id', companyId\)/.test(src), 'o escolhido é lido por id DENTRO da empresa (UF/IE/contribuinte do cadastro)')
ok(/Nenhum cadastro encontrado/.test(src) && /Digite ao menos 2 letras/.test(src) && /Buscando/.test(src), 'estados da busca: dica, buscando, sem resultado')

// ---- biblioteca (banco simulado) ----
const lib = readFileSync('src/lib/fiscal/destinatarioBusca.ts', 'utf8')
ok(!/supabase/i.test(lib.replace(/\/\/.*$/gm, '')), 'biblioteca pura (sem Supabase importado)')
ok(!termoValido('a') && termoValido('ri') && !termoValido('   '), 'mínimo de 2 caracteres')
ok(textoOpcao({ nome: 'Jordana Carolina Richter', documento: '02814406035', cidade: 'Jaraguá do Sul' }) === 'Jordana Carolina Richter · 02814406035 · Jaraguá do Sul', 'texto da opção: nome · documento · cidade')
ok(opcoesDaResposta({ ok: true, resultados: [{ fornecedor_id: 'f1', nome: 'Forn', cnpj_cpf: null, cidade: null }] })[0]?.id === 'f1', 'resposta de fornecedor (fornecedor_id) vira opção')

async function simula() {
  const chamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  // banco simulado: 737 clientes (458 PJ com razão social + 279 PF só com nome_fantasia) — a PF NÃO pode sumir
  const chamar: ChamarRpc = async (fn, args) => {
    chamadas.push({ fn, args })
    const termo = String(args.p_termo).toLowerCase()
    const base = [{ cliente_id: '8a9cf735', nome: 'Jordana Carolina Richter', cnpj_cpf: '02814406035', cidade: 'X' }, { cliente_id: 'pj1', nome: 'Richter Comércio Ltda', cnpj_cpf: '11111111000191', cidade: 'Y' }]
    return { data: { ok: true, resultados: base.filter((b) => b.nome.toLowerCase().includes(termo) || (b.cnpj_cpf ?? '').includes(termo)) }, error: null }
  }
  const a = await buscarDestinatarios(chamar, 'erp_clientes', 'emp', 'Jordana')
  ok(a.opcoes.length === 1 && a.opcoes[0].id === '8a9cf735' && a.erro === null, 'buscar "Jordana" encontra a pessoa física (nome só em nome_fantasia)')
  const b = await buscarDestinatarios(chamar, 'erp_clientes', 'emp', 'Richter')
  ok(b.opcoes.length === 2, 'buscar "Richter" encontra PF e PJ')
  const c = await buscarDestinatarios(chamar, 'erp_clientes', 'emp', '02814406035')
  ok(c.opcoes.length === 1 && c.opcoes[0].id === '8a9cf735', 'buscar pelo CPF encontra a pessoa física')
  ok(chamadas.every((x) => x.fn === 'fn_cliente_buscar' && x.args.p_company_id === 'emp'), 'chama a função canônica, sempre com a empresa')
  const n = chamadas.length
  const d = await buscarDestinatarios(chamar, 'erp_clientes', 'emp', 'J')
  ok(d.opcoes.length === 0 && chamadas.length === n, 'termo curto não chama o banco')
  const e = await buscarDestinatarios(async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }), 'erp_clientes', 'emp', 'Jordana')
  ok(e.opcoes.length === 0 && !!e.erro && !/timeout/i.test(e.erro), 'falha do banco vira aviso em linguagem do usuário (nunca lista vazia silenciosa nem erro cru)')
  const f = await buscarDestinatarios(async () => ({ data: { ok: false, erro: 'Sem acesso a esta empresa' }, error: null }), 'erp_clientes', 'emp', 'Jordana')
  ok(f.erro === 'Sem acesso a esta empresa', 'sem acesso à empresa é mostrado')
}

// ---- filtro compartilhado dos demais seletores (NF-e da OS, orçamento, agenda): documento nas DUAS colunas ----
const filtro = orFiltroClienteBusca('028.144.060-35') ?? ''
ok(filtro.includes('cpf_cnpj.ilike.%02814406035%') && filtro.includes('cnpj_cpf.ilike.%02814406035%'), 'filtro compartilhado busca o documento em cpf_cnpj E cnpj_cpf')
// #5451: o nome vira filtro pela coluna normalizada `busca_norm` (sem acento, minúsculo), não mais ilike cru em nome/razão.
ok(/busca_norm\.ilike\.%jordana%/.test(orFiltroClienteBusca('Jordana') ?? '') && !/cpf_cnpj/.test(orFiltroClienteBusca('Jordana') ?? ''), 'nome sem dígitos vira filtro por busca_norm normalizada, não por documento (bug Jordana 08/07 segue fechado)')

// ---- migration ----
ok(/CREATE OR REPLACE FUNCTION public\.fn_fornecedor_buscar\(p_company_id uuid, p_termo text, p_limit int DEFAULT 10\)/.test(mig), 'migration cria fn_fornecedor_buscar')
ok(/REVOKE ALL ON FUNCTION public\.fn_fornecedor_buscar\(uuid, text, int\) FROM PUBLIC, anon;/.test(mig) && /GRANT EXECUTE[\s\S]*TO authenticated, service_role/.test(mig), 'fechada ao anon')
ok(/NOT public\.is_admin\(\) AND p_company_id NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(mig), 'confere o acesso à empresa')
ok(/nome_fantasia ILIKE[\s\S]*razao_social ILIKE[\s\S]*cnpj_cpf[\s\S]*cpf_cnpj/.test(mig), 'fornecedor: nome fantasia OU razão social OU documento (as duas colunas)')
ok(!/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bDROP\b|ALTER TABLE/.test(mig.replace(/--.*$/gm, '')), 'migration aditiva: só função de leitura nova')
ok(!/fn_cliente_buscar/.test(mig.replace(/--.*$/gm, '')), 'não altera a fn_cliente_buscar (itens do #5848 intactos)')

simula().then(() => {
  if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
})
