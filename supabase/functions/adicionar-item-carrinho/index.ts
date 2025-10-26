/**
 * @name adicionar-item-carrinho
 * @version 1.0.0bb
 * @description
 * Esta função é chamada pelo Orquestrador após a OpenAI identificar um item.
 * 1. Adiciona o item ao pedido ativo (ou cria um novo).
 * 2. Recalcula o total do pedido.
 * 3. Muda o status do cliente para 'fazendo_pedido'.
 * 4. Envia uma mensagem de confirmação via WAME com 3 botões.
 *
 * @baseado-em propor-registro-refeicao (index.ts)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// ========================================
// FUNÇÃO HELPER: GERAR RESUMO
// (Baseado na lógica do Orquestrador v2.2.2)
// ========================================
async function gerarResumoCarrinho(supabase, pedidoId) {
  const { data: itens, error } = await supabase.from('itens_pedido').select(`
      quantidade,
      preco_unitario_no_momento,
      cardapio:cardapio_item_id (
        nome_item
      )
    `).eq('pedido_id', pedidoId);
  if (error) {
    console.error('[ADD_ITEM] ❌ Erro ao buscar itens para resumo:', error.message);
    return "Erro ao gerar resumo.";
  }
  if (!itens || itens.length === 0) {
    return 'Carrinho vazio';
  }
  let resumo = '';
  let total = 0;
  for (const item of itens){
    // Tratamento para caso o join com cardapio falhe
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
    console.log('[ADD_ITEM] ========================================');
    console.log('[ADD_ITEM] 🚀 Iniciando função');
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
    console.log('[ADD_ITEM] ✅ Validação de parâmetros OK');
    console.log(`[ADD_ITEM] 📦 Cliente: ${cliente_id}, Item: ${quantidade}x ${nome_produto}`);
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    // 2. BUSCAR CLIENTE (para o 'phone_number')
    // Adaptado de
    const { data: cliente, error: clienteError } = await supabase.from('clientes').select('phone_number') // Do seu 'deliveryhumanizado.sql'
    .eq('id', cliente_id).single();
    if (clienteError || !cliente) {
      console.error('[ADD_ITEM] ❌ Erro ao buscar cliente:', clienteError);
      throw new Error(`Cliente não encontrado. ID: ${cliente_id}`);
    }
    console.log('[ADD_ITEM] ✅ Cliente encontrado:', cliente.phone_number);
    // 3. BUSCAR/CRIAR PEDIDO ATIVO
    console.log('[ADD_ITEM] 🛒 Buscando pedido ativo...');
    let { data: pedidoAtivo } = await supabase.from('pedidos').select('id').eq('cliente_id', cliente_id).eq('status', 'iniciado') // Status 'iniciado' é o carrinho
    .order('created_at', {
      ascending: false
    }).limit(1).single();
    let pedidoId;
    if (!pedidoAtivo) {
      console.log('[ADD_ITEM] 📝 Nenhum pedido ativo. Criando novo...');
      const { data: novoPedido, error: novoPedidoError } = await supabase.from('pedidos').insert({
        cliente_id: cliente_id,
        status: 'iniciado',
        total_pedido: 0
      }).select('id').single();
      if (novoPedidoError) throw novoPedidoError;
      pedidoId = novoPedido.id;
      console.log('[ADD_ITEM] ✅ Pedido criado:', pedidoId);
    } else {
      pedidoId = pedidoAtivo.id;
      console.log('[ADD_ITEM] ✅ Pedido ativo encontrado:', pedidoId);
    }
    // 4. ADICIONAR ITEM AO PEDIDO
    // Adaptado de (lógica de 'insert')
    const quantidadeInt = parseInt(quantidade) || 1;
    const precoUnitario = parseFloat(valor);
    const { error: itemError } = await supabase.from('itens_pedido').insert({
      pedido_id: pedidoId,
      cardapio_item_id: id_produto,
      quantidade: quantidadeInt,
      preco_unitario_no_momento: precoUnitario
    });
    if (itemError) {
      console.error('[ADD_ITEM] ❌ Erro ao inserir item:', itemError);
      throw new Error(`Erro ao adicionar item: ${itemError.message}`);
    }
    console.log(`[ADD_ITEM] ✅ Item ${quantidadeInt}x ${nome_produto} adicionado.`);
    // 5. GERAR RESUMO E ATUALIZAR TOTAL
    console.log('[ADD_ITEM] 🧮 Calculando novo total...');
    const { resumo, total } = await gerarResumoCarrinho(supabase, pedidoId);
    await supabase.from('pedidos').update({
      total_pedido: total
    }).eq('id', pedidoId);
    console.log(`[ADD_ITEM] ✅ Total atualizado: R$ ${total.toFixed(2)}`);
    // 6. ATUALIZAR STATUS DO CLIENTE
    await supabase.from('clientes').update({
      status_conversa: 'fazendo_pedido'
    }).eq('id', cliente_id);
    console.log("[ADD_ITEM] ✅ Status do cliente: 'fazendo_pedido'");
    // 7. ENVIAR MENSAGEM WHATSAPP
    // Lógica de envio WAME de
    console.log('[ADD_ITEM] 🔑 Buscando WAME_API_KEY...');
    const { data: configData, error: configError } = await supabase.from('config_sistema').select('valor').eq('chave', 'wame_api_key').single();
    if (configError || !configData) {
      console.error('[ADD_ITEM] ❌ Erro ao buscar API key:', configError);
      throw new Error('WAME_API_KEY não encontrada em config_sistema');
    }
    const api_key = configData.valor;
    const api_url = `https://us.api-wa.me/${api_key}/message/button_reply`;
    const mensagem_texto = `Perfeito! Adicionei ao seu carrinho:

${resumo}

Deseja adicionar mais algo?`;
    // Botões do fluxo 'fazendo_pedido'
    const request_body = {
      to: cliente.phone_number,
      header: {
        title: '🛒 Carrinho Atualizado'
      },
      text: mensagem_texto,
      footer: 'Escolha uma opção:',
      buttons: [
        {
          type: 'quick_reply',
          id: 'btn_finalizar_pedido',
          text: '✅ Finalizar Pedido'
        },
        {
          type: 'quick_reply',
          id: 'btn_adicionar_mais_itens',
          text: '➕ Adicionar Mais'
        },
        {
          type: 'quick_reply',
          id: 'btn_cancelar_pedido',
          text: '❌ Cancelar Tudo'
        }
      ]
    };
    console.log('[ADD_ITEM] 📡 Enviando requisição para WAME...');
    const wameResponse = await fetch(api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request_body)
    });
    console.log('[ADD_ITEM] 📊 Status da resposta:', wameResponse.status);
    const responseBody = await wameResponse.text();
    if (!wameResponse.ok) {
      console.error('[ADD_ITEM] ❌ Erro na API WAME:', responseBody);
      throw new Error(`[WAME] Erro ${wameResponse.status}: ${responseBody}`);
    }
    console.log('[ADD_ITEM] ✅ Mensagem de confirmação enviada!');
    // 8. RETORNO SUCESSO
    // Adaptado de
    return new Response(JSON.stringify({
      success: true,
      message: 'Item adicionado e confirmação enviada ao cliente',
      detalhes: {
        pedido_id: pedidoId,
        cliente_id: cliente_id,
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
    // Adaptado de
    console.error('[ADD_ITEM] 💥 ERRO FATAL:', error.message);
    console.error('[ADD_ITEM] 💥 Stack:', error.stack);
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
