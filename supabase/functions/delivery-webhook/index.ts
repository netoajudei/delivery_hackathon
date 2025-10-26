/**
 * @name delivery-webhook
 * @version 1.5.0 (FINAL - com detecção de finalização e exigência de áudio)
 * @description
 * Webhook Síncrono (Atendente) para o Delivery - com desvio quando cliente está finalizando pedido
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// ========================================
// FUNÇÕES HELPER (COMPLETAS)
// ========================================
async function getOrCreateCliente(supabase, whatsappNumber) {
  const { data: clienteExistente, error: selectError } = await supabase.from("clientes").select("*").eq("phone_number", whatsappNumber).single();
  if (selectError && selectError.code !== "PGRST116") {
    console.error(`[HELPER] Erro ao buscar cliente: ${selectError.message}`);
    throw new Error(`Erro ao buscar cliente: ${selectError.message}`);
  }
  if (clienteExistente) {
    console.log(`[HELPER] Cliente encontrado: ${clienteExistente.id}`);
    return clienteExistente;
  }
  console.log(`[HELPER] Cliente não encontrado. Criando novo cliente para ${whatsappNumber}`);
  const { data: novoCliente, error: insertError } = await supabase.from("clientes").insert({
    phone_number: whatsappNumber,
    status_conversa: "navegando"
  }).select().single();
  if (insertError) {
    console.error(`[HELPER] Erro ao criar cliente: ${insertError.message}`);
    throw new Error(`Erro ao criar cliente: ${insertError.message}`);
  }
  console.log(`[HELPER] Novo cliente criado: ${novoCliente.id}`);
  return novoCliente;
}
async function getPedidoAtivo(supabase, clienteId) {
  const { data: pedidoExistente, error: selectError } = await supabase.from("pedidos").select("*").eq("cliente_id", clienteId).eq("status", "iniciado").order("created_at", {
    ascending: false
  }).limit(1).single();
  if (selectError && selectError.code !== "PGRST116") {
    console.error(`[HELPER] Erro ao buscar pedido ativo: ${selectError.message}`);
    throw new Error(`Erro ao buscar pedido ativo: ${selectError.message}`);
  }
  if (pedidoExistente) {
    console.log(`[HELPER] Pedido ativo encontrado: ${pedidoExistente.id}`);
    return pedidoExistente;
  }
  console.log(`[HELPER] Nenhum pedido ativo. Criando novo carrinho para cliente ${clienteId}`);
  const { data: novoPedido, error: insertError } = await supabase.from("pedidos").insert({
    cliente_id: clienteId,
    status: "iniciado"
  }).select().single();
  if (insertError) {
    console.error(`[HELPER] Erro ao criar novo pedido: ${insertError.message}`);
    throw new Error(`Erro ao criar novo pedido: ${insertError.message}`);
  }
  console.log(`[HELPER] Novo pedido/carrinho criado: ${novoPedido.id}`);
  return novoPedido;
}
async function enviarResposta(key, to, text) {
  const url = `https://us.api-wa.me/${key}/message/text`;
  console.log(`[HELPER] Enviando resposta para ${to}: "${text.substring(0, 30)}..."`);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to,
        text
      })
    });
    console.log(`[HELPER] Resposta enviada com sucesso.`);
  } catch (err) {
    console.error(`[HELPER] ⚠️ Falha ao enviar resposta: ${err.message}`);
  }
}
function gerarPalavraChave() {
  const palavras = [
    "SAFIRA",
    "RUBI",
    "ESMERALDA",
    "DIAMANTE",
    "OURO",
    "PRATA"
  ];
  return palavras[Math.floor(Math.random() * palavras.length)];
}
// 🔧 NOVO HELPER: pedido em andamento (pega palavra_chave para instrução)
async function getPedidoEmAndamento(supabase, clienteId) {
  const { data, error } = await supabase.from("pedidos").select("id, palavra_chave").eq("cliente_id", clienteId).eq("status", "em_andamento").order("created_at", {
    ascending: false
  }).limit(1).single();
  if (error && error.code !== "PGRST116") {
    console.error("[HELPER] Erro ao buscar pedido em_andamento:", error.message);
    throw error;
  }
  return data || null;
}
// ========================================
// 🔧 HELPER: INVOCAR ORQUESTRADOR (mantido)
// ========================================
async function invocarOrquestrador(supabase, mensagemId) {
  console.log(`[HELPER] 🎯 Invocando orquestrador para mensagem: ${mensagemId}`);
  try {
    const { data, error } = await supabase.functions.invoke("delivery-orquestrador", {
      body: {
        mensagem_id: mensagemId
      }
    });
    if (error) {
      console.error(`[HELPER] ❌ Erro ao invocar orquestrador:`, error);
      throw error;
    }
    console.log(`[HELPER] ✅ Orquestrador invocado com sucesso`);
    return data;
  } catch (err) {
    console.error(`[HELPER] 🔥 Falha crítica ao invocar orquestrador:`, err.message);
  // não propaga erro para não forçar reenvio do WhatsApp
  }
}
// ========================================
// FIM DAS FUNÇÕES HELPER
// ========================================
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    console.log("[WEBHOOK-DELIVERY] ===== PAYLOAD COMPLETO RECEBIDO =====");
    const { instance: key, data } = body;
    if (!key) throw new Error("Chave de instância (instance) ausente");
    if (!data) throw new Error("Objeto 'data' ausente");
    if (data.isGroup) {
      console.log("[WEBHOOK-DELIVERY] ℹ️ Mensagem de grupo ignorada");
      return new Response("ok: group message ignored", {
        headers: corsHeaders
      });
    }
    const whatsappNumber = (data.remoteJid || data.from || data.sender)?.replace(/\D/g, "");
    if (!whatsappNumber) throw new Error("Não foi possível encontrar o número do WhatsApp");
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const cliente = await getOrCreateCliente(supabase, whatsappNumber);
    // Status de presença
    fetch(`https://us.api-wa.me/${key}/message/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: data.remoteJid,
        status: "composing"
      })
    }).catch((err)=>console.error("[WEBHOOK-DELIVERY] ⚠️ Falha ao enviar status de presença:", err.message));
    console.log("[WEBHOOK-DELIVERY] 📨 Tipo de mensagem:", data.messageType);
    // ========================================
    // ⛔️ DESVIO IMEDIATO: cliente finalizando, mas mensagem NÃO é áudio
    // ========================================
    const isAudio = data.messageType === "audioMessage";
    if (cliente.status_conversa === "finalizando_pedido" && !isAudio) {
      console.log("[WEBHOOK-DELIVERY] 🎧 Cliente finalizando pedido, porém mensagem NÃO é áudio → solicitando áudio com palavra-chave.");
      // tentar pegar a palavra_chave real do pedido em andamento
      let palavra = "sua palavra-chave";
      try {
        const pedidoAnd = await getPedidoEmAndamento(supabase, cliente.id);
        if (pedidoAnd?.palavra_chave) palavra = pedidoAnd.palavra_chave;
      } catch  {
        console.warn("[WEBHOOK-DELIVERY] Não foi possível obter palavra_chave (seguindo com mensagem genérica).");
      }
      // (opcional) logar em mensagem_temporario
      await supabase.from("mensagem_temporario").insert({
        cliente_id: cliente.id,
        whatsapp: whatsappNumber,
        mensagem: "⚠️ Cliente em finalização: mensagem não-áudio recebida. Solicitado áudio com a palavra-chave para confirmação.",
        tem_audio: false,
        timestamp_mensagem: new Date().toISOString()
      });
      // enviar instrução ao cliente
      await enviarResposta(key, whatsappNumber, `🔒 Para confirmar seu pedido, por favor, envie um *ÁUDIO* dizendo apenas a palavra:\n\n🔑 *${palavra}*`);
      // encerra sem orquestrador
      return new Response("ok: aguardando audio para validacao", {
        headers: corsHeaders
      });
    }
    // ========================================
    // SWITCH DE TRATAMENTO (mantido, com ajustes mínimos)
    // ========================================
    switch(data.messageType){
      // ========================================
      // ROTA LENTA: TEXTO
      // ========================================
      case "conversation":
      case "extendedTextMessage":
        {
          console.log("[WEBHOOK-DELIVERY] ➡️ ROTA LENTA (Texto)");
          const mensagemUsuario = data.msgContent?.conversation || data.msgContent?.text || data.msgContent?.extendedTextMessage?.text || data.text || data.conversation || "";
          if (!mensagemUsuario) {
            console.warn("[WEBHOOK-DELIVERY] ⚠️ Mensagem de texto vazia");
            return new Response("ok: empty text message", {
              headers: corsHeaders
            });
          }
          // 1. SALVAR MENSAGEM
          const { data: novaMensagem, error: insertError } = await supabase.from("mensagem_temporario").insert({
            cliente_id: cliente.id,
            whatsapp: whatsappNumber,
            mensagem: mensagemUsuario,
            tem_audio: false,
            timestamp_mensagem: new Date().toISOString()
          }).select("id").single();
          if (insertError) throw insertError;
          console.log(`[WEBHOOK-DELIVERY] ✅ Texto salvo (ID: ${novaMensagem.id})`);
          // 2. INVOCAR ORQUESTRADOR (somente quando NÃO está finalizando, pois o desvio já tratou acima)
          console.log(`[WEBHOOK-DELIVERY] 🔄 Invocando orquestrador...`);
          invocarOrquestrador(supabase, novaMensagem.id).catch((err)=>{
            console.error("[WEBHOOK-DELIVERY] ⚠️ Erro ao invocar orquestrador:", err.message);
          });
          console.log(`[WEBHOOK-DELIVERY] ✅ Orquestrador disparado para mensagem ${novaMensagem.id}`);
          break;
        }
      // ========================================
      // ROTA LENTA: ÁUDIO
      // ========================================
      case "audioMessage":
        {
          console.log("[WEBHOOK-DELIVERY] ➡️ ROTA LENTA (Áudio)");
          const audioBase64 = data.fileBase64?.split(",")[1] || data.fileBase64;
          if (!audioBase64) {
            console.warn("[WEBHOOK-DELIVERY] ⚠️ Áudio vazio");
            return new Response("ok: empty audio message", {
              headers: corsHeaders
            });
          }
          console.log("[WEBHOOK-DELIVERY] ✅ Áudio recebido. Tamanho:", audioBase64.length);
          console.log("[WEBHOOK-DELIVERY] 🔄 Delegando para transcrever-audio...");
          try {
            const { data: transcricaoData, error: transcricaoError } = await supabase.functions.invoke("transcrever-audio", {
              body: {
                cliente_id: cliente.id,
                whatsapp: whatsappNumber,
                audio_base64: audioBase64
              }
            });
            if (transcricaoError) {
              console.error("[WEBHOOK-DELIVERY] ❌ Erro ao invocar transcrever-audio:", transcricaoError);
            } else {
              console.log("[WEBHOOK-DELIVERY] ✅ transcrever-audio invocado com sucesso:", transcricaoData);
            }
          } catch (invokeError) {
            console.error("[WEBHOOK-DELIVERY] ❌ Falha ao invocar transcrever-audio:", invokeError.message);
          }
          break;
        }
      // ========================================
      // ROTA RÁPIDA: BOTÕES
      // ========================================
      case "messageContextInfo":
        {
          console.log("[WEBHOOK-DELIVERY] ⚡️ ROTA RÁPIDA (Botão)");
          const buttonsResponse = data.msgContent?.buttonsResponseMessage;
          if (!buttonsResponse) {
            console.warn("[WEBHOOK-DELIVERY] ⚠️ buttonsResponseMessage não encontrado");
            return new Response("ok: empty button response", {
              headers: corsHeaders
            });
          }
          const messageId = data.key?.id || data.messageId;
          if (!messageId) {
            console.error("[WEBHOOK-DELIVERY] ❌ messageId não encontrado");
            return new Response("ok: no message id", {
              headers: corsHeaders
            });
          }
          console.log("[WEBHOOK-DELIVERY] 🔍 Verificando status de processamento:", messageId);
          const { data: existingMessage } = await supabase.from("processed_webhook_messages").select("id, status").eq("message_id", messageId).single();
          if (existingMessage && (existingMessage.status === "processing" || existingMessage.status === "completed")) {
            console.log(`[WEBHOOK-DELIVERY] ⏳ Mensagem já ${existingMessage.status}. Ignorando.`);
            return new Response("ok: message already processed/processing", {
              headers: corsHeaders
            });
          }
          await supabase.from("processed_webhook_messages").upsert({
            message_id: messageId,
            event_type: "button_response",
            cliente_id: cliente.id,
            status: "processing",
            metadata: {
              selectedButtonId: buttonsResponse.selectedButtonId,
              selectedDisplayText: buttonsResponse.selectedButtonId
            }
          }, {
            onConflict: "message_id"
          });
          console.log('[WEBHOOK-DELIVERY] ✅ Mensagem marcada como "processing"');
          let action;
          try {
            const actionData = JSON.parse(buttonsResponse.selectedButtonId);
            action = actionData.action;
            console.log("[WEBHOOK-DELIVERY] 🎯 Action detectada:", buttonsResponse.selectedButtonId);
          } catch (err) {
            console.error("[WEBHOOK-DELIVERY] ❌ Erro ao fazer parse do selectedButtonId:", err.message);
            await supabase.from("processed_webhook_messages").update({
              status: "failed"
            }).eq("message_id", messageId);
            throw new Error("Formato inválido do buttonId");
          }
          try {
            switch(action){
              case "add_e_finalizar":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'add_e_finalizar'");
                  const actionData = JSON.parse(buttonsResponse.selectedButtonId);
                  const item = actionData.item;
                  // adicionar-item-carrinho
                  const { error: addItemError } = await supabase.functions.invoke("adicionar-item-carrinho", {
                    body: {
                      cliente_id: cliente.id,
                      item_identificado: {
                        id_produto: item.id_produto,
                        nome_produto: item.nome_produto,
                        quantidade: item.quantidade,
                        valor: parseFloat(item.valor_unitario)
                      }
                    }
                  });
                  if (addItemError) throw addItemError;
                  console.log("[WEBHOOK-DELIVERY] ⏳ Aguardando 500ms...");
                  await new Promise((resolve)=>setTimeout(resolve, 500));
                  const pedido = await getPedidoAtivo(supabase, cliente.id);
                  const palavra = gerarPalavraChave();
                  await supabase.from("pedidos").update({
                    status: "em_andamento",
                    palavra_chave: palavra
                  }).eq("id", pedido.id);
                  // status do cliente passa para finalizando_pedido
                  const { data: clienteAtualizado, error: updateClienteError } = await supabase.from("clientes").update({
                    status_conversa: "finalizando_pedido"
                  }).eq("id", cliente.id).select().single();
                  if (updateClienteError) {
                    console.error("[WEBHOOK-DELIVERY] ❌ Erro ao atualizar status:", updateClienteError);
                  } else {
                    console.log("[WEBHOOK-DELIVERY] ✅ Status atualizado:", clienteAtualizado?.status_conversa);
                  }
                  await enviarResposta(key, whatsappNumber, `✅ Pedido confirmado com sucesso!\n\nPara confirmar sua identidade e continuar, nos envie um *ÁUDIO* com a palavra:\n\n🔑 *${palavra}*`);
                  break;
                }
              case "add_e_continuar":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'add_e_continuar'");
                  const actionData = JSON.parse(buttonsResponse.selectedButtonId);
                  const item = actionData.item;
                  const { error: addItemError } = await supabase.functions.invoke("adicionar-item-carrinho", {
                    body: {
                      cliente_id: cliente.id,
                      item_identificado: {
                        id_produto: item.id_produto,
                        nome_produto: item.nome_produto,
                        quantidade: item.quantidade,
                        valor: parseFloat(item.valor_unitario)
                      }
                    }
                  });
                  if (addItemError) throw addItemError;
                  await supabase.from("clientes").update({
                    status_conversa: "navegando"
                  }).eq("id", cliente.id);
                  await enviarResposta(key, whatsappNumber, "🎉 Item adicionado com sucesso!\n\nO que mais você gostaria de adicionar?\n\n🍽️ Mais um prato?\n🥤 Uma bebida?\n🍰 Uma sobremesa?\n\nEstou aqui para ajudar!");
                  break;
                }
              case "cancelar_item_proposto":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'cancelar_item_proposto'");
                  await enviarResposta(key, whatsappNumber, "❌ Item cancelado.\n\nO que você gostaria de fazer agora?");
                  break;
                }
              case "btn_finalizar_pedido":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'btn_finalizar_pedido'");
                  const pedido = await getPedidoAtivo(supabase, cliente.id);
                  const palavra = gerarPalavraChave();
                  await supabase.from("pedidos").update({
                    status: "em_andamento",
                    palavra_chave: palavra
                  }).eq("id", pedido.id);
                  await supabase.from("clientes").update({
                    status_conversa: "finalizando_pedido"
                  }).eq("id", cliente.id);
                  await enviarResposta(key, whatsappNumber, `Perfeito! Para confirmar seu pedido, por favor, me envie uma *MENSAGEM DE ÁUDIO* dizendo apenas o código:\n\n*${palavra}*`);
                  break;
                }
              case "btn_adicionar_mais_itens":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'btn_adicionar_mais_itens'");
                  await supabase.from("clientes").update({
                    status_conversa: "navegando"
                  }).eq("id", cliente.id);
                  await enviarResposta(key, whatsappNumber, "Ok, pode dizer ou digitar o que mais você gostaria de adicionar.");
                  break;
                }
              case "btn_cancelar_pedido":
                {
                  console.log("[WEBHOOK-DELIVERY] ⚡️ Processando 'btn_cancelar_pedido'");
                  const pedido = await getPedidoAtivo(supabase, cliente.id);
                  await supabase.from("pedidos").update({
                    status: "cancelado"
                  }).eq("id", pedido.id);
                  await getPedidoAtivo(supabase, cliente.id); // cria novo carrinho
                  await supabase.from("clientes").update({
                    status_conversa: "navegando"
                  }).eq("id", cliente.id);
                  await enviarResposta(key, whatsappNumber, "Sem problemas. Seu pedido anterior foi cancelado.\n\nPode começar um novo. O que gostaria de pedir?");
                  break;
                }
              default:
                console.warn("[WEBHOOK-DELIVERY] ⚠️ Action de botão desconhecida:", action);
            }
            await supabase.from("processed_webhook_messages").update({
              status: "completed"
            }).eq("message_id", messageId);
            console.log("[WEBHOOK-DELIVERY] ✅ Ação do botão processada com sucesso.");
          } catch (actionError) {
            console.error("[WEBHOOK-DELIVERY] ❌ Erro ao processar action:", actionError.message);
            await supabase.from("processed_webhook_messages").update({
              status: "failed"
            }).eq("message_id", messageId);
            throw actionError;
          }
          break;
        }
      default:
        {
          console.warn("[WEBHOOK-DELIVERY] ⚠️ Tipo de mensagem não suportado:", data.messageType);
          return new Response("ok: unsupported message type", {
            headers: corsHeaders
          });
        }
    }
    console.log("[WEBHOOK-DELIVERY] ✅ Webhook processado com sucesso");
    return new Response(JSON.stringify({
      success: true,
      message: "Mensagem recebida e fluxo apropriado executado."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("🔥 Erro no Webhook DELIVERY:", error.message);
    console.error("🔥 Stack:", error.stack);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
