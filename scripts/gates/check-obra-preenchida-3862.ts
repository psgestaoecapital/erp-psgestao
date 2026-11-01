/**
 * Gate de build (#3862 complemento): a obra do pedido não é pedida de novo na NFS-e de obra.
 *   - obra cadastrada completa → aponta e não falta nada;
 *   - endereço congelado no orçamento → abre informado, sem perguntar o que já existe;
 *   - CNO nunca é exigido (opcional);
 *   - o modal de faturamento usa o helper e mostra o que falta.
 *   tsx scripts/gates/check-obra-preenchida-3862.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { camposObraFaltando, obraPreenchidaDoOrcamento, type OrcamentoObra, type ObraSalva } from '../../src/lib/fiscal/obraPreenchida'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const vazio: OrcamentoObra = {
  obra_id: null, obra_cno: null, obra_logradouro: null, obra_numero: null, obra_complemento: null,
  obra_bairro: null, obra_cidade: null, obra_uf: null, obra_cep: null, obra_codigo_ibge: null,
}
const completa: ObraSalva = {
  id: 'o1', numero: 'OBR-1', nome: 'Casa', cliente_nome: 'FC Pisos', endereco: 'Rua A', numero_endereco: '10',
  bairro: 'Centro', cidade: 'Paraíso', uf: 'SC', cep: '89000000', cno: null, codigo_ibge_municipio: '4212101',
}
const incompleta: ObraSalva = { ...completa, numero_endereco: null, codigo_ibge_municipio: null }

// 1) obra completa cadastrada → aponta, sem faltar nada (CNO vazio não conta)
const a = obraPreenchidaDoOrcamento({ ...vazio, obra_id: 'o1' }, completa)
ok(!!a && a.modo === 'apontar' && a.obraSel?.id === 'o1', 'obra completa → aponta a obra do pedido')
ok(a !== null && camposObraFaltando({ modo: a.modo, obraSel: a.obraSel, obraEnd: { logradouro: '', numero: '', bairro: '', cep: '', codigo_ibge_municipio: '' } }).length === 0, 'obra completa sem CNO → nada a preencher')

// 2) endereço congelado no orçamento (sem obra cadastrada) → informa com o endereço, sem perguntar de novo
const b = obraPreenchidaDoOrcamento({ ...vazio, obra_logradouro: 'Rua B', obra_numero: '5', obra_bairro: 'Sul', obra_cep: '89100000', obra_codigo_ibge: '4212101', obra_cidade: 'Paraíso', obra_uf: 'SC' }, null)
ok(!!b && b.modo === 'informar' && b.obraEnd?.logradouro === 'Rua B', 'endereço do orçamento → informa já preenchido')
ok(b !== null && camposObraFaltando({ modo: b.modo, obraSel: null, obraEnd: b.obraEnd! }).length === 0, 'endereço do orçamento completo → nada a preencher')

// 3) obra cadastrada incompleta → aparece escolhida e diz o que falta (IBGE e número), sem exigir CNO
const c = obraPreenchidaDoOrcamento({ ...vazio, obra_id: 'o1' }, incompleta)
ok(!!c && c.modo === 'apontar', 'obra incompleta → aparece escolhida (com aviso no bloco)')
ok(c !== null && JSON.stringify(camposObraFaltando({ modo: c.modo, obraSel: c.obraSel, obraEnd: { logradouro: '', numero: '', bairro: '', cep: '', codigo_ibge_municipio: '' } })) === JSON.stringify(['número', 'município (IBGE)']), 'obra incompleta → falta número e município')

// 4) nada no pedido → null (bloco segue como antes)
ok(obraPreenchidaDoOrcamento(vazio, null) === null, 'pedido sem obra → sem pré-preenchimento')

// 5) faltantes do modo informar: CNO nunca aparece
const d = camposObraFaltando({ modo: 'informar', obraSel: null, obraEnd: { logradouro: '', numero: '', bairro: '', cep: '', codigo_ibge_municipio: '' } })
ok(!d.some((x) => /cno/i.test(x)) && d.length === 5, 'informar vazio → 5 campos de endereço, nenhum CNO')
ok(camposObraFaltando({ modo: 'apontar', obraSel: null, obraEnd: { logradouro: '', numero: '', bairro: '', cep: '', codigo_ibge_municipio: '' } }).join() === 'obra', 'apontar sem obra → pede a obra')

// 6) o modal usa o helper e mostra o que falta
const modal = readFileSync(join(__dirname, '../../src/components/fiscal/NFSeEmitirGovModal.tsx'), 'utf8')
ok(modal.includes('obraPreenchidaDoOrcamento(') && modal.includes('camposObraFaltando(obraFiscal)'), 'modal pré-preenche e mostra o que falta')
ok(modal.includes(".eq('pedido_id', pedidoId)") && modal.includes("'projetos_obras'"), 'modal lê o orçamento do pedido e a obra salva')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK — obra do pedido não é pedida de novo (#3862)')
