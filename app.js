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
const supabase = SUPABASE_ANON_KEY.startsWith('sb_') && window.supabase
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
let authMode = 'signup';

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
  $('#admin-upload-button').classList.toggle('is-hidden', isAdmin);
  $('#upload-document-button').classList.toggle('is-hidden', !isAdmin);
}

function renderAccount(user) {
  const accountStatus = $('#account-status');
  accountStatus.classList.toggle('is-hidden', !user);
  if (user) $('#account-email').textContent = user.email || 'حساب متصل';
}

async function loadAccountHistory() {
  const list = $('#account-orders');
  const summary = $('#account-summary');
  list.innerHTML = '<div class="account-empty">جارٍ تحميل الطلبات...</div>';
  const { data: orders, error: ordersError } = await supabase.from('orders').select('id,calculated_price,currency,copies_count,status,created_at,documents(title)').order('created_at', { ascending: false });
  if (ordersError) {
    list.innerHTML = '<div class="account-empty">تعذر تحميل الطلبات الآن.</div>';
    summary.textContent = ordersError.message;
    return;
  }
  const { data: licenses } = await supabase.from('print_licenses').select('order_id,license_key,prints_remaining,total_prints_allowed,documents(title)');
  const licensesByOrder = new Map((licenses ?? []).map((license) => [license.order_id, license]));
  summary.textContent = `${orders.length} طلبات محفوظة في حسابك`;
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
  const consent = $('#privacy-consent').checked;
  const activationButton = $('#activation-form button');
  activationButton.disabled = !consent;
  activationButton.setAttribute('aria-disabled', String(!consent));
}

function setNotice(message, type = '') {
  const notice = $('#notice');
  notice.className = `notice ${type}`;
  notice.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info'}"></i><span>${message}</span>`;
  window.lucide?.createIcons();
}

function renderLicense(license) {
  activeLicense = license;
  const remaining = Math.max(0, Number(license.prints_remaining));
  const total = Number(license.total_prints_allowed);
  const used = total - remaining;
  $('#doc-id').textContent = license.access_key.slice(-6);
  $('#document-title').textContent = license.document.title;
  $('#document-content').innerHTML = license.document.content;
  supabase?.auth.getUser().then(({ data: { user } }) => {
    const watermark = user?.email ? `مِداد / ${user.email} / ${license.access_key.slice(-8)}` : `مِداد / ${license.access_key.slice(-8)}`;
    document.querySelectorAll('.paper-watermark').forEach((element) => {
      element.textContent = watermark;
      element.dataset.watermark = watermark;
    });
    document.body.dataset.printWatermark = watermark;
  });
  $('#prints-remaining').textContent = remaining;
  $('#prints-used').textContent = used;
  $('#total-prints').textContent = total;
  $('#progress-bar').style.width = `${Math.min(100, (used / total) * 100)}%`;
  $('#counter-ring').style.background = `conic-gradient(#2563eb ${Math.max(0, (remaining / total) * 360)}deg, #dbeafe 0deg)`;
  $('#license-state').classList.add('active');
  $('#license-state').innerHTML = '<span class="state-dot"></span> مفعل الآن';
  $('#print-button').disabled = remaining <= 0;
  $('#scene-lock').classList.add('is-hidden');
  $('#scene-lock').style.opacity = '0';
  $('#scene-lock').style.visibility = 'hidden';
  $('#scene-lock').style.pointerEvents = 'none';
  $('#scene-lock').style.display = 'none';
  $('#three-scene').classList.add('is-unlocked');
  $('.document-section').classList.add('is-3d');
  $('#three-scene').dispatchEvent(new Event('scene-unlock'));
  window.updateThreeDocument?.(license.document);
  setNotice(`تم التحقق بنجاح. المستند «${license.document.title}» جاهز للمعاينة.`, 'success');
  window.lucide?.createIcons();
}

async function getLicense(key) {
  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('سجّل الدخول قبل تفعيل الترخيص.');
  const { data, error } = await supabase.from('print_licenses').select('license_key,document_id,prints_remaining,total_prints_allowed,documents(title,content)').eq('license_key', key).single();
  if (error || !data) return null;
  return { ...data, access_key: data.license_key, document: data.documents };
}

async function processPrint(licenseKey, documentId) {
  if (!supabase) throw new Error('يجب إعداد Supabase أولًا.');
  const { data, error } = await supabase.functions.invoke('decrement-print-counter', { body: { license_key: licenseKey, document_id: documentId } });
  if (error || !data?.success) throw new Error('تعذر إجراء الطباعة: الترخيص غير صالح أو انتهت النسخ.');
  return { ...activeLicense, prints_remaining: data.remaining_prints };
}

$('#activation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('#privacy-consent').checked) {
    setNotice('يجب الموافقة على سياسة الخصوصية قبل تفعيل الوثيقة.', 'error');
    $('#privacy-consent').focus();
    return;
  }
  const key = $('#license-key').value.trim().toUpperCase();
  if (!/^LIC-[A-Z0-9-]{20,64}$/.test(key)) {
    setNotice('صيغة المفتاح غير صحيحة. استخدم مفتاح LIC الصحيح.', 'error');
    return;
  }
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  button.querySelector('span').textContent = 'جارٍ التحقق...';
  try {
    const license = await getLicense(key);
    if (!license) throw new Error('المفتاح غير موجود أو منتهي الصلاحية.');
    renderLicense(license);
  } catch (error) {
    setNotice(error.message, 'error');
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'تفعيل المستند';
  }
});

$('#privacy-consent').addEventListener('change', syncConsentState);

$('#print-button').addEventListener('click', async () => {
  if (!activeLicense || activeLicense.prints_remaining <= 0 || !supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setNotice('سجّل الدخول قبل الطباعة.', 'error');
    return;
  }
  const button = $('#print-button');
  button.disabled = true;
  try {
    activeLicense = await processPrint(activeLicense.access_key, activeLicense.document_id);
    renderLicense(activeLicense);
    document.body.classList.add('authorized-print');
    setNotice('تم حجز نسخة الطباعة. افتح نافذة الطباعة لإكمال العملية.', 'success');
    window.print();
  } catch (error) {
    setNotice(error.message, 'error');
    button.disabled = false;
  } finally {
    window.setTimeout(() => document.body.classList.remove('authorized-print'), 500);
  }
});

async function startCheckout(documentId, copiesCount) {
  if (!supabase) throw new Error('يجب إعداد Supabase وربط بوابة الدفع أولًا.');
  if (!documentId) throw new Error('هذه الوثيقة غير مربوطة بسجل Supabase بعد.');
  const { data, error } = await supabase.functions.invoke('create-checkout', { body: { document_id: documentId, copies_count: copiesCount } });
  if (error || !data?.checkout_url) throw new Error(error?.message ?? data?.error ?? 'تعذر إنشاء جلسة الدفع.');
  window.location.assign(data.checkout_url);
}

function setAuthFeedback(message, type = '') {
  const feedback = $('#auth-feedback');
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type}`;
}

function openAuthDialog(mode = 'signup') {
  authMode = mode;
  $('#auth-title').textContent = mode === 'signup' ? 'أنشئ حسابك لإتمام الشراء' : mode === 'reset' ? 'أنشئ كلمة مرور جديدة' : 'سجّل الدخول لإتمام الشراء';
  $('#auth-subtitle').textContent = mode === 'signup' ? 'احفظ تراخيصك وعمليات الطباعة في حساب آمن.' : mode === 'reset' ? 'اختر كلمة مرور جديدة لحماية حسابك.' : 'استخدم حسابك للوصول إلى طلباتك وتراخيصك.';
  $('#auth-submit').childNodes[0].textContent = mode === 'signup' ? 'إنشاء حساب ' : mode === 'reset' ? 'حفظ كلمة المرور ' : 'تسجيل الدخول ';
  $('#auth-switch').textContent = mode === 'signup' ? 'لديك حساب؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب';
  $('#auth-email').closest('label').classList.toggle('is-hidden', mode === 'reset');
  $('#auth-email').required = mode !== 'reset';
  $('#forgot-password').classList.toggle('is-hidden', mode !== 'login');
  $('#auth-switch').classList.toggle('is-hidden', mode === 'reset');
  document.querySelector('.oauth-divider').classList.toggle('is-hidden', mode === 'reset');
  document.querySelector('.oauth-buttons').classList.toggle('is-hidden', mode === 'reset');
  setAuthFeedback('');
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
  window.lucide?.createIcons();
}

async function continuePendingCheckout() {
  const checkout = pendingCheckout;
  pendingCheckout = null;
  sessionStorage.removeItem('pending-checkout');
  $('#auth-dialog').close();
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
  $('#purchase-title').textContent = item.title;
  $('#quantity-value').textContent = selectedQuantity;
  $('#purchase-total').textContent = item.price;
  $('#purchase-dialog').showModal();
}

function updatePurchaseTotal() {
  const item = documentCatalog[selectedDocument];
  $('#quantity-value').textContent = selectedQuantity;
  $('#purchase-total').textContent = item.price * selectedQuantity;
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
  $('.document-catalog').appendChild(card);
  card.querySelector('[data-buy]').addEventListener('click', () => openPurchase(documentId));
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

$('#upload-document-button').addEventListener('click', () => $('#document-upload').click());
$('#admin-upload-button').addEventListener('click', () => {
  $('#admin-login-dialog').showModal();
});
$('#admin-login-close').addEventListener('click', () => $('#admin-login-dialog').close());
$('#admin-login-submit').addEventListener('click', () => {
  if (!supabase) {
    setNotice('يجب إعداد Supabase وتسجيل دخول حساب المسؤول.', 'error');
    return;
  }
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (user?.user_metadata?.role !== 'admin') {
      setNotice('حسابك ليس حساب مسؤول.', 'error');
      return;
    }
    isAdmin = true;
    $('#admin-login-dialog').close();
    renderAdminAccess();
    setNotice('تم التحقق من حساب المسؤول.', 'success');
  });
});
$('#document-upload').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const documentData = await readUploadedDocument(file);
    pendingUpload = documentData;
    $('#upload-file-name').textContent = file.name;
    $('#uploaded-title').value = documentData.title;
    $('#uploaded-price').value = '120';
    $('#upload-details-dialog').showModal();
  } catch (error) {
    setNotice('تعذر قراءة الملف. جرّب ملف TXT أو HTML أو صورة.', 'error');
  } finally {
    event.target.value = '';
  }
});

$('#upload-details-close').addEventListener('click', () => { pendingUpload = null; $('#upload-details-dialog').close(); });
$('#save-uploaded-document').addEventListener('click', () => {
  if (!pendingUpload) return;
  const title = $('#uploaded-title').value.trim();
  const price = Number($('#uploaded-price').value);
  if (!title || !Number.isFinite(price) || price < 0) {
    setNotice('أدخل اسم الوثيقة وسعرًا صحيحًا قبل الحفظ.', 'error');
    return;
  }
  pendingUpload.title = title;
  const documentId = `uploaded-${Date.now()}`;
  addUploadedDocumentToCatalog(documentId, pendingUpload, price);
  $('#upload-details-dialog').close();
  setNotice('تم حفظ بيانات الملف محليًا. اربط Storage ودالة إدارة الوثائق لحفظه على الخادم.', 'success');
  pendingUpload = null;
});

document.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => openPurchase(button.dataset.buy)));
$('#quantity-minus').addEventListener('click', () => { selectedQuantity = Math.max(1, selectedQuantity - 1); updatePurchaseTotal(); });
$('#quantity-plus').addEventListener('click', () => { selectedQuantity = Math.min(99, selectedQuantity + 1); updatePurchaseTotal(); });
$('#purchase-close').addEventListener('click', () => $('#purchase-dialog').close());
$('#payment-close').addEventListener('click', () => $('#payment-dialog').close());
$('#continue-payment').addEventListener('click', () => {
  const item = documentCatalog[selectedDocument];
  $('#payment-summary').textContent = `${item.title} / ${selectedQuantity} ${selectedQuantity === 1 ? 'نسخة' : 'نسخ'} / ${item.price * selectedQuantity} دج`;
  $('#purchase-dialog').close();
  $('#payment-dialog').showModal();
});
$('#start-provider-checkout').addEventListener('click', () => {
  const item = documentCatalog[selectedDocument];
  if (!supabase) {
    setNotice('يجب إعداد Supabase أولًا.', 'error');
    return;
  }
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) {
      savePendingCheckout({ documentId: item.document_id, copiesCount: selectedQuantity });
      $('#payment-dialog').close();
      openAuthDialog();
      return;
    }
    startCheckout(item.document_id, selectedQuantity).catch((error) => setNotice(error.message, 'error'));
  }).catch((error) => setNotice(error.message, 'error'));
});

$('#auth-close').addEventListener('click', () => $('#auth-dialog').close());
$('#auth-switch').addEventListener('click', () => openAuthDialog(authMode === 'signup' ? 'login' : 'signup'));
$('#forgot-password').addEventListener('click', async () => {
  if (!supabase) return setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
  const email = $('#auth-email').value.trim();
  if (!email) return setAuthFeedback('أدخل بريدك الإلكتروني أولًا.', 'error');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  setAuthFeedback(error ? error.message : 'تم إرسال رابط استرجاع كلمة المرور إلى بريدك.', error ? 'error' : 'success');
});
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) {
    setAuthFeedback('تعذر الاتصال بخدمة الحسابات.', 'error');
    return;
  }
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const submit = $('#auth-submit');
  submit.disabled = true;
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
      $('#auth-dialog').close();
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
    submit.disabled = false;
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

$('#google-auth').addEventListener('click', () => startOAuth('google'));
$('#github-auth').addEventListener('click', () => startOAuth('github'));
$('#account-logout').addEventListener('click', async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) setNotice(error.message, 'error');
  else {
    renderAccount(null);
    activeLicense = null;
    setNotice('تم تسجيل الخروج.', 'success');
  }
});
$('#account-open').addEventListener('click', async () => {
  if (!supabase) return;
  $('#account-dialog').showModal();
  await loadAccountHistory();
});
$('#account-close').addEventListener('click', () => $('#account-dialog').close());
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

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
  if (!THREE || !OrbitControls) {
    $('#three-scene').setAttribute('aria-label', 'المعاينة ثلاثية الأبعاد غير متاحة دون اتصال');
    return;
  }
  const mount = $('#three-scene');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, mount.clientWidth / mount.clientHeight, .1, 100);
  camera.position.set(0, .35, 5.9);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false;
  controls.minPolarAngle = Math.PI * .3; controls.maxPolarAngle = Math.PI * .7;
  controls.target.set(0, 0, 0);
  const group = new THREE.Group(); group.rotation.set(-.08, .12, .025); group.visible = false; scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdbeafe, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2); keyLight.position.set(-3, 4, 5); scene.add(keyLight);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(2.55, 3.25, .12), new THREE.MeshPhysicalMaterial({ color:0xf8fafc, roughness:.22, metalness:.05, clearcoat:1, clearcoatRoughness:.15 }));
  group.add(paper);
  const documentCanvas = document.createElement('canvas');
  documentCanvas.width = 640; documentCanvas.height = 820;
  const documentContext = documentCanvas.getContext('2d');
  const documentTexture = new THREE.CanvasTexture(documentCanvas);
  documentTexture.colorSpace = THREE.SRGBColorSpace;
  const insetMaterial = new THREE.MeshBasicMaterial({ map:documentTexture, transparent:true, opacity:.98 });
  const inset = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.88), insetMaterial); inset.position.z = .071; group.add(inset);
  function updateThreeDocument(documentData = {}) {
    if (documentData.imageUrl) {
      const image = new Image();
      image.onload = () => {
        const imageTexture = new THREE.Texture(image);
        imageTexture.colorSpace = THREE.SRGBColorSpace;
        imageTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        imageTexture.needsUpdate = true;
        insetMaterial.map = imageTexture;
        insetMaterial.color.set(0xffffff);
        insetMaterial.needsUpdate = true;
        const aspect = image.width / image.height;
        const maxWidth = 2.2;
        const maxHeight = 2.88;
        const width = aspect >= maxWidth / maxHeight ? maxWidth : maxHeight * aspect;
        const height = aspect >= maxWidth / maxHeight ? maxWidth / aspect : maxHeight;
        inset.geometry.dispose();
        inset.geometry = new THREE.PlaneGeometry(width, height);
      };
      image.src = documentData.imageUrl;
      return;
    }
    documentContext.fillStyle = '#ffffff'; documentContext.fillRect(0, 0, 640, 820);
    documentContext.direction = 'rtl'; documentContext.textAlign = 'right';
    documentContext.fillStyle = '#0f172a'; documentContext.font = '700 34px Tajawal, sans-serif'; documentContext.fillText(documentData.title || 'وثيقة', 570, 110);
    documentContext.strokeStyle = '#dbeafe'; documentContext.lineWidth = 3; documentContext.beginPath(); documentContext.moveTo(70, 155); documentContext.lineTo(570, 155); documentContext.stroke();
    documentContext.fillStyle = '#475569'; documentContext.font = '24px Tajawal, sans-serif';
    const plainText = (documentData.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
    const words = plainText.split(' '); let line = ''; let y = 225;
    words.forEach((word) => { const candidate = `${line} ${word}`.trim(); if (documentContext.measureText(candidate).width > 490) { documentContext.fillText(line, 570, y); line = word; y += 42; } else line = candidate; });
    if (line) documentContext.fillText(line, 570, y);
    documentTexture.needsUpdate = true;
  }
  updateThreeDocument();
  const lines = new THREE.Group();
  [0.6, .35, .1, -.15, -.4].forEach((y, index) => { const width = index === 0 ? 1.3 : index === 4 ? .65 : 1.65; const line = new THREE.Mesh(new THREE.PlaneGeometry(width, .035), new THREE.MeshBasicMaterial({ color:index === 0 ? 0x2563eb : 0xcbd5e1, transparent:true, opacity:index === 0 ? .8 : .9 })); line.position.set(-.48, y, .09); lines.add(line); });
  group.add(lines); lines.visible = false;
  const seal = new THREE.Mesh(new THREE.TorusGeometry(.28, .035, 12, 32), new THREE.MeshBasicMaterial({ color:0x10b981 })); seal.position.set(.65, -.74, .1); group.add(seal);
  seal.visible = false;
  function resize() { const width = mount.clientWidth; const height = mount.clientHeight; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); }
  window.addEventListener('resize', resize);
  $('#three-scene').dataset.ready = 'true';
  window.updateThreeDocument = updateThreeDocument;
  $('#three-scene').addEventListener('scene-unlock', () => { group.visible = true; });
  function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
  animate();
}

window.lucide?.createIcons();
renderAdminAccess();
syncConsentState();
create3DScene();
restorePendingCheckout();
supabase?.auth.getSession().then(({ data: { session } }) => {
  renderAccount(session?.user ?? null);
  if (session && pendingCheckout) continuePendingCheckout();
});
supabase?.auth.onAuthStateChange((event, session) => {
  renderAccount(session?.user ?? null);
  if (event === 'PASSWORD_RECOVERY') openAuthDialog('reset');
});
threeReady.then(() => {
  if (!$('#three-scene').dataset.ready) create3DScene();
});

const privacyDialog = $('#privacy-dialog');
$('#privacy-policy-link').addEventListener('click', () => privacyDialog.showModal());
$('#privacy-dialog-close').addEventListener('click', () => privacyDialog.close());
document.addEventListener('click', (event) => {
  if (event.target === privacyDialog) privacyDialog.close();
});
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    if ($('#scene-lock').classList.contains('is-hidden')) $('#three-scene').dispatchEvent(new Event('scene-unlock'));
  });
  observer.observe($('#scene-lock'), { attributes: true, attributeFilter: ['class'] });
});
