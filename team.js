(() => {
  'use strict';
  const SB_URL = 'https://epislkcmkneyqmonzias.supabase.co';
  const SB_KEY = 'sb_publishable_iLzGnNdv5eTCVKaCnbFTzg_mQV_37xp';
  const sb = window.supabase?.createClient(SB_URL, SB_KEY, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------------- i18n (ar / fr / en, same storage key as the main site) ---------------- */
  const LANGS = ['ar', 'fr', 'en'];
  const LOCALE = { ar: 'ar-DZ', fr: 'fr-DZ', en: 'en-US' };
  const CUR = { ar: 'دج', fr: 'DA', en: 'DZD' };
  const I18N = {
    ar: {
      brandSub: 'مساحة الفريق', back: 'العودة إلى مِداد', signout: 'خروج', theme: 'تبديل المظهر',
      heroTitle: 'مساحة الفريق', heroDesc: 'مساحة جماعية للاشتراك والرصيد والمكتبة، مع بقاء حساب كل عضو ومحادثاته الخاصة منفصلة.',
      authTitle: 'سجّل الدخول أولًا', authDesc: 'ادخل إلى حسابك الشخصي في مِداد، ثم افتح مساحة الفريق من جديد.', authBtn: 'الذهاب إلى تسجيل الدخول',
      createTitle: 'أنشئ مساحة فريق', createDesc: 'أنت المسؤول عن الدعوات وإدارة الأعضاء والاشتراك الجماعي.', teamName: 'اسم الفريق', teamNamePh: 'مثال: فريق الدراسة', goalLabel: 'هدف جمع الاشتراك (دج)', createBtn: 'إنشاء مساحة الفريق',
      joinTitle: 'انضم إلى فريق', joinDesc: 'أدخل رمز الدعوة الذي شاركه معك مسؤول الفريق.', inviteCode: 'رمز الدعوة', joinBtn: 'الانضمام إلى الفريق',
      statBalance: 'الرصيد الجماعي', statMembers: 'عدد الأعضاء', statMembersSub: 'حسابات منفصلة', statAi: 'نشاط الذكاء الاصطناعي', statAiSub: 'استخدام في الفترة المختارة', goalOf: 'من هدف {goal}',
      fundTitle: 'صندوق الاشتراك', fundDesc: 'تُخصم مساهمتك من محفظتك الشخصية وتُضاف إلى رصيد الفريق بشكل آمن.', contributeLabel: 'مبلغ المساهمة (دج)', contributeBtn: 'المساهمة من محفظتي',
      fundPrivacy: 'لا يمكن للأعضاء رؤية رصيد محفظتك الشخصي أو مشترياتك الخاصة.', fundReached: 'تم بلوغ هدف الاشتراك', fundRemaining: 'المتبقي للهدف: {amount}', percentOf: '{p}%',
      recentTitle: 'آخر المساهمات',
      membersTitle: 'الأعضاء والدعوات', roleOwner: 'مسؤول الفريق', roleMember: 'عضو', uses: '{n} استخدام', copyCode: 'نسخ الرمز', copyLink: 'نسخ رابط الدعوة', regen: 'تغيير الرمز', inviteShared: 'رمز الدعوة يشاركه مسؤول الفريق.', remove: 'إزالة', leave: 'مغادرة الفريق', you: 'أنت',
      libTitle: 'مكتبة الفريق', libDesc: 'شارك أوراقك المدفوعة مع الفريق. لا تظهر مشترياتك الخاصة للأعضاء إلا بعد اختيارك لها.', libEmpty: 'المكتبة المشتركة فارغة بعد.', libPick: 'اختر ورقة من أوراقك المدفوعة لمشاركتها', libAdd: 'أضف إلى مكتبة الفريق', libLoading: 'جارٍ تحميل أوراقك…', libNoPurchases: 'لا توجد أوراق مدفوعة متاحة للمشاركة بعد.', libPickFirst: 'اختر ورقة من القائمة أولًا.', libDoc: 'وثيقة', libLoadErr: 'تعذّر تحميل المكتبة المشتركة.', purchasesErr: 'تعذّر تحميل مشترياتك.',
      actTitle: 'استهلاك الفريق', monthCurrent: 'هذا الشهر', monthPrev: 'الشهر الماضي', colMember: 'العضو', colUses: 'استخدامات الذكاء الاصطناعي', colUnits: 'الوحدات', actEmpty: 'لا يوجد استهلاك في هذه الفترة.',
      confirmOk: 'تأكيد', confirmCancel: 'إلغاء', confirmRegen: 'تغيير الرمز الحالي؟ سيتوقف الرمز القديم عن العمل.', confirmRemove: 'إزالة هذا العضو من الفريق؟', confirmLeave: 'هل تريد مغادرة الفريق؟', confirmRemoveDoc: 'إزالة الوثيقة من مكتبة الفريق؟',
      tCopied: 'تم النسخ.', tCopyFail: 'تعذّر النسخ؛ انسخ الرمز يدويًا.', tCodeNew: 'تم تحديث رمز الدعوة.', tCreated: 'تم إنشاء مساحة الفريق.', tJoined: 'انضممت إلى الفريق بنجاح.', tContributed: 'تمت المساهمة من محفظتك الشخصية.', tLeft: 'غادرت الفريق.', tDocAdded: 'تمت إضافة الورقة إلى مكتبة الفريق.',
      e_generic: 'تعذّر تنفيذ العملية.', e_secure: 'تعذّر تحميل الاتصال الآمن.', e_auth_required: 'سجّل الدخول أولًا.', e_already_in_team: 'أنت عضو في فريق بالفعل.', e_invalid_invite_code: 'رمز الدعوة غير صحيح.', e_team_full: 'الفريق ممتلئ.', e_insufficient_wallet: 'رصيد محفظتك لا يكفي لهذه المساهمة.', e_not_in_team: 'لا تنتمي إلى فريق.', e_not_owner: 'هذا الإجراء للمسؤول فقط.', e_bad_name: 'اسم الفريق يجب أن يكون بين حرفين و100 حرف.', e_bad_goal: 'هدف الجمع يجب أن يكون بين 100 و10,000,000.', e_bad_contribution: 'المساهمة يجب أن تكون بين 50 و1,000,000.', e_too_many_attempts: 'محاولات كثيرة. أعد المحاولة لاحقًا.',
      footer: 'مِداد — تعاون جماعي، وخصوصية شخصية.'
    },
    fr: {
      brandSub: 'Espace équipe', back: 'Retour à Medad', signout: 'Déconnexion', theme: 'Changer de thème',
      heroTitle: 'Espace équipe', heroDesc: 'Un espace collectif pour l’abonnement, le solde et la bibliothèque, tout en gardant séparés le compte et les discussions de chaque membre.',
      authTitle: 'Connectez-vous d’abord', authDesc: 'Connectez-vous à votre compte Medad, puis rouvrez l’espace équipe.', authBtn: 'Aller à la connexion',
      createTitle: 'Créer un espace équipe', createDesc: 'Vous gérez les invitations, les membres et l’abonnement collectif.', teamName: 'Nom de l’équipe', teamNamePh: 'Ex. : Équipe d’étude', goalLabel: 'Objectif de collecte (DA)', createBtn: 'Créer l’espace équipe',
      joinTitle: 'Rejoindre une équipe', joinDesc: 'Saisissez le code d’invitation partagé par le responsable de l’équipe.', inviteCode: 'Code d’invitation', joinBtn: 'Rejoindre l’équipe',
      statBalance: 'Solde collectif', statMembers: 'Membres', statMembersSub: 'Comptes séparés', statAi: 'Activité IA', statAiSub: 'Utilisations sur la période', goalOf: 'sur un objectif de {goal}',
      fundTitle: 'Fonds d’abonnement', fundDesc: 'Votre contribution est débitée de votre portefeuille personnel et ajoutée au solde de l’équipe en toute sécurité.', contributeLabel: 'Montant de la contribution (DA)', contributeBtn: 'Contribuer depuis mon portefeuille',
      fundPrivacy: 'Les membres ne voient ni le solde de votre portefeuille ni vos achats privés.', fundReached: 'Objectif d’abonnement atteint', fundRemaining: 'Reste à collecter : {amount}', percentOf: '{p} %',
      recentTitle: 'Dernières contributions',
      membersTitle: 'Membres et invitations', roleOwner: 'Responsable', roleMember: 'Membre', uses: '{n} utilisation(s)', copyCode: 'Copier le code', copyLink: 'Copier le lien d’invitation', regen: 'Changer le code', inviteShared: 'Le code d’invitation est partagé par le responsable de l’équipe.', remove: 'Retirer', leave: 'Quitter l’équipe', you: 'Vous',
      libTitle: 'Bibliothèque de l’équipe', libDesc: 'Partagez vos documents payés avec l’équipe. Vos achats privés ne sont visibles que si vous les choisissez.', libEmpty: 'La bibliothèque partagée est encore vide.', libPick: 'Choisissez un document payé à partager', libAdd: 'Ajouter à la bibliothèque', libLoading: 'Chargement de vos documents…', libNoPurchases: 'Aucun document payé disponible pour le partage.', libPickFirst: 'Choisissez d’abord un document dans la liste.', libDoc: 'Document', libLoadErr: 'Impossible de charger la bibliothèque partagée.', purchasesErr: 'Impossible de charger vos achats.',
      actTitle: 'Consommation de l’équipe', monthCurrent: 'Ce mois-ci', monthPrev: 'Mois dernier', colMember: 'Membre', colUses: 'Utilisations IA', colUnits: 'Unités', actEmpty: 'Aucune consommation sur cette période.',
      confirmOk: 'Confirmer', confirmCancel: 'Annuler', confirmRegen: 'Changer le code actuel ? L’ancien code cessera de fonctionner.', confirmRemove: 'Retirer ce membre de l’équipe ?', confirmLeave: 'Voulez-vous quitter l’équipe ?', confirmRemoveDoc: 'Retirer ce document de la bibliothèque de l’équipe ?',
      tCopied: 'Copié.', tCopyFail: 'Copie impossible ; copiez le code manuellement.', tCodeNew: 'Code d’invitation mis à jour.', tCreated: 'Espace équipe créé.', tJoined: 'Vous avez rejoint l’équipe.', tContributed: 'Contribution prélevée sur votre portefeuille.', tLeft: 'Vous avez quitté l’équipe.', tDocAdded: 'Document ajouté à la bibliothèque de l’équipe.',
      e_generic: 'L’opération a échoué.', e_secure: 'Impossible de charger la connexion sécurisée.', e_auth_required: 'Connectez-vous d’abord.', e_already_in_team: 'Vous êtes déjà membre d’une équipe.', e_invalid_invite_code: 'Code d’invitation invalide.', e_team_full: 'L’équipe est complète.', e_insufficient_wallet: 'Le solde de votre portefeuille est insuffisant.', e_not_in_team: 'Vous n’appartenez à aucune équipe.', e_not_owner: 'Action réservée au responsable.', e_bad_name: 'Le nom doit comporter entre 2 et 100 caractères.', e_bad_goal: 'L’objectif doit être compris entre 100 et 10 000 000.', e_bad_contribution: 'La contribution doit être comprise entre 50 et 1 000 000.', e_too_many_attempts: 'Trop de tentatives. Réessayez plus tard.',
      footer: 'Medad — collaboration d’équipe, vie privée préservée.'
    },
    en: {
      brandSub: 'Team workspace', back: 'Back to Medad', signout: 'Sign out', theme: 'Toggle theme',
      heroTitle: 'Team workspace', heroDesc: 'A shared space for the subscription, balance and library, while each member’s account and chats stay separate.',
      authTitle: 'Sign in first', authDesc: 'Sign in to your Medad account, then open the team workspace again.', authBtn: 'Go to sign in',
      createTitle: 'Create a team workspace', createDesc: 'You manage invitations, members and the shared subscription.', teamName: 'Team name', teamNamePh: 'e.g. Study team', goalLabel: 'Subscription goal (DZD)', createBtn: 'Create team workspace',
      joinTitle: 'Join a team', joinDesc: 'Enter the invite code shared by the team owner.', inviteCode: 'Invite code', joinBtn: 'Join team',
      statBalance: 'Shared balance', statMembers: 'Members', statMembersSub: 'Separate accounts', statAi: 'AI activity', statAiSub: 'Uses in the selected period', goalOf: 'of a {goal} goal',
      fundTitle: 'Subscription fund', fundDesc: 'Your contribution is debited from your personal wallet and added securely to the team balance.', contributeLabel: 'Contribution amount (DZD)', contributeBtn: 'Contribute from my wallet',
      fundPrivacy: 'Members cannot see your personal wallet balance or private purchases.', fundReached: 'Subscription goal reached', fundRemaining: 'Left to reach the goal: {amount}', percentOf: '{p}%',
      recentTitle: 'Recent contributions',
      membersTitle: 'Members and invitations', roleOwner: 'Team owner', roleMember: 'Member', uses: '{n} use(s)', copyCode: 'Copy code', copyLink: 'Copy invite link', regen: 'Change code', inviteShared: 'The invite code is shared by the team owner.', remove: 'Remove', leave: 'Leave team', you: 'You',
      libTitle: 'Team library', libDesc: 'Share your paid documents with the team. Your private purchases stay hidden unless you choose them.', libEmpty: 'The shared library is empty for now.', libPick: 'Choose a paid document to share', libAdd: 'Add to team library', libLoading: 'Loading your documents…', libNoPurchases: 'No paid documents available to share yet.', libPickFirst: 'Pick a document from the list first.', libDoc: 'Document', libLoadErr: 'Could not load the shared library.', purchasesErr: 'Could not load your purchases.',
      actTitle: 'Team usage', monthCurrent: 'This month', monthPrev: 'Last month', colMember: 'Member', colUses: 'AI uses', colUnits: 'Units', actEmpty: 'No usage in this period.',
      confirmOk: 'Confirm', confirmCancel: 'Cancel', confirmRegen: 'Change the current code? The old code will stop working.', confirmRemove: 'Remove this member from the team?', confirmLeave: 'Do you want to leave the team?', confirmRemoveDoc: 'Remove this document from the team library?',
      tCopied: 'Copied.', tCopyFail: 'Copy failed; please copy the code manually.', tCodeNew: 'Invite code updated.', tCreated: 'Team workspace created.', tJoined: 'You joined the team.', tContributed: 'Contribution taken from your personal wallet.', tLeft: 'You left the team.', tDocAdded: 'Document added to the team library.',
      e_generic: 'Something went wrong.', e_secure: 'Could not load the secure connection.', e_auth_required: 'Please sign in first.', e_already_in_team: 'You are already in a team.', e_invalid_invite_code: 'Invalid invite code.', e_team_full: 'The team is full.', e_insufficient_wallet: 'Your wallet balance is not enough.', e_not_in_team: 'You do not belong to a team.', e_not_owner: 'Only the owner can do this.', e_bad_name: 'The name must be 2 to 100 characters.', e_bad_goal: 'The goal must be between 100 and 10,000,000.', e_bad_contribution: 'The contribution must be between 50 and 1,000,000.', e_too_many_attempts: 'Too many attempts. Try again later.',
      footer: 'Medad — team collaboration, personal privacy.'
    }
  };

  let lang = 'ar';
  try { const l = localStorage.getItem('medad-lang'); if (LANGS.includes(l)) lang = l; } catch (_) { /* storage blocked */ }
  const T = (k, vars) => {
    let s = (I18N[lang] && I18N[lang][k]) || I18N.ar[k] || k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b);
    return s;
  };
  const num = (n) => Number(n || 0).toLocaleString(LOCALE[lang]);
  const money = (n) => `${num(n)} ${CUR[lang]}`;

  /* ---------------- state ---------------- */
  let user = null, teamData = null, members = [], docs = [], contribs = [], purchases = [], purchasesError = false;
  let selectedDoc = '', month = 'current', purchasesLoading = false;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  let contribRequestId = newId();

  /* ---------------- small helpers ---------------- */
  function toast(message, type = 'success') {
    const box = $('#team-toast'); if (!box || !message) return;
    const el = document.createElement('div'); el.className = type; el.textContent = message; box.append(el);
    setTimeout(() => el.remove(), 4200);
  }
  function errText(e) {
    const code = String(e?.message || e || '').trim();
    const key = 'e_' + code;
    return I18N[lang][key] || I18N.ar[key] ? T(key) : T('e_generic');
  }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(label, cls, onClick) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
  function initial(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }
  function askConfirm(text, okLabel) {
    return new Promise((resolve) => {
      const d = $('#team-confirm');
      $('#team-confirm-text').textContent = text;
      $('#team-confirm-ok').textContent = okLabel || T('confirmOk');
      $('#team-confirm-cancel').textContent = T('confirmCancel');
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
      d.showModal();
    });
  }
  async function withBusy(btn, fn) { if (btn) btn.disabled = true; try { return await fn(); } finally { if (btn) btn.disabled = false; } }
  const icons = () => { try { window.lucide?.createIcons(); } catch (_) { /* icons are optional */ } };

  /* ---------------- static text, language and theme ---------------- */
  function applyStatic() {
    const h = document.documentElement; h.lang = lang; h.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = `${T('heroTitle')} | مِداد`;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = T(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = T(n.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach((n) => { const v = T(n.dataset.i18nTitle); n.title = v; n.setAttribute('aria-label', v); });
    const box = $('#team-lang'); box.replaceChildren();
    LANGS.forEach((l) => {
      const b = el('button', 'seg-chip' + (l === lang ? ' active' : ''), l.toUpperCase()); b.type = 'button'; b.setAttribute('aria-pressed', String(l === lang));
      b.addEventListener('click', () => { if (l === lang) return; lang = l; try { localStorage.setItem('medad-lang', l); } catch (_) { /* ignore */ } applyStatic(); renderAll(); });
      box.append(b);
    });
    renderMonthChips(); renderQuickAmounts();
    $('#team-theme').innerHTML = `<i data-lucide="${h.dataset.theme === 'dark' ? 'sun' : 'moon'}"></i>`;
    icons();
  }
  $('#team-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('medad-theme', next); } catch (_) { /* ignore */ }
    const holder = $('#team-theme'); holder.innerHTML = `<i data-lucide="${next === 'dark' ? 'sun' : 'moon'}"></i>`; icons();
  });

  function renderMonthChips() {
    const box = $('#team-month-chips'); box.replaceChildren();
    [['current', 'monthCurrent'], ['previous', 'monthPrev']].forEach(([v, k]) => {
      const b = el('button', 'seg-chip' + (month === v ? ' active' : ''), T(k)); b.type = 'button'; b.setAttribute('aria-pressed', String(month === v));
      b.addEventListener('click', async () => { if (month === v) return; month = v; renderMonthChips(); await loadSummary(); });
      box.append(b);
    });
  }
  function renderQuickAmounts() {
    const box = $('#team-quick-amounts'); box.replaceChildren();
    [100, 500, 1000, 2000].forEach((a) => {
      const b = el('button', 'seg-chip', money(a)); b.type = 'button';
      b.addEventListener('click', () => { $('#team-contribute-amount').value = a; });
      box.append(b);
    });
  }

  /* ---------------- data ---------------- */
  function monthRange() {
    const n = new Date(); if (month === 'previous') n.setMonth(n.getMonth() - 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  }
  function showOnly(which) {
    $('#team-loading').hidden = which !== 'loading';
    $('#team-auth-required').hidden = which !== 'auth';
    $('#team-no-team').hidden = which !== 'none';
    $('#team-dashboard').hidden = which !== 'team';
  }
  async function boot() {
    applyStatic();
    if (!sb) { showOnly('auth'); toast(T('e_secure'), 'error'); return; }
    const { data: { session } } = await sb.auth.getSession();
    user = session?.user || null;
    if (!user) { showOnly('auth'); return; }
    $('#team-signout').hidden = false; $('#team-user-label').textContent = user.email || '';
    const joinCode = new URLSearchParams(location.search).get('join');
    if (joinCode) $('#team-code').value = joinCode.toUpperCase().slice(0, 16);
    await load();
  }
  async function load() { await loadSummary(); if (teamData?.team) await loadExtras(); }
  async function loadSummary() {
    const { data, error } = await sb.rpc('medad_team_summary', { p_month: monthRange() });
    if (error) { showOnly(String(error.message || '') === 'auth_required' ? 'auth' : ''); toast(errText(error), 'error'); return; }
    teamData = data; members = Array.isArray(data?.usage) ? data.usage : [];
    showOnly(data?.team ? 'team' : 'none');
    renderAll();
  }
  async function loadExtras() {
    purchasesLoading = true; renderPicker();
    const [d, c, p] = await Promise.all([
      sb.rpc('medad_team_documents_list').then((r) => r, (e) => ({ error: e })),
      sb.rpc('medad_team_contributions_list', { p_limit: 12 }).then((r) => r, (e) => ({ error: e })),
      sb.from('orders').select('document_id,documents(id,title)').eq('user_id', user.id).eq('status', 'paid').not('document_id', 'is', null).then((r) => r, (e) => ({ error: e }))
    ]);
    docs = d.error ? null : (Array.isArray(d.data) ? d.data : (d.data?.documents || []));
    contribs = c.error || !Array.isArray(c.data) ? null : c.data;
    purchasesError = Boolean(p.error); purchasesLoading = false;
    const seen = new Set(); purchases = [];
    (p.data || []).forEach((o) => { const x = o.documents; if (x && !seen.has(x.id)) { seen.add(x.id); purchases.push({ id: x.id, title: x.title }); } });
    renderLibrary(); renderContribs(); renderPicker();
  }

  /* ---------------- rendering ---------------- */
  function renderAll() {
    if (!teamData?.team) return;
    renderStats(); renderInvite(); renderMembers(); renderReport(); renderLibrary(); renderContribs(); renderPicker();
  }
  function renderStats() {
    const t = teamData.team, balance = Number(t.shared_balance || 0), goal = Number(t.subscription_goal || 1000);
    const pct = Math.min(100, Math.floor(100 * balance / Math.max(1, goal))), done = balance >= goal;
    $('#team-name-title').textContent = t.name || '';
    $('#team-role-badge').textContent = t.is_owner ? T('roleOwner') : T('roleMember');
    $('#team-balance').textContent = money(balance);
    $('#team-goal-caption').textContent = T('goalOf', { goal: money(goal) });
    $('#team-member-count').textContent = num(members.length);
    $('#team-ai-count').textContent = num(members.reduce((n, m) => n + Number(m.generations || 0), 0));
    $('#team-percent').textContent = T('percentOf', { p: num(pct) });
    $('#team-remaining').textContent = done ? T('fundReached') : T('fundRemaining', { amount: money(goal - balance) });
    const bar = $('#team-progress'); bar.classList.toggle('is-done', done); bar.setAttribute('aria-valuenow', String(pct));
    $('#team-progress-bar').style.width = pct + '%';
  }
  function renderInvite() {
    const t = teamData.team, area = $('#team-invite-area'); area.replaceChildren();
    if (t.is_owner && t.invite_code) {
      const row = el('div', 'team-invite-code'); row.append(el('b', '', t.invite_code)); area.append(row);
      const actions = el('div', 'team-invite-actions');
      const copy = (text) => navigator.clipboard.writeText(text).then(() => toast(T('tCopied'))).catch(() => toast(T('tCopyFail'), 'error'));
      actions.append(
        button(T('copyCode'), 'team-mini', () => copy(t.invite_code)),
        button(T('copyLink'), 'team-mini', () => copy(`${location.origin}${location.pathname}?join=${encodeURIComponent(t.invite_code)}`)),
        button(T('regen'), 'team-mini', async () => {
          if (!(await askConfirm(T('confirmRegen')))) return;
          const { error } = await sb.rpc('medad_team_regenerate_code');
          if (error) toast(errText(error), 'error'); else { toast(T('tCodeNew')); await loadSummary(); }
        })
      );
      area.append(actions);
    } else {
      area.append(el('p', 'team-muted', T('inviteShared')));
    }
  }
  function renderMembers() {
    const t = teamData.team, box = $('#team-members'); box.replaceChildren();
    members.forEach((m) => {
      const row = el('div', 'team-row'); const name = m.member_name || T('roleMember');
      row.append(el('div', 'team-avatar', initial(name)));
      const info = el('div', 'grow'); const strong = el('strong', '', name + (m.user_id === user.id ? ` · ${T('you')}` : ''));
      info.append(strong, el('small', '', `${m.role === 'owner' ? T('roleOwner') : T('roleMember')} · ${T('uses', { n: num(m.generations) })}`));
      row.append(info);
      if (t.is_owner && m.user_id !== user.id) {
        row.append(button(T('remove'), 'team-mini danger', async () => {
          if (!(await askConfirm(T('confirmRemove'), T('remove')))) return;
          const { error } = await sb.rpc('medad_team_remove_member', { p_user: m.user_id });
          if (error) toast(errText(error), 'error'); else await loadSummary();
        }));
      }
      box.append(row);
    });
    $('#team-leave').textContent = T('leave');
  }
  function renderReport() {
    const box = $('#team-report'); box.replaceChildren();
    const rows = members.filter((m) => Number(m.generations || 0) > 0 || Number(m.units || 0) > 0);
    if (!rows.length) { box.append(el('div', 'team-empty', T('actEmpty'))); return; }
    const head = el('div', 'team-report-head'); head.append(el('span', '', T('colMember')), el('span', '', T('colUses')), el('span', '', T('colUnits'))); box.append(head);
    const max = Math.max(1, ...rows.map((m) => Number(m.generations || 0)));
    rows.forEach((m) => {
      const r = el('div', 'team-usage-row'); r.append(el('div', 'team-usage-name', m.member_name || T('roleMember')));
      const bar = el('div', 'team-bar'); const fill = el('span'); fill.style.width = Math.round(100 * Number(m.generations || 0) / max) + '%'; bar.append(fill); r.append(bar);
      r.append(el('div', 'team-usage-num', `${num(m.generations)} · ${num(m.units)}`)); box.append(r);
    });
  }
  function renderLibrary() {
    const box = $('#team-library'); box.replaceChildren();
    if (docs === null) { box.append(el('div', 'team-empty', T('libLoadErr'))); return; }
    if (!docs.length) { box.append(el('div', 'team-empty', T('libEmpty'))); return; }
    docs.forEach((d) => {
      const row = el('div', 'team-row'); row.append(el('div', 'team-avatar', initial(d.title || d.document_title || T('libDoc'))));
      const info = el('div', 'grow'); info.append(el('strong', '', d.title || d.document_title || T('libDoc'))); row.append(info);
      if (teamData?.team?.is_owner || d.added_by === user.id) {
        row.append(button(T('remove'), 'team-mini danger', async () => {
          if (!(await askConfirm(T('confirmRemoveDoc'), T('remove')))) return;
          const { error } = await sb.rpc('medad_team_document_remove', { p_id: d.id });
          if (error) toast(errText(error), 'error'); else await loadExtras();
        }));
      }
      box.append(row);
    });
  }
  function renderContribs() {
    const wrap = $('#team-contribs-wrap'), box = $('#team-contribs');
    if (!contribs || !contribs.length) { wrap.hidden = true; return; }
    wrap.hidden = false; box.replaceChildren();
    contribs.forEach((c) => {
      const row = el('div', 'team-row'); row.append(el('div', 'team-avatar', initial(c.member_name)));
      const info = el('div', 'grow'); info.append(el('strong', '', c.member_name || T('roleMember')), el('small', '', new Date(c.created_at).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' })));
      row.append(info, el('span', 'team-amount', (lang === 'ar' ? '\u200F+' : '+') + money(c.amount))); box.append(row);
    });
  }
  function renderPicker() {
    const box = $('#team-picker'); box.replaceChildren();
    if (purchasesLoading) { box.append(el('div', 'team-empty', T('libLoading'))); return; }
    if (purchasesError) { box.append(el('div', 'team-empty', T('purchasesErr'))); return; }
    const shared = new Set((docs || []).map((d) => d.document_id || d.doc_id).filter(Boolean));
    const free = purchases.filter((p) => !shared.has(p.id));
    if (!free.length) { box.append(el('div', 'team-empty', T('libNoPurchases'))); selectedDoc = ''; return; }
    if (!free.some((p) => p.id === selectedDoc)) selectedDoc = '';
    free.forEach((p) => {
      const b = el('button', 'seg-chip' + (p.id === selectedDoc ? ' active' : ''), p.title); b.type = 'button'; b.setAttribute('aria-pressed', String(p.id === selectedDoc));
      b.addEventListener('click', () => { selectedDoc = p.id === selectedDoc ? '' : p.id; renderPicker(); });
      box.append(b);
    });
  }

  /* ---------------- actions ---------------- */
  $('#team-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.submitter, async () => {
      const { error } = await sb.rpc('medad_team_create', { p_name: $('#team-name').value.trim(), p_goal: Math.trunc(Number($('#team-goal').value)) });
      if (error) toast(errText(error), 'error'); else { toast(T('tCreated')); await load(); }
    });
  });
  $('#team-join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.submitter, async () => {
      const { data, error } = await sb.rpc('medad_team_join', { p_code: $('#team-code').value.trim().toUpperCase() });
      if (error) toast(errText(error), 'error');
      else if (!data?.ok) toast(errText(data?.error), 'error');
      else { toast(T('tJoined')); history.replaceState(null, '', location.pathname); await load(); }
    });
  });
  $('#team-contribute-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.submitter, async () => {
      const { data, error } = await sb.rpc('medad_team_contribute', { p_amount: Math.trunc(Number($('#team-contribute-amount').value)), p_request_id: contribRequestId });
      if (error || !data?.ok) { toast(errText(error || data?.error || 'insufficient_wallet'), 'error'); return; }
      contribRequestId = newId(); toast(T('tContributed')); await loadSummary(); await loadExtras();
    });
  });
  $('#team-document-add').addEventListener('click', async (e) => {
    if (!selectedDoc) { toast(T('libPickFirst'), 'error'); return; }
    await withBusy(e.currentTarget, async () => {
      const { error } = await sb.rpc('medad_team_document_add', { p_document_id: selectedDoc });
      if (error) toast(errText(error), 'error'); else { toast(T('tDocAdded')); selectedDoc = ''; await loadExtras(); }
    });
  });
  $('#team-leave').addEventListener('click', async (e) => {
    if (!(await askConfirm(T('confirmLeave'), T('leave')))) return;
    await withBusy(e.currentTarget, async () => {
      const { error } = await sb.rpc('medad_team_leave');
      if (error) toast(errText(error), 'error'); else { toast(T('tLeft')); await load(); }
    });
  });
  $('#team-signout').addEventListener('click', async () => { await sb?.auth.signOut(); location.href = './'; });
  sb?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.href = './'; });

  boot().catch(() => { showOnly('auth'); toast(T('e_generic'), 'error'); });
})();
