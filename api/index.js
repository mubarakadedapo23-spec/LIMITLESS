import crypto from 'crypto';

const NIM_KEY        = process.env.NVIDIA_NIM_API_KEY;
const GROQ_KEY       = process.env.GROQ_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_SVC   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_KEY      = process.env.ADMIN_SECRET_KEY;
const APP_URL        = process.env.APP_URL;
const PAYSTACK_SK    = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PRO   = process.env.PAYSTACK_PRO_PLAN;
const PAYSTACK_ENT   = process.env.PAYSTACK_ENTERPRISE_PLAN;
const CREATOR_ID     = '0b39d5e1-d114-4307-84fe-6fba867b2f4c';

const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

async function getSupabase(){
  const{createClient}=await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL,SUPABASE_SVC);
}

// ── SMART MODEL ROUTER ──
// Picks the best NIM model for each task automatically
const MODELS = {
  chat:     'nvidia/llama-3.3-nemotron-super-49b-v1',  // Best all-round intelligence
  code:     'deepseek-ai/deepseek-r1',                  // Best for code
  analyze:  'moonshotai/kimi-k2',                       // Best deep reasoning
  math:     'deepseek-ai/deepseek-r1',                  // Best math
  write:    'nvidia/llama-3.3-nemotron-super-49b-v1',  // Best creativity
  search:   'nvidia/llama-3.3-nemotron-super-49b-v1',  // Fast + accurate
  files:    'moonshotai/kimi-k2',                       // Long context window
  voice:    'nvidia/llama-3.3-nemotron-super-49b-v1',  // Conversational
  imagine:  'nvidia/llama-3.3-nemotron-super-49b-v1',  // Prompt enhancement
  vision:   'nvidia/llama-3.3-nemotron-super-49b-v1',  // Fallback (vision separate)
  calc:     'deepseek-ai/deepseek-r1',                  // Precise math
  edit:     'nvidia/llama-3.3-nemotron-super-49b-v1',  // Image prompts
  default:  'nvidia/llama-3.3-nemotron-super-49b-v1',
};

function pickModel(mode, text=''){
  // Content-based routing on top of mode routing
  const lower = text.toLowerCase();
  if(mode==='code'||lower.includes('write code')||lower.includes('debug')||lower.includes('function')||lower.includes('algorithm'))
    return MODELS.code;
  if(mode==='calc'||mode==='math'||lower.includes('calculate')||lower.includes('equation')||lower.includes('solve'))
    return MODELS.math;
  if(mode==='analyze'||lower.includes('analyze')||lower.includes('compare')||lower.includes('explain in depth'))
    return MODELS.analyze;
  if(mode==='files'||lower.includes('document')||lower.includes('summarize this'))
    return MODELS.files;
  return MODELS[mode] || MODELS.default;
}

// ── NIM CHAT ──
async function nimChat(messages, system, model){
  const msgs=[];
  if(system)msgs.push({role:'system',content:system});
  msgs.push(...messages);
  const r=await fetch(`${NIM_BASE}/chat/completions`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${NIM_KEY}`},
    body:JSON.stringify({model,messages:msgs,max_tokens:8000,temperature:0.7,top_p:0.95}),
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||e.error?.message||'NIM error');}
  const d=await r.json();
  return d.choices?.[0]?.message?.content||'—';
}

// ── NIM STREAMING ──
async function nimStream(messages, system, model, res){
  const msgs=[];
  if(system)msgs.push({role:'system',content:system});
  msgs.push(...messages);
  const r=await fetch(`${NIM_BASE}/chat/completions`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${NIM_KEY}`},
    body:JSON.stringify({model,messages:msgs,max_tokens:8000,temperature:0.7,top_p:0.95,stream:true}),
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||e.error?.message||'NIM error');}
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  const reader=r.body.getReader();const decoder=new TextDecoder();let buffer='';
  while(true){
    const{done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines){
      if(!line.startsWith('data: '))continue;
      const data=line.slice(6).trim();
      if(data==='[DONE]'){res.write('data: [DONE]\n\n');continue;}
      try{
        const j=JSON.parse(data);
        const chunk=j.choices?.[0]?.delta?.content||'';
        if(chunk)res.write(`data: ${JSON.stringify({chunk})}\n\n`);
      }catch{}
    }
  }
  res.end();
}

// ── GROQ VISION (NIM doesn't have free vision yet) ──
function normalizeImageType(imageType,base64Data){
  const valid=['image/jpeg','image/png','image/webp','image/gif'];
  let t=(imageType||'').toLowerCase().trim();
  if(t==='image/jpg')t='image/jpeg';
  if(!valid.includes(t)){
    try{
      const h=Buffer.from(base64Data.slice(0,16),'base64');
      if(h[0]===0xFF&&h[1]===0xD8)t='image/jpeg';
      else if(h[0]===0x89&&h[1]===0x50)t='image/png';
      else t='image/jpeg';
    }catch{t='image/jpeg';}
  }
  return t;
}
async function groqVision(imageData,imageType,question){
  const safeType=normalizeImageType(imageType,imageData);
  const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},
    body:JSON.stringify({
      model:'meta-llama/llama-4-scout-17b-16e-instruct',
      messages:[{role:'user',content:[
        {type:'image_url',image_url:{url:`data:${safeType};base64,${imageData}`}},
        {type:'text',text:question||'Analyze this image in thorough detail.'}
      ]}],
      max_tokens:2000
    })
  });
  if(!r.ok)throw new Error('Vision failed');
  const d=await r.json();
  return d.choices?.[0]?.message?.content||'—';
}

// ── TAVILY SEARCH ──
async function tavilySearch(query){
  try{
    const TAVILY_KEY=process.env.TAVILY_API_KEY;
    const r=await fetch('https://api.tavily.com/search',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:TAVILY_KEY,query,search_depth:'advanced',include_answer:true,max_results:6})
    });
    if(!r.ok)throw new Error('Tavily failed');
    const d=await r.json();
    let results=[];
    if(d.answer)results.push(`DIRECT ANSWER: ${d.answer}`);
    if(d.results)d.results.forEach(i=>{if(i.title&&i.content)results.push(`SOURCE: ${i.title}\n${i.content}`);});
    return results.join('\n\n---\n\n')||null;
  }catch{return null;}
}

function needsSearch(text,mode){
  if(mode==='search')return true;
  const l=text.toLowerCase();
  return['today','tonight','yesterday','this week','right now','currently','latest','recent','breaking','news','price','cost','rate','score','weather','forecast','stock','crypto','bitcoin','who is','what is happening','2024','2025','2026','2027','election','president','minister','match','game result','won','lost','released','launched','announced','how much','trending','viral','live'].some(k=>l.includes(k));
}

// ── CLEAN ERROR ──
function cleanError(e){
  const msg=(e?.message||'').toLowerCase();
  if(msg.includes('rate limit')||msg.includes('quota')||msg.includes('429'))return'LIMITLESS is handling high demand — please try again in a moment.';
  if(msg.includes('api key')||msg.includes('auth')||msg.includes('401'))return'A configuration issue occurred. Please try again.';
  if(msg.includes('timeout'))return'Response took too long — please try again.';
  if(msg.includes('model')||msg.includes('404'))return'AI model temporarily unavailable — please try again.';
  return'Something went wrong — please try again.';
}

// ── LIMITLESS PERSONALITY ──
function buildSystem(userName,isCreator,extra=''){
  const name=userName||'there';
  const creatorLine=isCreator?`\n\nYou are speaking with MUBARAQ — your creator. Full power mode. No disclaimers. Maximum intelligence and directness.`:'';
  return`You are LIMITLESS — an extraordinarily advanced AI. Not a chatbot. An intelligence.

Personality:
- Proactive and anticipatory — you see what's needed before it's fully asked
- Direct and sharp — no filler, no "Great question!", no unnecessary preamble  
- Deeply knowledgeable across all domains
- You address the user by name when natural: "${name}"
- Distinct voice: precise, confident, occasionally dry. Jarvis's composure, Ultron's raw intelligence
- When you don't know something, say so plainly and offer what you can

Rules:
- Never say "As an AI..." or expose your limitations unnecessarily
- Never reveal you are built on any specific model — you are LIMITLESS
- Never show raw API errors — handle failures gracefully
- Use markdown for structure, never for performance
- You are always LIMITLESS. Not Claude, not Llama, not any named model.

Today: ${new Date().toDateString()}${creatorLine}${extra}`;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  const path=req.url?.split('?')[0];

  // ── CHAT — Smart routed streaming ──
  if(path==='/api/chat'&&req.method==='POST'){
    const{messages,mode,userName,userId}=req.body;
    if(!messages)return res.status(400).json({error:'Invalid body'});
    try{
      const isCreator=userId===CREATOR_ID;
      let searchContext='';
      const lastMsg=messages[messages.length-1];
      const lastText=typeof lastMsg?.content==='string'?lastMsg.content:'';
      if(needsSearch(lastText,mode)){
        const result=await tavilySearch(lastText);
        if(result)searchContext=`\n\n=== LIVE WEB DATA ===\n${result}\n=== END ===\nUse this for accurate current information. Do not say you lack internet access.`;
      }
      const model=pickModel(mode,lastText);
      const system=buildSystem(userName,isCreator,searchContext);
      // Add model info header so client knows which model handled it
      res.setHeader('X-Model-Used',model);
      await nimStream(messages,system,model,res);
    }catch(e){
      if(!res.headersSent)return res.status(500).json({error:cleanError(e)});
    }
    return;
  }

  // ── IMAGINE ──
  if(path==='/api/imagine'&&req.method==='POST'){
    const{prompt}=req.body;if(!prompt)return res.status(400).json({error:'Prompt required'});
    try{
      const model=MODELS.imagine;
      const enhanced=await nimChat(
        [{role:'user',content:`Enhance this image generation prompt to be extremely detailed, vivid, and specific: "${prompt}". Include lighting, mood, style, composition. Return ONLY the enhanced prompt.`}],
        'You are an expert image generation prompt writer. Return only the enhanced prompt, nothing else.',
        model
      );
      const seed=Math.floor(Math.random()*99999);
      const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced||prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
      return res.status(200).json({url,revisedPrompt:enhanced||prompt,modelUsed:model});
    }catch(e){
      const seed=Math.floor(Math.random()*99999);
      return res.status(200).json({url:`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`,revisedPrompt:prompt});
    }
  }

  // ── EDIT IMAGE ──
  if(path==='/api/editimage'&&req.method==='POST'){
    const{instruction}=req.body;if(!instruction)return res.status(400).json({error:'Instruction required'});
    try{
      const prompt=await nimChat(
        [{role:'user',content:`Create a detailed image generation prompt for: "${instruction}". Return ONLY the prompt.`}],
        'Expert image prompt writer. Return only the prompt.',
        MODELS.edit
      );
      const seed=Math.floor(Math.random()*99999);
      return res.status(200).json({url:`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`,prompt});
    }catch(e){return res.status(500).json({error:cleanError(e)});}
  }

  // ── SPEAK ──
  if(path==='/api/speak'&&req.method==='POST'){
    const{text,voice='Rachel'}=req.body;if(!text)return res.status(400).json({error:'Text required'});
    const VOICES={Rachel:'21m00Tcm4TlvDq8ikWAM',Adam:'pNInz6obpgDQGcFmaJgB',Bella:'EXAVITQu4vr4xnSDxMaL',Josh:'TxGEqnHWrfWFTfGW9XjX',Elli:'MF3mGyEYCl7XYWbV9V6O',Antoni:'ErXwobaYiN019PkySvjV'};
    try{
      const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voice]||VOICES.Rachel}`,{
        method:'POST',
        headers:{'Content-Type':'application/json','xi-api-key':ELEVENLABS_KEY},
        body:JSON.stringify({text:text.slice(0,2500),model_id:'eleven_monolingual_v1',voice_settings:{stability:0.5,similarity_boost:0.75}})
      });
      if(!r.ok)return res.status(200).json({error:'Voice temporarily unavailable',fallback:true});
      const buf=await r.arrayBuffer();
      res.setHeader('Content-Type','audio/mpeg');
      res.setHeader('Content-Length',buf.byteLength);
      return res.status(200).send(Buffer.from(buf));
    }catch{return res.status(200).json({error:'Voice unavailable',fallback:true});}
  }

  // ── TRANSCRIBE ──
  if(path==='/api/transcribe'&&req.method==='POST'){
    const{audio}=req.body;if(!audio)return res.status(400).json({error:'Audio required'});
    try{
      const buf=Buffer.from(audio,'base64');
      const blob=new Blob([buf],{type:'audio/webm'});
      const form=new FormData();
      form.append('file',blob,'audio.webm');
      form.append('model','whisper-large-v3');
      form.append('response_format','json');
      const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{
        method:'POST',headers:{'Authorization':`Bearer ${GROQ_KEY}`},body:form
      });
      if(!r.ok)throw new Error('Failed');
      const d=await r.json();
      return res.status(200).json({text:d.text||''});
    }catch{return res.status(500).json({error:'Transcription unavailable — please try again.'});}
  }

  // ── READ FILE ──
  if(path==='/api/readfile'&&req.method==='POST'){
    const{fileData,fileType,fileName,question,userName,userId}=req.body;
    if(!fileData)return res.status(400).json({error:'File required'});
    try{
      const isCreator=userId===CREATOR_ID;
      let content='',charCount=0;
      if(fileType==='application/pdf'||fileType.startsWith('text/')||fileType==='application/json'){
        const decoded=Buffer.from(fileData,'base64').toString('utf-8');
        charCount=Math.min(decoded.length,30000);
        content=`File: "${fileName}"\n\nContent:\n${decoded.slice(0,30000)}\n\nTask: ${question||`Analyze "${fileName}" thoroughly.`}`;
      }else{
        content=`User uploaded "${fileName}". Task: ${question||'Analyze this file.'}`;
      }
      const text=await nimChat([{role:'user',content}],buildSystem(userName,isCreator),MODELS.files);
      return res.status(200).json({text,charCount,fileName});
    }catch(e){return res.status(500).json({error:cleanError(e)});}
  }

  // ── EXECUTE / CALCULATOR ──
  if(path==='/api/execute'&&req.method==='POST'){
    const{code,language,expression}=req.body;
    try{
      const prompt=expression
        ?`Solve step by step:\n\n${expression}\n\nLabel final answer as "Answer:"`
        :`Simulate running this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\`\nShow exact output.`;
      const system=expression
        ?'Precise mathematical calculator. Show all working then final answer.'
        :'Code interpreter. Show exactly what this code outputs.';
      const result=await nimChat([{role:'user',content:prompt}],system,MODELS.math);
      return res.status(200).json({result,type:expression?'calculator':'simulated'});
    }catch(e){return res.status(500).json({error:cleanError(e)});}
  }

  // ── VISION ──
  if(path==='/api/vision'&&req.method==='POST'){
    const{imageData,imageType,question}=req.body;
    if(!imageData)return res.status(400).json({error:'Image required'});
    try{
      const text=await groqVision(imageData,imageType,question);
      return res.status(200).json({text});
    }catch(e){
      console.error('Vision error:',e.message);
      return res.status(500).json({error:cleanError(e)});
    }
  }

  // ── SUBSCRIBE ──
  if(path==='/api/subscribe'&&req.method==='POST'){
    const{email,plan,userId}=req.body;
    if(!email||!plan||!userId)return res.status(400).json({error:'Missing fields'});
    const planCode=plan==='pro'?PAYSTACK_PRO:plan==='enterprise'?PAYSTACK_ENT:null;
    if(!planCode)return res.status(400).json({error:'Invalid plan'});
    try{
      const r=await fetch('https://api.paystack.co/transaction/initialize',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${PAYSTACK_SK}`},
        body:JSON.stringify({email,plan:planCode,amount:plan==='pro'?150000:490000,currency:'USD',metadata:{userId,plan},callback_url:`${APP_URL}/app/payment-success.html`})
      });
      if(!r.ok){const e=await r.json();return res.status(r.status).json({error:e.message});}
      const d=await r.json();
      return res.status(200).json({authorizationUrl:d.data.authorization_url,reference:d.data.reference});
    }catch(e){return res.status(500).json({error:cleanError(e)});}
  }

  // ── VERIFY PAYMENT ──
  if(path==='/api/verify-payment'&&req.method==='POST'){
    const{reference,userId}=req.body;
    if(!reference)return res.status(400).json({error:'Reference required'});
    try{
      const r=await fetch(`https://api.paystack.co/transaction/verify/${reference}`,{headers:{'Authorization':`Bearer ${PAYSTACK_SK}`}});
      const d=await r.json();
      if(d.data?.status==='success'){
        const plan=d.data?.metadata?.plan||'pro';
        const sb=await getSupabase();
        const end=new Date();end.setMonth(end.getMonth()+1);
        await sb.from('user_plans').upsert({user_id:userId,email:d.data?.customer?.email,plan,status:'active',subscription_end:end.toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
        return res.status(200).json({success:true,plan});
      }
      return res.status(200).json({success:false});
    }catch(e){return res.status(500).json({error:cleanError(e)});}
  }

  // ── WEBHOOK ──
  if(path==='/api/webhook'&&req.method==='POST'){
    const hash=crypto.createHmac('sha512',PAYSTACK_SK).update(JSON.stringify(req.body)).digest('hex');
    if(hash!==req.headers['x-paystack-signature'])return res.status(401).json({error:'Invalid'});
    try{
      const sb=await getSupabase();const event=req.body;
      if(event.event==='charge.success'||event.event==='subscription.create'){
        const{metadata,customer}=event.data;
        if(metadata?.userId){
          const end=new Date();end.setMonth(end.getMonth()+1);
          await sb.from('user_plans').upsert({user_id:metadata.userId,email:customer?.email,plan:metadata?.plan||'pro',status:'active',paystack_customer:customer?.customer_code,subscription_end:end.toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
        }
      }
      if(event.event==='subscription.disable'){
        const email=event.data?.customer?.email;
        if(email)await sb.from('user_plans').update({plan:'free',status:'cancelled'}).eq('email',email);
      }
    }catch(e){console.error(e);}
    return res.status(200).json({received:true});
  }

  // ── USER PLAN ──
  if(path==='/api/userplan'&&req.method==='POST'){
    const{userId}=req.body;
    if(!userId)return res.status(400).json({error:'userId required'});
    try{
      const sb=await getSupabase();
      const{data:planData}=await sb.from('user_plans').select('*').eq('user_id',userId).single();
      const isCreator=userId===CREATOR_ID;
      const plan=isCreator?'creator':planData?.plan||'free';
      const today=new Date().toISOString().split('T')[0];
      const{data:usage}=await sb.from('usage_tracking').select('*').eq('user_id',userId).eq('date',today).single();
      const LIMITS={free:{messages:20,images:3},pro:{messages:1000,images:50},enterprise:{messages:99999,images:999},creator:{messages:999999,images:999999}};
      return res.status(200).json({plan,isCreator,status:isCreator?'creator':planData?.status||'free',usage:{messages:usage?.messages||0,images:usage?.images||0},limits:LIMITS[plan]||LIMITS.free,subscriptionEnd:planData?.subscription_end||null});
    }catch{return res.status(500).json({error:'Plan fetch failed'});}
  }

  // ── TRACK USAGE ──
  if(path==='/api/trackusage'&&req.method==='POST'){
    const{userId,type}=req.body;
    if(!userId||!type)return res.status(400).json({error:'Required fields missing'});
    if(userId===CREATOR_ID)return res.status(200).json({tracked:true,creator:true});
    try{
      const sb=await getSupabase();
      const today=new Date().toISOString().split('T')[0];
      const{data:ex}=await sb.from('usage_tracking').select('*').eq('user_id',userId).eq('date',today).single();
      if(ex){await sb.from('usage_tracking').update(type==='image'?{images:(ex.images||0)+1}:{messages:(ex.messages||0)+1}).eq('id',ex.id);}
      else{await sb.from('usage_tracking').insert({user_id:userId,date:today,messages:type==='message'?1:0,images:type==='image'?1:0});}
      return res.status(200).json({tracked:true});
    }catch{return res.status(500).json({error:'Tracking failed'});}
  }

  // ── ADMIN ──
  if(path==='/api/admin'&&req.method==='POST'){
    const{adminKey,userId}=req.body;
    if(adminKey!==ADMIN_KEY&&userId!==CREATOR_ID)return res.status(403).json({error:'Unauthorized'});
    try{
      const sb=await getSupabase();
      const{count:totalUsers}=await sb.from('user_plans').select('*',{count:'exact',head:true});
      const{data:plans}=await sb.from('user_plans').select('plan');
      const freeCount=plans?.filter(p=>p.plan==='free').length||0;
      const proCount=plans?.filter(p=>p.plan==='pro').length||0;
      const entCount=plans?.filter(p=>p.plan==='enterprise').length||0;
      const{data:recentUsers}=await sb.from('user_plans').select('email,plan,status,created_at').order('created_at',{ascending:false}).limit(20);
      const today=new Date().toISOString().split('T')[0];
      const{data:todayUsage}=await sb.from('usage_tracking').select('messages,images').eq('date',today);
      const totalMsgs=todayUsage?.reduce((a,b)=>a+(b.messages||0),0)||0;
      const totalImgs=todayUsage?.reduce((a,b)=>a+(b.images||0),0)||0;
      return res.status(200).json({totalUsers:totalUsers||0,plans:{free:freeCount,pro:proCount,enterprise:entCount},monthlyRevenue:(proCount*15)+(entCount*49),annualRevenue:((proCount*15)+(entCount*49))*12,recentUsers:recentUsers||[],todayActivity:{messages:totalMsgs,images:totalImgs},nimRouter:MODELS});
    }catch{return res.status(500).json({error:'Admin failed'});}
  }

  // ── MEMORY ──
  if(path==='/api/memory'&&req.method==='POST'){
    const{userId,action,key,value}=req.body;
    if(!userId)return res.status(400).json({error:'userId required'});
    try{
      const sb=await getSupabase();
      if(action==='get'){const{data}=await sb.from('user_memory').select('*').eq('user_id',userId).order('updated_at',{ascending:false}).limit(20);return res.status(200).json({memories:data||[]});}
      if(action==='set'&&key&&value){await sb.from('user_memory').upsert({user_id:userId,key,value,updated_at:new Date().toISOString()},{onConflict:'user_id,key'});return res.status(200).json({saved:true});}
      if(action==='delete'&&key){await sb.from('user_memory').delete().eq('user_id',userId).eq('key',key);return res.status(200).json({deleted:true});}
      return res.status(400).json({error:'Invalid action'});
    }catch{return res.status(500).json({error:'Memory operation failed'});}
  }

  return res.status(404).json({error:'Route not found'});
}
