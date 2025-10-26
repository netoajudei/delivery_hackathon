/**
 * @name validar-pedido-audio
 * @version 1.4.0
 * @description
 * Valida a palavra-chave do pedido (Chat Completions) e executa os efeitos:
 * - Se verificado:
 *    - cliente -> 'aguardando_pedido'
 *    - pedido  -> 'confirmado'
 *    - WhatsApp confirmação + registro
 *    - aguarda 5s
 *    - (opcional) deleta conversation (se vier no body)
 *    - pedido  -> 'entregue'
 *    - cliente -> 'navegando'
 *    - WhatsApp "na porta" + registro
 * - Se NÃO verificado:
 *    - envia WhatsApp de orientação com o nome do cliente
 *    - salva a MESMA mensagem em mensagem_temporario
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    console.log("[VALIDAR-PEDIDO-AUDIO] ===== INICIANDO =====");
    const body = await req.json();
    const { cliente_id, transcricao, conversation_id } = body || {};
    if (!cliente_id || !transcricao) throw new Error("Parâmetros obrigatórios: cliente_id, transcricao");
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // pedido em andamento
    const { data: pedido } = await supabase.from("pedidos").select("id, palavra_chave").eq("cliente_id", cliente_id).eq("status", "em_andamento").order("created_at", {
      ascending: false
    }).limit(1).single();
    if (!pedido) {
      await supabase.from("mensagem_temporario").insert({
        cliente_id,
        mensagem: "⚠️ Não encontrei um pedido em andamento para validar sua palavra-chave.",
        tem_audio: false
      });
      return new Response(JSON.stringify({
        success: false,
        motivo: "pedido_nao_encontrado"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    const palavra_chave = (pedido.palavra_chave ?? "").toString().trim();
    if (!palavra_chave) {
      await supabase.from("mensagem_temporario").insert({
        cliente_id,
        mensagem: "⚠️ Não foi possível validar: palavra-chave ausente no pedido.",
        tem_audio: false
      });
      return new Response(JSON.stringify({
        success: false,
        motivo: "palavra_chave_ausente"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // dados do cliente
    const { data: clienteRow } = await supabase.from("clientes").select("id, phone_number, nome").eq("id", cliente_id).single();
    const primeiroNome = ((clienteRow?.nome?.trim() || "cliente").split(" ")[0] || "cliente").trim();
    const numeroDestino = (clienteRow?.phone_number || "").toString().replace(/\D/g, "");
    // ======== validação com Chat Completions ========
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const userPrompt = `
Você é um assistente de validação de pedidos por voz.
Sua função é confirmar se a transcrição de um áudio do cliente contém corretamente a PALAVRA-CHAVE de confirmação do pedido.

## PALAVRA CHAVE É.  ${palavra_chave}
---
Regras:
- Se a transcrição contém claramente a palavra-chave (com pequenas variações) -> válido.
- Se não contém -> inválido.
- Ignore interjeições e ruídos.

Retorne APENAS JSON:
{
  "valido": true | false,
  "motivo": "explicação curta",
  "palavra_detectada": "texto ou vazio"
}

Transcrição do cliente: "${transcricao}"
`.trim();
    const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Responda somente com JSON válido. Sem comentários."
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: 0,
        max_tokens: 200
      })
    });
    if (!chatResp.ok) throw new Error(`Chat API ${chatResp.status}`);
    const chatJson = await chatResp.json();
    const raw = chatJson?.choices?.[0]?.message?.content ?? "";
    let resultado = {
      valido: false
    };
    try {
      resultado = JSON.parse(raw);
    } catch  {
      const norm = (s)=>s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const temMatch = norm(transcricao).includes(norm(palavra_chave));
      resultado = {
        valido: temMatch,
        motivo: temMatch ? "Fallback: palavra encontrada" : "Fallback: palavra não encontrada"
      };
    }
    const verificado = !!resultado.valido;
    if (verificado) {
      // cliente aguardando_pedido
      await supabase.from("clientes").update({
        status_conversa: "aguardando_pedido"
      }).eq("id", cliente_id);
      // pedido confirmado
      await supabase.from("pedidos").update({
        status: "confirmado"
      }).eq("id", pedido.id);
      // WhatsApp confirmação
      const WHATSAPP_INSTANCE_KEY = Deno.env.get("WHATSAPP_INSTANCE_KEY");
      const msgConfirmacao = `✅ *Validação concluída com sucesso, ${primeiroNome}!* \n\n` + `🙏 Obrigado por comprar com a gente mais uma vez.\n` + `🍽️ Já estamos preparando o seu pedido.\n\n` + `⏱️ *Tempo de entrega estimado: 30 minutos.*`;
      if (WHATSAPP_INSTANCE_KEY && numeroDestino) {
        await fetch(`https://us.api-wa.me/${WHATSAPP_INSTANCE_KEY}/message/text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            to: numeroDestino,
            text: msgConfirmacao
          })
        }).catch(()=>{});
      }
      // registra
      await supabase.from("mensagem_temporario").insert({
        cliente_id,
        whatsapp: numeroDestino || null,
        mensagem: "✅ Palavra confirmada. Pedido validado e confirmado. ETA: 30 minutos.",
        tem_audio: false,
        timestamp_mensagem: new Date().toISOString()
      });
      // ===== delay 5s e finalizar (entregar) =====
      await new Promise((r)=>setTimeout(r, 5000));
      // (opcional) deletar conversation
      if (conversation_id && typeof conversation_id === "string" && conversation_id.startsWith("conv_")) {
        await fetch(`https://api.openai.com/v1/conversations/${conversation_id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
            "Content-Type": "application/json"
          }
        }).catch(()=>{});
      }
      // pedido entregue
      await supabase.from("pedidos").update({
        status: "entregue"
      }).eq("id", pedido.id);
      // cliente navegando
      await supabase.from("clientes").update({
        status_conversa: "navegando"
      }).eq("id", cliente_id);
      // WhatsApp “na porta”
      const msgEntrega = `🚪 *${primeiroNome}, seu pedido está na porta!*\n\n` + `😋 Agora é só saborear.\n\n` + `🙏 Obrigado por escolher a gente — até a próxima!`;
      if (WHATSAPP_INSTANCE_KEY && numeroDestino) {
        await fetch(`https://us.api-wa.me/${WHATSAPP_INSTANCE_KEY}/message/text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            to: numeroDestino,
            text: msgEntrega
          })
        }).catch(()=>{});
      }
      // registra
      await supabase.from("mensagem_temporario").insert({
        cliente_id,
        whatsapp: numeroDestino || null,
        mensagem: "🚪 Entrega informada ao cliente: 'seu pedido está na porta'.",
        tem_audio: false,
        timestamp_mensagem: new Date().toISOString()
      });
      return new Response(JSON.stringify({
        success: true,
        verificado: true,
        pedido_id: pedido.id,
        motivo: resultado.motivo ?? "OK",
        pos_validacao: {
          atraso_segundos: 5,
          pedido_status: "entregue",
          cliente_status: "navegando",
          whatsapp_enviado: true
        }
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ===== NÃO verificado: envia WhatsApp e salva a MESMA mensagem =====
    const motivoLower = (resultado.motivo || "").toLowerCase();
    const baseInstrucao = motivoLower.includes("não sabe") || motivoLower.includes("nao sabe") ? `Envie um áudio com a palavra *${palavra_chave}*` : `❌ Palavra não confere. Por favor, envie um áudio contendo a palavra *${palavra_chave}*`;
    const textoCliente = `⚠️ *${primeiroNome}*, precisamos confirmar sua identidade.\n\n` + `${baseInstrucao}\n\n` + `Se preferir, diga apenas a palavra-chave devagar e de forma clara. 🙂`;
    const WHATSAPP_INSTANCE_KEY = Deno.env.get("WHATSAPP_INSTANCE_KEY");
    if (WHATSAPP_INSTANCE_KEY && numeroDestino) {
      await fetch(`https://us.api-wa.me/${WHATSAPP_INSTANCE_KEY}/message/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: numeroDestino,
          text: textoCliente
        })
      }).catch(()=>{});
    }
    await supabase.from("mensagem_temporario").insert({
      cliente_id,
      whatsapp: numeroDestino || null,
      mensagem: textoCliente,
      tem_audio: false,
      timestamp_mensagem: new Date().toISOString()
    });
    return new Response(JSON.stringify({
      success: true,
      verificado: false,
      pedido_id: pedido.id,
      motivo: resultado.motivo ?? "Palavra não confere"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
