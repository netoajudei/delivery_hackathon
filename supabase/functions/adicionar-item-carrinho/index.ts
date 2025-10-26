/**
 * @name adicionar-item-carrinho
 * @version 2.0.0
 * @description
 * (Função 2 de 2 do fluxo de adição)
 * Apenas SALVA o item no banco de dados.
 * É chamada pelo Webhook após o cliente confirmar a 'proposta'.
 * NÃO envia mensagens ao cliente (o Webhook faz isso).
 *
 * @baseado-em adicionar-item-carrinho-v1 (index(3).ts)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// ========================================
// FUNÇÃO HELPER: GERAR RESUMO E TOTAL
// (Mesma lógica de antes)
// ========================================
async function getResumoETotal(supabase, pedidoId) {
  const { data: itens, error } = await supabase.from('itens_pedido').select(`
      quantidade,
      preco_unitario_no_momento,
      cardapio:cardapio_item_id ( nome_item )
    `).eq('pedido_id', pedidoId);
  if (error) {
    console.error('[ADD_ITEM_V2] ❌ Erro ao buscar itens para resumo:', error.message);
    return {
      resumo: "Erro ao gerar resumo.",
      total: 0
    };
  }
  if (!itens || itens.length === 0) {
    return {
      resumo: 'Carrinho vazio',
      total: 0
    };
  }
  let resumo = '';
  let total = 0;
  for (const item of itens){
    const nomeItem = item.cardapio ? item.cardapio.nome_item : 'Item não encontrado';
    const subtotal = item.quantidade * item.preco_unitario_no_momento;
    total += subtotal;
    resumo += `${item.quantidade}x ${nomeItem} - R$ ${subtotal.toFixed(2)}\n`;
  }
  resumo += `\n💰 *Total: R$ ${total.toFixed(2)}*`;
  return {
    resumo,
    total
  };
}
// ========================================
// FUNÇÃO PRINCIPAL
// ========================================
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('[ADD_ITEM_V2] ========================================');
    console.log('[ADD_ITEM_V2] 🚀 Iniciando função (DB Only)');
    const body = await req.json();
    const { cliente_id, item_identificado } = body;
    // 1. VALIDAÇÃO DO PAYLOAD
    if (!cliente_id || !item_identificado) {
      throw new Error('Parâmetros obrigatórios faltando: cliente_id, item_identificado');
    }
    const { id_produto, nome_produto, quantidade, valor } = item_identificado;
    if (!id_produto || !nome_produto || !quantidade || !valor) {
      throw new Error('item_identificado incompleto: id_produto, nome_produto, quantidade, valor');
    }
    console.log(`[ADD_ITEM_V2] 📦 Cliente: ${cliente_id}, Item: ${quantidade}x ${nome_produto}`);
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    // 2. BUSCAR/CRIAR PEDIDO ATIVO
    // (Lógica de)
    console.log('[ADD_ITEM_V2] 🛒 Buscando pedido ativo...');
    let { data: pedidoAtivo } = await supabase.from('pedidos').select('id').eq('cliente_id', cliente_id).eq('status', 'iniciado').order('created_at', {
      ascending: false
    }).limit(1).single();
    let pedidoId;
    if (!pedidoAtivo) {
      console.log('[ADD_ITEM_V2] 📝 Criando novo pedido...');
      const { data: novoPedido, error: novoPedidoError } = await supabase.from('pedidos').insert({
        cliente_id: cliente_id,
        status: 'iniciado',
        total_pedido: 0
      }).select('id').single();
      if (novoPedidoError) throw novoPedidoError;
      pedidoId = novoPedido.id;
    } else {
      pedidoId = pedidoAtivo.id;
    }
    console.log('[ADD_ITEM_V2] ✅ Pedido ID:', pedidoId);
    // 3. ADICIONAR ITEM AO PEDIDO
    // (Lógica de)
    const { error: itemError } = await supabase.from('itens_pedido').insert({
      pedido_id: pedidoId,
      cardapio_item_id: id_produto,
      quantidade: parseInt(quantidade) || 1,
      preco_unitario_no_momento: parseFloat(valor)
    });
    if (itemError) throw new Error(`Erro ao adicionar item: ${itemError.message}`);
    console.log(`[ADD_ITEM_V2] ✅ Item ${quantidade}x ${nome_produto} adicionado.`);
    // 4. ATUALIZAR TOTAL E STATUS DO CLIENTE
    // (Lógica de)
    console.log('[ADD_ITEM_V2] 🧮 Calculando novo total...');
    const { resumo, total } = await getResumoETotal(supabase, pedidoId);
    await supabase.from('pedidos').update({
      total_pedido: total
    }).eq('id', pedidoId);
    console.log(`[ADD_ITEM_V2] ✅ Total atualizado: R$ ${total.toFixed(2)}`);
    console.log("[ADD_ITEM_V2] ✅ Status do cliente: 'fazendo_pedido'");
    // 5. RETORNO SUCESSO (SEM ENVIAR MENSAGEM)
    // Retorna o resumo para o Webhook, que pode usá-lo na resposta
    return new Response(JSON.stringify({
      success: true,
      message: 'Item adicionado ao banco de dados com sucesso.',
      detalhes: {
        pedido_id: pedidoId,
        resumo_atualizado: resumo,
        novo_total: total
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[ADD_ITEM_V2] 💥 ERRO FATAL:', error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
