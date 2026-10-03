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

function addDocumentCardToCatalog(id, title, price, category = 'وثيقة معتمدة', summary = '', previewUrl = '') {
  documentCatalog[id] = { title, price: Number(price), category, document_id: id, summary, previewUrl };
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
  body.append(type, heading, description, footer);
  card.append(preview, body);
  $('.document-catalog')?.appendChild(card);
  buyButton.addEventListener('click', () => openPurchase(id));
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
  catalog.textContent = 'جارٍ تحميل الوثائق...';
  if (!supabase) {
    catalog.textContent = 'تعذر الاتصال بمكتبة الوثائق الآن.';
    return;
  }
  try {
    const { data: docs, error } = await supabase.from('documents').select('id, title, summary, price_per_copy, preview_path, is_published').eq('is_published', true).order('created_at', { ascending: false });
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
      const previewUrl = doc.preview_path ? supabase.storage.from('previews').getPublicUrl(doc.preview_path).data.publicUrl : '';
      addDocumentCardToCatalog(doc.id, doc.title, doc.price_per_copy, 'وثيقة معتمدة', doc.summary || '', previewUrl);
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
    refreshAdminState(null);
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
      if ($('#document-content') && !activeLicense.document.storage_path) $('#document-content').replaceChildren(sanitizeDocumentHtml(activeLicense.document.content ?? ''));
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
  if ($('#license-key')) $('#license-key').value = license.license_key;
  const contentEl = $('#document-content');
  if (contentEl && !license.document.storage_path) {
    contentEl.classList.remove('is-pdf');
    contentEl.replaceChildren(sanitizeDocumentHtml(license.document.content ?? ''));
  }

  setupInteractiveDocumentStudio(license);
  if (contentEl && license.document.storage_path) renderPdfInto(contentEl, license.document.storage_path);
  else if (contentEl) contentEl.setAttribute('contenteditable', 'true');

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
    total_prints: Number(data.copies_count ?? data.remaining_prints),
    document: { title: data.title, content: data.content ?? '', storage_path: data.storage_path ?? null, category: 'وثيقة مرخصة' }
  };
}

let pdfRenderToken = 0;
async function renderPdfInto(container, path) {
  const token = ++pdfRenderToken;
  const message = (text) => {
    const p = document.createElement('p');
    p.textContent = text;
    container.replaceChildren(p);
  };
  container.classList.add('is-pdf');
  container.setAttribute('contenteditable', 'false');
  message('جارٍ تحميل الوثيقة...');
  try {
    await pdfReady;
    if (!pdfjsLib) throw new Error('pdfjs');
    const { data: blob, error } = await supabase.storage.from('documents').download(path);
    if (error || !blob) throw error || new Error('download');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    if (token !== pdfRenderToken) return;
    const wrap = document.createElement('div');
    wrap.className = 'pdf-pages';
    container.replaceChildren(wrap);
    const cssWidth = Math.min(Math.max(container.clientWidth || 600, 280), 900);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pages = Math.min(pdf.numPages, 200);
    for (let n = 1; n <= pages; n += 1) {
      const page = await pdf.getPage(n);
      if (token !== pdfRenderToken) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `صفحة ${n} من ${pages}`);
      wrap.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (_) {
    if (token === pdfRenderToken) message('تعذر عرض ملف الوثيقة. حدّث الصفحة وحاول مرة أخرى.');
  }
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
    renderCounters(activeLicense);
    document.body.classList.add('authorized-print');
    setNotice('تم حجز نسخة الطباعة. افتح نافذة الطباعة لإكمال العملية.', 'success');
    const cleanupPrint = () => document.body.classList.remove('authorized-print');
    window.addEventListener('afterprint', cleanupPrint, { once: true });
    window.setTimeout(cleanupPrint, 120000);
    window.print();
  } catch (error) {
    setNotice(error.message || 'تعذر تنفيذ الطباعة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (button) button.disabled = activeLicense?.remaining_prints <= 0;
  }
});

// Updates only the counters (never rebuilds the document, so the user's edits are kept).
function renderCounters(license) {
  const remaining = Math.max(0, Number(license.remaining_prints));
  const total = Math.max(remaining, Number(license.total_prints ?? remaining));
  const used = total - remaining;
  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${total ? Math.min(100, (used / total) * 100) : 0}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#2563eb ${total ? Math.max(0, (remaining / total) * 360) : 0}deg, #dbeafe 0deg)`;
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = remaining <= 0;
}

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
        const { data: found, error: licenseError } = await supabase.from('print_licenses').select('license_key').eq('order_id', order.id).maybeSingle();
        if (licenseError) {
          setNotice('تم تأكيد الدفع، لكن تعذر تحميل الترخيص الآن. افتح حسابك بعد قليل.', 'error');
          return;
        }
        if (found) {
          const license = await getLicense(found.license_key);
          if (license) {
            renderLicense(license);   // also fills the activation field with the key
            setNotice(`تم الدفع وتفعيل الترخيص تلقائيًا. مفتاحك: ${license.license_key}، والمتبقي ${license.remaining_prints} نسخة. أرسلنا المفتاح أيضًا إلى بريدك.`, 'success');
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

async function renderPdfPreviewBlob(file) {
  await pdfReady;
  if (!pdfjsLib) throw new Error('pdfjs');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
  } catch (_) {
    setAdminFeedback('تعذر قراءة ملف PDF. تأكد أنه غير تالف وغير محمي بكلمة مرور.', 'error');
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
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'admin-mini danger';
  remove.textContent = 'حذف نهائي';
  remove.addEventListener('click', async () => {
    if (!window.confirm(`حذف «${doc.title}» نهائيًا؟ لا يمكن التراجع.`)) return;
    remove.disabled = true;
    const { data, error } = await supabase.rpc('admin_delete_document', { p_id: doc.id });
    if (error) setManageFeedback('تعذر حذف الوثيقة. حاول مرة أخرى.', 'error');
    else if (data?.status === 'has_sales') setManageFeedback('لا يمكن حذف وثيقة لها مبيعات أو تراخيص. استعمل «إخفاء من الموقع» بدلًا من ذلك.', 'error');
    else if (data?.status === 'deleted') {
      if (data.storage_path) { try { await supabase.storage.from('documents').remove([data.storage_path]); } catch (_) { /* best effort */ } }
      if (data.preview_path) { try { await supabase.storage.from('previews').remove([data.preview_path]); } catch (_) { /* best effort */ } }
      setManageFeedback('تم حذف الوثيقة نهائيًا.', 'success');
    } else setManageFeedback('الوثيقة غير موجودة.', 'error');
    await loadAdminDocuments();
    await loadCatalogFromSupabase();
  });
  actions.append(toggle, remove);
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
  if (authMode !== 'reset' && !requireConsent()) return;
  const email = $('#auth-email')?.value.trim();
  const password = $('#auth-password')?.value;
  const submit = $('#auth-submit');
  if (submit) submit.disabled = true;
  setAuthFeedback('جارٍ التحقق...');
  try {
    const result = authMode === 'reset'
      ? await supabase.auth.updateUser({ password })
      : authMode === 'signup'
        ? await supabase.auth.signUp({ email, password, options: { data: { accepted_terms: 'v2', accepted_terms_at: new Date().toISOString() } } })
        : await supabase.auth.signInWithPassword({ email, password });
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

