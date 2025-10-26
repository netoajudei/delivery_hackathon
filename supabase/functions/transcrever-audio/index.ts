/**
 * @name transcrever-audio
 * @version 2.1.0 (FINAL - Com Orquestrador)
 * @description
 * Função que transcreve áudio usando OpenAI Whisper e aciona o orquestrador
 * 
 * @changelog
 * - v2.1.0: Invoca orquestrador automaticamente após salvar transcrição
 * - v2.0.0: CORREÇÃO CRÍTICA - Salva transcrição na coluna 'mensagem'
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('[TRANSCREVER-AUDIO] ===== INICIANDO TRANSCRIÇÃO =====');
    // ========================================
    // PASSO 1: RECEBER E VALIDAR DADOS
    // ========================================
    const { cliente_id, whatsapp, audio_base64 } = await req.json();
    // Validações básicas
    if (!cliente_id) {
      throw new Error('❌ cliente_id é obrigatório');
    }
    if (!whatsapp) {
      throw new Error('❌ whatsapp é obrigatório');
    }
    if (!audio_base64) {
      throw new Error('❌ audio_base64 é obrigatório');
    }
    console.log(`[TRANSCREVER-AUDIO] 📋 Cliente: ${cliente_id}`);
    console.log(`[TRANSCREVER-AUDIO] 📱 WhatsApp: ${whatsapp}`);
    console.log(`[TRANSCREVER-AUDIO] 🎵 Áudio recebido: ${audio_base64.substring(0, 50)}...`);
    // ========================================
    // PASSO 2: CONVERTER BASE64 PARA BLOB
    // ========================================
    let audioBuffer;
    try {
      // Remove possível prefixo data:audio/...;base64,
      const cleanBase64 = audio_base64.includes(',') ? audio_base64.split(',')[1] : audio_base64;
      audioBuffer = Uint8Array.from(atob(cleanBase64), (c)=>c.charCodeAt(0));
    } catch (decodeError) {
      console.error('[TRANSCREVER-AUDIO] ❌ Erro ao decodificar base64:', decodeError.message);
      throw new Error('Formato de áudio base64 inválido');
    }
    const audioBlob = new Blob([
      audioBuffer
    ], {
      type: 'audio/ogg; codecs=opus'
    });
    console.log(`[TRANSCREVER-AUDIO] ✅ Áudio convertido. Tamanho: ${audioBlob.size} bytes`);
    if (audioBlob.size === 0) {
      throw new Error('Áudio vazio após conversão');
    }
    // ========================================
    // PASSO 3: TRANSCREVER COM OPENAI WHISPER
    // ========================================
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('⚙️ OPENAI_API_KEY não configurada no ambiente');
    }
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt'); // Força português brasileiro
    console.log('[TRANSCREVER-AUDIO] 🚀 Enviando para OpenAI Whisper API...');
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    });
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('[TRANSCREVER-AUDIO] ❌ Erro do Whisper API:', errorText);
      throw new Error(`Whisper API falhou: ${whisperResponse.status} - ${errorText}`);
    }
    const whisperData = await whisperResponse.json();
    const transcricao = whisperData.text?.trim() || '';
    if (!transcricao) {
      console.warn('[TRANSCREVER-AUDIO] ⚠️ Transcrição vazia retornada pelo Whisper');
      throw new Error('Não foi possível transcrever o áudio (resultado vazio)');
    }
    console.log(`[TRANSCREVER-AUDIO] ✅ TRANSCRIÇÃO RECEBIDA: "${transcricao}"`);
    // ========================================
    // PASSO 4: SALVAR NO BANCO DE DADOS
    // ========================================
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    console.log('[TRANSCREVER-AUDIO] 💾 Salvando transcrição no banco...');
    const { data: novaMensagem, error: insertError } = await supabase.from('mensagem_temporario').insert({
      cliente_id: cliente_id,
      whatsapp: whatsapp,
      mensagem: transcricao,
      tem_audio: true,
      audio_base64: audio_base64,
      timestamp_mensagem: new Date().toISOString()
    }).select('id, mensagem').single();
    if (insertError) {
      console.error('[TRANSCREVER-AUDIO] ❌ Erro ao salvar no banco:', insertError);
      throw new Error(`Erro ao salvar mensagem: ${insertError.message}`);
    }
    console.log(`[TRANSCREVER-AUDIO] ✅ MENSAGEM SALVA COM SUCESSO!`);
    console.log(`[TRANSCREVER-AUDIO] 🆔 ID da mensagem: ${novaMensagem.id}`);
    console.log(`[TRANSCREVER-AUDIO] 📝 Conteúdo salvo: "${novaMensagem.mensagem}"`);
    // ========================================
    // PASSO 5: INVOCAR ORQUESTRADOR
    // ========================================
    console.log('[TRANSCREVER-AUDIO] 🔄 Invocando orquestrador...');
    try {
      const { data: orquestradorData, error: orquestradorError } = await supabase.functions.invoke('delivery-orquestrador', {
        body: {
          mensagem_id: novaMensagem.id
        }
      });
      if (orquestradorError) {
        console.error('[TRANSCREVER-AUDIO] ⚠️ Erro ao invocar orquestrador:', orquestradorError);
      // Não joga erro - a mensagem já foi salva, que é o importante
      } else {
        console.log('[TRANSCREVER-AUDIO] ✅ Orquestrador invocado com sucesso');
      }
    } catch (invokeError) {
      console.error('[TRANSCREVER-AUDIO] ⚠️ Falha ao invocar orquestrador:', invokeError.message);
    // Não joga erro - a mensagem já foi salva
    }
    // ========================================
    // PASSO 6: RETORNAR SUCESSO
    // ========================================
    console.log('[TRANSCREVER-AUDIO] ===== ✅ CONCLUÍDO COM SUCESSO =====');
    return new Response(JSON.stringify({
      success: true,
      mensagem_id: novaMensagem.id,
      transcricao: transcricao,
      audio_size: audioBlob.size,
      orquestrador_acionado: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[TRANSCREVER-AUDIO] 🔥 ===== ERRO FATAL =====');
    console.error('[TRANSCREVER-AUDIO] 🔥 Mensagem:', error.message);
    console.error('[TRANSCREVER-AUDIO] 🔥 Stack:', error.stack);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
