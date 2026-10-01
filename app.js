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
let activeLicense = null;

function addDocumentCardToCatalog(id, title, price, category = 'وثيقة معتمدة', content = '') {
  documentCatalog[id] = { title, price: Number(price), category, document_id: id, content };
  const existingCard = document.querySelector(`.catalog-card[data-document="${id}"]`);
  if (existingCard) existingCard.remove();
  const card = document.createElement('article');
  card.className = 'catalog-card uploaded-catalog-card';
  card.dataset.document = id;
  const preview = document.createElement('div');
  preview.className = 'catalog-preview uploaded-preview';
  const previewIcon = document.createElement('i');
  previewIcon.dataset.lucide = 'database';
  const previewLabel = document.createElement('span');
  previewLabel.textContent = 'MEDAD / SUPABASE';
  preview.append(previewIcon, previewLabel);
  const body = document.createElement('div');
  body.className = 'catalog-card-body';
  const type = document.createElement('span');
  type.className = 'catalog-type';
  type.textContent = category;
  const heading = document.createElement('h2');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = content ? `${content.replace(/<[^>]*>/g, '').slice(0, 80)}...` : 'وثيقة رسمية قابلة للتحقق والطباعة المعتمدة.';
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
  body.append(type, heading, description, footer);
  card.append(preview, body);
  $('.document-catalog')?.appendChild(card);
  buyButton.addEventListener('click', () => openPurchase(id));
  window.lucide?.createIcons();
}

async function loadCatalogFromSupabase() {
  const catalog = $('.document-catalog');
  if (!catalog) return;
  catalog.textContent = 'جارٍ تحميل الوثائق...';
  if (!supabase) {
    catalog.textContent = 'تعذر الاتصال بمكتبة الوثائق الآن.';
    return;
  }
  try {
    const { data: docs, error } = await supabase.from('documents').select('id, title, content, price_per_copy, is_published').eq('is_published', true);
    if (error || !docs) {
      catalog.textContent = 'تعذر تحميل الوثائق. تحقق من اتصالك ثم أعد المحاولة.';
      return;
    }
    catalog.replaceChildren();
    if (!docs.length) {
      catalog.textContent = 'لا توجد وثائق متاحة حاليًا.';
      return;
    }
    docs.forEach((doc) => {
      addDocumentCardToCatalog(doc.id, doc.title, doc.price_per_copy, 'وثيقة معتمدة', doc.content);
    });
  } catch (_) {
    catalog.textContent = 'تعذر تحميل الوثائق. تحقق من اتصالك ثم أعد المحاولة.';
  }
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
  if ($('#profile-role')) $('#profile-role').textContent = 'مشتري';
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
  const licensesList = $('#account-licenses');
  const summary = $('#account-summary');
  if (!list || !licensesList) return;
  list.textContent = 'جارٍ تحميل الطلبات...';
  licensesList.textContent = 'جارٍ تحميل التراخيص...';
  try {
    const [orderResult, licenseResult] = await Promise.all([
      supabase.from('orders').select('id,calculated_price,copies_count,status,created_at,documents(title)').order('created_at', { ascending: false }),
      supabase.from('print_licenses').select('id,license_key,document_id,remaining_prints,order_id,documents(title)').order('created_at', { ascending: false })
    ]);
    if (orderResult.error) {
      list.textContent = 'تعذر تحميل الطلبات الآن. تحقق من اتصالك ثم أعد المحاولة.';
      if (summary) summary.textContent = 'تعذر تحميل البيانات';
    } else {
      const orders = orderResult.data ?? [];
      if (summary) summary.textContent = `${orders.length} طلبات محفوظة في حسابك`;
      if (!orders.length) list.textContent = 'لا توجد طلبات بعد.';
      else list.replaceChildren(...orders.map((order) => {
        const status = order.status === 'paid' ? 'مدفوع' : order.status === 'failed' ? 'فشل' : 'قيد الانتظار';
        const article = document.createElement('article');
        article.className = 'order-item';
        const top = document.createElement('div');
        top.className = 'order-item-top';
        const title = document.createElement('span');
        title.textContent = order.documents?.title ?? 'وثيقة';
        const state = document.createElement('span');
        state.textContent = status;
        top.append(title, state);
        const details = document.createElement('small');
        details.textContent = `${order.copies_count} نسخة / ${order.calculated_price} دج / ${new Date(order.created_at).toLocaleDateString('ar-DZ')}`;
        article.append(top, details);
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
      title.textContent = license.documents?.title ?? 'وثيقة';
      const remaining = document.createElement('span');
      remaining.textContent = `${license.remaining_prints} نسخة متبقية`;
      const key = document.createElement('small');
      key.textContent = license.license_key;
      top.append(title, remaining);
      article.append(top, key);
      return article;
    }));
  } catch (_) {
    list.textContent = 'تعذر تحميل الطلبات الآن. تحقق من اتصالك ثم أعد المحاولة.';
    if (summary) summary.textContent = 'تعذر تحميل البيانات';
    licensesList.textContent = 'تعذر تحميل التراخيص الآن. تحقق من اتصالك ثم أعد المحاولة.';
  }
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
      if ($('#document-content')) $('#document-content').replaceChildren(sanitizeDocumentHtml(activeLicense.document.content));
      const paper = $('#document-paper');
      if (paper) paper.className = 'document-paper';
      setNotice('تمت إعادة تعيين محتوى الوثيقة والتنسيقات إلى الوضع الأصلي.', 'info');
    });
  }
}

function renderLicense(license) {
  activeLicense = license;
  const remaining = Math.max(0, Number(license.remaining_prints));
  const total = Math.max(remaining, Number(license.total_prints ?? remaining));
  const used = total - remaining;
  
  if ($('#doc-id')) $('#doc-id').textContent = license.license_key.slice(-6);
  if ($('#document-title')) $('#document-title').textContent = license.document.title;
  if ($('#doc-category')) $('#doc-category').textContent = license.document.category || 'وثيقة مرخصة';
  if ($('#document-content')) $('#document-content').replaceChildren(sanitizeDocumentHtml(license.document.content));

  setupInteractiveDocumentStudio(license);

  supabase?.auth.getUser().then(({ data: { user } }) => {
    const watermark = user?.email ? `مِداد / ${user.email} / ${license.license_key.slice(-8)}` : `مِداد / ${license.license_key.slice(-8)}`;
    document.querySelectorAll('.paper-watermark').forEach((element) => {
      element.textContent = watermark;
      element.dataset.watermark = watermark;
    });
    document.body.dataset.printWatermark = watermark;
  });

  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${total ? Math.min(100, (used / total) * 100) : 0}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#2563eb ${total ? Math.max(0, (remaining / total) * 360) : 0}deg, #dbeafe 0deg)`;
  
  const stateEl = $('#license-state');
  if (stateEl) {
    stateEl.classList.add('active');
    stateEl.innerHTML = '<span class="state-dot"></span> مفعل الآن';
  }
  
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = remaining <= 0;
  
  setNotice(`تم تفعيل المستند بنجاح. يمكنك الآن التعديل المباشر والتخصيص الكامل للوثيقة قبل الطباعة.`, 'success');
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
  let licenseResult;
  try {
    licenseResult = await supabase.from('print_licenses').select('license_key,document_id,remaining_prints,order_id,documents(title,content)').eq('license_key', cleanKey).maybeSingle();
  } catch (_) {
    throw new Error('تعذر التحقق من الترخيص الآن. تحقق من اتصالك ثم حاول مرة أخرى.');
  }
  const { data, error } = licenseResult;
  if (error) throw new Error('تعذر التحقق من الترخيص الآن. حاول مرة أخرى.');
  if (!data) return null;
  let orderResult;
  try {
    orderResult = await supabase.from('orders').select('copies_count').eq('id', data.order_id).maybeSingle();
  } catch (_) {
    throw new Error('تعذر تحميل بيانات الطلب المرتبط بالترخيص.');
  }
  const { data: order, error: orderError } = orderResult;
  if (orderError || !order) throw new Error('تعذر تحميل بيانات الطلب المرتبط بالترخيص.');
  return {
    ...data,
    total_prints: Number(order.copies_count),
    document: { ...(data.documents ?? {}), category: 'وثيقة مرخصة' }
  };
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
  if (!$('#privacy-consent')?.checked) {
    setNotice('يجب الموافقة على سياسة الخصوصية قبل تفعيل الوثيقة.', 'error');
    $('#privacy-consent')?.focus();
    return;
  }
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

$('#privacy-consent')?.addEventListener('change', syncConsentState);

$('#print-button')?.addEventListener('click', async () => {
  if (!activeLicense || activeLicense.remaining_prints <= 0 || !supabase) return;
  const button = $('#print-button');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
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
    activeLicense = await processPrint(activeLicense.license_key, activeLicense.document_id);
    renderLicense(activeLicense);
    if (activeLicense.remaining_prints < 0) throw new Error('لا توجد نسخ متبقية للطباعة.');
    document.body.classList.add('authorized-print');
    setNotice('تم حجز نسخة الطباعة. افتح نافذة الطباعة لإكمال العملية.', 'success');
    window.print();
  } catch (error) {
    setNotice(error.message || 'تعذر تنفيذ الطباعة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (button) button.disabled = activeLicense?.remaining_prints <= 0;
    window.setTimeout(() => document.body.classList.remove('authorized-print'), 500);
  }
});

class CheckoutError extends Error {}

async function startCheckout(documentId, copiesCount) {
  if (!supabase) throw new CheckoutError('خدمة الدفع غير متاحة الآن. حاول مرة أخرى لاحقًا.');
  if (!documentId) throw new CheckoutError('هذه الوثيقة غير مربوطة بسجل الدفع.');
  if (!Number.isInteger(copiesCount) || copiesCount < 1 || copiesCount > 100) throw new CheckoutError('اختر عددًا صحيحًا من النسخ بين 1 و100.');
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout-', { body: { document_id: documentId, copies: copiesCount } });
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
      const { data: order, error } = await supabase.from('orders').select('id,status,copies_count,document_id,calculated_price,documents(title)').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) {
        setNotice('تعذر تأكيد الطلب بسبب مشكلة اتصال. افتح حسابك لاحقًا لمراجعة حالته.', 'error');
        return;
      }
      if (order?.status === 'failed') {
        setNotice('حالة الطلب: فشل الدفع. يمكنك بدء طلب جديد.', 'error');
        return;
      }
      if (order?.status === 'paid') {
        const { data: license, error: licenseError } = await supabase.from('print_licenses').select('license_key,document_id,remaining_prints,order_id,documents(title,content)').eq('order_id', order.id).maybeSingle();
        if (licenseError) {
          setNotice('تم تأكيد الدفع، لكن تعذر تحميل الترخيص الآن. افتح حسابك بعد قليل.', 'error');
          return;
        }
        if (license) {
          renderLicense({ ...license, total_prints: Number(order.copies_count), document: { ...(license.documents ?? {}), category: 'وثيقة مرخصة' } });
          setNotice(`تم الدفع وتفعيل الترخيص. مفتاحك: ${license.license_key}، والمتبقي ${license.remaining_prints} نسخة.`, 'success');
          return;
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
  setAuthFeedback('');
  if (!$('#auth-dialog')?.open) $('#auth-dialog')?.showModal();
  window.lucide?.createIcons();
}

function continuePendingPurchase() {
  if (!pendingPurchase) return;
  const purchase = pendingPurchase;
  pendingPurchase = null;
  sessionStorage.removeItem(PENDING_PURCHASE_KEY);
  $('#auth-dialog')?.close();
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

$('#auth-close')?.addEventListener('click', () => $('#auth-dialog')?.close());
$('#auth-switch')?.addEventListener('click', () => openAuthDialog(authMode === 'signup' ? 'login' : 'signup'));
$('#forgot-password')?.addEventListener('click', async () => {
  if (!supabase) return setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
  const email = $('#auth-email')?.value.trim();
  if (!email) return setAuthFeedback('أدخل بريدك الإلكتروني أولًا.', 'error');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
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
    continuePendingPurchase();
  } catch (error) {
    setAuthFeedback(authErrorMessage(error), 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
});

async function startOAuth(provider) {
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
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
    if ($('#print-button')) $('#print-button').disabled = true;
    setNotice('تم تسجيل الخروج.', 'success');
  }
});
$('#account-open')?.addEventListener('click', async () => {
  if (!supabase) return;
  closeProfileDropdown();
  $('#account-dialog')?.showModal();
  try {
    await loadAccountHistory();
  } catch (_) {
    if ($('#account-orders')) $('#account-orders').textContent = 'تعذر تحميل الطلبات. تحقق من اتصالك ثم أعد المحاولة.';
  }
});
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
syncConsentState();
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

