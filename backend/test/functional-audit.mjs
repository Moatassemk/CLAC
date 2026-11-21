/**
 * Functional audit — one scenario per endpoint, plus edge and permission cases.
 * Development only, against the running API (default http://localhost:5002/api).
 *
 *   node test/functional-audit.mjs
 *   API_URL=http://localhost:5002/api node test/functional-audit.mjs
 *
 * Creates its own users, product, discounts, point, stock, offer, request,
 * exchange and conversation, then removes everything it created.
 */
import { query } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const API = process.env.API_URL || `http://127.0.0.1:${env.port}/api`;
const TAG = `FA-${Date.now()}`;
const PASSWORD = 'Fixture2026!';
const results = [];
const created = {
  users: [], products: [], points: [], offers: [], requests: [], exchanges: [],
};
let startedAt;

const CATEGORY = (await query("SELECT id FROM categories WHERE slug = 'olive-pomace'")).rows[0].id;

async function api(method, path, { token, body, form } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, data: json?.data, headers: res.headers };
}

function record(category, name, expected, actual, detail = '') {
  const ok = expected.includes(actual);
  results.push({ category, name, expected, actual, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${category} :: ${name} -> ${JSON.stringify(actual)} (attendu ${expected.join('/')})${detail ? ` — ${detail}` : ''}`);
}

async function must(category, name, promise, expected = [200, 201]) {
  const res = await promise;
  record(category, name, expected, res.status);
  if (!expected.includes(res.status)) throw new Error(`${category}/${name}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res;
}

const login = async (email, password) => {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.data.token;
};

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
const yesterday = () => new Date(Date.now() - 86400000).toISOString();

let T, fixture;

try {
  startedAt = new Date();
  T = {
    admin: await login('admin@clac.tn', 'Admin2026!'),
    seller: await login('huilerie.zitouna@clac.tn', 'Clac2026!'),
    seller2: await login('moulin.elamal@clac.tn', 'Clac2026!'),
    buyer: await login('achats@biodiesel-sahel.tn', 'Clac2026!'),
    collector: await login('collecte.sfax@clac.tn', 'Clac2026!'),
    collector2: await login('grandtunis@eco-collecte.tn', 'Clac2026!'),
  };
  console.log(`API ${API} — ${TAG}\n`);

  /* ================================================================ AUTH */
  const email = `fixture-${Date.now()}-seller@test.local`;
  const reg = await api('POST', '/auth/register', {
    body: { email, password: PASSWORD, role: 'seller', name: 'Fixture vendeur', gouvernorat: 'Sfax', phone: '70123456' },
  });
  record('Auth', 'Inscription vendeur valide', [201], reg.status);
  if (reg.status === 201) {
    fixture = { email, token: reg.data.token, id: reg.data.user.id };
    created.users.push(fixture.id);
  }
  record('Auth', 'Inscription email déjà utilisé', [409], (await api('POST', '/auth/register', {
    body: { email, password: PASSWORD, role: 'seller', name: 'Doublon', gouvernorat: 'Sfax' },
  })).status);
  record('Auth', 'Inscription email invalide', [422], (await api('POST', '/auth/register', {
    body: { email: 'pas-un-email', password: PASSWORD, role: 'seller', name: 'X', gouvernorat: 'Sfax' },
  })).status);
  record('Auth', 'Inscription mot de passe court', [422], (await api('POST', '/auth/register', {
    body: { email: `short-${TAG}@test.local`, password: 'abc', role: 'seller', name: 'X', gouvernorat: 'Sfax' },
  })).status);
  record('Auth', 'Inscription rôle admin refusée', [422], (await api('POST', '/auth/register', {
    body: { email: `admin-${TAG}@test.local`, password: PASSWORD, role: 'admin', name: 'X', gouvernorat: 'Sfax' },
  })).status);
  record('Auth', 'Inscription sans gouvernorat refusée', [422], (await api('POST', '/auth/register', {
    body: { email: `nogov-${TAG}@test.local`, password: PASSWORD, role: 'buyer', name: 'X' },
  })).status);
  record('Auth', 'Connexion mot de passe erroné', [401], (await api('POST', '/auth/login', { body: { email, password: 'Mauvais123!' } })).status);
  record('Auth', 'Connexion compte inconnu', [401], (await api('POST', '/auth/login', { body: { email: `ghost-${TAG}@test.local`, password: PASSWORD } })).status);
  record('Auth', 'GET /auth/me sans jeton', [401], (await api('GET', '/auth/me')).status);
  record('Auth', 'GET /auth/me jeton falsifié', [401], (await api('GET', '/auth/me', { token: `${fixture?.token ?? 'x'}.ab` })).status);
  const buyer2Res = await api('POST', '/auth/register', {
    body: { email: `fixture-${Date.now()}-buyer@test.local`, password: PASSWORD, role: 'buyer', name: 'Fixture acheteur 2', gouvernorat: 'Tunis' },
  });
  record('Auth', 'Inscription second acheteur', [201], buyer2Res.status);
  if (buyer2Res.status === 201) {
    T.buyer2 = buyer2Res.data.token;
    created.users.push(buyer2Res.data.user.id);
  }
  const me = await api('GET', '/auth/me', { token: fixture?.token });
  record('Auth', 'GET /auth/me vendeur', [200], me.status);
  record('Auth', 'GET /auth/me renvoie le bon compte', [email], me.data?.email);
  record('Auth', 'Changement de mot de passe : actuel faux', [400], (await api('PATCH', '/auth/password', {
    token: fixture?.token, body: { current_password: 'Faux12345!', new_password: 'Nouveau2026!' },
  })).status);
  record('Auth', 'Changement de mot de passe : nouveau trop court', [422], (await api('PATCH', '/auth/password', {
    token: fixture?.token, body: { current_password: PASSWORD, new_password: 'court' },
  })).status);
  record('Auth', 'Changement de mot de passe valide', [200, 204], (await api('PATCH', '/auth/password', {
    token: fixture?.token, body: { current_password: PASSWORD, new_password: 'Nouveau2026!' },
  })).status);
  record('Auth', 'Ancien mot de passe refusé après changement', [401], (await api('POST', '/auth/login', { body: { email, password: PASSWORD } })).status);
  record('Auth', 'Nouveau mot de passe accepté', [200], (await api('POST', '/auth/login', { body: { email, password: 'Nouveau2026!' } })).status);
  record('Auth', 'Déconnexion', [200, 204], (await api('POST', '/auth/logout', { token: fixture?.token })).status);

  /* =============================================================== USERS */
  record('Utilisateurs', 'GET /users/me', [200], (await api('GET', '/users/me', { token: T.seller })).status);
  const patchName = await api('PATCH', '/users/me', { token: T.buyer, body: { name: 'Achats Biodiesel Sahel' } });
  record('Utilisateurs', 'PATCH /users/me nom', [200], patchName.status);
  record('Utilisateurs', 'PATCH /users/me lat sans lng refusé', [422], (await api('PATCH', '/users/me', {
    token: T.buyer, body: { lat: 34.7 },
  })).status);
  record('Utilisateurs', 'PATCH /users/me champ inconnu refusé', [422], (await api('PATCH', '/users/me', {
    token: T.buyer, body: { role: 'admin' },
  })).status);
  const sellersDir = await api('GET', '/users/sellers', { token: T.buyer });
  record('Utilisateurs', 'Annuaire vendeurs', [200], sellersDir.status);
  record('Utilisateurs', 'Annuaire vendeurs paginé', [true], sellersDir.body?.meta?.total > 0);
  record('Utilisateurs', 'Annuaire acheteurs interdit à un acheteur', [403], (await api('GET', '/users/buyers', { token: T.buyer })).status);
  record('Utilisateurs', 'Annuaire acheteurs pour un vendeur', [200], (await api('GET', '/users/buyers', { token: T.seller })).status);
  record('Utilisateurs', 'Annuaire collecteurs', [200], (await api('GET', '/users/collectors', { token: T.buyer })).status);
  record('Utilisateurs', 'GET /users/:id identifiant invalide', [422], (await api('GET', '/users/pas-un-uuid', { token: T.buyer })).status);
  record('Utilisateurs', 'GET /users/:id inexistant', [404], (await api('GET', '/users/00000000-0000-4000-8000-000000000000', { token: T.buyer })).status);
  const searchDir = await api('GET', '/users/sellers?q=zitouna', { token: T.buyer });
  record('Utilisateurs', 'Annuaire vendeurs recherche', [true], (searchDir.data ?? []).some((u) => /zitouna/i.test(u.company_name || u.name)));
  record('Utilisateurs', 'Annuaire limit=500 refusé', [422], (await api('GET', '/users/sellers?limit=500', { token: T.buyer })).status);
  record('Utilisateurs', 'Annuaire page=0 refusée', [422], (await api('GET', '/users/sellers?page=0', { token: T.buyer })).status);

  /* ============================================================ PRODUITS */
  record('Produits', 'Création acheteur interdite', [403], (await api('POST', '/products', {
    token: T.buyer, body: { title: 'x', category_id: CATEGORY, quantity_available: 1, gouvernorat: 'Sfax' },
  })).status);
  const baseProduct = {
    title: `${TAG} — grignons de test`, description: 'fixture functional audit', category_id: CATEGORY,
    unit: 'kg', quantity_available: 1000, price_per_unit: 2, min_order_quantity: 100, gouvernorat: 'Sfax',
    lat: 34.75, lng: 10.76,
  };
  const productRes = await must('Produits', 'Création vendeur', api('POST', '/products', { token: T.seller, body: baseProduct }), [201]);
  const product = productRes.data;
  created.products.push(product.id);
  record('Produits', 'Prix affiché initial = prix de base', [2], product.final_price_per_unit);
  record('Produits', 'Catégorie inexistante', [400, 404, 422], (await api('POST', '/products', {
    token: T.seller, body: { ...baseProduct, title: `${TAG} — catégorie fantôme`, category_id: 999999 },
  })).status);
  record('Produits', 'Unité inconnue', [422], (await api('POST', '/products', {
    token: T.seller, body: { ...baseProduct, title: `${TAG} — unité`, unit: 'litres' },
  })).status);
  record('Produits', 'Plus de 10 images refusé', [422], (await api('POST', '/products', {
    token: T.seller, body: { ...baseProduct, title: `${TAG} — images`, images: Array.from({ length: 11 }, () => 'https://x.test/a.jpg') },
  })).status);
  record('Produits', 'lat sans lng refusé', [422], (await api('POST', '/products', {
    token: T.seller, body: { ...baseProduct, title: `${TAG} — geo`, lat: 34.7, lng: undefined },
  })).status);
  record('Produits', 'PATCH vers une catégorie inexistante', [400, 404, 422], (await api('PATCH', `/products/${product.id}`, {
    token: T.seller, body: { category_id: 999999 },
  })).status);
  record('Produits', 'photo du détail acheteur', [200], (await api('GET', `/products/${product.id}`, { token: T.buyer })).status);
  record('Produits', 'PATCH autre vendeur refusé', [403], (await api('PATCH', `/products/${product.id}`, {
    token: T.seller2, body: { price_per_unit: 9 },
  })).status);
  record('Produits', 'DELETE autre vendeur refusé', [403], (await api('DELETE', `/products/${product.id}`, { token: T.seller2 })).status);
  const list = await api('GET', `/products?q=${TAG}`, { token: T.buyer });
  record('Produits', 'Recherche par mot-clé', [200], list.status);
  record('Produits', 'Recherche par mot-clé trouve le produit', [true], (list.data ?? []).some((p) => p.id === product.id));
  const inject = await api('GET', `/products?q=${encodeURIComponent("' OR 1=1 --")}`, { token: T.buyer });
  record('Produits', 'Recherche injection SQL neutralisée', [200], inject.status);
  record('Produits', 'Tri prix croissant', [200], (await api('GET', '/products?sort=price_asc&limit=50', { token: T.buyer })).status);
  const prices = (await api('GET', '/products?sort=price_asc&limit=50', { token: T.buyer })).data?.map((p) => Number(p.final_price_per_unit)) ?? [];
  record('Produits', 'Tri prix croissant respecté', [true], prices.every((p, i) => i === 0 || (p ?? 0) >= (prices[i - 1] ?? 0)));
  record('Produits', 'Tri inconnu refusé', [422], (await api('GET', '/products?sort=bogus', { token: T.buyer })).status);
  record('Produits', 'min_price > max_price', [200, 422], (await api('GET', '/products?min_price=10&max_price=1', { token: T.buyer })).status);
  record('Produits', 'limit=101 refusé', [422], (await api('GET', '/products?limit=101', { token: T.buyer })).status);
  const page2 = await api('GET', '/products?limit=5&page=2', { token: T.buyer });
  record('Produits', 'Pagination page 2', [200], page2.status);
  record('Produits', 'Pagination meta cohérente', [true], page2.body?.meta?.page === 2 && page2.data?.length <= 5);
  record('Produits', '/products/mine vendeur', [200], (await api('GET', '/products/mine', { token: T.seller })).status);
  record('Produits', '/products/mine acheteur interdit', [403], (await api('GET', '/products/mine', { token: T.buyer })).status);
  const inactive = await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { is_active: false } });
  record('Produits', 'Désactivation par le vendeur', [200], inactive.status);
  record('Produits', 'Produit inactif invisible pour un acheteur', [404], (await api('GET', `/products/${product.id}`, { token: T.buyer })).status);
  record('Produits', 'Produit inactif visible par son vendeur', [200], (await api('GET', `/products/${product.id}`, { token: T.seller })).status);
  await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { is_active: true } });
  const feed = await api('GET', `/products?category_id=${CATEGORY}&gouvernorat=Sfax&limit=100`, { token: T.buyer });
  record('Produits', 'Filtres catégorie + gouvernorat', [200], feed.status);
  record('Produits', 'Filtre catégorie respecté', [true], (feed.data ?? []).every((p) => p.category_id === CATEGORY));

  /* ============================================================ REMISES */
  const d1 = await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: `${TAG} -15`, percentage: 15, min_quantity: 100, ends_at: tomorrow() },
  });
  record('Remises', 'Remise 15 % dès 100 kg', [201], d1.status);
  const d2 = await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: `${TAG} -25`, percentage: 25, min_quantity: 300, ends_at: tomorrow() },
  });
  record('Remises', 'Remise 25 % dès 300 kg', [201], d2.status);
  record('Remises', 'Remise sur produit d’un autre vendeur', [403], (await api('POST', '/discounts', {
    token: T.seller2, body: { product_id: product.id, title: 'vol', percentage: 5, ends_at: tomorrow() },
  })).status);
  record('Remises', 'Pourcentage 0 refusé', [422], (await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: `${TAG} zéro`, percentage: 0, ends_at: tomorrow() },
  })).status);
  record('Remises', 'Fin dans le passé refusée', [422], (await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: `${TAG} passé`, percentage: 5, ends_at: yesterday() },
  })).status);
  record('Remises', 'Fin avant début refusée', [422], (await api('POST', '/discounts', {
    token: T.seller, body: {
      product_id: product.id, title: `${TAG} ordre`, percentage: 5,
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), ends_at: tomorrow(),
    },
  })).status);
  const priced = await api('GET', `/products/${product.id}`, { token: T.buyer });
  record('Remises', 'Prix minimum = remise applicable (15 % → 1,7)', [1.7], priced.data?.final_price_per_unit);
  record('Remises', 'Meilleur prix atteignable (25 % → 1,5)', [1.5], priced.data?.best_price_per_unit);
  record('Remises', 'PATCH pourcentage > 100 refusé', [422], (await api('PATCH', `/discounts/${d1.data.id}`, {
    token: T.seller, body: { percentage: 120 },
  })).status);
  record('Remises', 'PATCH fin avant début refusé', [400], (await api('PATCH', `/discounts/${d2.data.id}`, {
    token: T.seller, body: { ends_at: yesterday() },
  })).status);
  record('Remises', 'PATCH par un autre vendeur refusé', [403], (await api('PATCH', `/discounts/${d1.data.id}`, {
    token: T.seller2, body: { percentage: 50 },
  })).status);
  record('Remises', 'DELETE par un autre vendeur refusé', [403], (await api('DELETE', `/discounts/${d1.data.id}`, { token: T.seller2 })).status);
  record('Remises', 'Détail remise', [200], (await api('GET', `/discounts/${d1.data.id}`, { token: T.buyer })).status);
  const activeList = await api('GET', `/discounts?product_id=${product.id}&state=active`, { token: T.buyer });
  record('Remises', 'Liste remises actives', [200], activeList.status);
  record('Remises', 'Liste remises actives contient les deux', [2], (activeList.data ?? []).filter((d) => d.product_id === product.id).length);
  const upcomingList = await api('GET', '/discounts?state=upcoming&limit=100', { token: T.buyer });
  record('Remises', 'Liste “à venir” exclut les actives', [true], (upcomingList.data ?? []).every((d) => d.state === 'upcoming'));
  record('Remises', 'Filtre min_percentage', [true], ((await api('GET', '/discounts?min_percentage=99&limit=100', { token: T.buyer })).data ?? []).every((d) => d.percentage >= 99));
  const unreachable = await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: `${TAG} -40`, percentage: 40, min_quantity: 5000, ends_at: tomorrow() },
  });
  record('Remises', 'Remise au-delà du stock acceptée en gestion', [201], unreachable.status);
  const dealsAll = (await api('GET', `/discounts?product_id=${product.id}&state=active&limit=50`, { token: T.buyer })).data ?? [];
  record('Remises', 'Liste publique (sans filtre) montre le palier hors stock', [true], dealsAll.some((d) => d.id === unreachable.data?.id));
  const dealsReachable = (await api('GET', `/discounts?product_id=${product.id}&state=active&reachable=true&limit=50`, { token: T.buyer })).data ?? [];
  record('Remises', 'Liste publique “reachable” exclut le palier hors stock', [false], dealsReachable.some((d) => d.id === unreachable.data?.id));
  record('Remises', 'Liste publique “reachable” garde les paliers accessibles', [2], dealsReachable.length);
  record('Remises', 'Tri “se termine bientôt”', [200], (await api('GET', '/discounts?sort=ending_soon', { token: T.buyer })).status);
  record('Remises', 'Liste “mes remises” vendeur', [200], (await api('GET', '/discounts/mine', { token: T.seller })).status);
  record('Remises', 'Liste “mes remises” acheteur interdite', [403], (await api('GET', '/discounts/mine', { token: T.buyer })).status);

  /* ============================================================ DEMANDES */
  record('Demandes', 'Création par un vendeur interdite', [403], (await api('POST', '/requests', {
    token: T.seller, body: { category_id: CATEGORY, title: 'x', quantity: 1 },
  })).status);
  record('Demandes', 'Demande sans catégorie ni produit', [400, 422], (await api('POST', '/requests', {
    token: T.buyer, body: { title: `${TAG} vide`, quantity: 10 },
  })).status);
  record('Demandes', 'Demande avec prix max négatif', [422], (await api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: `${TAG} négatif`, quantity: 100, max_price_per_unit: -1 },
  })).status);
  record('Demandes', 'Demande avec date mal formée', [422], (await api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: `${TAG} date`, quantity: 100, needed_by: '31/12/2027' },
  })).status);
  const reqRes = await must('Demandes', 'Demande dans les limites', api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: `${TAG} — demande liée`, quantity: 200, unit: 'kg' },
  }), [201]);
  const request = reqRes.data;
  created.requests.push(request.id);
  const openRes = await must('Demandes', 'Demande ouverte (sans produit)', api('POST', '/requests', {
    token: T.buyer, body: { category_id: CATEGORY, title: `${TAG} — demande ouverte`, quantity: 1000, unit: 'kg' },
  }), [201]);
  const openRequest = openRes.data;
  created.requests.push(openRequest.id);
  const resp = await api('POST', `/requests/${openRequest.id}/responses`, {
    token: T.seller, body: { message: 'fixture', proposed_quantity: 900, proposed_price_per_unit: 1.6 },
  });
  record('Demandes', 'Proposition vendeur', [201], resp.status);
  record('Demandes', 'Proposition en double refusée', [409], (await api('POST', `/requests/${openRequest.id}/responses`, {
    token: T.seller, body: { proposed_quantity: 1 },
  })).status);
  record('Demandes', 'Proposition à quantité négative', [422], (await api('POST', `/requests/${openRequest.id}/responses`, {
    token: T.seller2, body: { proposed_quantity: -1 },
  })).status);
  const respondAfterClose = await api('PATCH', `/requests/${request.id}/status`, { token: T.buyer, body: { status: 'cancelled' } });
  record('Demandes', 'Annulation de la demande liée', [200], respondAfterClose.status);
  record('Demandes', 'Proposition sur demande annulée refusée', [409], (await api('POST', `/requests/${request.id}/responses`, {
    token: T.seller, body: { proposed_quantity: 1 },
  })).status);
  record('Demandes', 'Statut inconnu refusé', [422], (await api('PATCH', `/requests/${openRequest.id}/status`, {
    token: T.buyer, body: { status: 'pending' },
  })).status);
  record('Demandes', 'Statut validé par le propriétaire', [200], (await api('PATCH', `/requests/${openRequest.id}/status`, {
    token: T.buyer, body: { status: 'in_progress' },
  })).status);
  record('Demandes', 'Autre acheteur ne modifie pas la demande', [403], (await api('PATCH', `/requests/${openRequest.id}`, {
    token: T.buyer2, body: { title: `${TAG} piraté` },
  })).status);
  record('Demandes', 'Liste des réponses', [200], (await api('GET', `/requests/${openRequest.id}/responses`, { token: T.buyer })).status);
  record('Demandes', 'Retrait de sa propre proposition', [200], (await api('PATCH', `/requests/${openRequest.id}/responses/${resp.data.id}`, {
    token: T.seller, body: { status: 'withdrawn' },
  })).status);
  record('Demandes', 'Retrait par un autre vendeur refusé', [403], (await api('PATCH', `/requests/${openRequest.id}/responses/${resp.data.id}`, {
    token: T.seller2, body: { status: 'withdrawn' },
  })).status);
  record('Demandes', 'Demandes reçues (vendeur)', [200], (await api('GET', '/requests/received', { token: T.seller })).status);
  record('Demandes', 'Mes demandes (acheteur)', [200], (await api('GET', '/requests/mine', { token: T.buyer })).status);
  record('Demandes', 'Mes demandes interdites au vendeur', [403], (await api('GET', '/requests/mine', { token: T.seller })).status);
  record('Demandes', 'include_closed=false exclut les annulées', [true], ((await api('GET', '/requests?include_closed=false&limit=50', { token: T.buyer })).data ?? []).every((r) => r.status !== 'cancelled'));

  /* ============================================================== OFFRES */
  const pointRes = await must('Points', 'Création point de collecte', api('POST', '/collection-points', {
    token: T.collector,
    body: {
      name: `${TAG} — point`, gouvernorat: 'Sfax', lat: 34.75, lng: 10.73, storage_capacity_kg: 10000,
      category_ids: [CATEGORY], email: 'point@test.local',
      schedule: [{ day_of_week: 1, opens_at: '08:00', closes_at: '17:00' }],
    },
  }), [201]);
  const point = pointRes.data;
  created.points.push(point.id);
  record('Points', 'Email du point invalide', [422], (await api('POST', '/collection-points', {
    token: T.collector, body: { name: `${TAG} — point mail`, gouvernorat: 'Sfax', lat: 34.7, lng: 10.7, email: 'nope' },
  })).status);
  record('Points', 'Horaire fermeture < ouverture refusé', [422], (await api('POST', '/collection-points', {
    token: T.collector,
    body: { name: `${TAG} — horaire`, gouvernorat: 'Sfax', lat: 34.7, lng: 10.7, schedule: [{ day_of_week: 1, opens_at: '18:00', closes_at: '09:00' }] },
  })).status);
  record('Points', 'Jour de semaine invalide refusé', [422], (await api('POST', '/collection-points', {
    token: T.collector,
    body: { name: `${TAG} — jour`, gouvernorat: 'Sfax', lat: 34.7, lng: 10.7, schedule: [{ day_of_week: 9, is_closed: true }] },
  })).status);
  record('Points', 'Création par un vendeur interdite', [403], (await api('POST', '/collection-points', {
    token: T.seller, body: { name: 'x', gouvernorat: 'Sfax', lat: 34.7, lng: 10.7 },
  })).status);
  record('Points', 'PATCH par un autre collecteur refusé', [403], (await api('PATCH', `/collection-points/${point.id}`, {
    token: T.collector2, body: { name: 'vol' },
  })).status);
  record('Points', 'Détail du point par son gérant', [200], (await api('GET', `/collection-points/${point.id}`, { token: T.collector })).status);
  record('Points', 'Point non vérifié masqué au public', [404], (await api('GET', `/collection-points/${point.id}`, { token: T.buyer })).status);
  const schedulePut = await api('PUT', `/collection-points/${point.id}/schedule`, {
    token: T.collector,
    body: { days: Array.from({ length: 7 }, (_, i) => ({ day_of_week: i, opens_at: '08:00', closes_at: '17:00' })) },
  });
  record('Points', 'Remplacement des horaires (7 jours)', [200], schedulePut.status);
  const scheduleGet = await api('GET', `/collection-points/${point.id}/schedule`, { token: T.collector });
  record('Points', 'Horaires relus = 7 jours', [7], (scheduleGet.data ?? []).length);
  record('Points', 'Jour en double refusé', [400], (await api('PUT', `/collection-points/${point.id}/schedule`, {
    token: T.collector, body: { days: [{ day_of_week: 1, opens_at: '08:00', closes_at: '17:00' }, { day_of_week: 1, opens_at: '09:00', closes_at: '18:00' }] },
  })).status);
  record('Points', 'Mise à jour de la localisation', [200], (await api('PATCH', `/collection-points/${point.id}/location`, {
    token: T.collector, body: { lat: 34.76, lng: 10.77, address: 'Rue test' },
  })).status);
  record('Points', 'Filtre open_now', [200], (await api('GET', '/collection-points?open_now=true&limit=100', { token: T.buyer })).status);
  record('Points', 'Points proches (rayon)', [200], (await api('GET', '/collection-points?lat=34.75&lng=10.73&radius_km=10', { token: T.buyer })).status);
  record('Points', 'DELETE par un autre collecteur refusé', [403], (await api('DELETE', `/collection-points/${point.id}`, { token: T.collector2 })).status);

  /* ============================================================ STOCKAGE */
  record('Stockage', 'Vue d’ensemble', [200], (await api('GET', `/collection-points/${point.id}/storage`, { token: T.collector })).status);
  record('Stockage', 'Vue d’ensemble interdite au vendeur', [403], (await api('GET', `/collection-points/${point.id}/storage`, { token: T.seller })).status);
  record('Stockage', 'Capacité mise à jour', [200], (await api('PATCH', `/collection-points/${point.id}/storage/capacity`, {
    token: T.collector, body: { storage_capacity_kg: 20000 },
  })).status);
  const itemRes = await api('POST', `/collection-points/${point.id}/storage/items`, {
    token: T.collector, body: { label: `${TAG} — grignons`, category_id: CATEGORY, initial_quantity_kg: 4000, min_threshold_kg: 1000 },
  });
  record('Stockage', 'Création article avec stock initial', [201], itemRes.status);
  const item = itemRes.data;
  record('Stockage', 'Mouvement entrée', [201], (await api('POST', `/collection-points/${point.id}/storage/movements`, {
    token: T.collector, body: { stock_item_id: item.id, type: 'in', quantity_kg: 500, reason: 'fixture' },
  })).status);
  record('Stockage', 'Sortie supérieure au stock refusée', [409], (await api('POST', `/collection-points/${point.id}/storage/movements`, {
    token: T.collector, body: { stock_item_id: item.id, type: 'out', quantity_kg: 999999 },
  })).status);
  record('Stockage', 'Suppression d’un article encore stocké refusée', [409], (await api('DELETE', `/collection-points/${point.id}/storage/items/${item.id}`, { token: T.collector })).status);
  record('Stockage', 'Capacité inférieure au stock utilisé refusée', [409], (await api('PATCH', `/collection-points/${point.id}/storage/capacity`, {
    token: T.collector, body: { storage_capacity_kg: 1 },
  })).status);
  record('Stockage', 'Ajustement négatif refusé', [422], (await api('POST', `/collection-points/${point.id}/storage/movements`, {
    token: T.collector, body: { stock_item_id: item.id, type: 'adjust', quantity_kg: -5 },
  })).status);
  record('Stockage', 'Mouvement par un autre collecteur refusé', [403], (await api('POST', `/collection-points/${point.id}/storage/movements`, {
    token: T.collector2, body: { stock_item_id: item.id, type: 'in', quantity_kg: 1 },
  })).status);
  record('Stockage', 'Seuil de l’article modifié', [200], (await api('PATCH', `/collection-points/${point.id}/storage/items/${item.id}`, {
    token: T.collector, body: { min_threshold_kg: 1000 },
  })).status);
  record('Stockage', 'Sortie de 4500 kg vide le stock', [201], (await api('POST', `/collection-points/${point.id}/storage/movements`, {
    token: T.collector, body: { stock_item_id: item.id, type: 'out', quantity_kg: 4500 },
  })).status);
  const overview = await api('GET', `/collection-points/${point.id}/storage`, { token: T.collector });
  record('Stockage', 'Alerte stock bas après sortie', [true], (overview.data?.items ?? []).some((i) => i.id === item.id && i.is_low_stock === true));
  record('Stockage', 'Suppression d’un article vide', [204], (await api('DELETE', `/collection-points/${point.id}/storage/items/${item.id}`, { token: T.collector })).status);
  record('Stockage', 'Seconde suppression = 404', [404], (await api('DELETE', `/collection-points/${point.id}/storage/items/${item.id}`, { token: T.collector })).status);
  record('Stockage', 'Liste des mouvements', [200], (await api('GET', `/collection-points/${point.id}/storage/movements`, { token: T.collector })).status);

  const offerItemRes = await api('POST', `/collection-points/${point.id}/storage/items`, {
    token: T.collector, body: { label: `${TAG} — lot à vendre`, category_id: CATEGORY, initial_quantity_kg: 8000 },
  });
  record('Offres', 'Article de stock dédié créé', [201], offerItemRes.status);
  const offerRes = await api('POST', '/offers', {
    token: T.collector, body: { collection_point_id: point.id, stock_item_id: offerItemRes.data.id, title: `${TAG} — offre`, quantity: 5, unit: 't', price_per_unit: 0.4 },
  });
  record('Offres', 'Création offre brouillon', [201], offerRes.status);
  const offer = offerRes.data;
  if (offer?.id) created.offers.push(offer.id);
  record('Offres', 'Publication de l’offre', [200], (await api('POST', `/offers/${offer.id}/publish`, { token: T.collector })).status);
  record('Offres', 'Double publication refusée', [409], (await api('POST', `/offers/${offer.id}/publish`, { token: T.collector })).status);
  record('Offres', 'Offre au-delà du stock refusée', [409], (await api('PATCH', `/offers/${offer.id}`, {
    token: T.collector, body: { quantity: 99999 },
  })).status);
  record('Offres', 'Fin avant début refusée', [422], (await api('POST', '/offers', {
    token: T.collector, body: {
      collection_point_id: point.id, title: `${TAG} — dates`, quantity: 1,
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), ends_at: tomorrow(),
    },
  })).status);
  record('Offres', 'Quantité 0 refusée', [422], (await api('POST', '/offers', {
    token: T.collector, body: { title: `${TAG} — zéro`, quantity: 0 },
  })).status);
  record('Offres', 'Offre sur le point d’un autre collecteur', [403], (await api('POST', '/offers', {
    token: T.collector2, body: { collection_point_id: point.id, title: `${TAG} — vol`, quantity: 1 },
  })).status);
  record('Offres', 'Liste des offres à venir', [200], (await api('GET', '/offers/upcoming', { token: T.buyer })).status);
  record('Offres', 'Filtre timing=ongoing', [200], (await api('GET', '/offers?timing=ongoing', { token: T.buyer })).status);
  record('Offres', 'Filtre status inconnu refusé', [422], (await api('GET', '/offers?status=bogus', { token: T.buyer })).status);
  record('Offres', 'Clôture de l’offre', [200], (await api('POST', `/offers/${offer.id}/close`, { token: T.collector })).status);
  record('Offres', 'Modification d’une offre clôturée refusée', [409], (await api('PATCH', `/offers/${offer.id}`, {
    token: T.collector, body: { quantity: 1 },
  })).status);
  record('Offres', 'Annulation d’une offre clôturée refusée', [409], (await api('POST', `/offers/${offer.id}/cancel`, { token: T.collector })).status);

  /* ============================================================== ACHATS */
  record('Achats', 'Création par un acheteur interdite', [403], (await api('POST', '/purchases', {
    token: T.buyer, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 100 },
  })).status);
  const purchaseRes = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 300 },
  });
  record('Achats', 'Achat valide créé', [201], purchaseRes.status);
  const purchase = purchaseRes.data;
  record('Achats', 'Prix calculé par palier (300 kg → -25 %)', [1.5], purchase?.unit_price);
  record('Achats', 'Montant total cohérent', [450], purchase?.total_amount);
  record('Achats', 'Stock annoncé intact à la création', [1000], (await api('GET', `/products/${product.id}`, { token: T.seller })).data?.quantity_available);
  record('Achats', 'Achat sur le point d’un autre collecteur', [403], (await api('POST', '/purchases', {
    token: T.collector2, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 100 },
  })).status);
  record('Achats', 'Saisie libre sans libellé refusée', [400, 422], (await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, quantity_kg: 10 },
  })).status);
  const freeEntry = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, label: `${TAG} — apport direct`, quantity_kg: 10, unit_price: 0.2 },
  });
  record('Achats', 'Saisie libre acceptée', [201], freeEntry.status);
  record('Achats', 'Réception directe depuis pending refusée', [409], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  record('Achats', 'Confirmation par le vendeur', [200], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.seller, body: { status: 'confirmed' },
  })).status);
  record('Achats', 'Réception par le vendeur interdite', [403], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.seller, body: { status: 'received' },
  })).status);
  record('Achats', 'Réception par le collecteur', [200], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  record('Achats', 'Stock annoncé décrémenté à la réception', [700], (await api('GET', `/products/${product.id}`, { token: T.seller })).data?.quantity_available);
  const purchasedStock = await query('SELECT COALESCE(SUM(quantity_kg), 0) AS kg FROM stock_items WHERE collection_point_id = $1', [point.id]);
  record('Achats', 'Stock du point crédité', [true], Number(purchasedStock.rows[0].kg) >= 300);
  record('Achats', 'Double réception refusée', [409], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  record('Achats', 'Annulation après réception refusée', [409], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.collector, body: { status: 'cancelled' },
  })).status);
  record('Achats', 'Achat saisie libre : réception directe refusée', [409], (await api('PATCH', `/purchases/${freeEntry.data.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  record('Achats', 'Achat saisie libre confirmé par le collecteur', [200], (await api('PATCH', `/purchases/${freeEntry.data.id}/status`, {
    token: T.collector, body: { status: 'confirmed' },
  })).status);
  record('Achats', 'Achat saisie libre réceptionné', [200], (await api('PATCH', `/purchases/${freeEntry.data.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  const cancellable = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 100 },
  });
  record('Achats', 'Achat supplémentaire créé', [201], cancellable.status);
  record('Achats', 'Achat supplémentaire confirmé', [200], (await api('PATCH', `/purchases/${cancellable.data.id}/status`, {
    token: T.seller, body: { status: 'confirmed' },
  })).status);
  record('Achats', 'Annulation d’une confirmation acceptée', [200], (await api('PATCH', `/purchases/${cancellable.data.id}/status`, {
    token: T.collector, body: { status: 'cancelled' },
  })).status);
  record('Achats', 'Achat annulé non réceptionné', [409], (await api('PATCH', `/purchases/${cancellable.data.id}/status`, {
    token: T.collector, body: { status: 'received' },
  })).status);
  record('Achats', 'Liste des achats (vendeur)', [200], (await api('GET', '/purchases', { token: T.seller })).status);
  record('Achats', 'Filtre statut des achats', [200], (await api('GET', '/purchases?status=received', { token: T.collector })).status);
  record('Achats', 'Statut cible pending invalide', [422], (await api('PATCH', `/purchases/${purchase.id}/status`, {
    token: T.collector, body: { status: 'pending' },
  })).status);

  /* ================================================================ CHAT */
  const sellerConv = await api('POST', '/conversations', { token: T.buyer, body: { participant_id: (await api('GET', `/products/${product.id}`, { token: T.buyer })).data.seller_id } });
  record('Messagerie', 'Conversation acheteur → vendeur', [201, 200], sellerConv.status);
  const conversation = sellerConv.data?.conversation ?? sellerConv.data;
  if (conversation?.id) {
    record('Messagerie', 'Réutilisation de la conversation', [201, 200], (await api('POST', '/conversations', {
      token: T.buyer, body: { participant_id: (await api('GET', `/products/${product.id}`, { token: T.buyer })).data.seller_id },
    })).status);
    record('Messagerie', 'Envoi de message', [201, 200], (await api('POST', `/conversations/${conversation.id}/messages`, {
      token: T.buyer, body: { body: `${TAG} — message` },
    })).status);
    const msgs = await api('GET', `/conversations/${conversation.id}/messages`, { token: T.seller });
    record('Messagerie', 'Lecture des messages par le destinataire', [200], msgs.status);
    record('Messagerie', 'Message présent dans le fil', [true], (msgs.data ?? []).some((m) => m.body.includes(TAG)));
    record('Messagerie', 'Message vide refusé', [422], (await api('POST', `/conversations/${conversation.id}/messages`, {
      token: T.buyer, body: { body: '' },
    })).status);
    record('Messagerie', 'Contexte sans identifiant refusé', [422], (await api('POST', `/conversations/${conversation.id}/messages`, {
      token: T.buyer, body: { body: 'x', context_type: 'product' },
    })).status);
    record('Messagerie', 'Non-participant ne lit pas le fil', [403], (await api('GET', `/conversations/${conversation.id}`, { token: T.seller2 })).status);
    record('Messagerie', 'Non-participant n’écrit pas', [403], (await api('POST', `/conversations/${conversation.id}/messages`, {
      token: T.seller2, body: { body: 'intrus' },
    })).status);
    record('Messagerie', 'Marquage lu', [200], (await api('POST', `/conversations/${conversation.id}/read`, { token: T.seller })).status);
  }
  record('Messagerie', 'Conversation avec soi-même refusée', [400], (await api('POST', '/conversations', {
    token: T.buyer, body: { participant_id: (await api('GET', '/auth/me', { token: T.buyer })).data.id },
  })).status);
  record('Messagerie', 'Conversation entre deux acheteurs refusée', [403], (await api('POST', '/conversations', {
    token: T.buyer, body: { participant_id: (await api('GET', '/auth/me', { token: T.buyer2 })).data.id },
  })).status);
  record('Messagerie', 'Compteur de non-lus', [200], (await api('GET', '/conversations/unread-count', { token: T.seller })).status);
  record('Messagerie', 'Liste des conversations', [200], (await api('GET', '/conversations', { token: T.buyer })).status);

  /* ======================================================= NOTIFICATIONS */
  record('Notifications', 'Liste', [200], (await api('GET', '/notifications', { token: T.seller })).status);
  record('Notifications', 'Compteur non-lus', [200], (await api('GET', '/notifications/unread-count', { token: T.seller })).status);
  const notifList = await api('GET', '/notifications?limit=5', { token: T.seller });
  const notif = notifList.data?.[0];
  if (notif) {
    record('Notifications', 'Marquage lu', [200], (await api('PATCH', `/notifications/${notif.id}/read`, { token: T.seller })).status);
    record('Notifications', 'Marquage par un autre utilisateur refusé', [404, 403], (await api('PATCH', `/notifications/${notif.id}/read`, { token: T.buyer })).status);
    record('Notifications', 'Suppression par un autre utilisateur refusée', [404, 403], (await api('DELETE', `/notifications/${notif.id}`, { token: T.buyer })).status);
  }
  record('Notifications', 'Tout marquer lu', [200], (await api('PATCH', '/notifications/read-all', { token: T.seller })).status);
  record('Notifications', 'Non-lus = 0 après lecture', [0], (await api('GET', '/notifications/unread-count', { token: T.seller })).data?.count);
  record('Notifications', 'Filtre unread_only', [true], ((await api('GET', '/notifications?unread_only=true', { token: T.seller })).data ?? []).every((n) => !n.read_at));
  record('Notifications', 'Suppression des lus', [200, 204], (await api('DELETE', '/notifications/read', { token: T.seller })).status);

  /* ============================================================ RAPPORTS */
  const overviewRep = await api('GET', '/reports/overview', { token: T.seller });
  record('Rapports', 'Vue d’ensemble vendeur', [200], overviewRep.status);
  record('Rapports', 'Vue d’ensemble structurée', [true], overviewRep.data !== undefined);
  const timeline = await api('GET', '/reports/timeline?months=6', { token: T.seller });
  record('Rapports', 'Chronologie 6 mois', [6], (timeline.data ?? []).length);
  record('Rapports', 'Chronologie 40 mois refusée', [422], (await api('GET', '/reports/timeline?months=40', { token: T.seller })).status);
  record('Rapports', 'Rapports acheteur', [200], (await api('GET', '/reports/overview', { token: T.buyer })).status);
  record('Rapports', 'Rapports refusés à l’admin', [400, 403], (await api('GET', '/reports/overview', { token: T.admin })).status);
  record('Rapports', 'Période inversée refusée', [400], (await api('GET', '/reports/overview?from=2027-01-01&to=2026-01-01', { token: T.seller })).status);

  /* ================================================================ CARTE */
  record('Carte', 'Marqueurs', [200], (await api('GET', '/map', { token: T.buyer })).status);
  record('Carte', 'Marqueurs filtrés par type', [200], (await api('GET', '/map?types=seller,collection_point', { token: T.buyer })).status);
  record('Carte', 'Type inconnu refusé', [422], (await api('GET', '/map?types=bogus', { token: T.buyer })).status);
  record('Carte', 'Bounds invalides refusés', [422], (await api('GET', '/map?bounds=1,2', { token: T.buyer })).status);
  record('Carte', 'Bounds hors Tunisie refusés', [422], (await api('GET', '/map?bounds=0,0,1,1', { token: T.buyer })).status);
  record('Carte', 'Limit 2000 refusée', [422], (await api('GET', '/map?limit=2000', { token: T.buyer })).status);
  record('Carte', 'Points proches', [200], (await api('GET', '/map/nearby?lat=34.75&lng=10.73', { token: T.buyer })).status);
  record('Carte', 'Points proches sans coordonnées', [422], (await api('GET', '/map/nearby', { token: T.buyer })).status);

  /* =========================================================== RECHERCHE */
  record('Recherche', 'Recherche rapide', [200], (await api('GET', '/search?q=olive', { token: T.buyer })).status);
  record('Recherche', 'Requête trop courte refusée', [422], (await api('GET', '/search?q=a', { token: T.buyer })).status);
  record('Recherche', 'Type inconnu refusé', [422], (await api('GET', '/search?q=olive&types=bogus', { token: T.buyer })).status);
  const smart = await api('GET', `/search/smart?q=${encodeURIComponent('je cherche 2 tonnes de grignons pas cher à Sfax')}`, { token: T.buyer });
  record('Recherche', 'Recherche intelligente', [200], smart.status);
  record('Recherche', 'Interprétation de la quantité (2 t → 2000 kg)', [2000], smart.data?.interpretation?.filters?.min_quantity);
  record('Recherche', 'Interprétation du gouvernorat', ['Sfax'], smart.data?.interpretation?.filters?.gouvernorat);
  record('Recherche', 'Recherche intelligente trop courte', [422], (await api('GET', '/search/smart?q=a', { token: T.buyer })).status);

  /* ============================================================== IMPRESSION */
  const sheet = await api('GET', `/print/products/${product.id}`, { token: T.buyer });
  record('Impression', 'Fiche produit imprimable', [200], sheet.status);
  record('Impression', 'Fiche contient les paliers', [true], String(sheet.body?.raw ?? '').includes('Remises par paliers'));
  record('Impression', 'Ressource inconnue refusée', [422], (await api('GET', '/print/bogus/00000000-0000-4000-8000-000000000000', { token: T.buyer })).status);
  record('Impression', 'Identifiant invalide refusé', [422], (await api('GET', '/print/products/nope', { token: T.buyer })).status);
  record('Impression', 'Bon d’achat d’un autre collecteur refusé', [403, 404], (await api('GET', `/print/purchases/${purchase.id}`, { token: T.collector2 })).status);

  /* ================================================================ ADMIN */
  const stats = await api('GET', '/admin/stats', { token: T.admin });
  record('Admin', 'Statistiques', [200], stats.status);
  record('Admin', 'Statistiques non vides', [true], stats.data !== undefined);
  record('Admin', 'Statistiques interdites au vendeur', [403], (await api('GET', '/admin/stats', { token: T.seller })).status);
  record('Admin', 'Liste utilisateurs par rôle', [200], (await api('GET', '/admin/users?role=seller', { token: T.admin })).status);
  record('Admin', 'Rôle inconnu refusé', [422], (await api('GET', '/admin/users?role=bogus', { token: T.admin })).status);
  record('Admin', 'Vérification du compte fixture', [200], (await api('PATCH', `/admin/users/${fixture.id}`, { token: T.admin, body: { is_verified: true } })).status);
  record('Admin', 'Sans indicateur refusé', [422], (await api('PATCH', `/admin/users/${fixture.id}`, { token: T.admin, body: {} })).status);
  record('Admin', 'Utilisateur inexistant', [404], (await api('PATCH', '/admin/users/00000000-0000-4000-8000-000000000000', {
    token: T.admin, body: { is_verified: true },
  })).status);
  record('Admin', 'Points en attente', [200], (await api('GET', '/admin/collection-points/pending', { token: T.admin })).status);
  record('Admin', 'Validation du point', [200], (await api('PATCH', `/admin/collection-points/${point.id}/verify`, {
    token: T.admin, body: { is_verified: true },
  })).status);
  record('Admin', 'Suspension du compte fixture', [200], (await api('PATCH', `/admin/users/${fixture.id}`, {
    token: T.admin, body: { is_active: false },
  })).status);
  record('Admin', 'Connexion d’un compte suspendu refusée', [403], (await api('POST', '/auth/login', {
    body: { email, password: 'Nouveau2026!' },
  })).status);

  /* ====================================================== CATÉGORIES / MARCHÉS */
  record('Référentiels', 'Liste des catégories', [200], (await api('GET', '/categories')).status);
  record('Référentiels', 'Création catégorie par un vendeur interdite', [403], (await api('POST', '/categories', {
    token: T.seller, body: { slug: `test-${Date.now()}`, name: 'Test' },
  })).status);
  record('Référentiels', 'Slug invalide refusé', [422], (await api('POST', '/categories', {
    token: T.admin, body: { slug: 'Slug Invalide!', name: 'Test' },
  })).status);
  const catRes = await api('POST', '/categories', { token: T.admin, body: { slug: `audit-${Date.now()}`, name: `${TAG} catégorie` } });
  record('Référentiels', 'Création catégorie admin', [201], catRes.status);
  if (catRes.status === 201) {
    record('Référentiels', 'Slug en double refusé', [409], (await api('POST', '/categories', {
      token: T.admin, body: { slug: catRes.data.slug, name: 'Doublon' },
    })).status);
    record('Référentiels', 'Suppression catégorie', [204, 200], (await api('DELETE', `/categories/${catRes.data.id}`, { token: T.admin })).status);
  }
  record('Référentiels', 'Liste des marchés', [200], (await api('GET', '/markets')).status);
  const mktRes = await api('POST', '/markets', { token: T.admin, body: { slug: `audit-${Date.now()}`, name: `${TAG} marché`, gouvernorat: 'Sfax' } });
  record('Référentiels', 'Création marché admin', [201], mktRes.status);
  if (mktRes.status === 201) {
    record('Référentiels', 'Suppression marché', [204, 200], (await api('DELETE', `/markets/${mktRes.data.id}`, { token: T.admin })).status);
  }

  /* ============================================================ TÉLÉVERSEMENT */
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f6c0000000049454e44ae426082', 'hex');
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const up = await api('POST', '/uploads/images', { token: T.seller, form });
  record('Téléversement', 'Envoi d’une image PNG', [201], up.status);
  record('Téléversement', 'URL publique renvoyée', [true], typeof up.data?.[0]?.url === 'string');
  const txtForm = new FormData();
  txtForm.append('images', new Blob(['pas une image'], { type: 'text/plain' }), 'note.txt');
  record('Téléversement', 'Fichier non image refusé', [400, 422], (await api('POST', '/uploads/images', { token: T.seller, form: txtForm })).status);
  const emptyForm = new FormData();
  emptyForm.append('autre', 'x');
  record('Téléversement', 'Sans fichier refusé', [400], (await api('POST', '/uploads/images', { token: T.seller, form: emptyForm })).status);
  if (up.data?.[0]?.filename) {
    record('Téléversement', 'Suppression du fichier d’un autre utilisateur refusée', [403], (await api('DELETE', `/uploads/${up.data[0].filename}`, { token: T.buyer })).status);
    record('Téléversement', 'Traversée de chemin refusée', [400, 404], (await api('DELETE', `/uploads/${encodeURIComponent('../server.js')}`, { token: T.seller })).status);
    record('Téléversement', 'Suppression de son propre fichier', [204], (await api('DELETE', `/uploads/${up.data[0].filename}`, { token: T.seller })).status);
    record('Téléversement', 'Double suppression', [404], (await api('DELETE', `/uploads/${up.data[0].filename}`, { token: T.seller })).status);
  }

  /* ========================================================= COMPLÉMENTS */
  const discountedOnly = await api('GET', '/products?has_discount=true&limit=50', { token: T.buyer });
  record('Compléments', 'Filtre has_discount', [200], discountedOnly.status);
  record('Compléments', 'has_discount ne renvoie que des remisées', [true], (discountedOnly.data ?? []).every((p) => p.best_discount_percentage != null));
  record('Compléments', 'Remises expirées filtrées', [true], ((await api('GET', '/discounts?state=expired&limit=50', { token: T.buyer })).data ?? []).every((d) => d.state === 'expired'));
  record('Compléments', 'Mes offres (collecteur)', [200], (await api('GET', '/offers/mine', { token: T.collector })).status);
  record('Compléments', 'Mes points (collecteur)', [200], (await api('GET', '/collection-points/mine', { token: T.collector })).status);
  record('Compléments', 'Mouvements filtrés par type', [200], (await api('GET', `/collection-points/${point.id}/storage/movements?type=in`, { token: T.collector })).status);
  record('Compléments', 'Recherche rapide limitée aux produits', [200], (await api('GET', '/search?q=olive&types=products', { token: T.buyer })).status);
  record('Compléments', 'Carte avec bounds valides', [200], (await api('GET', '/map?bounds=10.0,34.0,11.0,35.5', { token: T.buyer })).status);
  const seller2Id = (await api('GET', '/auth/me', { token: T.seller2 })).data.id;
  const targeted = await api('POST', '/requests', {
    token: T.buyer, body: { category_id: CATEGORY, title: `${TAG} — ciblée`, quantity: 100, target_user_id: seller2Id },
  });
  record('Compléments', 'Demande ciblée créée', [201], targeted.status);
  if (targeted.status === 201) {
    created.requests.push(targeted.data.id);
    record('Compléments', 'Vendeur non ciblé ne répond pas', [403], (await api('POST', `/requests/${targeted.data.id}/responses`, {
      token: T.seller, body: { proposed_quantity: 10 },
    })).status);
    record('Compléments', 'Vendeur ciblé répond', [201], (await api('POST', `/requests/${targeted.data.id}/responses`, {
      token: T.seller2, body: { proposed_quantity: 10 },
    })).status);
  }
  const cat = (await api('GET', '/categories')).data?.[0];
  record('Compléments', 'Détail catégorie', [200], (await api('GET', `/categories/${cat?.id}`)).status);
  record('Compléments', 'PATCH catégorie admin', [200], (await api('PATCH', `/categories/${cat?.id}`, { token: T.admin, body: { description: cat?.description ?? '' } })).status);
  const mkt = (await api('GET', '/markets')).data?.[0];
  record('Compléments', 'Détail marché', [200], (await api('GET', `/markets/${mkt?.id}`)).status);
  record('Compléments', 'PATCH marché admin', [200], (await api('PATCH', `/markets/${mkt?.id}`, { token: T.admin, body: { description: mkt?.description ?? '' } })).status);
  record('Compléments', 'Admin : recherche d’utilisateurs', [true], ((await api('GET', '/admin/users?q=zitouna', { token: T.admin })).data ?? []).length > 0);
  const firstConv = (await api('GET', '/conversations', { token: T.buyer })).data?.[0];
  if (firstConv) {
    const msgs = await api('GET', `/conversations/${firstConv.id}/messages?limit=1`, { token: T.buyer });
    record('Compléments', 'Messages paginés (limit=1)', [1], (msgs.data ?? []).length);
    record('Compléments', 'Curseur “before” accepté', [200], (await api('GET', `/conversations/${firstConv.id}/messages?before=${encodeURIComponent(new Date().toISOString())}`, { token: T.buyer })).status);
  }
  record('Compléments', 'Impressions des offres', [200], (await api('GET', `/print/offers/${created.offers[0]}`, { token: T.collector })).status);
  record('Compléments', 'Impression d’un point de collecte', [200], (await api('GET', `/print/collection-points/${point.id}`, { token: T.collector })).status);
  record('Compléments', 'Impression de l’état du stock', [200], (await api('GET', `/print/storage/${point.id}`, { token: T.collector })).status);
  const three = new FormData();
  for (let i = 0; i < 4; i += 1) three.append('images', new Blob([png], { type: 'image/png' }), `p${i}.png`);
  record('Téléversement', 'Plus de 3 images refusé', [400, 413], (await api('POST', '/uploads/images', { token: T.seller, form: three })).status);

  /* ====================================================== SCÉNARIOS DE BORD */
  await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { is_active: false } });
  const hiddenPurchase = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 100 },
  });
  record('Bord', 'Achat d’un produit désactivé refusé', [404, 409], hiddenPurchase.status);
  const hiddenRequest = await api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: `${TAG} — produit inactif`, quantity: 100 },
  });
  record('Bord', 'Demande sur un produit désactivé refusée', [404, 409], hiddenRequest.status);
  if (hiddenRequest.status === 201) created.requests.push(hiddenRequest.data.id);
  const hiddenDeals = await api('GET', `/discounts?product_id=${product.id}&state=active&limit=50`, { token: T.buyer });
  record('Bord', 'Remises d’un produit désactivé absentes de la liste publique', [0], (hiddenDeals.data ?? []).filter((d) => d.product_id === product.id).length);
  await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { is_active: true } });

  record('Bord', 'Point revérifié par l’admin', [200], (await api('PATCH', `/admin/collection-points/${point.id}/verify`, {
    token: T.admin, body: { is_verified: true },
  })).status);
  record('Bord', 'Point vérifié visible publiquement', [200], (await api('GET', `/collection-points/${point.id}`, { token: T.buyer })).status);
  await api('PATCH', `/collection-points/${point.id}/location`, { token: T.collector, body: { lat: 34.81, lng: 10.81 } });
  record('Bord', 'Déplacement du point → vérification retirée', [false], !!(await api('GET', `/collection-points/${point.id}`, { token: T.collector })).data?.is_verified);
  record('Bord', 'Point déplacé de nouveau masqué au public', [404], (await api('GET', `/collection-points/${point.id}`, { token: T.buyer })).status);

  if (firstConv) {
    record('Bord', 'Message portant un contexte produit', [200, 201], (await api('POST', `/conversations/${firstConv.id}/messages`, {
      token: T.buyer, body: { body: 'à propos du produit', context_type: 'product', context_id: product.id },
    })).status);
  }

  const delProduct = await api('DELETE', `/products/${product.id}`, { token: T.seller });
  record('Bord', 'Suppression d’un produit acheté', [204, 409], delProduct.status);
  if (delProduct.status === 204) created.products = created.products.filter((id) => id !== product.id);
  const delPoint = await api('DELETE', `/collection-points/${point.id}`, { token: T.collector });
  record('Bord', 'Suppression d’un point avec stock et achats', [204, 409], delPoint.status);
  if (delPoint.status === 204) created.points = created.points.filter((id) => id !== point.id);
} catch (error) {
  console.error('\nAUDIT ABORTED:', error.message, error.cause?.code ?? '', error.cause?.message ?? '');
  results.push({ category: 'Audit', name: 'exécution', expected: ['-'], actual: 'ERREUR', ok: false, detail: error.message });
} finally {
  const step = async (label, sql, params = []) => {
    try { await query(sql, params); } catch (error) { console.error(`cleanup ${label}: ${error.message}`); }
  };
  await step('purchases', 'DELETE FROM purchases WHERE collection_point_id = ANY($1) OR product_id = ANY($2)', [created.points, created.products]);
  await step('movements', 'DELETE FROM stock_movements WHERE stock_item_id IN (SELECT id FROM stock_items WHERE collection_point_id = ANY($1))', [created.points]);
  await step('stock', 'DELETE FROM stock_items WHERE collection_point_id = ANY($1)', [created.points]);
  await step('offers', 'DELETE FROM offers WHERE id = ANY($1)', [created.offers]);
  await step('requests', 'DELETE FROM buy_requests WHERE id = ANY($1)', [created.requests]);
  await step('exchanges', 'DELETE FROM exchange_offers WHERE id = ANY($1)', [created.exchanges]);
  await step('points', 'DELETE FROM collection_points WHERE id = ANY($1)', [created.points]);
  await step('products', 'DELETE FROM products WHERE id = ANY($1)', [created.products]);
  await step('users', 'DELETE FROM users WHERE id = ANY($1)', [created.users]);
  if (startedAt) {
    await step('notifications', `DELETE FROM notifications WHERE created_at >= $1 AND user_id IN (
      SELECT id FROM users WHERE email IN ('admin@clac.tn','huilerie.zitouna@clac.tn','moulin.elamal@clac.tn',
        'achats@biodiesel-sahel.tn','collecte.sfax@clac.tn','grandtunis@eco-collecte.tn'))`, [startedAt]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} contrôles — ${results.length - failed.length} conformes, ${failed.length} échecs`);
  if (failed.length) console.log('\nÉCHECS:\n' + failed.map((r) => `- ${r.category} / ${r.name}: obtenu ${JSON.stringify(r.actual)}, attendu ${r.expected.join('/')}${r.detail ? ` (${r.detail})` : ''}`).join('\n'));
  process.exitCode = 0;
  const pool = (await import('../src/config/db.js')).default;
  await pool.end();
}
