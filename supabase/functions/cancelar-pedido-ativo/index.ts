/**
 * @name cancelar-pedido-ativo
 * @version 1.0.0
 * @description
 * Esta função é chamada quando o usuário clica em "Cancelar Pedido".
 * 1. Encontra o pedido ativo do cliente (status 'iniciado').
 * 2. Deleta todos os 'itens_pedido' associados a ele.
 * 3. Reseta o pedido: 'total_pedido' para 0, 'palavra_chave' para NULL.
 * 4. Muda o status do cliente para 'navegando'.
 * 5. Envia uma mensagem de confirmação simples via WAME.
 *
 * @baseado-em adicionar-item-carrinho (index(3).ts)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// ========================================
// HELPER: ENVIAR WHATSAPP (Mensagem de Texto)
// Combina a lógica de 'config_sistema'
// com o endpoint '.../message/text'
// ========================================
async function enviarWhatsAppSimples(supabase, phoneNumber, mensagem) {
  console.log('[WAME_HELPER] 🔑 Buscando WAME_API_KEY...');
  const { data: configData, error: configError } = await supabase.from('config_sistema').select('valor').eq('chave', 'wame_api_key').single();
  if (configError || !configData) {
    console.error('[WAME_HELPER] ❌ Erro ao buscar API key:', configError);
    // Não lança erro, apenas loga, para não falhar a função principal
    return;
  }
  const api_key = configData.valor;
  const api_url = `https://us.api-wa.me/${api_key}/message/text`;
  const request_body = {
    to: phoneNumber,
    text: mensagem
  };
  try {
    console.log('[WAME_HELPER] 📡 Enviando mensagem simples...');
    const wameResponse = await fetch(api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request_body)
    });
    if (!wameResponse.ok) {
      const responseBody = await wameResponse.text();
      console.error(`[WAME_HELPER] ❌ Erro ${wameResponse.status}:`, responseBody);
    } else {
      console.log('[WAME_HELPER] ✅ Mensagem enviada.');
    }
  } catch (err) {
    console.error('[WAME_HELPER] 💥 Falha na requisição fetch:', err.message);
  }
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
    console.log('[CANCEL_PEDIDO] ========================================');
    console.log('[CANCEL_PEDIDO] 🚀 Iniciando função');
    // 1. VALIDAÇÃO DO PAYLOAD
    // Esta função só precisa do cliente_id para saber *qual* pedido cancelar
    const body = await req.json();
    const { cliente_id } = body;
    if (!cliente_id) {
      throw new Error('Parâmetro obrigatório faltando: cliente_id');
    }
    console.log('[CANCEL_PEDIDO] ✅ Cliente ID:', cliente_id);
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    // 2. BUSCAR CLIENTE (para o 'phone_number')
    // Padrão de
    const { data: cliente, error: clienteError } = await supabase.from('clientes').select('phone_number').eq('id', cliente_id).single();
    if (clienteError || !cliente) {
      console.error('[CANCEL_PEDIDO] ❌ Erro ao buscar cliente:', clienteError);
      throw new Error(`Cliente não encontrado. ID: ${cliente_id}`);
    }
    console.log('[CANCEL_PEDIDO] ✅ Cliente encontrado:', cliente.phone_number);
    // 3. ENCONTRAR O PEDIDO ATIVO
    // Um pedido ativo é aquele com status 'iniciado'
    console.log('[CANCEL_PEDIDO] 🛒 Buscando pedido ativo...');
    const { data: pedidoAtivo, error: pedidoError } = await supabase.from('pedidos').select('id').eq('cliente_id', cliente_id).eq('status', 'iniciado').limit(1).single();
    if (pedidoError || !pedidoAtivo) {
      // Caso seguro: O usuário clicou em cancelar, mas não tinha um pedido.
      console.warn('[CANCEL_PEDIDO] ⚠️ Nenhum pedido ativo (status=iniciado) encontrado.');
      // Apenas garante que o cliente volte ao estado 'navegando'
      await supabase.from('clientes').update({
        status_conversa: 'navegando'
      }).eq('id', cliente_id);
      // Envia a resposta de qualquer forma
      await enviarWhatsAppSimples(supabase, cliente.phone_number, "Você não tem um pedido em aberto. Pode começar um novo, o que gostaria?");
      return new Response(JSON.stringify({
        success: true,
        message: 'Nenhum pedido ativo encontrado, status do cliente redefinido.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    const pedidoId = pedidoAtivo.id;
    console.log('[CANCEL_PEDIDO] ✅ Pedido ativo encontrado:', pedidoId);
    // 4. DELETAR ITENS DO PEDIDO
    // (Conforme solicitado)
    console.log(`[CANCEL_PEDIDO] 🗑️ Deletando itens do pedido ${pedidoId}...`);
    const { error: deleteError } = await supabase.from('itens_pedido').delete().eq('pedido_id', pedidoId);
    if (deleteError) {
      console.error('[CANCEL_PEDIDO] ❌ Erro ao deletar itens:', deleteError);
      throw new Error(`Erro ao deletar itens: ${deleteError.message}`);
    }
    console.log('[CANCEL_PEDIDO] ✅ Itens deletados.');
    // 5. RESETAR O PEDIDO
    // (Conforme solicitado: resetar total, palavra_chave e status)
    console.log(`[CANCEL_PEDIDO] 🔄 Resetando pedido ${pedidoId}...`);
    const { error: updateError } = await supabase.from('pedidos').update({
      total_pedido: 0.00,
      palavra_chave: null,
      status: 'iniciado' // Manter status 'iniciado' (pronto para novos itens)
    }).eq('id', pedidoId);
    if (updateError) {
      console.error('[CANCEL_PEDIDO] ❌ Erro ao resetar pedido:', updateError);
      throw new Error(`Erro ao resetar pedido: ${updateError.message}`);
    }
    console.log('[CANCEL_PEDIDO] ✅ Pedido resetado.');
    // 6. RESETAR STATUS DO CLIENTE
    // (Conforme PRD)
    await supabase.from('clientes').update({
      status_conversa: 'navegando'
    }).eq('id', cliente_id);
    console.log("[CANCEL_PEDIDO] ✅ Status do cliente: 'navegando'");
    // 7. ENVIAR MENSAGEM DE CONFIRMAÇÃO
    const mensagemConfirmacao = "Pedido cancelado. Pode começar um novo pedido, o que gostaria?";
    await enviarWhatsAppSimples(supabase, cliente.phone_number, mensagemConfirmacao);
    // 8. RETORNO SUCESSO
    return new Response(JSON.stringify({
      success: true,
      message: 'Pedido cancelado e resetado com sucesso.',
      detalhes: {
        pedido_id_resetado: pedidoId,
        cliente_id: cliente_id
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    // Padrão de
    console.error('[CANCEL_PEDIDO] 💥 ERRO FATAL:', error.message);
    console.error('[CANCEL_PEDIDO] 💥 Stack:', error.stack);
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
