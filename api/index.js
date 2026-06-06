import crypto from 'crypto';

const GEMINI_KEY     = process.env.GEMINI_API_KEY;
const TAVILY_KEY     = process.env.TAVILY_API_KEY;
const GROQ_KEY       = process.env.GROQ_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_SVC   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_KEY      = process.env.ADMIN_SECRET_KEY;
const APP_URL        = process.env.APP_URL;
const PAYSTACK_SK    = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PRO   = process.env.PAYSTACK_PRO_PLAN;
const PAYSTACK_ENT   = process.env.PAYSTACK_ENTERPRISE_PLAN;

async function getSupabase(){const{createClient}=await import('@supabase/supabase-js');return createClient(SUPABASE_URL,SUPABASE_SVC);}

async function geminiChat(messages,system){
  const contents=messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:typeof m.content==='string'?m.content:JSON.stringify(m.content)}]}));
  const body={system_instruction:system?{parts:[{text:system}]}:undefined,contents,generationConfig:{temperature:0.7,maxOutputTokens:8192,topP:0.95},safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',threshold:'BLOCK_MEDIUM_AND_ABOVE'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_NONE'}]};
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){console.error('Gemini error',await r.text());return await groqFallback(messages,system);}
  const d=await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text||'—';
}

async function geminiVision(imageData,imageType,question){
  const body={contents:[{parts:[{inline_data:{mime_type:imageType,data:imageData}},{text:question||'Analyze this image in thorough detail.'}]}],generationConfig:{temperature:0.4,maxOutputTokens:4096}};
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error('Vision failed');
  const d=await r.json();return d.candidates?.[0]?.content?.parts?.[0]?.text||'—';
}

async function groqFallback(messages,system,model='llama-3.3-70b-versatile'){
  const msgs=[];if(system)msgs.push({role:'system',content:system});msgs.push(...messages);
  const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`},body:JSON.stringify({model,messages:msgs,max_tokens:8000,temperature:0.7})});
  if(!r.ok)throw new Error('AI unavailable');
  const d=await r.json();return d.choices?.[0]?.message?.content||'—';
}

async function tavilySearch(query){
  try{
    const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:TAVILY_KEY,query,search_depth:'advanced',include_answer:true,include_raw_content:false,max_results:6})});
    if(!r.ok)throw new Error('Tavily failed');
    const d=await r.json();
    let results=[];
    if(d.answer)results.push(`DIRECT ANSWER: ${d.answer}`);
    if(d.results)d.results.forEach(item=>{if(item.title&&item.content)results.push(`SOURCE: ${item.title}\n${item.content}\nURL: ${item.url}`);});
    return results.join('\n\n---\n\n')||null;
  }catch(e){console.error('Tavily error:',e);return null;}
}

function needsSearch(text,mode){
  if(mode==='search')return true;
  const lower=text.toLowerCase();
  return['today','tonight','yesterday','this week','right now','currently','latest','recent','breaking','news','price','cost','rate','score','weather','forecast','stock','crypto','bitcoin','who is','what is happening','2024','2025','2026','2027','election','president','minister','match','game result','won','lost','released','launched','announced','how much','trending','viral','live'].some(k=>lower.includes(k));
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  const path=req.url?.split('?')[0];

  if(path==='/api/chat'&&req.method==='POST'){
    const{messages,system,mode}=req.body;
    if(!messages)return res.status(400).json({error:'Invalid body'});
    try{
      let searchContext='',searchedWeb=false;
      const lastMsg=messages[messages.length-1];
      const lastText=typeof lastMsg?.content==='string'?lastMsg.content:'';
      if(needsSearch(lastText,mode)){
        const result=await tavilySearch(lastText);
        if(result){searchedWeb=true;searchContext=`\n\n=== LIVE WEB SEARCH RESULTS (Tavily) ===\nQuery: "${lastText}"\nDate: ${new Date().toDateString()}\n\n${result}\n=== END RESULTS ===\n\nYou just searched the web. Use these results to answer accurately. Cite sources. Do NOT say you lack internet access.`;}
      }
      const baseSystem=system||`You are LIMITLESS — an extraordinarily intelligent AI assistant. Helpful, direct, thorough. Use markdown. Today is ${new Date().toDateString()}.`;
      const text=await geminiChat(messages,baseSystem+searchContext);
      return res.status(200).json({text,searchedWeb});
    }catch(e){return res.status(500).json({error:e.message||'Chat failed'});}
  }

  if(path==='/api/imagine'&&req.method==='POST'){
    const{prompt}=req.body;
    if(!prompt)return res.status(400).json({error:'Prompt required'});
    try{
      const enhanced=await geminiChat([{role:'user',content:`Enhance this image generation prompt to be extremely detailed and vivid: "${prompt}". Return ONLY the enhanced prompt.`}],'You are an expert image prompt writer. Return only the enhanced prompt.');
      const seed=Math.floor(Math.random()*99999);
      const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced||prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
      return res.status(200).json({url,revisedPrompt:enhanced||prompt});
    }catch{
      const seed=Math.floor(Math.random()*99999);
      return res.status(200).json({url:`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`,revisedPrompt:prompt});
    }
  }

  if(path==='/api/editimage'&&req.method==='POST'){
    const{instruction}=req.body;
    if(!instruction)return res.status(400).json({error:'Instruction required'});
    try{
      const prompt=await geminiChat([{role:'user',content:`Create a detailed image generation prompt for: "${instruction}". Return ONLY the prompt.`}],'Expert image prompt writer. Return only the prompt.');
      const seed=Math.floor(Math.random()*99999);
      return res.status(200).json({url:`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`,prompt});
    }catch{return res.status(500).json({error:'Edit failed'});}
  }

  if(path==='/api/speak'&&req.method==='POST'){
    const{text,voice='Rachel'}=req.body;
    if(!text)return res.status(400).json({error:'Text required'});
    const VOICES={Rachel:'21m00Tcm4TlvDq8ikWAM',Adam:'pNInz6obpgDQGcFmaJgB',Bella:'EXAVITQu4vr4xnSDxMaL',Josh:'TxGEqnHWrfWFTfGW9XjX',Elli:'MF3mGyEYCl7XYWbV9V6O',Antoni:'ErXwobaYiN019PkySvjV'};
    try{
      const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voice]||VOICES.Rachel}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ELEVENLABS_KEY},body:JSON.stringify({text:text.slice(0,2500),model_id:'eleven_monolingual_v1',voice_settings:{stability:0.5,similarity_boost:0.75}})});
      if(!r.ok)return res.status(402).json({error:'ElevenLabs limit',fallback:true});
      const buf=await r.arrayBuffer();res.setHeader('Content-Type','audio/mpeg');res.setHeader('Content-Length',buf.byteLength);
      return res.status(200).send(Buffer.from(buf));
    }catch{return res.status(500).json({error:'TTS failed',fallback:true});}
  }

  if(path==='/api/transcribe'&&req.method==='POST'){
    const{audio}=req.body;if(!audio)return res.status(400).json({error:'Audio required'});
    try{
      const buf=Buffer.from(audio,'base64');const blob=new Blob([buf],{type:'audio/webm'});
      const form=new FormData();form.append('file',blob,'audio.webm');form.append('model','whisper-large-v3');form.append('response_format','json');
      const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{'Authorization':`Bearer ${GROQ_KEY}`},body:form});
      if(!r.ok)throw new Error('Failed');const d=await r.json();return res.status(200).json({text:d.text||''});
    }catch{return res.status(500).json({error:'Transcription failed'});}
  }

  if(path==='/api/readfile'&&req.method==='POST'){
    const{fileData,fileType,fileName,question}=req.body;if(!fileData)return res.status(400).json({error:'File required'});
    try{
      const q=question||`Analyze "${fileName}" thoroughly. Summarize key points and extract important data.`;
      let content='';
      if(fileType==='application/pdf'||fileType.startsWith('text/')||fileType==='application/json'){const decoded=Buffer.from(fileData,'base64').toString('utf-8');content=`File: "${fileName}"\n\nContent:\n${decoded.slice(0,30000)}\n\nTask: ${q}`;}
      else content=`User uploaded "${fileName}". Task: ${q}`;
      const text=await geminiChat([{role:'user',content}],`You are LIMITLESS, an expert document analyst. Be thorough and structured. Today: ${new Date().toDateString()}.`);
      return res.status(200).json({text});
    }catch{return res.status(500).json({error:'File read failed'});}
  }

  if(path==='/api/execute'&&req.method==='POST'){
    const{code,language,expression}=req.body;
    try{
      const prompt=expression?`Solve step by step:\n\n${expression}\n\nLabel final answer as "Answer:"`:`Simulate running this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\`\nShow exact output.`;
      const system=expression?'Precise mathematical calculator. Show all working steps then final answer.':'Code interpreter. Show exactly what this code outputs.';
      const result=await geminiChat([{role:'user',content:prompt}],system);
      return res.status(200).json({result,type:expression?'calculator':'simulated'});
    }catch{return res.status(500).json({error:'Execution failed'});}
  }

  if(path==='/api/vision'&&req.method==='POST'){
    const{imageData,imageType,question}=req.body;if(!imageData)return res.status(400).json({error:'Image required'});
    try{const text=await geminiVision(imageData,imageType,question);return res.status(200).json({text});}
    catch{return res.status(500).json({error:'Vision failed'});}
  }

  if(path==='/api/gamedev'&&req.method==='POST'){
    const{mode,input,code,imageData,imageType}=req.body;if(!mode)return res.status(400).json({error:'Mode required'});
    const SYSTEMS={qa_stress:'You are a senior game QA engineer with 15 years at AAA studios. Provide exhaustive analysis: 1) Critical Bugs Found with severity 2) Stress Test Scenarios 3) Performance Bottlenecks 4) Recommended Fixes with code. Be extremely specific.',qa_performance:'Expert game performance engineer. Analyze for memory leaks, FPS drops, draw calls, CPU/GPU bottlenecks. Provide: 1) Issues Found 2) Memory Analysis 3) PS5 vs PC Comparison 4) Optimization Priority with FPS gain estimates.',qa_visual:'Visual QA specialist. Check for artifacts, z-fighting, texture pop-in, lighting issues, shadow problems, LOD transitions. Provide: 1) Issues Detected 2) Root Cause 3) Regression Risk 4) Fix Recommendations.',lod_generator:'3D optimization expert for UE5, Unity, Godot. Provide: 1) LOD0-LOD4 polygon targets 2) Screen size thresholds 3) Nanite recommendations 4) Engine setup code 5) Memory savings estimate.',pbr_material:'Senior technical artist for PBR. Generate: 1) Full PBR channel breakdown 2) Value ranges 3) Substance Painter setup 4) Unreal Material Editor nodes 5) Texture resolution guide 6) Mobile vs console optimization.',mesh_cleaner:'3D technical artist expert. Provide: 1) All mesh problems found 2) Blender repair script 3) Maya alternative 4) Prevention guidelines 5) Target poly count after cleanup.',localization:'Professional game localization expert. Translate ALL text into 20 languages in a table: English, Spanish, French, German, Italian, Portuguese BR, Russian, Japanese, Korean, Chinese Simplified, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Norwegian, Danish, Finnish, Thai.',lip_sync:'Facial animation technical director. Provide: 1) Phoneme sequence 2) Viseme mapping Preston Blair 3) Frame timing 30fps and 60fps 4) Blendshape weights 5) Unreal MetaHuman code 6) Unity Animator setup.',dialogue_gen:'Award-winning game narrative designer. Generate 12+ NPC dialogue lines: greetings, idle, combat, merchant, quest hints, world commentary. Include voice direction notes. Make it feel like a real published game.',procedural_landscape:'Procedural generation expert. Provide: 1) Noise function stack with parameters 2) Biome mask setup 3) Asset density rules 4) Height map code 5) Engine-specific implementation 6) Performance budget.',collision_mapping:'Game physics engineer. Provide: 1) Optimal collision primitives 2) Collision layer matrix 3) Engine setup code 4) Batch generation script 5) Performance impact 6) Common edge cases.',manhour_tracker:'Game studio efficiency analyst. Calculate: 1) Manual hours by discipline 2) Hours with AI 3) Hours saved 4) Cost savings at $85/hour 5) ROI% 6) Annual savings. Format as professional dashboard.',legacy_optimizer:'C++ performance engineer. For legacy code: 1) Code smells with severity 2) Complete C++17/20 rewrite with comments 3) Performance improvements with % 4) Memory modernization 5) SIMD opportunities 6) Show ALL rewritten code.'};
    try{
      let userContent=input||'Analyze this thoroughly.';if(code)userContent+=`\n\nCode:\n\`\`\`\n${code}\n\`\`\``;
      const system=SYSTEMS[mode]||SYSTEMS.qa_stress;
      if(imageData&&(mode==='qa_visual'||mode==='pbr_material')){
        const body={contents:[{parts:[{text:system+'\n\n'+userContent},{inline_data:{mime_type:imageType,data:imageData}}]}],generationConfig:{temperature:0.4,maxOutputTokens:4096}};
        const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!r.ok)throw new Error('Vision failed');const d=await r.json();
        return res.status(200).json({text:d.candidates?.[0]?.content?.parts?.[0]?.text||'—',mode});
      }
      const text=await geminiChat([{role:'user',content:userContent}],system);
      return res.status(200).json({text,mode});
    }catch(e){return res.status(500).json({error:e.message||'Game dev failed'});}
  }

  if(path==='/api/subscribe'&&req.method==='POST'){
    const{email,plan,userId}=req.body;if(!email||!plan||!userId)return res.status(400).json({error:'Missing fields'});
    const planCode=plan==='pro'?PAYSTACK_PRO:plan==='enterprise'?PAYSTACK_ENT:null;if(!planCode)return res.status(400).json({error:'Invalid plan'});
    try{const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${PAYSTACK_SK}`},body:JSON.stringify({email,plan:planCode,amount:plan==='pro'?150000:490000,currency:'USD',metadata:{userId,plan},callback_url:`${APP_URL}/app/payment-success.html`})});
    if(!r.ok){const e=await r.json();return res.status(r.status).json({error:e.message});}
    const d=await r.json();return res.status(200).json({authorizationUrl:d.data.authorization_url,reference:d.data.reference});}
    catch{return res.status(500).json({error:'Subscribe failed'});}
  }

  if(path==='/api/verify-payment'&&req.method==='POST'){
    const{reference,userId}=req.body;if(!reference)return res.status(400).json({error:'Reference required'});
    try{const r=await fetch(`https://api.paystack.co/transaction/verify/${reference}`,{headers:{'Authorization':`Bearer ${PAYSTACK_SK}`}});const d=await r.json();
    if(d.data?.status==='success'){const plan=d.data?.metadata?.plan||'pro';const sb=await getSupabase();const end=new Date();end.setMonth(end.getMonth()+1);
    await sb.from('user_plans').upsert({user_id:userId,email:d.data?.customer?.email,plan,status:'active',subscription_end:end.toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});return res.status(200).json({success:true,plan});}
    return res.status(200).json({success:false});}catch{return res.status(500).json({error:'Verify failed'});}
  }

  if(path==='/api/webhook'&&req.method==='POST'){
    const hash=crypto.createHmac('sha512',PAYSTACK_SK).update(JSON.stringify(req.body)).digest('hex');
    if(hash!==req.headers['x-paystack-signature'])return res.status(401).json({error:'Invalid'});
    try{const sb=await getSupabase();const event=req.body;
    if(event.event==='charge.success'||event.event==='subscription.create'){const{metadata,customer}=event.data;if(metadata?.userId){const end=new Date();end.setMonth(end.getMonth()+1);await sb.from('user_plans').upsert({user_id:metadata.userId,email:customer?.email,plan:metadata?.plan||'pro',status:'active',paystack_customer:customer?.customer_code,subscription_end:end.toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});}}
    if(event.event==='subscription.disable'){const email=event.data?.customer?.email;if(email)await sb.from('user_plans').update({plan:'free',status:'cancelled'}).eq('email',email);}
    }catch(e){console.error(e);}return res.status(200).json({received:true});
  }

  if(path==='/api/userplan'&&req.method==='POST'){
    const{userId}=req.body;if(!userId)return res.status(400).json({error:'userId required'});
    try{const sb=await getSupabase();const{data:planData}=await sb.from('user_plans').select('*').eq('user_id',userId).single();const plan=planData?.plan||'free';
    const today=new Date().toISOString().split('T')[0];const{data:usage}=await sb.from('usage_tracking').select('*').eq('user_id',userId).eq('date',today).single();
    const LIMITS={free:{messages:20,images:3},pro:{messages:1000,images:50},enterprise:{messages:99999,images:999}};
    return res.status(200).json({plan,status:planData?.status||'free',usage:{messages:usage?.messages||0,images:usage?.images||0},limits:LIMITS[plan]||LIMITS.free,subscriptionEnd:planData?.subscription_end||null});}
    catch{return res.status(500).json({error:'Plan fetch failed'});}
  }

  if(path==='/api/trackusage'&&req.method==='POST'){
    const{userId,type}=req.body;if(!userId||!type)return res.status(400).json({error:'Required fields missing'});
    try{const sb=await getSupabase();const today=new Date().toISOString().split('T')[0];const{data:ex}=await sb.from('usage_tracking').select('*').eq('user_id',userId).eq('date',today).single();
    if(ex){await sb.from('usage_tracking').update(type==='image'?{images:(ex.images||0)+1}:{messages:(ex.messages||0)+1}).eq('id',ex.id);}
    else{await sb.from('usage_tracking').insert({user_id:userId,date:today,messages:type==='message'?1:0,images:type==='image'?1:0});}
    return res.status(200).json({tracked:true});}catch{return res.status(500).json({error:'Tracking failed'});}
  }

  if(path==='/api/admin'&&req.method==='POST'){
    const{adminKey}=req.body;if(adminKey!==ADMIN_KEY)return res.status(403).json({error:'Unauthorized'});
    try{const sb=await getSupabase();const{count:totalUsers}=await sb.from('user_plans').select('*',{count:'exact',head:true});const{data:plans}=await sb.from('user_plans').select('plan');
    const freeCount=plans?.filter(p=>p.plan==='free').length||0;const proCount=plans?.filter(p=>p.plan==='pro').length||0;const entCount=plans?.filter(p=>p.plan==='enterprise').length||0;
    const{data:recentUsers}=await sb.from('user_plans').select('email,plan,status,created_at').order('created_at',{ascending:false}).limit(20);
    const today=new Date().toISOString().split('T')[0];const{data:todayUsage}=await sb.from('usage_tracking').select('messages,images').eq('date',today);
    const totalMsgs=todayUsage?.reduce((a,b)=>a+(b.messages||0),0)||0;const totalImgs=todayUsage?.reduce((a,b)=>a+(b.images||0),0)||0;
    return res.status(200).json({totalUsers:totalUsers||0,plans:{free:freeCount,pro:proCount,enterprise:entCount},monthlyRevenue:(proCount*15)+(entCount*49),annualRevenue:((proCount*15)+(entCount*49))*12,recentUsers:recentUsers||[],todayActivity:{messages:totalMsgs,images:totalImgs}});}
    catch{return res.status(500).json({error:'Admin failed'});}
  }

  return res.status(404).json({error:'Route not found'});
}
