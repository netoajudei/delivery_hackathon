/**
 * @name propor-pedido
 * @version 2.0.0 (RECRIADO)
 * @description
 * Recebe dados do function calling e envia proposta com botões
 * - Recebe: id_produto, nome_produto, quantidade, valor_total
 * - Calcula: valor final do pedido
 * - Envia: WhatsApp com 3 botões (payload com dados completos)
 * 
 * @changelog
 * - v2.0.0: Recriado para trabalhar com function calling
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('[PROPOR_PEDIDO] 🔥 ===== INICIANDO =====');
    const body = await req.json();
    const { cliente_id, detalhes } = body;
    console.log('[PROPOR_PEDIDO] 📦 Payload recebido:', JSON.stringify(body, null, 2));
    // VALIDAÇÃO
    if (!cliente_id || !detalhes) {
      throw new Error('Parâmetros obrigatórios: cliente_id, detalhes');
    }
    const { id_produto, nome_produto, quantidade, valor_total } = detalhes;
    if (!id_produto || !nome_produto || !quantidade || !valor_total) {
      throw new Error('detalhes incompleto: id_produto, nome_produto, quantidade, valor_total');
    }
    console.log('[PROPOR_PEDIDO] ✅ Validação OK');
    console.log(`[PROPOR_PEDIDO] 📋 Cliente: ${cliente_id}`);
    console.log(`[PROPOR_PEDIDO] 🛒 Item: ${quantidade}x ${nome_produto}`);
    console.log(`[PROPOR_PEDIDO] 💰 Valor Total: R$ ${valor_total}`);
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    // BUSCAR CLIENTE (phone_number)
    console.log('[PROPOR_PEDIDO] 👤 Buscando cliente...');
    const { data: cliente, error: clienteError } = await supabase.from('clientes').select('phone_number').eq('id', cliente_id).single();
    if (clienteError || !cliente) {
      console.error('[PROPOR_PEDIDO] ❌ Erro ao buscar cliente:', clienteError);
      throw new Error(`Cliente não encontrado: ${cliente_id}`);
    }
    console.log('[PROPOR_PEDIDO] ✅ Cliente:', cliente.phone_number);
    // BUSCAR PEDIDO ATIVO E ITENS
    console.log('[PROPOR_PEDIDO] 🛒 Buscando carrinho atual...');
    const { data: pedidoAtivo } = await supabase.from('pedidos').select('id, total_pedido').eq('cliente_id', cliente_id).eq('status', 'iniciado').order('created_at', {
      ascending: false
    }).limit(1).single();
    let itensCarrinho = [];
    let totalCarrinhoAtual = 0;
    if (pedidoAtivo) {
      console.log('[PROPOR_PEDIDO] ✅ Pedido ativo encontrado:', pedidoAtivo.id);
      const { data: itens } = await supabase.from('itens_pedido').select(`
          quantidade,
          preco_unitario_no_momento,
          cardapio:cardapio_item_id (
            nome_item
          )
        `).eq('pedido_id', pedidoAtivo.id);
      if (itens && itens.length > 0) {
        itensCarrinho = itens;
        totalCarrinhoAtual = itens.reduce((sum, item)=>sum + item.quantidade * item.preco_unitario_no_momento, 0);
        console.log('[PROPOR_PEDIDO] 🛒 Itens no carrinho:', itens.length);
        console.log('[PROPOR_PEDIDO] 💰 Total carrinho atual: R$', totalCarrinhoAtual.toFixed(2));
      }
    } else {
      console.log('[PROPOR_PEDIDO] ℹ️ Nenhum pedido ativo (carrinho vazio)');
    }
    // BUSCAR WAME API KEY
    console.log('[PROPOR_PEDIDO] 🔑 Buscando WAME_API_KEY...');
    const { data: configData, error: configError } = await supabase.from('config_sistema').select('valor').eq('chave', 'wame_api_key').single();
    if (configError || !configData) {
      console.error('[PROPOR_PEDIDO] ❌ Erro ao buscar API key:', configError);
      throw new Error('WAME_API_KEY não encontrada em config_sistema');
    }
    const api_key = configData.valor;
    console.log('[PROPOR_PEDIDO] ✅ API Key encontrada');
    // CALCULAR VALOR FINAL
    const quantidade_num = parseFloat(quantidade);
    const valor_final = parseFloat(valor_total);
    console.log('[PROPOR_PEDIDO] 🧮 Cálculo:');
    console.log(`[PROPOR_PEDIDO]    Quantidade: ${quantidade_num}`);
    console.log(`[PROPOR_PEDIDO]    Valor Final: R$ ${valor_final.toFixed(2)}`);
    // MONTAR LISTA DE ITENS DO CARRINHO
    let listaItens = '';
    if (itensCarrinho.length > 0) {
      listaItens += '📦 *Itens no carrinho:*\n\n';
      for (const item of itensCarrinho){
        const subtotal = item.quantidade * item.preco_unitario_no_momento;
        listaItens += `${item.quantidade}x ${item.cardapio.nome_item}\n`;
        listaItens += `   R$ ${item.preco_unitario_no_momento.toFixed(2)} cada = R$ ${subtotal.toFixed(2)}\n\n`;
      }
    }
    // ADICIONAR ITEM NOVO
    listaItens += `➕ *Novo item:*\n\n`;
    listaItens += `${quantidade}x ${nome_produto}\n`;
    listaItens += `   R$ ${(valor_final / quantidade_num).toFixed(2)} cada = R$ ${valor_final.toFixed(2)}\n\n`;
    // CALCULAR TOTAIS
    const subtotalPedido = totalCarrinhoAtual + valor_final;
    const valorEntrega = 5.00; // Pode vir do banco depois
    const valorTotalFinal = subtotalPedido + valorEntrega;
    listaItens += `━━━━━━━━━━━━━━━━━━━━\n`;
    listaItens += `💰 Subtotal: R$ ${subtotalPedido.toFixed(2)}\n`;
    listaItens += `🚚 Entrega: R$ ${valorEntrega.toFixed(2)}\n`;
    listaItens += `━━━━━━━━━━━━━━━━━━━━\n`;
    listaItens += `🎯 *TOTAL: R$ ${valorTotalFinal.toFixed(2)}*\n\n`;
    // MONTAR MENSAGEM
    const mensagem_texto = `🛒 *Confirmação de Pedido*\n\n${listaItens}Está correto?`;
    // MONTAR PAYLOADS DOS BOTÕES
    // Incluir TODOS os dados necessários no payload
    const payload_add_continuar = JSON.stringify({
      action: 'add_e_continuar',
      item: {
        id_produto: id_produto,
        nome_produto: nome_produto,
        quantidade: quantidade,
        valor_unitario: (valor_final / quantidade_num).toFixed(2),
        valor_total: valor_final
      }
    });
    const payload_add_finalizar = JSON.stringify({
      action: 'add_e_finalizar',
      item: {
        id_produto: id_produto,
        nome_produto: nome_produto,
        quantidade: quantidade,
        valor_unitario: (valor_final / quantidade_num).toFixed(2),
        valor_total: valor_final
      }
    });
    const payload_cancelar = JSON.stringify({
      action: 'cancelar_item_proposto'
    });
    console.log('[PROPOR_PEDIDO] 📝 Payloads criados:');
    console.log(`[PROPOR_PEDIDO]    Continuar (${payload_add_continuar.length} chars)`);
    console.log(`[PROPOR_PEDIDO]    Finalizar (${payload_add_finalizar.length} chars)`);
    console.log(`[PROPOR_PEDIDO]    Cancelar (${payload_cancelar.length} chars)`);
    // VALIDAR TAMANHO DOS PAYLOADS (máximo 256 caracteres)
    if (payload_add_continuar.length > 256) {
      throw new Error(`Payload 'continuar' muito grande: ${payload_add_continuar.length} chars (max: 256)`);
    }
    if (payload_add_finalizar.length > 256) {
      throw new Error(`Payload 'finalizar' muito grande: ${payload_add_finalizar.length} chars (max: 256)`);
    }
    // MONTAR REQUEST BODY WAME
    const api_url = `https://us.api-wa.me/${api_key}/message/button_reply`;
    const request_body = {
      to: cliente.phone_number,
      header: {
        title: "🛒 Confirmar Pedido"
      },
      text: mensagem_texto,
      footer: 'Escolha uma opção:',
      buttons: [
        {
          type: 'quick_reply',
          id: payload_add_continuar,
          text: '✅ Sim, pedir mais'
        },
        {
          type: 'quick_reply',
          id: payload_add_finalizar,
          text: '✅ Sim, finalizar'
        },
        {
          type: 'quick_reply',
          id: payload_cancelar,
          text: '❌ Cancelar'
        }
      ]
    };
    console.log('[PROPOR_PEDIDO] 📡 Enviando para WAME...');
    console.log(`[PROPOR_PEDIDO] 🔗 URL: ${api_url}`);
    const wameResponse = await fetch(api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request_body)
    });
    const responseBody = await wameResponse.text();
    if (!wameResponse.ok) {
      console.error('[PROPOR_PEDIDO] ❌ Erro WAME:', responseBody);
      throw new Error(`WAME error ${wameResponse.status}: ${responseBody}`);
    }
    console.log('[PROPOR_PEDIDO] ✅ Proposta enviada com sucesso!');
    console.log('[PROPOR_PEDIDO] 📱 WhatsApp enviado para:', cliente.phone_number);
    console.log('[PROPOR_PEDIDO] 🎉 ===== CONCLUÍDO =====');
    return new Response(JSON.stringify({
      success: true,
      message: 'Proposta enviada via WhatsApp',
      detalhes: {
        cliente_id: cliente_id,
        phone_number: cliente.phone_number,
        item: nome_produto,
        quantidade: quantidade,
        valor_final: valor_final
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[PROPOR_PEDIDO] 💥 ERRO:', error.message);
    console.error('[PROPOR_PEDIDO] Stack:', error.stack);
    return new Response(JSON.stringify({
      success: false,
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
