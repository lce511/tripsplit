(() => {
  const cfg = window.TRIPSPLIT_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const state = { mode:"login", member:null, members:[], trip:null, expenses:[], editingId:null };
  const symbols = {USD:"US$",TWD:"NT$",JPY:"¥",EUR:"€",GBP:"£",KRW:"₩",EGP:"E£"};
  const zeroDecimals = new Set(["JPY","KRW"]);

  const decimals = c => zeroDecimals.has(c) ? 0 : 2;
  const factor = c => 10 ** decimals(c);
  const roundCurrency = (n,c) => Math.round((Number(n)+Number.EPSILON)*factor(c))/factor(c);
  const fmt = (n,c) => `${symbols[c]||c+" "}${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:decimals(c),maximumFractionDigits:decimals(c)})}`;
  const today = () => new Date().toISOString().slice(0,10);
  const nameOf = id => state.members.find(m=>m.id===id)?.name || "?";
  const esc = s => String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const msg = (id,text,ok=false) => { const el=$(id); el.textContent=text||""; el.classList.toggle("ok",!!ok); };
  const setView = name => ["auth","claim","app"].forEach(v=>$(v+"-view").classList.toggle("hidden",v!==name));

  async function currentUser(){ const {data}=await sb.auth.getUser(); return data.user; }

  async function route(){
    const user=await currentUser();
    if(!user){ setView("auth"); return; }
    const {data,error}=await sb.from("trip_members").select("id,name,trip_id,user_id").eq("user_id",user.id);
    if(error){ msg("auth-message",error.message); setView("auth"); return; }
    if(!data?.length){ setView("claim"); return; }
    state.member=data[0];
    await loadApp();
    setView("app");
  }

  $("tab-login").onclick=()=>{
    state.mode="login"; $("tab-login").classList.add("active"); $("tab-signup").classList.remove("active");
    $("auth-submit").textContent="登入"; msg("auth-message","");
  };
  $("tab-signup").onclick=()=>{
    state.mode="signup"; $("tab-signup").classList.add("active"); $("tab-login").classList.remove("active");
    $("auth-submit").textContent="註冊"; msg("auth-message","");
  };

  $("auth-form").addEventListener("submit",async e=>{
    e.preventDefault(); msg("auth-message","");
    const email=$("auth-email").value.trim(), password=$("auth-password").value;
    if(state.mode==="login"){
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error) return msg("auth-message",error.message);
      await route();
    } else {
      const {data,error}=await sb.auth.signUp({email,password});
      if(error) return msg("auth-message",error.message);
      if(!data.session) msg("auth-message","註冊成功。請先到 Email 完成一次確認，再回來登入。",true);
      else await route();
    }
  });

  $("claim-form").addEventListener("submit",async e=>{
    e.preventDefault(); msg("claim-message","");
    const {data,error}=await sb.rpc("claim_trip_member",{p_invite_code:$("invite-code").value.trim().toUpperCase()});
    if(error) return msg("claim-message",error.message);
    msg("claim-message",`綁定成功：${data?.[0]?.member_name||""}`,true);
    await route();
  });

  async function logout(){ await sb.auth.signOut(); state.member=null; state.expenses=[]; setView("auth"); }
  $("logout-btn").onclick=logout; $("claim-logout").onclick=logout;

  async function loadApp(){
    const {data:trips,error:tErr}=await sb.from("trips").select("id,name").eq("name",cfg.TRIP_NAME).limit(1);
    if(tErr||!trips?.length){ msg("expense-message",tErr?.message||"找不到旅行"); return; }
    state.trip=trips[0];
    const {data:members,error:mErr}=await sb.from("trip_members").select("id,name,trip_id,user_id").eq("trip_id",state.trip.id).order("name");
    if(mErr){ msg("expense-message",mErr.message); return; }
    state.members=members||[];
    $("whoami").textContent=`${state.member.name} · ${state.trip.name}`;
    renderMemberControls();
    $("expense-date").value ||= today();
    await loadExpenses();
  }

  function renderMemberControls(){
    $("payer").innerHTML=""; $("equal-members").innerHTML=""; $("custom-members").innerHTML="";
    state.members.forEach(m=>{
      $("payer").insertAdjacentHTML("beforeend",`<option value="${m.id}">${m.name}</option>`);
      $("equal-members").insertAdjacentHTML("beforeend",`<label class="member-chip"><input type="checkbox" value="${m.id}" checked> ${m.name}</label>`);
      $("custom-members").insertAdjacentHTML("beforeend",`<div class="custom-row"><span>${m.name}</span><input data-member="${m.id}" type="number" min="0" step="0.01" inputmode="decimal" value="0"></div>`);
    });
    $("custom-members").querySelectorAll("input").forEach(i=>i.addEventListener("input",updateCustomStatus));
    $("equal-members").addEventListener("change",updateEqualPreview);
  }

  async function loadExpenses(){
    const {data,error}=await sb.from("expenses")
      .select("id,trip_id,item,amount,currency,category,payer_member_id,split_mode,expense_date,note,created_at,expense_shares(id,member_id,amount)")
      .eq("trip_id",state.trip.id).order("expense_date",{ascending:false}).order("created_at",{ascending:false});
    if(error){ msg("expense-message",error.message); return; }
    state.expenses=data||[]; render();
  }

  const mode=()=>document.querySelector('input[name="split-mode"]:checked').value;
  document.querySelectorAll('input[name="split-mode"]').forEach(r=>r.addEventListener("change",()=>{
    const custom=mode()==="custom";
    $("equal-panel").classList.toggle("hidden",custom); $("custom-panel").classList.toggle("hidden",!custom);
    updateEqualPreview(); updateCustomStatus();
  }));
  $("amount").addEventListener("input",()=>{updateEqualPreview();updateCustomStatus();});
  $("currency").addEventListener("change",()=>{
    const z=zeroDecimals.has($("currency").value);
    $("amount").step=z?"1":"0.01";
    $("custom-members").querySelectorAll("input").forEach(i=>i.step=z?"1":"0.01");
    updateEqualPreview(); updateCustomStatus();
  });

  function updateEqualPreview(){
    const amount=Number($("amount").value)||0,c=$("currency").value;
    const selected=[...$("equal-members").querySelectorAll("input:checked")];
    $("equal-preview").textContent=amount&&selected.length?`每人約 ${fmt(amount/selected.length,c)}；無法整除時差額會分配到其中一人，總額仍完全一致。`:"";
  }

  function updateCustomStatus(){
    const c=$("currency").value, amount=roundCurrency(Number($("amount").value)||0,c);
    const total=roundCurrency([...$("custom-members").querySelectorAll("input")].reduce((s,i)=>s+(Number(i.value)||0),0),c);
    const diff=roundCurrency(amount-total,c);
    $("custom-status").textContent=!amount?"先輸入支出金額":diff===0?"✓ 金額已吻合":diff>0?`還差 ${fmt(diff,c)}`:`超出 ${fmt(-diff,c)}`;
  }

  function buildShares(){
    const c=$("currency").value;
    const amount=roundCurrency(Number($("amount").value),c);
    if(mode()==="equal"){
      const ids=[...$("equal-members").querySelectorAll("input:checked")].map(i=>i.value);
      if(!ids.length) throw new Error("至少選一位分攤成員");
      const totalUnits=Math.round(amount*factor(c));
      const base=Math.floor(totalUnits/ids.length);
      let remainder=totalUnits-base*ids.length;
      const payer=$("payer").value;
      const order=[...(ids.includes(payer)?[payer]:[]),...ids.filter(id=>id!==payer)];
      const units=Object.fromEntries(ids.map(id=>[id,base]));
      for(let i=0;i<order.length&&remainder>0;i++,remainder--) units[order[i]]++;
      return ids.map(id=>({member_id:id,amount:units[id]/factor(c)}));
    }
    const shares=[...$("custom-members").querySelectorAll("input")]
      .map(i=>({member_id:i.dataset.member,amount:roundCurrency(Number(i.value)||0,c)})).filter(x=>x.amount>0);
    if(!shares.length) throw new Error("請輸入至少一位成員的分攤金額");
    const total=roundCurrency(shares.reduce((s,x)=>s+x.amount,0),c);
    if(total!==amount) throw new Error("自訂分攤總額必須等於支出金額");
    return shares;
  }

  $("expense-form").addEventListener("submit",async e=>{
    e.preventDefault(); msg("expense-message","");
    try{
      const c=$("currency").value, amount=roundCurrency(Number($("amount").value),c);
      if(!Number.isFinite(amount)||amount<=0) throw new Error("請輸入有效金額");
      const {error}=await sb.rpc("save_trip_expense",{
        p_expense_id:state.editingId,p_trip_id:state.trip.id,p_item:$("item").value.trim(),p_amount:amount,
        p_currency:c,p_category:$("category").value,p_payer_member_id:$("payer").value,p_split_mode:mode(),
        p_expense_date:$("expense-date").value,p_note:$("note").value,p_shares:buildShares()
      });
      if(error) throw error;
      resetForm(); msg("expense-message","已儲存",true); await loadExpenses();
    }catch(err){ msg("expense-message",err.message||String(err)); }
  });

  function resetForm(){
    state.editingId=null; $("form-title").textContent="新增支出"; $("cancel-edit").classList.add("hidden");
    $("expense-form").reset(); $("expense-date").value=today();
    document.querySelector('input[name="split-mode"][value="equal"]').checked=true;
    $("equal-panel").classList.remove("hidden"); $("custom-panel").classList.add("hidden");
    $("equal-members").querySelectorAll("input").forEach(i=>i.checked=true);
    $("custom-members").querySelectorAll("input").forEach(i=>i.value="0");
    updateEqualPreview(); updateCustomStatus();
  }
  $("cancel-edit").onclick=resetForm;

  function editExpense(id){
    const e=state.expenses.find(x=>x.id===id); if(!e)return;
    state.editingId=id; $("form-title").textContent="編輯支出"; $("cancel-edit").classList.remove("hidden");
    $("item").value=e.item; $("amount").value=e.amount; $("currency").value=e.currency; $("category").value=e.category;
    $("payer").value=e.payer_member_id; $("expense-date").value=e.expense_date; $("note").value=e.note||"";
    document.querySelector(`input[name="split-mode"][value="${e.split_mode}"]`).checked=true;
    const custom=e.split_mode==="custom";
    $("equal-panel").classList.toggle("hidden",custom); $("custom-panel").classList.toggle("hidden",!custom);
    const shareMap=Object.fromEntries((e.expense_shares||[]).map(s=>[s.member_id,Number(s.amount)]));
    $("equal-members").querySelectorAll("input").forEach(i=>i.checked=(i.value in shareMap));
    $("custom-members").querySelectorAll("input").forEach(i=>i.value=shareMap[i.dataset.member]||0);
    updateEqualPreview(); updateCustomStatus(); window.scrollTo({top:0,behavior:"smooth"});
  }

  async function deleteExpense(id){
    if(!confirm("確定刪除這筆支出？")) return;
    const {error}=await sb.rpc("delete_trip_expense",{p_expense_id:id});
    if(error) return alert(error.message);
    await loadExpenses();
  }

  function settlements(){
    const directed={};
    for(const e of state.expenses){
      directed[e.currency] ||= {};
      for(const s of e.expense_shares||[]){
        if(s.member_id===e.payer_member_id) continue;
        const key=`${s.member_id}|${e.payer_member_id}`;
        directed[e.currency][key]=(directed[e.currency][key]||0)+Number(s.amount);
      }
    }

    const out={};
    for(const [c,debts] of Object.entries(directed)){
      out[c]=[];
      const seen=new Set();
      for(const a of state.members){
        for(const b of state.members){
          if(a.id===b.id) continue;
          const pair=[a.id,b.id].sort().join("|");
          if(seen.has(pair)) continue;
          seen.add(pair);
          const ab=roundCurrency(debts[`${a.id}|${b.id}`]||0,c);
          const ba=roundCurrency(debts[`${b.id}|${a.id}`]||0,c);
          const net=roundCurrency(ab-ba,c);
          if(net>0) out[c].push({from:a.id,to:b.id,amount:net});
          else if(net<0) out[c].push({from:b.id,to:a.id,amount:-net});
        }
      }
    }
    return out;
  }

  function personalSpending(){
    const totals=Object.fromEntries(state.members.map(m=>[m.id,{}]));
    for(const e of state.expenses){
      for(const s of e.expense_shares||[]){
        totals[s.member_id] ||= {};
        totals[s.member_id][e.currency]=roundCurrency((totals[s.member_id][e.currency]||0)+Number(s.amount),e.currency);
      }
    }
    return totals;
  }

  function render(){
    $("expense-count").textContent=`${state.expenses.length} 筆`;
    const totals={}; state.expenses.forEach(e=>totals[e.currency]=(totals[e.currency]||0)+Number(e.amount));
    $("totals").innerHTML=Object.keys(totals).length
      ?Object.entries(totals).map(([c,v])=>`<div class="total-card"><div class="muted">${c}</div><strong>${fmt(v,c)}</strong></div>`).join("")
      :`<p class="empty">還沒有支出。</p>`;

    const sts=settlements();
    $("settlements").innerHTML=Object.keys(sts).length
      ?Object.entries(sts).map(([c,ts])=>`<div class="settle-group"><strong>${c}</strong>${ts.length
        ?ts.map(t=>`<div class="settle-line"><span>${nameOf(t.from)} → ${nameOf(t.to)}</span><strong>${fmt(t.amount,c)}</strong></div>`).join("")
        :`<p class="muted" style="margin:8px 0 0">目前已平衡</p>`}</div>`).join("")
      :`<p class="empty">新增支出後會自動計算。</p>`;

    $("expense-list").innerHTML=state.expenses.length?state.expenses.map(e=>{
      const shares=(e.expense_shares||[]).map(s=>`${nameOf(s.member_id)} ${fmt(s.amount,e.currency)}`).join(" · ");
      return `<div class="expense-row"><div class="title"><strong>${esc(e.item)}</strong><strong>${fmt(e.amount,e.currency)}</strong></div><div class="meta">${e.expense_date} · ${esc(e.category)} · ${nameOf(e.payer_member_id)} 付款 · ${e.split_mode==="equal"?"平均分攤":"自訂金額"}</div><div class="shares">${shares}</div><div class="expense-actions"><button class="secondary small" data-edit="${e.id}">編輯</button><button class="secondary small" data-delete="${e.id}">刪除</button></div></div>`;
    }).join(""):`<p class="empty">還沒有支出紀錄。</p>`;
    $("expense-list").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editExpense(b.dataset.edit));
    $("expense-list").querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteExpense(b.dataset.delete));

    const spending=personalSpending();
    const currencies=[...new Set(state.expenses.map(e=>e.currency))];
    $("personal-spending").innerHTML=state.members.map(m=>{
      const lines=currencies.length
        ?currencies.map(c=>`<div class="person-spend-line"><span>${c}</span><strong>${fmt(spending[m.id]?.[c]||0,c)}</strong></div>`).join("")
        :`<p class="empty">尚無支出</p>`;
      return `<div class="person-spend-card"><h3>${esc(m.name)}</h3>${lines}</div>`;
    }).join("");
  }

  sb.auth.onAuthStateChange(()=>setTimeout(route,0));
  $("expense-date").value=today();
  route();
})();