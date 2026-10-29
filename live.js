/* ==========================================================================
   📡 العرض التزامني مع الطالبات (جهاز المعلمة) — لا تحتاجين لتعديل هذا الملف
   --------------------------------------------------------------------------
   • تدخل المعلمة برمزها ورقمها السري، فيصبح رمزها هو «رمز الفصل».
   • تكتب الطالبات رمز الفصل في الآيباد (student.html) ويخترن أسماءهن.
   • عند فتح شريحة سؤال يظهر السؤال لكل طالبة، وبعد «كشف الإجابة»
     تُحسب النقاط تلقائيًا لكل طالبة أجابت إجابة صحيحة.
   • التحضير تلقائي عند دخول الطالبة، ويمكن تعديله يدويًا من لوحة 👩‍🎓
   • قرعة الأسماء من زر 🎲 أو حرف (ق).
   بنية البيانات: rooms/{رمز المعلمة}/ roster, att, live, session, answers,
   ideas, presence, awarded, bonus, scores, rev, groups, pick, picked
   ========================================================================== */
const LIVE = (() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const strip = s => String(s || '').replace(/<[^>]*>/g, '');
  const clean = o => JSON.parse(JSON.stringify(o));          // Firebase لا يقبل undefined
  const obj = v => { const o={}; if(v) Object.keys(v).forEach(k=>{ if(v[k]!=null) o[k]=v[k]; }); return o; };   // Firebase قد يُعيد المفاتيح الرقمية كمصفوفة
  const first = s => String(s).trim().split(/\s+/)[0];
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const LS = { get:k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set:(k,v)=>{ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch(e){} } };

  // أسئلة تحلّها الطالبات في الآيباد وتُحسب لها النقاط
  const QUIZ = ['mcq','tf','sort','order','match'];

  let db=null, room=null, code=null, on=false, uid=null, tName='';
  const st = { roster:{}, online:{}, att:{}, answers:{}, ideas:{}, awarded:{}, bonus:{}, rev:{}, groups:null, picked:[] };
  const seenIdeas = new Set();

  /* ---------- ترتيب ثابت للعناصر (حتى لا يتغير عند إعادة تحميل الصفحة) ---------- */
  function seeded(n, seed){
    const a=[...Array(n).keys()]; let x=(seed+7)*7919;
    const r=()=>((x=(x*9301+49297)%233280)/233280);
    for(let i=n-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    if(n>1 && a.every((v,i)=>v===i)) a.push(a.shift());
    return a;
  }

  /* ---------- ما يُرسل للطالبات (q) ومفتاح الإجابة (k) — المفتاح لا يُرسل إلا بعد الكشف ---------- */
  function payload(i){
    const s=slides[i].cfg, q={type:s.type}, k={};
    if(s.type==='mcq'){ q.question=s.question; q.options=s.options.map(o=>({icon:o.icon||'',t:o.t})); k.answer=s.answer; k.explain=s.explain||''; }
    else if(s.type==='tf'){ q.items=s.items.map(it=>it.t); k.a=s.items.map(it=>it.a?1:0); k.why=s.items.map(it=>it.why||''); }
    else if(s.type==='sort'){ const o=seeded(s.items.length,i); q.prompt=s.prompt||'';
      q.buckets=s.buckets.map(b=>({key:b.key,label:b.label,icon:b.icon||'',color:b.color||'#7C3AED'}));
      q.items=o.map(j=>({icon:s.items[j].icon||'',t:s.items[j].t})); k.b=o.map(j=>s.items[j].b); }
    else if(s.type==='order'){ const o=seeded(s.items.length,i); q.prompt=s.prompt||'';
      q.items=o.map(j=>({icon:s.items[j].icon||'',t:s.items[j].t})); k.order=s.items.map((_,j)=>o.indexOf(j)); }
    else if(s.type==='match'){ const o=seeded(s.pairs.length,i); q.prompt=s.prompt||'';
      q.a=s.pairs.map(p=>p.a); q.b=o.map(j=>s.pairs[j].b); k.m=s.pairs.map((_,j)=>o.indexOf(j)); }
    else if(s.type==='brainstorm'){ q.prompt=s.prompt||''; }
    else if(s.type==='groups'){ q.prompt=s.prompt||''; q.groups=(s.groups||[]).map((g,j)=>({name:g.name,icon:g.icon||'',color:g.color||'#7C3AED',task:(s.tasks||[])[j]||''})); }
    else if(s.type==='closing'){ q.title=s.title||''; q.rating=s.rating||[]; }
    else return { q:null, k:null };
    return { q:clean(q), k:clean(k) };
  }

  /* ---------- التصحيح: c = عدد الصحيح، n = العدد الكلي، p = النقاط ---------- */
  function grade(s, k, v){
    const pts = s.noPoints ? 0 : (s.points || LESSON.defaultPoints || 1);
    if(v==null) return { c:0, n:1, p:0 };
    if(s.type==='mcq'){ const ok=+v===k.answer; return { c:ok?1:0, n:1, p:ok?pts:0 }; }
    const exp = s.type==='tf'?k.a : s.type==='sort'?k.b : s.type==='order'?k.order : k.m;
    let c=0; exp.forEach((e,j)=>{ if(v[j]===e) c++; });
    const each = s.type==='tf' || s.pointEach;
    return { c, n:exp.length, p: each ? c*pts : (c===exp.length?pts:0) };
  }

  /* ---------- حساب النقاط ---------- */
  function totals(){
    const t={};
    Object.values(st.awarded).forEach(m=>Object.entries(m||{}).forEach(([n,p])=>t[n]=(t[n]||0)+p));
    Object.entries(st.bonus).forEach(([n,p])=>t[n]=(t[n]||0)+p);
    Object.keys(t).forEach(n=>{ if(!st.roster[n] || t[n]<=0) delete t[n]; });
    return t;
  }
  function saveScores(){ if(!on) return; const t=totals(); room.child('scores').set(Object.keys(t).length?t:null); drawDrawer(); }
  function addBonus(n, d){
    if(!on||!st.roster[n]) return;
    st.bonus[n]=(st.bonus[n]||0)+d;
    const cur=totals()[n]||0; if(cur<0) st.bonus[n]-=cur;   // لا نقاط سالبة
    room.child('bonus/'+n).set(st.bonus[n]||null); saveScores();
  }
  function ranking(limit){
    const t=totals();
    return Object.keys(t).map(n=>({ n, name:st.roster[n], pts:t[n] })).sort((a,b)=>b.pts-a.pts).slice(0, limit||99);
  }

  /* ---------- الحضور ---------- */
  const ids = () => Object.keys(st.roster).sort((a,b)=>a-b);
  const isOnline = n => !!st.online[n];
  const isPresent = n => !!st.att[n] || isOnline(n);
  const presentIds = () => ids().filter(isPresent);

  /* ==========================================================================
     🧩 الواجهة
     ========================================================================== */
  function build(){
    document.body.insertAdjacentHTML('beforeend', `
      <div id="lvChip" title="الطالبات"></div>
      <div id="lvDock"></div>
      <aside id="lvDrawer">
        <div class="dr-head">👩‍🎓 الطالبات <button class="x" data-a="close">✕</button></div>
        <div class="dr-sub"></div>
        <div class="dr-tabs"><button data-tab="list" class="on">📋 التحضير والنقاط</button><button data-tab="edit">✏️ أسماء الطالبات</button><button data-tab="res">📊 النتائج</button></div>
        <div class="dr-body lv-scroll"></div>
        <div class="dr-foot">
          <button class="lv-btn sm" data-a="pick">🎲 قرعة</button>
          <button class="lv-btn ghost sm" data-a="new">↺ حصة جديدة</button>
          <button class="lv-btn ghost sm" data-a="out">🚪 خروج</button>
        </div>
      </aside>
      <div id="lvAns" class="lv-ov"><div class="lv-card">
        <div class="an-head"><span class="an-t"></span><button class="lv-btn ghost sm an-hide" title="إخفاء الإجابات عن السبورة">🙈 إخفاء الأسماء</button><button class="x">✕</button></div>
        <div class="an-sub"></div><div class="an-body lv-scroll"></div>
      </div></div>
      <div id="lvAward"><div class="aw-head">🏅 من أجابت؟ <span class="pts">+1</span><button class="x">✕</button></div><div class="aw-list lv-scroll"></div></div>
      <div id="lvPick" class="lv-ov"><div class="lv-card">
        <div class="lp-t">🎲 قرعة الأسماء</div><div class="lp-name">…</div>
        <div class="lp-btns"><button class="lv-btn lp-go">🎲 اسحبي اسمًا</button><button class="lv-btn ok lp-plus" disabled>+1 ⭐</button><button class="lv-btn ghost lp-close">إغلاق</button></div>
        <label class="lp-opt"><input type="checkbox" class="lp-norep" checked> بدون تكرار (حتى تُسحب كل الأسماء)</label>
      </div></div>
      <div id="lvLogin" class="lv-ov"><div class="lv-card">
        <div class="lg-ic">👩‍🏫</div><div class="lg-t">دخول المعلمة</div><div class="lg-s">لربط العرض بأجهزة الطالبات</div>
        <input class="lv-in" id="lvCode" inputmode="numeric" placeholder="رمز المعلمة" autocomplete="off">
        <input class="lv-in" id="lvPin" type="password" inputmode="numeric" maxlength="8" placeholder="الرقم السري" autocomplete="off">
        <div class="lg-err"></div>
        <div class="lg-btns"><button class="lv-btn" id="lvGo">دخول ⬅</button><button class="lv-btn ghost" id="lvSkip">متابعة بدون الطالبات</button></div>
      </div></div>`);

    $('#lvChip').onclick=()=> on ? openDrawer() : openLogin();
    $('#lvDrawer').addEventListener('click', e=>{
      const b=e.target.closest('button'); if(!b) return;
      if(b.dataset.tab){ $$('.dr-tabs button').forEach(x=>x.classList.toggle('on',x===b)); drawDrawer(); return; }
      if(b.dataset.a==='close') closeDrawer();
      else if(b.dataset.a==='pick') openPick();
      else if(b.dataset.a==='new') newSession(true);
      else if(b.dataset.a==='out') logout();
      else if(b.dataset.a==='csv') downloadCSV();
      else if(b.dataset.a==='save') addNames($('#lvNames').value, ()=>{ $('#lvNames').value=''; });
      else if(b.dataset.a==='add') addNames($('#lvAdd').value, ()=>{ $('#lvAdd').value=''; $('#lvAdd').focus(); });
      else if(b.dataset.ed){ editN=b.dataset.ed; editFocus=true; drawDrawer(); }
      else if(b.dataset.ok) renameStudent(b.dataset.ok, $('.ed-row input').value);
      else if(b.dataset.cancel){ editN=null; drawDrawer(); }
      else if(b.dataset.del) removeStudent(b.dataset.del);
      else if(b.dataset.att) toggleAtt(b.dataset.att);
      else if(b.dataset.pm){ addBonus(b.dataset.n, +b.dataset.pm); +b.dataset.pm>0?sound.ding():sound.pop(); }
    });
    $('#lvDrawer').addEventListener('keydown', e=>{
      if(e.key==='Enter' && e.target.id==='lvAdd') $('#lvDrawer [data-a="add"]').click();
      else if(e.target.closest('.ed-row')){ if(e.key==='Enter') $('.ed-row [data-ok]').click(); else if(e.key==='Escape'){ e.stopPropagation(); editN=null; drawDrawer(); } }
    });
    $('#lvAns .x').onclick=()=>$('#lvAns').classList.remove('open');
    $('#lvAns').addEventListener('click', e=>{ if(e.target.id==='lvAns') $('#lvAns').classList.remove('open'); });
    $('#lvAns .an-hide').onclick=e=>{ ansAnon=!ansAnon; e.currentTarget.textContent=ansAnon?'👀 إظهار الأسماء':'🙈 إخفاء الأسماء'; drawAns(); };
    $('#lvAward .x').onclick=()=>$('#lvAward').classList.remove('open');
    $('#lvPick .lp-go').onclick=spin;
    $('#lvPick .lp-close').onclick=()=>$('#lvPick').classList.remove('open');
    $('#lvPick .lp-plus').onclick=e=>{ if(pickN){ addBonus(pickN, 1); sound.ding(); e.currentTarget.disabled=true; } };
    $('#lvGo').onclick=()=>login($('#lvCode').value.trim(), $('#lvPin').value.trim());
    $('#lvPin').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#lvGo').click(); });
    $('#lvCode').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#lvPin').focus(); });
    $('#lvSkip').onclick=()=>$('#lvLogin').classList.remove('open');

    const sb=$('#stuBtn'), pb=$('#pickBtn');
    sb && (sb.onclick=()=> on ? ($('#lvDrawer').classList.contains('open')?closeDrawer():openDrawer()) : openLogin());
    pb && (pb.onclick=openPick);
    document.addEventListener('keydown', e=>{
      if(e.target.matches('input,textarea')) return;
      if(e.key==='ق'||e.code==='KeyR'){ e.preventDefault(); openPick(); }
      else if(e.key==='Escape'){ $$('.lv-ov.open').forEach(o=>o.classList.remove('open')); closeDrawer(); }
    });
  }

  function openLogin(){
    if(!db){ alert('تعذّر الاتصال بقاعدة البيانات — تأكدي من الإنترنت ثم أعيدي تحميل الصفحة.'); return; }
    $('#lvCode').value=LS.get('lv_code')||''; $('#lvPin').value=''; $('.lg-err').textContent='';
    $('#lvLogin').classList.add('open'); setTimeout(()=>($('#lvCode').value?$('#lvPin'):$('#lvCode')).focus(),50);
  }
  function openDrawer(){ drawDrawer(); $('#lvDrawer').classList.add('open'); }
  function closeDrawer(){ $('#lvDrawer').classList.remove('open'); }

  /* ---------- الشريط العلوي ---------- */
  function drawChip(){
    const c=$('#lvChip'); c.classList.toggle('on',on);
    c.innerHTML = on
      ? `<span class="dot"></span><span>رمز الفصل <b>${esc(code)}</b></span><span class="sep"></span><span>👩‍🎓 متصلة <b>${ids().filter(isOnline).length}</b> / ${ids().length}</span>`
      : `<span class="dot"></span><span>بدون اتصال — اضغطي للدخول</span>`;
  }

  /* ---------- شريحة العنوان: طريقة الانضمام ---------- */
  let qrFor=null;
  function drawJoin(){
    $$('.hero-join').forEach(box=>{
      if(!on){ box.innerHTML=''; return; }
      const url=new URL('student.html?c='+encodeURIComponent(code), location.href).href, web=/^https?:/.test(location.protocol);
      if(qrFor!==code || !box.firstChild){
        box.innerHTML=`${web?'<div class="hj-qr"></div>':''}<div>📲 من الآيباد افتحي صفحة الطالبة واكتبي <b>رمز الفصل</b>
          <div class="hj-code">${esc(code)}</div><div class="hj-url">${esc(url.replace(/\?.*$/,''))}</div></div>`;
        if(web && window.QRCode) new QRCode($('.hj-qr',box), { text:url, width:256, height:256, correctLevel:QRCode.CorrectLevel.M });
      }
    });
    qrFor=on?code:null;
  }

  /* ---------- اللوحة الجانبية ---------- */
  function drawDrawer(){
    const all=ids(), pres=presentIds().length, t=totals();
    $('.dr-sub').innerHTML = on ? `👩‍🏫 ${esc(tName)} • رمز الفصل <b>${esc(code)}</b> • 📅 ${today()}<br>✅ الحاضرات <b>${pres}</b> من ${all.length} • 🟢 المتصلات <b>${all.filter(isOnline).length}</b>` : '';
    const tab=($('.dr-tabs .on')||{}).dataset?.tab||'list', body=$('.dr-body');
    if(tab==='edit'){
      // نحتفظ بما تكتبه المعلمة إذا أُعيد رسم اللوحة أثناء الكتابة
      const keep={ add:$('#lvAdd')?.value||'', bulk:$('#lvNames')?.value||'', ed:$('.ed-row input')?.value, edN:$('.ed-row [data-ok]')?.dataset.ok, focus:document.activeElement?.id||(document.activeElement?.closest?.('.ed-row')?'ed':''), open:$('.ed-bulk')?.open };
      if(editN && !st.roster[editN]) editN=null;
      body.innerHTML=`<div class="ed-add"><input id="lvAdd" class="ed-in" maxlength="40" placeholder="اسم طالبة جديدة"><button class="lv-btn sm" data-a="add">➕ إضافة</button></div>
        ${all.length?`<div class="ed-list">${all.map(n=>editN===n
          ? `<div class="ed-row on"><span class="num">${n}</span><input class="ed-in" maxlength="40" value="${esc(st.roster[n])}"><button class="ed-b ok" data-ok="${n}" title="حفظ">✓</button><button class="ed-b" data-cancel="1" title="إلغاء">✕</button></div>`
          : `<div class="ed-row"><span class="num">${n}</span><span class="nm">${esc(st.roster[n])}</span><button class="ed-b" data-ed="${n}" title="تعديل الاسم">✏️</button><button class="ed-b del" data-del="${n}" title="حذف الطالبة">🗑️</button></div>`).join('')}</div>`
          :`<div class="dr-empty">لا توجد أسماء بعد 🌱</div>`}
        <details class="ed-bulk" ${!all.length||keep.open?'open':''}><summary>📋 إضافة عدة أسماء دفعة واحدة</summary>
          <p class="dr-note">الصقي الأسماء، اسم كل طالبة في سطر مستقل (حتى 99 طالبة). تُضاف إلى القائمة الحالية.</p>
          <textarea id="lvNames" class="lv-scroll" placeholder="نورة محمد&#10;سارة عبدالله&#10;…"></textarea>
          <div style="margin-top:1.2vmin"><button class="lv-btn" data-a="save" style="width:100%">➕ إضافة الأسماء</button></div></details>`;
      $('#lvAdd').value=keep.add; $('#lvNames').value=keep.bulk;
      const ei=$('.ed-row input');
      if(ei && keep.ed!=null && keep.edN===editN) ei.value=keep.ed;
      if(ei && (editFocus || keep.focus==='ed')){ ei.focus(); if(editFocus) ei.select(); editFocus=false; }
      else if(keep.focus==='lvAdd') $('#lvAdd').focus();
      else if(keep.focus==='lvNames') $('#lvNames').focus();
    } else if(tab==='res'){
      const { qs, rows }=results(), rev=qs.filter(i=>st.rev['s'+i]).length;
      body.innerHTML=!all.length?'<div class="dr-empty">لا توجد أسماء بعد 🌱</div>'
        :`<p class="dr-note">أسئلة الآيباد: <b>${qs.length}</b> (منها <b>${rev}</b> مكشوفة). «كاملة» = إجابة صحيحة بالكامل.</p>
        <div class="rs-row rs-h"><span class="nm">الطالبة</span><span>أجابت</span><span>كاملة</span><span>النقاط</span></div>
        ${rows.sort((a,b)=>b.pts-a.pts||a.n-b.n).map(r=>`<div class="rs-row ${r.present?'':'abs'}"><span class="nm">${esc(r.name)}</span><span>${r.answered}/${qs.length}</span><span>${r.right}/${rev}</span><span class="pt">${r.pts}</span></div>`).join('')}
        <div style="margin-top:1.4vmin"><button class="lv-btn" data-a="csv" style="width:100%">⬇️ تنزيل النتائج (Excel)</button></div>`;
    } else if(!all.length){
      body.innerHTML=`<div class="dr-empty">لا توجد أسماء بعد 🌱<br>اضغطي «✏️ أسماء الطالبات» وأضيفي أسماء فصلكِ</div>`;
    } else {
      body.innerHTML=all.map(n=>`<div class="dr-row ${isOnline(n)?'online':''}"><span class="on-dot" title="${isOnline(n)?'متصلة الآن':'غير متصلة'}"></span>
        <span class="num">${n}</span><span class="nm">${esc(st.roster[n])}</span>
        <button class="dr-att ${isPresent(n)?'yes':''}" data-att="${n}">${isPresent(n)?'✓ حاضرة':'✗ غائبة'}</button>
        <button class="dr-pm" data-pm="-1" data-n="${n}">−</button><span class="dr-pts">${t[n]||0}</span><button class="dr-pm" data-pm="1" data-n="${n}">＋</button></div>`).join('');
    }
    drawChip();
  }

  function toggleAtt(n){
    if(!on) return;
    const v=!isPresent(n);
    if(!v && isOnline(n) && !confirm('هذه الطالبة متصلة الآن من الآيباد. تسجيلها غائبة؟')) return;
    st.att[n]=v; room.child(`att/${today()}/${n}`).set(v); drawDrawer();
  }

  /* ---------- أسماء الطالبات: إضافة وتعديل وحذف ---------- */
  let editN=null, editFocus=false;
  const tidy = x => String(x||'').trim().replace(/\s+/g,' ');
  const nameTaken = (name, except) => Object.entries(st.roster).some(([n,v])=>n!==except && v===name);

  function addNames(text, done){
    if(!on) return;
    const lines=[...new Set(String(text||'').split('\n').map(tidy).filter(Boolean))], fresh=lines.filter(x=>!nameTaken(x));
    if(!lines.length) return;
    if(!fresh.length) return alert(lines.length>1?'هذه الأسماء موجودة مسبقًا':'هذا الاسم موجود مسبقًا');
    const used=new Set(Object.keys(st.roster).map(Number));
    if(used.size+fresh.length>99) return alert('الحد الأقصى 99 طالبة');
    const u={}; let next=1;
    fresh.forEach(name=>{ while(used.has(next)) next++; used.add(next); u['roster/'+next]=name; });
    room.update(u).then(()=>{ sound.success(); done&&done(); if(lines.length>fresh.length) alert(`أُضيفت ${fresh.length}، وتم تجاهل ${lines.length-fresh.length} موجودة مسبقًا`); })
      .catch(()=>alert('تعذّر حفظ الأسماء'));
  }

  // تعديل الاسم يحافظ على رقم الطالبة ونقاطها وحضورها
  function renameStudent(n, name){
    name=tidy(name); if(!name) return;
    if(name===st.roster[n]){ editN=null; drawDrawer(); return; }
    if(nameTaken(name,n)) return alert('هذا الاسم موجود مسبقًا');
    room.child('roster/'+n).set(name).then(()=>{ editN=null; sound.ding(); drawDrawer(); }).catch(()=>alert('تعذّر حفظ الاسم'));
  }

  // الحذف يمسح نقاطها وإجاباتها في الحصة حتى لا تنتقل لطالبة تأخذ رقمها لاحقًا
  function removeStudent(n){
    if(!confirm(`حذف «${st.roster[n]}» من قائمة الفصل؟\nستُحذف إجاباتها ونقاطها في هذه الحصة.`)) return;
    const u={ ['roster/'+n]:null, ['bonus/'+n]:null, [`att/${today()}/${n}`]:null, ['presence/'+n]:null };
    Object.keys(st.awarded).forEach(sk=>{ if(st.awarded[sk][n]!=null){ u[`awarded/${sk}/${n}`]=null; delete st.awarded[sk][n]; } });
    Object.keys(st.answers).forEach(sk=>{ if(st.answers[sk][n]!=null) u[`answers/${sk}/${n}`]=null; });
    if(st.groups && st.groups.m && st.groups.m[n]!=null){ u[`groups/m/${n}`]=null; delete st.groups.m[n]; }
    if(st.picked.includes(n)){ st.picked=st.picked.filter(x=>x!==n); u.picked=st.picked.length?st.picked:null; }
    delete st.bonus[n]; if(editN===n) editN=null;
    room.update(u).then(()=>{ saveScores(); sound.pop(); }).catch(()=>alert('تعذّر الحذف'));
  }

  /* ---------- قرعة الأسماء ---------- */
  let pickN=null, spinning=false;
  function openPick(){
    if(!on) return openLogin();
    if(!ids().length){ openDrawer(); $$('.dr-tabs button')[1].click(); return; }
    pickN=null; $('#lvPick .lp-name').className='lp-name'; $('#lvPick .lp-name').textContent='🎲'; $('#lvPick .lp-plus').disabled=true;
    $('#lvPick').classList.add('open'); spin();
  }
  function spin(){
    if(spinning) return;
    const norep=$('#lvPick .lp-norep').checked;
    let pool=ids().filter(isOnline); if(!pool.length) pool=presentIds(); if(!pool.length) pool=ids();
    if(norep){ const left=pool.filter(n=>!st.picked.includes(n)); if(!left.length) st.picked=[]; else pool=left; }
    const win=pool[Math.floor(Math.random()*pool.length)], el=$('#lvPick .lp-name');
    spinning=true; $('#lvPick .lp-plus').disabled=true; sound.ac();
    let step=0; const steps=22;
    const tick=()=>{
      if(step<steps){
        el.className='lp-name spin'; el.textContent=st.roster[pool[Math.floor(Math.random()*pool.length)]]; sound.tick();
        step++; setTimeout(tick, 40+step*step*0.6);
      } else {
        spinning=false; pickN=win; el.textContent=st.roster[win]; retrigger(el,'win'); el.classList.remove('spin');
        sound.success(); const r=el.getBoundingClientRect(); confetti.burst(r.left+r.width/2, r.top+r.height/2, 90);
        $('#lvPick .lp-plus').disabled=false;
        if(norep){ st.picked.push(win); room.child('picked').set(st.picked); }
        room.child('pick').set({ n:+win, t:firebase.database.ServerValue.TIMESTAMP });
      }
    };
    tick();
  }

  /* ---------- «من أجابت؟» للأنشطة التي تُحل على السبورة ---------- */
  let awardT;
  function award(pts){
    if(!on) return;
    const s=slides[current].cfg;
    if(QUIZ.includes(s.type)){ if(s.type==='mcq') reveal(); return; }   // الأسئلة تُصحَّح تلقائيًا من إجابات الطالبات
    if(!ids().length) return;
    pts = pts || s.points || LESSON.defaultPoints || 1;
    const box=$('#lvAward'); $('.pts',box).textContent='+'+pts;
    let list=presentIds(); if(!list.length) list=ids();
    $('.aw-list',box).innerHTML=`<button class="rnd" data-r="1">🎲 قرعة</button>`+list.map(n=>`<button class="${isOnline(n)?'online':''}" data-n="${n}">${esc(st.roster[n])}</button>`).join('');
    $$('.aw-list button',box).forEach(b=>b.onclick=()=>{
      if(b.dataset.r){ box.classList.remove('open'); openPick(); return; }
      addBonus(b.dataset.n, pts); sound.ding();
      const r=b.getBoundingClientRect(); confetti.burst(r.left+r.width/2, r.top, 30);
      box.classList.remove('open');
    });
    box.classList.add('open'); clearTimeout(awardT); awardT=setTimeout(()=>box.classList.remove('open'),20000);
  }

  /* ==========================================================================
     📤 مزامنة الشريحة الحالية
     ========================================================================== */
  function publish(){
    if(!on) return;
    const i=current, s=slides[i].cfg, sk='s'+i, { q, k }=payload(i), rev=!!st.rev[sk];
    room.child('live').set(clean({ on:true, type:s.type, lesson:LESSON.id||'', ltitle:LESSON.title, teacher:tName, slide:i, total:slides.length,
      tag:strip(s.tag), title:strip(s.title||(s.type==='title'?LESSON.title:'')), q:q||null, reveal:rev, key:rev?k:null,
      t:firebase.database.ServerValue.TIMESTAMP }));
    drawDock();
  }

  function reveal(){
    const i=current, s=slides[i].cfg, sk='s'+i;
    if(!on || !QUIZ.includes(s.type) || st.rev[sk]) return;
    const { k }=payload(i), aw={};
    Object.entries(st.answers[sk]||{}).forEach(([n,a])=>{ if(!st.roster[n]) return; const g=grade(s,k,a&&a.v); if(g.p) aw[n]=g.p; });
    st.rev[sk]=true; st.awarded[sk]=aw;
    room.update({ [`awarded/${sk}`]:Object.keys(aw).length?aw:null, [`rev/${sk}`]:true, 'live/reveal':true, 'live/key':k });
    saveScores(); sound.success();
    // إظهار الإجابة على السبورة أيضًا
    if(s.type==='mcq'){ const b=$(`.opt[data-k="${s.answer}"]`, slides[i].el); b && !b.classList.contains('correct') && b.click(); }
    drawDock();
  }
  function resetQ(){
    const sk='s'+current;
    if(!confirm('إعادة السؤال؟ ستُمسح إجابات الطالبات ونقاطهن على هذا السؤال.')) return;
    delete st.rev[sk]; delete st.awarded[sk]; delete st.answers[sk];
    room.update({ [`answers/${sk}`]:null, [`awarded/${sk}`]:null, [`rev/${sk}`]:null, 'live/reveal':false, 'live/key':null });
    saveScores(); drawDock();
  }

  /* ---------- شريط الإجابات أسفل الشاشة ---------- */
  function drawDock(){
    const d=$('#lvDock'); if(!d) return;
    if(!on){ d.classList.remove('show'); return; }
    const i=current, s=slides[i].cfg, sk='s'+i, ans=st.answers[sk]||{}, who=Object.keys(ans).filter(n=>st.roster[n]);
    const online=ids().filter(isOnline).length;
    $$('.lv-cnt', slides[i].el).forEach(x=>x.remove());
    let html='';
    if(QUIZ.includes(s.type)){
      if(st.rev[sk]){
        const { k }=payload(i), right=who.filter(n=>{ const g=grade(s,k,ans[n].v); return g.c===g.n; }).length;
        html=`<span class="ok">✅ صحيحة <b>${right}</b> من ${who.length}</span><button class="lv-btn ghost sm" data-a="ans">👁 الإجابات</button><button class="lv-btn ghost sm" data-a="reset">↺ إعادة السؤال</button>`;
        if(s.type==='mcq'){
          const cnt={}; who.forEach(n=>{ cnt[ans[n].v]=(cnt[ans[n].v]||0)+1; });
          $$('.opt', slides[i].el).forEach(o=>{ const c=cnt[o.dataset.k]||0; o.insertAdjacentHTML('beforeend',`<span class="lv-cnt">${c}</span>`); });
        }
      } else {
        html=`<span>✍️ أجابت <b>${who.length}</b> / ${Math.max(online,who.length)}</span><button class="lv-btn ghost sm" data-a="ans">👁 الإجابات</button><button class="lv-btn sm" data-a="reveal">📣 كشف الإجابة</button>`;
      }
    } else if(s.type==='brainstorm'){
      html=`<span>💡 أفكار الطالبات: <b>${Object.keys(st.ideas[sk]||{}).length}</b></span><button class="lv-btn ghost sm" data-a="ans">👁 مَن كتبت ماذا؟</button>`;
    } else if(s.type==='groups'){
      const n=st.groups?Object.keys(st.groups.m||{}).filter(x=>st.roster[x]).length:0;
      html=`${n?`<span>👭 وُزّعت <b>${n}</b> طالبة</span>`:''}<button class="lv-btn sm" data-a="groups">🎲 ${n?'إعادة التوزيع':'توزيع الطالبات على المجموعات'}</button>`;
    } else if(s.type==='closing' && s.rating){
      const cnt={}; who.forEach(n=>{ cnt[ans[n].v]=(cnt[ans[n].v]||0)+1; });
      html=`<span>تقييم الطالبات:</span>`+s.rating.map((r,k)=>`<span>${r.e} <b>${cnt[k]||0}</b></span>`).join('')+`<button class="lv-btn ghost sm" data-a="ans">👁 التفاصيل</button>`;
    }
    d.innerHTML=html; d.classList.toggle('show',!!html);
    $$('button',d).forEach(b=>b.onclick=()=>({ reveal, reset:resetQ, groups:assignGroups, ans:openAns })[b.dataset.a]());
    if($('#lvAns.open')){ if(ansSlide===i) drawAns(); else $('#lvAns').classList.remove('open'); }
    if($('#lvDrawer.open') && ($('.dr-tabs .on')||{}).dataset?.tab==='res') drawDrawer();
  }

  /* ==========================================================================
     👁 إجابات الطالبات (لكل سؤال) — تتحدّث مباشرة أثناء الإجابة
     ========================================================================== */
  let ansSlide=null, ansAnon=false;
  function openAns(){ ansSlide=current; drawAns(); $('#lvAns').classList.add('open'); }

  // وصف إجابة طالبة بنص مختصر، مع علامات الصح والخطأ بعد الكشف
  function describe(i, v, rev){
    const s=slides[i].cfg, { q, k }=payload(i), mark=ok=>rev?(ok?'y':'n'):'';
    const chip=(ok,html)=>`<span class="ap ${mark(ok)}">${html}</span>`, cut=(t,m)=>{ t=strip(t); return t.length>m?t.slice(0,m)+'…':t; };
    if(s.type==='mcq'){ const o=q.options[+v]; return o?chip(+v===k.answer, `${o.icon} ${cut(o.t,60)}`):'—'; }
    if(s.type==='tf') return q.items.map((_,j)=>chip(v[j]===k.a[j], `${j+1} ${v[j]===1?'✔ صح':v[j]===0?'✖ خطأ':'—'}`)).join('');
    if(s.type==='sort') return q.items.map((it,j)=>{ const b=q.buckets.find(x=>x.key===v[j]); return chip(v[j]===k.b[j], `${it.icon||j+1} ${cut(it.t,26)} ← ${b?b.icon+' '+b.label:'—'}`); }).join('');
    if(s.type==='order') return (Array.isArray(v)?v:[]).map((j,p)=>chip(j===k.order[p], `${p+1}. ${q.items[j]?q.items[j].icon+' '+cut(q.items[j].t,22):'—'}`)).join('');
    if(s.type==='match') return q.a.map((t,j)=>chip(v[j]===k.m[j], `${cut(t,22)} ← ${q.b[v[j]]!=null?cut(q.b[v[j]],34):'—'}`)).join('');
    if(s.type==='closing'){ const r=(s.rating||[])[+v]; return r?`<span class="ap big">${r.e}</span>`:'—'; }
    return '—';
  }

  function drawAns(){
    const i=ansSlide; if(i==null || !slides[i]) return;
    const s=slides[i].cfg, sk='s'+i, rev=!!st.rev[sk], body=$('#lvAns .an-body');
    const nm=(n,x)=>ansAnon?`طالبة ${x+1}`:esc(st.roster[n]);
    $('#lvAns .an-t').textContent=`📋 إجابات الطالبات — ${strip(s.title||s.tag||'')}`;
    if(s.type==='brainstorm'){
      const by={}; Object.values(st.ideas[sk]||{}).forEach(it=>{ if(it&&it.t) (by[it.n]=by[it.n]||[]).push(it.t); });
      const who=Object.keys(by).filter(n=>st.roster[n]);
      $('#lvAns .an-sub').innerHTML=`💡 كتبت <b>${who.length}</b> طالبة • عدد الأفكار <b>${Object.keys(st.ideas[sk]||{}).length}</b>`;
      body.innerHTML=who.length?who.map((n,x)=>`<div class="an-row"><span class="an-nm">${nm(n,x)}</span><span class="an-v">${by[n].map(t=>`<span class="ap">${esc(t)}</span>`).join('')}</span></div>`).join('')
        :'<div class="dr-empty">لم تصل أفكار بعد…</div>';
      return;
    }
    const ans=st.answers[sk]||{}, who=ids().filter(n=>ans[n]), { k }=payload(i);
    const g=n=>QUIZ.includes(s.type)?grade(s,k,ans[n].v):null;
    // بعد الكشف نعرض الخطأ أولًا ليسهل على المعلمة متابعة من تحتاج مساعدة
    const order=rev?who.slice().sort((a,b)=>{ const A=g(a),B=g(b); return A.c/A.n-B.c/B.n; }):who;
    const missing=presentIds().filter(n=>!ans[n]);
    const right=rev?who.filter(n=>{ const x=g(n); return x.c===x.n; }).length:null;
    $('#lvAns .an-sub').innerHTML=`✍️ أجابت <b>${who.length}</b> من ${Math.max(presentIds().length,who.length)}`+(rev&&QUIZ.includes(s.type)?` • ✅ إجابة كاملة <b>${right}</b> • ❌ تحتاج مراجعة <b>${who.length-right}</b>`:QUIZ.includes(s.type)?' • تظهر علامات التصحيح بعد «كشف الإجابة»':'');
    body.innerHTML=(order.length?order.map((n,x)=>{ const r=g(n);
        return `<div class="an-row ${rev&&r?(r.c===r.n?'ok':r.c?'mid':'bad'):''}"><span class="an-nm">${nm(n,x)}</span><span class="an-v">${describe(i,ans[n].v,rev)}</span>${rev&&r&&r.n>1?`<span class="an-sc">${r.c}/${r.n}</span>`:''}</div>`; }).join('')
        :'<div class="dr-empty">لم تصل إجابات بعد… ⏳</div>')
      +(missing.length?`<div class="an-miss"><b>⏳ لم تُجب بعد (${missing.length}):</b> ${missing.map((n,x)=>`<span>${ansAnon?'•':esc(st.roster[n])}</span>`).join('')}</div>`:'');
  }

  /* ---------- 📊 النتائج: ملخص كل الأسئلة لكل طالبة ---------- */
  function quizSlides(){ return slides.map((sl,i)=>i).filter(i=>QUIZ.includes(slides[i].cfg.type) && (st.rev['s'+i] || Object.keys(st.answers['s'+i]||{}).length)); }
  function results(){
    const qs=quizSlides(), t=totals();
    return { qs, rows:ids().map(n=>{
      let answered=0, right=0; const cells=qs.map(i=>{ const a=(st.answers['s'+i]||{})[n]; if(!a) return '';
        answered++; if(!st.rev['s'+i]) return 'أجابت'; const s=slides[i].cfg, r=grade(s,payload(i).k,a.v); if(r.c===r.n) right++; return `${r.c}/${r.n}`; });
      return { n, name:st.roster[n], answered, right, pts:t[n]||0, present:isPresent(n), cells };
    }) };
  }
  function downloadCSV(){
    const { qs, rows }=results(), q=x=>`"${String(x).replace(/"/g,'""')}"`;
    const head=['الرقم','الاسم','الحضور',...qs.map(i=>`ش${i+1}: ${strip(slides[i].cfg.title||'')}`),'أجابت','إجابات كاملة','النقاط'];
    const lines=[head.map(q).join(','), ...rows.map(r=>[r.n,r.name,r.present?'حاضرة':'غائبة',...r.cells,r.answered,r.right,r.pts].map(q).join(','))];
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\r\n')],{ type:'text/csv;charset=utf-8' }));
    a.download=`نتائج ${LESSON.title} - ${code} - ${today()}.csv`; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
  }

  /* ---------- التعلم التعاوني: توزيع عشوائي ---------- */
  function assignGroups(){
    const s=slides[current].cfg, G0=(s.groups||[]).length; if(!G0) return;
    let list=ids().filter(isOnline); if(!list.length) list=presentIds(); if(!list.length) list=ids();
    if(!list.length){ openDrawer(); return; }
    if(st.groups && !confirm('إعادة توزيع الطالبات عشوائيًا؟')) return;
    list=shuffle(list.slice());
    const G=Math.min(G0, Math.max(1, Math.floor(list.length/2))), m={};
    list.forEach((n,k)=>m[n]=k%G);
    st.groups={ G, m }; room.child('groups').set(st.groups);
    sound.success(); drawGroups(); drawDock();
  }
  function drawGroups(){
    slides.forEach(sl=>{
      if(sl.cfg.type!=='groups') return;
      $$('.fc-wrap', sl.el).forEach((w,g)=>{
        const names=st.groups ? Object.entries(st.groups.m||{}).filter(([n,x])=>x===g && st.roster[n]).map(([n])=>first(st.roster[n])) : [];
        const mem=$('.fc-mem',w); mem && (mem.innerHTML=names.map(x=>`<span>${esc(x)}</span>`).join(''));
        w.classList.toggle('off', !!st.groups && g>=st.groups.G);
      });
    });
  }

  /* ---------- أفكار العصف الذهني من الآيباد ---------- */
  function drawIdeas(){
    Object.entries(st.ideas).forEach(([sk,list])=>{
      const sl=slides[+sk.slice(1)]; if(!sl || !sl.el._addIdea) return;
      Object.entries(list||{}).forEach(([key,it])=>{ if(seenIdeas.has(key)) return; seenIdeas.add(key); it && it.t && sl.el._addIdea(String(it.t).slice(0,28)); });
    });
  }

  /* ==========================================================================
     🔐 الدخول والحصة
     ========================================================================== */
  async function login(c, pin){
    const err=$('.lg-err');
    if(!c || !pin){ err.textContent='اكتبي الرمز والرقم السري'; return; }
    err.textContent='⏳ جارٍ الدخول…'; $('#lvGo').disabled=true;
    try{
      await db.ref(`staff/${c}/${uid}`).set(pin);
      LS.set('lv_code', c); $('#lvLogin').classList.remove('open'); await enter(c);
    }catch(e){ err.textContent='❌ الرمز أو الرقم السري غير صحيح'; sound.wrong(); }
    $('#lvGo').disabled=false;
  }

  async function enter(c){
    code=c; room=db.ref('rooms/'+c);
    tName=(await db.ref(`teachers/${c}/name`).get()).val()||'';
    const all=(await room.get()).val()||{}, sess=all.session||{};
    st.roster=obj(all.roster);
    if(sess.lesson!==(LESSON.id||'') || sess.date!==today()) await newSession(false);
    else {
      st.awarded={}; Object.entries(obj(all.awarded)).forEach(([k,v])=>st.awarded[k]=obj(v)); st.bonus=obj(all.bonus); st.rev=obj(all.rev); st.groups=all.groups?{ G:all.groups.G, m:obj(all.groups.m) }:null;
      st.picked=Object.values(obj(all.picked)).map(String);
    }
    on=true;
    room.child('live/on').onDisconnect().set(false);

    room.child('roster').on('value', s=>{ st.roster=obj(s.val()); drawDrawer(); drawDock(); drawGroups(); });
    room.child('att/'+today()).on('value', s=>{ st.att=obj(s.val()); drawDrawer(); });
    room.child('presence').on('value', s=>{
      const v=obj(s.val()); st.online={};
      Object.keys(v).forEach(n=>st.online[n]=true);
      // تحضير تلقائي عند دخول الطالبة من الآيباد
      Object.keys(st.online).forEach(n=>{ if(st.roster[n] && !st.att[n]){ st.att[n]=true; room.child(`att/${today()}/${n}`).set(true); } });
      drawDrawer(); drawDock();
    });
    room.child('answers').on('value', s=>{ st.answers={}; Object.entries(obj(s.val())).forEach(([k,v])=>st.answers[k]=obj(v)); drawDock(); });
    room.child('ideas').on('value', s=>{ st.ideas=obj(s.val()); drawIdeas(); drawDock(); });

    publish(); saveScores(); drawGroups(); drawJoin(); drawChip();
    if(!ids().length){ openDrawer(); $$('.dr-tabs button')[1].click(); }
  }

  async function newSession(ask){
    if(ask && !confirm('بدء حصة جديدة؟\nستُمسح إجابات ونقاط الحصة الحالية (تبقى الأسماء والتحضير).')) return;
    await room.update({ answers:null, ideas:null, awarded:null, bonus:null, scores:null, rev:null, groups:null, pick:null, picked:null,
      session:{ lesson:LESSON.id||'', date:today(), t:firebase.database.ServerValue.TIMESTAMP } });
    if(ask) location.reload();
  }

  async function logout(){
    if(!confirm('تسجيل الخروج من هذا الجهاز؟')) return;
    try{ await room.child('live/on').set(false); await db.ref(`staff/${code}/${uid}`).remove(); }catch(e){}
    LS.set('lv_code', null); location.reload();
  }

  /* ---------- التشغيل ---------- */
  function init(){
    build(); drawChip();
    if(typeof firebase==='undefined' || !window.FIREBASE_CONFIG){ console.warn('Firebase غير متاح — العرض يعمل بدون الطالبات'); return; }
    try{ firebase.apps.length || firebase.initializeApp(window.FIREBASE_CONFIG); db=firebase.database(); }catch(e){ console.warn(e); return; }
    const un=firebase.auth().onAuthStateChanged(async u=>{
      if(!u){ firebase.auth().signInAnonymously().catch(e=>{ console.warn(e); }); return; }
      un(); uid=u.uid;
      const saved=LS.get('lv_code');
      if(saved){
        // إن كان هذا الجهاز مسجّلًا مسبقًا ندخل مباشرة دون الرقم السري
        try{ await db.ref(`rooms/${saved}/live/on`).set(true); await enter(saved); return; }catch(e){}
      }
      openLogin();
    });
  }

  return {
    init, award, ranking,
    slide(){ if(on) publish(); },
    get on(){ return on; }
  };
})();
