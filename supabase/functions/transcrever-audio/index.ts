/**
 * @name transcrever-audio
 * @version 3.0.0 (Fluxo híbrido: validação por palavra-chave OU orquestrador)
 * @description
 * Transcreve áudio com Whisper, salva mensagem e:
 *  - Se cliente estiver "finalizando_pedido": invoca validar-pedido-audio
 *  - Senão: invoca delivery-orquestrador (fluxo normal)
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    console.log("[TRANSCREVER-AUDIO] ===== INICIANDO TRANSCRIÇÃO =====");
    // ========================================
    // PASSO 1: RECEBER E VALIDAR DADOS
    // ========================================
    const { cliente_id, whatsapp, audio_base64 } = await req.json();
    if (!cliente_id) throw new Error("❌ cliente_id é obrigatório");
    if (!whatsapp) throw new Error("❌ whatsapp é obrigatório");
    if (!audio_base64) throw new Error("❌ audio_base64 é obrigatório");
    console.log(`[TRANSCREVER-AUDIO] 📋 Cliente: ${cliente_id}`);
    console.log(`[TRANSCREVER-AUDIO] 📱 WhatsApp: ${whatsapp}`);
    // ========================================
    // PASSO 2: CONVERTER BASE64 → BLOB
    // ========================================
    let audioBuffer;
    try {
      const cleanBase64 = audio_base64.includes(",") ? audio_base64.split(",")[1] : audio_base64;
      audioBuffer = Uint8Array.from(atob(cleanBase64), (c)=>c.charCodeAt(0));
    } catch (e) {
      console.error("[TRANSCREVER-AUDIO] ❌ Erro ao decodificar base64:", e.message);
      throw new Error("Formato de áudio base64 inválido");
    }
    const audioBlob = new Blob([
      audioBuffer
    ], {
      type: "audio/ogg; codecs=opus"
    });
    console.log(`[TRANSCREVER-AUDIO] ✅ Áudio convertido. Tamanho: ${audioBlob.size} bytes`);
    if (audioBlob.size === 0) throw new Error("Áudio vazio após conversão");
    // ========================================
    // PASSO 3: TRANSCREVER COM OPENAI WHISPER
    // ========================================
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("⚙️ OPENAI_API_KEY não configurada no ambiente");
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");
    console.log("[TRANSCREVER-AUDIO] 🚀 Enviando para OpenAI Whisper API...");
    const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    });
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error("[TRANSCREVER-AUDIO] ❌ Erro do Whisper API:", errorText);
      throw new Error(`Whisper API falhou: ${whisperResponse.status} - ${errorText}`);
    }
    const whisperData = await whisperResponse.json();
    const transcricao = whisperData.text?.trim() || "";
    if (!transcricao) {
      console.warn("[TRANSCREVER-AUDIO] ⚠️ Transcrição vazia retornada pelo Whisper");
      throw new Error("Não foi possível transcrever o áudio (resultado vazio)");
    }
    console.log(`[TRANSCREVER-AUDIO] ✅ TRANSCRIÇÃO: "${transcricao}"`);
    // ========================================
    // PASSO 4: SALVAR MENSAGEM NO BANCO
    // ========================================
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[TRANSCREVER-AUDIO] 💾 Salvando transcrição no banco...");
    const { data: novaMensagem, error: insertError } = await supabase.from("mensagem_temporario").insert({
      cliente_id,
      whatsapp,
      mensagem: transcricao,
      tem_audio: true,
      audio_base64,
      timestamp_mensagem: new Date().toISOString()
    }).select("id, mensagem").single();
    if (insertError) {
      console.error("[TRANSCREVER-AUDIO] ❌ Erro ao salvar no banco:", insertError);
      throw new Error(`Erro ao salvar mensagem: ${insertError.message}`);
    }
    console.log(`[TRANSCREVER-AUDIO] ✅ MENSAGEM SALVA! ID: ${novaMensagem.id}`);
    // ========================================
    // PASSO 5: DEFINIR FLUXO (VALIDAÇÃO x ORQUESTRADOR)
    // ========================================
    console.log("[TRANSCREVER-AUDIO] 🧠 Determinando fluxo de pós-transcrição...");
    const { data: clienteData, error: clienteError } = await supabase.from("clientes").select("id, status_conversa").eq("id", cliente_id).single();
    if (clienteError || !clienteData) {
      console.error("[TRANSCREVER-AUDIO] ❌ Erro ao buscar cliente:", clienteError?.message);
      throw new Error("Cliente não encontrado para processar o áudio");
    }
    console.log(`[TRANSCREVER-AUDIO] 👤 Status do cliente: ${clienteData.status_conversa}`);
    if (clienteData.status_conversa === "finalizando_pedido") {
      // 👉 Fluxo especial: valida palavra-chave. NÃO aciona orquestrador.
      console.log("[TRANSCREVER-AUDIO] 🔐 Cliente finalizando pedido → chamar validar-pedido-audio");
      try {
        const { data: validaData, error: validaError } = await supabase.functions.invoke("validar-pedido-audio", {
          body: {
            cliente_id,
            transcricao
          }
        });
        if (validaError) {
          console.error("[TRANSCREVER-AUDIO] ❌ Erro ao invocar validar-pedido-audio:", validaError);
        } else {
          console.log("[TRANSCREVER-AUDIO] ✅ validar-pedido-audio executada:", validaData);
        }
      } catch (invokeErr) {
        console.error("[TRANSCREVER-AUDIO] ❌ Falha ao chamar validar-pedido-audio:", invokeErr.message);
      }
      console.log("[TRANSCREVER-AUDIO] ===== ✅ CONCLUÍDO (VALIDAÇÃO) =====");
      return new Response(JSON.stringify({
        success: true,
        mensagem_id: novaMensagem.id,
        transcricao,
        fluxo: "validacao_palavra_chave",
        orquestrador_acionado: false
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // 👉 Fluxo normal: acionar orquestrador (como antes)
    console.log("[TRANSCREVER-AUDIO] ➡️ Fluxo normal → aciona orquestrador");
    try {
      const { data: orqData, error: orqError } = await supabase.functions.invoke("delivery-orquestrador", {
        body: {
          mensagem_id: novaMensagem.id
        }
      });
      if (orqError) {
        console.error("[TRANSCREVER-AUDIO] ⚠️ Erro ao invocar orquestrador:", orqError);
      } else {
        console.log("[TRANSCREVER-AUDIO] ✅ Orquestrador invocado com sucesso");
      }
    } catch (invokeError) {
      console.error("[TRANSCREVER-AUDIO] ⚠️ Falha ao invocar orquestrador:", invokeError.message);
    // não interrompe; mensagem já foi salva
    }
    console.log("[TRANSCREVER-AUDIO] ===== ✅ CONCLUÍDO (FLUXO NORMAL) =====");
    return new Response(JSON.stringify({
      success: true,
      mensagem_id: novaMensagem.id,
      transcricao,
      fluxo: "normal",
      orquestrador_acionado: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[TRANSCREVER-AUDIO] 🔥 ===== ERRO FATAL =====");
    console.error("[TRANSCREVER-AUDIO] 🔥 Mensagem:", error.message);
    console.error("[TRANSCREVER-AUDIO] 🔥 Stack:", error.stack);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
