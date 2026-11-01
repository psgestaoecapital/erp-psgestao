// #1677 etapa 4 · lê o pedido de compra e as duas empresas (tabelas com RLS da empresa, como o próprio usuário) e
// devolve os dados da Ordem de Fornecimento para o gerador puro (ordemFornecimentoPdf.ts).
import { supabase } from '@/lib/supabase'
import { cidadeUf, enderecoLinha, type DadosOF, type EmpresaOF } from './ordemFornecimentoPdf'

export async function carregarOrdemFornecimento(compraId: string, hojeISO: string): Promise<DadosOF> {
  const { data: c, error } = await supabase.from('erp_compras').select('*').eq('id', compraId).single()
  if (error || !c) throw new Error(error?.message ?? 'Pedido de compra não encontrado.')
  const [itens, empresa, fornecedor] = await Promise.all([
    supabase.from('erp_compras_itens').select('produto_codigo,produto_nome,unidade,quantidade,preco_unitario,subtotal').eq('compra_id', compraId).order('ordem', { nullsFirst: true }),
    supabase.from('companies').select('razao_social,nome_fantasia,cnpj,inscricao_estadual,logradouro,numero,complemento,bairro,endereco,cidade,uf_fiscal,cidade_estado,cep').eq('id', c.company_id).maybeSingle(),
    c.fornecedor_id
      ? supabase.from('erp_fornecedores').select('razao_social,nome_fantasia,cpf_cnpj,cnpj_cpf,ie,logradouro,numero,complemento,bairro,endereco,cidade,uf,cidade_estado,cep,telefone,celular,email').eq('id', c.fornecedor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (itens.error) throw new Error(itens.error.message)
  const emp = empresa.data
  const comprador: EmpresaOF = emp
    ? { razao_social: emp.razao_social, nome_fantasia: emp.nome_fantasia, cnpj: emp.cnpj, ie: emp.inscricao_estadual,
        endereco: enderecoLinha(emp), cidade_uf: cidadeUf({ ...emp, uf: emp.uf_fiscal }), cep: emp.cep }
    : { razao_social: null, cnpj: null }
  const f = fornecedor.data
  const forn: EmpresaOF = f
    ? { razao_social: f.razao_social || c.fornecedor_nome, nome_fantasia: f.nome_fantasia, cnpj: f.cpf_cnpj || f.cnpj_cpf || c.fornecedor_cnpj, ie: f.ie,
        endereco: enderecoLinha(f), cidade_uf: cidadeUf(f), cep: f.cep, telefone: f.telefone || f.celular, email: f.email }
    : { razao_social: c.fornecedor_nome, cnpj: c.fornecedor_cnpj }
  return {
    numero: c.numero || c.id.slice(0, 8), data_pedido: c.data_pedido, emitido_em: hojeISO,
    comprador, fornecedor: forn,
    itens: (itens.data ?? []).map((i) => ({ codigo: i.produto_codigo, descricao: i.produto_nome, unidade: i.unidade, quantidade: Number(i.quantidade ?? 0), preco_unitario: i.preco_unitario, subtotal: i.subtotal })),
    subtotal: c.subtotal, desconto_valor: c.desconto_valor, acrescimo_valor: c.acrescimo_valor, frete_valor: c.frete_valor, total: c.total,
    data_prevista: c.data_prevista, prazo_entrega_dias: c.prazo_entrega_dias, frete_tipo: c.frete_tipo, transportadora: c.transportadora,
    condicao_pagamento: c.condicao_pagamento, forma_pagamento: c.forma_pagamento, parcelas: c.parcelas, primeiro_vencimento: c.primeiro_vencimento,
    observacoes: c.observacoes,
  }
}
