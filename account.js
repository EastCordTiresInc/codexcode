const AUTH_CONFIG = window.EASTCORD_AUTH_CONFIG || {};
const CART_KEY = 'eastcord_cart_v1';
const ACCOUNT_SETUP_MESSAGE = 'Account signup is being connected. Please contact EastCord Tires or check back soon.';
const EMAIL_CONFIRMATION_MESSAGE = 'Account created. Please check your email to confirm your account, then log in.';
const EXISTING_MEMBER_LOGIN_MESSAGE = 'This email already has an EastCord Tires account. Please sign in.';
const TAX_RATE = 0.13;
const CUSTOMER_CART_TYPES = new Set(['appointment', 'used_tire']);
const ACCOUNT_USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';
const CUSTOMER_CART_OWNER_KEY_PREFIX = 'eastcord_customer_cart_owner_';
const customerCartSaveChains = {
  appointment: Promise.resolve(),
  used_tire: Promise.resolve(),
};
const CART_STORAGE_KEYS = [
  CART_KEY,
  'cart',
  'eastcord_cart',
  'appointment_cart',
  'eastcord_appointment_cart',
  'eastcord_appointment_cart_v1',
];
const APPOINTMENT_DRAFT_STORAGE_KEYS = [
  'eastcord_pending_appointment_v1',
  'eastcord_auth_redirect',
  'pendingAppointment',
  'pending_appointment',
  'appointmentDraft',
  'savedAppointment',
  'eastcord_appointment_draft',
  'eastcord_saved_appointment',
];
const CART_RESET_STORAGE_KEYS = [...new Set([...CART_STORAGE_KEYS, ...APPOINTMENT_DRAFT_STORAGE_KEYS])];

function logDeveloperError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, error);
}

function logSupabaseError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, {
    message: error?.message || '',
    code: error?.code || '',
    details: error?.details || '',
    hint: error?.hint || '',
  });
}

function logAuthDiagnostic(message, value) {
  console.info(`[EastCord appointment automation] ${message}: ${value ? 'yes' : 'no'}`);
}

function logAuthConfigStatus() {
  logAuthDiagnostic('Supabase URL exists', Boolean(AUTH_CONFIG.supabaseUrl));
  logAuthDiagnostic('Supabase anon key exists', Boolean(AUTH_CONFIG.supabaseAnonKey));
  logAuthDiagnostic('Supabase browser library exists', Boolean(window.supabase));
}

function isAuthConfigured() {
  const url = AUTH_CONFIG.supabaseUrl;
  const key = AUTH_CONFIG.supabaseAnonKey;
  return Boolean(
    url
    && key
    && key.startsWith('eyJ')
    && window.supabase,
  );
}

function getSupabaseClient() {
  if (!isAuthConfigured()) return null;
  if (!window.eastcordSupabaseClient) {
    window.eastcordSupabaseClient = window.supabase.createClient(AUTH_CONFIG.supabaseUrl, AUTH_CONFIG.supabaseAnonKey);
  }
  return window.eastcordSupabaseClient;
}

function getRedirectTarget(defaultTarget = '/account.html') {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get('redirect')
    || localStorage.getItem('eastcord_auth_redirect')
    || defaultTarget;
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : defaultTarget;
}

function goToRedirectTarget(defaultTarget = '/account.html') {
  const redirectTo = getRedirectTarget(defaultTarget);
  localStorage.removeItem('eastcord_auth_redirect');
  window.location.href = redirectTo;
}

function preserveAuthSwitchLinks() {
  const redirectTarget = getRedirectTarget('');
  if (!redirectTarget) return;

  document.querySelectorAll('a[href="/signup.html"], a[href="signup.html"]').forEach((link) => {
    link.href = `/signup.html?redirect=${encodeURIComponent(redirectTarget)}`;
  });

  document.querySelectorAll('a[href="/login.html"], a[href="login.html"]').forEach((link) => {
    link.href = `/login.html?redirect=${encodeURIComponent(redirectTarget)}`;
  });
}

function getFriendlySupabaseError(error, fallback = 'Signup could not be completed right now. Please try again shortly.') {
  const message = String(error?.message || '').trim();
  const lowerMessage = message.toLowerCase();

  if (!message) return fallback;
  if (lowerMessage.includes('already registered') || lowerMessage.includes('already exists') || lowerMessage.includes('already been registered')) {
    return EXISTING_MEMBER_LOGIN_MESSAGE;
  }
  if (lowerMessage.includes('invalid email')) return 'Please enter a valid email address.';
  if (lowerMessage.includes('password')) return message;
  if (lowerMessage.includes('email rate limit')) return 'Too many signup emails were requested. Please wait a few minutes and try again.';
  if (lowerMessage.includes('signup') && lowerMessage.includes('disabled')) return 'Online signup is not enabled yet. Please contact EastCord Tires.';
  if (lowerMessage.includes('fetch') || lowerMessage.includes('network')) return 'Signup could not connect right now. Please check your connection and try again.';

  return message;
}

function isAppointmentLikeItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.type === 'used_tire' || item.inventoryId) return false;
  return item.type === 'appointment'
    || Boolean(item.serviceId)
    || Boolean(item.serviceName)
    || Boolean(item.bookingId)
    || Boolean(item.preferredDate)
    || Boolean(item.vehicleYear || item.vehicleMake || item.vehicleModel);
}

function normalizeCartCollection(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === 'object' && isAppointmentLikeItem(item));
  }

  if (value && typeof value === 'object') {
    const nestedCart = value.items || value.cart || value.appointments || value.appointmentItems;
    if (Array.isArray(nestedCart)) {
      return nestedCart.filter((item) => item && typeof item === 'object' && isAppointmentLikeItem(item));
    }
    if (isAppointmentLikeItem(value)) return [value];
  }

  return [];
}

function readStorageJson(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    logDeveloperError(`Cart storage could not be read from ${key}.`, error);
    return null;
  }
}

function getCart() {
  const rawActiveCart = readStorageJson(localStorage, CART_KEY);
  if (rawActiveCart !== null) {
    return normalizeCartCollection(rawActiveCart);
  }

  for (const key of CART_STORAGE_KEYS) {
    if (key === CART_KEY) continue;
    const localCart = normalizeCartCollection(readStorageJson(localStorage, key));
    if (localCart.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(localCart));
      return localCart;
    }

    const sessionCart = normalizeCartCollection(readStorageJson(sessionStorage, key));
    if (sessionCart.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(sessionCart));
      return sessionCart;
    }
  }

  return [];
}

function validateCustomerCartType(cartType) {
  if (!CUSTOMER_CART_TYPES.has(cartType)) {
    throw new Error(`Unsupported customer cart type: ${cartType}`);
  }
}

function unwrapCartItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      return unwrapCartItems(JSON.parse(items));
    } catch (error) {
      return [];
    }
  }
  if (!items || typeof items !== 'object') return [];
  if (Array.isArray(items.items)) return items.items;
  const keys = Object.keys(items);
  if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
    return keys.sort((a, b) => Number(a) - Number(b)).map((key) => items[key]);
  }
  return [];
}

function normalizeCustomerCartItems(items) {
  return unwrapCartItems(items).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function parseUsedTireInventoryId(item) {
  const candidates = [item?.inventoryId, item?.inventory_id, item?.id];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const raw = String(candidate).trim();
    if (!raw || raw === 'undefined' || raw === 'null') continue;
    const usedMatch = raw.match(/^used-tire-(.+)$/i);
    const value = usedMatch ? usedMatch[1] : raw;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
  }
  return '';
}

function normalizeUsedTireCartItems(items) {
  const byId = new Map();
  normalizeCustomerCartItems(items).forEach((item) => {
    const inventoryId = parseUsedTireInventoryId(item);
    if (inventoryId === '' || inventoryId == null) return;
    const qty = Math.max(1, Number(item.qty ?? item.quantity) || 1);
    const key = String(inventoryId);
    const existing = byId.get(key);
    byId.set(key, {
      ...(existing || {}),
      ...item,
      id: item.id || existing?.id || `used-tire-${inventoryId}`,
      type: 'used_tire',
      inventoryId,
      qty: Math.min(4, qty),
      maxStock: Number(item.maxStock ?? item.current_stock ?? existing?.maxStock) || qty,
      listPrice: item.listPrice ?? existing?.listPrice ?? item.unitPrice ?? item.selling_price ?? existing?.unitPrice ?? null,
      unitPrice: item.unitPrice ?? item.price ?? item.selling_price ?? existing?.unitPrice ?? null,
      markdown: Boolean(item.markdown ?? existing?.markdown),
      brand: item.brand || existing?.brand || '',
      size: item.size || item.size_label || item.tire_size || existing?.size || '',
    });
  });
  return Array.from(byId.values());
}

function getCustomerCartItemKey(cartType, item, index) {
  if (cartType === 'used_tire') {
    return item.inventoryId ? `inventory:${item.inventoryId}` : `fallback:${item.id || index}`;
  }
  return item.bookingId
    ? `booking:${item.bookingId}`
    : `appointment:${item.id || `${item.preferredDate || ''}:${item.preferredTimeWindow || ''}:${index}`}`;
}

function mergeCustomerCartItems(cartType, remoteItems, localItems) {
  validateCustomerCartType(cartType);
  if (cartType === 'used_tire') {
    return normalizeUsedTireCartItems([
      ...normalizeCustomerCartItems(remoteItems),
      ...normalizeCustomerCartItems(localItems),
    ]);
  }
  const merged = new Map();
  normalizeCustomerCartItems(remoteItems).forEach((item, index) => {
    merged.set(getCustomerCartItemKey(cartType, item, index), item);
  });
  normalizeCustomerCartItems(localItems).forEach((item, index) => {
    merged.set(getCustomerCartItemKey(cartType, item, index), item);
  });
  return Array.from(merged.values());
}

function getCustomerCartOwnerKey(cartType) {
  return `${CUSTOMER_CART_OWNER_KEY_PREFIX}${cartType}`;
}

function normalizeCartItemsByType(cartType, items) {
  return cartType === 'used_tire'
    ? normalizeUsedTireCartItems(items)
    : normalizeCustomerCartItems(items);
}

function notifyUsedTireCartChanged(cart = getLocalUsedTireCart()) {
  updateCartCount();
  window.dispatchEvent(new CustomEvent('eastcord:used-tire-cart-changed', {
    detail: { tireCart: cart },
  }));
}

async function persistCustomerCart(cartType, items, options = {}) {
  validateCustomerCartType(cartType);
  const client = getSupabaseClient();
  const user = await getCurrentUser();
  const normalizedItems = normalizeCartItemsByType(cartType, items);

  if (cartType === 'used_tire' && !normalizedItems.length && !options.allowEmpty) {
    const latestLocal = getLocalUsedTireCart();
    if (latestLocal.length) return latestLocal;
    return [];
  }

  if (!client || !user) return normalizedItems;

  const { error } = await client
    .from('customer_carts')
    .upsert({
      customer_id: user.id,
      cart_type: cartType,
      items: normalizedItems,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_id,cart_type' });

  if (error) {
    logSupabaseError(`${cartType} customer cart save failed.`, error);
    throw new Error('Your cart is saved on this device, but it could not be synced to your account.');
  }
  localStorage.setItem(getCustomerCartOwnerKey(cartType), user.id);
  return normalizedItems;
}

function saveCustomerCart(cartType, items, options = {}) {
  validateCustomerCartType(cartType);
  const next = customerCartSaveChains[cartType]
    .catch(() => undefined)
    .then(() => persistCustomerCart(cartType, items, options));
  customerCartSaveChains[cartType] = next;
  return next;
}

async function loadCustomerCart(cartType, localItems = []) {
  validateCustomerCartType(cartType);
  const snapshotLocalItems = normalizeCartItemsByType(cartType, localItems);
  const client = getSupabaseClient();
  const user = await getCurrentUser();
  if (!client || !user) {
    return cartType === 'used_tire'
      ? mergeCustomerCartItems(cartType, snapshotLocalItems, getLocalUsedTireCart())
      : snapshotLocalItems;
  }

  const { data, error } = await client
    .from('customer_carts')
    .select('items')
    .eq('customer_id', user.id)
    .eq('cart_type', cartType)
    .maybeSingle();

  if (error) {
    logSupabaseError(`${cartType} customer cart read failed.`, error);
    throw new Error('Your account cart could not be loaded. Your cart on this device is still available.');
  }

  const remoteItems = normalizeCartItemsByType(cartType, data?.items);
  const latestLocalItems = cartType === 'used_tire'
    ? mergeCustomerCartItems(cartType, snapshotLocalItems, getLocalUsedTireCart())
    : snapshotLocalItems;
  const localCartOwner = localStorage.getItem(getCustomerCartOwnerKey(cartType));
  const belongsToOtherUser = Boolean(localCartOwner && localCartOwner !== user.id);
  let mergedItems = belongsToOtherUser && !latestLocalItems.length
    ? remoteItems
    : mergeCustomerCartItems(cartType, remoteItems, latestLocalItems);

  if (cartType === 'used_tire' && !mergedItems.length && latestLocalItems.length) {
    mergedItems = latestLocalItems;
  }

  const shouldSave = !data || JSON.stringify(mergedItems) !== JSON.stringify(remoteItems);
  if (shouldSave && (cartType !== 'used_tire' || mergedItems.length)) {
    await saveCustomerCart(cartType, mergedItems);
  }
  localStorage.setItem(getCustomerCartOwnerKey(cartType), user.id);
  return mergedItems;
}

async function clearCustomerCart(cartType) {
  return saveCustomerCart(cartType, [], { allowEmpty: true });
}

function saveCart(cart) {
  const normalizedCart = normalizeCartCollection(cart);
  localStorage.setItem(CART_KEY, JSON.stringify(normalizedCart));
  updateCartCount();
  saveCustomerCart('appointment', normalizedCart).catch((error) => {
    logDeveloperError('Appointment cart background sync failed.', error);
  });
}

function getExistingStorageKeys(storage) {
  const keys = [];
  if (!storage) return keys;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function isCartRelatedStorageKey(key) {
  return CART_RESET_STORAGE_KEYS.includes(key)
    || /appointment/i.test(key)
    || /pendingAppointment/i.test(key)
    || /appointmentDraft/i.test(key)
    || /savedAppointment/i.test(key);
}

function removeStorageKeys(storage, keys) {
  if (!storage) return;
  keys.forEach((key) => storage.removeItem(key));
}

function clearCartStorage() {
  const localKeysBefore = getExistingStorageKeys(localStorage).filter(isCartRelatedStorageKey);
  const sessionKeysBefore = getExistingStorageKeys(sessionStorage).filter(isCartRelatedStorageKey);

  console.info('[EastCord appointment automation] Clearing cart storage.', {
    localKeysBefore,
    sessionKeysBefore,
    cartItemCountBefore: getCart().length,
  });

  removeStorageKeys(localStorage, localKeysBefore);
  removeStorageKeys(sessionStorage, sessionKeysBefore);
  localStorage.setItem(CART_KEY, '[]');

  console.info('[EastCord appointment automation] Cart storage cleared.', {
    localKeysAfter: getExistingStorageKeys(localStorage).filter(isCartRelatedStorageKey),
    sessionKeysAfter: getExistingStorageKeys(sessionStorage).filter(isCartRelatedStorageKey),
    cartItemCountAfter: getCart().length,
  });
}

function clearCart() {
  clearCartStorage();
  updateCartCount();
  window.dispatchEvent(new CustomEvent('eastcord:cart-cleared'));
}

function money(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateTaxBreakdown(subtotal) {
  const serviceSubtotal = roundMoney(subtotal);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  const depositAmount = roundMoney(totalWithHst * 0.20);
  const remainingBalance = roundMoney(totalWithHst - depositAmount);

  return {
    serviceSubtotal,
    hstAmount,
    totalWithHst,
    depositAmount,
    remainingBalance,
    taxRate: TAX_RATE,
  };
}

function getBookingTaxDetails(item) {
  const fallback = calculateTaxBreakdown(item.serviceSubtotal ?? item.startingPrice ?? 0);
  return {
    serviceSubtotal: roundMoney(item.serviceSubtotal ?? item.startingPrice ?? fallback.serviceSubtotal),
    hstAmount: roundMoney(item.hstAmount ?? fallback.hstAmount),
    totalWithHst: roundMoney(item.totalWithHst ?? fallback.totalWithHst),
    depositAmount: roundMoney(item.depositAmount ?? fallback.depositAmount),
    remainingBalance: roundMoney(item.remainingBalance ?? fallback.remainingBalance),
    taxRate: Number(item.taxRate ?? TAX_RATE),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getCurrentUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) {
    logSupabaseError('Supabase user lookup failed.', error);
    return null;
  }
  return data?.user || null;
}

async function getAccessToken() {
  const client = getSupabaseClient();
  if (!client) return '';
  const { data, error } = await client.auth.getSession();
  if (error) {
    logSupabaseError('Supabase session lookup failed.', error);
    return '';
  }
  return data?.session?.access_token || '';
}

function profileFromUser(user) {
  if (!user) return null;
  return {
    customerId: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    email: user.email || '',
    phone: user.user_metadata?.phone || '',
  };
}

function profileFromRow(row, fallbackUser) {
  const fallback = profileFromUser(fallbackUser) || {};
  if (!row && fallbackUser) return fallback;
  if (!row) return null;
  return {
    customerId: row.id || fallback.customerId,
    name: row.full_name || fallback.name || '',
    email: row.email || fallback.email || '',
    phone: row.phone || fallback.phone || '',
  };
}

function buildCustomerProfileRow(profile) {
  return {
    id: profile.customerId,
    full_name: profile.name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    updated_at: new Date().toISOString(),
  };
}

function isDuplicateKeyError(error) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate key');
}

function extractMissingColumnName(error) {
  const message = String(error?.message || error?.details || '');
  const schemaCacheMatch = message.match(/could not find the '([^']+)' column/i);
  if (schemaCacheMatch) return schemaCacheMatch[1];
  const postgresMatch = message.match(/column "([^"]+)" of relation/i);
  if (postgresMatch) return postgresMatch[1];
  return '';
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  const code = String(error?.code || '');
  const isColumnError = code === '42703' || code === 'PGRST204' || message.includes('schema cache') || /column ".+" of relation/.test(message);
  if (!isColumnError) return false;
  if (!columnName) return true;
  return message.includes(columnName.toLowerCase());
}

function profileSaveErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('row-level security') || error?.code === '42501') {
    return 'Customer profile could not be saved because Supabase row security blocked the profile write. Please check the customer_profiles RLS insert/update/select policies.';
  }
  if (isMissingColumnError(error, 'updated_at')) {
    return 'Customer profile could not be saved because the customer_profiles table is missing the updated_at column used by the website.';
  }
  return 'Customer profile could not be saved right now. Please try again shortly.';
}

async function insertCustomerProfile(client, row) {
  return client
    .from('customer_profiles')
    .insert(row)
    .select('id, full_name, phone, email')
    .single();
}

async function updateCustomerProfile(client, row) {
  return client
    .from('customer_profiles')
    .update(row)
    .eq('id', row.id)
    .select('id, full_name, phone, email')
    .single();
}

async function upsertCustomerProfile(profile) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);
  if (!profile?.customerId) throw new Error('Please log in again before continuing.');

  const row = buildCustomerProfileRow(profile);
  console.info('[EastCord appointment automation] customer_profiles save started', {
    idMatchesAuthUser: Boolean(row.id),
    columns: Object.keys(row),
  });

  let insertResult = await insertCustomerProfile(client, row);

  if (isMissingColumnError(insertResult.error, 'updated_at')) {
    delete row.updated_at;
    console.info('[EastCord appointment automation] customer_profiles updated_at column missing; retrying without updated_at.');
    insertResult = await insertCustomerProfile(client, row);
  }

  if (!insertResult.error) {
    console.info('[EastCord appointment automation] customer_profiles insert success');
    return insertResult.data;
  }

  if (!isDuplicateKeyError(insertResult.error)) {
    logSupabaseError('customer_profiles insert failed.', insertResult.error);
    throw new Error(profileSaveErrorMessage(insertResult.error));
  }

  console.info('[EastCord appointment automation] customer_profiles already exists; trying update.');
  let updateResult = await updateCustomerProfile(client, row);

  if (isMissingColumnError(updateResult.error, 'updated_at')) {
    delete row.updated_at;
    console.info('[EastCord appointment automation] customer_profiles updated_at column missing on update; retrying without updated_at.');
    updateResult = await updateCustomerProfile(client, row);
  }

  if (updateResult.error) {
    logSupabaseError('customer_profiles update failed.', updateResult.error);
    throw new Error(profileSaveErrorMessage(updateResult.error));
  }

  console.info('[EastCord appointment automation] customer_profiles update success');
  return updateResult.data;
}

async function getCurrentProfile() {
  const client = getSupabaseClient();
  const user = await getCurrentUser();
  if (!client || !user) return null;

  const { data, error } = await client
    .from('customer_profiles')
    .select('id, full_name, phone, email')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    logSupabaseError('customer_profiles read failed.', error);
    return profileFromUser(user);
  }

  if (!data) {
    const fallback = profileFromUser(user);
    try {
      const inserted = await upsertCustomerProfile(fallback);
      return profileFromRow(inserted, user);
    } catch (profileError) {
      logDeveloperError('customer_profiles fallback create failed.', profileError);
      return fallback;
    }
  }

  return profileFromRow(data, user);
}

function buildBookingRecord(item, profile) {
  const tax = getBookingTaxDetails(item);
  return {
    customer_id: profile.customerId,
    customer_name: profile.name || '',
    customer_email: profile.email || '',
    customer_phone: profile.phone || '',
    service_id: item.serviceId || '',
    service_name: item.serviceName || '',
    starting_price: tax.serviceSubtotal,
    service_subtotal: tax.serviceSubtotal,
    hst_amount: tax.hstAmount,
    total_with_hst: tax.totalWithHst,
    deposit_amount: tax.depositAmount,
    remaining_balance: tax.remainingBalance,
    tax_rate: tax.taxRate,
    preferred_date: item.preferredDate || null,
    preferred_time_window: item.preferredTimeWindow || '',
    vehicle_year: item.vehicleYear || '',
    vehicle_make: item.vehicleMake || '',
    vehicle_model: item.vehicleModel || '',
    vehicle_plate_number: item.vehiclePlateNumber || '',
    vehicle_colour: item.vehicleColour || '',
    tire_size: item.tireSize || '',
    tires_already_on_rims: item.tiresAlreadyOnRims || '',
    number_of_tires: Number(item.numberOfTires || 0),
    full_service_address: item.fullServiceAddress || '',
    city: item.city || '',
    postal_code: item.postalCode || '',
    parking_access_notes: item.parkingAccessNotes || '',
    additional_notes: item.additionalNotes || '',
    service_area_status: item.serviceAreaStatus || 'In service area',
    booking_status: 'Pending Confirmation',
    payment_status: item.paymentStatus || 'pending_checkout',
    stripe_session_id: item.stripeSessionId || '',
    updated_at: new Date().toISOString(),
  };
}

function bookingSaveErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('row-level security') || error?.code === '42501') {
    return 'Booking details could not be saved because your account is not allowed to create this booking. Please log out, log back in, and try again.';
  }
  if (error?.code === 'PGRST205' || (message.includes('could not find the table') && message.includes('appointment_bookings'))) {
    return 'Booking details could not be saved because the appointment bookings table is not set up yet.';
  }
  if (error?.code === '23502') {
    return 'Booking details could not be saved because a required field is missing. Please complete the appointment form and try again.';
  }
  return 'Booking details could not be saved right now. Please try again shortly.';
}

async function insertAppointmentBooking(client, record) {
  const row = { ...record };
  const strippedColumns = new Set();

  while (Object.keys(row).length) {
    const result = await client
      .from('appointment_bookings')
      .insert(row)
      .select('id')
      .single();

    if (!result.error) return result;

    const missingColumn = extractMissingColumnName(result.error);
    if (!missingColumn || !(missingColumn in row) || strippedColumns.has(missingColumn)) {
      return result;
    }

    delete row[missingColumn];
    strippedColumns.add(missingColumn);
    console.info('[EastCord appointment automation] appointment_bookings missing column; retrying without it.', missingColumn);
  }

  return { data: null, error: { message: 'No remaining booking columns to save.' } };
}

async function saveAppointmentBooking(item, profile) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);
  if (!profile?.customerId) throw new Error('Please sign up or log in before booking.');

  const { data, error } = await insertAppointmentBooking(client, buildBookingRecord(item, profile));

  if (error) {
    logSupabaseError('appointment_bookings insert failed.', error);
    throw new Error(bookingSaveErrorMessage(error));
  }
  return data.id;
}

async function getCustomerBookings() {
  const client = getSupabaseClient();
  const profile = await getCurrentProfile();
  if (!client || !profile) return [];

  const { data, error } = await client
    .from('appointment_bookings')
    .select('*')
    .eq('customer_id', profile.customerId)
    .order('created_at', { ascending: false });

  if (error) {
    logSupabaseError('appointment_bookings read failed.', error);
    return [];
  }
  return data || [];
}

function getSignupEmailRedirectTo() {
  return new URL(getRedirectTarget('/account.html'), window.location.origin).toString();
}

function isAlreadyRegisteredError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return code === 'user_already_exists'
    || message.includes('already registered')
    || message.includes('already been registered')
    || message.includes('user already exists');
}

function isExistingAuthUser(data) {
  if (!data?.user || data.session) return false;
  return Array.isArray(data.user.identities) && data.user.identities.length === 0;
}

function existingMemberSignupResult() {
  return { alreadyMember: true, session: null };
}

async function signUpCustomer({ fullName, email, phone, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);

  console.info('[EastCord appointment automation] signup request started');

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getSignupEmailRedirectTo(),
      data: {
        full_name: fullName,
        phone,
      },
    },
  });

  if (error) {
    if (isAlreadyRegisteredError(error)) {
      return existingMemberSignupResult();
    }
    console.info('[EastCord appointment automation] signup error');
    logSupabaseError('Supabase signup failed.', error);
    throw new Error(getFriendlySupabaseError(error));
  }

  if (isExistingAuthUser(data)) {
    return existingMemberSignupResult();
  }

  console.info('[EastCord appointment automation] signup success', {
    userCreated: Boolean(data?.user),
    sessionCreated: Boolean(data?.session),
    emailConfirmationLikelyRequired: Boolean(data?.user && !data?.session),
  });

  if (data?.user && data?.session) {
    try {
      await upsertCustomerProfile({
        customerId: data.user.id,
        name: fullName,
        email: data.user.email || email,
        phone,
      });
    } catch (profileError) {
      logDeveloperError('Customer profile create after signup failed.', profileError);
      throw profileError;
    }
  } else if (data?.user && !data?.session) {
    console.info('[EastCord appointment automation] Email confirmation appears required before login.');
  }

  return data;
}

async function signInCustomer({ email, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    logSupabaseError('Supabase login failed.', error);
    throw new Error(getFriendlySupabaseError(error, 'Login could not be completed. Please check your email and password.'));
  }

  const profile = profileFromUser(data?.user);
  if (profile) await upsertCustomerProfile(profile);
  await hydrateSignedInCarts();
  return data;
}

async function signOutCustomer() {
  const client = getSupabaseClient();
  if (client) {
    try {
      await Promise.all([
        saveCustomerCart('appointment', getCart()),
        saveCustomerCart('used_tire', getLocalUsedTireCart()),
      ]);
    } catch (error) {
      logDeveloperError('Carts could not be fully synced before logout.', error);
    }
    await client.auth.signOut();
  }
  removeStorageKeys(localStorage, CART_STORAGE_KEYS);
  removeStorageKeys(sessionStorage, CART_STORAGE_KEYS);
  localStorage.removeItem(ACCOUNT_USED_TIRE_CART_KEY);
  localStorage.removeItem(getCustomerCartOwnerKey('appointment'));
  localStorage.removeItem(getCustomerCartOwnerKey('used_tire'));
  window.location.href = '/login.html';
}

function getAppointmentCartCount() {
  return getCart().filter((item) => item.serviceId || item.serviceName).length;
}

function getUsedTireCartCount() {
  return getLocalUsedTireCart().reduce((total, item) => total + (Number(item.qty) || 0), 0);
}

function setCartCountText(selector, count) {
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
}

function updateCartCount() {
  const appointmentCount = getAppointmentCartCount();
  const tireCount = getUsedTireCartCount();
  setCartCountText('[data-appointment-cart-count]', appointmentCount);
  setCartCountText('[data-tire-cart-count]', tireCount);
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    const href = element.closest('a')?.getAttribute('href') || '';
    const count = /tire-cart/.test(href) ? tireCount : appointmentCount;
    element.textContent = count ? ` (${count})` : '';
  });
}

function displayNameFromProfile(profile) {
  return String(profile?.name || '').trim() || profile?.email || 'My Account';
}

function applySignedInProfile(profile) {
  const signedIn = Boolean(profile);

  document.querySelectorAll('[data-auth-logged-out]').forEach((element) => {
    element.hidden = signedIn;
  });
  document.querySelectorAll('[data-auth-logged-in]').forEach((element) => {
    element.hidden = !signedIn;
  });

  const displayName = signedIn ? displayNameFromProfile(profile) : 'My Account';
  document.querySelectorAll('[data-account-name]').forEach((element) => {
    element.textContent = displayName;
  });

  document.querySelectorAll('[data-account-email]').forEach((element) => {
    const email = signedIn ? (profile.email || '') : '';
    element.textContent = email;
    element.hidden = !email;
  });

  document.querySelectorAll('[data-account-phone]').forEach((element) => {
    element.textContent = signedIn ? (profile.phone || '') : '';
  });

  document.querySelectorAll('[data-signed-in-identity]').forEach((element) => {
    element.hidden = !signedIn;
  });

  document.querySelectorAll('[data-auth-session-indicator]').forEach((element) => {
    element.remove();
  });

  if (signedIn) fillKnownCustomerFields(profile);
}

function fillKnownCustomerFields(profile) {
  if (!profile) return;

  const values = {
    'Full Name': profile.name || '',
    Name: profile.name || '',
    Email: profile.email || '',
    'Email Address': profile.email || '',
    Phone: profile.phone || '',
    'Phone Number': profile.phone || '',
  };

  document.querySelectorAll('form').forEach((form) => {
    if (form.matches('[data-login-form], [data-signup-form], [name="eastcord-inquiry"]')) return;
    Object.entries(values).forEach(([name, value]) => {
      if (!value) return;
      const field = form.elements?.namedItem(name);
      if (field && 'value' in field && field.type !== 'password') {
        field.value = value;
      }
    });
  });
}

function bindAuthStateChanges() {
  const client = getSupabaseClient();
  if (!client || bindAuthStateChanges.bound) return;
  bindAuthStateChanges.bound = true;

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      applySignedInProfile(null);
      updateCartCount();
      return;
    }
    if (
      event === 'INITIAL_SESSION'
      || event === 'SIGNED_IN'
      || event === 'TOKEN_REFRESHED'
      || event === 'USER_UPDATED'
    ) {
      updateAuthNavigation();
    }
  });
}

async function updateAuthNavigation() {
  let profile = null;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    logDeveloperError('Auth navigation profile lookup failed.', error);
    profile = null;
  }

  applySignedInProfile(profile);
  updateCartCount();
}

function setAuthMessage(message, type = '') {
  const authMessage = document.querySelector('[data-auth-message]');
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.className = `account-message ${type}`.trim();
}

function getLoginPageUrl() {
  const redirectTarget = getRedirectTarget('/account.html');
  return `/login.html?redirect=${encodeURIComponent(redirectTarget)}`;
}

function appendLoginLinkToAuthMessage() {
  const messageElement = document.querySelector('[data-auth-message]');
  if (!messageElement) return;
  messageElement.insertAdjacentHTML('beforeend', ` <a href="${getLoginPageUrl()}">Go to sign in</a>`);
}

function bindAuthForms() {
  const signupForm = document.querySelector('[data-signup-form]');
  const loginForm = document.querySelector('[data-login-form]');

  if (!isAuthConfigured() && (signupForm || loginForm)) {
    setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
  } else {
    setAuthMessage('');
  }

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    logAuthConfigStatus();

    if (!isAuthConfigured()) {
      setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
      logDeveloperError('Signup attempted before Supabase env vars were configured.', {
        supabaseUrlExists: Boolean(AUTH_CONFIG.supabaseUrl),
        supabaseAnonKeyExists: Boolean(AUTH_CONFIG.supabaseAnonKey),
        supabaseLibraryExists: Boolean(window.supabase),
      });
      return;
    }

    const formData = new FormData(signupForm);
    const password = formData.get('Password');
    const confirmPassword = formData.get('Confirm Password');

    if (password !== confirmPassword) {
      setAuthMessage('Passwords do not match.', 'error');
      return;
    }

    setAuthMessage('Creating your account...', 'success');

    try {
      const signupResult = await signUpCustomer({
        fullName: formData.get('Full Name'),
        email: formData.get('Email'),
        phone: formData.get('Phone'),
        password,
      });

      if (signupResult?.alreadyMember) {
        setAuthMessage(EXISTING_MEMBER_LOGIN_MESSAGE, 'success');
        appendLoginLinkToAuthMessage();
        window.setTimeout(() => {
          window.location.href = getLoginPageUrl();
        }, 1200);
        return;
      }

      if (signupResult?.session) {
        setAuthMessage('Account created. Redirecting you back...', 'success');
        window.setTimeout(() => {
          goToRedirectTarget('/account.html');
        }, 800);
        return;
      }

      setAuthMessage(`${EMAIL_CONFIRMATION_MESSAGE} After confirming, log in to continue.`, 'success');
      appendLoginLinkToAuthMessage();
    } catch (error) {
      setAuthMessage(error.message || 'Signup could not be completed.', 'error');
    }
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    logAuthConfigStatus();

    if (!isAuthConfigured()) {
      setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
      logDeveloperError('Login attempted before Supabase env vars were configured.', {
        supabaseUrlExists: Boolean(AUTH_CONFIG.supabaseUrl),
        supabaseAnonKeyExists: Boolean(AUTH_CONFIG.supabaseAnonKey),
        supabaseLibraryExists: Boolean(window.supabase),
      });
      return;
    }

    const formData = new FormData(loginForm);
    setAuthMessage('Logging you in...', 'success');

    try {
      await signInCustomer({
        email: formData.get('Email'),
        password: formData.get('Password'),
      });
      goToRedirectTarget('/account.html');
    } catch (error) {
      setAuthMessage(error.message || 'Login could not be completed.', 'error');
    }
  });
}

function renderBookingHistory(bookings) {
  if (!bookings.length) {
    return '<p class="empty-cart">No appointment bookings yet.</p>';
  }

  return bookings.map((booking) => {
    const vehicle = [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' ');
    const plate = booking.vehicle_plate_number ? ` | Plate: ${escapeHtml(booking.vehicle_plate_number)}` : '';
    const colour = booking.vehicle_colour ? ` | Colour: ${escapeHtml(booking.vehicle_colour)}` : '';
    return `
      <article class="cart-line">
        <span>${escapeHtml(booking.booking_status || 'Pending Confirmation')}</span>
        <strong>${escapeHtml(booking.service_name)}</strong>
        <p>${escapeHtml(booking.preferred_date || '')}${booking.preferred_time_window ? ` at ${escapeHtml(booking.preferred_time_window)}` : ''}</p>
        <p>${escapeHtml(vehicle || 'Vehicle details submitted')}${plate}${colour}${booking.tire_size ? ` | ${escapeHtml(booking.tire_size)}` : ''}</p>
        <p>${escapeHtml(booking.city || '')}</p>
        <p>Service subtotal: ${money(booking.service_subtotal || 0)} | HST 13%: ${money(booking.hst_amount || 0)} | Total including HST: ${money(booking.total_with_hst || 0)}</p>
        <p>Deposit: ${money(booking.deposit_amount)} | Remaining on-site: ${money(booking.remaining_balance)} | Payment: ${escapeHtml(booking.payment_status || 'pending_checkout')}</p>
      </article>
    `;
  }).join('');
}

function getLocalUsedTireCart() {
  const stored = readStorageJson(localStorage, ACCOUNT_USED_TIRE_CART_KEY);
  return normalizeUsedTireCartItems(stored);
}

let accountCartsHydrated = false;
let accountCartHydratePromise = null;

async function hydrateSignedInCarts() {
  if (accountCartHydratePromise) return accountCartHydratePromise;

  accountCartHydratePromise = (async () => {
    const user = await getCurrentUser();
    if (!user) {
      accountCartHydratePromise = null;
      accountCartsHydrated = false;
      return {
        appointmentCart: getCart(),
        tireCart: getLocalUsedTireCart(),
      };
    }

    const [appointmentCart, remoteTireCart] = await Promise.all([
      loadCustomerCart('appointment', getCart()),
      loadCustomerCart('used_tire', getLocalUsedTireCart()),
    ]);
    const normalizedTireCart = mergeCustomerCartItems(
      'used_tire',
      remoteTireCart,
      getLocalUsedTireCart(),
    );

    const normalizedAppointmentCart = normalizeCartCollection(appointmentCart)
      .filter((item) => item.serviceId || item.serviceName);

    localStorage.setItem(CART_KEY, JSON.stringify(normalizedAppointmentCart));
    if (normalizedTireCart.length || !getLocalUsedTireCart().length) {
      localStorage.setItem(ACCOUNT_USED_TIRE_CART_KEY, JSON.stringify(normalizedTireCart));
    }
    accountCartsHydrated = true;
    notifyUsedTireCartChanged();
    window.dispatchEvent(new CustomEvent('eastcord:account-carts-hydrated', {
      detail: { appointmentCart, tireCart: getLocalUsedTireCart() },
    }));
    return { appointmentCart, tireCart: getLocalUsedTireCart() };
  })().catch((error) => {
    accountCartHydratePromise = null;
    accountCartsHydrated = false;
    throw error;
  });

  return accountCartHydratePromise;
}

async function persistSignedInCarts() {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    if (!accountCartsHydrated) {
      await hydrateSignedInCarts();
    }

    await Promise.all([
      saveCustomerCart('appointment', getCart()),
      saveCustomerCart('used_tire', getLocalUsedTireCart()),
    ]);
  } catch (error) {
    logDeveloperError('Signed-in carts could not be saved.', error);
  }
}

function bindAccountCartPersistence() {
  hydrateSignedInCarts().catch((error) => {
    logDeveloperError('Signed-in carts could not be loaded.', error);
  });

  const persist = () => {
    persistSignedInCarts();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('pagehide', persist);
}

async function hydrateAccountCartSummaries() {
  const appointmentSummary = document.querySelector('[data-account-appointment-cart]');
  const tireSummary = document.querySelector('[data-account-tire-cart]');
  if (!appointmentSummary && !tireSummary) return;

  try {
    const { appointmentCart, tireCart } = await hydrateSignedInCarts();

    if (appointmentSummary) {
      appointmentSummary.textContent = `${appointmentCart.length} appointment${appointmentCart.length === 1 ? '' : 's'} saved`;
    }
    if (tireSummary) {
      const tireCount = tireCart.reduce((total, item) => total + (Number(item.qty) || 0), 0);
      tireSummary.textContent = `${tireCount} tire${tireCount === 1 ? '' : 's'} saved`;
    }
  } catch (error) {
    logDeveloperError('Account cart summaries could not be loaded.', error);
    if (appointmentSummary) appointmentSummary.textContent = 'Could not load account cart';
    if (tireSummary) tireSummary.textContent = 'Could not load account cart';
  }
}

async function hydrateAccountPage() {
  const accountPanel = document.querySelector('[data-account-panel]');
  const bookingPanel = document.querySelector('[data-booking-history]');
  if (!accountPanel) return;

  if (!isAuthConfigured()) {
    accountPanel.innerHTML = `<p>${ACCOUNT_SETUP_MESSAGE}</p>`;
    if (bookingPanel) bookingPanel.innerHTML = '';
    return;
  }

  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      accountPanel.innerHTML = '<p>Please log in to view your account.</p><p><a class="button button-primary" href="/login.html?redirect=/account.html">Log In</a></p>';
      if (bookingPanel) bookingPanel.innerHTML = '';
      return;
    }

    accountPanel.innerHTML = `
      <div class="account-detail"><span>Name</span><strong>${escapeHtml(profile.name || 'Not provided')}</strong></div>
      <div class="account-detail"><span>Email</span><strong>${escapeHtml(profile.email)}</strong></div>
      <div class="account-detail"><span>Phone</span><strong>${escapeHtml(profile.phone || 'Not provided')}</strong></div>
    `;

    if (bookingPanel) {
      const bookings = await getCustomerBookings();
      bookingPanel.innerHTML = renderBookingHistory(bookings);
    }
    await hydrateAccountCartSummaries();
  } catch (error) {
    logDeveloperError('Account page hydration failed.', error);
    accountPanel.innerHTML = '<p>Account details could not be loaded right now. Please try again shortly.</p>';
    if (bookingPanel) bookingPanel.innerHTML = '';
  }
}

function bindLogoutButtons() {
  document.querySelectorAll('[data-logout-button]').forEach((button) => {
    button.addEventListener('click', signOutCustomer);
  });
}

function bindCartClearButtons() {
  document.addEventListener('click', (event) => {
    const clearButton = event.target.closest('[data-clear-cart]');
    if (!clearButton) return;
    if (event.defaultPrevented) return;

    event.preventDefault();
    clearCart();
  });
}

window.EastCordAccount = {
  isAuthConfigured,
  getSupabaseClient,
  getCurrentProfile,
  getAccessToken,
  getCart,
  saveCart,
  loadCustomerCart,
  saveCustomerCart,
  persistSignedInCarts,
  hydrateSignedInCarts,
  notifyUsedTireCartChanged,
  applySignedInProfile,
  clearCustomerCart,
  mergeCustomerCartItems,
  normalizeUsedTireCartItems,
  clearCart,
  clearCartStorage,
  saveAppointmentBooking,
  updateCartCount,
  money,
  setupMessage: ACCOUNT_SETUP_MESSAGE,
};

document.addEventListener('DOMContentLoaded', () => {
  logAuthConfigStatus();
  preserveAuthSwitchLinks();
  bindAuthForms();
  bindLogoutButtons();
  bindCartClearButtons();
  bindAuthStateChanges();
  bindAccountCartPersistence();
  hydrateAccountPage();
  updateAuthNavigation();
});