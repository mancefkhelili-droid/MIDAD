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
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const documentCatalog = Object.create(null);
let selectedDocument = 'certificate';
let selectedQuantity = 1;
let pendingPurchase = null;
let authMode = 'login';
let purchaseAuthCheckPending = false;
let checkoutReturnStarted = false;
let pendingReturnStatus = new URLSearchParams(window.location.search).get('status');
const PENDING_PURCHASE_KEY = 'pending-purchase';
let isAdmin = false;
let adminCheckedFor = null;
let currentUser = null;
let plans = [];
let subSummary = null;
let trialClaimed = true;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

function savePendingPurchase(purchase) {
  pendingPurchase = purchase;
  sessionStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(purchase));
}

function restorePendingPurchase() {
  const savedPurchase = sessionStorage.getItem(PENDING_PURCHASE_KEY);
  if (!savedPurchase) return null;
  try {
    pendingPurchase = JSON.parse(savedPurchase);
  } catch {
    sessionStorage.removeItem(PENDING_PURCHASE_KEY);
  }
  return pendingPurchase;
}

const $ = (selector) => document.querySelector(selector);

// Cloudflare Turnstile (free CAPTCHA). Paste your SITE key here (the public one).
// Leave it empty to run without CAPTCHA. Enable it in Supabase only AFTER filling this in.
const TURNSTILE_SITE_KEY = '';
let captchaToken = '';
let captchaWidgetId = null;
let turnstileLoading = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoading) return turnstileLoading;
  turnstileLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { turnstileLoading = null; reject(new Error('turnstile')); };
    document.head.appendChild(script);
  });
  return turnstileLoading;
}

async function setupCaptcha(mode) {
  const box = $('#captcha-box');
  if (!box) return;
  const needed = Boolean(TURNSTILE_SITE_KEY) && mode !== 'reset';
  box.classList.toggle('is-hidden', !needed);
  if (!needed) return;
  try {
    const turnstile = await loadTurnstile();
    if (captchaWidgetId === null) {
      captchaWidgetId = turnstile.render(box, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'light',
        language: 'ar',
        callback: (token) => { captchaToken = token; },
        'expired-callback': () => { captchaToken = ''; },
        'error-callback': () => { captchaToken = ''; }
      });
    } else {
      captchaToken = '';
      turnstile.reset(captchaWidgetId);
    }
  } catch (_) {
    setAuthFeedback('تعذر تحميل التحقق البشري. تحقق من الاتصال ثم حدّث الصفحة.', 'error');
  }
}

function resetCaptcha() {
  captchaToken = '';
  if (captchaWidgetId !== null && window.turnstile) window.turnstile.reset(captchaWidgetId);
}
let activeLicense = null;

function addDocumentCardToCatalog(id, title, price, category = 'وثيقة معتمدة', summary = '', previewUrl = '', sheets = 1) {
  documentCatalog[id] = { title, price: Number(price), category, document_id: id, summary, previewUrl, sheets: Number(sheets) || 1 };
  const existingCard = document.querySelector(`.catalog-card[data-document="${id}"]`);
  if (existingCard) existingCard.remove();
  const card = document.createElement('article');
  card.className = 'catalog-card uploaded-catalog-card';
  card.dataset.document = id;
  let preview;
  if (previewUrl) {
    // Real first-page preview: a normal block above the text (never overlaps it), shown whole.
    preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'catalog-thumb';
    preview.setAttribute('aria-label', `معاينة الوثيقة: ${title}`);
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = `معاينة ${title}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => smoothDownscale(image, 300), { once: true });
    const hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'اضغط للتكبير';
    preview.append(image, hint);
    preview.addEventListener('click', () => openPreview(id));
  } else {
    preview = document.createElement('div');
    preview.className = 'catalog-preview uploaded-preview';
    const previewIcon = document.createElement('i');
    previewIcon.dataset.lucide = 'file-text';
    const previewLabel = document.createElement('span');
    previewLabel.textContent = 'مِداد';
    preview.append(previewIcon, previewLabel);
  }
  const body = document.createElement('div');
  body.className = 'catalog-card-body';
  const type = document.createElement('span');
  type.className = 'catalog-type';
  type.textContent = category;
  const heading = document.createElement('h2');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = summary || 'وثيقة رسمية قابلة للتحقق والطباعة المعتمدة.';
  const footer = document.createElement('div');
  footer.className = 'catalog-footer';
  const priceLabel = document.createElement('strong');
  priceLabel.append(document.createTextNode(`${Number(price)} `));
  const priceUnit = document.createElement('small');
  priceUnit.textContent = 'دج / نسخة';
  priceLabel.append(priceUnit);
  const buyButton = document.createElement('button');
  buyButton.className = 'buy-button';
  buyButton.dataset.buy = id;
  buyButton.type = 'button';
  buyButton.append(document.createTextNode('شراء الوثيقة '));
  const buyIcon = document.createElement('i');
  buyIcon.dataset.lucide = 'arrow-left';
  buyButton.append(buyIcon);
  footer.append(priceLabel, buyButton);
  const extra = document.createElement('div');
  extra.className = 'card-extra';
  body.append(type, heading, description, footer, extra);
  card.append(preview, body);
  $('.document-catalog')?.appendChild(card);
  buyButton.addEventListener('click', () => openPurchase(id));
  updateCardActions();
  window.lucide?.createIcons();
}

function openPreview(id) {
  const item = documentCatalog[id];
  const dialog = $('#preview-dialog');
  if (!item || !item.previewUrl || !dialog) return;
  $('#preview-title').textContent = item.title;
  $('#preview-image').src = item.previewUrl;
  $('#preview-image').alt = `معاينة ${item.title}`;
  dialog.dataset.document = id;
  if (!dialog.open) dialog.showModal();
}

async function loadCatalogFromSupabase() {
  const catalog = $('.document-catalog');
  if (!catalog) return;
  catalog.replaceChildren(...[1, 2, 3].map(() => Object.assign(document.createElement('div'), { className: 'skeleton-card' })));
  if (!supabase) {
    catalog.textContent = 'تعذر الاتصال بمكتبة الوثائق الآن.';
    return;
  }
  try {
    const { data: docs, error } = await supabase.from('documents').select('id, title, summary, price_per_copy, preview_path, is_published, sheets').eq('is_published', true).order('created_at', { ascending: false });
    if (error || !docs) {
      catalog.textContent = 'تعذر تحميل الوثائق. تحقق من اتصالك ثم أعد المحاولة.';
      return;
    }
    catalog.replaceChildren();
    if (!docs.length) {
      catalog.textContent = 'لا توجد وثائق متاحة حاليًا.';
      return;
    }
    $('#catalog-search')?.classList.toggle('is-hidden', docs.length < 8);
    docs.forEach((doc) => {
      const previewUrl = doc.preview_path ? supabase.storage.from('previews').getPublicUrl(doc.preview_path).data.publicUrl : '';
      addDocumentCardToCatalog(doc.id, doc.title, doc.price_per_copy, 'وثيقة معتمدة', doc.summary || '', previewUrl, doc.sheets);
    });
    renderLandingGallery(docs);
  } catch (_) {
    catalog.textContent = 'تعذر تحميل الوثائق. تحقق من اتصالك ثم أعد المحاولة.';
  }
}

function renderAccount(user) {
  const loginTrigger = $('#login-trigger');
  const userProfile = $('#user-profile');
  const userChanged = (user?.id ?? null) !== (currentUser?.id ?? null);
  currentUser = user ?? null;
  if (!user) {
    loginTrigger?.classList.remove('is-hidden');
    userProfile?.classList.add('is-hidden');
    closeProfileDropdown();
    refreshAdminState(null);
    refreshSubscription(null);
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
  if ($('#profile-role')) $('#profile-role').textContent = 'مشتري';
  refreshAdminState(user);
  if (userChanged) refreshSubscription(user);
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

async function fetchDocumentTitles(ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length || !supabase) return {};
  try {
    const { data } = await supabase.from('documents').select('id,title').in('id', unique);
    return Object.fromEntries((data ?? []).map((doc) => [doc.id, doc.title]));
  } catch (_) {
    return {};
  }
}

async function loadAccountHistory() {
  const list = $('#account-orders');
  const licensesList = $('#account-licenses');
  const summary = $('#account-summary');
  if (!list || !licensesList) return;
  list.textContent = 'جارٍ تحميل الطلبات...';
  licensesList.textContent = 'جارٍ تحميل التراخيص...';
  try {
    const [orderResult, licenseResult] = await Promise.all([
      supabase.from('orders').select('id,calculated_price,copies_count,status,created_at,document_id,plan,payment_method,manual_receipt_path,manual_rejection_reason,manual_reference').order('created_at', { ascending: false }),
      supabase.from('print_licenses').select('id,license_key,document_id,remaining_prints,order_id').order('created_at', { ascending: false })
    ]);
    const titles = await fetchDocumentTitles([...(orderResult.data ?? []).map((o) => o.document_id), ...(licenseResult.data ?? []).map((l) => l.document_id)]);
    if (orderResult.error) {
      list.textContent = 'تعذر تحميل الطلبات الآن. تحقق من اتصالك ثم أعد المحاولة.';
      if (summary) summary.textContent = 'تعذر تحميل البيانات';
    } else {
      const orders = orderResult.data ?? [];
      if (summary) summary.textContent = `${orders.length} طلبات محفوظة في حسابك`;
      if (!orders.length) list.textContent = 'لا توجد طلبات بعد.';
      else list.replaceChildren(...orders.map((order) => {
        const manualPending = order.payment_method === 'manual' && order.status === 'pending';
        const status = order.status === 'paid' ? 'مدفوع' : order.status === 'failed' ? 'مرفوض/فشل' : manualPending ? (order.manual_receipt_path ? 'قيد المراجعة' : 'بانتظار الإيصال') : 'قيد الانتظار';
        const article = document.createElement('article');
        article.className = 'order-item';
        const top = document.createElement('div');
        top.className = 'order-item-top';
        const title = document.createElement('span');
        title.textContent = order.plan ? `اشتراك ${plans.find((p) => p.code === order.plan)?.name ?? ''}`.trim() : (titles[order.document_id] ?? 'وثيقة غير متاحة');
        const state = document.createElement('span');
        state.textContent = status;
        top.append(title, state);
        const details = document.createElement('small');
        details.textContent = order.plan
          ? `اشتراك شهري / ${order.calculated_price} دج / ${new Date(order.created_at).toLocaleDateString('ar-DZ')}`
          : `${order.copies_count} نسخة / ${order.calculated_price} دج / ${new Date(order.created_at).toLocaleDateString('ar-DZ')}`;
        article.append(top, details);
        if (order.status === 'failed' && order.manual_rejection_reason) { const r = document.createElement('small'); r.textContent = 'سبب الرفض: ' + order.manual_rejection_reason; article.append(r); }
        if (manualPending && !order.manual_receipt_path) { const b = document.createElement('button'); b.type = 'button'; b.className = 'admin-mini'; b.textContent = 'أكمل الدفع'; b.addEventListener('click', () => { $('#account-dialog')?.close(); openManualDialog({ order_id: order.id, manual_reference: order.manual_reference, amount: order.calculated_price }); }); article.append(b); }
        return article;
      }));
    }
    if (licenseResult.error) {
      licensesList.textContent = 'تعذر تحميل التراخيص الآن. تحقق من اتصالك ثم أعد المحاولة.';
      return;
    }
    const licenses = licenseResult.data ?? [];
    if (!licenses.length) {
      licensesList.textContent = 'لا توجد تراخيص بعد.';
      return;
    }
    licensesList.replaceChildren(...licenses.map((license) => {
      const article = document.createElement('article');
      article.className = 'order-item';
      const top = document.createElement('div');
      top.className = 'order-item-top';
      const title = document.createElement('span');
      title.textContent = titles[license.document_id] ?? 'وثيقة غير متاحة';
      const remaining = document.createElement('span');
      remaining.textContent = `${license.remaining_prints} نسخة متبقية`;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'card-extra-btn';
      open.textContent = 'فتح الوثيقة';
      open.addEventListener('click', async () => {
        try {
          const lic = await getLicense(license.license_key);
          if (!lic) return setNotice('تعذر فتح هذه الوثيقة الآن.', 'error');
          $('#account-dialog')?.close();
          renderLicense(lic);
          document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
          setNotice(error.message || 'تعذر فتح الوثيقة الآن.', 'error');
        }
      });
      top.append(title, remaining);
      article.append(top, open);
      return article;
    }));
  } catch (_) {
    list.textContent = 'تعذر تحميل الطلبات الآن. تحقق من اتصالك ثم أعد المحاولة.';
    if (summary) summary.textContent = 'تعذر تحميل البيانات';
    licensesList.textContent = 'تعذر تحميل التراخيص الآن. تحقق من اتصالك ثم أعد المحاولة.';
  }
}

function askConfirm(message, okLabel = 'متابعة', kicker = 'تأكيد') {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    if (!dialog) { resolve(true); return; }
    $('#confirm-text').textContent = message;
    $('#confirm-kicker').textContent = kicker;
    $('#confirm-ok span').textContent = okLabel;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      $('#confirm-ok').removeEventListener('click', ok);
      $('#confirm-cancel').removeEventListener('click', cancel);
      dialog.removeEventListener('close', cancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const ok = () => finish(true);
    const cancel = () => finish(false);
    $('#confirm-ok').addEventListener('click', ok);
    $('#confirm-cancel').addEventListener('click', cancel);
    dialog.addEventListener('close', cancel);
    dialog.showModal();
  });
}

function showToast(message, type = 'info') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.popover = 'manual'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  if (type === 'info' || type === '') box.querySelectorAll('.toast.info').forEach((t) => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type || 'info'}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button'; close.setAttribute('aria-label', 'إغلاق'); close.textContent = '×';
  const remove = () => { toast.classList.add('out'); window.setTimeout(() => toast.remove(), 200); };
  close.addEventListener('click', remove);
  toast.append(text, close);
  box.append(toast);
  while (box.children.length > 3) box.firstElementChild.remove();
  try { if (box.matches(':popover-open')) box.hidePopover(); box.showPopover(); } catch (_) {}
  if (type !== 'info' && type !== '') window.setTimeout(remove, type === 'error' ? 8000 : 6000);
  else window.setTimeout(remove, 4500);
}

function setNotice(message, type = '') {
  if (message) showToast(message, type || 'info');
  const notice = $('#notice');
  if (!notice) return;
  notice.className = `notice ${type}`;
  const icon = document.createElement('i');
  icon.dataset.lucide = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info';
  const text = document.createElement('span');
  text.textContent = message;
  notice.replaceChildren(icon, text);
  window.lucide?.createIcons();
}

function sanitizeDocumentHtml(value) {
  const source = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  const allowedTags = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (!allowedTags.has(node.tagName)) return document.createTextNode(node.textContent ?? '');
    const clean = document.createElement(node.tagName.toLowerCase());
    if (node.hasAttribute('dir') && ['ltr', 'rtl', 'auto'].includes(node.getAttribute('dir'))) clean.setAttribute('dir', node.getAttribute('dir'));
    for (const child of node.childNodes) clean.append(cleanNode(child));
    return clean;
  };
  const output = document.createDocumentFragment();
  for (const child of source.body.childNodes) output.append(cleanNode(child));
  return output;
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
  const isFile = Boolean(license?.document?.storage_path);
  const lockedPdf = isFile || Boolean(license?.isShop);
  $('#pdf-toolbar')?.classList.toggle('is-hidden', !(isFile && !license?.isShop));
  $('#document-paper')?.classList.toggle('pdf-mode', isFile);
  initPdfToolbar();
  if (editBadge) editBadge.classList.toggle('is-hidden', lockedPdf);
  if (toolbar) toolbar.classList.toggle('is-hidden', lockedPdf);

  document.querySelectorAll('.editable-field').forEach((el) => {
    el.setAttribute('contenteditable', lockedPdf ? 'false' : 'true');
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
    $('#btn-ul')?.addEventListener('click', () => document.execCommand('insertUnorderedList', false, null));
    $('#btn-ol')?.addEventListener('click', () => document.execCommand('insertOrderedList', false, null));
    $('#btn-undo')?.addEventListener('click', () => document.execCommand('undo', false, null));
    $('#btn-redo')?.addEventListener('click', () => document.execCommand('redo', false, null));

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
      if ($('#document-content') && !activeLicense.document.storage_path) $('#document-content').replaceChildren(sanitizeDocumentHtml(activeLicense.document.content ?? ''));
      const paper = $('#document-paper');
      if (paper) paper.className = 'document-paper';
      setNotice('تمت إعادة تعيين محتوى الوثيقة والتنسيقات إلى الوضع الأصلي.', 'info');
    });
  }
}

function renderLicense(license) {
  activeLicense = license;
  $('#security')?.classList.remove('is-hidden');
  const remaining = Math.max(0, Number(license.remaining_prints));
  const total = Math.max(remaining, Number(license.total_prints ?? remaining));
  const used = total - remaining;
  
  if ($('#doc-id')) $('#doc-id').textContent = license.license_key.slice(-6);
  if ($('#document-title')) $('#document-title').textContent = license.document.title;
  if ($('#doc-category')) $('#doc-category').textContent = license.document.category || 'وثيقة مرخصة';
  if ($('#license-key')) $('#license-key').value = license.license_key;
  const contentEl = $('#document-content');
  if (contentEl && !license.document.storage_path) {
    contentEl.classList.remove('is-pdf');
    contentEl.replaceChildren(sanitizeDocumentHtml(license.document.content ?? ''));
    restoreDraftHtml(license, contentEl);
  }

  setupInteractiveDocumentStudio(license);
  const isPdf = Boolean(license.document.storage_path);
  applyWatermark(license);
  if (contentEl && isPdf) renderPdfInto(contentEl, license.document.storage_path, license);
  else if (contentEl) contentEl.setAttribute('contenteditable', license.isShop ? 'false' : 'true');
  if ($('#counter-unit')) $('#counter-unit').textContent = 'نسخة متبقية';
  if ($('#counter-total-unit')) $('#counter-total-unit').textContent = 'طبعات';

  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${total ? Math.min(100, (used / total) * 100) : 0}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#535a34 ${total ? Math.max(0, (remaining / total) * 360) : 0}deg, #eef1e0 0deg)`;
  
  const stateEl = $('#license-state');
  if (stateEl) {
    stateEl.classList.add('active');
    stateEl.innerHTML = license.isAdmin ? '<span class="state-dot"></span> وضع الأدمن' : license.isSub ? '<span class="state-dot"></span> اشتراك فعّال' : license.isShop ? '<span class="state-dot"></span> وضع المطبعة' : '<span class="state-dot"></span> مفعل الآن';
  }
  if (license.isAdmin) {
    const symbol = '∞';
    if ($('#prints-remaining')) $('#prints-remaining').textContent = symbol;
    if ($('#prints-used')) $('#prints-used').textContent = '0';
    if ($('#total-prints')) $('#total-prints').textContent = symbol;
    if ($('#progress-bar')) $('#progress-bar').style.width = '0%';
    if ($('#counter-ring')) $('#counter-ring').style.background = 'conic-gradient(#535a34 360deg, #eef1e0 0deg)';
    if ($('#license-key')) $('#license-key').value = '';
  }
  
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = !license.isAdmin && remaining <= 0;
  const canShop = !license.isAdmin && !license.isShop && remaining > 0;
  $('#shop-open')?.classList.toggle('is-hidden', !canShop);
  $('#shop-hint')?.classList.toggle('is-hidden', !canShop);
  
  if (license.isSub) renderSubCounters(license);
  const wmInfo = 'العلامة المائية باسم بريدك تظهر على الشاشة فقط ولن تُطبع.';
  if (license.isAdmin) setNotice(`وضع الأدمن: تعرض وتطبع أي وثيقة بدون دفع وبدون خصم نسخ. ${wmInfo}`, 'info');
  else if (license.isSub) setNotice(`تم فتح الوثيقة من اشتراكك. كل طباعة تخصم ${license.sheets} ورقة من رصيدك. ${wmInfo}`, 'success');
  else if (license.isShop) setNotice(`وضع المطبعة: فتح الوثيقة لا يخصم شيئًا، وتُخصم نسخة واحدة من ترخيص الزبون عند كل طباعة (المتبقي ${remaining})${license.shopExpiresAt ? ` ، والرمز صالح حتى ${new Date(license.shopExpiresAt).toLocaleString('ar-DZ', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. ${wmInfo}`, 'success');
  else setNotice(isPdf ? `تم تفعيل المستند. أضف نصًا فوق الملف أينما تريد من شريط الأدوات ثم اطبع. ${wmInfo}` : `تم تفعيل المستند بنجاح. يمكنك تعديله قبل الطباعة. ${wmInfo}`, 'success');
  window.lucide?.createIcons();
}

async function getLicense(key) {
  const cleanKey = key.trim().toUpperCase();
  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  let user;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch (_) {
    throw new Error('تعذر الاتصال بخدمة التراخيص. تحقق من اتصالك ثم حاول مرة أخرى.');
  }
  if (!user) throw new Error('سجّل الدخول قبل تفعيل الترخيص.');
  let result;
  try {
    // The server returns the paid content only to the account that owns this license.
    result = await supabase.rpc('get_licensed_document', { p_license_key: cleanKey });
  } catch (_) {
    throw new Error('تعذر التحقق من الترخيص الآن. تحقق من اتصالك ثم حاول مرة أخرى.');
  }
  const { data, error } = result;
  if (error) throw new Error('تعذر التحقق من الترخيص الآن. حاول مرة أخرى.');
  if (!data) return null;
  return {
    license_key: data.license_key,
    document_id: data.document_id,
    remaining_prints: Number(data.remaining_prints),
    order_id: data.order_id,
    email: data.email ?? '',
    total_prints: Number(data.copies_count ?? data.remaining_prints),
    document: { title: data.title, content: data.content ?? '', storage_path: data.storage_path ?? null, category: 'وثيقة مرخصة' }
  };
}

// ---------- Watermark: the buyer's e-mail (from the server) is burned into every page ----------
let watermarkText = '';

async function applyWatermark(license) {
  let email = license?.email || '';
  if (!email && supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      email = session?.user?.email || '';
    } catch (_) { /* fall back to the key only */ }
  }
  const tail = license?.watermarkTag ?? String(license?.license_key ?? '').slice(-6);
  watermarkText = `${email || 'MEDAD'} · ${tail}`;
  document.querySelectorAll('.paper-watermark').forEach((element) => {
    element.textContent = watermarkText;
    element.dataset.watermark = watermarkText;
  });
  document.body.dataset.printWatermark = watermarkText;
  ensureWatermarkOverlay();
  const paperEl = $('#document-paper');
  if (paperEl?.parentElement) {
    let banner = $('#wm-banner');
    if (!banner) { banner = document.createElement('div'); banner.id = 'wm-banner'; paperEl.parentElement.insertBefore(banner, paperEl); }
    banner.hidden = Boolean(license?.isAdmin);
    banner.textContent = email ? `🔒 هذه النسخة مسجّلة باسم ${email} — العلامة المائية تظهر على الشاشة فقط ولن تُطبع مع النسخة.` : '🔒 العلامة المائية تظهر على الشاشة فقط ولن تُطبع مع النسخة.';
  }
  return watermarkText;
}

function ensureWatermarkOverlay() {
  const paper = $('#document-paper');
  if (!paper || !watermarkText) return null;
  paper.querySelector('#watermark-tiles')?.remove();
  const NS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElement('div');
  overlay.id = 'watermark-tiles';
  overlay.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const defs = document.createElementNS(NS, 'defs');
  const pattern = document.createElementNS(NS, 'pattern');
  pattern.setAttribute('id', 'wm-pattern');
  pattern.setAttribute('width', '380');
  pattern.setAttribute('height', '140');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', 'rotate(-28)');
  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', '14');
  label.setAttribute('y', '90');
  label.setAttribute('direction', 'ltr');
  label.setAttribute('text-anchor', 'start');
  label.style.direction = 'ltr';
  label.style.unicodeBidi = 'isolate';
  label.setAttribute('font-size', '21');
  label.setAttribute('font-weight', '700');
  label.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
  label.setAttribute('fill', '#2c3020');
  label.setAttribute('fill-opacity', '0.3');
  label.textContent = watermarkText;
  pattern.appendChild(label);
  defs.appendChild(pattern);
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('width', '100%');
  rect.setAttribute('height', '100%');
  rect.setAttribute('fill', 'url(#wm-pattern)');
  svg.append(defs, rect);
  overlay.appendChild(svg);
  paper.appendChild(overlay);
  return overlay;
}

let pdfRenderToken = 0;
const MAX_PDF_PAGES = 80;
let annotSelected = null;
let annotPlacing = null;
let pdfToolbarReady = false;
let annotImageData = null;
let annotZ = 5;
let annotHist = [];
let annotHistIdx = -1;
let annotTimer = null;
let annotRestoring = false;

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const ANNOT_FONTS = [
  ['تجوال', "'Tajawal', sans-serif"], ['القاهرة', "'Cairo', sans-serif"], ['أميري', "'Amiri', serif"],
  ['المراعي', "'Almarai', sans-serif"], ['تقليدي', "'Traditional Arabic', serif"], ['Monospace', "'Courier New', monospace"]
];
const annotPrefs = { size: 2.4, color: '#1c1e14', bold: false, italic: false, underline: false, align: 'right', font: ANNOT_FONTS[0][1], fill: '', stroke: '#535a34', sw: 0.3, op: 1 };

function annotDefaults(type) {
  const base = { t: type, x: 20, y: 20, rot: 0, op: 1, z: ++annotZ };
  if (type === 'text') return { ...base, w: null, text: 'نص جديد', size: annotPrefs.size, color: annotPrefs.color, bold: annotPrefs.bold, italic: annotPrefs.italic, underline: annotPrefs.underline, align: annotPrefs.align, font: annotPrefs.font, fill: '' };
  if (type === 'line') return { ...base, w: 40, h: 0, stroke: annotPrefs.stroke, sw: Math.max(0.2, annotPrefs.sw), fill: '' };
  if (type === 'cover') return { ...base, w: 30, h: 6, fill: '#ffffff', stroke: '', sw: 0 };
  if (type === 'image') return { ...base, w: 30, h: 20, fill: '', stroke: '', sw: 0, src: annotImageData };
  return { ...base, w: type === 'ellipse' ? 24 : 30, h: type === 'ellipse' ? 14 : 12, fill: annotPrefs.fill, stroke: annotPrefs.stroke, sw: annotPrefs.sw };
}

function applyAnnot(el) {
  const d = el._d;
  const s = el.style;
  el.dataset.type = d.t;
  s.left = `${d.x}%`;
  s.top = `${d.y}%`;
  s.zIndex = String(d.z || 5);
  s.opacity = String(d.op ?? 1);
  s.transform = d.rot ? `rotate(${d.rot}deg)` : '';
  if (d.t === 'text') {
    s.fontSize = `${d.size}cqw`;
    s.color = d.color;
    s.fontWeight = d.bold ? '700' : '400';
    s.fontStyle = d.italic ? 'italic' : 'normal';
    s.textDecoration = d.underline ? 'underline' : 'none';
    s.textAlign = d.align;
    s.fontFamily = d.font;
    s.backgroundColor = d.fill || 'transparent';
    s.width = d.w ? `${d.w}%` : '';
  } else if (d.t === 'line') {
    s.width = `${d.w}%`;
    s.height = `${d.sw}cqw`;
    s.backgroundColor = d.stroke;
  } else {
    s.width = `${d.w}%`;
    s.height = `${d.h}%`;
    s.backgroundColor = d.fill || 'transparent';
    s.border = d.sw && d.stroke ? `${d.sw}cqw solid ${d.stroke}` : '0';
    s.borderRadius = d.t === 'ellipse' ? '50%' : '0';
  }
}

function annotSnapshot() {
  return JSON.stringify([...document.querySelectorAll('.annot-layer')].map((layer) => [...layer.children].filter((e) => e._d).map((e) => ({ ...e._d }))));
}

function updateHistoryButtons() {
  const html = dockMode() === 'html';
  const undo = $('#dock-undo');
  const redo = $('#dock-redo');
  if (undo) undo.disabled = html ? false : annotHistIdx <= 0;
  if (redo) redo.disabled = html ? false : annotHistIdx >= annotHist.length - 1;
}

function commitAnnots(immediate = false) {
  if (annotRestoring) return;
  window.clearTimeout(annotTimer);
  const run = () => {
    annotTimer = null;
    const snap = annotSnapshot();
    if (annotHist[annotHistIdx] === snap) return;
    annotHist = annotHist.slice(0, annotHistIdx + 1);
    annotHist.push(snap);
    if (annotHist.length > 60) annotHist.shift();
    annotHistIdx = annotHist.length - 1;
    updateHistoryButtons();
    saveDraftPdf(snap);
  };
  if (immediate) run(); else annotTimer = window.setTimeout(run, 400);
}

function flushAnnotCommit() {
  if (annotTimer) { window.clearTimeout(annotTimer); annotTimer = null; commitAnnots(true); }
}

function restoreAnnots(index) {
  annotRestoring = true;
  const data = JSON.parse(annotHist[index]);
  document.querySelectorAll('.annot-layer').forEach((layer, i) => {
    layer.replaceChildren();
    (data[i] || []).forEach((d) => buildAnnot(layer, d));
  });
  annotSelected = null;
  annotHistIdx = index;
  annotRestoring = false;
  updateHistoryButtons();
  dockRender();
}

function resetAnnotHistory() {
  annotHist = [annotSnapshot()];
  annotHistIdx = 0;
  updateHistoryButtons();
}

function undoAnnots() { flushAnnotCommit(); if (annotHistIdx > 0) restoreAnnots(annotHistIdx - 1); }
function redoAnnots() { flushAnnotCommit(); if (annotHistIdx < annotHist.length - 1) restoreAnnots(annotHistIdx + 1); }

function setPlacing(type) {
  annotPlacing = type || null;
  document.body.classList.toggle('annot-placing', Boolean(type));
  if (type) setNotice(type === 'text' ? 'اضغط على الصفحة في المكان الذي تريد الكتابة فيه.' : 'اضغط على الصفحة لوضع العنصر.', 'info');
  dockRender();
}

function selectAnnot(element) {
  if (annotSelected === element) return;
  annotSelected?.classList.remove('selected');
  annotSelected = element;
  element?.classList.add('selected');
  if (element?._d && dockIsOpen && dockTab === 'add') dockTab = element._d.t === 'text' ? 'text' : 'shape';
  dockRender();
}

function buildAnnot(layer, d) {
  const el = document.createElement('div');
  el.className = 'annot';
  el._d = d;
  let text = null;
  const resizable = d.t !== 'text';
  if (d.t === 'text') {
    const handle = document.createElement('span');
    handle.className = 'annot-handle';
    handle.setAttribute('aria-label', 'تحريك النص');
    handle.textContent = '✥';
    text = document.createElement('div');
    text.className = 'annot-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.dir = 'auto';
    text.textContent = d.text;
    el.append(handle, text);
    text.addEventListener('focus', () => selectAnnot(el));
    text.addEventListener('input', () => { d.text = text.textContent; commitAnnots(); });
    text.addEventListener('paste', (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, (event.clipboardData || window.clipboardData)?.getData('text/plain') ?? '');
    });
    attachDrag(handle, el, layer);
  } else if (d.t === 'image') {
    const img = document.createElement('img');
    img.src = d.src;
    img.alt = '';
    img.draggable = false;
    el.append(img);
  }
  if (resizable) {
    const grip = document.createElement('span');
    grip.className = 'annot-resize';
    el.append(grip);
    attachResize(grip, el, layer);
    attachDrag(el, el, layer);
  }
  layer.append(el);
  applyAnnot(el);
  return el;
}

function attachDrag(trigger, el, layer) {
  trigger.addEventListener('pointerdown', (event) => {
    if (event.target.classList?.contains('annot-resize')) return;
    event.preventDefault();
    event.stopPropagation();
    selectAnnot(el);
    trigger.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const sx = event.clientX; const sy = event.clientY;
    const x0 = el._d.x; const y0 = el._d.y;
    let moved = false;
    const move = (e) => {
      moved = true;
      el._d.x = clampNumber(Math.round((x0 + ((e.clientX - sx) / rect.width) * 100) * 10) / 10, -5, 98);
      el._d.y = clampNumber(Math.round((y0 + ((e.clientY - sy) / rect.height) * 100) * 10) / 10, -5, 98);
      applyAnnot(el);
    };
    const stop = () => {
      trigger.removeEventListener('pointermove', move);
      trigger.removeEventListener('pointerup', stop);
      trigger.removeEventListener('pointercancel', stop);
      if (moved) commitAnnots(true);
    };
    trigger.addEventListener('pointermove', move);
    trigger.addEventListener('pointerup', stop);
    trigger.addEventListener('pointercancel', stop);
  });
}

function attachResize(grip, el, layer) {
  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectAnnot(el);
    grip.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const sx = event.clientX; const sy = event.clientY;
    const w0 = el._d.w; const h0 = el._d.h || 0;
    const move = (e) => {
      el._d.w = clampNumber(Math.round((w0 + ((e.clientX - sx) / rect.width) * 100) * 10) / 10, 2, 100);
      if (el._d.t !== 'line') el._d.h = clampNumber(Math.round((h0 + ((e.clientY - sy) / rect.height) * 100) * 10) / 10, 1, 100);
      applyAnnot(el);
    };
    const stop = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
      commitAnnots(true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  });
}

function placeAnnot(layer, type, xPct, yPct) {
  const d = annotDefaults(type);
  if (type === 'image') {
    const ratio = annotImageData?.ratio || 0.7;
    d.src = annotImageData.src;
    d.h = clampNumber(Math.round(d.w * ratio * (layer.clientWidth / Math.max(1, layer.clientHeight)) * 10) / 10, 2, 90);
  }
  d.x = clampNumber(xPct, 0, 96 - (d.w || 10) * 0.2);
  d.y = clampNumber(yPct, 0, 96);
  const el = buildAnnot(layer, d);
  selectAnnot(el);
  commitAnnots(true);
  if (type === 'text') {
    const text = el.querySelector('.annot-text');
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return el;
}

function wireAnnotLayer(layer) {
  layer.addEventListener('pointerdown', (event) => {
    if (event.target !== layer) return;
    if (annotPlacing) {
      event.preventDefault();
      const rect = layer.getBoundingClientRect();
      const type = annotPlacing;
      annotPlacing = null;
      document.body.classList.remove('annot-placing');
      placeAnnot(layer, type, ((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100);
    } else {
      selectAnnot(null);
    }
  });
}

// ---- property changes (apply to the selected element, and remember as the default for new ones)
function setAnnotProps(patch) {
  Object.keys(patch).forEach((k) => { if (k in annotPrefs) annotPrefs[k] = patch[k]; });
  const el = annotSelected;
  if (!el?._d) return;
  Object.assign(el._d, patch);
  applyAnnot(el);
  commitAnnots();
}

function annotAction(name) {
  const el = annotSelected;
  const d = el?._d;
  if (name === 'clear') {
    if (!document.querySelector('.annot')) return;
    askConfirm('سيُحذف كل ما أضفته على الملف.', 'احذف الكل', 'مسح الكل').then((yes) => {
      if (!yes) return;
      document.querySelectorAll('.annot').forEach((e) => e.remove());
      annotSelected = null;
      commitAnnots(true);
      dockRender();
    });
    return;
  }
  if (!d) return;
  const layer = el.parentElement;
  if (name === 'delete') { el.remove(); annotSelected = null; commitAnnots(true); dockRender(); return; }
  if (name === 'duplicate') {
    const copy = { ...d, x: Math.min(95, d.x + 3), y: Math.min(95, d.y + 3), z: ++annotZ };
    const e2 = buildAnnot(layer, copy);
    selectAnnot(e2);
    commitAnnots(true);
    return;
  }
  if (name === 'front') { d.z = ++annotZ; applyAnnot(el); commitAnnots(true); return; }
  if (name === 'back') { d.z = 1; applyAnnot(el); commitAnnots(true); return; }
  if (name === 'bigger' || name === 'smaller') {
    const f = name === 'bigger' ? 1.1 : 1 / 1.1;
    if (d.t === 'text') d.size = clampNumber(Math.round(d.size * f * 10) / 10, 1, 14);
    else { d.w = clampNumber(Math.round(d.w * f * 10) / 10, 2, 100); if (d.t !== 'line') d.h = clampNumber(Math.round(d.h * f * 10) / 10, 1, 100); }
    if (d.t === 'text') annotPrefs.size = d.size;
    applyAnnot(el);
    commitAnnots();
    return;
  }
  if (name.startsWith('rot')) {
    const delta = name === 'rot+' ? 15 : -15;
    d.rot = ((Math.round(d.rot || 0) + delta) % 360 + 360) % 360;
    applyAnnot(el);
    commitAnnots(true);
    dockRender();
    return;
  }
  const nudge = { left: [-0.6, 0], right: [0.6, 0], up: [0, -0.4], down: [0, 0.4] }[name];
  if (nudge) {
    d.x = clampNumber(Math.round((d.x + nudge[0]) * 10) / 10, -5, 98);
    d.y = clampNumber(Math.round((d.y + nudge[1]) * 10) / 10, -5, 98);
    applyAnnot(el);
    commitAnnots();
  }
}

function loadAnnotImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 6 * 1024 * 1024) { reject(new Error('bad')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        const max = 1100;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = file.type !== 'image/jpeg';
        resolve({ src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), ratio: canvas.height / canvas.width });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function initPdfToolbar() {
  if (pdfToolbarReady) return;
  pdfToolbarReady = true;
  $('#dock-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      annotImageData = await loadAnnotImage(file);
      dockOpen(false);
      setPlacing('image');
    } catch (_) {
      setNotice('تعذر استعمال الصورة. اختر PNG أو JPG أو WEBP أقل من 6 ميغابايت.', 'error');
    }
  });
}

// ---------- Bottom editing dock ----------
let dockIsOpen = false;
let dockTab = '';
let dockModeCached = '';

function dockMode() {
  const lic = activeLicense;
  if (!lic) return 'none';
  if (lic.isShop) return 'none';
  return lic.document?.storage_path ? 'pdf' : 'html';
}

function dockOpen(open) {
  dockIsOpen = open;
  $('#dock-panel')?.classList.toggle('is-hidden', !open);
  $('#dock-edit')?.classList.toggle('active', open);
  if (open) dockRender();
  dockPad();
}

function dockPad() {
  const dock = $('#edit-dock');
  if (!dock) return;
  document.body.style.paddingBottom = dock.classList.contains('is-hidden') ? '' : `${dock.offsetHeight + 12}px`;
}

const dockEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
function dBtn(label, icon, fn, active = false, danger = false) {
  const b = dockEl('button', `dock-btn${active ? ' active' : ''}${danger ? ' danger' : ''}`);
  b.type = 'button';
  if (icon) { const i = document.createElement('i'); i.dataset.lucide = icon; b.append(i); }
  if (label) b.append(dockEl('span', '', label));
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', fn);
  return b;
}
function dField(label, control) { const w = dockEl('label', 'dock-field'); w.append(dockEl('small', '', label), control); return w; }
function dSelect(options, value, onChange) {
  const s = dockEl('select', 'dock-select');
  options.forEach(([label, val]) => { const o = document.createElement('option'); o.value = val; o.textContent = label; if (String(val) === String(value)) o.selected = true; s.append(o); });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function dColor(value, onInput, allowNone = false, onNone = null) {
  const wrap = dockEl('span', 'dock-color');
  const c = document.createElement('input');
  c.type = 'color';
  c.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  c.addEventListener('input', () => onInput(c.value));
  wrap.append(c);
  if (allowNone) { const n = dockEl('button', 'dock-none', 'بدون'); n.type = 'button'; n.addEventListener('click', () => onNone?.()); wrap.append(n); }
  return wrap;
}
function dRange(min, max, step, value, onInput) {
  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value; r.className = 'dock-range';
  r.addEventListener('input', () => onInput(Number(r.value)));
  return r;
}
const proxyClick = (id) => () => document.getElementById(id)?.click();
function proxySelect(id) {
  const src = document.getElementById(id);
  if (!src) return document.createElement('span');
  const s = dockEl('select', 'dock-select');
  [...src.options].forEach((o) => { const c = document.createElement('option'); c.value = o.value; c.textContent = o.textContent.replace(/\s*[-(].*$/, ''); if (o.value === src.value) c.selected = true; s.append(c); });
  s.addEventListener('change', () => { src.value = s.value; src.dispatchEvent(new Event('change', { bubbles: true })); });
  return s;
}
function proxyColor(id) {
  const src = document.getElementById(id);
  const c = document.createElement('input');
  c.type = 'color';
  c.value = src?.value || '#000000';
  c.addEventListener('input', () => { if (src) { src.value = c.value; src.dispatchEvent(new Event('input', { bubbles: true })); src.dispatchEvent(new Event('change', { bubbles: true })); } });
  const w = dockEl('span', 'dock-color');
  w.append(c);
  return w;
}

function dockTabs(mode) {
  return mode === 'pdf'
    ? [['add', 'إضافة'], ['text', 'نص'], ['shape', 'شكل'], ['arrange', 'ترتيب']]
    : [['fmt', 'تنسيق'], ['align', 'محاذاة'], ['color', 'ألوان'], ['insert', 'إدراج']];
}

function dockBuildBody(mode, body) {
  const sel = annotSelected?._d;
  const row = () => { const r = dockEl('div', 'dock-row'); body.append(r); return r; };
  if (mode === 'pdf') {
    if (dockTab === 'add') {
      const r = row();
      [['نص', 'type', 'text'], ['مستطيل', 'square', 'rect'], ['دائرة', 'circle', 'ellipse'], ['خط', 'minus', 'line'], ['تغطية', 'eraser', 'cover']].forEach(([l, i, t]) => r.append(dBtn(l, i, () => { dockOpen(false); setPlacing(annotPlacing === t ? null : t); }, annotPlacing === t)));
      r.append(dBtn('صورة', 'image', () => $('#dock-file')?.click()));
      body.append(dockEl('p', 'dock-hint', 'اختر الأداة ثم اضغط على الصفحة. «تغطية» تخفي جزءًا من الملف بمستطيل (أبيض افتراضيًا) لتكتب فوقه.'));
    } else if (dockTab === 'text') {
      const cur = sel?.t === 'text' ? sel : annotPrefs;
      let r = row();
      r.append(dField('الخط', dSelect(ANNOT_FONTS.map(([l, v]) => [l, v]), cur.font, (v) => setAnnotProps({ font: v }))));
      r.append(dBtn('', 'minus', () => annotAction('smaller')), dBtn('', 'plus', () => annotAction('bigger')));
      r.append(dField('اللون', dColor(cur.color, (v) => setAnnotProps({ color: v }))));
      r = row();
      r.append(dBtn('', 'bold', () => { setAnnotProps({ bold: !cur.bold }); dockRender(); }, cur.bold), dBtn('', 'italic', () => { setAnnotProps({ italic: !cur.italic }); dockRender(); }, cur.italic), dBtn('', 'underline', () => { setAnnotProps({ underline: !cur.underline }); dockRender(); }, cur.underline));
      r.append(dBtn('', 'align-right', () => { setAnnotProps({ align: 'right' }); dockRender(); }, cur.align === 'right'), dBtn('', 'align-center', () => { setAnnotProps({ align: 'center' }); dockRender(); }, cur.align === 'center'), dBtn('', 'align-left', () => { setAnnotProps({ align: 'left' }); dockRender(); }, cur.align === 'left'));
      r = row();
      r.append(dField('خلفية النص', dColor(cur.fill || '#ffffff', (v) => setAnnotProps({ fill: v }), true, () => { setAnnotProps({ fill: '' }); dockRender(); })));
    } else if (dockTab === 'shape') {
      const cur = sel && sel.t !== 'text' ? sel : { ...annotPrefs };
      let r = row();
      r.append(dField('التعبئة', dColor(cur.fill || '#ffffff', (v) => setAnnotProps({ fill: v }), true, () => { setAnnotProps({ fill: '' }); dockRender(); })));
      r.append(dField('الحد', dColor(cur.stroke || '#535a34', (v) => setAnnotProps({ stroke: v }))));
      r.append(dField('السُّمك', dSelect([['بدون', 0], ['رفيع', 0.2], ['عادي', 0.4], ['سميك', 0.8], ['عريض', 1.4]], cur.sw, (v) => setAnnotProps({ sw: Number(v) }))));
      r = row();
      r.append(dField('الشفافية', dRange(0.1, 1, 0.05, sel?.op ?? 1, (v) => { if (annotSelected) setAnnotProps({ op: v }); })));
    } else if (dockTab === 'arrange') {
      if (!sel) { body.append(dockEl('p', 'dock-hint', 'اضغط على عنصر في الصفحة لتختاره أولًا.')); }
      let r = row();
      r.append(dBtn('', 'rotate-ccw', () => annotAction('rot-')), dBtn('', 'rotate-cw', () => annotAction('rot+')), dBtn('', 'zoom-out', () => annotAction('smaller')), dBtn('', 'zoom-in', () => annotAction('bigger')));
      r.append(dBtn('أمام', 'bring-to-front', () => annotAction('front')), dBtn('خلف', 'send-to-back', () => annotAction('back')));
      r = row();
      r.append(dBtn('', 'arrow-right', () => annotAction('right')), dBtn('', 'arrow-up', () => annotAction('up')), dBtn('', 'arrow-down', () => annotAction('down')), dBtn('', 'arrow-left', () => annotAction('left')));
      r.append(dBtn('نسخ', 'copy', () => annotAction('duplicate')), dBtn('حذف', 'trash-2', () => annotAction('delete'), false, true), dBtn('مسح الكل', '', () => annotAction('clear'), false, true));
      if (sel) { r = row(); r.append(dField('التدوير', dRange(0, 359, 1, sel.rot || 0, (v) => setAnnotProps({ rot: v })))); }
    }
  } else {
    let r;
    if (dockTab === 'fmt') {
      r = row();
      r.append(dField('الخط', proxySelect('toolbar-font-family')), dField('الحجم', proxySelect('toolbar-font-size')), dBtn('', 'minus', proxyClick('btn-font-decrease')), dBtn('', 'plus', proxyClick('btn-font-increase')));
      r = row();
      [['bold', 'btn-bold'], ['italic', 'btn-italic'], ['underline', 'btn-underline'], ['strikethrough', 'btn-strikethrough'], ['list', 'btn-ul'], ['list-ordered', 'btn-ol']].forEach(([i, id]) => r.append(dBtn('', i, proxyClick(id))));
    } else if (dockTab === 'align') {
      r = row();
      [['align-right', 'btn-align-right'], ['align-center', 'btn-align-center'], ['align-left', 'btn-align-left'], ['align-justify', 'btn-align-justify']].forEach(([i, id]) => r.append(dBtn('', i, proxyClick(id))));
      r = row();
      r.append(dField('تباعد الأسطر', proxySelect('toolbar-line-height')));
    } else if (dockTab === 'color') {
      r = row();
      r.append(dField('لون النص', proxyColor('toolbar-text-color')), dField('تظليل', proxyColor('toolbar-bg-color')), dField('لون الورقة', proxySelect('toolbar-paper-theme')));
    } else if (dockTab === 'insert') {
      r = row();
      r.append(dBtn('فقرة', 'plus-circle', proxyClick('btn-add-paragraph')), dBtn('المستفيد', 'user-check', proxyClick('btn-add-recipient')), dBtn('مسح التنسيق', 'remove-formatting', proxyClick('btn-clear-format')), dBtn('إعادة ضبط', 'rotate-ccw', proxyClick('btn-reset-doc'), false, true));
    }
  }
}

function dockRender() {
  const panel = $('#dock-panel');
  const tabsEl = $('#dock-tabs');
  const body = $('#dock-body');
  if (!panel || !tabsEl || !body) return;
  const mode = dockMode();
  if (mode !== dockModeCached) { dockModeCached = mode; dockTab = dockTabs(mode)[0]?.[0] ?? ''; if (dockIsOpen && mode === 'none') dockOpen(false); }
  $('#dock-edit')?.classList.toggle('is-hidden', mode === 'none');
  $('#dock-undo')?.classList.toggle('is-hidden', mode === 'none');
  $('#dock-redo')?.classList.toggle('is-hidden', mode === 'none');
  if (!dockIsOpen || mode === 'none') { dockPad(); return; }
  tabsEl.replaceChildren(...dockTabs(mode).map(([id, label]) => {
    const b = dockEl('button', `dock-tab${id === dockTab ? ' active' : ''}`, label);
    b.type = 'button';
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => { dockTab = id; dockRender(); });
    return b;
  }));
  body.replaceChildren();
  dockBuildBody(mode, body);
  window.lucide?.createIcons();
  dockPad();
}

(function initDock() {
  const dock = $('#edit-dock');
  const src = $('#prints-remaining');
  if (!dock || !src) return;
  const sync = () => {
    const open = !$('#security')?.classList.contains('is-hidden');
    dock.classList.toggle('is-hidden', !open);
    $('#mb-count').textContent = src.textContent;
    $('#mb-label').textContent = $('#counter-unit')?.textContent || 'المتبقي';
    $('#mb-print').disabled = Boolean($('#print-button')?.disabled);
    if (open && dockMode() !== dockModeCached) dockRender();
    dockPad();
  };
  const obs = new MutationObserver(sync);
  obs.observe(src, { childList: true, characterData: true, subtree: true });
  if ($('#counter-unit')) obs.observe($('#counter-unit'), { childList: true, characterData: true, subtree: true });
  if ($('#print-button')) obs.observe($('#print-button'), { attributes: true, attributeFilter: ['disabled'] });
  if ($('#security')) obs.observe($('#security'), { attributes: true, attributeFilter: ['class'] });
  if ($('#document-title')) obs.observe($('#document-title'), { childList: true, characterData: true, subtree: true });
  $('#mb-print').addEventListener('click', () => { setPlacing(null); $('#print-button')?.click(); });
  $('#dock-edit').addEventListener('click', () => dockOpen(!dockIsOpen));
  $('#dock-undo').addEventListener('click', () => (dockMode() === 'html' ? document.getElementById('btn-undo')?.click() : undoAnnots()));
  $('#dock-redo').addEventListener('click', () => (dockMode() === 'html' ? document.getElementById('btn-redo')?.click() : redoAnnots()));
  $('#dock-undo').addEventListener('pointerdown', (e) => e.preventDefault());
  $('#dock-redo').addEventListener('pointerdown', (e) => e.preventDefault());
  window.addEventListener('resize', dockPad);
  sync();
})();

async function renderPdfInto(container, path, license) {
  const token = ++pdfRenderToken;
  const message = (text) => {
    const p = document.createElement('p');
    p.textContent = text;
    container.replaceChildren(p);
  };
  container.classList.add('is-pdf');
  container.setAttribute('contenteditable', 'false');
  container.dataset.pdfReady = '0';
  annotSelected = null;
  annotHist = [];
  annotHistIdx = -1;
  message('جارٍ تحميل الوثيقة...');
  try {
    await applyWatermark(license);
    await pdfReady;
    if (!pdfjsLib) throw new Error('pdfjs');
    let bytes;
    if (license.signedUrl) {
      const response = await fetch(license.signedUrl);
      if (!response.ok) throw new Error('download');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      const { data: blob, error } = await supabase.storage.from('documents').download(path);
      if (error || !blob) throw error || new Error('download');
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (token !== pdfRenderToken) return;
    if (pdf.numPages > MAX_PDF_PAGES) {
      message(`الملف كبير جدًا للعرض (أكثر من ${MAX_PDF_PAGES} صفحة).`);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'pdf-pages';
    container.replaceChildren(wrap);
    const cssWidth = Math.min(Math.max(container.clientWidth || 600, 280), 900);
    const pixelWidth = Math.min(Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 2)), 1300);
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      if (token !== pdfRenderToken) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pixelWidth / base.width });
      const pageEl = document.createElement('div');
      pageEl.className = 'pdf-page';
      pageEl.style.setProperty('--ar', String(viewport.width / viewport.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `صفحة ${n} من ${pdf.numPages}`);
      const layer = document.createElement('div');
      layer.className = 'annot-layer';
      if (!license.isShop) wireAnnotLayer(layer);
      pageEl.append(canvas, layer);
      wrap.appendChild(pageEl);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (token === pdfRenderToken) { container.dataset.pdfReady = '1'; restoreDraftPdf(); resetAnnotHistory(); }
  } catch (_) {
    if (token === pdfRenderToken) message('تعذر عرض ملف الوثيقة. حدّث الصفحة وحاول مرة أخرى.');
  }
}

// Print ONLY the document: hide every element that is not the paper or one of its ancestors.
function preparePrintLayout() {
  const paper = $('#document-paper');
  const touched = [];
  let node = paper;
  while (node && node !== document.body && node.parentElement) {
    const parent = node.parentElement;
    if (node !== paper) {
      node.classList.add('print-keep');
      touched.push([node, 'print-keep']);
    }
    for (const sibling of parent.children) {
      if (sibling === node || ['SCRIPT', 'STYLE', 'LINK', 'META'].includes(sibling.tagName)) continue;
      sibling.classList.add('print-hide');
      touched.push([sibling, 'print-hide']);
    }
    node = parent;
  }
  return () => touched.forEach(([element, className]) => element.classList.remove(className));
}

async function processPrint(licenseKey, documentId) {
  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  let result;
  try {
    result = await supabase.functions.invoke('decrement-print-counter', { body: { license_key: licenseKey, document_id: documentId } });
  } catch (_) {
    throw new Error('تعذر الاتصال بخدمة الطباعة. لم تتم الطباعة؛ حاول مرة أخرى.');
  }
  const { data, error } = result;
  if (error || data?.success !== true || !Number.isFinite(Number(data.remaining_prints))) throw new Error('تعذر إجراء الطباعة. تحقق من اتصالك أو من عدد النسخ المتبقية.');
  return { ...activeLicense, remaining_prints: Number(data.remaining_prints) };
}

$('#activation-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('#license-key')?.value.trim().toUpperCase();
  if (!key || !key.startsWith('LIC-') || key.length < 12) {
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

$('#print-button')?.addEventListener('click', async () => {
  if (!activeLicense || (!activeLicense.isAdmin && activeLicense.remaining_prints <= 0) || !supabase) return;
  const button = $('#print-button');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    if (!activeLicense.isShop) {
    let authResult;
    try {
      authResult = await supabase.auth.getUser();
    } catch (_) {
      openAuthDialog('login');
      setNotice('سجّل الدخول بالحساب المرتبط بالترخيص قبل الطباعة.', 'error');
      return;
    }
    const user = authResult.data?.user;
    if (!user) {
      openAuthDialog('login');
      setNotice('سجّل الدخول بالحساب المرتبط بالترخيص قبل الطباعة.', 'error');
      return;
    }
    if (authResult.error) throw new Error('تعذر التحقق من جلسة الدخول. حاول مرة أخرى.');
    }
    if (activeLicense.document.storage_path && $('#document-content')?.dataset.pdfReady !== '1') throw new Error('انتظر حتى يكتمل تحميل الملف ثم اطبع.');
    if (!activeLicense.isAdmin && !(await askConfirm(activeLicense.isSub ? `ستُخصم ${activeLicense.sheets} ورقة من رصيدك عند الطباعة. هل تريد المتابعة؟` : activeLicense.isShop ? 'ستُخصم نسخة واحدة من رصيد الزبون. هل تريد المتابعة؟' : 'ستُخصم نسخة واحدة من رصيدك ولا يمكن استرجاعها. هل تريد المتابعة؟', 'اطبع الآن', 'تأكيد الطباعة'))) return;
    if (activeLicense.isAdmin) {
      const { data: adminCheck } = await supabase.rpc('admin_get_document', { p_id: activeLicense.document_id });
      if (!adminCheck) throw new Error('صلاحية الأدمن غير متاحة. سجّل الدخول من جديد.');
    } else if (activeLicense.isShop) {
      const printed = await callPrintShop({ code: shopCode, action: 'print' });
      activeLicense = { ...activeLicense, remaining_prints: Number(printed.copies_left) };
      renderCounters(activeLicense);
    } else if (activeLicense.isSub) {
      activeLicense = await processSubPrint(activeLicense);
      renderCounters(activeLicense);
    } else {
      activeLicense = await processPrint(activeLicense.license_key, activeLicense.document_id);
      renderCounters(activeLicense);
    }
    setPlacing(false);
    selectAnnot(null);
    const restoreLayout = preparePrintLayout();
    if (activeLicense.document.storage_path) {
      const pageStyle = document.createElement('style');
      pageStyle.id = 'print-page-style';
      pageStyle.textContent = '@page { margin: 0; }';
      document.head.appendChild(pageStyle);
    }
    document.body.classList.add('authorized-print');
    setNotice(activeLicense.isAdmin ? 'وضع الأدمن: لم تُخصم أي نسخة. تُطبع الوثيقة بدون العلامة المائية.' : activeLicense.isShop ? `خُصمت نسخة من ترخيص الزبون (المتبقي ${activeLicense.remaining_prints}). تُطبع الوثيقة بدون العلامة المائية.` : 'تم حجز نسخة الطباعة. تُطبع الوثيقة بدون العلامة المائية، فهي تظهر على الشاشة فقط.', 'success');
    const cleanupPrint = () => {
      document.body.classList.remove('authorized-print');
      document.getElementById('print-page-style')?.remove();
      restoreLayout();
    };
    window.addEventListener('afterprint', cleanupPrint, { once: true });
    window.setTimeout(cleanupPrint, 300000);
    clearDraft();
    window.print();
  } catch (error) {
    setNotice(error.message || 'تعذر تنفيذ الطباعة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (button) button.disabled = !activeLicense?.isAdmin && activeLicense?.remaining_prints <= 0;
  }
});

// Updates only the counters (never rebuilds the document, so the user's edits are kept).
function renderCounters(license) {
  if (license.isSub) { renderSubCounters(license); return; }
  const remaining = Math.max(0, Number(license.remaining_prints));
  const total = Math.max(remaining, Number(license.total_prints ?? remaining));
  const used = total - remaining;
  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${total ? Math.min(100, (used / total) * 100) : 0}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#535a34 ${total ? Math.max(0, (remaining / total) * 360) : 0}deg, #eef1e0 0deg)`;
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = remaining <= 0;
  if (remaining <= 0) {
    $('#shop-open')?.classList.add('is-hidden');
    $('#shop-hint')?.classList.add('is-hidden');
  }
}


// ---------- Subscriptions, free trial, shop copies ----------
const copiesAvailable = (summary, sheets) => Math.floor(Number(summary?.unlimited ? (summary?.daily_remaining ?? 0) : (summary?.remaining ?? 0)) / Math.max(1, Number(sheets) || 1));
const subMaxCopies = (license) => Math.max(1, Math.min(100, copiesAvailable(license.summary ?? subSummary, license.sheets)));

async function loadPlans() {
  const grid = $('#plans-grid');
  if (!grid || !supabase) return;
  try {
    const { data, error } = await supabase.from('plans').select('*').eq('active', true).order('sort', { ascending: true });
    if (error || !data?.length) { grid.textContent = 'الباقات غير متاحة الآن.'; return; }
    plans = data;
    renderPlans();
  } catch (_) {
    grid.textContent = 'تعذر تحميل الباقات. حدّث الصفحة.';
  }
}

function renderPlans() {
  const grid = $('#plans-grid');
  if (!grid) return;
  grid.replaceChildren();
  plans.forEach((plan, index) => {
    const card = document.createElement('article');
    card.className = `plan-card${index === 1 ? ' featured' : ''}`;
    const name = document.createElement('h3');
    name.textContent = plan.name;
    const price = document.createElement('div');
    price.className = 'plan-price';
    price.textContent = `${Number(plan.price)} دج`;
    const per = document.createElement('small');
    per.textContent = ' / شهر';
    price.append(per);
    const sheets = document.createElement('p');
    sheets.className = 'plan-sheets';
    const base = plan.sheets_base;
    const bonus = Number(plan.sheets_bonus ?? 0);
    sheets.textContent = base == null ? 'طباعة غير محدودة (حتى 30 ورقة يوميًا)' : `${Number(base) + bonus} ورقة${bonus ? ` (${Number(base)} + ${bonus} هدية)` : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-button full-button';
    button.textContent = `اشترك بـ ${Number(plan.price)} دج`;
    button.addEventListener('click', () => subscribeToPlan(plan.code));
    card.append(name, price, sheets, button);
    grid.append(card);
  });
}

async function subscribeToPlan(code) {
  if (!supabase) return;
  $('#plans-dialog')?.close();
  let user = null;
  try { ({ data: { user } } = await supabase.auth.getUser()); } catch (_) {}
  if (!user) {
    savePendingPurchase({ planCode: code });
    openAuthDialog('login');
    return;
  }
  setNotice('جارٍ تحويلك إلى صفحة الدفع...', 'info');
  try {
    await startCheckout(null, null, code);
  } catch (error) {
    setNotice(error.message, 'error');
  }
}

async function refreshSubscription(user) {
  if (!user || !supabase) {
    subSummary = null;
    trialClaimed = false;
  } else {
    try {
      const [sub, trial] = await Promise.all([supabase.rpc('my_subscription'), supabase.rpc('my_trial_status')]);
      subSummary = sub.error ? null : sub.data;
      trialClaimed = trial.error ? true : Boolean(trial.data?.claimed);
    } catch (_) {
      subSummary = null;
    }
  }
  renderSubscriptionStatus();
  updateCardActions();
  if (activeLicense?.isSub && subSummary) { activeLicense = { ...activeLicense, summary: subSummary }; renderSubCounters(activeLicense); }
}

function renderSubscriptionStatus() {
  const badge = $('#sub-badge');
  if (badge) {
    const has = Boolean(currentUser && subSummary?.has_subscription);
    badge.classList.toggle('is-hidden', !has);
    if (has) badge.textContent = subSummary.unlimited ? `∞ • ${subSummary.daily_remaining} اليوم` : `${subSummary.remaining} ورقة`;
  }
  checkExpiryReminder();
  const banner = $('#trial-banner');
  const status = $('#sub-status');
  if (banner) {
    const show = !currentUser || !trialClaimed;
    banner.classList.toggle('is-hidden', !show);
    banner.textContent = show ? '🎁 نسخة واحدة مجانية لكل مستخدم جديد — اختر أي وثيقة من المكتبة وجرّبها.' : '';
  }
  if (status) {
    const sm = subSummary;
    if (sm?.has_subscription) {
      const until = sm.expires_at ? new Date(sm.expires_at).toLocaleDateString('ar-DZ', { dateStyle: 'medium' }) : '';
      status.textContent = `اشتراكك فعّال: ${sm.unlimited ? `غير محدود (المتبقي اليوم ${sm.daily_remaining} من ${sm.daily_limit} ورقة)` : `${sm.remaining} ورقة متبقية`}${until ? ` • ينتهي ${until}` : ''}`;
      status.classList.remove('is-hidden');
    } else {
      status.textContent = '';
      status.classList.add('is-hidden');
    }
  }
}

function updateCardActions() {
  document.querySelectorAll('.catalog-card .card-extra').forEach((extra) => {
    const id = extra.closest('[data-document]')?.dataset.document;
    if (!id || !documentCatalog[id]) return;
    extra.replaceChildren();
    const info = document.createElement('span');
    info.className = 'card-sheets';
    info.textContent = `${documentCatalog[id].sheets} ورقة`;
    extra.append(info);
    if (subSummary?.active) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card-extra-btn';
      b.textContent = 'افتح بالاشتراك';
      b.addEventListener('click', () => openWithSubscription(id));
      extra.append(b);
    }
    if (!currentUser || !trialClaimed) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card-extra-btn';
      b.textContent = 'جرّب مجانًا (نسخة واحدة)';
      b.addEventListener('click', () => claimTrial(id));
      extra.append(b);
    }
  });
}

async function claimTrial(documentId) {
  if (!supabase || !documentCatalog[documentId]) return;
  let user = null;
  try { ({ data: { user } } = await supabase.auth.getUser()); } catch (_) {}
  if (!user) {
    setNotice('سجّل الدخول أو أنشئ حسابًا لتحصل على نسختك المجانية.', 'info');
    openAuthDialog('signup');
    return;
  }
  if (!(await askConfirm(`ستستعمل نسختك المجانية الوحيدة على «${documentCatalog[documentId].title}». لا يمكن تغييرها بعد ذلك.`, 'نعم، استعملها', 'النسخة المجانية'))) return;
  try {
    const { data, error } = await supabase.rpc('claim_trial', { p_document_id: documentId });
    if (error) throw error;
    if (data?.status === 'already_claimed') { trialClaimed = true; renderSubscriptionStatus(); updateCardActions(); return setNotice('استعملت نسختك المجانية من قبل.', 'error'); }
    if (data?.status !== 'ok') return setNotice('تعذر تفعيل النسخة المجانية الآن.', 'error');
    trialClaimed = true;
    renderSubscriptionStatus();
    updateCardActions();
    const license = await getLicense(data.license_key);
    if (license) {
      renderLicense(license);
      document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (_) {
    setNotice('تعذر تفعيل النسخة المجانية الآن. حاول مرة أخرى.', 'error');
  }
}

async function openWithSubscription(documentId) {
  if (!supabase) return;
  setNotice('جارٍ فتح الوثيقة من اشتراكك...', 'info');
  try {
    const { data, error } = await supabase.rpc('get_subscribed_document', { p_document_id: documentId });
    if (error) throw error;
    if (data?.status === 'daily_limit') return setNotice('بلغت حدّ 30 ورقة لهذا اليوم. يتجدد الرصيد غدًا.', 'error');
    if (data?.status === 'no_sheets') return setNotice(`رصيدك (${data.remaining} ورقة) لا يكفي لهذه الوثيقة (${data.sheets} ورقة).`, 'error');
    if (data?.status !== 'ok') return setNotice('لا يوجد اشتراك فعّال.', 'error');
    subSummary = data.summary;
    renderSubscriptionStatus();
    const copies = copiesAvailable(data.summary, data.sheets);
    renderLicense({
      license_key: 'SUB-' + String(documentId).slice(0, 8).toUpperCase(),
      document_id: data.document_id,
      remaining_prints: copies,
      total_prints: copies,
      email: data.email ?? '',
      isSub: true,
      sheets: Number(data.sheets) || 1,
      summary: data.summary,
      document: { title: data.title, content: data.content ?? '', storage_path: data.storage_path ?? null, category: 'وثيقة (اشتراك)' }
    });
    document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {
    setNotice('تعذر فتح الوثيقة الآن. حاول مرة أخرى.', 'error');
  }
}

function renderSubCounters(license) {
  const sm = license.summary ?? subSummary ?? {};
  const unlimited = Boolean(sm.unlimited);
  const remaining = Math.max(0, Number(unlimited ? (sm.daily_remaining ?? 0) : (sm.remaining ?? 0)));
  const total = Math.max(remaining, Number(unlimited ? (sm.daily_limit ?? 30) : (sm.total ?? remaining)));
  const used = total - remaining;
  if ($('#counter-unit')) $('#counter-unit').textContent = unlimited ? 'ورقة متبقية اليوم' : 'ورقة متبقية';
  if ($('#counter-total-unit')) $('#counter-total-unit').textContent = 'ورقة';
  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = !total ? '0%' : `${Math.min(100, (used / total) * 100)}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#535a34 ${total ? (remaining / total) * 360 : 0}deg, #eef1e0 0deg)`;
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = remaining < Number(license.sheets || 1);
  const canShop = remaining >= Number(license.sheets || 1);
  $('#shop-open')?.classList.toggle('is-hidden', !canShop);
  $('#shop-hint')?.classList.toggle('is-hidden', !canShop);
}

async function processSubPrint(license) {
  const { data, error } = await supabase.rpc('print_document', { p_document_id: license.document_id, p_copies: 1 });
  if (error || data?.status !== 'ok') {
    throw new Error(data?.status === 'daily_limit' ? 'بلغت حدّ 30 ورقة لهذا اليوم. يتجدد الرصيد غدًا.' : data?.status === 'no_sheets' ? 'رصيد أوراقك لا يكفي لطباعة هذه الوثيقة.' : 'تعذر إجراء الطباعة. تحقق من اتصالك أو من رصيدك.');
  }
  subSummary = data.summary;
  renderSubscriptionStatus();
  const copies = copiesAvailable(data.summary, license.sheets);
  return { ...license, summary: data.summary, remaining_prints: copies };
}

function askShopCopies(max) {
  return new Promise((resolve) => {
    const dialog = $('#shop-copies-dialog');
    if (!dialog) { resolve(1); return; }
    const limit = Math.max(1, Math.min(100, Number(max) || 1));
    let value = 1;
    let done = false;
    const paint = () => {
      $('#shop-copies-value').textContent = value;
      $('#shop-copies-hint').textContent = `الحد الأقصى المتاح: ${limit}`;
    };
    const minus = () => { value = Math.max(1, value - 1); paint(); };
    const plus = () => { value = Math.min(limit, value + 1); paint(); };
    const confirm = () => finish(value);
    const cancel = () => finish(0);
    function finish(result) {
      if (done) return;
      done = true;
      $('#shop-copies-minus')?.removeEventListener('click', minus);
      $('#shop-copies-plus')?.removeEventListener('click', plus);
      $('#shop-copies-confirm')?.removeEventListener('click', confirm);
      $('#shop-copies-close')?.removeEventListener('click', cancel);
      dialog.removeEventListener('close', cancel);
      if (dialog.open) dialog.close();
      resolve(result);
    }
    $('#shop-copies-minus')?.addEventListener('click', minus);
    $('#shop-copies-plus')?.addEventListener('click', plus);
    $('#shop-copies-confirm')?.addEventListener('click', confirm);
    $('#shop-copies-close')?.addEventListener('click', cancel);
    dialog.addEventListener('close', cancel);
    paint();
    dialog.showModal();
  });
}

const PAYMENT_MODE = 'manual'; // 'manual' = CCP/BaridiMob with admin review, 'chargily' = online gateway
class CheckoutError extends Error {}

async function startCheckout(documentId, copiesCount, planCode = null) {
  if (PAYMENT_MODE === 'manual') return startManualCheckout(documentId, copiesCount, planCode);
  if (!supabase) throw new CheckoutError('خدمة الدفع غير متاحة الآن. حاول مرة أخرى لاحقًا.');
  if (!planCode) {
    if (!documentId) throw new CheckoutError('هذه الوثيقة غير مربوطة بسجل الدفع.');
    if (!Number.isInteger(copiesCount) || copiesCount < 1 || copiesCount > 100) throw new CheckoutError('اختر عددًا صحيحًا من النسخ بين 1 و100.');
  }
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout-', { body: planCode ? { plan: planCode } : { document_id: documentId, copies: copiesCount } });
    if (error) {
      const status = error.context?.status;
      let code = '';
      try {
        const response = error.context instanceof Response ? error.context.clone() : null;
        code = (await response?.json())?.error ?? '';
      } catch (_) {}
      const messages = {
        '401': 'انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.',
        '400': 'بيانات الطلب أو سعر الوثيقة غير صالح. راجع الاختيار أو تواصل مع الدعم.',
        '404': 'هذه الوثيقة لم تعد متاحة للشراء.',
        '500': 'تعذر إنشاء الطلب الآن. حاول مرة أخرى لاحقًا.',
        '502': 'بوابة الدفع غير متاحة حاليًا. حاول مرة أخرى لاحقًا.',
        bad_input: 'بيانات الطلب غير صحيحة. راجع الوثيقة وعدد النسخ.',
        document_not_found: 'هذه الوثيقة لم تعد متاحة للشراء.',
        plan_not_found: 'هذه الباقة لم تعد متاحة.',
        bad_price: 'تعذر اعتماد سعر هذه الوثيقة. تواصل مع الدعم.',
        order_failed: 'تعذر إنشاء الطلب الآن. حاول مرة أخرى لاحقًا.',
        payment_provider_error: 'بوابة الدفع غير متاحة حاليًا. حاول مرة أخرى لاحقًا.'
      };
      throw new CheckoutError(messages[code] ?? messages[String(status)] ?? 'تعذر بدء الدفع. تحقق من اتصالك ثم حاول مرة أخرى.');
    }
    if (!data?.checkout_url || !data?.order_id) throw new CheckoutError('استجابة الدفع غير مكتملة. حاول مرة أخرى لاحقًا.');
    const checkoutUrl = new URL(data.checkout_url);
    if (checkoutUrl.protocol !== 'https:') throw new CheckoutError('تعذر التحقق من أمان رابط الدفع. لم يتم تحويلك.');
    window.location.href = checkoutUrl.href;
  } catch (error) {
    if (error instanceof CheckoutError) throw error;
    throw new CheckoutError('تعذر الاتصال بخدمة الدفع. تحقق من اتصالك ثم حاول مرة أخرى.');
  }
}

async function confirmCheckoutReturn(returnStatus) {
  if (checkoutReturnStarted || !['success', 'failed'].includes(returnStatus)) return;
  checkoutReturnStarted = true;
  if (returnStatus === 'failed') {
    const failedUrl = new URL(window.location.href);
    failedUrl.searchParams.delete('status');
    window.history.replaceState({}, '', failedUrl);
    pendingReturnStatus = null;
    setNotice('لم تكتمل عملية الدفع. يمكنك اختيار الوثيقة والمحاولة مجددًا.', 'error');
    return;
  }
  let user;
  let authError;
  try {
    ({ data: { user }, error: authError } = await supabase.auth.getUser());
  } catch (_) {
    checkoutReturnStarted = false;
    setNotice('تعذر الاتصال بخدمة الحسابات. أعد المحاولة لتأكيد الطلب.', 'error');
    return;
  }
    if (!user) {
    checkoutReturnStarted = false;
    setNotice('سجّل الدخول بالحساب الذي بدأ الطلب لتأكيد الدفع والترخيص.', 'error');
    openAuthDialog('login');
    return;
  }
    if (authError) {
      checkoutReturnStarted = false;
      setNotice('تعذر استعادة جلسة الدخول. سجّل الدخول ثم أعد المحاولة لتأكيد الطلب.', 'error');
      return;
    }
  const url = new URL(window.location.href);
  url.searchParams.delete('status');
  window.history.replaceState({}, '', url);
  pendingReturnStatus = null;

  setNotice('بانتظار تأكيد الدفع من بوابة الدفع...', 'info');
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      const { data: order, error } = await supabase.from('orders').select('id,status,copies_count,document_id,calculated_price,plan').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) {
        setNotice('تعذر تأكيد الطلب بسبب مشكلة اتصال. افتح حسابك لاحقًا لمراجعة حالته.', 'error');
        return;
      }
      if (order?.status === 'failed') {
        setNotice('حالة الطلب: فشل الدفع. يمكنك بدء طلب جديد.', 'error');
        return;
      }
      if (order?.status === 'paid' && order.plan) {
        await refreshSubscription(user);
        setNotice('تم الدفع وتفعيل اشتراكك. اختر أي وثيقة وافتحها من رصيدك.', 'success');
        document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (order?.status === 'paid') {
        const { data: found, error: licenseError } = await supabase.from('print_licenses').select('license_key').eq('order_id', order.id).maybeSingle();
        if (licenseError) {
          setNotice('تم تأكيد الدفع، لكن تعذر تحميل الترخيص الآن. افتح حسابك بعد قليل.', 'error');
          return;
        }
        if (found) {
          const license = await getLicense(found.license_key);
          if (license) {
            renderLicense(license);   // also fills the activation field with the key
            setNotice(`تم الدفع وفُتحت وثيقتك تلقائيًا. المتبقي ${license.remaining_prints} نسخة، وتجدها دائمًا في «مستنداتي».`, 'success');
            document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
  } catch (_) {
    setNotice('تعذر تأكيد الطلب بسبب مشكلة اتصال. افتح حسابك لاحقًا لمراجعة حالته.', 'error');
    return;
  }
  setNotice('تم استلام الدفع، وسيظهر الترخيص قريبًا. حدّث الصفحة بعد دقيقة إذا لم يظهر.', 'info');
}

function setAuthFeedback(message, type = '') {
  const feedback = $('#auth-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type}`;
}

function authErrorMessage(error) {
  const code = error?.code ?? error?.status;
  const messages = {
    invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    email_not_confirmed: 'أكد بريدك الإلكتروني قبل تسجيل الدخول.',
    user_already_exists: 'هذا البريد مسجل بالفعل. سجّل الدخول بدلًا من إنشاء حساب جديد.',
    weak_password: 'اختر كلمة مرور أقوى من ستة أحرف.',
    over_request_rate_limit: 'تم تجاوز عدد المحاولات. انتظر قليلًا ثم أعد المحاولة.',
    '429': 'تم تجاوز عدد المحاولات. انتظر قليلًا ثم أعد المحاولة.'
  };
  return messages[code] ?? 'تعذر إتمام طلب الحساب. تحقق من البيانات والاتصال ثم حاول مرة أخرى.';
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
  if ($('#auth-consent')) $('#auth-consent').checked = readConsent();
  $('#auth-consent-wrap')?.classList.toggle('is-hidden', mode === 'reset');
  setAuthFeedback('');
  if (!$('#auth-dialog')?.open) $('#auth-dialog')?.showModal();
  setupCaptcha(mode);
  window.lucide?.createIcons();
}

function continuePendingPurchase() {
  if (!pendingPurchase) return;
  const purchase = pendingPurchase;
  pendingPurchase = null;
  sessionStorage.removeItem(PENDING_PURCHASE_KEY);
  $('#auth-dialog')?.close();
  if (purchase.planCode) { subscribeToPlan(purchase.planCode); return; }
  selectedQuantity = Number.isInteger(purchase.copiesCount) ? Math.min(100, Math.max(1, purchase.copiesCount)) : 1;
  openPurchaseDialog(purchase.documentId);
}

function openPurchaseDialog(documentId) {
  const item = documentCatalog[documentId];
  if (!item) {
    setNotice('هذه الوثيقة غير متاحة حاليًا. حدّث الصفحة وحاول مجددًا.', 'error');
    return;
  }
  selectedDocument = documentId;
  selectedQuantity = 1;
  if ($('#purchase-title')) $('#purchase-title').textContent = item.title;
  if ($('#quantity-value')) $('#quantity-value').textContent = selectedQuantity;
  setPurchaseFeedback('');
  updatePurchaseTotal();
  $('#purchase-dialog')?.showModal();
}

async function openPurchase(documentId) {
  if (!supabase) {
    setNotice('تعذر الاتصال بخدمة الحسابات. حاول مرة أخرى لاحقًا.', 'error');
    return;
  }
  if (!documentCatalog[documentId] || purchaseAuthCheckPending) return;
  purchaseAuthCheckPending = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      savePendingPurchase({ documentId });
      openAuthDialog('login');
      return;
    }
    openPurchaseDialog(documentId);
  } catch (_) {
    setNotice('تعذر التحقق من تسجيل الدخول. حاول مرة أخرى.', 'error');
  } finally {
    purchaseAuthCheckPending = false;
  }
}

function updatePurchaseTotal() {
  const item = documentCatalog[selectedDocument];
  if (!item) return;
  if ($('#quantity-value')) $('#quantity-value').textContent = selectedQuantity;
  if ($('#purchase-total')) $('#purchase-total').textContent = item.price * selectedQuantity;
}

function setPurchaseFeedback(message, type = '') {
  const feedback = $('#purchase-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `purchase-feedback ${type}`;
}

document.querySelectorAll('.quick-qty button').forEach((b) => b.addEventListener('click', () => { selectedQuantity = Number(b.dataset.qty); updatePurchaseTotal(); }));
$('#quantity-minus')?.addEventListener('click', () => { selectedQuantity = Math.max(1, selectedQuantity - 1); updatePurchaseTotal(); });
$('#quantity-plus')?.addEventListener('click', () => { selectedQuantity = Math.min(100, selectedQuantity + 1); updatePurchaseTotal(); });
$('#purchase-close')?.addEventListener('click', () => $('#purchase-dialog')?.close());
$('#start-provider-checkout')?.addEventListener('click', async (event) => {
  const item = documentCatalog[selectedDocument];
  const button = event.currentTarget;
  if (!item || button?.disabled) return;
  if (!supabase) {
    setPurchaseFeedback('خدمة الدفع غير متاحة الآن. حاول مرة أخرى لاحقًا.', 'error');
    return;
  }
  button.disabled = true;
  const buttonLabel = button.querySelector('span');
  if (buttonLabel) buttonLabel.textContent = 'جارٍ تجهيز الدفع...';
  setPurchaseFeedback('جارٍ الاتصال ببوابة الدفع...');
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!user) {
      savePendingPurchase({ documentId: item.document_id, copiesCount: selectedQuantity });
      $('#purchase-dialog')?.close();
      openAuthDialog('login');
      return;
    }
    if (error) throw new CheckoutError('تعذر التحقق من جلسة الدخول. سجّل الدخول مجددًا ثم حاول.');
    await startCheckout(item.document_id, selectedQuantity);
  } catch (error) {
    const message = error instanceof CheckoutError ? error.message : 'تعذر الاتصال بخدمة الدفع. تحقق من اتصالك ثم حاول مرة أخرى.';
    setPurchaseFeedback(message, 'error');
  } finally {
    button.disabled = false;
    if (buttonLabel) buttonLabel.textContent = 'المتابعة إلى الدفع';
  }
});

// ---------- Admin: upload documents (the real gate is RLS; this only shows/hides the UI) ----------
async function refreshAdminState(user) {
  const userId = user?.id ?? null;
  if (userId !== adminCheckedFor) {
    adminCheckedFor = userId;
    isAdmin = false;
    if (userId && supabase) {
      try {
        const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
        if (adminCheckedFor === userId) isAdmin = !error && !!data;
      } catch (_) {
        isAdmin = false;
      }
    }
  }
  $('#admin-open')?.classList.toggle('is-hidden', !isAdmin);
  $('#admin-manage-open')?.classList.toggle('is-hidden', !isAdmin);
  $('#promos-open')?.classList.toggle('is-hidden', !isAdmin);
  $('#payments-open')?.classList.toggle('is-hidden', !isAdmin);
  if (userId && $('#profile-role')) $('#profile-role').textContent = isAdmin ? 'أدمن' : 'مشتري';
}

function plainTextToHtml(text) {
  const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

function setAdminFeedback(message, type = '') {
  const feedback = $('#admin-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type}`;
}

let adminPreviewBlob = null;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

let adminLastPages = 1;
async function renderPdfPreviewBlob(file) {
  await pdfReady;
  if (!pdfjsLib) throw new Error('pdfjs');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) throw new Error('too_many_pages');
  adminLastPages = pdf.numPages;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 900 / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('preview');
  return blob;
}

function resetAdminForm() {
  $('#admin-form')?.reset();
  adminPreviewBlob = null;
  const image = $('#admin-preview-img');
  if (image?.dataset.url) URL.revokeObjectURL(image.dataset.url);
  if (image) { image.removeAttribute('src'); delete image.dataset.url; }
  $('#admin-preview-wrap')?.classList.add('is-hidden');
}

$('#admin-open')?.addEventListener('click', () => {
  if (!isAdmin) return;
  closeProfileDropdown();
  setAdminFeedback('');
  $('#admin-dialog')?.showModal();
});
$('#admin-close')?.addEventListener('click', () => $('#admin-dialog')?.close());

$('#admin-pdf')?.addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  adminPreviewBlob = null;
  $('#admin-preview-wrap')?.classList.add('is-hidden');
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    setAdminFeedback('اختر ملف PDF صالحًا.', 'error');
    input.value = '';
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    setAdminFeedback('ملف PDF كبير جدًا. الحد الأقصى 20 ميغابايت.', 'error');
    input.value = '';
    return;
  }
  setAdminFeedback('جارٍ تجهيز المعاينة...');
  try {
    adminPreviewBlob = await renderPdfPreviewBlob(file);
    const image = $('#admin-preview-img');
    if (image.dataset.url) URL.revokeObjectURL(image.dataset.url);
    image.dataset.url = URL.createObjectURL(adminPreviewBlob);
    image.src = image.dataset.url;
    $('#admin-preview-wrap')?.classList.remove('is-hidden');
    if (!$('#admin-title').value.trim()) $('#admin-title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
    setAdminFeedback('');
  } catch (error) {
    setAdminFeedback(error?.message === 'too_many_pages' ? `الملف يتجاوز ${MAX_PDF_PAGES} صفحة. قسّمه إلى ملفات أصغر.` : 'تعذر قراءة ملف PDF. تأكد أنه غير تالف وغير محمي بكلمة مرور.', 'error');
    input.value = '';
  }
});

$('#admin-file')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 200000) {
    setAdminFeedback('الملف كبير جدًا. الحد الأقصى 200 كيلوبايت.', 'error');
    event.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    const isPlain = /\.txt$/i.test(file.name) || file.type === 'text/plain';
    $('#admin-content').value = isPlain ? plainTextToHtml(text) : text;
    if (!$('#admin-title').value.trim()) $('#admin-title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
    setAdminFeedback('تم تحميل محتوى الملف. راجعه ثم اضغط رفع.', 'success');
  } catch (_) {
    setAdminFeedback('تعذر قراءة الملف. جرّب ملفًا آخر.', 'error');
  }
});

$('#admin-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isAdmin || !supabase) return setAdminFeedback('هذه الأداة للأدمن فقط.', 'error');
  const title = $('#admin-title').value.trim();
  const price = Number($('#admin-price').value);
  const summary = $('#admin-summary').value.trim();
  const pdfFile = $('#admin-pdf').files?.[0] ?? null;
  let content = $('#admin-content').value.trim();
  if (!title || title.length > 200) return setAdminFeedback('أدخل عنوانًا من 1 إلى 200 حرف.', 'error');
  if (!Number.isInteger(price) || price < 50 || price > 1000000) return setAdminFeedback('السعر يجب أن يكون عددًا صحيحًا بين 50 و1000000 دج.', 'error');
  if (summary.length > 300) return setAdminFeedback('الوصف القصير لا يتجاوز 300 حرف.', 'error');
  if (!pdfFile && !content) return setAdminFeedback('ارفع ملف PDF أو اكتب محتوى الوثيقة.', 'error');
  if (content.length > 200000) return setAdminFeedback('المحتوى لا يتجاوز 200 ألف حرف.', 'error');
  if (pdfFile && pdfFile.size > MAX_PDF_BYTES) return setAdminFeedback('ملف PDF كبير جدًا. الحد الأقصى 20 ميغابايت.', 'error');
  if (content && !/<[a-z][\s\S]*>/i.test(content)) content = plainTextToHtml(content);
  const submit = $('#admin-submit');
  const label = submit?.querySelector('span');
  if (submit) submit.disabled = true;
  if (label) label.textContent = 'جارٍ الرفع...';
  setAdminFeedback('');
  const id = crypto.randomUUID();
  const uploaded = [];
  try {
    let storagePath = null;
    let previewPath = null;
    if (pdfFile) {
      storagePath = `${id}.pdf`;
      const pdfUpload = await supabase.storage.from('documents').upload(storagePath, pdfFile, { contentType: 'application/pdf', upsert: false });
      if (pdfUpload.error) throw pdfUpload.error;
      uploaded.push(['documents', storagePath]);
      if ($('#admin-preview-on')?.checked) {
        const blob = adminPreviewBlob ?? await renderPdfPreviewBlob(pdfFile);
        previewPath = `${id}.jpg`;
        const previewUpload = await supabase.storage.from('previews').upload(previewPath, blob, { contentType: 'image/jpeg', upsert: false });
        if (previewUpload.error) throw previewUpload.error;
        uploaded.push(['previews', previewPath]);
      }
    }
    const { error } = await supabase.from('documents').insert({
      id, title, price_per_copy: price, summary: summary || null,
      content: pdfFile ? '' : content, storage_path: storagePath, preview_path: previewPath,
      sheets: pdfFile ? Math.min(500, Math.max(1, adminLastPages)) : 1,
      is_published: $('#admin-publish').checked
    });
    if (error) throw error;
    resetAdminForm();
    $('#admin-dialog')?.close();
    setNotice('تمت إضافة الوثيقة بنجاح.', 'success');
    await loadCatalogFromSupabase();
  } catch (error) {
    for (const [bucket, path] of uploaded) {
      try { await supabase.storage.from(bucket).remove([path]); } catch (_) { /* best effort */ }
    }
    const denied = error?.code === '42501' || /row-level security|unauthorized|403/i.test(String(error?.message ?? ''));
    setAdminFeedback(denied ? 'ليس لديك صلاحية الأدمن لرفع الوثائق.' : 'تعذر رفع الوثيقة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (submit) submit.disabled = false;
    if (label) label.textContent = 'رفع الوثيقة';
  }
});

// ---------- Admin: manage documents (hide / show / delete) ----------
function setManageFeedback(message, type = '') {
  const feedback = $('#admin-manage-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type}`;
}

async function loadAdminDocuments() {
  const list = $('#admin-doc-list');
  if (!list || !supabase || !isAdmin) return;
  list.textContent = 'جارٍ تحميل الوثائق...';
  const { data, error } = await supabase.rpc('admin_list_documents');
  if (error || !Array.isArray(data)) {
    list.textContent = 'تعذر تحميل الوثائق. حاول مرة أخرى.';
    return;
  }
  list.replaceChildren();
  if (!data.length) {
    list.textContent = 'لا توجد وثائق بعد.';
    return;
  }
  data.forEach((doc) => list.appendChild(buildAdminRow(doc)));
}

function buildAdminRow(doc) {
  const row = document.createElement('div');
  row.className = 'admin-doc-row';
  const info = document.createElement('div');
  info.className = 'admin-doc-info';
  const name = document.createElement('strong');
  name.textContent = doc.title;
  const meta = document.createElement('small');
  meta.textContent = `${doc.price_per_copy} دج • ${Number(doc.sales)} مبيعات • ${doc.is_published ? 'منشورة' : 'مخفية'}${doc.storage_path ? ' • PDF' : ''}`;
  info.append(name, meta);
  const actions = document.createElement('div');
  actions.className = 'admin-doc-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'admin-mini';
  toggle.textContent = doc.is_published ? 'إخفاء من الموقع' : 'إظهار في الموقع';
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    const { error } = await supabase.from('documents').update({ is_published: !doc.is_published }).eq('id', doc.id);
    if (error) setManageFeedback('تعذر تحديث حالة الوثيقة. حاول مرة أخرى.', 'error');
    else setManageFeedback(doc.is_published ? 'تم إخفاء الوثيقة من الموقع.' : 'أصبحت الوثيقة ظاهرة في الموقع.', 'success');
    await loadAdminDocuments();
    await loadCatalogFromSupabase();
  });
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'admin-mini';
  openBtn.textContent = 'فتح وطباعة';
  openBtn.addEventListener('click', async () => {
    openBtn.disabled = true;
    const { data, error } = await supabase.rpc('admin_get_document', { p_id: doc.id });
    openBtn.disabled = false;
    if (error || !data) return setManageFeedback('تعذر فتح الوثيقة. حاول مرة أخرى.', 'error');
    $('#admin-manage-dialog')?.close();
    renderLicense({
      license_key: `ADMIN-${String(doc.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      document_id: data.document_id,
      remaining_prints: 0,
      total_prints: 0,
      email: data.email ?? '',
      isAdmin: true,
      document: { title: data.title, content: data.content ?? '', storage_path: data.storage_path ?? null, category: 'وثيقة (وضع الأدمن)' }
    });
    document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'admin-mini';
  edit.textContent = 'تعديل';
  edit.addEventListener('click', () => {
    const form = document.createElement('form');
    form.className = 'admin-edit-form';
    const field = (labelText, input) => {
      const wrap = document.createElement('label');
      wrap.textContent = labelText;
      wrap.appendChild(input);
      return wrap;
    };
    const titleInput = document.createElement('input');
    titleInput.type = 'text'; titleInput.maxLength = 200; titleInput.required = true; titleInput.value = doc.title;
    const priceInput = document.createElement('input');
    priceInput.type = 'number'; priceInput.min = '50'; priceInput.max = '1000000'; priceInput.step = '1'; priceInput.required = true; priceInput.value = doc.price_per_copy;
    const summaryInput = document.createElement('input');
    summaryInput.type = 'text'; summaryInput.maxLength = 300; summaryInput.value = doc.summary ?? '';
    const buttons = document.createElement('div');
    buttons.className = 'admin-doc-actions';
    const save = document.createElement('button');
    save.type = 'submit'; save.className = 'admin-mini'; save.textContent = 'حفظ التعديلات';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'admin-mini'; cancel.textContent = 'إلغاء';
    cancel.addEventListener('click', () => loadAdminDocuments());
    buttons.append(save, cancel);
    form.append(field('العنوان', titleInput), field('السعر لكل نسخة (دج)', priceInput), field('الوصف القصير', summaryInput), buttons);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      const price = Number(priceInput.value);
      const summary = summaryInput.value.trim();
      if (!title || title.length > 200) return setManageFeedback('أدخل عنوانًا من 1 إلى 200 حرف.', 'error');
      if (!Number.isInteger(price) || price < 50 || price > 1000000) return setManageFeedback('السعر يجب أن يكون عددًا صحيحًا بين 50 و1000000 دج.', 'error');
      if (summary.length > 300) return setManageFeedback('الوصف لا يتجاوز 300 حرف.', 'error');
      save.disabled = true;
      const { error } = await supabase.from('documents').update({ title, price_per_copy: price, summary: summary || null }).eq('id', doc.id);
      if (error) {
        setManageFeedback('تعذر حفظ التعديلات. حاول مرة أخرى.', 'error');
        save.disabled = false;
        return;
      }
      setManageFeedback('تم حفظ التعديلات.', 'success');
      await loadAdminDocuments();
      await loadCatalogFromSupabase();
    });
    row.replaceChildren(form);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'admin-mini danger';
  remove.textContent = 'حذف نهائي';
  remove.addEventListener('click', async () => {
    if (!(await askConfirm(`حذف «${doc.title}» نهائيًا؟ لا يمكن التراجع.`, 'احذف', 'حذف وثيقة'))) return;
    remove.disabled = true;
    let { data, error } = await supabase.rpc('admin_delete_document', { p_id: doc.id, p_force: false });
    if (!error && data?.status === 'has_sales') {
      const sure = await askConfirm(`تنبيه: لهذه الوثيقة ${data.paid_orders} طلبات مدفوعة و${data.licenses} تراخيص.\nحذفها سيمنع المشترين من فتحها ولا يمكن التراجع.\nهل تريد الحذف رغم ذلك؟`, 'احذف رغم ذلك', 'تنبيه');
      if (!sure) { remove.disabled = false; return; }
      ({ data, error } = await supabase.rpc('admin_delete_document', { p_id: doc.id, p_force: true }));
    }
    if (error) setManageFeedback('تعذر حذف الوثيقة. حاول مرة أخرى.', 'error');
    else if (data?.status === 'deleted') {
      if (data.storage_path) { try { await supabase.storage.from('documents').remove([data.storage_path]); } catch (_) { /* best effort */ } }
      if (data.preview_path) { try { await supabase.storage.from('previews').remove([data.preview_path]); } catch (_) { /* best effort */ } }
      setManageFeedback('تم حذف الوثيقة نهائيًا.', 'success');
    } else setManageFeedback('الوثيقة غير موجودة.', 'error');
    await loadAdminDocuments();
    await loadCatalogFromSupabase();
  });
  actions.append(openBtn, toggle, edit, remove);
  row.append(info, actions);
  return row;
}

$('#admin-manage-open')?.addEventListener('click', () => {
  if (!isAdmin) return;
  closeProfileDropdown();
  setManageFeedback('');
  $('#admin-manage-dialog')?.showModal();
  loadAdminDocuments();
});
$('#admin-manage-close')?.addEventListener('click', () => $('#admin-manage-dialog')?.close());

// ---------- Print shop codes (customers without a printer) ----------
const SHOP_ERRORS = {
  invalid: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
  expired: 'انتهت صلاحية هذا الرمز. اطلب من الزبون رمزًا جديدًا.',
  exhausted: 'استُعمل هذا الرمز أكثر من الحد المسموح. اطلب رمزًا جديدًا.',
  no_prints: 'لم تعد لدى الزبون نسخ متبقية لهذه الوثيقة.',
  document_missing: 'هذه الوثيقة لم تعد متاحة.',
  rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.'
};

let shopCode = '';

async function callPrintShop(body) {
  let result;
  try {
    result = await supabase.functions.invoke('print-shop', { body });
  } catch (_) {
    throw new Error('تعذر الاتصال بالخدمة. تحقق من الاتصال وأعد المحاولة.');
  }
  const { data, error } = result;
  if (error || !data) {
    let status = '';
    try { status = (await error?.context?.json?.())?.status ?? ''; } catch (_) { /* ignore */ }
    throw new Error(SHOP_ERRORS[status] || 'تعذر تنفيذ العملية الآن. حاول مرة أخرى.');
  }
  if (data.status !== 'ok') throw new Error(SHOP_ERRORS[data.status] || 'تعذر تنفيذ العملية.');
  return data;
}

function formatShopCode(code) {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

function drawQr(canvas, text) {
  if (!canvas || typeof window.qrcode !== 'function') return false;
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = 8;
  const size = (count + quiet * 2) * cell;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) context.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
    }
  }
  return true;
}

async function copyText(text, feedbackText) {
  const feedback = $('#shop-feedback');
  try {
    await navigator.clipboard.writeText(text);
    if (feedback) { feedback.textContent = feedbackText; feedback.className = 'auth-feedback success'; }
  } catch (_) {
    if (feedback) { feedback.textContent = 'تعذر النسخ تلقائيًا. حدّد النص وانسخه يدويًا.'; feedback.className = 'auth-feedback error'; }
  }
}

function showShopDialog(code, expiresAt, maxPrints) {
  const link = `${location.origin}${location.pathname}?shop=${code}`;
  $('#shop-code-text').textContent = formatShopCode(code);
  $('#shop-link').value = link;
  $('#shop-qr-wrap')?.classList.toggle('is-hidden', !drawQr($('#shop-qr'), link));
  $('#shop-expiry').textContent = `${maxPrints ? `يسمح بطباعة ${maxPrints} نسخة فقط • ` : ''}صالح حتى ${new Date(expiresAt).toLocaleString('ar-DZ', { dateStyle: 'medium', timeStyle: 'short' })}`;
  if ($('#shop-feedback')) { $('#shop-feedback').textContent = ''; $('#shop-feedback').className = 'auth-feedback'; }
  $('#shop-dialog')?.showModal();
}

async function createShopCode() {
  if (!activeLicense || activeLicense.isAdmin || activeLicense.isShop || !supabase) return;
  const button = $('#shop-open');
  if (button) button.disabled = true;
  try {
    const maxCopies = activeLicense.isSub ? subMaxCopies(activeLicense) : Number(activeLicense.remaining_prints);
    const copies = await askShopCopies(maxCopies);
    if (!copies) return;
    const { data, error } = activeLicense.isSub
      ? await supabase.rpc('create_print_shop_code_sub', { p_document_id: activeLicense.document_id, p_copies: copies })
      : await supabase.rpc('create_print_shop_code', { p_license_key: activeLicense.license_key, p_copies: copies });
    if (error) throw error;
    if (data?.status === 'too_many_copies') setNotice('العدد المطلوب أكبر من رصيدك المتاح.', 'error');
    else if (data?.status === 'no_sheets') setNotice('رصيد أوراقك لا يكفي لهذه الوثيقة.', 'error');
    else if (data?.status === 'daily_limit') setNotice('بلغت حدّ 30 ورقة لهذا اليوم.', 'error');
    else if (data?.status === 'no_subscription') setNotice('لا يوجد اشتراك فعّال.', 'error');
    else if (data?.status === 'no_prints') setNotice('لا توجد نسخ متبقية في هذا الترخيص.', 'error');
    else if (data?.status === 'too_many') setNotice('لديك 5 رموز غير مستعملة. استعمل أحدها أو انتظر انتهاءها (24 ساعة).', 'error');
    else if (data?.status === 'ok') showShopDialog(data.code, data.expires_at, data.max_prints);
    else setNotice('تعذر إنشاء الرمز. حاول مرة أخرى.', 'error');
  } catch (_) {
    setNotice('تعذر إنشاء رمز المطبعة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function openShopCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z2-9]{16}$/.test(code)) return setNotice(SHOP_ERRORS.invalid, 'error');
  if (!supabase) return setNotice('تعذر الاتصال بالخدمة. حدّث الصفحة وحاول مرة أخرى.', 'error');
  setNotice('جارٍ فتح الوثيقة...', 'info');
  let data;
  try {
    data = await callPrintShop({ code, action: 'open' });
  } catch (error) {
    return setNotice(error.message, 'error');
  }
  shopCode = code;
  const left = Number(data.copies_left);
  renderLicense({
    license_key: 'PRINT-SHOP',
    document_id: data.document_id,
    remaining_prints: left,
    total_prints: Math.max(left, Number(data.max_prints) || left),
    email: data.email ?? '',
    watermarkTag: 'PRINT-SHOP',
    isShop: true,
    shopExpiresAt: data.expires_at,
    signedUrl: data.signed_url ?? null,
    document: { title: data.title, content: data.content ?? '', storage_path: data.signed_url ? 'shop' : null, category: 'وثيقة (مطبعة)' }
  });
  document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#shop-open')?.addEventListener('click', createShopCode);
$('#shop-close')?.addEventListener('click', () => $('#shop-dialog')?.close());
$('#shop-copy-code')?.addEventListener('click', () => copyText($('#shop-code-text').textContent.replace(/-/g, ''), 'تم نسخ الرمز.'));
$('#shop-copy-link')?.addEventListener('click', () => copyText($('#shop-link').value, 'تم نسخ الرابط.'));
$('#shop-entry-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  openShopCode($('#shop-code-input')?.value);
});

// ---------- Preview lightbox ----------
$('#preview-close')?.addEventListener('click', () => $('#preview-dialog')?.close());
$('#preview-dialog')?.addEventListener('click', (event) => { if (event.target === $('#preview-dialog')) $('#preview-dialog')?.close(); });
$('#preview-buy')?.addEventListener('click', () => {
  const id = $('#preview-dialog')?.dataset.document;
  $('#preview-dialog')?.close();
  if (id) openPurchase(id);
});
$('#privacy-accept')?.addEventListener('click', () => $('#privacy-dialog')?.close());

// ---------- Consent (privacy policy + terms) lives in the sign-in dialog ----------
const CONSENT_KEY = 'medad-terms-v2';
function readConsent() { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (_) { return false; } }
function saveConsent() { try { localStorage.setItem(CONSENT_KEY, '1'); } catch (_) { /* ignore */ } }
function requireConsent() {
  if ($('#auth-consent')?.checked) return true;
  setAuthFeedback('يجب الموافقة على سياسة الخصوصية وشروط الاستخدام للمتابعة.', 'error');
  $('#auth-consent')?.focus();
  return false;
}

$('#auth-close')?.addEventListener('click', () => $('#auth-dialog')?.close());
$('#forgot-password')?.addEventListener('click', async () => {
  if (!supabase) return setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
  const email = $('#auth-email')?.value.trim();
  if (!email) return setAuthFeedback('أدخل بريدك الإلكتروني أولًا.', 'error');
  if (TURNSTILE_SITE_KEY && !captchaToken) return setAuthFeedback('أكمل التحقق البشري أولًا ثم اضغط «نسيت كلمة المرور».', 'error');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname, captchaToken: captchaToken || undefined });
    resetCaptcha();
    setAuthFeedback(error ? 'تعذر إرسال رابط الاستعادة. تحقق من البريد وحاول مرة أخرى.' : 'تم إرسال رابط استرجاع كلمة المرور إلى بريدك.', error ? 'error' : 'success');
  } catch (_) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات. حاول مرة أخرى.', 'error');
  }
});
$('#auth-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
  if (authMode !== 'reset' && !requireConsent()) return;
  if (authMode !== 'reset' && TURNSTILE_SITE_KEY && !captchaToken) {
    setAuthFeedback('أكمل التحقق البشري أولًا.', 'error');
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
        ? await supabase.auth.signUp({ email, password, options: { data: { accepted_terms: 'v2', accepted_terms_at: new Date().toISOString() }, captchaToken: captchaToken || undefined } })
        : await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken || undefined } });
    if (result.error) throw result.error;
    if (authMode !== 'reset') saveConsent();
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
    continuePendingPurchase();
  } catch (error) {
    setAuthFeedback(authErrorMessage(error), 'error');
  } finally {
    if (submit) submit.disabled = false;
    if (authMode !== 'reset') resetCaptcha();
  }
});

async function startOAuth(provider) {
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
  if (!requireConsent()) return;
  saveConsent();
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) setAuthFeedback('تعذر بدء تسجيل الدخول عبر هذا المزود. حاول مرة أخرى.', 'error');
  } catch (_) {
    setAuthFeedback('تعذر الاتصال بمزود تسجيل الدخول. حاول مرة أخرى.', 'error');
  }
}

$('#google-auth')?.addEventListener('click', () => startOAuth('google'));
$('#github-auth')?.addEventListener('click', () => startOAuth('github'));
$('#account-logout')?.addEventListener('click', async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) setNotice('تعذر تسجيل الخروج الآن. حاول مرة أخرى.', 'error');
  else {
    renderAccount(null);
    activeLicense = null;
    pdfRenderToken += 1;
    $('#security')?.classList.add('is-hidden');
    const body = $('#document-content');
    if (body) { body.replaceChildren(); body.classList.remove('is-pdf'); body.dataset.pdfReady = '0'; }
    if ($('#license-key')) $('#license-key').value = '';
    if ($('#print-button')) $('#print-button').disabled = true;
    setNotice('تم تسجيل الخروج.', 'success');
  }
});
async function openAccountDialog(scrollToLicenses) {
  if (!supabase) return;
  closeProfileDropdown();
  $('#account-dialog')?.showModal();
  try {
    await loadAccountHistory();
  } catch (_) {
    if ($('#account-orders')) $('#account-orders').textContent = 'تعذر تحميل الطلبات. تحقق من اتصالك ثم أعد المحاولة.';
  }
  if (scrollToLicenses) $('#account-licenses')?.scrollIntoView({ block: 'start' });
}
$('#account-open')?.addEventListener('click', () => openAccountDialog(false));
$('#docs-open')?.addEventListener('click', () => openAccountDialog(true));
$('#account-close')?.addEventListener('click', () => $('#account-dialog')?.close());
$('#login-trigger')?.addEventListener('click', () => openAuthDialog('login'));
$('#profile-trigger')?.addEventListener('click', (event) => {
  event.stopPropagation();
  if ($('#profile-dropdown')?.classList.contains('is-open')) closeProfileDropdown();
  else openProfileDropdown();
});
document.addEventListener('click', (event) => {
  if (!$('#user-profile')?.contains(event.target)) closeProfileDropdown();
});
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

loadCatalogFromSupabase();
loadPlans();
restorePendingPurchase();
supabase?.auth.getSession().then(({ data: { session }, error }) => {
  if (error) {
    renderAccount(null);
    setNotice('تعذر استعادة جلسة الدخول. سجّل الدخول للمتابعة.', 'error');
    return;
  }
  renderAccount(session?.user ?? null);
  if (session && pendingPurchase) continuePendingPurchase();
  else if (pendingReturnStatus) {
    if (session) confirmCheckoutReturn(pendingReturnStatus);
    else openAuthDialog('login');
  }
}).catch(() => setNotice('تعذر الاتصال بخدمة الحسابات. حاول تحديث الصفحة.', 'error'));

supabase?.auth.onAuthStateChange((event, session) => {
  renderAccount(session?.user ?? null);
  if (event === 'PASSWORD_RECOVERY') openAuthDialog('reset');
  if (event === 'SIGNED_IN') {
    if (pendingPurchase) continuePendingPurchase();
    else if (pendingReturnStatus) confirmCheckoutReturn(pendingReturnStatus);
  }
});

$('#privacy-policy-link')?.addEventListener('click', () => $('#privacy-dialog')?.showModal());
$('#privacy-dialog-close')?.addEventListener('click', () => $('#privacy-dialog')?.close());
document.addEventListener('click', (event) => {
  if (event.target === $('#privacy-dialog')) $('#privacy-dialog')?.close();
});

window.lucide?.createIcons();


// Opened from a print shop QR code: ?shop=XXXX...
{
  const shopParam = new URLSearchParams(window.location.search).get('shop');
  if (shopParam) openShopCode(shopParam);
}

// ---------- Dark mode ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('#theme-toggle i, #theme-toggle svg');
  if (icon) { const n = document.createElement('i'); n.dataset.lucide = theme === 'dark' ? 'sun' : 'moon'; icon.replaceWith(n); window.lucide?.createIcons(); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#15170f' : '#fbf8f1';
}
$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('medad-theme', next); } catch (_) {}
  applyTheme(next);
});
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

$('#catalog-search')?.addEventListener('input', (event) => {
  const q = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.document-catalog .catalog-card').forEach((card) => {
    card.style.display = !q || card.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ---------- Plans dialog ----------
async function openPlans() {
  closeProfileDropdown?.();
  $('#plans-dialog')?.showModal();
  if (!plans.length) loadPlans();
  try { const { data: { user } } = await supabase.auth.getUser(); refreshSubscription(user); } catch (_) {}
}
$('#plans-open')?.addEventListener('click', openPlans);
$('#plans-nav')?.addEventListener('click', (e) => { e.preventDefault(); openPlans(); });
$('#sub-badge')?.addEventListener('click', openPlans);
$('#plans-close')?.addEventListener('click', () => $('#plans-dialog')?.close());


// ---------- Landing page ----------
function hideLanding() { document.body.classList.remove('landing-on'); }
{
  const p = new URLSearchParams(window.location.search);
  if (p.get('shop') || p.get('status') || p.get('checkout') || p.get('order')) hideLanding();
  document.querySelectorAll('.js-start').forEach((b) => b.addEventListener('click', () => openAuthDialog('login')));
  $('#landing-form')?.addEventListener('submit', (e) => { e.preventDefault(); const q = $('#landing-q').value.trim(); if (q) { const s = $('#catalog-search'); if (s) { s.value = q; s.dispatchEvent(new Event('input')); } } openAuthDialog('login'); });
  supabase?.auth.getSession().then(({ data }) => { if (data?.session) hideLanding(); }).catch(() => {});
  supabase?.auth.onAuthStateChange((_e, session) => { if (session) { hideLanding(); window.scrollTo(0, 0); } else if (_e === 'SIGNED_OUT') document.body.classList.add('landing-on'); });
  window.setTimeout(() => { if (!supabase) hideLanding(); }, 0);
}

// ---------- Subscription expiry reminder ----------
function checkExpiryReminder() {
  try {
    if (!currentUser || !subSummary?.has_subscription || !subSummary.expires_at) return;
    const left = new Date(subSummary.expires_at).getTime() - Date.now();
    if (left <= 0 || left > 3 * 86400000) return;
    const key = 'medad-expiry-' + new Date().toDateString();
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    const days = Math.max(1, Math.ceil(left / 86400000));
    showToast(`اشتراكك ينتهي خلال ${days === 1 ? 'يوم واحد' : days + ' أيام'}. جدّده من «الباقات» حتى لا ينقطع رصيدك.`, 'info');
  } catch (_) {}
}

// ---------- Local autosave of edits ----------
function draftKey() { return activeLicense && !activeLicense.isShop && activeLicense.document_id ? 'medad-draft:' + activeLicense.document_id : null; }
function readDraft() { try { const k = draftKey(); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null; } catch (_) { return null; } }
function writeDraft(obj) { try { const k = draftKey(); if (k) localStorage.setItem(k, JSON.stringify({ ...obj, t: Date.now() })); } catch (_) {} }
function clearDraft() { try { const k = draftKey(); if (k) localStorage.removeItem(k); } catch (_) {} }
function saveDraftPdf(snap) {
  if (!activeLicense?.document?.storage_path) return;
  const empty = !JSON.parse(snap).some((l) => l.length);
  if (empty) clearDraft(); else writeDraft({ annots: snap });
}
function restoreDraftPdf() {
  const d = readDraft();
  if (!d?.annots) return;
  try {
    const data = JSON.parse(d.annots);
    document.querySelectorAll('.annot-layer').forEach((layer, i) => (data[i] || []).forEach((x) => buildAnnot(layer, x)));
    showToast('استعدنا تعديلاتك السابقة على هذه الوثيقة.', 'success');
  } catch (_) {}
}
function restoreDraftHtml(license, contentEl) {
  const prev = activeLicense; activeLicense = license;
  const d = readDraft(); activeLicense = prev;
  if (d?.html) { contentEl.replaceChildren(sanitizeDocumentHtml(d.html)); showToast('استعدنا تعديلاتك السابقة على هذه الوثيقة.', 'success'); }
}
{
  let t = null;
  $('#document-content')?.addEventListener('input', () => {
    if (activeLicense?.document?.storage_path) return;
    window.clearTimeout(t);
    t = window.setTimeout(() => writeDraft({ html: $('#document-content').innerHTML }), 800);
  });
}

// ---------- Promo codes: user redeem ----------
const PROMO_ERRORS = { invalid_code: 'الرمز غير صحيح أو منتهي.', already_used: 'استعملت هذا الرمز من قبل.', auth: 'سجّل الدخول أولًا.' };
function rpcMsg(error, map) { const m = String(error?.message || ''); return Object.entries(map).find(([k]) => m.includes(k))?.[1] || 'تعذر تنفيذ الطلب. حاول مرة أخرى.'; }
$('#promo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#promo-input');
  const code = input.value.trim();
  if (!code) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { openAuthDialog('login'); return; }
  const { data, error } = await supabase.rpc('redeem_promo_code', { p_code: code });
  if (error) { showToast(rpcMsg(error, PROMO_ERRORS), 'error'); return; }
  input.value = '';
  showToast(`🎁 حصلت على ${data.sheets} ورقة مجانية، صالحة ${data.days} يومًا.`, 'success');
  refreshSubscription(user);
});

// ---------- Promo codes: admin ----------
const PROMO_ADMIN_ERRORS = { exists: 'هذا الرمز موجود مسبقًا.', bad_code: 'الرمز: حروف إنجليزية وأرقام و - _ فقط (3 إلى 32).', forbidden: 'ليست لديك صلاحية.' };
async function loadPromos() {
  const list = $('#promo-list');
  const { data, error } = await supabase.rpc('admin_list_promos');
  if (error || !Array.isArray(data)) { list.textContent = 'تعذر تحميل الرموز.'; return; }
  list.replaceChildren();
  if (!data.length) list.textContent = 'لا توجد رموز بعد.';
  data.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'admin-doc-row';
    const info = document.createElement('div');
    info.className = 'admin-doc-info';
    const b = document.createElement('strong'); b.dir = 'ltr'; b.textContent = p.code;
    const s = document.createElement('small'); s.textContent = `${p.sheets} ورقة • استُعمل ${p.uses}${p.max_uses ? ' / ' + p.max_uses : ''} • ${p.active ? 'فعّال' : 'موقوف'}`;
    info.append(b, s);
    const act = document.createElement('div'); act.className = 'admin-doc-actions';
    const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'admin-mini'; cp.textContent = 'نسخ الرسالة';
    cp.addEventListener('click', () => { const t = `ضع الرمز ${p.code} في موقع مداد لتحصل على ${p.sheets} ورقة مجانًا 🎁`; navigator.clipboard?.writeText(t).then(() => showToast('تم نسخ الرسالة.', 'success')).catch(() => {}); $('#promo-msg').textContent = t; });
    const tg = document.createElement('button'); tg.type = 'button'; tg.className = 'admin-mini'; tg.textContent = p.active ? 'إيقاف' : 'تفعيل';
    tg.addEventListener('click', async () => { await supabase.rpc('admin_toggle_promo', { p_code: p.code, p_active: !p.active }); loadPromos(); });
    act.append(cp, tg); row.append(info, act); list.append(row);
  });
}
$('#promos-open')?.addEventListener('click', () => { if (!isAdmin) return; closeProfileDropdown(); $('#promo-dialog')?.showModal(); loadPromos(); });
$('#promo-close')?.addEventListener('click', () => $('#promo-dialog')?.close());
$('#promo-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { data, error } = await supabase.rpc('admin_create_promo', {
    p_code: $('#promo-code').value, p_sheets: Number($('#promo-sheets').value), p_max_uses: Number($('#promo-max').value) || 0,
    p_valid_days: Number($('#promo-days').value) || 30, p_expires: null, p_note: $('#promo-note').value || null });
  if (error) { showToast(rpcMsg(error, PROMO_ADMIN_ERRORS), 'error'); return; }
  $('#promo-msg').textContent = `ضع الرمز ${data.code} في موقع مداد لتحصل على ${$('#promo-sheets').value} ورقة مجانًا 🎁`;
  $('#promo-code').value = '';
  showToast('تم إنشاء الرمز.', 'success');
  loadPromos();
});

{
  const els = document.querySelectorAll('.landing .rv');
  if ('IntersectionObserver' in window) {
    document.querySelector('.landing')?.classList.add('rv-on');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }
}

function renderLandingGallery(docs) {
  const track = $('#landing-track');
  if (!track || !docs?.length) return;
  const make = (doc) => {
    const d = document.createElement('div');
    d.className = 'md';
    const url = doc.preview_path ? supabase.storage.from('previews').getPublicUrl(doc.preview_path).data.publicUrl : '';
    if (url) {
      d.classList.add('has-img');
      const img = document.createElement('img'); img.crossOrigin = 'anonymous'; img.addEventListener('load', () => smoothDownscale(img, 170), { once: true }); img.src = url; img.alt = ''; img.loading = 'lazy';
      d.append(img);
    }
    const b = document.createElement('b'); b.textContent = doc.title; d.append(b);
    if (!url) for (let i = 0; i < 5; i += 1) d.append(document.createElement('i'));
    return d;
  };
  let list = [...docs];
  while (list.length < 8) list = list.concat(docs);
  const set = list.map(make);
  track.replaceChildren(...set, ...list.map(make));
}

// Shrinks big previews in halving steps so fine grids/lines don't turn into moiré ("overlapping" lines).
function smoothDownscale(img, fallbackCss = 300) {
  try {
    if (img.dataset.sm) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round((img.clientWidth || fallbackCss) * dpr);
    if (!w || img.naturalWidth <= w * 1.3) return;
    img.dataset.sm = '1';
    let cur = document.createElement('canvas');
    cur.width = img.naturalWidth; cur.height = img.naturalHeight;
    cur.getContext('2d').drawImage(img, 0, 0);
    const step = (to) => {
      const c = document.createElement('canvas');
      c.width = to; c.height = Math.round(cur.height * to / cur.width);
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, c.width, c.height);
      cur = c;
    };
    while (cur.width / 2 > w) step(Math.round(cur.width / 2));
    step(w);
    img.src = cur.toDataURL('image/jpeg', 0.92);
  } catch (_) { /* tainted canvas or no support: keep the original */ }
}


// ---------- Manual payment (CCP / BaridiMob) ----------
const MANUAL_ERRORS = {
  duplicate_receipt: 'هذا الإيصال استُعمل من قبل في طلب آخر.',
  duplicate_operation: 'رقم العملية هذا مسجّل في طلب آخر.',
  receipt_older_than_order: 'تاريخ الإيصال أقدم من الطلب. حوّل المبلغ بعد إنشاء الطلب.',
  bad_receipt_time: 'تاريخ التحويل غير صحيح.',
  operation_required: 'اكتب رقم العملية كما في الإيصال.',
  sender_required: 'اكتب اسمك كما في التحويل.',
  receipt_required: 'أرفق صورة الإيصال.',
  order_not_pending: 'هذا الطلب لم يعد بانتظار الدفع.',
  order_not_found: 'الطلب غير موجود.',
  plan_not_found: 'هذه الباقة لم تعد متاحة.',
  document_not_found: 'هذه الوثيقة لم تعد متاحة للشراء.',
  not_authenticated: 'سجّل الدخول أولًا.',
  reason_required: 'اكتب سبب الرفض.',
  forbidden: 'ليست لديك صلاحية.'
};
let manualOrder = null;

async function startManualCheckout(documentId, copiesCount, planCode) {
  if (!supabase) throw new CheckoutError('خدمة الدفع غير متاحة الآن.');
  const { data, error } = await supabase.rpc('create_manual_order', { p_document_id: planCode ? null : documentId, p_copies: planCode ? null : copiesCount, p_plan: planCode || null });
  if (error) throw new CheckoutError(rpcMsg(error, MANUAL_ERRORS));
  $('#purchase-dialog')?.close();
  $('#plans-dialog')?.close();
  setNotice('', 'info');
  await openManualDialog(data);
}

async function openManualDialog(order) {
  manualOrder = order;
  const box = $('#mp-box');
  box.replaceChildren();
  const { data: s } = await supabase.rpc('get_manual_payment_settings');
  const rows = [['المبلغ', `${Number(order.amount)} دج`], ['رمز الطلب', order.manual_reference], ['اسم صاحب الحساب', s?.account_name], ['CCP', s?.ccp], ['RIP (بريدي موب)', s?.rip]];
  rows.forEach(([label, value]) => {
    if (!value) return;
    const row = document.createElement('div'); row.className = 'pay-row';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('b'); v.dir = 'ltr'; v.textContent = value;
    const c = document.createElement('button'); c.type = 'button'; c.className = 'admin-mini'; c.textContent = 'نسخ';
    c.addEventListener('click', () => { navigator.clipboard?.writeText(String(value).replace(/\s*دج$/, '')).then(() => showToast('تم النسخ.', 'success')).catch(() => {}); });
    row.append(l, v, c); box.append(row);
  });
  if (!s?.ccp && !s?.rip) { const w = document.createElement('p'); w.textContent = 'لم تُضبط بيانات الحساب بعد. تواصل مع الدعم.'; box.append(w); }
  $('#mp-note').textContent = (s?.note ? s.note + ' ' : '') + 'اكتب رمز الطلب في ملاحظة التحويل إن أمكن. تُراجَع العملية يدويًا.';
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('#mp-time').value = now.toISOString().slice(0, 16);
  $('#manual-form').reset?.();
  $('#mp-time').value = now.toISOString().slice(0, 16);
  $('#mp-feedback').textContent = '';
  $('#manual-dialog')?.showModal();
}
$('#manual-close')?.addEventListener('click', () => $('#manual-dialog')?.close());

async function sha256Hex(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

$('#manual-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fb = $('#mp-feedback');
  const btn = $('#mp-submit');
  const file = $('#mp-file').files[0];
  if (!manualOrder || !file) return;
  if (file.size > 5 * 1024 * 1024) { fb.textContent = 'حجم الملف أكبر من 5 ميغابايت.'; return; }
  btn.disabled = true; fb.textContent = 'جارٍ رفع الإيصال...';
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('not_authenticated');
    const sha = await sha256Hex(file);
    const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const path = `${user.id}/${manualOrder.order_id}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('manual-receipts').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error('upload_failed');
    const { error } = await supabase.rpc('submit_manual_payment', {
      p_order_id: manualOrder.order_id, p_sender_name: $('#mp-sender').value, p_receipt_path: path, p_receipt_sha256: sha,
      p_operation_no: $('#mp-op').value, p_receipt_time: new Date($('#mp-time').value).toISOString() });
    if (error) { await supabase.storage.from('manual-receipts').remove([path]).catch(() => {}); throw error; }
    supabase.functions.invoke('telegram-manual-payment', { body: { order_id: manualOrder.order_id } }).catch(() => {});
    $('#manual-dialog')?.close();
    showToast('وصلنا إيصالك. سيُفعَّل طلبك بعد المراجعة، وتجد حالته في «طلباتي».', 'success');
    manualOrder = null;
  } catch (err) {
    fb.textContent = err.message === 'upload_failed' ? 'تعذر رفع الملف. حاول مرة أخرى.' : rpcMsg(err, MANUAL_ERRORS);
  } finally { btn.disabled = false; }
});

// ---------- Manual payment: admin review ----------
async function loadPayments() {
  const list = $('#payments-list');
  list.textContent = 'جارٍ التحميل...';
  const { data, error } = await supabase.rpc('admin_list_manual_payments_v2');
  if (error || !Array.isArray(data)) { list.textContent = 'تعذر تحميل الطلبات.'; return; }
  list.replaceChildren();
  if (!data.length) list.textContent = 'لا توجد طلبات دفع.';
  for (const p of data) {
    const row = document.createElement('div'); row.className = 'admin-doc-row pay-item';
    const info = document.createElement('div'); info.className = 'admin-doc-info';
    const t = document.createElement('strong'); t.textContent = `${p.manual_reference} • ${Number(p.amount)} دج • ${p.plan ? 'اشتراك ' + p.plan : (p.document_title || 'وثيقة')}`;
    const s1 = document.createElement('small'); s1.textContent = `${p.user_email} • المرسل: ${p.manual_sender_name || '—'}`;
    const s2 = document.createElement('small'); s2.dir = 'ltr'; s2.textContent = `op: ${p.operation_no || '—'} • ${p.receipt_time ? new Date(p.receipt_time).toLocaleString('fr-DZ') : ''}`;
    const s3 = document.createElement('small'); s3.textContent = p.status === 'paid' ? '✅ مقبول' : p.status === 'failed' ? `❌ مرفوض: ${p.rejection_reason || ''}` : (p.manual_receipt_path ? '⏳ بانتظار قرارك' : 'بلا إيصال بعد');
    info.append(t, s1, s2, s3);
    (p.flags || []).forEach((f) => { const w = document.createElement('small'); w.className = 'pay-flag'; w.textContent = '⚠ ' + f; info.append(w); });
    const act = document.createElement('div'); act.className = 'admin-doc-actions';
    if (p.manual_receipt_path) {
      const view = document.createElement('button'); view.type = 'button'; view.className = 'admin-mini'; view.textContent = 'الإيصال';
      view.addEventListener('click', async () => { const { data: u } = await supabase.storage.from('manual-receipts').createSignedUrl(p.manual_receipt_path, 300); if (u?.signedUrl) window.open(u.signedUrl, '_blank', 'noopener'); });
      act.append(view);
    }
    if (p.status === 'pending' && p.manual_receipt_path) {
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'admin-mini'; ok.textContent = 'قبول';
      ok.addEventListener('click', async () => {
        if (!(await askConfirm(`هل وجدت العملية ${p.operation_no} بمبلغ ${Number(p.amount)} دج في حسابك؟`, 'نعم، اقبل', 'تأكيد القبول'))) return;
        const { error: e1 } = await supabase.rpc('admin_approve_manual_payment', { p_order_id: p.order_id });
        showToast(e1 ? rpcMsg(e1, MANUAL_ERRORS) : 'تم القبول وتفعيل الطلب.', e1 ? 'error' : 'success'); loadPayments();
      });
      const no = document.createElement('button'); no.type = 'button'; no.className = 'admin-mini'; no.textContent = 'رفض';
      no.addEventListener('click', async () => {
        const reason = window.prompt('سبب الرفض (يظهر للزبون):'); if (!reason) return;
        const { error: e2 } = await supabase.rpc('admin_reject_manual_payment', { p_order_id: p.order_id, p_reason: reason });
        showToast(e2 ? rpcMsg(e2, MANUAL_ERRORS) : 'تم الرفض.', e2 ? 'error' : 'success'); loadPayments();
      });
      act.append(ok, no);
    }
    row.append(info, act); list.append(row);
  }
}
async function loadPaySettings() {
  const { data } = await supabase.from('payment_settings').select('account_name,ccp,rip,note,telegram_chat_id,telegram_enabled').eq('id', true).maybeSingle();
  if (!data) return;
  $('#ps-name').value = data.account_name || ''; $('#ps-ccp').value = data.ccp || ''; $('#ps-rip').value = data.rip || '';
  $('#ps-note').value = data.note || ''; $('#ps-tg').value = data.telegram_chat_id || ''; $('#ps-tg-on').checked = Boolean(data.telegram_enabled);
}
$('#payments-open')?.addEventListener('click', () => { if (!isAdmin) return; closeProfileDropdown(); $('#payments-dialog')?.showModal(); loadPayments(); loadPaySettings(); });
$('#payments-close')?.addEventListener('click', () => $('#payments-dialog')?.close());
$('#pay-settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.rpc('admin_update_manual_payment_settings', { p_account_name: $('#ps-name').value, p_ccp: $('#ps-ccp').value, p_rip: $('#ps-rip').value, p_note: $('#ps-note').value, p_telegram_chat_id: $('#ps-tg').value, p_telegram_enabled: $('#ps-tg-on').checked });
  showToast(error ? rpcMsg(error, MANUAL_ERRORS) : 'تم حفظ بيانات الحساب.', error ? 'error' : 'success');
});

// Keep the sheet counters honest: other devices, print-shop prints and the midnight reset all change them off-screen.
{
  let lastSync = 0;
  const sync = () => {
    if (!currentUser || document.hidden || Date.now() - lastSync < 20000) return;
    lastSync = Date.now();
    refreshSubscription(currentUser);
  };
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.setInterval(sync, 60000);
}
