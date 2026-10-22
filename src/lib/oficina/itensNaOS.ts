// #135 (Triches) · etapa 2: incluir/editar itens, quantidade e preço direto na ficha da Ordem de Serviço
// (atendimento centralizado, sem tablet). Regra única usada pela ficha (OrdemServicoCard) e conferida pelo gate
// check-os-editar-itens. Grava pela MESMA RPC da tela de Diagnóstico (fn_oficina_diagnostico_salvar), que:
//  - reescreve o texto do diagnóstico e o km → mandamos de volta os valores ATUAIS (relidos na hora de salvar);
//  - apaga o item que não vier na lista → mandamos TODOS os itens atuais, inclusive aprovados e recusados;
//  - só aceita preço de quem pode lançar valor e nunca muda o preço de item já aprovado (RD-55).
import type { ModeloAtendimento } from './modelo'
import { decimalBanco } from '../decimalBanco'

export type ItemDiagOS = {
  id?: string | null; tipo?: string | null; servico_id?: string | null; produto_id?: string | null
  descricao?: string | null; quantidade?: number | string | null; preco?: number | string | null
  tempo_estimado_h?: number | string | null; severidade?: string | null; observacao?: string | null
  status_item?: string | null
}

// Linha da edição na ficha: item gravado (id) ou novo (sem id). Texto como o usuário digita ("1,5").
export type EdicaoItemOS = { id?: string | null; chave: string; tipo: 'peca' | 'servico'; descricao: string; quantidade: string; preco: string }

export type DiagnosticoAtualOS = { diagnostico?: string | null; km?: number | string | null; itens: ItemDiagOS[] }

const txt = (v: unknown): string => (v == null ? '' : String(v))

// Mesma janela do botão "Aprovar orçamento": centralizado, quem pode lançar valor, OS antes da execução.
export function podeEditarItensNaOS(modelo: ModeloAtendimento, podePreco: boolean, status: string): boolean {
  return modelo === 'centralizado' && podePreco && ['aberta', 'aguardando_aprovacao'].includes(status)
}

// Só item sem decisão do cliente muda. Aprovado/recusado fica como está (RD-55).
export function itemEditavelNaOS(it: ItemDiagOS): boolean {
  return (it.status_item ?? 'pendente') === 'pendente'
}

// Abre a edição a partir dos itens gravados (preço = unitário; o banco calcula subtotal = preço × quantidade).
export function edicaoInicialOS(itens: ItemDiagOS[]): EdicaoItemOS[] {
  return itens.filter((it) => !!it.id && itemEditavelNaOS(it)).map((it) => ({
    id: it.id, chave: String(it.id), tipo: it.tipo === 'servico' ? 'servico' : 'peca',
    descricao: txt(it.descricao), quantidade: txt(it.quantidade ?? 1), preco: txt(it.preco).replace('.', ','),
  }))
}

const num = (s: string): number => Number(decimalBanco(s))

// null = pode salvar; texto = o que corrigir (em linguagem do usuário).
export function validarEdicaoOS(edicoes: EdicaoItemOS[]): string | null {
  for (const e of edicoes) {
    const nome = e.descricao.trim()
    if (!nome) { if (!e.id) continue; return 'Preencha a descrição de todos os itens.' }   // linha nova vazia = ignorada
    const q = num(e.quantidade || '1')
    if (!Number.isFinite(q) || q <= 0) return `Quantidade inválida em "${nome}".`
    if (e.preco.trim()) { const p = num(e.preco); if (!Number.isFinite(p) || p < 0) return `Preço inválido em "${nome}".` }
  }
  return null
}

// Monta o p_dados da fn_oficina_diagnostico_salvar sem perder nada do que já está gravado.
export function montarDadosDiagnosticoOS(atual: DiagnosticoAtualOS, edicoes: EdicaoItemOS[]) {
  const porId = new Map(edicoes.filter((e) => e.id).map((e) => [String(e.id), e]))
  const itens = atual.itens.filter((it) => !!it.id).map((it) => {
    const e = itemEditavelNaOS(it) ? porId.get(String(it.id)) : undefined
    return {
      id: it.id, tipo: it.tipo ?? null, servico_id: it.servico_id ?? null, produto_id: it.produto_id ?? null,
      descricao: e && e.descricao.trim() ? e.descricao.trim() : txt(it.descricao),
      quantidade: e ? decimalBanco(e.quantidade || '1') : txt(it.quantidade),
      tempo_estimado_h: txt(it.tempo_estimado_h), severidade: it.severidade ?? null, observacao: it.observacao ?? null,
      preco: e ? decimalBanco(e.preco) : txt(it.preco),
    }
  })
  // Item novo: só com descrição (a linha vazia é ignorada). Entra pendente, como no Diagnóstico.
  const novos = edicoes.filter((e) => !e.id && e.descricao.trim()).map((e) => ({
    id: null, tipo: e.tipo, servico_id: null, produto_id: null, descricao: e.descricao.trim(),
    quantidade: decimalBanco(e.quantidade || '1'), tempo_estimado_h: '', severidade: null, observacao: null,
    preco: decimalBanco(e.preco),
  }))
  return { diagnostico: txt(atual.diagnostico), km: txt(atual.km), itens: [...itens, ...novos] }
}
