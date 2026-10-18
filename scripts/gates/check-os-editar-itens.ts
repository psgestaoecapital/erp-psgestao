/**
 * Gate de build · #135 (Triches) etapa 2: no atendimento centralizado a oficina inclui/edita itens, quantidade e preço
 * na própria Ordem de Serviço. Regra única em src/lib/oficina/itensNaOS.ts. A ficha grava pela MESMA RPC do
 * Diagnóstico (fn_oficina_diagnostico_salvar), que apaga item ausente e reescreve diagnóstico/km — então o payload
 * precisa levar TODOS os itens atuais e o texto/km como estão.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { edicaoInicialOS, montarDadosDiagnosticoOS, podeEditarItensNaOS, validarEdicaoOS } from '../../src/lib/oficina/itensNaOS'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

ok(podeEditarItensNaOS('centralizado', true, 'aberta'), 'centralizado + pode lançar valor + OS recebida → pode editar')
ok(podeEditarItensNaOS('centralizado', true, 'aguardando_aprovacao'), 'centralizado + aguardando aprovação → pode editar')
ok(!podeEditarItensNaOS('tablet', true, 'aberta'), 'modelo com tablet → não (itens seguem no Diagnóstico)')
ok(!podeEditarItensNaOS('centralizado', false, 'aberta'), 'perfil sem permissão de valor → não')
ok(!podeEditarItensNaOS('centralizado', true, 'em_execucao'), 'OS em execução → não')

const atual = {
  diagnostico: 'Folga no câmbio', km: 152300,
  itens: [
    { id: 'a', tipo: 'servico', servico_id: 's1', descricao: 'Revisão câmbio', quantidade: 1, preco: 450, tempo_estimado_h: 3, severidade: 'urgente', observacao: 'obs', status_item: 'pendente' },
    { id: 'b', tipo: 'peca', produto_id: 'p1', descricao: 'Óleo', quantidade: 4, preco: 68, status_item: 'aprovado' },
    { id: 'c', tipo: 'peca', descricao: 'Retentor', quantidade: 1, preco: 30, status_item: 'recusado' },
  ],
}
const ed = edicaoInicialOS(atual.itens)
ok(ed.length === 1 && ed[0].id === 'a' && ed[0].preco === '450', 'a edição abre só os itens sem decisão do cliente')

ed[0] = { ...ed[0], quantidade: '1,5', preco: '480,50' }
ed.push({ id: null, chave: 'n1', tipo: 'peca', descricao: ' Filtro ', quantidade: '2', preco: '35,90' })
ed.push({ id: null, chave: 'n2', tipo: 'servico', descricao: '', quantidade: '1', preco: '' })   // linha vazia
ed.push({ id: 'b', chave: 'b', tipo: 'peca', descricao: 'Óleo alterado', quantidade: '9', preco: '1' })   // aprovado: ignorar
const d = montarDadosDiagnosticoOS(atual, ed)
ok(d.diagnostico === 'Folga no câmbio' && d.km === '152300', 'devolve o diagnóstico e o km como estão (a RPC reescreve)')
ok(['a', 'b', 'c'].every((id) => d.itens.some((i) => i.id === id)), 'leva TODOS os itens atuais (a RPC apaga o que não vier), inclusive aprovado e recusado')
const a = d.itens.find((i) => i.id === 'a')!
ok(a.quantidade === '1.5' && a.preco === '480.50', 'item pendente leva a quantidade e o preço novos no formato do banco')
ok(a.servico_id === 's1' && a.tempo_estimado_h === '3' && a.severidade === 'urgente' && a.observacao === 'obs', 'item editado preserva serviço, tempo, severidade e observação do laudo')
const b = d.itens.find((i) => i.id === 'b')!
ok(b.descricao === 'Óleo' && b.quantidade === '4' && b.produto_id === 'p1', 'item aprovado não muda (RD-55), mesmo vindo na edição')
const novos = d.itens.filter((i) => i.id === null)
ok(novos.length === 1 && novos[0].descricao === 'Filtro' && novos[0].quantidade === '2' && novos[0].preco === '35.90', 'item novo entra com descrição/qtd/preço; linha vazia é ignorada')

ok(validarEdicaoOS(ed) === null, 'edição válida passa')
ok(validarEdicaoOS([{ id: null, chave: 'x', tipo: 'peca', descricao: 'X', quantidade: '0', preco: '' }]) !== null, 'quantidade zero é recusada')
ok(validarEdicaoOS([{ id: null, chave: 'x', tipo: 'peca', descricao: 'X', quantidade: '1', preco: 'abc' }]) !== null, 'preço inválido é recusado')
ok(validarEdicaoOS([{ id: 'a', chave: 'a', tipo: 'peca', descricao: '', quantidade: '1', preco: '' }]) !== null, 'item gravado sem descrição é recusado')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(card.includes("supabase.rpc('fn_oficina_diagnostico_salvar'"), 'a ficha grava pela mesma RPC do Diagnóstico (sem regra paralela)')
ok(/salvarItensOS[\s\S]*?fn_oficina_diagnostico_obter[\s\S]*?montarDadosDiagnosticoOS[\s\S]*?fn_oficina_diagnostico_salvar/.test(card), 'relê o diagnóstico na hora de salvar e monta o payload pela regra única')
ok(card.includes('podeEditarItensNaOS(') && card.includes('data-testid="os-editar-itens"'), 'botão "Editar itens e preços" com a regra única')
for (const k of ['oficina.os.editar_itens', 'oficina.os.item_descricao', 'oficina.os.item_quantidade', 'oficina.os.item_preco']) {
  ok(card.includes(`<AjudaCampo chave="${k}"`), `"?" (RD-95) em ${k}`)
}
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
ok(['oficina.os.editar_itens', 'oficina.os.item_descricao', 'oficina.os.item_quantidade', 'oficina.os.item_preco'].every((k) => migs.includes(`'${k}'`)), 'migration cria as chaves de ajuda')

if (falhas > 0) { console.error(`\n[check-os-editar-itens] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-os-editar-itens] edição de itens na OS conferida.')
