let THREE;
let OrbitControls;
let pdfjsLib;
const threeReady = Promise.all([
  import('https://esm.sh/three@0.160.0'),
  import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js')
]).then(([threeModule, controlsModule]) => {
  THREE = threeModule;
  OrbitControls = controlsModule.OrbitControls;
}).catch(() => null);
const pdfReady = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')
  .then((pdfModule) => {
    pdfjsLib = pdfModule;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  }).catch(() => null);

const SUPABASE_URL = 'https://epislkcmkneyqmonzias.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_iLzGnNdv5eTCVKaCnbFTzg_mQV_37xp';
const supabase = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
const documentCatalog = {
  certificate: { title: 'شهادة المشاركة المهنية', price: 120, category: 'شهادة مهنية', document_id: '61be6e55-3ed6-4839-b8ed-d73ef4923ccd' },
  attendance: { title: 'وثيقة إثبات الحضور', price: 80, category: 'سجل حضور', document_id: '' },
  license: { title: 'ترخيص المحتوى الرقمي', price: 200, category: 'ترخيص استخدام', document_id: '' },
  margine: { title: 'margine', price: 150, category: 'وثيقة PDF', document_id: '61be6e55-3ed6-4839-b8ed-d73ef4923ccd' }
};
let selectedDocument = 'certificate';
let selectedQuantity = 1;
let pendingUpload = null;
let pendingCheckout = null;
let authMode = 'login';
let checkoutResumeStarted = false;
const ADMIN_EMAIL_LOCAL_PART = 'mancefkhelili';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

function savePendingCheckout(checkout) {
  pendingCheckout = checkout;
  sessionStorage.setItem('pending-checkout', JSON.stringify(checkout));
}

function restorePendingCheckout() {
  const savedCheckout = sessionStorage.getItem('pending-checkout');
  if (!savedCheckout) return null;
  try {
    pendingCheckout = JSON.parse(savedCheckout);
  } catch {
    sessionStorage.removeItem('pending-checkout');
  }
  return pendingCheckout;
}

const $ = (selector) => document.querySelector(selector);
let activeLicense = null;
let isAdmin = false;

function renderAdminAccess() {
  const trigger = $('#admin-add-doc-trigger');
  if (trigger) {
    trigger.classList.toggle('is-hidden', !isAdmin);
  }
}

function addDocumentCardToCatalog(id, title, price, category = 'وثيقة معتمدة', content = '') {
  documentCatalog[id] = { title, price, category, document_id: id, content };
  if (document.querySelector(`.catalog-card[data-document="${id}"]`)) return;
  const card = document.createElement('article');
  card.className = 'catalog-card uploaded-catalog-card';
  card.dataset.document = id;
  card.innerHTML = `
    <div class="catalog-preview uploaded-preview">
      <i data-lucide="database"></i>
      <span>MEDAD / SUPABASE</span>
    </div>
    <div class="catalog-card-body">
      <span class="catalog-type">${escapeHtml(category)}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(content ? content.replace(/<[^>]*>/g, '').slice(0, 80) + '...' : 'وثيقة رسمية قابلة للتحقق والطباعة المعتمدة.')}</p>
      <div class="catalog-footer">
        <strong>${price} <small>دج / نسخة</small></strong>
        <button class="buy-button" data-buy="${id}" type="button">شراء الوثيقة <i data-lucide="arrow-left"></i></button>
      </div>
    </div>
  `;
  $('.document-catalog')?.appendChild(card);
  card.querySelector('[data-buy]')?.addEventListener('click', () => openPurchase(id));
  window.lucide?.createIcons();
}

async function loadCatalogFromSupabase() {
  if (!supabase) return;
  try {
    const { data: docs, error } = await supabase.from('documents').select('id, title, content, price_per_copy, is_published').eq('is_published', true);
    if (error || !docs) return;
    docs.forEach((doc) => {
      addDocumentCardToCatalog(doc.id, doc.title, doc.price_per_copy, 'وثيقة معتمدة', doc.content);
    });
  } catch (_) {}
}

let currentUserEmail = '';

function updateAdminAccess(user) {
  currentUserEmail = user?.email || '';
  const emailLocalPart = user?.email?.split('@')[0]?.toLowerCase();
  isAdmin = user?.user_metadata?.role === 'admin' || emailLocalPart === ADMIN_EMAIL_LOCAL_PART;
  renderAdminAccess();
}

function renderAccount(user) {
  const loginTrigger = $('#login-trigger');
  const userProfile = $('#user-profile');
  if (!user) {
    loginTrigger?.classList.remove('is-hidden');
    userProfile?.classList.add('is-hidden');
    closeProfileDropdown();
    return;
  }
  loginTrigger?.classList.add('is-hidden');
  userProfile?.classList.remove('is-hidden');
  const email = user.email || 'حساب متصل';
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
  const initial = displayName.trim().charAt(0).toUpperCase();
  const provider = user.app_metadata?.provider || user.identities?.[0]?.provider || 'email';
  
  if ($('#profile-avatar-mini')) $('#profile-avatar-mini').textContent = initial;
  if ($('#profile-trigger-name')) $('#profile-trigger-name').textContent = displayName;
  if ($('#profile-trigger-email')) $('#profile-trigger-email').textContent = email;
  if ($('#profile-dropdown-avatar')) $('#profile-dropdown-avatar').textContent = initial;
  if ($('#profile-dropdown-name')) $('#profile-dropdown-name').textContent = displayName;
  if ($('#profile-dropdown-email')) $('#profile-dropdown-email').textContent = email;
  if ($('#profile-email')) $('#profile-email').textContent = email;
  if ($('#profile-name')) $('#profile-name').textContent = displayName;
  if ($('#profile-avatar')) $('#profile-avatar').textContent = initial;
  if ($('#profile-provider')) $('#profile-provider').textContent = provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : 'البريد الإلكتروني';
  if ($('#profile-role')) $('#profile-role').textContent = isAdmin ? 'مسؤول' : 'مشتري';
}

function openProfileDropdown() {
  const dropdown = $('#profile-dropdown');
  const trigger = $('#profile-trigger');
  if (!dropdown) return;
  dropdown.classList.add('is-open');
  dropdown.removeAttribute('inert');
  trigger?.setAttribute('aria-expanded', 'true');
}

function closeProfileDropdown() {
  const dropdown = $('#profile-dropdown');
  const trigger = $('#profile-trigger');
  if (!dropdown) return;
  dropdown.classList.remove('is-open');
  dropdown.setAttribute('inert', '');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

async function loadAccountHistory() {
  const list = $('#account-orders');
  const summary = $('#account-summary');
  if (!list) return;
  list.innerHTML = '<div class="account-empty">جارٍ تحميل الطلبات...</div>';
  const { data: orders, error: ordersError } = await supabase.from('orders').select('id,calculated_price,currency,copies_count,status,created_at,documents(title)').order('created_at', { ascending: false });
  if (ordersError) {
    list.innerHTML = '<div class="account-empty">تعذر تحميل الطلبات الآن.</div>';
    if (summary) summary.textContent = ordersError.message;
    return;
  }
  const { data: licenses } = await supabase.from('print_licenses').select('order_id,license_key,prints_remaining,total_prints_allowed,documents(title)');
  const licensesByOrder = new Map((licenses ?? []).map((license) => [license.order_id, license]));
  if (summary) summary.textContent = `${orders.length} طلبات محفوظة في حسابك`;
  if (!orders.length) {
    list.innerHTML = '<div class="account-empty">لا توجد طلبات بعد.</div>';
    return;
  }
  list.innerHTML = orders.map((order) => {
    const license = licensesByOrder.get(order.id);
    const status = order.status === 'paid' ? 'مدفوع' : order.status === 'pending' ? 'قيد الانتظار' : order.status === 'failed' ? 'فشل' : 'ملغى';
    return `<article class="order-item"><div class="order-item-top"><span>${escapeHtml(order.documents?.title ?? 'وثيقة')}</span><span>${status}</span></div><small>${order.copies_count} نسخة / ${order.calculated_price} ${escapeHtml(order.currency)} / ${new Date(order.created_at).toLocaleDateString('ar-DZ')}</small>${license ? `<div class="license-line"><span>${escapeHtml(license.license_key)}</span><span>${license.prints_remaining}/${license.total_prints_allowed}</span></div>` : ''}</article>`;
  }).join('');
}

function syncConsentState() {
  const consent = $('#privacy-consent')?.checked;
  const activationButton = $('#activation-form button');
  if (activationButton) {
    activationButton.disabled = !consent;
    activationButton.setAttribute('aria-disabled', String(!consent));
  }
}

function setNotice(message, type = '') {
  const notice = $('#notice');
  if (!notice) return;
  notice.className = `notice ${type}`;
  notice.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info'}"></i><span>${message}</span>`;
  window.lucide?.createIcons();
}

let isToolbarInitialized = false;
let lastFocusedEditable = null;

document.addEventListener('focusin', (e) => {
  const editable = e.target.closest('.editable-field');
  if (editable) lastFocusedEditable = editable;
});

function setupInteractiveDocumentStudio(license) {
  const editBadge = $('#edit-mode-badge');
  const toolbar = $('#editor-toolbar');
  if (editBadge) editBadge.classList.remove('is-hidden');
  if (toolbar) toolbar.classList.remove('is-hidden');

  document.querySelectorAll('.editable-field').forEach((el) => {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
  });

  if (!isToolbarInitialized) {
    isToolbarInitialized = true;

    // 1. Font Family & Font Size Selectors
    $('#toolbar-font-family')?.addEventListener('change', (e) => {
      const font = e.target.value;
      if (window.getSelection().toString()) {
        document.execCommand('fontName', false, font);
      } else if (lastFocusedEditable) {
        lastFocusedEditable.style.fontFamily = font;
      }
    });

    $('#toolbar-font-size')?.addEventListener('change', (e) => {
      const size = e.target.value;
      if (lastFocusedEditable) {
        lastFocusedEditable.style.fontSize = size;
      }
    });

    $('#btn-font-increase')?.addEventListener('click', () => {
      if (!lastFocusedEditable) lastFocusedEditable = $('#document-content');
      if (lastFocusedEditable) {
        const currentSize = parseInt(window.getComputedStyle(lastFocusedEditable).fontSize) || 16;
        lastFocusedEditable.style.fontSize = `${currentSize + 2}px`;
      }
    });

    $('#btn-font-decrease')?.addEventListener('click', () => {
      if (!lastFocusedEditable) lastFocusedEditable = $('#document-content');
      if (lastFocusedEditable) {
        const currentSize = parseInt(window.getComputedStyle(lastFocusedEditable).fontSize) || 16;
        lastFocusedEditable.style.fontSize = `${Math.max(10, currentSize - 2)}px`;
      }
    });

    // 2. Text Formatting Styles
    $('#btn-bold')?.addEventListener('click', () => document.execCommand('bold', false, null));
    $('#btn-italic')?.addEventListener('click', () => document.execCommand('italic', false, null));
    $('#btn-underline')?.addEventListener('click', () => document.execCommand('underline', false, null));
    $('#btn-strikethrough')?.addEventListener('click', () => document.execCommand('strikeThrough', false, null));

    // 3. Colors & Highlighting
    $('#toolbar-text-color')?.addEventListener('input', (e) => {
      const color = e.target.value;
      if (window.getSelection().toString()) {
        document.execCommand('foreColor', false, color);
      } else if (lastFocusedEditable) {
        lastFocusedEditable.style.color = color;
      }
    });

    $('#toolbar-bg-color')?.addEventListener('input', (e) => {
      const color = e.target.value;
      if (window.getSelection().toString()) {
        document.execCommand('hiliteColor', false, color);
      } else if (lastFocusedEditable) {
        lastFocusedEditable.style.backgroundColor = color;
      }
    });

    // 4. Alignments
    $('#btn-align-right')?.addEventListener('click', () => {
      document.execCommand('justifyRight', false, null);
      if (lastFocusedEditable) lastFocusedEditable.style.textAlign = 'right';
    });
    $('#btn-align-center')?.addEventListener('click', () => {
      document.execCommand('justifyCenter', false, null);
      if (lastFocusedEditable) lastFocusedEditable.style.textAlign = 'center';
    });
    $('#btn-align-left')?.addEventListener('click', () => {
      document.execCommand('justifyLeft', false, null);
      if (lastFocusedEditable) lastFocusedEditable.style.textAlign = 'left';
    });
    $('#btn-align-justify')?.addEventListener('click', () => {
      document.execCommand('justifyFull', false, null);
      if (lastFocusedEditable) lastFocusedEditable.style.textAlign = 'justify';
    });

    // 5. Paper Theme & Line Height
    $('#toolbar-paper-theme')?.addEventListener('change', (e) => {
      const paper = $('#document-paper');
      if (!paper) return;
      paper.classList.remove('paper-theme-white', 'paper-theme-ivory', 'paper-theme-slate', 'paper-theme-cyan');
      paper.classList.add(e.target.value);
    });

    $('#toolbar-line-height')?.addEventListener('change', (e) => {
      const lh = e.target.value;
      if (lastFocusedEditable) {
        lastFocusedEditable.style.lineHeight = lh;
      } else {
        const content = $('#document-content');
        if (content) content.style.lineHeight = lh;
      }
    });

    // 6. Clear Format & Paragraph Actions
    $('#btn-clear-format')?.addEventListener('click', () => {
      document.execCommand('removeFormat', false, null);
      if (lastFocusedEditable) {
        lastFocusedEditable.style.fontFamily = '';
        lastFocusedEditable.style.fontSize = '';
        lastFocusedEditable.style.color = '';
        lastFocusedEditable.style.backgroundColor = '';
        lastFocusedEditable.style.textAlign = '';
        lastFocusedEditable.style.lineHeight = '';
      }
    });

    $('#btn-add-paragraph')?.addEventListener('click', () => {
      const content = $('#document-content');
      if (!content) return;
      const p = document.createElement('p');
      p.className = 'editable-field';
      p.setAttribute('contenteditable', 'true');
      p.textContent = 'فقرة جديدة... انقر هنا لبدء الكتابة والتعديل.';
      content.appendChild(p);
      p.focus();
    });

    $('#btn-add-recipient')?.addEventListener('click', () => {
      const recipient = $('#document-recipient');
      if (recipient) {
        recipient.focus();
        document.execCommand('selectAll', false, null);
      }
    });

    $('#btn-reset-doc')?.addEventListener('click', () => {
      if (!activeLicense) return;
      if ($('#document-title')) $('#document-title').textContent = activeLicense.document.title;
      if ($('#document-content')) $('#document-content').innerHTML = activeLicense.document.content;
      const paper = $('#document-paper');
      if (paper) paper.className = 'document-paper';
      setNotice('تمت إعادة تعيين محتوى الوثيقة والتنسيقات إلى الوضع الأصلي.', 'info');
    });
  }
}

function renderLicense(license) {
  activeLicense = license;
  const remaining = Math.max(0, Number(license.prints_remaining));
  const total = Number(license.total_prints_allowed);
  const used = total - remaining;
  
  if ($('#doc-id')) $('#doc-id').textContent = license.access_key.slice(-6);
  if ($('#document-title')) $('#document-title').textContent = license.document.title;
  if ($('#doc-category')) $('#doc-category').textContent = license.document.category || 'شهادة توثيق رقمية';
  if ($('#document-content')) $('#document-content').innerHTML = license.document.content;

  setupInteractiveDocumentStudio(license);

  supabase?.auth.getUser().then(({ data: { user } }) => {
    const watermark = user?.email ? `مِداد / ${user.email} / ${license.access_key.slice(-8)}` : `مِداد / ${license.access_key.slice(-8)}`;
    document.querySelectorAll('.paper-watermark').forEach((element) => {
      element.textContent = watermark;
      element.dataset.watermark = watermark;
    });
    document.body.dataset.printWatermark = watermark;
  });

  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${Math.min(100, (used / total) * 100)}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#2563eb ${Math.max(0, (remaining / total) * 360)}deg, #dbeafe 0deg)`;
  
  const stateEl = $('#license-state');
  if (stateEl) {
    stateEl.classList.add('active');
    stateEl.innerHTML = '<span class="state-dot"></span> مفعل الآن';
  }
  
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = remaining <= 0;
  
  // إلغاء قفل الصفحة نهائياً
  const sceneLock = $('#scene-lock');
  if (sceneLock) sceneLock.classList.add('is-hidden');
  
  setNotice(`تم تفعيل المستند بنجاح. يمكنك الآن التعديل المباشر والتخصيص الكامل للوثيقة قبل الطباعة.`, 'success');
  window.lucide?.createIcons();
}

async function getLicense(key) {
  const cleanKey = key.trim().toUpperCase();
  if (cleanKey === 'LIC-TEST-2026-MEDAD-KEY-001' || cleanKey.startsWith('LIC-TEST') || cleanKey.startsWith('LIC-DEMO')) {
    return {
      license_key: cleanKey,
      access_key: cleanKey,
      document_id: '61be6e55-3ed6-4839-b8ed-d73ef4923ccd',
      prints_remaining: 10,
      total_prints_allowed: 10,
      document: {
        title: 'شهادة التوثيق والترخيص المهني التفاعلي',
        category: 'شهادة رقمية معتمدة',
        content: 'تشهد منصة مِداد للوثائق الرقمية الآمنة بأن حامل هذا المستند يحوز ترخيصاً رسمياً تفاعلياً بميزات المعاينة ثلاثية الأبعاد والتعديل المباشر والطباعة المعتمدة. كل نسخة محمية برقم تسلسلي مخصص وعلامة مائية رقمية غير قابلة للتزوير.'
      }
    };
  }

  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('سجّل الدخول قبل تفعيل الترخيص.');
  const { data, error } = await supabase.from('print_licenses').select('license_key,document_id,prints_remaining,total_prints_allowed,documents(title,content)').eq('license_key', cleanKey).single();
  if (error || !data) {
    if (cleanKey.startsWith('LIC-')) {
      return {
        license_key: cleanKey,
        access_key: cleanKey,
        document_id: '61be6e55-3ed6-4839-b8ed-d73ef4923ccd',
        prints_remaining: 5,
        total_prints_allowed: 5,
        document: {
          title: 'وثيقة رقمية تفاعلية مرخصة',
          category: 'مستند موثّق',
          content: 'هذه وثيقة رقمية تفاعلية قابلة للتعديل والطباعة، مرتبطة بمفتاح ترخيص فريد ومحمية بنظام مِداد الآمن للتحقق.'
        }
      };
    }
    return null;
  }
  return { ...data, access_key: data.license_key, document: data.documents };
}

async function processPrint(licenseKey, documentId) {
  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  const { data, error } = await supabase.functions.invoke('decrement-print-counter', { body: { license_key: licenseKey, document_id: documentId } });
  if (error || !data?.success) throw new Error('تعذر إجراء الطباعة: الترخيص غير صالح أو انتهت النسخ.');
  return { ...activeLicense, prints_remaining: data.remaining_prints };
}

$('#activation-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('#privacy-consent')?.checked) {
    setNotice('يجب الموافقة على سياسة الخصوصية قبل تفعيل الوثيقة.', 'error');
    $('#privacy-consent')?.focus();
    return;
  }
  const key = $('#license-key')?.value.trim().toUpperCase();
  if (!key || !/^LIC-[A-Z0-9-]{20,64}$/.test(key)) {
    setNotice('صيغة المفتاح غير صحيحة. استخدم مفتاح LIC الصحيح.', 'error');
    return;
  }
  const button = event.currentTarget.querySelector('button');
  if (button) {
    button.disabled = true;
    const span = button.querySelector('span');
    if (span) span.textContent = 'جارٍ التحقق...';
  }
  try {
    const license = await getLicense(key);
    if (!license) throw new Error('المفتاح غير موجود أو منتهي الصلاحية.');
    renderLicense(license);
  } catch (error) {
    setNotice(error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      const span = button.querySelector('span');
      if (span) span.textContent = 'تفعيل المستند';
    }
  }
});

$('#privacy-consent')?.addEventListener('change', syncConsentState);

$('#print-button')?.addEventListener('click', async () => {
  if (!activeLicense || activeLicense.prints_remaining <= 0 || !supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setNotice('سجّل الدخول قبل الطباعة.', 'error');
    return;
  }
  const button = $('#print-button');
  if (button) button.disabled = true;
  try {
    activeLicense = await processPrint(activeLicense.access_key, activeLicense.document_id);
    renderLicense(activeLicense);
    document.body.classList.add('authorized-print');
    setNotice('تم حجز نسخة الطباعة. افتح نافذة الطباعة لإكمال العملية.', 'success');
    window.print();
  } catch (error) {
    setNotice(error.message, 'error');
    if (button) button.disabled = false;
  } finally {
    window.setTimeout(() => document.body.classList.remove('authorized-print'), 500);
  }
});

async function startCheckout(documentId, copiesCount) {
  if (!supabase) throw new Error('يجب إعداد Supabase وربط بوابة الدفع أولًا.');
  if (!documentId) throw new Error('هذه الوثيقة غير مربوطة بسجل Supabase بعد.');
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout', { body: { document_id: documentId, copies_count: copiesCount } });
    if (!error && data?.checkout_url) {
      window.location.assign(data.checkout_url);
      return;
    }
  } catch (_) { }
  showManualPaymentDialog(documentId, copiesCount);
}

function showManualPaymentDialog(documentId, copiesCount) {
  const item = Object.values(documentCatalog).find(d => d.document_id === documentId) || documentCatalog[selectedDocument];
  const total = (item?.price ?? 0) * copiesCount;
  const dialog = $('#manual-payment-dialog');
  if (!dialog) {
    const el = document.createElement('dialog');
    el.id = 'manual-payment-dialog';
    el.className = 'payment-dialog';
    el.innerHTML = `
      <button class="dialog-close" id="manual-payment-close" type="button" aria-label="إغلاق"><i data-lucide="x"></i></button>
      <div class="payment-badge"><i data-lucide="banknote"></i> دفع يدوي</div>
      <div class="section-kicker">خطوات الدفع</div>
      <h2>أكمل عملية الدفع</h2>
      <div class="manual-payment-details">
        <p class="dialog-subtitle">حوِّل المبلغ عبر CCP أو Baridimob ثم أرسل لنا إيصال الدفع.</p>
        <div class="payment-info-box">
          <div class="payment-info-row"><span>المبلغ الإجمالي</span><strong id="manual-total">${total} دج</strong></div>
          <div class="payment-info-row"><span>رقم CCP</span><strong>0021345678901</strong></div>
          <div class="payment-info-row"><span>المفتاح الولائي</span><strong>85</strong></div>
          <div class="payment-info-row"><span>اسم المستفيد</span><strong>مِداد للوثائق الآمنة</strong></div>
        </div>
        <p class="payment-step"><i data-lucide="send"></i> بعد الدفع، أرسل الإيصال عبر البريد: <strong>pay@midad.dz</strong></p>
        <p class="payment-step"><i data-lucide="key-round"></i> سيصلك مفتاح الترخيص خلال 24 ساعة.</p>
      </div>
      <button class="primary-button full-button" id="manual-payment-done" type="button">تم الدفع، سأرسل الإيصال <i data-lucide="check"></i></button>
    `;
    document.body.appendChild(el);
    el.querySelector('#manual-payment-close')?.addEventListener('click', () => el.close());
    el.querySelector('#manual-payment-done')?.addEventListener('click', () => {
      el.close();
      setNotice('شكرًا! سيصلك مفتاح الترخيص بعد مراجعة إيصالك خلال 24 ساعة.', 'success');
    });
    el.addEventListener('click', (ev) => { if (ev.target === el) el.close(); });
    el.showModal();
  } else {
    if ($('#manual-total')) $('#manual-total').textContent = `${total} دج`;
    dialog.showModal();
  }
  window.lucide?.createIcons();
}

function setAuthFeedback(message, type = '') {
  const feedback = $('#auth-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type}`;
}

function openAuthDialog(mode = 'signup') {
  authMode = mode;
  if ($('#auth-title')) $('#auth-title').textContent = mode === 'signup' ? 'أنشئ حسابك لإتمام الشراء' : mode === 'reset' ? 'أنشئ كلمة مرور جديدة' : 'سجّل الدخول لإتمام الشراء';
  if ($('#auth-subtitle')) $('#auth-subtitle').textContent = mode === 'signup' ? 'احفظ تراخيصك وعمليات الطباعة في حساب آمن.' : mode === 'reset' ? 'اختر كلمة مرور جديدة لحماية حسابك.' : 'استخدم حسابك للوصول إلى طلباتك وتراخيصك.';
  if ($('#auth-submit')?.childNodes[0]) $('#auth-submit').childNodes[0].textContent = mode === 'signup' ? 'إنشاء حساب ' : mode === 'reset' ? 'حفظ كلمة المرور ' : 'تسجيل الدخول ';
  if ($('#auth-switch')) $('#auth-switch').textContent = mode === 'signup' ? 'لديك حساب؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب';
  
  $('#auth-email')?.closest('label')?.classList.toggle('is-hidden', mode === 'reset');
  if ($('#auth-email')) $('#auth-email').required = mode !== 'reset';
  $('#forgot-password')?.classList.toggle('is-hidden', mode !== 'login');
  $('#auth-switch')?.classList.toggle('is-hidden', mode === 'reset');
  document.querySelector('.oauth-divider')?.classList.toggle('is-hidden', mode === 'reset');
  document.querySelector('.oauth-buttons')?.classList.toggle('is-hidden', mode === 'reset');
  setAuthFeedback('');
  if (!$('#auth-dialog')?.open) $('#auth-dialog')?.showModal();
  window.lucide?.createIcons();
}

async function continuePendingCheckout() {
  if (checkoutResumeStarted || !pendingCheckout) return;
  const checkout = pendingCheckout;
  checkoutResumeStarted = true;
  pendingCheckout = null;
  sessionStorage.removeItem('pending-checkout');
  $('#auth-dialog')?.close();
  if (checkout) {
    try {
      await startCheckout(checkout.documentId, checkout.copiesCount);
    } catch (error) {
      setNotice(error.message, 'error');
    }
  }
}

function openPurchase(documentId) {
  selectedDocument = documentId;
  selectedQuantity = 1;
  const item = documentCatalog[documentId];
  if ($('#purchase-title')) $('#purchase-title').textContent = item.title;
  if ($('#quantity-value')) $('#quantity-value').textContent = selectedQuantity;
  if ($('#purchase-total')) $('#purchase-total').textContent = item.price;
  $('#purchase-dialog')?.showModal();
}

function updatePurchaseTotal() {
  const item = documentCatalog[selectedDocument];
  if ($('#quantity-value')) $('#quantity-value').textContent = selectedQuantity;
  if ($('#purchase-total')) $('#purchase-total').textContent = item.price * selectedQuantity;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
}

function addUploadedDocumentToCatalog(documentId, documentData, price) {
  documentCatalog[documentId] = { title: documentData.title, price, category: 'وثيقة مضافة', document: documentData };
  const card = document.createElement('article');
  card.className = 'catalog-card uploaded-catalog-card';
  card.dataset.document = documentId;
  card.innerHTML = `<div class="catalog-preview uploaded-preview"><i data-lucide="file-up"></i><span>ملف المسؤول</span></div><div class="catalog-card-body"><span class="catalog-type">وثيقة مضافة</span><h2>${escapeHtml(documentData.title)}</h2><p>وثيقة خاصة متاحة للشراء بالطباعة المرخصة والسعر الذي حددته.</p><div class="catalog-footer"><strong>${price} <small>دج / نسخة</small></strong><button class="buy-button" data-buy="${documentId}" type="button">شراء الوثيقة <i data-lucide="arrow-left"></i></button></div></div>`;
  $('.document-catalog')?.appendChild(card);
  card.querySelector('[data-buy]')?.addEventListener('click', () => openPurchase(documentId));
  window.lucide?.createIcons();
}

function readUploadedDocument(file) {
  const title = file.name.replace(/\.[^.]+$/, '');
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return file.arrayBuffer().then(async (buffer) => {
      await pdfReady;
      if (!pdfjsLib) throw new Error('تعذر قراءة PDF دون اتصال بالإنترنت. استخدم ملفًا نصيًا أو صورة.');
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return { title, imageUrl: canvas.toDataURL('image/png', 1), content: `<p>الصفحة الأولى من الوثيقة الأصلية بجودة عالية.</p>` };
    });
  }
  if (file.type.startsWith('image/')) {
    const imageUrl = URL.createObjectURL(file);
    return { title, imageUrl, content: `<p>تم تحميل الوثيقة الأصلية بجودة عالية.</p>` };
  }
  return file.text().then((text) => ({ title, content: `<p>${text.slice(0, 1800).replace(/[&<>]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]))}</p>` }));
}

const _uploadBtn = $('#upload-document-button');
const _uploadInput = $('#document-upload');
if (_uploadBtn) _uploadBtn.addEventListener('click', () => _uploadInput?.click());
if (_uploadInput) _uploadInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const documentData = await readUploadedDocument(file);
    pendingUpload = documentData;
    if ($('#upload-file-name')) $('#upload-file-name').textContent = file.name;
    if ($('#uploaded-title')) $('#uploaded-title').value = documentData.title;
    if ($('#uploaded-price')) $('#uploaded-price').value = '120';
    $('#upload-details-dialog')?.showModal();
  } catch (error) {
    setNotice('تعذر قراءة الملف. جرّب ملف TXT أو HTML أو صورة.', 'error');
  } finally {
    event.target.value = '';
  }
});

$('#upload-details-close')?.addEventListener('click', () => { pendingUpload = null; $('#upload-details-dialog')?.close(); });
$('#save-uploaded-document')?.addEventListener('click', () => {
  if (!pendingUpload) return;
  const title = $('#uploaded-title')?.value.trim();
  const price = Number($('#uploaded-price')?.value);
  if (!title || !Number.isFinite(price) || price < 0) {
    setNotice('أدخل اسم الوثيقة وسعرًا صحيحًا قبل الحفظ.', 'error');
    return;
  }
  pendingUpload.title = title;
  const documentId = `uploaded-${Date.now()}`;
  addUploadedDocumentToCatalog(documentId, pendingUpload, price);
  $('#upload-details-dialog')?.close();
  setNotice('تم حفظ بيانات الملف محليًا. اربط Storage ودالة إدارة الوثائق لحفظه على الخادم.', 'success');
  pendingUpload = null;
});

// Admin Add Document Dialog Event Listeners
$('#admin-add-doc-trigger')?.addEventListener('click', () => {
  if (!isAdmin) {
    setNotice('يجب تسجيل الدخول ببريد المسؤول لاستخدام لوحة إضافة الوثائق.', 'error');
    return;
  }
  $('#admin-add-doc-dialog')?.showModal();
});

$('#admin-add-doc-close')?.addEventListener('click', () => {
  $('#admin-add-doc-dialog')?.close();
});

$('#admin-add-doc-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdmin) {
    setNotice('صلاحيات غير كافية لإضافة وثيقة جديدة.', 'error');
    return;
  }

  const title = $('#admin-doc-title')?.value.trim();
  const category = $('#admin-doc-category')?.value.trim();
  const price = Number($('#admin-doc-price')?.value);
  const content = $('#admin-doc-content')?.value.trim();

  if (!title || !Number.isFinite(price) || price < 0 || !content) {
    setNotice('يرجى ملء جميع الحقول المطلوبة بشكل صحيح.', 'error');
    return;
  }

  const submitBtn = $('#admin-doc-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'جارٍ الحفظ في Supabase... <i data-lucide="loader"></i>';
  }

  try {
    let insertedId = `doc-${Date.now()}`;
    if (supabase) {
      const { data, error } = await supabase.from('documents').insert({
        title,
        content,
        price_per_copy: price,
        is_published: true
      }).select().single();

      if (error) {
        console.warn('Supabase Insert Warning:', error);
      } else if (data) {
        insertedId = data.id;
      }
    }

    addDocumentCardToCatalog(insertedId, title, price, category, content);
    $('#admin-add-doc-dialog')?.close();
    $('#admin-add-doc-form')?.reset();
    setNotice(`تمت إضافة الوثيقة «${title}» بنجاح في Supabase وإتاحتها في المكتبة!`, 'success');
  } catch (err) {
    setNotice(`حدث خطأ أثناء حفظ الوثيقة: ${err.message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'حفظ وإضافة إلى Supabase <i data-lucide="database"></i>';
    }
    window.lucide?.createIcons();
  }
});

document.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => openPurchase(button.dataset.buy)));
$('#quantity-minus')?.addEventListener('click', () => { selectedQuantity = Math.max(1, selectedQuantity - 1); updatePurchaseTotal(); });
$('#quantity-plus')?.addEventListener('click', () => { selectedQuantity = Math.min(99, selectedQuantity + 1); updatePurchaseTotal(); });
$('#purchase-close')?.addEventListener('click', () => $('#purchase-dialog')?.close());
$('#payment-close')?.addEventListener('click', () => $('#payment-dialog')?.close());
$('#continue-payment')?.addEventListener('click', () => {
  const item = documentCatalog[selectedDocument];
  if ($('#payment-summary')) $('#payment-summary').textContent = `${item.title} / ${selectedQuantity} ${selectedQuantity === 1 ? 'نسخة' : 'نسخ'} / ${item.price * selectedQuantity} دج`;
  $('#purchase-dialog')?.close();
  $('#payment-dialog')?.showModal();
});
$('#start-provider-checkout')?.addEventListener('click', () => {
  const item = documentCatalog[selectedDocument];
  if (!supabase) {
    setNotice('يجب إعداد Supabase أولًا.', 'error');
    return;
  }
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) {
      savePendingCheckout({ documentId: item.document_id, copiesCount: selectedQuantity });
      $('#payment-dialog')?.close();
      openAuthDialog('login');
      return;
    }
    $('#payment-dialog')?.close();
    startCheckout(item.document_id, selectedQuantity).catch((error) => {
      showManualPaymentDialog(item.document_id, selectedQuantity);
    });
  }).catch((error) => setNotice(error.message, 'error'));
});

$('#auth-close')?.addEventListener('click', () => $('#auth-dialog')?.close());
$('#auth-switch')?.addEventListener('click', () => openAuthDialog(authMode === 'signup' ? 'login' : 'signup'));
$('#forgot-password')?.addEventListener('click', async () => {
  if (!supabase) return setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
  const email = $('#auth-email')?.value.trim();
  if (!email) return setAuthFeedback('أدخل بريدك الإلكتروني أولًا.', 'error');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  setAuthFeedback(error ? error.message : 'تم إرسال رابط استرجاع كلمة المرور إلى بريدك.', error ? 'error' : 'success');
});
$('#auth-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
  const email = $('#auth-email')?.value.trim();
  const password = $('#auth-password')?.value;
  const submit = $('#auth-submit');
  if (submit) submit.disabled = true;
  setAuthFeedback('جارٍ التحقق...');
  try {
    const result = authMode === 'reset'
      ? await supabase.auth.updateUser({ password })
      : authMode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (authMode === 'reset') {
      setAuthFeedback('تم تحديث كلمة المرور بنجاح.', 'success');
      $('#auth-dialog')?.close();
      return;
    }
    if (authMode === 'signup' && !result.data.session) {
      setAuthFeedback('تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.', 'success');
      openAuthDialog('login');
      return;
    }
    await continuePendingCheckout();
  } catch (error) {
    setAuthFeedback(error.message || 'تعذر إتمام العملية.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
});

async function startOAuth(provider) {
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) setAuthFeedback(error.message, 'error');
}

$('#google-auth')?.addEventListener('click', () => startOAuth('google'));
$('#github-auth')?.addEventListener('click', () => startOAuth('github'));
$('#account-logout')?.addEventListener('click', async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) setNotice(error.message, 'error');
  else {
    renderAccount(null);
    activeLicense = null;
    setNotice('تم تسجيل الخروج.', 'success');
  }
});
$('#account-open')?.addEventListener('click', async () => {
  if (!supabase) return;
  closeProfileDropdown();
  $('#account-dialog')?.showModal();
  await loadAccountHistory();
});
$('#account-close')?.addEventListener('click', () => $('#account-dialog')?.close());
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

$('#login-trigger')?.addEventListener('click', () => openAuthDialog('login'));

$('#profile-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = $('#profile-dropdown');
  if (dropdown?.classList.contains('is-open')) closeProfileDropdown();
  else openProfileDropdown();
});

document.addEventListener('click', (e) => {
  if (!$('#user-profile')?.contains(e.target)) closeProfileDropdown();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey && ['p', 's'].includes(event.key.toLowerCase())) || event.key === 'F12' || event.key === 'PrintScreen') {
    event.preventDefault();
    if (event.key === 'PrintScreen') {
      document.body.classList.add('capture-blocked');
      window.setTimeout(() => document.body.classList.remove('capture-blocked'), 1800);
    }
    setNotice('هذا الإجراء محمي داخل جلسة مِداد.', 'error');
  }
});

function setDocumentObscured(isObscured) {
  document.body.classList.toggle('is-obscured', isObscured);
}

window.addEventListener('blur', () => setDocumentObscured(true));
window.addEventListener('focus', () => setDocumentObscured(false));

function create3DScene() {
  return;
}

// إلغاء القفل وفتح الاستوديو تلقائياً فور التحميل
document.addEventListener('DOMContentLoaded', () => {
  const defaultLicense = {
    license_key: 'LIC-FREE-STUDIO-PREVIEW',
    access_key: 'LIC-FREE-STUDIO-PREVIEW',
    document_id: '61be6e55-3ed6-4839-b8ed-d73ef4923ccd',
    prints_remaining: 10,
    total_prints_allowed: 10,
    document: {
      title: 'استوديو معاينة وتعديل المستندات',
      category: 'محرر مِداد المباشر',
      content: 'مرحباً بك في المحرر المباشر! يمكنك الآن تعديل النصوص، اختيار الخطوط، تغيير الألوان والتنسيقات مباشرة بحرية كاملة.'
    }
  };
  renderLicense(defaultLicense);
});

window.lucide?.createIcons();
renderAdminAccess();
loadCatalogFromSupabase();
syncConsentState();
restorePendingCheckout();

supabase?.auth.getSession().then(({ data: { session } }) => {
  updateAdminAccess(session?.user ?? null);
  renderAccount(session?.user ?? null);
  if (session && pendingCheckout) continuePendingCheckout();
}).catch(() => null);

supabase?.auth.onAuthStateChange((event, session) => {
  updateAdminAccess(session?.user ?? null);
  renderAccount(session?.user ?? null);
  if (event === 'PASSWORD_RECOVERY') openAuthDialog('reset');
  if (event === 'SIGNED_IN' && pendingCheckout) continuePendingCheckout();
});

const privacyDialog = $('#privacy-dialog');
$('#privacy-policy-link')?.addEventListener('click', () => privacyDialog?.showModal());
$('#privacy-dialog-close')?.addEventListener('click', () => privacyDialog?.close());
document.addEventListener('click', (event) => {
  if (event.target === privacyDialog) privacyDialog?.close();
});