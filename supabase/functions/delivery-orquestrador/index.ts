/**
 * @name delivery-orquestrador
 * @version 3.1.0 (COM PROPOR-PEDIDO)
 * @description 
 * Orquestrador integrado com propor-pedido
 * - Salva conversation_id na tabela clientes
 * - Ao detectar tool call, chama propor-pedido
 * - Usa finalizar-function-calling após processar
 * 
 * @changelog
 * - v3.1.0: Integração com propor-pedido
 * - v3.0.0: Integração com finalizar-function-calling
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000;
// ========================================
// HELPERS
// ========================================
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
async function chamarOpenAIComRetry(payload, tentativa = 1) {
  try {
    console.log(`[OPENAI] 🎯 Tentativa ${tentativa}/${MAX_RETRIES}`);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      const errorData = JSON.parse(errorText);
      if (errorData.error?.code === 'conversation_locked' && tentativa < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, tentativa - 1);
        console.warn(`[OPENAI] ⏳ Locked. Retry em ${delay}ms...`);
        await sleep(delay);
        return chamarOpenAIComRetry(payload, tentativa + 1);
      }
      throw new Error(`OpenAI error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    console.log('[OPENAI] ✅ Resposta recebida');
    return data;
  } catch (error) {
    if (tentativa < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, tentativa - 1);
      console.warn(`[OPENAI] ⚠️ Erro. Retry em ${delay}ms...`);
      await sleep(delay);
      return chamarOpenAIComRetry(payload, tentativa + 1);
    }
    throw error;
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
    console.log('[ORQUESTRADOR] 🚀 ===== INICIANDO =====');
    const { mensagem_id } = await req.json();
    if (!mensagem_id) {
      throw new Error('mensagem_id é obrigatório');
    }
    console.log('[ORQUESTRADOR] 📋 Mensagem ID:', mensagem_id);
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    // BUSCAR MENSAGEM
    const { data: mensagem, error: msgError } = await supabase.from('mensagem_temporario').select('id, cliente_id, whatsapp, mensagem').eq('id', mensagem_id).single();
    if (msgError) throw new Error(`Mensagem não encontrada: ${msgError.message}`);
    console.log('[ORQUESTRADOR] 📨 Mensagem:', mensagem.mensagem);
    // BUSCAR CLIENTE
    const { data: cliente, error: clienteError } = await supabase.from('clientes').select('id, phone_number, nome, status_conversa, conversation_id').eq('id', mensagem.cliente_id).single();
    if (clienteError) throw new Error(`Cliente não encontrado: ${clienteError.message}`);
    console.log('[ORQUESTRADOR] 🔀 Status:', cliente.status_conversa);
    console.log('[ORQUESTRADOR] 💬 Conversation:', cliente.conversation_id || 'NULL');
    // BUSCAR CARDÁPIO
    const { data: cardapio, error: cardapioError } = await supabase.from('cardapio').select('id, nome_item, preco, descricao_ia').eq('is_active', true);
    if (cardapioError) throw new Error(`Erro cardápio: ${cardapioError.message}`);
    const cardapioFormatado = cardapio.map((item)=>`- ${item.nome_item} (R$ ${item.preco}) [ID: ${item.id}]${item.descricao_ia ? ` - ${item.descricao_ia}` : ''}`).join('\n');
    console.log('[ORQUESTRADOR] 📋 Cardápio:', cardapio.length, 'itens');
    // ROTEAMENTO
    let respostaFinal = '';
    switch(cliente.status_conversa){
      case 'navegando':
      case 'fazendo_pedido':
        {
          console.log('[ORQUESTRADOR] 🟢 ===== ROTA: NAVEGANDO =====');
          // Buscar prompt
          console.log('[ORQUESTRADOR] 🔍 Buscando prompt do banco...');
          const { data: promptsData, error: promptError } = await supabase.from('prompts_contexto').select('prompt_final, functions').eq('contexto', 'navegando').eq('is_active', true).order('versao', {
            ascending: false
          }).limit(1);
          let promptData = null;
          if (promptError) {
            console.error('[ORQUESTRADOR] ❌ Erro ao buscar prompt:', promptError.message);
          } else if (!promptsData || promptsData.length === 0) {
            console.warn('[ORQUESTRADOR] ⚠️ Nenhum prompt encontrado no banco');
          } else {
            promptData = promptsData[0];
            console.log('[ORQUESTRADOR] ✅ Prompt carregado do banco');
          }
          // FALLBACK: Se não encontrou no banco, usar hardcoded
          if (!promptData) {
            console.warn('[ORQUESTRADOR] ⚠️ Usando prompt FALLBACK hardcoded');
            promptData = {
              prompt_final: `Você é um atendente virtual de delivery humanizado e amigável.

# CARDÁPIO DISPONÍVEL:
{CARDAPIO}

# RESPONSABILIDADES:
1. Ajudar o cliente a fazer pedidos
2. Responder dúvidas sobre o cardápio
3. Ser amigável e conversacional
4. Quando o cliente fizer um pedido, chame a tool "identificar_pedido_usuario"

# COMPORTAMENTO:
- Use linguagem natural e amigável
- Confirme itens quando houver dúvidas
- Se pedir algo fora do cardápio, sugira alternativas
- NUNCA invente itens que não estão no cardápio`,
              functions: [
                {
                  type: 'function',
                  name: 'identificar_pedido_usuario',
                  description: 'Identifica se o usuário fez um pedido, extrai e retorna id do produto, nome do produto, quantidade e valor.',
                  strict: true,
                  parameters: {
                    type: 'object',
                    required: [
                      'id_produto',
                      'nome_produto',
                      'quantidade',
                      'valor'
                    ],
                    properties: {
                      id_produto: {
                        type: 'string',
                        description: 'Identificador do produto'
                      },
                      nome_produto: {
                        type: 'string',
                        description: 'Nome do produto'
                      },
                      quantidade: {
                        type: 'string',
                        description: 'Quantidade do produto'
                      },
                      valor: {
                        type: 'number',
                        description: 'Valor do produto'
                      }
                    },
                    additionalProperties: false
                  }
                }
              ]
            };
          }
          console.log('[ORQUESTRADOR] 🔧 Functions:', promptData.functions?.length || 0);
          respostaFinal = await processarNavegando(supabase, cliente, mensagem, cardapioFormatado, promptData.prompt_final, promptData.functions);
          break;
        }
      case 'finalizando_pedido':
        {
          console.log('[ORQUESTRADOR] 🟡 ===== FINALIZANDO PEDIDO =====');
          respostaFinal = "⏳ Processando finalização...";
          break;
        }
      case 'aguardando_pedido':
        {
          console.log('[ORQUESTRADOR] 🔵 ===== AGUARDANDO PEDIDO =====');
          respostaFinal = "🚚 Seu pedido está em preparação!";
          break;
        }
      default:
        {
          console.warn('[ORQUESTRADOR] ⚠️ Status desconhecido:', cliente.status_conversa);
          await supabase.from('clientes').update({
            status_conversa: 'navegando'
          }).eq('id', cliente.id);
          respostaFinal = "Olá! Em que posso ajudar?";
        }
    }
    // SALVAR RESPOSTA (se tiver)
    if (respostaFinal) {
      await supabase.from('mensagem_temporario').update({
        resposta: respostaFinal,
        processed_at: new Date().toISOString()
      }).eq('id', mensagem_id);
    }
    console.log('[ORQUESTRADOR] 🎉 ===== CONCLUÍDO =====');
    return new Response(JSON.stringify({
      success: true,
      mensagem_id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[ORQUESTRADOR] 🔥 ERRO:', error.message);
    console.error('[ORQUESTRADOR] Stack:', error.stack);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
// ========================================
// PROCESSAR NAVEGANDO
// ========================================
async function processarNavegando(supabase, cliente, mensagem, cardapioFormatado, promptTemplate, functionsArray) {
  console.log('[NAVEGANDO] 🎯 Processando...');
  // 1. BUSCAR/CRIAR CONVERSATION
  let conversationId = cliente.conversation_id;
  if (!conversationId) {
    console.log('[NAVEGANDO] 📝 Criando conversation...');
    conversationId = await criarConversation(cliente.id);
    // ✅ SALVAR NA TABELA CLIENTES
    const { error: updateError } = await supabase.from('clientes').update({
      conversation_id: conversationId
    }).eq('id', cliente.id);
    if (updateError) {
      console.error('[NAVEGANDO] ❌ Erro ao salvar conversation_id:', updateError);
    } else {
      console.log('[NAVEGANDO] ✅ Conversation salvo na tabela clientes:', conversationId);
    }
  }
  // 2. MONTAR PROMPT
  const promptFinal = promptTemplate.replace('{CARDAPIO}', cardapioFormatado);
  const tools = Array.isArray(functionsArray) ? functionsArray : [];
  // 3. CHAMAR OPENAI
  const payload = {
    model: OPENAI_MODEL,
    conversation: conversationId,
    store: true,
    instructions: promptFinal,
    input: mensagem.mensagem,
    tools: tools.length > 0 ? tools : undefined
  };
  const data = await chamarOpenAIComRetry(payload);
  // 4. DETECTAR TOOL CALL
  let toolCall = null;
  for (const item of data.output || []){
    if (item.type === 'function_call') {
      toolCall = item;
      break;
    }
  }
  // ========================================
  // ROTA A: TOOL CALL → PROPOR PEDIDO
  // ========================================
  if (toolCall && toolCall.name === 'identificar_pedido_usuario') {
    console.log('[NAVEGANDO] 🔴 ===== TOOL CALL DETECTADA =====');
    const args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments;
    console.log('[NAVEGANDO] 📦 ARGUMENTOS COMPLETOS DA TOOL:');
    console.log(JSON.stringify(args, null, 2));
    console.log('[NAVEGANDO] 📦 Item identificado:');
    console.log('[NAVEGANDO]    - ID:', args.id_produto);
    console.log('[NAVEGANDO]    - Nome:', args.nome_produto);
    console.log('[NAVEGANDO]    - Qtd:', args.quantidade);
    console.log('[NAVEGANDO]    - Valor:', args.valor);
    // ✅ CHAMAR PROPOR-PEDIDO
    console.log('[NAVEGANDO] 📞 Chamando propor-pedido...');
    const proporPedidoResponse = await supabase.functions.invoke('propor-pedido', {
      body: {
        cliente_id: cliente.id,
        detalhes: {
          id_produto: args.id_produto,
          nome_produto: args.nome_produto,
          quantidade: args.quantidade,
          valor_total: args.valor // valor_total já vem do function calling
        }
      }
    });
    if (proporPedidoResponse.error) {
      console.error('[NAVEGANDO] ❌ Erro ao chamar propor-pedido:', proporPedidoResponse.error);
      throw new Error(`Propor-pedido falhou: ${proporPedidoResponse.error.message}`);
    }
    console.log('[NAVEGANDO] ✅ Propor-pedido invocado com sucesso');
    // ✅ CHAMAR FINALIZADOR
    console.log('[NAVEGANDO] 🔧 Chamando finalizador function calling...');
    const finalizadorResponse = await supabase.functions.invoke('finalizar-pedido-function-calling', {
      body: {
        conversation_id: conversationId,
        tool_result_message: `Cliente pediu: ${args.quantidade}x ${args.nome_produto}. Proposta enviada via WhatsApp aguardando confirmação.`,
        pedido_info: {
          nome_produto: args.nome_produto,
          quantidade: args.quantidade,
          valor: args.valor
        }
      }
    });
    if (finalizadorResponse.error) {
      console.error('[NAVEGANDO] ❌ Erro no finalizador:', finalizadorResponse.error);
      throw new Error(`Finalizador falhou: ${finalizadorResponse.error.message}`);
    }
    const finalizadorData = finalizadorResponse.data;
    console.log('[NAVEGANDO] ✅ Finalizador concluído');
    console.log('[NAVEGANDO] 🆕 Nova conversation:', finalizadorData.novo_conversation_id);
    // ✅ ATUALIZAR CONVERSATION_ID
    const { error: updateConvError } = await supabase.from('clientes').update({
      conversation_id: finalizadorData.novo_conversation_id,
      status_conversa: 'fazendo_pedido'
    }).eq('id', cliente.id);
    if (updateConvError) {
      console.error('[NAVEGANDO] ❌ Erro ao atualizar conversation_id:', updateConvError);
    } else {
      console.log('[NAVEGANDO] ✅ Cliente atualizado com nova conversation');
    }
    // NÃO RETORNAR RESPOSTA AQUI
    // A proposta foi enviada via WhatsApp com botões
    console.log('[NAVEGANDO] 📱 Proposta enviada via WhatsApp (com botões)');
    return ''; // Retorna vazio para não enviar mensagem duplicada
  } else {
    console.log('[NAVEGANDO] 🟢 ===== ROTA B: RESPOSTA NORMAL =====');
    let respostaTexto = '';
    for (const item of data.output || []){
      if (item.type === 'message' && item.role === 'assistant') {
        const textContent = item.content?.find((c)=>c.type === 'output_text');
        if (textContent) {
          respostaTexto = textContent.text;
          break;
        }
      }
    }
    console.log('[NAVEGANDO] 💬 Resposta:', respostaTexto.substring(0, 100) + '...');
    // ENVIAR WHATSAPP
    const WHATSAPP_INSTANCE_KEY = Deno.env.get('WHATSAPP_INSTANCE_KEY');
    if (WHATSAPP_INSTANCE_KEY && respostaTexto) {
      const url = `https://us.api-wa.me/${WHATSAPP_INSTANCE_KEY}/message/text`;
      try {
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            to: cliente.phone_number,
            text: respostaTexto
          })
        });
        console.log('[NAVEGANDO] ✅ WhatsApp enviado');
      } catch (err) {
        console.error('[NAVEGANDO] ❌ Erro WhatsApp:', err.message);
      }
    }
    return respostaTexto || 'Desculpe, não entendi.';
  }
}
// ========================================
// CRIAR CONVERSATION
// ========================================
async function criarConversation(clienteId) {
  const response = await fetch('https://api.openai.com/v1/conversations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      metadata: {
        cliente_id: clienteId,
        tipo: 'delivery'
      }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro criar conversation: ${errorText}`);
  }
  const data = await response.json();
  return data.id;
}
