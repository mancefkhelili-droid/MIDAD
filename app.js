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
      supabase.from('orders').select('id,calculated_price,copies_count,status,created_at,document_id').order('created_at', { ascending: false }),
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
        const status = order.status === 'paid' ? 'مدفوع' : order.status === 'failed' ? 'فشل' : 'قيد الانتظار';
        const article = document.createElement('article');
        article.className = 'order-item';
        const top = document.createElement('div');
        top.className = 'order-item-top';
        const title = document.createElement('span');
        title.textContent = titles[order.document_id] ?? 'وثيقة غير متاحة';
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
      title.textContent = titles[license.document_id] ?? 'وثيقة غير متاحة';
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
  }

  setupInteractiveDocumentStudio(license);
  const isPdf = Boolean(license.document.storage_path);
  applyWatermark(license);
  if (contentEl && isPdf) renderPdfInto(contentEl, license.document.storage_path, license);
  else if (contentEl) contentEl.setAttribute('contenteditable', license.isShop ? 'false' : 'true');

  if ($('#prints-remaining')) $('#prints-remaining').textContent = remaining;
  if ($('#prints-used')) $('#prints-used').textContent = used;
  if ($('#total-prints')) $('#total-prints').textContent = total;
  if ($('#progress-bar')) $('#progress-bar').style.width = `${total ? Math.min(100, (used / total) * 100) : 0}%`;
  if ($('#counter-ring')) $('#counter-ring').style.background = `conic-gradient(#2563eb ${total ? Math.max(0, (remaining / total) * 360) : 0}deg, #dbeafe 0deg)`;
  
  const stateEl = $('#license-state');
  if (stateEl) {
    stateEl.classList.add('active');
    stateEl.innerHTML = license.isAdmin ? '<span class="state-dot"></span> وضع الأدمن' : license.isShop ? '<span class="state-dot"></span> وضع المطبعة' : '<span class="state-dot"></span> مفعل الآن';
  }
  if (license.isAdmin || license.isShop) {
    const symbol = license.isShop ? '—' : '∞';
    if ($('#prints-remaining')) $('#prints-remaining').textContent = symbol;
    if ($('#prints-used')) $('#prints-used').textContent = '0';
    if ($('#total-prints')) $('#total-prints').textContent = symbol;
    if ($('#progress-bar')) $('#progress-bar').style.width = '0%';
    if ($('#counter-ring')) $('#counter-ring').style.background = 'conic-gradient(#2563eb 360deg, #dbeafe 0deg)';
    if ($('#license-key')) $('#license-key').value = '';
  }
  
  const printBtn = $('#print-button');
  if (printBtn) printBtn.disabled = !(license.isAdmin || license.isShop) && remaining <= 0;
  const canShop = !license.isAdmin && !license.isShop && remaining > 0;
  $('#shop-open')?.classList.toggle('is-hidden', !canShop);
  $('#shop-hint')?.classList.toggle('is-hidden', !canShop);
  
  const wmInfo = 'العلامة المائية باسم بريدك تظهر على الشاشة فقط ولن تُطبع.';
  if (license.isAdmin) setNotice(`وضع الأدمن: تعرض وتطبع أي وثيقة بدون دفع وبدون خصم نسخ. ${wmInfo}`, 'info');
  else if (license.isShop) setNotice(`وضع المطبعة: الوثيقة جاهزة للطباعة${license.shopExpiresAt ? ` (الرمز صالح حتى ${new Date(license.shopExpiresAt).toLocaleString('ar-DZ', { dateStyle: 'medium', timeStyle: 'short' })})` : ''}. ${wmInfo}`, 'success');
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
  pattern.setAttribute('width', '420');
  pattern.setAttribute('height', '170');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', 'rotate(-28)');
  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', '14');
  label.setAttribute('y', '90');
  label.setAttribute('font-size', '15');
  label.setAttribute('font-weight', '600');
  label.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
  label.setAttribute('fill', '#1e293b');
  label.setAttribute('fill-opacity', '0.17');
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
let annotPlacing = false;
let annotSize = 2.4;
let annotColor = '#111827';
let annotBold = false;
let pdfToolbarReady = false;

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

function setPlacing(on) {
  annotPlacing = on;
  document.body.classList.toggle('annot-placing', on);
  $('#pdf-add-text')?.classList.toggle('active', on);
  if (on) setNotice('اضغط على الملف في المكان الذي تريد الكتابة فيه.', 'info');
}

function selectAnnot(element) {
  annotSelected?.classList.remove('selected');
  annotSelected = element;
  element?.classList.add('selected');
}

function createAnnot(layer, xPct, yPct) {
  const box = document.createElement('div');
  box.className = 'annot';
  box.style.left = `${xPct}%`;
  box.style.top = `${yPct}%`;
  box.dataset.size = String(annotSize);
  box.style.fontSize = `${annotSize}cqw`;
  box.style.color = annotColor;
  box.style.fontWeight = annotBold ? '700' : '400';
  const handle = document.createElement('span');
  handle.className = 'annot-handle';
  handle.setAttribute('aria-label', 'تحريك النص');
  handle.textContent = '✥';
  const text = document.createElement('div');
  text.className = 'annot-text';
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.dir = 'auto';
  text.textContent = 'نص جديد';
  box.append(handle, text);
  layer.appendChild(box);
  text.addEventListener('focus', () => selectAnnot(box));
  text.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData)?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, pasted);
  });
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    selectAnnot(box);
    handle.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = parseFloat(box.style.left);
    const startTop = parseFloat(box.style.top);
    const move = (moveEvent) => {
      box.style.left = `${clampNumber(startLeft + ((moveEvent.clientX - startX) / rect.width) * 100, 0, 94)}%`;
      box.style.top = `${clampNumber(startTop + ((moveEvent.clientY - startY) / rect.height) * 100, 0, 96)}%`;
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
  selectAnnot(box);
  text.focus();
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return box;
}

function wireAnnotLayer(layer) {
  layer.addEventListener('pointerdown', (event) => {
    if (event.target !== layer) return;
    if (annotPlacing) {
      event.preventDefault();
      const rect = layer.getBoundingClientRect();
      createAnnot(layer, clampNumber(((event.clientX - rect.left) / rect.width) * 100, 0, 92), clampNumber(((event.clientY - rect.top) / rect.height) * 100, 0, 95));
      setPlacing(false);
    } else {
      selectAnnot(null);
    }
  });
}

function initPdfToolbar() {
  if (pdfToolbarReady) return;
  pdfToolbarReady = true;
  const changeSize = (delta) => {
    const base = annotSelected ? parseFloat(annotSelected.dataset.size) || annotSize : annotSize;
    annotSize = clampNumber(Math.round((base + delta) * 10) / 10, 1, 9);
    if (annotSelected) {
      annotSelected.dataset.size = String(annotSize);
      annotSelected.style.fontSize = `${annotSize}cqw`;
    }
  };
  $('#pdf-add-text')?.addEventListener('click', () => setPlacing(!annotPlacing));
  $('#pdf-size-up')?.addEventListener('click', () => changeSize(0.3));
  $('#pdf-size-down')?.addEventListener('click', () => changeSize(-0.3));
  $('#pdf-color')?.addEventListener('input', (event) => {
    annotColor = event.target.value;
    if (annotSelected) annotSelected.style.color = annotColor;
  });
  $('#pdf-bold')?.addEventListener('click', () => {
    annotBold = !annotBold;
    $('#pdf-bold')?.classList.toggle('active', annotBold);
    if (annotSelected) annotSelected.style.fontWeight = annotBold ? '700' : '400';
  });
  $('#pdf-delete')?.addEventListener('click', () => {
    if (!annotSelected) return;
    annotSelected.remove();
    annotSelected = null;
  });
  $('#pdf-clear')?.addEventListener('click', () => {
    if (!document.querySelector('.annot')) return;
    if (!window.confirm('حذف كل النصوص التي أضفتها على الملف؟')) return;
    document.querySelectorAll('.annot').forEach((element) => element.remove());
    annotSelected = null;
  });
}

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
    if (token === pdfRenderToken) container.dataset.pdfReady = '1';
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
  if (!activeLicense || (!activeLicense.isAdmin && !activeLicense.isShop && activeLicense.remaining_prints <= 0) || !supabase) return;
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
    if (activeLicense.isAdmin) {
      const { data: adminCheck } = await supabase.rpc('admin_get_document', { p_id: activeLicense.document_id });
      if (!adminCheck) throw new Error('صلاحية الأدمن غير متاحة. سجّل الدخول من جديد.');
    } else if (!activeLicense.isShop) {
      activeLicense = await processPrint(activeLicense.license_key, activeLicense.document_id);
      renderCounters(activeLicense);
    }
    setPlacing(false);
    selectAnnot(null);
    if (activeLicense.document.storage_path) {
      const pageStyle = document.createElement('style');
      pageStyle.id = 'print-page-style';
      pageStyle.textContent = '@page { margin: 0; }';
      document.head.appendChild(pageStyle);
    }
    document.body.classList.add('authorized-print');
    setNotice(activeLicense.isAdmin ? 'وضع الأدمن: لم تُخصم أي نسخة. تُطبع الوثيقة بدون العلامة المائية.' : activeLicense.isShop ? 'جارٍ فتح نافذة الطباعة. تُطبع الوثيقة بدون العلامة المائية.' : 'تم حجز نسخة الطباعة. تُطبع الوثيقة بدون العلامة المائية، فهي تظهر على الشاشة فقط.', 'success');
    const cleanupPrint = () => {
      document.body.classList.remove('authorized-print');
      document.getElementById('print-page-style')?.remove();
    };
    window.addEventListener('afterprint', cleanupPrint, { once: true });
    window.setTimeout(cleanupPrint, 120000);
    window.print();
  } catch (error) {
    setNotice(error.message || 'تعذر تنفيذ الطباعة الآن. حاول مرة أخرى.', 'error');
  } finally {
    if (button) button.disabled = !activeLicense?.isAdmin && !activeLicense?.isShop && activeLicense?.remaining_prints <= 0;
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
  if (remaining <= 0) {
    $('#shop-open')?.classList.add('is-hidden');
    $('#shop-hint')?.classList.add('is-hidden');
  }
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
      const { data: order, error } = await supabase.from('orders').select('id,status,copies_count,document_id,calculated_price').order('created_at', { ascending: false }).limit(1).maybeSingle();
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
            setNotice(`تم الدفع وتفعيل الترخيص تلقائيًا. مفتاحك: ${license.license_key}، والمتبقي ${license.remaining_prints} نسخة.`, 'success');
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
  if (pdf.numPages > MAX_PDF_PAGES) throw new Error('too_many_pages');
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
    if (!window.confirm(`حذف «${doc.title}» نهائيًا؟ لا يمكن التراجع.`)) return;
    remove.disabled = true;
    let { data, error } = await supabase.rpc('admin_delete_document', { p_id: doc.id, p_force: false });
    if (!error && data?.status === 'has_sales') {
      const sure = window.confirm(`تنبيه: لهذه الوثيقة ${data.paid_orders} طلبات مدفوعة و${data.licenses} تراخيص.\nحذفها سيمنع المشترين من فتحها ولا يمكن التراجع.\nهل تريد الحذف رغم ذلك؟`);
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

function showShopDialog(code, expiresAt) {
  const link = `${location.origin}${location.pathname}?shop=${code}`;
  $('#shop-code-text').textContent = formatShopCode(code);
  $('#shop-link').value = link;
  $('#shop-qr-wrap')?.classList.toggle('is-hidden', !drawQr($('#shop-qr'), link));
  $('#shop-expiry').textContent = `صالح حتى ${new Date(expiresAt).toLocaleString('ar-DZ', { dateStyle: 'medium', timeStyle: 'short' })}`;
  if ($('#shop-feedback')) { $('#shop-feedback').textContent = ''; $('#shop-feedback').className = 'auth-feedback'; }
  $('#shop-dialog')?.showModal();
}

async function createShopCode() {
  if (!activeLicense || activeLicense.isAdmin || activeLicense.isShop || !supabase) return;
  const button = $('#shop-open');
  if (button) button.disabled = true;
  try {
    const { data, error } = await supabase.rpc('create_print_shop_code', { p_license_key: activeLicense.license_key });
    if (error) throw error;
    if (data?.status === 'no_prints') setNotice('لا توجد نسخ متبقية في هذا الترخيص.', 'error');
    else if (data?.status === 'too_many') setNotice('لديك 5 رموز غير مستعملة. استعمل أحدها أو انتظر انتهاءها (24 ساعة).', 'error');
    else if (data?.status === 'ok') showShopDialog(data.code, data.expires_at);
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
  let result;
  try {
    result = await supabase.functions.invoke('print-shop', { body: { code } });
  } catch (_) {
    return setNotice('تعذر الاتصال بالخدمة. تحقق من الاتصال وأعد المحاولة.', 'error');
  }
  const { data, error } = result;
  if (error || !data) {
    let status = '';
    try { status = (await error?.context?.json?.())?.status ?? ''; } catch (_) { /* ignore */ }
    return setNotice(SHOP_ERRORS[status] || 'تعذر فتح الوثيقة الآن. حاول مرة أخرى.', 'error');
  }
  if (data.status !== 'ok') return setNotice(SHOP_ERRORS[data.status] || 'تعذر فتح الوثيقة.', 'error');
  renderLicense({
    license_key: 'PRINT-SHOP',
    document_id: data.document_id,
    remaining_prints: 0,
    total_prints: 0,
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
    pdfRenderToken += 1;
    $('#security')?.classList.add('is-hidden');
    const body = $('#document-content');
    if (body) { body.replaceChildren(); body.classList.remove('is-pdf'); body.dataset.pdfReady = '0'; }
    if ($('#license-key')) $('#license-key').value = '';
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


// Opened from a print shop QR code: ?shop=XXXX...
{
  const shopParam = new URLSearchParams(window.location.search).get('shop');
  if (shopParam) openShopCode(shopParam);
}
