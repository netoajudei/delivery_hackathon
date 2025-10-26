/**
 * @name finalizar-pedido-function-calling
 * @version 1.0.0
 * @description
 * Função que resolve o problema de function calling na API Responses
 * quando o endpoint de tool_outputs ainda não está disponível.
 * 
 * Contexto: Sistema de Delivery por WhatsApp
 * 
 * Estratégia:
 * 1. Busca o histórico completo da conversation via GET /conversations/{id}/items
 * 2. Adiciona o resultado da tool (pedido processado)
 * 3. Envia o histórico para LLM resumir de forma inteligente
 * 4. Cria nova conversation com o resumo
 * 5. Retorna novo conversation_id para continuar conversa
 * 
 * Uso: Após processar tool "identificar_pedido_usuario"
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    console.log('[FINALIZADOR] 🔥 ===== INICIANDO =====');
    const body = await req.json();
    const { conversation_id, tool_result_message, pedido_info } = body;
    console.log(`[FINALIZADOR] 📋 Conversation ID: ${conversation_id}`);
    console.log(`[FINALIZADOR] 📦 Pedido Info:`, pedido_info);
    // ============================================
    // VALIDAÇÕES
    // ============================================
    if (!conversation_id) {
      throw new Error("'conversation_id' é obrigatório");
    }
    if (!conversation_id.startsWith('conv_')) {
      throw new Error(`conversation_id inválida (esperado: conv_XXX): ${conversation_id}`);
    }
    // ============================================
    // ETAPA 1: Buscar histórico da conversation
    // ============================================
    console.log('[FINALIZADOR] 🔍 Buscando histórico...');
    const conversationUrl = `https://api.openai.com/v1/conversations/${conversation_id}/items?limit=50`;
    console.log(`[FINALIZADOR] 🔗 URL: ${conversationUrl}`);
    const historyResponse = await fetch(conversationUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[FINALIZADOR] 📊 Status: ${historyResponse.status}`);
    if (!historyResponse.ok) {
      const errorText = await historyResponse.text();
      console.error(`[FINALIZADOR] ❌ Erro ao buscar histórico:`, errorText);
      throw new Error(`Erro histórico (${historyResponse.status}): ${errorText}`);
    }
    const historyData = await historyResponse.json();
    console.log(`[FINALIZADOR] ✅ Histórico: ${historyData.data?.length || 0} mensagens`);
    // ============================================
    // ETAPA 2: Formatar histórico
    // ============================================
    console.log('[FINALIZADOR] 📝 Formatando histórico...');
    let historicoFormatado = '';
    for (const item of historyData.data.reverse()){
      const role = item.role === 'user' ? 'CLIENTE' : 'ATENDENTE';
      // Verificar content
      if (!item.content || !Array.isArray(item.content)) {
        console.log(`[FINALIZADOR] ⚠️ Item sem content:`, item);
        continue;
      }
      for (const content of item.content){
        if (!content || !content.type) {
          console.log(`[FINALIZADOR] ⚠️ Content inválido:`, content);
          continue;
        }
        if (content.type === 'input_text' || content.type === 'output_text') {
          historicoFormatado += `\n[${role}]: ${content.text || ''}\n`;
        } else if (content.type === 'function_call') {
          historicoFormatado += `\n[TOOL CHAMADA]: ${content.name || 'desconhecida'}\n`;
          if (content.arguments) {
            historicoFormatado += `Argumentos: ${content.arguments}\n`;
          }
        }
      }
    }
    // Adicionar resultado da tool
    if (tool_result_message) {
      historicoFormatado += `\n[TOOL RESULTADO]: ${tool_result_message}\n`;
    }
    // Adicionar info do pedido
    if (pedido_info) {
      historicoFormatado += `\n[PEDIDO PROCESSADO]:\n`;
      historicoFormatado += `- Produto: ${pedido_info.nome_produto}\n`;
      historicoFormatado += `- Quantidade: ${pedido_info.quantidade}\n`;
      historicoFormatado += `- Valor: R$ ${pedido_info.valor}\n`;
      historicoFormatado += `- Total do Carrinho: R$ ${pedido_info.total_carrinho || 'N/A'}\n`;
    }
    if (!historicoFormatado || historicoFormatado.trim().length === 0) {
      console.log('[FINALIZADOR] ⚠️ Histórico vazio');
      historicoFormatado = '[Conversa iniciada]';
    }
    console.log('[FINALIZADOR] 📊 Histórico formatado (preview):');
    console.log(historicoFormatado.substring(0, 500) + '...');
    // ============================================
    // ETAPA 3: Resumir com LLM
    // ============================================
    console.log('[FINALIZADOR] 🤖 Resumindo com LLM...');
    const promptResumo = `Você é o encarregado de resumir o histórico de conversa de um sistema de delivery por WhatsApp.

Você receberá um histórico de conversação que precisou ser resumido para a criação de uma nova conversation (devido a limitações técnicas da API Conversations da OpenAI).

INSTRUÇÕES CRÍTICAS:

1. **Organize de forma clara e estruturada** todos os dados relevantes mencionados
2. **Seja resumido mas completo** - a IA deve ter noção de TUDO que foi discutido
3. **Diferencie intenções de ações confirmadas**:
   - ❌ "O cliente perguntou sobre hambúrguer" ≠ Pedido feito
   - ✅ "O cliente adicionou 2x Hambúrguer ao carrinho" = Ação confirmada

4. **Identifique e marque claramente**:
   - 🛒 ITENS NO CARRINHO (produtos confirmados)
   - 💰 VALORES (preços unitários e total)
   - ❓ DÚVIDAS do cliente sobre o cardápio
   - 💬 CONVERSAS gerais (saudações, pedidos de informação)
   - 🔧 TOOLS EXECUTADAS (identificar_pedido_usuario)
   - ⚠️ PROBLEMAS relatados pelo cliente

5. **Mantenha valores numéricos exatos**: quantidades, preços, totais
6. **Preserve o contexto**: "agora", "hoje", horários
7. **Inclua o resultado de tools executadas** se houver

FORMATO DE SAÍDA:

Resumo da conversa do delivery:

[Organize em tópicos claros com os dados relevantes]

---

HISTÓRICO A SER RESUMIDO:
${historicoFormatado}
`;
    const resumoResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: promptResumo
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });
    if (!resumoResponse.ok) {
      const errorText = await resumoResponse.text();
      throw new Error(`Erro ao gerar resumo: ${errorText}`);
    }
    const resumoData = await resumoResponse.json();
    const resumo = resumoData.choices[0].message.content;
    console.log('[FINALIZADOR] ✅ Resumo gerado');
    console.log('[FINALIZADOR] 📄 Preview:');
    console.log(resumo.substring(0, 300) + '...');
    // ============================================
    // ETAPA 4: Criar nova conversation
    // ============================================
    console.log('[FINALIZADOR] 🆕 Criando nova conversation...');
    const createConvResponse = await fetch('https://api.openai.com/v1/conversations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        metadata: {
          tipo: 'delivery',
          migrada_de: conversation_id,
          tem_pedido_ativo: pedido_info ? 'true' : 'false' // ✅ string ao invés de boolean
        }
      })
    });
    if (!createConvResponse.ok) {
      const errorText = await createConvResponse.text();
      throw new Error(`Erro ao criar conversation: ${errorText}`);
    }
    const newConvData = await createConvResponse.json();
    const novo_conversation_id = newConvData.id;
    console.log(`[FINALIZADOR] ✅ Nova conversation: ${novo_conversation_id}`);
    // ============================================
    // ETAPA 5: Inserir resumo na nova conversation
    // ============================================
    console.log('[FINALIZADOR] 📝 Inserindo resumo...');
    const insertResumoResponse = await fetch(`https://api.openai.com/v1/conversations/${novo_conversation_id}/items`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: resumo
              }
            ]
          },
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Entendido! Continuando o atendimento.'
              }
            ]
          }
        ]
      })
    });
    if (!insertResumoResponse.ok) {
      const errorText = await insertResumoResponse.text();
      throw new Error(`Erro ao inserir resumo: ${errorText}`);
    }
    const insertResumoData = await insertResumoResponse.json();
    console.log('[FINALIZADOR] ✅ Resumo inserido');
    console.log(`[FINALIZADOR] 📊 Items: ${insertResumoData.data?.length || 0}`);
    // ============================================
    // ETAPA 6: Retornar novo conversation_id
    // ============================================
    console.log('[FINALIZADOR] 🎉 ===== CONCLUÍDO =====');
    return new Response(JSON.stringify({
      success: true,
      novo_conversation_id: novo_conversation_id,
      conversation_id_antiga: conversation_id,
      resumo: resumo,
      mensagens_processadas: historyData.data.length,
      pedido_info: pedido_info,
      tokens_resumo: {
        input: resumoData.usage.prompt_tokens,
        output: resumoData.usage.completion_tokens,
        total: resumoData.usage.total_tokens
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[FINALIZADOR] ❌ ERRO:', error.message);
    console.error('[FINALIZADOR] 📋 Stack:', error.stack);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
